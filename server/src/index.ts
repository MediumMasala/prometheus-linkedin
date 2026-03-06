import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPrometheusAnalysis } from './mastra/index.js';
import { fetchLinkedInCampaignsTool } from './mastra/tools/fetchLinkedInCampaigns.js';
import { clearLinkedInCache } from './lib/linkedin-api.js';
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
// Video pipeline imports removed - will be added in separate deployment
// import { ... } from './lib/video-pipeline.js';
import {
  getCachedAnalysis,
  setCachedAnalysis,
  invalidateCache,
  clearAllCache,
  getCacheStatus,
  CACHE_CONFIG,
} from './lib/analysis-cache.js';
import cron from 'node-cron';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '..', '.token.json');

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth middleware to all /api routes except login and health
app.use('/api', (req, res, next) => {
  // Skip auth for these routes (use req.path which is relative to /api mount point)
  const publicRoutes = ['/auth/login', '/health', '/linkedin/auth-url', '/linkedin/token', '/linkedin/set-token', '/test/create-campaign', '/test/campaign-by-name', '/test/copy-targeting'];
  if (publicRoutes.includes(req.path)) {
    return next();
  }
  return authMiddleware(req as AuthRequest, res, next);
});

const {
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  LINKEDIN_AD_ACCOUNT_ID,
  TAL_LINKEDIN_AD_ACCOUNT_ID,
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
  const scopes = ['r_ads', 'r_ads_reporting', 'rw_ads'].join('%20');
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

// ============== LinkedIn Campaign Management Routes ==============

// Get single campaign details
app.get('/api/linkedin/campaigns/:id', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const response = await fetch(
      `https://api.linkedin.com/v2/adCampaignsV2/${id}`,
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
    console.error('Campaign fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Update campaign status (pause/activate)
app.patch('/api/linkedin/campaigns/:id/status', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIVE', 'PAUSED', 'ARCHIVED', 'CANCELED'

    if (!['ACTIVE', 'PAUSED', 'ARCHIVED', 'CANCELED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: ACTIVE, PAUSED, ARCHIVED, or CANCELED' });
    }

    const response = await fetch(
      `https://api.linkedin.com/v2/adCampaignsV2/${id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
          'X-RestLi-Method': 'PARTIAL_UPDATE',
        },
        body: JSON.stringify({
          patch: {
            $set: { status }
          }
        }),
      }
    );

    if (response.ok) {
      // Clear campaign cache after update
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: `Campaign ${id} status updated to ${status}` });
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Campaign status update error:', error);
    res.status(500).json({ error: 'Failed to update campaign status' });
  }
});

// Update campaign bid
app.patch('/api/linkedin/campaigns/:id/bid', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { bidAmount, bidType } = req.body; // bidAmount in micros (e.g., 5000000 = ₹5), bidType: 'CPM', 'CPC', etc.

    const updateFields: any = {};
    if (bidAmount !== undefined) {
      updateFields.unitCost = {
        amount: String(bidAmount),
        currencyCode: 'INR'
      };
    }
    if (bidType) {
      updateFields.costType = bidType; // 'CPM', 'CPC', 'CPV'
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'Provide bidAmount and/or bidType' });
    }

    const response = await fetch(
      `https://api.linkedin.com/v2/adCampaignsV2/${id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
          'X-RestLi-Method': 'PARTIAL_UPDATE',
        },
        body: JSON.stringify({
          patch: {
            $set: updateFields
          }
        }),
      }
    );

    if (response.ok) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: `Campaign ${id} bid updated` });
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Campaign bid update error:', error);
    res.status(500).json({ error: 'Failed to update campaign bid' });
  }
});

