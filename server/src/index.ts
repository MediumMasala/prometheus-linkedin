import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPrometheusAnalysis } from './mastra/index.js';
import { fetchLinkedInCampaignsTool } from './mastra/tools/fetchLinkedInCampaigns.js';
import { batchCampaignsTool } from './mastra/tools/batchCampaigns.js';
import { fetchInternalDataTool } from './mastra/tools/fetchInternalData.js';
import { mapAndReconcileTool } from './mastra/tools/mapAndReconcile.js';
import { login, authMiddleware, requireAdmin, type AuthRequest } from './lib/auth.js';
import {
  getAllUsers,
  createUser,
  updateUserRole,
  updateUserPassword,
  deleteUser,
  getUserStats,
  type UserRole,
} from './lib/users.js';
import {
  checkAndAlertHighCosts,
  sendDailySummary,
  getAlertThreshold,
  checkDailyCosts,
  checkCampaignCosts,
  sendMorningSummary,
  sendStatusUpdate,
  sendEndOfDaySummary,
  type ScheduledReportData,
} from './lib/slack.js';
import { runCampaignCostMonitor, getMonitorStatus, ALERT_CONFIG } from './workflows/campaign-cost-monitor/index.js';
import {
  exportRules,
  approveMapping,
  rejectMapping,
  updateMapping,
  approveBatch,
  getPendingMappings,
  getApprovedMappings,
  getRejectedMappings,
  loadBatchingRules,
} from './lib/batching-rules.js';
import {
  analyzeRejectedMapping,
  applySuggestion,
  type MappingCorrectionSuggestion,
} from './mastra/tools/analyzeMappingCorrection.js';
import {
  getCachedAnalysis,
  setCachedAnalysis,
  invalidateCache,
  clearAllCache,
  getCacheStatus,
  CACHE_CONFIG,
} from './lib/analysis-cache.js';
import cron from 'node-cron';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '..', '.token.json');

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth middleware to all /api routes except login and health
app.use('/api', (req, res, next) => {
  // Skip auth for these routes (use req.path which is relative to /api mount point)
  const publicRoutes = ['/auth/login', '/health', '/linkedin/auth-url', '/linkedin/token', '/linkedin/set-token'];
  if (publicRoutes.includes(req.path)) {
    return next();
  }
  return authMiddleware(req as AuthRequest, res, next);
});

const {
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  LINKEDIN_AD_ACCOUNT_ID,
  LINKEDIN_REDIRECT_URI,
  PORT = 3001,
} = process.env;

// Load token from environment variable (production) or file (development)
let accessToken: string | null = null;

// First check environment variable (for production)
if (process.env.LINKEDIN_ACCESS_TOKEN) {
  accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  console.log('Loaded access token from environment variable');
} else {
  // Fall back to file (for development)
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      accessToken = data.access_token;
      console.log('Loaded access token from file');
    }
  } catch (e) {
    console.log('No saved token found');
  }
}

// Save token to file
function saveToken(token: string) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }));
}

// ============== Authentication Routes ==============

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  // Support both 'username' and 'email' field names
  const email = username || req.body.email;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const result = login(email, password);

  if (result.success) {
    res.json({
      token: result.token,
      user: result.user,
    });
  } else {
    res.status(401).json({ error: result.error });
  }
});

app.get('/api/auth/verify', (req: AuthRequest, res) => {
  // If we get here, the auth middleware has already verified the token
  res.json({ valid: true, user: req.user });
});

// ============== User Management Routes (Admin Only) ==============

// Get all users
app.get('/api/users', requireAdmin, (req: AuthRequest, res) => {
  const users = getAllUsers();
  const stats = getUserStats();
  res.json({ users, stats });
});

