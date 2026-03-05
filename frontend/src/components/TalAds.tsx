import { useState } from 'react';
import { Tabs } from './Tabs';
import { TalLinkedInDashboard } from './TalLinkedInDashboard';

// Sub-tabs for Tal Ads section (LinkedIn only for now)
const TAL_TABS = [
  { id: 'linkedin', label: 'LinkedIn Ads' },
  // Future tabs:
  // { id: 'roi', label: 'Campaign ROI' },
  // { id: 'messaging', label: 'Messaging' },
  // { id: 'overview', label: 'Overview' },
];

export function TalAds() {
  const [activeTab, setActiveTab] = useState('linkedin');

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tabs */}
      <div className="bg-white border-b border-gray-200 -mx-6 -mt-6 px-6 mb-6">
        <Tabs tabs={TAL_TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="flex-1">
        {activeTab === 'linkedin' && <TalLinkedInDashboard />}

        {/* Future tab content placeholders */}
        {activeTab === 'roi' && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Campaign ROI</h3>
              <p className="text-gray-500">Coming soon with Tal-specific internal data</p>
            </div>
          </div>
        )}

        {activeTab === 'messaging' && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Messaging</h3>
              <p className="text-gray-500">Coming soon with Tal branding</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