// Update campaign budget
app.patch('/api/linkedin/campaigns/:id/budget', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { dailyBudget, totalBudget } = req.body; // in micros (e.g., 50000000 = ₹50)

    const updateFields: any = {};
    if (dailyBudget !== undefined) {
      updateFields.dailyBudget = {
        amount: String(dailyBudget),
        currencyCode: 'INR'
      };
    }
    if (totalBudget !== undefined) {
      updateFields.totalBudget = {
        amount: String(totalBudget),
        currencyCode: 'INR'
      };
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'Provide dailyBudget and/or totalBudget' });
    }

    const response = await fetch(
      `https://api.linkedin.com/v2/adCampaignsV2/${id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
          'X-RestLi-Method': 'PARTIAL_UPDATE',
        },
        body: JSON.stringify({
          patch: {
            $set: updateFields
          }
        }),
      }
    );

    if (response.ok) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: `Campaign ${id} budget updated` });
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Campaign budget update error:', error);
    res.status(500).json({ error: 'Failed to update campaign budget' });
  }
});

// Update campaign targeting
app.patch('/api/linkedin/campaigns/:id/targeting', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { targetingCriteria } = req.body;

    // targetingCriteria should be in LinkedIn's format, e.g.:
    // {
    //   include: {
    //     and: [
    //       { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:102713980"] } },
    //       { or: { "urn:li:adTargetingFacet:interfaceLocales": ["urn:li:locale:en_US"] } }
    //     ]
    //   }
    // }

    if (!targetingCriteria) {
      return res.status(400).json({ error: 'Provide targetingCriteria object' });
    }

    const response = await fetch(
      `https://api.linkedin.com/v2/adCampaignsV2/${id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
          'X-RestLi-Method': 'PARTIAL_UPDATE',
        },
        body: JSON.stringify({
          patch: {
            $set: { targetingCriteria }
          }
        }),
      }
    );

    if (response.ok) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: `Campaign ${id} targeting updated` });
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Campaign targeting update error:', error);
    res.status(500).json({ error: 'Failed to update campaign targeting' });
  }
});

// Create a new campaign (for testing write access)
app.post('/api/linkedin/campaigns', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { name, campaignGroupId, dailyBudget = 50000000 } = req.body; // dailyBudget in micros (50000000 = ₹50)

    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    // First, get campaign groups if not provided
    let groupId = campaignGroupId;
    if (!groupId) {
      const groupsUrl = `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search&search=(account:(values:List(urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID})))&count=1`;
      const groupsRes = await fetch(groupsUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      const groupsData = await groupsRes.json();
      if (groupsData.elements && groupsData.elements.length > 0) {
        groupId = groupsData.elements[0].id;
      } else {
        return res.status(400).json({ error: 'No campaign group found. Create one first.' });
      }
    }

    const campaignData = {
      account: `urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`,
      campaignGroup: `urn:li:sponsoredCampaignGroup:${groupId}`,
      name: name,
      status: 'PAUSED', // Create as PAUSED so it doesn't spend
      type: 'SPONSORED_UPDATES',
      costType: 'CPM',
      dailyBudget: {
        amount: String(dailyBudget),
        currencyCode: 'INR'
      },
      unitCost: {
        amount: '100000000', // ₹100 CPM
        currencyCode: 'INR'
      },
      objectiveType: 'BRAND_AWARENESS',
      targetingCriteria: {
        include: {
          and: [
            {
              or: {
                'urn:li:adTargetingFacet:locations': ['urn:li:geo:102713980'] // India
              }
            }
          ]
        }
      },
      locale: {
        country: 'IN',
        language: 'en'
      }
    };

    const response = await fetch('https://api.linkedin.com/v2/adCampaignsV2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(campaignData),
    });

    const data = await response.json();

    if (response.ok) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: `Campaign "${name}" created`, data });
    } else {
      console.error('Campaign creation error:', data);
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Campaign creation error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// ============== LinkedIn Campaign Groups ==============

// Get all campaign groups
app.get('/api/linkedin/campaign-groups', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const url = `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search&search=(account:(values:List(${accountUrn})))&count=100`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Campaign groups fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign groups' });
  }
});

// Create campaign group
app.post('/api/linkedin/campaign-groups', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { name, status = 'ACTIVE', totalBudget, runSchedule } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Campaign group name is required' });
    }

    const groupData: any = {
      account: `urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`,
      name,
      status,
    };

    if (totalBudget) {
      groupData.totalBudget = { amount: String(totalBudget), currencyCode: 'INR' };
    }
    if (runSchedule) {
      groupData.runSchedule = runSchedule;
    }

    const response = await fetch('https://api.linkedin.com/v2/adCampaignGroupsV2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(groupData),
    });

    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : null;

    if (response.ok || response.status === 201) {
      res.json({ success: true, message: `Campaign group "${name}" created`, data });
    } else {
      res.status(response.status).json({ error: 'Failed to create campaign group', details: data });
    }
  } catch (error) {
    console.error('Campaign group creation error:', error);
    res.status(500).json({ error: 'Failed to create campaign group' });
  }
});

