import type { Campaign } from '../types';

interface CampaignListProps {
  campaigns: Campaign[];
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

export function CampaignList({ campaigns }: CampaignListProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">Campaigns</h3>
      </div>
      <div className="divide-y divide-gray-100">
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      campaign.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : campaign.status === 'PAUSED'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {campaign.status}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{campaign.name}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {campaign.startDate} → {campaign.endDate}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500">Spend</p>
                <p className="text-sm font-semibold text-gray-900">{formatCurrency(campaign.spend)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Clicks</p>
                <p className="text-sm font-semibold text-gray-900">{formatNumber(campaign.clicks)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">CTR</p>
                <p className="text-sm font-semibold text-gray-900">{campaign.ctr.toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">CPC</p>
                <p className="text-sm font-semibold text-gray-900">{formatCurrency(campaign.cpc)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
