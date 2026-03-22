import type { LinkedInCampaign, LinkedInFetchInput } from '../types/index.js';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

// Cache for LinkedIn data (1 hour TTL) - keyed by accountId + date range
const campaignCacheMap = new Map<string, {
  data: LinkedInCampaign[];
  timestamp: number;
}>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function fetchLinkedInCampaigns(
  input: LinkedInFetchInput,
  accessToken: string
): Promise<LinkedInCampaign[]> {
  const { accountId, dateRange, statuses } = input;

  // Create cache key based on accountId + date range
  const cacheKey = `${accountId}_${dateRange?.start || 'all'}_${dateRange?.end || 'all'}`;
  const now = Date.now();
  const cached = campaignCacheMap.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    console.log(`Returning cached LinkedIn campaigns for ${cacheKey}`);
    return cached.data;
  }

  // Calculate date range
  const endDate = dateRange?.end ? new Date(dateRange.end) : new Date();
  const startDate = dateRange?.start
    ? new Date(dateRange.start)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days default

  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);

  // Fetch all campaigns with pagination
  const allCampaigns: any[] = [];
  let start = 0;
  const count = 100;
  let hasMore = true;

  while (hasMore) {
    const campaignsUrl = `${LINKEDIN_API_BASE}/adCampaignsV2?q=search&search=(account:(values:List(${accountUrn})))&start=${start}&count=${count}`;

    const response = await fetch(campaignsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`LinkedIn API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();

    if (data.elements && data.elements.length > 0) {
      allCampaigns.push(...data.elements);
      if (data.elements.length < count) {
        hasMore = false;
      } else {
        start += count;
      }
      // Safety limit
      if (start > 5000) hasMore = false;
    } else {
      hasMore = false;
    }

    // Rate limiting - wait 100ms between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Create campaign ID to name/status map
  const campaignMap = new Map<string, { name: string; status: string }>();
  allCampaigns.forEach((c) => {
    campaignMap.set(`urn:li:sponsoredCampaign:${c.id}`, {
      name: c.name || `Campaign ${c.id}`,
      status: c.status || 'UNKNOWN',
    });
  });

  // Fetch analytics
  const dateRangeStart = `(day:${startDate.getDate()},month:${startDate.getMonth() + 1},year:${startDate.getFullYear()})`;
  const dateRangeEnd = `(day:${endDate.getDate()},month:${endDate.getMonth() + 1},year:${endDate.getFullYear()})`;

  const analyticsUrl = `${LINKEDIN_API_BASE}/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&dateRange=(start:${dateRangeStart},end:${dateRangeEnd})&timeGranularity=ALL&accounts=List(${accountUrn})&fields=impressions,landingPageClicks,clicks,costInLocalCurrency&count=1000`;

  const analyticsResponse = await fetch(analyticsUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  if (!analyticsResponse.ok) {
    const error = await analyticsResponse.json();
    throw new Error(`LinkedIn Analytics API error: ${JSON.stringify(error)}`);
  }

  const analyticsData = await analyticsResponse.json();

  // Process and merge data
  const campaigns: LinkedInCampaign[] = [];

  if (analyticsData.elements) {
    for (const item of analyticsData.elements) {
      // LinkedIn API returns campaign URN in adEntities array
      const campaignUrn = item.adEntities?.[0]?.value?.campaign || item.pivotValues?.[0] || '';
      const campaignId = campaignUrn.split(':').pop() || '';
      const info = campaignMap.get(campaignUrn);

      const spend = parseFloat(item.costInLocalCurrency) || 0;
      const impressions = item.impressions || 0;
      const clicks = item.clicks || 0;
      const landingPageClicks = item.landingPageClicks || 0;

      // Filter by status if specified
      const status = info?.status || 'UNKNOWN';
      if (statuses && statuses.length > 0 && !statuses.includes(status)) {
        continue;
      }

      // Only include campaigns with spend
      if (spend > 0) {
        campaigns.push({
          campaignId,
          name: info?.name || `Campaign ${campaignId}`,
          status: status as LinkedInCampaign['status'],
          spend,
          impressions,
          clicks,
          landingPageClicks,
          ctr: impressions > 0 ? (landingPageClicks / impressions) * 100 : 0,
          cpc: landingPageClicks > 0 ? spend / landingPageClicks : 0,
          cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        });
      }
    }
  }

  // Sort by spend descending
  campaigns.sort((a, b) => b.spend - a.spend);

  // Cache the results with date range key
  campaignCacheMap.set(cacheKey, {
    data: campaigns,
    timestamp: now,
  });

  console.log(`Fetched ${campaigns.length} LinkedIn campaigns with analytics for ${cacheKey}`);
  return campaigns;
}

export function clearLinkedInCache() {
  campaignCacheMap.clear();
}

// Clear cache for a specific account
export function clearAccountCache(accountId: string) {
  for (const key of campaignCacheMap.keys()) {
    if (key.startsWith(`${accountId}_`)) {
      campaignCacheMap.delete(key);
    }
  }
}