// Update campaign group
app.patch('/api/linkedin/campaign-groups/:id', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { name, status, totalBudget } = req.body;

    const updateFields: any = {};
    if (name) updateFields.name = name;
    if (status) updateFields.status = status;
    if (totalBudget) updateFields.totalBudget = { amount: String(totalBudget), currencyCode: 'INR' };

    const response = await fetch(`https://api.linkedin.com/v2/adCampaignGroupsV2/${id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
        'X-RestLi-Method': 'PARTIAL_UPDATE',
      },
      body: JSON.stringify({ patch: { $set: updateFields } }),
    });

    if (response.ok || response.status === 204) {
      res.json({ success: true, message: `Campaign group ${id} updated` });
    } else {
      const data = await response.text();
      res.status(response.status).json({ error: 'Failed to update campaign group', details: data });
    }
  } catch (error) {
    console.error('Campaign group update error:', error);
    res.status(500).json({ error: 'Failed to update campaign group' });
  }
});

// ============== LinkedIn Creatives ==============

// Get creatives for a campaign
app.get('/api/linkedin/campaigns/:campaignId/creatives', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { campaignId } = req.params;
    const campaignUrn = encodeURIComponent(`urn:li:sponsoredCampaign:${campaignId}`);
    const url = `https://api.linkedin.com/v2/adCreativesV2?q=search&search=(campaign:(values:List(${campaignUrn})))&count=100`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Creatives fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch creatives' });
  }
});

// Get all creatives for account
app.get('/api/linkedin/creatives', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const url = `https://api.linkedin.com/v2/adCreativesV2?q=search&search=(account:(values:List(${accountUrn})))&count=100`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Creatives fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch creatives' });
  }
});

// Update creative status
app.patch('/api/linkedin/creatives/:id/status', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { status } = req.body; // ACTIVE, PAUSED, ARCHIVED

    const response = await fetch(`https://api.linkedin.com/v2/adCreativesV2/${id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
        'X-RestLi-Method': 'PARTIAL_UPDATE',
      },
      body: JSON.stringify({ patch: { $set: { status } } }),
    });

    if (response.ok || response.status === 204) {
      res.json({ success: true, message: `Creative ${id} status updated to ${status}` });
    } else {
      const data = await response.text();
      res.status(response.status).json({ error: 'Failed to update creative', details: data });
    }
  } catch (error) {
    console.error('Creative update error:', error);
    res.status(500).json({ error: 'Failed to update creative' });
  }
});

// ============== LinkedIn Bulk Operations ==============

// Bulk update campaign statuses
app.post('/api/linkedin/campaigns/bulk-status', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { campaignIds, status } = req.body; // campaignIds: string[], status: ACTIVE/PAUSED/ARCHIVED

    if (!campaignIds || !Array.isArray(campaignIds) || !status) {
      return res.status(400).json({ error: 'Provide campaignIds array and status' });
    }

    const results = [];
    for (const id of campaignIds) {
      try {
        const response = await fetch(`https://api.linkedin.com/v2/adCampaignsV2/${id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
            'X-RestLi-Method': 'PARTIAL_UPDATE',
          },
          body: JSON.stringify({ patch: { $set: { status } } }),
        });
        results.push({ id, success: response.ok || response.status === 204 });
      } catch (e) {
        results.push({ id, success: false, error: String(e) });
      }
    }

    legacyCampaignCache = { data: null, timestamp: 0 };
    res.json({ success: true, results });
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(500).json({ error: 'Failed to bulk update campaigns' });
  }
});

