import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchLinkedInCampaigns as fetchFromLinkedIn } from '../../lib/linkedin-api.js';
import type { LinkedInCampaign } from '../../types/index.js';

export const fetchLinkedInCampaignsTool = createTool({
  id: 'fetch-linkedin-campaigns',
  description:
    'Fetch campaign performance data from LinkedIn Advertising API including spend, impressions, clicks, CTR, CPC, and campaign status.',
  inputSchema: z.object({
    accountId: z.string().describe('LinkedIn Ad Account ID'),
    dateRange: z
      .object({
        start: z.string().describe('Start date in ISO format (YYYY-MM-DD)'),
        end: z.string().describe('End date in ISO format (YYYY-MM-DD)'),
      })
      .optional()
      .describe('Date range for analytics. Defaults to last 30 days.'),
    statuses: z
      .array(z.string())
      .optional()
      .describe('Filter by campaign status: ACTIVE, PAUSED, ARCHIVED, etc.'),
    accessToken: z.string().describe('LinkedIn OAuth access token'),
  }),
  outputSchema: z.object({
    campaigns: z.array(
      z.object({
        campaignId: z.string(),
        name: z.string(),
        status: z.string(),
        spend: z.number(),
        impressions: z.number(),
        clicks: z.number(),
        landingPageClicks: z.number(),
        ctr: z.number(),
        cpc: z.number(),
        cpm: z.number(),
      })
    ),
    totalCampaigns: z.number(),
    totalSpend: z.number(),
    dateRange: z.object({
      start: z.string(),
      end: z.string(),
    }),
  }),
  execute: async ({ context }) => {
    const { accountId, dateRange, statuses, accessToken } = context;

    console.log(`[Tool: fetchLinkedInCampaigns] Fetching campaigns for account ${accountId}`);

    const campaigns = await fetchFromLinkedIn(
      {
        accountId,
        dateRange,
        statuses,
      },
      accessToken
    );

    const totalSpend = campaigns.reduce((sum: number, c: LinkedInCampaign) => sum + c.spend, 0);

    // Calculate actual date range used
    const endDate = dateRange?.end || new Date().toISOString().split('T')[0];
    const startDate =
      dateRange?.start ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(
      `[Tool: fetchLinkedInCampaigns] Found ${campaigns.length} campaigns with total spend: ₹${totalSpend.toFixed(0)}`
    );

    return {
      campaigns: campaigns.map((c: LinkedInCampaign) => ({
        campaignId: c.campaignId,
        name: c.name,
        status: c.status,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        landingPageClicks: c.landingPageClicks,
        ctr: c.ctr,
        cpc: c.cpc,
        cpm: c.cpm,
      })),
      totalCampaigns: campaigns.length,
      totalSpend,
      dateRange: {
        start: startDate,
        end: endDate,
      },
    };
  },
});
