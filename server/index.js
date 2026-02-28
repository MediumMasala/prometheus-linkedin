import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '.token.json');

const app = express();
app.use(cors());
app.use(express.json());

const {
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  LINKEDIN_AD_ACCOUNT_ID,
  LINKEDIN_REDIRECT_URI,
  PORT = 3001,
} = process.env;

// Gemini API key
const GEMINI_API_KEY = 'AIzaSyCp5XZ-QB8hSaZs-yxD_QwOlVDz_X1rfUU';

// Load token from file if exists
let accessToken = null;
try {
  if (fs.existsSync(TOKEN_FILE)) {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    accessToken = data.access_token;
    console.log('Loaded access token from file');
  }
} catch (e) {
  console.log('No saved token found');
}

// Save token to file
function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }));
}

// Generate LinkedIn OAuth URL
app.get('/api/linkedin/auth-url', (req, res) => {
  const scopes = ['r_ads', 'r_ads_reporting'].join('%20');
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&scope=${scopes}`;
  res.json({ authUrl });
});

// Exchange code for access token
app.post('/api/linkedin/token', async (req, res) => {
  const { code } = req.body;

  try {
    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
      redirect_uri: LINKEDIN_REDIRECT_URI,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const data = await response.json();

    if (data.access_token) {
      accessToken = data.access_token;
      saveToken(accessToken);
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

// Set access token manually
app.post('/api/linkedin/set-token', (req, res) => {
  const { token } = req.body;
  accessToken = token;
  saveToken(token);
  res.json({ success: true });
});

// Campaign cache
let campaignCache = {
  data: null,
  timestamp: 0,
  ttl: 10 * 60 * 1000, // 10 minutes cache
};

// Get all campaigns (with pagination and caching)
app.get('/api/linkedin/campaigns', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  // Return cached data if valid
  const now = Date.now();
  if (campaignCache.data && (now - campaignCache.timestamp) < campaignCache.ttl) {
    console.log('Returning cached campaigns');
    return res.json(campaignCache.data);
  }

  try {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`);
    let allCampaigns = [];
    let start = 0;
    const count = 100;
    let hasMore = true;

    // Fetch all campaigns with pagination (filter on client side)
    while (hasMore) {
      const url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search=(account:(values:List(${accountUrn})))&start=${start}&count=${count}`;
      console.log('Fetching campaigns from:', url);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      const data = await response.json();

      if (response.ok && data.elements) {
        allCampaigns = allCampaigns.concat(data.elements);

        // Check if there are more pages
        if (data.elements.length < count) {
          hasMore = false;
        } else {
          start += count;
        }

        // Safety limit
        if (start > 5000) {
          hasMore = false;
        }
      } else {
        console.error('Campaigns error:', data);
        hasMore = false;
        if (allCampaigns.length === 0) {
          return res.status(response.status).json(data);
        }
      }
    }

    console.log(`Fetched ${allCampaigns.length} total campaigns`);

    // Cache the result (all campaigns for name mapping)
    campaignCache = {
      data: { elements: allCampaigns, total: allCampaigns.length },
      timestamp: now,
      ttl: 30 * 60 * 1000, // 30 minutes cache since we need all for mapping
    };

    res.json(campaignCache.data);
  } catch (error) {
    console.error('Campaigns fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get campaign analytics
app.get('/api/linkedin/analytics', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect LinkedIn first.' });
  }

  try {
    // Parse date parameters or use defaults
    const { startDate: startParam, endDate: endParam } = req.query;

    let startDate, endDate;
    if (startParam) {
      startDate = new Date(startParam);
    } else {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
    }

    if (endParam) {
      endDate = new Date(endParam);
    } else {
      endDate = new Date();
    }

    const accountUrn = `urn:li:sponsoredAccount:${LINKEDIN_AD_ACCOUNT_ID}`;

    // Use dateRange object format
    const dateRangeStart = `(day:${startDate.getDate()},month:${startDate.getMonth() + 1},year:${startDate.getFullYear()})`;
    const dateRangeEnd = `(day:${endDate.getDate()},month:${endDate.getMonth() + 1},year:${endDate.getFullYear()})`;

    // Fetch analytics with high count to get all in one request
    const url = `https://api.linkedin.com/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange=(start:${dateRangeStart},end:${dateRangeEnd})&timeGranularity=ALL&accounts=List(${encodeURIComponent(accountUrn)})&fields=impressions,landingPageClicks,costInLocalCurrency&count=1000`;
    console.log('Fetching analytics from:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    const data = await response.json();
    console.log('Analytics response status:', response.status, 'elements:', data.elements?.length);

    if (response.ok) {
      console.log(`Fetched ${data.elements?.length || 0} analytics records`);
      res.json(data);
    } else {
      console.error('Analytics error:', data);
      res.status(response.status).json(data);
    }
  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// AI-powered campaign to role mapping using Gemini
app.post('/api/ai/map-campaigns', async (req, res) => {
  try {
    const { campaigns, roles } = req.body;

    if (!campaigns || !roles) {
      return res.status(400).json({ error: 'Missing campaigns or roles' });
    }

    const prompt = `You are an expert at matching LinkedIn ad campaigns to job roles.

Given these LinkedIn campaign names:
${campaigns.map((c, i) => `${i + 1}. "${c.name}" (ID: ${c.id})`).join('\n')}

And these job roles:
${roles.map((r, i) => `${i + 1}. "${r.job_title}" at ${r.company_name}`).join('\n')}

Match each campaign to the most relevant job role based on:
- Company name in campaign matching company in role
- Job type keywords (Backend, Frontend, ML, AI, etc.)
- Seniority level (Senior, Lead, Principal, etc.)

Return ONLY a JSON array with this exact format, no other text:
[{"campaignId": "id", "roleTitle": "exact job_title from the list or null if no match"}]

Be precise - only match if there's a clear connection. Return null for roleTitle if unsure.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data);
      return res.status(500).json({ error: 'Gemini API error', details: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Gemini response:', text);

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const mappings = JSON.parse(jsonMatch[0]);
      res.json({ mappings });
    } else {
      res.status(500).json({ error: 'Failed to parse Gemini response', raw: text });
    }
  } catch (error) {
    console.error('AI mapping error:', error);
    res.status(500).json({ error: 'Failed to map campaigns with AI' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    linkedInConnected: !!accessToken,
    adAccountId: LINKEDIN_AD_ACCOUNT_ID
  });
});

// Get LinkedIn account info
app.get('/api/linkedin/account', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const response = await fetch(
      `https://api.linkedin.com/v2/adAccountsV2/${LINKEDIN_AD_ACCOUNT_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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

// Store campaign data manually (since Dev Tier can't access it via API)
let manualCampaignData = [];

app.get('/api/linkedin/manual-campaigns', (req, res) => {
  res.json({ campaigns: manualCampaignData });
});

app.post('/api/linkedin/manual-campaigns', (req, res) => {
  const { campaigns } = req.body;
  manualCampaignData = campaigns || [];
  res.json({ success: true, campaigns: manualCampaignData });
});

// Proxy for backend API (to avoid CORS issues)
const BACKEND_API_URL = 'https://apis.gvine.app/api/v1/admin-access';
const UNIQUE_ID_RESUMES = 'H1P9Z3M7K6';

app.get('/api/applications', async (req, res) => {
  try {
    const { date } = req.query;
    // Using resumes API instead of job applications
    let url = `${BACKEND_API_URL}/round1-userResume-count/?unique_id=${UNIQUE_ID_RESUMES}`;

    if (date) {
      url += `&created_at=${date}`;
    }

    console.log('Fetching resumes from:', url);

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

app.listen(PORT, () => {
  console.log(`Prometheus server running on http://localhost:${PORT}`);
  console.log(`LinkedIn connected: ${!!accessToken}`);
  if (!accessToken) {
    console.log(`\nTo connect LinkedIn, visit:`);
    console.log(`http://localhost:${PORT}/api/linkedin/auth-url`);
  }
});