// Duplicate a campaign
app.post('/api/linkedin/campaigns/:id/duplicate', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { newName } = req.body;

    // Get source campaign
    const sourceRes = await fetch(`https://api.linkedin.com/v2/adCampaignsV2/${id}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const sourceCampaign = await sourceRes.json();

    if (!sourceCampaign.id) {
      return res.status(404).json({ error: 'Source campaign not found' });
    }

    // Create new campaign with same settings
    const newCampaign: any = {
      account: sourceCampaign.account,
      campaignGroup: sourceCampaign.campaignGroup,
      name: newName || `${sourceCampaign.name} (Copy)`,
      status: 'PAUSED', // Always create as paused
      type: sourceCampaign.type,
      costType: sourceCampaign.costType,
      objectiveType: sourceCampaign.objectiveType,
      targetingCriteria: sourceCampaign.targetingCriteria,
      locale: sourceCampaign.locale,
    };

    if (sourceCampaign.dailyBudget) newCampaign.dailyBudget = sourceCampaign.dailyBudget;
    if (sourceCampaign.unitCost) newCampaign.unitCost = sourceCampaign.unitCost;
    if (sourceCampaign.runSchedule) {
      newCampaign.runSchedule = {
        start: Date.now(),
        end: sourceCampaign.runSchedule.end
      };
    }

    const response = await fetch('https://api.linkedin.com/v2/adCampaignsV2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newCampaign),
    });

    const responseText = await response.text();
    let data = null;
    try { data = JSON.parse(responseText); } catch (e) {}

    if (response.ok || response.status === 201) {
      const newId = response.headers.get('x-restli-id') || data?.id;
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({ success: true, message: 'Campaign duplicated', newCampaignId: newId, data });
    } else {
      res.status(response.status).json({ error: 'Failed to duplicate campaign', details: data || responseText });
    }
  } catch (error) {
    console.error('Campaign duplicate error:', error);
    res.status(500).json({ error: 'Failed to duplicate campaign' });
  }
});

// ============== LinkedIn Targeting Facets ==============

// Get available targeting facets (for UI)
app.get('/api/linkedin/targeting/facets', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Return list of available targeting facet types
  res.json({
    facets: [
      { id: 'locations', name: 'Locations', urn: 'urn:li:adTargetingFacet:locations' },
      { id: 'profileLocations', name: 'Profile Locations', urn: 'urn:li:adTargetingFacet:profileLocations' },
      { id: 'interfaceLocales', name: 'Interface Locales', urn: 'urn:li:adTargetingFacet:interfaceLocales' },
      { id: 'employers', name: 'Current Employers', urn: 'urn:li:adTargetingFacet:employers' },
      { id: 'employersAll', name: 'Current or Past Employers', urn: 'urn:li:adTargetingFacet:employersAll' },
      { id: 'titles', name: 'Job Titles', urn: 'urn:li:adTargetingFacet:titles' },
      { id: 'titlesAll', name: 'Current or Past Titles', urn: 'urn:li:adTargetingFacet:titlesAll' },
      { id: 'skills', name: 'Skills', urn: 'urn:li:adTargetingFacet:skills' },
      { id: 'industries', name: 'Industries', urn: 'urn:li:adTargetingFacet:industries' },
      { id: 'seniorities', name: 'Seniority Levels', urn: 'urn:li:adTargetingFacet:seniorities' },
      { id: 'functions', name: 'Job Functions', urn: 'urn:li:adTargetingFacet:functions' },
      { id: 'yearsOfExperienceRanges', name: 'Years of Experience', urn: 'urn:li:adTargetingFacet:yearsOfExperienceRanges' },
      { id: 'degrees', name: 'Degrees', urn: 'urn:li:adTargetingFacet:degrees' },
      { id: 'fieldsOfStudy', name: 'Fields of Study', urn: 'urn:li:adTargetingFacet:fieldsOfStudy' },
      { id: 'schools', name: 'Schools', urn: 'urn:li:adTargetingFacet:schools' },
      { id: 'companySize', name: 'Company Size', urn: 'urn:li:adTargetingFacet:staffCountRanges' },
      { id: 'age', name: 'Age Ranges', urn: 'urn:li:adTargetingFacet:ageRanges' },
      { id: 'gender', name: 'Gender', urn: 'urn:li:adTargetingFacet:genders' },
    ]
  });
});

// Search for targeting entities (companies, titles, skills, etc.)
app.get('/api/linkedin/targeting/search', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { facet, query } = req.query;

    if (!facet || !query) {
      return res.status(400).json({ error: 'Provide facet and query params' });
    }

    // Use typeahead endpoint for searching
    const url = `https://api.linkedin.com/v2/adTargetingFacets?q=typeahead&queryTerm=${encodeURIComponent(query as string)}&facet=urn:li:adTargetingFacet:${facet}&count=20`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Targeting search error:', error);
    res.status(500).json({ error: 'Failed to search targeting' });
  }
});

// ============== LinkedIn Reporting ==============