// Create new user
app.post('/api/users', requireAdmin, (req: AuthRequest, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const validRoles: UserRole[] = ['admin', 'viewer'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin or viewer' });
  }

  const result = createUser(
    email,
    password,
    role || 'viewer',
    req.user?.email || 'unknown'
  );

  if (result.success) {
    res.json({ success: true, user: result.user });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Update user role
app.patch('/api/users/:userId/role', requireAdmin, (req: AuthRequest, res) => {
  const { userId } = req.params;
  const { role } = req.body;

  const validRoles: UserRole[] = ['admin', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin or viewer' });
  }

  const result = updateUserRole(userId, role);

  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Update user password (admin can reset any user's password)
app.patch('/api/users/:userId/password', requireAdmin, (req: AuthRequest, res) => {
  const { userId } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const result = updateUserPassword(userId, password);

  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Delete user
app.delete('/api/users/:userId', requireAdmin, (req: AuthRequest, res) => {
  const { userId } = req.params;

  // Prevent self-deletion
  if (req.user?.id === userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const result = deleteUser(userId);

  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// ============== LinkedIn OAuth Routes ==============

app.get('/api/linkedin/auth-url', (req, res) => {
  const scopes = ['r_ads', 'r_ads_reporting'].join('%20');
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI!)}&scope=${scopes}`;
  res.json({ authUrl });
});

app.post('/api/linkedin/token', async (req, res) => {
  const { code } = req.body;

  try {
    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: LINKEDIN_CLIENT_ID!,
      client_secret: LINKEDIN_CLIENT_SECRET!,
      redirect_uri: LINKEDIN_REDIRECT_URI!,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const data = await response.json();

    if (data.access_token) {
      accessToken = data.access_token;
      saveToken(accessToken!);
      console.log('Access token obtained and saved');
      res.json({ access_token: data.access_token, expires_in: data.expires_in });
    } else {
      console.error('Token error:', data);
      res.status(400).json({ error: data.error_description || 'Failed to get token' });
    }
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange code for token' });
  }
});

app.post('/api/linkedin/set-token', (req, res) => {
  const { token } = req.body;
  accessToken = token;
  saveToken(token);
  res.json({ success: true });
});

// Get current token (for copying to production env vars)
app.get('/api/linkedin/token-info', (req: AuthRequest, res) => {
  if (!accessToken) {
    return res.json({ hasToken: false });
  }
  // Only show partial token for security
  const masked = accessToken.substring(0, 20) + '...' + accessToken.substring(accessToken.length - 10);
  res.json({
    hasToken: true,
    maskedToken: masked,
    fullToken: accessToken, // Only accessible to authenticated users
    message: 'Copy the fullToken value to LINKEDIN_ACCESS_TOKEN env var in production',
  });
});

// ============== Legacy LinkedIn Routes (for existing frontend) ==============

// Campaign cache for legacy endpoints
let legacyCampaignCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
const LEGACY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

app.get('/api/linkedin/campaigns', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  const now = Date.now();
  if (legacyCampaignCache.data && now - legacyCampaignCache.timestamp < LEGACY_CACHE_TTL) {
    return res.json(legacyCampaignCache.data);
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    let allCampaigns: any[] = [];
    let start = 0;
    const count = 100;
    let hasMore = true;

    while (hasMore) {
      const url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search=(account:(values:List(${accountUrn})))&start=${start}&count=${count}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      const data = await response.json();
      if (response.ok && data.elements) {
        allCampaigns = allCampaigns.concat(data.elements);
        hasMore = data.elements.length >= count && start < 5000;
        start += count;
      } else {
        hasMore = false;
      }
    }

    const result = { elements: allCampaigns, total: allCampaigns.length };
    legacyCampaignCache = { data: result, timestamp: now };
    res.json(result);
  } catch (error) {
    console.error('Campaigns fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

app.get('/api/linkedin/analytics', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  try {
    const { startDate: startParam, endDate: endParam } = req.query;

    let startDate: Date, endDate: Date;
    if (startParam) {
      startDate = new Date(startParam as string);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    if (endParam) {
      endDate = new Date(endParam as string);
    } else {
      endDate = new Date();
    }

    const accountUrn = `urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`;
    const dateRangeStart = `(day:${startDate.getDate()},month:${startDate.getMonth() + 1},year:${startDate.getFullYear()})`;
    const dateRangeEnd = `(day:${endDate.getDate()},month:${endDate.getMonth() + 1},year:${endDate.getFullYear()})`;

    const url = `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange=(start:${dateRangeStart},end:${dateRangeEnd})&timeGranularity=ALL&accounts=List(${encodeURIComponent(accountUrn)})&fields=impressions,landingPageClicks,costInLocalCurrency&count=1000`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    const data = await response.json();
    if (response.ok) {
      res.json(data);
    } else {
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.get('/api/linkedin/account', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const response = await fetch(
      `https://api.linkedin.com/v2/adAccountsV2/${LINKEDIN_AD_ACCOUNT_ID}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
    );

    const data = await response.json();
    if (response.ok) {
      res.json(data);
    } else {
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Account fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// ============== Prometheus (Mastra) Agent Routes ==============

// Full analysis pipeline with caching
app.post('/api/prometheus/analyze', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  try {
    const { startDate, endDate, sendAlerts = true, forceRefresh = false } = req.body;

    // Default to today if no dates provided
    const today = new Date().toISOString().split('T')[0];
    const effectiveStart = startDate || today;
    const effectiveEnd = endDate || today;

    // Check cache first (unless force refresh requested)
    if (!forceRefresh) {
      const cached = getCachedAnalysis(effectiveStart, effectiveEnd);
      if (cached) {
        console.log(`[API] Returning cached analysis (fetched at ${cached.fetchedAtIST})`);

        // Add cache metadata to response
        const result = {
          ...cached.data,
          _cache: {
            hit: true,
            fetchedAt: cached.fetchedAt,
            fetchedAtIST: cached.fetchedAtIST,
            cacheKey: cached.cacheKey,
          },
        };

        return res.json(result);
      }
    } else {
      console.log('[API] Force refresh requested - bypassing cache');
      invalidateCache(effectiveStart, effectiveEnd);
    }

    // Cache miss or force refresh - run full analysis
    console.log('[API] Running Prometheus analysis...');
    const result = await runPrometheusAnalysis({
      linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
      linkedInAccessToken: accessToken,
      dateRange: { start: effectiveStart, end: effectiveEnd },
    });

    // Store in cache
    const cacheEntry = setCachedAnalysis(effectiveStart, effectiveEnd, result);

    // Add cache metadata to response
    (result as any)._cache = {
      hit: false,
      fetchedAt: cacheEntry.fetchedAt,
      fetchedAtIST: cacheEntry.fetchedAtIST,
      cacheKey: cacheEntry.cacheKey,
    };

    // Check for high cost/resume and send Slack alerts (only for today's data)
    if (sendAlerts && result.report?.matchedCampaigns) {
      const isToday = effectiveStart === effectiveEnd && effectiveStart === today;
      if (isToday) {
        const alertResult = await checkAndAlertHighCosts(result.report.matchedCampaigns);
        if (alertResult.alertsSent > 0) {
          console.log(`[Slack] Sent ${alertResult.alertsSent} cost alerts`);
        }
        // Add alert info to response
        (result as any).alerts = {
          threshold: getAlertThreshold(),
          triggered: alertResult.alertsTriggered.length,
          sent: alertResult.alertsSent,
        };
      }
    }

    res.json(result);
  } catch (error: any) {
    console.error('Prometheus analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

// Cache status endpoint
app.get('/api/prometheus/cache-status', (req, res) => {
  const status = getCacheStatus();
  res.json({
    ...status,
    config: CACHE_CONFIG,
  });
});

// Force clear cache
app.post('/api/prometheus/clear-cache', (req, res) => {
  const { dateRange } = req.body;

  if (dateRange?.start && dateRange?.end) {
    const cleared = invalidateCache(dateRange.start, dateRange.end);
    res.json({ success: true, cleared, message: `Cache cleared for ${dateRange.start} to ${dateRange.end}` });
  } else {
    const count = clearAllCache();
    res.json({ success: true, cleared: count, message: `Cleared all ${count} cache entries` });
  }
});

// Manual Slack alert trigger
app.post('/api/prometheus/send-alert', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await runPrometheusAnalysis({
      linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
      linkedInAccessToken: accessToken,
      dateRange: { start: today, end: today },
    });

    if (result.report?.matchedCampaigns) {
      const alertResult = await checkAndAlertHighCosts(result.report.matchedCampaigns);
      res.json({
        success: true,
        alertsTriggered: alertResult.alertsTriggered.length,
        alertsSent: alertResult.alertsSent,
        threshold: getAlertThreshold(),
      });
    } else {
      res.json({ success: false, message: 'No matched campaigns found' });
    }
  } catch (error: any) {
    console.error('Alert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send daily summary to Slack
app.post('/api/prometheus/send-summary', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await runPrometheusAnalysis({
      linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
      linkedInAccessToken: accessToken,
      dateRange: { start: today, end: today },
    });

    if (result.report) {
      const matched = result.report.matchedCampaigns || [];
      const summary = result.report.summary;

      // Calculate organic vs paid
      const paidResumes = matched.reduce((sum: number, m: any) => sum + m.internal.resumes, 0);
      const organicResumes = summary.totalResumes - paidResumes;

      // Get top and worst performers
      const performers = matched
        .filter((m: any) => m.internal.resumes > 0)
        .sort((a: any, b: any) => a.combined.costPerResume - b.combined.costPerResume);

      const topPerformers = performers.slice(0, 3).map((p: any) => ({
        company: p.linkedin.company,
        role: p.linkedin.role,
        costPerResume: p.combined.costPerResume,
        resumes: p.internal.resumes,
      }));

      const worstPerformers = performers.slice(-3).reverse().map((p: any) => ({
        company: p.linkedin.company,
        role: p.linkedin.role,
        costPerResume: p.combined.costPerResume,
        resumes: p.internal.resumes,
      }));

      const sent = await sendDailySummary({
        totalSpend: summary.totalSpend,
        totalResumes: summary.totalResumes,
        avgCostPerResume: summary.overallCostPerResume,
        paidResumes,
        organicResumes,
        topPerformers,
        worstPerformers,
      });

      res.json({ success: sent, summary });
    } else {
      res.json({ success: false, message: 'No reconciled data found' });
    }
  } catch (error: any) {
    console.error('Summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Daily cost/resume check - runs analysis for each day in range
app.post('/api/prometheus/check-daily', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { startDate, endDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    console.log(`[DailyCheck] Checking daily costs from ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`);

    const dailyData: Array<{
      date: string;
      totalSpend: number;
      paidResumes: number;
      campaigns: Array<{ company: string; role: string; spend: number; resumes: number }>;
    }> = [];

    // Iterate through each day
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];
      console.log(`[DailyCheck] Analyzing ${dateStr}...`);

      try {
        const result = await runPrometheusAnalysis({
          linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
          linkedInAccessToken: accessToken,
          dateRange: { start: dateStr, end: dateStr },
        });

        if (result.report?.matchedCampaigns) {
          const matched = result.report.matchedCampaigns;
          const totalSpend = matched.reduce((sum: number, m: any) => sum + m.linkedin.totalSpend, 0);
          const paidResumes = matched.reduce((sum: number, m: any) => sum + m.internal.resumes, 0);

          dailyData.push({
            date: dateStr,
            totalSpend,
            paidResumes,
            campaigns: matched.map((m: any) => ({
              company: m.linkedin.company,
              role: m.linkedin.role,
              spend: m.linkedin.totalSpend,
              resumes: m.internal.resumes,
            })),
          });
        }
      } catch (dayError) {
        console.error(`[DailyCheck] Error analyzing ${dateStr}:`, dayError);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Check and send alerts
    const alertResult = await checkDailyCosts(dailyData);

    res.json({
      success: true,
      daysAnalyzed: dailyData.length,
      daysExceeded: alertResult.daysExceeded,
      alertsSent: alertResult.alertsSent,
      threshold: getAlertThreshold(),
      dailyData: dailyData.map(d => ({
        date: d.date,
        spend: d.totalSpend,
        resumes: d.paidResumes,
        costPerResume: d.paidResumes > 0 ? d.totalSpend / d.paidResumes : 0,
      })),
    });
  } catch (error: any) {
    console.error('Daily check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Individual tool endpoints (for flexibility)

app.get('/api/prometheus/linkedin-campaigns', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { startDate, endDate } = req.query;
    const dateRange =
      startDate && endDate
        ? { start: startDate as string, end: endDate as string }
        : undefined;

    const result = await fetchLinkedInCampaignsTool.execute!({
      context: {
        accountId: LINKEDIN_AD_ACCOUNT_ID!,
        accessToken,
        dateRange,
        statuses: ['ACTIVE', 'PAUSED'],
      },
    });

    res.json(result);
  } catch (error: any) {
    console.error('LinkedIn campaigns fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prometheus/batch-campaigns', async (req, res) => {
  try {
    const { campaigns } = req.body;

    const result = await batchCampaignsTool.execute!({
      context: { campaigns },
    });

    res.json(result);
  } catch (error: any) {
    console.error('Batch campaigns error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/prometheus/internal-data', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateRange =
      startDate && endDate
        ? { start: startDate as string, end: endDate as string }
        : undefined;

    const result = await fetchInternalDataTool.execute!({
      context: { dateRange },
    });

    res.json(result);
  } catch (error: any) {
    console.error('Internal data fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prometheus/map-reconcile', async (req, res) => {
  try {
    const { batches, internalRoles, ungroupedCampaigns } = req.body;

    const result = await mapAndReconcileTool.execute!({
      context: { batches, internalRoles, ungroupedCampaigns },
    });

    res.json(result);
  } catch (error: any) {
    console.error('Map reconcile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============== Legacy Routes (for backward compatibility) ==============

// Internal API proxy (resumes)
const BACKEND_API_URL = 'https://apis.gvine.app/api/v1/admin-access';
const UNIQUE_ID_RESUMES = 'H1P9Z3M7K6';

app.get('/api/applications', async (req, res) => {
  try {
    const { date } = req.query;
    let url = `${BACKEND_API_URL}/round1-userResume-count/?unique_id=${UNIQUE_ID_RESUMES}`;

    if (date) {
      url += `&created_at=${date}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      res.json(data);
    } else {
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Resumes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    linkedInConnected: !!accessToken,
    adAccountId: LINKEDIN_AD_ACCOUNT_ID,
    mastraEnabled: true,
    authDisabled: process.env.AUTH_DISABLED === 'true',
  });
});

// ============== Serve Frontend in Production ==============

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist');

  // Serve static files
  app.use(express.static(frontendPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendPath, 'index.html'));
    }
  });

  console.log(`📁 Serving frontend from: ${frontendPath}`);
}

// ============== Start Server ==============

app.listen(PORT, () => {
  console.log(`\n🔥 Prometheus server running on http://localhost:${PORT}`);
  console.log(`📊 Mastra agent: Prometheus (LinkedIn Campaign Analyzer)`);
  console.log(`🔗 LinkedIn connected: ${!!accessToken}`);
  console.log(`🔐 Auth: ${process.env.AUTH_DISABLED === 'true' ? 'DISABLED' : 'ENABLED'}`);
  console.log(`📢 Slack alerts: ${process.env.SLACK_WEBHOOK_URL ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  if (!accessToken) {
    console.log(`\n⚠️  To connect LinkedIn, visit:`);
    console.log(`   http://localhost:${PORT}/api/linkedin/auth-url`);
  }
  console.log('\n');
});

// ============== Cron Job: Intelligent Campaign Cost Monitor (Every 2 Hours) ==============

async function runIntelligentCostMonitor() {
  if (!accessToken) {
    console.log('[Monitor] Skipping - LinkedIn not connected');
    return;
  }

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('[Monitor] Skipping - Slack not configured');
    return;
  }

  try {
    const result = await runCampaignCostMonitor(
      LINKEDIN_AD_ACCOUNT_ID!,
      accessToken
    );

    if (result.success) {
      if (result.alertsSent > 0) {
        console.log(`[Monitor] ⚠️ Sent ${result.alertsSent} AI-analyzed alerts`);
      } else if (result.breachedCampaigns > 0) {
        console.log(`[Monitor] ${result.breachedCampaigns} breaches, ${result.alertsSkipped} skipped (dedup)`);
      } else {
        console.log(`[Monitor] ✅ All ${result.campaignsAnalyzed} campaigns within budget`);
      }
    } else {
      console.error('[Monitor] Check failed:', result.error);
    }
  } catch (error) {
    console.error('[Monitor] Error:', error);
  }
}

// Schedule: Every 2 hours (at minute 0)
// Cron expression: '0 */2 * * *' = At minute 0 of every 2nd hour
cron.schedule('0 */2 * * *', () => {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`\n[Monitor] ⏰ Scheduled check triggered at ${time} IST`);
  runIntelligentCostMonitor();
}, {
  timezone: 'Asia/Kolkata'
});

console.log(`⏰ Campaign Monitor: Checking every 2 hours (threshold: ₹${ALERT_CONFIG.cprThreshold}/resume)`);

// Also run once on startup (after 30 seconds delay to let everything initialize)
setTimeout(() => {
  console.log('\n[Monitor] Running initial check...');
  runIntelligentCostMonitor();
}, 30000);

// ============== SCHEDULED SLACK REPORTS ==============

/**
 * Fetch report data for a specific date
 */
async function fetchReportData(dateStr: string): Promise<ScheduledReportData | null> {
  if (!accessToken) {
    console.log('[ScheduledReport] Skipping - LinkedIn not connected');
    return null;
  }

  try {
    const result = await runPrometheusAnalysis({
      linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
      linkedInAccessToken: accessToken,
      dateRange: { start: dateStr, end: dateStr },
    });

    if (!result || !result.batches) {
      console.error('[ScheduledReport] Failed to fetch data');
      return null;
    }

    const { batches: batchData, internal } = result;

    // Calculate totals
    let totalSpend = 0;
    let paidResumes = 0;
    let organicResumes = 0;
    const campaigns: ScheduledReportData['campaigns'] = [];

    for (const batch of batchData.batches) {
      const spend = batch.aggregatedMetrics?.totalSpend || 0;
      totalSpend += spend;

      // Find matching internal data
      const internalMatch = internal?.roles?.find(
        (r: any) => r.companyName?.toLowerCase() === batch.company?.toLowerCase() &&
                    r.jobTitle?.toLowerCase().includes(batch.role?.toLowerCase().substring(0, 10))
      );

      const paid = internalMatch?.resumes || 0;
      paidResumes += paid;

      campaigns.push({
        company: batch.company || 'Unknown',
        role: batch.role || 'Unknown',
        spend,
        paidResumes: paid,
        costPerResume: paid > 0 ? spend / paid : 0,
      });
    }

    // Calculate organic from internal data
    if (internal?.roles) {
      const totalInternal = internal.roles.reduce((sum: number, r: any) => sum + (r.resumes || 0), 0);
      organicResumes = Math.max(0, totalInternal - paidResumes);
    }

    const avgCostPerResume = paidResumes > 0 ? totalSpend / paidResumes : 0;

    return {
      date: dateStr,
      totalSpend,
      paidResumes,
      organicResumes,
      avgCostPerResume,
      campaigns,
    };
  } catch (error) {
    console.error('[ScheduledReport] Error fetching data:', error);
    return null;
  }
}

/**
 * Get yesterday's date string (IST)
 */
function getYesterdayIST(): string {
  const now = new Date();
  // Convert to IST
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  istNow.setDate(istNow.getDate() - 1);
  return istNow.toISOString().split('T')[0];
}

/**
 * Get today's date string (IST)
 */
function getTodayIST(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.toISOString().split('T')[0];
}

/**
 * 8:30 AM - Morning Summary (Yesterday's data)
 */
async function runMorningSummary() {
  console.log('[ScheduledReport] ☀️ Running Morning Summary...');

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('[ScheduledReport] Skipping - Slack not configured');
    return;
  }

  const yesterday = getYesterdayIST();
  const data = await fetchReportData(yesterday);

  if (data) {
    await sendMorningSummary(data);
    console.log('[ScheduledReport] ☀️ Morning Summary sent');
  }
}

/**
 * 12 PM, 3 PM, 6 PM, 9 PM - Status Update with Alerts
 */
async function runStatusUpdate() {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`[ScheduledReport] 🕐 Running Status Update at ${time}...`);

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('[ScheduledReport] Skipping - Slack not configured');
    return;
  }

  const today = getTodayIST();
  const data = await fetchReportData(today);

  if (data) {
    await sendStatusUpdate(data);
    console.log('[ScheduledReport] 🕐 Status Update sent');
  }
}

/**
 * Midnight - End of Day Summary
 */
async function runEndOfDaySummary() {
  console.log('[ScheduledReport] 🌙 Running End of Day Summary...');

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('[ScheduledReport] Skipping - Slack not configured');
    return;
  }

  // At midnight, we want to summarize the day that just ended
  const yesterday = getYesterdayIST();
  const data = await fetchReportData(yesterday);

  if (data) {
    await sendEndOfDaySummary(data);
    console.log('[ScheduledReport] 🌙 End of Day Summary sent');
  }
}

// Schedule: Check every 3 hours during work hours (9 AM to 9 PM IST)
// Only sends alert if there are critical campaigns (CPR > ₹400 or 0 resumes with high spend)
cron.schedule('0 9,12,15,18,21 * * *', runStatusUpdate, { timezone: 'Asia/Kolkata' });

console.log(`📅 Scheduled Alerts: Every 3 hours (9 AM - 9 PM IST) - only alerts if campaigns exceed threshold`);

// ============== Test Endpoints for Scheduled Reports ==============

app.post('/api/prometheus/test-morning-summary', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  try {
    await runMorningSummary();
    res.json({ success: true, message: 'Morning summary sent to Slack' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send morning summary' });
  }
});

app.post('/api/prometheus/test-status-update', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  try {
    await runStatusUpdate();
    res.json({ success: true, message: 'Status update sent to Slack' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send status update' });
  }
});

app.post('/api/prometheus/test-eod-summary', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  try {
    await runEndOfDaySummary();
    res.json({ success: true, message: 'End of day summary sent to Slack' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send EOD summary' });
  }
});

// ============== Monitor Status Endpoint ==============

app.get('/api/prometheus/monitor-status', (req, res) => {
  const status = getMonitorStatus();
  res.json({
    ...status,
    nextScheduledRun: 'Every 2 hours at :00',
    linkedInConnected: !!accessToken,
    slackConfigured: !!process.env.SLACK_WEBHOOK_URL,
  });
});

// Manual trigger for the intelligent monitor
app.post('/api/prometheus/run-monitor', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  try {
    const result = await runCampaignCostMonitor(
      LINKEDIN_AD_ACCOUNT_ID!,
      accessToken
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============== Mapping Approval Endpoints ==============

// Get all mappings with their approval status
app.get('/api/prometheus/mappings', (req, res) => {
  const rules = exportRules();
  const mappings = Object.entries(rules.manualMappings).map(([campaignName, mapping]) => ({
    campaignName,
    ...mapping,
  }));

  res.json({
    total: mappings.length,
    approved: mappings.filter(m => m.approved).length,
    pending: mappings.filter(m => !m.approved && !m.rejected).length,
    rejected: mappings.filter(m => m.rejected).length,
    mappings,
    lastUpdated: rules.lastUpdated,
  });
});

// Get pending mappings (need approval)
app.get('/api/prometheus/mappings/pending', (req, res) => {
  const pending = getPendingMappings();
  res.json({ count: pending.length, mappings: pending });
});

// Get approved mappings (locked)
app.get('/api/prometheus/mappings/approved', (req, res) => {
  const approved = getApprovedMappings();
  res.json({ count: approved.length, mappings: approved });
});

// Get rejected mappings
app.get('/api/prometheus/mappings/rejected', (req, res) => {
  const rejected = getRejectedMappings();
  res.json({ count: rejected.length, mappings: rejected });
});

// Approve a single mapping (locks it forever)
app.post('/api/prometheus/mappings/approve', (req, res) => {
  const { campaignName } = req.body;

  if (!campaignName) {
    return res.status(400).json({ error: 'campaignName is required' });
  }

  const success = approveMapping(campaignName);

  if (success) {
    res.json({ success: true, message: `Mapping approved and locked: ${campaignName}` });
  } else {
    res.status(400).json({ error: 'Failed to approve mapping - not found' });
  }
});

// Approve all mappings in a batch (by batchId)
app.post('/api/prometheus/mappings/approve-batch', (req, res) => {
  const { batchId } = req.body;

  if (!batchId) {
    return res.status(400).json({ error: 'batchId is required' });
  }

  const count = approveBatch(batchId);
  res.json({ success: true, approvedCount: count, message: `Approved ${count} mappings for batch: ${batchId}` });
});

// Reject a mapping with AI analysis for correction suggestions
app.post('/api/prometheus/mappings/reject', async (req, res) => {
  const { campaignName, reason } = req.body;

  if (!campaignName) {
    return res.status(400).json({ error: 'campaignName is required' });
  }

  if (!reason) {
    return res.status(400).json({ error: 'reason is required for rejection' });
  }

  // First, mark the mapping as rejected
  const success = rejectMapping(campaignName, reason);

  if (!success) {
    return res.status(400).json({ error: 'Failed to reject mapping - not found or already approved' });
  }

  // Now run AI analysis to generate correction suggestions
  console.log('[API] Running AI analysis for rejected mapping:', campaignName);

  try {
    const rules = loadBatchingRules();
    const mapping = rules.manualMappings[campaignName];

    if (!mapping) {
      return res.json({
        success: true,
        message: `Mapping rejected: ${campaignName}`,
        suggestions: [],
      });
    }

    const suggestions = await analyzeRejectedMapping(
      campaignName,
      mapping,
      reason,
      rules.manualMappings
    );

    res.json({
      success: true,
      message: `Mapping rejected: ${campaignName}. AI generated ${suggestions.length} correction suggestions.`,
      suggestions,
    });
  } catch (error: any) {
    console.error('[API] AI analysis error:', error);
    res.json({
      success: true,
      message: `Mapping rejected: ${campaignName}. AI analysis failed.`,
      suggestions: [],
      error: error.message,
    });
  }
});

// Update a mapping (manually correct it)
app.post('/api/prometheus/mappings/update', (req, res) => {
  const { campaignName, company, role, batchId } = req.body;

  if (!campaignName || !company || !role) {
    return res.status(400).json({ error: 'campaignName, company, and role are required' });
  }

  const success = updateMapping(campaignName, company, role, batchId);

  if (success) {
    res.json({ success: true, message: `Mapping updated: ${campaignName} → ${company} | ${role}` });
  } else {
    res.status(400).json({ error: 'Failed to update mapping - already approved (locked)' });
  }
});

// Apply an AI suggestion to fix a rejected mapping
app.post('/api/prometheus/mappings/apply-suggestion', (req, res) => {
  const { suggestion } = req.body as { suggestion: MappingCorrectionSuggestion };

  if (!suggestion || !suggestion.campaignName || !suggestion.action) {
    return res.status(400).json({ error: 'Valid suggestion object is required' });
  }

  const success = applySuggestion(suggestion);

  if (success) {
    res.json({
      success: true,
      message: `Applied ${suggestion.action}: ${suggestion.campaignName} → ${suggestion.suggestedCompany || suggestion.currentCompany} | ${suggestion.suggestedRole || suggestion.currentRole}`,
    });
  } else {
    res.status(400).json({ error: 'Failed to apply suggestion' });
  }
});
