import { useState, useEffect } from 'react';
import { authFetch } from '../contexts/AuthContext';

interface LinkedInAccount {
  name: string;
  id: number;
  status: string;
  currency: string;
  type: string;
}

interface CampaignAnalytics {
  campaignId: string;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

// Get date string in YYYY-MM-DD format
function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get default start date (30 days ago)
function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return getDateString(date);
}

// Get default end date (today)
function getDefaultEndDate(): string {
  return getDateString(new Date());
}

export function LinkedInDashboard() {
  const [account, setAccount] = useState<LinkedInAccount | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [campaignAnalytics, setCampaignAnalytics] = useState<CampaignAnalytics[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (isConnected) {
      loadAnalytics();
    }
  }, [isConnected, startDate, endDate]);

  const checkConnection = async () => {
    try {
      const healthRes = await authFetch('/api/health');
      const health = await healthRes.json();
      setIsConnected(health.linkedInConnected);

      if (health.linkedInConnected) {
        const accountRes = await authFetch('/api/linkedin/account');
        if (accountRes.ok) {
          const accountData = await accountRes.json();
          setAccount(accountData);
        }
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Failed to check connection:', err);
      setIsLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch campaigns and analytics in parallel
      const [campaignsRes, analyticsRes] = await Promise.all([
        authFetch('/api/linkedin/campaigns'),
        authFetch(`/api/linkedin/analytics?startDate=${startDate}&endDate=${endDate}`),
      ]);

      if (campaignsRes.ok && analyticsRes.ok) {
        const campaignsData = await campaignsRes.json();
        const analyticsData = await analyticsRes.json();

        // Create a map of campaign ID to campaign info (name + status)
        const campaignMap = new Map<string, { name: string; status: string }>();
        if (campaignsData.elements) {
          campaignsData.elements.forEach((campaign: any) => {
            const id = campaign.id?.toString() || '';
            campaignMap.set(`urn:li:sponsoredCampaign:${id}`, {
              name: campaign.name || `Campaign ${id}`,
              status: campaign.status || 'UNKNOWN',
            });
          });
        }

        // Process analytics data - include ALL campaigns with spend
        const analytics: CampaignAnalytics[] = [];
        if (analyticsData.elements) {
          analyticsData.elements.forEach((item: any) => {
            const campaignUrn = item.adEntities?.[0]?.value?.campaign || '';
            const campaignId = campaignUrn.split(':').pop() || '';
            const campaignInfo = campaignMap.get(campaignUrn);
            const campaignName = campaignInfo?.name || `Campaign ${campaignId}`;
            const status = campaignInfo?.status || 'UNKNOWN';
            const impressions = item.impressions || 0;
            const clicks = item.landingPageClicks || 0;
            const spend = parseFloat(item.costInLocalCurrency) || 0;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const cpc = clicks > 0 ? spend / clicks : 0;

            // Include all campaigns with spend or activity
            if (spend > 0 || impressions > 0 || clicks > 0) {
              analytics.push({
                campaignId,
                campaignName,
                status,
                impressions,
                clicks,
                spend,
                ctr,
                cpc,
              });
            }
          });
        }

        // Sort by spend descending
        analytics.sort((a, b) => b.spend - a.spend);
        setCampaignAnalytics(analytics);
      } else {
        const errorData = await analyticsRes.json();
        setError(errorData.message || 'Failed to fetch LinkedIn data');
      }
    } catch (err) {
      console.error('Failed to load LinkedIn data:', err);
      setError('Failed to load LinkedIn data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    const res = await authFetch('/api/linkedin/auth-url');
    const data = await res.json();
    window.location.href = data.authUrl;
  };

  // Quick date presets
  const setDatePreset = (preset: string) => {
    const end = new Date();
    const start = new Date();

    switch (preset) {
      case 'today':
        break;
      case '7days':
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start.setDate(start.getDate() - 30);
        break;
      case '90days':
        start.setDate(start.getDate() - 90);
        break;
      case 'thisMonth':
        start.setDate(1);
        break;
      case 'lastMonth':
        start.setMonth(start.getMonth() - 1);
        start.setDate(1);
        end.setDate(0); // Last day of previous month
        break;
    }

    setStartDate(getDateString(start));
    setEndDate(getDateString(end));
  };

  // Calculate totals
  const totalSpend = campaignAnalytics.reduce((sum, c) => sum + c.spend, 0);
  const totalImpressions = campaignAnalytics.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaignAnalytics.reduce((sum, c) => sum + c.clicks, 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;

  return (
    <div className="space-y-6">
      {/* LinkedIn Account Status */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#0077B5] rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">LinkedIn Ads</h3>
              {isConnected && account ? (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">{account.name}</span> • {account.currency} •
                  <span className={`ml-1 ${account.status === 'ACTIVE' ? 'text-green-600' : 'text-gray-500'}`}>
                    {account.status}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not connected</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                Connected
              </span>
            ) : (
              <button
                onClick={handleConnect}
                className="px-4 py-2 bg-[#0077B5] text-white text-sm font-medium rounded-lg hover:bg-[#006097] transition-colors"
              >
                Connect LinkedIn
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Date Filters */}
      {isConnected && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDatePreset('today')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => setDatePreset('7days')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                7 Days
              </button>
              <button
                onClick={() => setDatePreset('30days')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                30 Days
              </button>
              <button
                onClick={() => setDatePreset('90days')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                90 Days
              </button>
              <button
                onClick={() => setDatePreset('thisMonth')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                This Month
              </button>
              <button
                onClick={() => setDatePreset('lastMonth')}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Last Month
              </button>
            </div>
            <button
              onClick={loadAnalytics}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading LinkedIn data...</p>
          <p className="mt-2 text-xs text-gray-400">First load may take a moment, subsequent loads will be instant</p>
        </div>
      ) : (
        <>
          {/* Summary Metrics */}
          {campaignAnalytics.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-sm text-gray-500">Total Spend</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpend)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-sm text-gray-500">Impressions</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(totalImpressions)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-sm text-gray-500">LP Clicks</p>
                <p className="text-2xl font-bold text-gray-900">{formatNumber(totalClicks)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-sm text-gray-500">CTR</p>
                <p className="text-2xl font-bold text-gray-900">{avgCTR.toFixed(2)}%</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <p className="text-sm text-gray-500">Avg CPC</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(avgCPC)}</p>
              </div>
            </div>
          )}

          {/* Campaign Data */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Data from LinkedIn</h3>
              <p className="text-sm text-gray-500">
                {campaignAnalytics.length} active campaigns ({startDate} to {endDate})
              </p>
            </div>

            {/* Campaigns Table */}
            {campaignAnalytics.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Campaign</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Spend</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Impressions</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">LP Clicks</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">CTR</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">CPC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {campaignAnalytics.slice(0, 50).map((campaign) => (
                      <tr key={campaign.campaignId} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900 truncate max-w-xs" title={campaign.campaignName}>
                            {campaign.campaignName}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                            campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                          }`}>{campaign.status === 'ACTIVE' ? 'LIVE' : campaign.status}</span>
                          ID: {campaign.campaignId}
                        </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                          {formatCurrency(campaign.spend)}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-600">
                          {formatNumber(campaign.impressions)}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-600">
                          {formatNumber(campaign.clicks)}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-600">
                          {campaign.ctr.toFixed(2)}%
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-600">
                          {formatCurrency(campaign.cpc)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-gray-500">
                No campaign data available for the selected date range.
              </div>
            )}

            {campaignAnalytics.length > 50 && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 text-sm text-gray-500 text-center">
                Showing top 50 active campaigns by spend. Total: {campaignAnalytics.length} live campaigns.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