// Get campaign performance breakdown by day
app.get('/api/linkedin/campaigns/:id/performance', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();

    const dateRangeStart = `(day:${start.getDate()},month:${start.getMonth() + 1},year:${start.getFullYear()})`;
    const dateRangeEnd = `(day:${end.getDate()},month:${end.getMonth() + 1},year:${end.getFullYear()})`;
    const campaignUrn = encodeURIComponent(`urn:li:sponsoredCampaign:${id}`);

    const url = `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange=(start:${dateRangeStart},end:${dateRangeEnd})&timeGranularity=DAILY&campaigns=List(${campaignUrn})&fields=impressions,clicks,landingPageClicks,costInLocalCurrency,shares,comments,likes,follows`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Campaign performance error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign performance' });
  }
});

// Get creative-level analytics
app.get('/api/linkedin/analytics/by-creative', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { startDate, endDate, campaignId } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();

    const dateRangeStart = `(day:${start.getDate()},month:${start.getMonth() + 1},year:${start.getFullYear()})`;
    const dateRangeEnd = `(day:${end.getDate()},month:${end.getMonth() + 1},year:${end.getFullYear()})`;

    let url = `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CREATIVE&dateRange=(start:${dateRangeStart},end:${dateRangeEnd})&timeGranularity=ALL&fields=impressions,clicks,landingPageClicks,costInLocalCurrency`;

    if (campaignId) {
      const campaignUrn = encodeURIComponent(`urn:li:sponsoredCampaign:${campaignId}`);
      url += `&campaigns=List(${campaignUrn})`;
    } else {
      const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
      url += `&accounts=List(${accountUrn})`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Creative analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch creative analytics' });
  }
});

// ============== LinkedIn Conversions ==============

// Get conversion events
app.get('/api/linkedin/conversions', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const url = `https://api.linkedin.com/v2/conversions?q=account&account=${accountUrn}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Conversions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});

// ============== LinkedIn Audience (Matched Audiences) ==============

// Get matched audiences
app.get('/api/linkedin/audiences', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const url = `https://api.linkedin.com/v2/dmpSegments?q=account&account=${accountUrn}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Audiences fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch audiences' });
  }
});

// ============== LinkedIn Forms ==============

// Get lead gen forms
app.get('/api/linkedin/forms', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const url = `https://api.linkedin.com/v2/adForms?q=account&account=${accountUrn}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Forms fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// Get form submissions
app.get('/api/linkedin/forms/:formId/submissions', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { formId } = req.params;
    const formUrn = encodeURIComponent(`urn:li:leadGenForm:${formId}`);
    const url = `https://api.linkedin.com/v2/adFormResponses?q=form&form=${formUrn}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Form submissions error:', error);
    res.status(500).json({ error: 'Failed to fetch form submissions' });
  }
});

// ============== Tal LinkedIn Routes ==============

// Tal campaign cache
let talCampaignCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };

