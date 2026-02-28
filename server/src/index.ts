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
import { login, authMiddleware, type AuthRequest } from './lib/auth.js';
import { checkAndAlertHighCosts, sendDailySummary, getAlertThreshold } from './lib/slack.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '..', '.token.json');

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth middleware to all /api routes except login and health
app.use('/api', (req, res, next) => {
  // Skip auth for these routes
  const publicRoutes = ['/api/auth/login', '/api/health', '/api/linkedin/auth-url', '/api/linkedin/token', '/api/linkedin/set-token'];
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

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const result = login(username, password);

  if (result.success) {
    res.json({ token: result.token });
  } else {
    res.status(401).json({ error: result.error });
  }
});

app.get('/api/auth/verify', (req: AuthRequest, res) => {
  // If we get here, the auth middleware has already verified the token
  res.json({ valid: true, user: req.user });
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

// Full analysis pipeline
app.post('/api/prometheus/analyze', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  try {
    const { startDate, endDate, sendAlerts = true } = req.body;

    const dateRange = startDate && endDate ? { start: startDate, end: endDate } : undefined;

    console.log('[API] Running Prometheus analysis...');
    const result = await runPrometheusAnalysis({
      linkedInAccountId: LINKEDIN_AD_ACCOUNT_ID!,
      linkedInAccessToken: accessToken,
      dateRange,
    });

    // Check for high cost/resume and send Slack alerts (only for today's data)
    if (sendAlerts && result.report?.matchedCampaigns) {
      const isToday = startDate === endDate && startDate === new Date().toISOString().split('T')[0];
      if (isToday || !startDate) {
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