app.get('/api/tal/linkedin/campaigns', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  const now = Date.now();
  if (talCampaignCache.data && now - talCampaignCache.timestamp < LEGACY_CACHE_TTL) {
    return res.json(talCampaignCache.data);
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${TAL_LINKEDIN_AD_ACCOUNT_ID}`);
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
    talCampaignCache = { data: result, timestamp: now };
    res.json(result);
  } catch (error) {
    console.error('Tal campaigns fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Tal campaigns' });
  }
});

app.get('/api/tal/linkedin/analytics', async (req, res) => {
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

    const accountUrn = `urn:li:sponsoredAccount:${TAL_LINKEDIN_AD_ACCOUNT_ID}`;
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
    console.error('Tal analytics fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Tal analytics' });
  }
});

app.get('/api/tal/linkedin/account', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const response = await fetch(
      `https://api.linkedin.com/v2/adAccountsV2/${TAL_LINKEDIN_AD_ACCOUNT_ID}`,
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
    console.error('Tal account fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Tal account' });
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
      console.log('[API] Force refresh requested - clearing all caches');
      invalidateCache(effectiveStart, effectiveEnd);
      clearLinkedInCache(); // Also clear LinkedIn API cache
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

// Get resume data by company and role with date range support
app.get('/api/resumes/by-role', async (req, res) => {
  try {
    const { company, role, startDate, endDate } = req.query;

    if (!company || !role) {
      return res.status(400).json({ error: 'Company and role are required' });
    }

    const companyLower = (company as string).toLowerCase().trim();
    const roleLower = (role as string).toLowerCase().trim();

    // Helper to filter and aggregate data
    const filterAndAggregate = (data: any[]) => {
      // Find matching entries - check both company_name and job_title
      const matches = data.filter((item: any) => {
        const itemCompany = (item.company_name || '').toLowerCase().trim();
        const itemRole = (item.job_title || '').toLowerCase().trim();

        // Check if company matches
        const companyMatch = itemCompany.includes(companyLower) || companyLower.includes(itemCompany);

        // Check if role matches (also check if job_title contains company name prefix)
        const roleMatch =
          itemRole.includes(roleLower) ||
          roleLower.includes(itemRole) ||
          itemRole.replace(companyLower, '').trim().includes(roleLower) ||
          roleLower.includes(itemRole.replace(companyLower, '').trim());

        return companyMatch && roleMatch;
      });

      if (matches.length > 0) {
        return matches.reduce(
          (acc: any, item: any) => ({
            count: acc.count + (item.count || 0),
            tier1_count: acc.tier1_count + (item.tier1_count || 0),
            non_tier1_count: acc.non_tier1_count + (item.non_tier1_count || 0),
            supreme_count: acc.supreme_count + (item.supreme_count || 0),
          }),
          { count: 0, tier1_count: 0, non_tier1_count: 0, supreme_count: 0 }
        );
      }

      // Try broader company-only match
      const companyMatches = data.filter((item: any) => {
        const itemCompany = (item.company_name || '').toLowerCase().trim();
        return itemCompany.includes(companyLower) || companyLower.includes(itemCompany);
      });

      if (companyMatches.length > 0) {
        return companyMatches.reduce(
          (acc: any, item: any) => ({
            count: acc.count + (item.count || 0),
            tier1_count: acc.tier1_count + (item.tier1_count || 0),
            non_tier1_count: acc.non_tier1_count + (item.non_tier1_count || 0),
            supreme_count: acc.supreme_count + (item.supreme_count || 0),
          }),
          { count: 0, tier1_count: 0, non_tier1_count: 0, supreme_count: 0 }
        );
      }

      return { count: 0, tier1_count: 0, non_tier1_count: 0, supreme_count: 0 };
    };

    // If date range provided, fetch day by day
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      const aggregated = { count: 0, tier1_count: 0, non_tier1_count: 0, supreme_count: 0 };

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const url = `${BACKEND_API_URL}/round1-userResume-count/?unique_id=${UNIQUE_ID_RESUMES}&created_at=${dateStr}`;

        try {
          const response = await fetch(url);
          const data = await response.json();

          if (response.ok && data.data) {
            const dayResult = filterAndAggregate(data.data);
            aggregated.count += dayResult.count;
            aggregated.tier1_count += dayResult.tier1_count;
            aggregated.non_tier1_count += dayResult.non_tier1_count;
            aggregated.supreme_count += dayResult.supreme_count;
          }
        } catch (err) {
          console.error(`Error fetching data for ${dateStr}:`, err);
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return res.json(aggregated);
    }

    // No date range - fetch all time
    const url = `${BACKEND_API_URL}/round1-userResume-count/?unique_id=${UNIQUE_ID_RESUMES}`;
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data.data) {
      res.json(filterAndAggregate(data.data));
    } else {
      res.json({ count: 0, tier1_count: 0, non_tier1_count: 0, supreme_count: 0 });
    }
  } catch (error) {
    console.error('Resume by role fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch resume data' });
  }
});

// ============== Messaging API ==============

// Generate client message using Gemini
app.post('/api/messaging/generate', async (req, res) => {
  try {
    const { company, role, metrics, dateRange } = req.body;

    if (!company || !role) {
      return res.status(400).json({ error: 'Company and role are required' });
    }

    // Initialize Gemini
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      console.warn('Gemini API key not configured, using fallback');
      return res.status(503).json({ error: 'Gemini not configured' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

    // Calculate timeframe
    const daysDiff = dateRange?.startDate && dateRange?.endDate
      ? Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
      : 3;
    const timeframe = daysDiff <= 1 ? 'today' : `in the last ${daysDiff} days`;

    // Top Indian startups/companies for credibility (randomly pick 2-3)
    const topCompanies = [
      'Razorpay', 'Zerodha', 'CRED', 'PhonePe', 'Swiggy', 'Zomato', 'Flipkart',
      'Meesho', 'Groww', 'Slice', 'Jupiter', 'Paytm', 'Dream11', 'ShareChat',
      'Unacademy', 'upGrad', 'Vedantu', 'Ola', 'Urban Company',
      'Nykaa', 'BigBasket', 'Dunzo', 'Rapido', 'Lenskart', 'BoAt', 'Mamaearth',
      'Freshworks', 'Chargebee', 'Postman', 'BrowserStack', 'Hasura', 'Polygon'
    ];

    // Pick 3 random companies
    const shuffled = topCompanies.sort(() => 0.5 - Math.random());
    const selectedCompanies = shuffled.slice(0, 3);

    // Format resume count based on rules
    const resumeCount = metrics?.totalResumes || 0;
    const resumeText = resumeCount < 10 ? 'a couple of resumes' : `${resumeCount} resumes`;

    const prompt = `You are a messaging assistant for Round1, a hiring platform. Generate a client update message for an active role.

INPUTS:
- Company name: ${company}
- Role title: ${role}
- Number of resumes received: ${resumeCount}
- Number of impressions: ${metrics?.impressions || 0}
- Number of landing page visitors: ${metrics?.landingPageClicks || 0}
- Number of days since role went live: ${daysDiff}
- Top company names candidates are from: ${selectedCompanies.join(', ')}

STRICT RULES - FOLLOW EXACTLY:
1. NEVER mention LinkedIn or any specific acquisition channel. Use vague terms like "our candidate channels", "our candidate network", "our outreach channels".
2. If resumes < 10, say "a couple of resumes" instead of the exact number. If resumes >= 10, show the actual number. Use this: "${resumeText}"
3. Always mention 2-3 top Indian startup/company names that candidates are coming from to build credibility. Frame it as: "We're seeing interest from engineers at [Company1], [Company2], and [Company3]."
4. NEVER use em dashes (—). Use commas or periods instead.
5. Lead with resumes in the stats, impressions last.
6. Include a line about evaluating resumes and sharing shortlisted profiles soon.
7. Frame the update as "behind the scenes" work to show momentum and velocity.
8. Keep the tone professional, confident, and concise.
9. Sign off as "Team Round1".
10. Do not include a subject line.
11. Use bullet points with • symbol, not dashes.
12. Only include metrics that have non-zero values.

OUTPUT: Generate a single ready-to-send message following all rules above.`;

    const result = await model.generateContent(prompt);
    const message = result.response.text();

    res.json({ message, company, role, metrics });
  } catch (error) {
    console.error('Messaging generation error:', error);
    res.status(500).json({ error: 'Failed to generate message' });
  }
});

// Get campaign by name (for testing)
app.get('/api/test/campaign-by-name', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Provide campaign name as query param' });
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    let allCampaigns: any[] = [];
    let start = 0;
    const count = 100;

    // Fetch all campaigns
    while (true) {
      const url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search=(account:(values:List(${accountUrn})))&start=${start}&count=${count}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      const data = await response.json();
      if (data.elements && data.elements.length > 0) {
        allCampaigns = allCampaigns.concat(data.elements);
        if (data.elements.length < count) break;
        start += count;
      } else {
        break;
      }
    }

    // Find campaign by name (case-insensitive)
    const campaign = allCampaigns.find(c =>
      c.name.toLowerCase().includes((name as string).toLowerCase())
    );

    if (!campaign) {
      return res.status(404).json({ error: `Campaign not found: ${name}`, totalCampaigns: allCampaigns.length });
    }

    res.json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      targetingCriteria: campaign.targetingCriteria,
      fullCampaign: campaign
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Copy targeting from one campaign to another
app.post('/api/test/copy-targeting', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected' });
  }

  const { sourceCampaignId, targetCampaignId } = req.body;
  if (!sourceCampaignId || !targetCampaignId) {
    return res.status(400).json({ error: 'Provide sourceCampaignId and targetCampaignId' });
  }

  try {
    // Get source campaign
    const sourceUrl = `https://api.linkedin.com/v2/adCampaignsV2/${sourceCampaignId}`;
    const sourceRes = await fetch(sourceUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const sourceCampaign = await sourceRes.json();

    if (!sourceCampaign.targetingCriteria) {
      return res.status(400).json({ error: 'Source campaign has no targeting criteria' });
    }

    console.log('[CopyTargeting] Source targeting:', JSON.stringify(sourceCampaign.targetingCriteria, null, 2));

    // Update target campaign with source's targeting
    const updateRes = await fetch(`https://api.linkedin.com/v2/adCampaignsV2/${targetCampaignId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
        'X-RestLi-Method': 'PARTIAL_UPDATE',
      },
      body: JSON.stringify({
        patch: {
          $set: {
            targetingCriteria: sourceCampaign.targetingCriteria
          }
        }
      }),
    });

    if (updateRes.ok || updateRes.status === 204) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      res.json({
        success: true,
        message: `Targeting copied from campaign ${sourceCampaignId} to ${targetCampaignId}`,
        targetingCriteria: sourceCampaign.targetingCriteria
      });
    } else {
      const errorData = await updateRes.text();
      res.status(updateRes.status).json({ error: 'Failed to update targeting', details: errorData });
    }
  } catch (error) {
    console.error('Error copying targeting:', error);
    res.status(500).json({ error: 'Failed to copy targeting' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    linkedInConnected: !!accessToken,
    adAccountId: LINKEDIN_AD_ACCOUNT_ID,
    talAdAccountId: TAL_LINKEDIN_AD_ACCOUNT_ID,
    mastraEnabled: true,
    authDisabled: process.env.AUTH_DISABLED === 'true',
  });
});

// Test endpoint to create a campaign (no JWT auth required, just needs LinkedIn token)
app.post('/api/test/create-campaign', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'LinkedIn not connected. Please connect first.' });
  }

  try {
    const { name = 'Test Campaign' } = req.body;

    // First, get a campaign group
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    const groupsUrl = `https://api.linkedin.com/v2/adCampaignGroupsV2?q=search&search=(account:(values:List(${accountUrn})))&count=10`;
    console.log('[Test] Fetching campaign groups:', groupsUrl);
    const groupsRes = await fetch(groupsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const groupsData = await groupsRes.json();
    console.log('[Test] Campaign groups response:', JSON.stringify(groupsData).substring(0, 500));

    if (!groupsData.elements || groupsData.elements.length === 0) {
      return res.status(400).json({ error: 'No campaign group found', details: groupsData });
    }

    const groupId = groupsData.elements[0].id;
    console.log(`[Test] Using campaign group: ${groupId}`);

    const campaignData = {
      account: `urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`,
      campaignGroup: `urn:li:sponsoredCampaignGroup:${groupId}`,
      name: name,
      status: 'PAUSED',
      type: 'SPONSORED_UPDATES',
      costType: 'CPM',
      dailyBudget: {
        amount: '50000000',
        currencyCode: 'INR'
      },
      unitCost: {
        amount: '100000000',
        currencyCode: 'INR'
      },
      objectiveType: 'BRAND_AWARENESS',
      targetingCriteria: {
        include: {
          and: [
            { or: { 'urn:li:adTargetingFacet:locations': ['urn:li:geo:102713980'] } },
            { or: { 'urn:li:adTargetingFacet:interfaceLocales': ['urn:li:locale:en_US'] } }
          ]
        }
      },
      locale: { country: 'IN', language: 'en' },
      runSchedule: {
        start: Date.now(),
        end: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year from now
      }
    };

    console.log('[Test] Creating campaign:', name);
    console.log('[Test] Campaign data:', JSON.stringify(campaignData, null, 2));
    const response = await fetch('https://api.linkedin.com/v2/adCampaignsV2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(campaignData),
    });

    console.log('[Test] LinkedIn response status:', response.status);
    const responseText = await response.text();
    console.log('[Test] LinkedIn response body:', responseText.substring(0, 500));

    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (e) {
      // Response might be empty on success (201 Created)
    }

    if (response.ok || response.status === 201) {
      legacyCampaignCache = { data: null, timestamp: 0 };
      const campaignId = response.headers.get('x-restli-id') || (data?.id) || 'unknown';
      res.json({
        success: true,
        message: `Campaign "${name}" created successfully!`,
        campaignId,
        campaign: data
      });
    } else {
      res.status(response.status).json({ error: 'LinkedIn API error', details: data || responseText });
    }
  } catch (error) {
    console.error('[Test] Error:', error);
    res.status(500).json({ error: 'Failed to create campaign', details: String(error) });
  }
});

// Video Pipeline API removed - will be added in separate deployment
// See: server/src/lib/video-pipeline.js (not committed yet)

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
