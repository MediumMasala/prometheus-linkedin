import { useState, useEffect } from 'react';
import { MetricCard } from './components/MetricCard';
import { JobApplicationsTable } from './components/JobApplicationsTable';
import { TopJobsChart } from './components/TopJobsChart';
import { CompanyBreakdown } from './components/CompanyBreakdown';
import { DatePicker } from './components/DatePicker';
import { Tabs } from './components/Tabs';
import { CampaignPerformance } from './components/CampaignPerformance';
import { LinkedInDashboard } from './components/LinkedInDashboard';
import { CampaignROI } from './components/CampaignROI';
import { LoginPage } from './components/LoginPage';
import { Settings } from './components/Settings';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { fetchJobApplications } from './services/api';
import type { JobApplication } from './types';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

// Main sidebar navigation tabs
const SIDEBAR_TABS = [
  { id: 'round-one-ads', label: 'Round1AI Ads', icon: 'chart' },
  { id: 'tal-ads', label: 'Tal Ads', icon: 'megaphone' },
  { id: 'tal-character-marketing', label: 'Tal Character Marketing', icon: 'users' },
  { id: 'ai-seo', label: 'AI SEO', icon: 'search' },
  { id: 'idea-icebox', label: 'Idea Ice-box', icon: 'lightbulb' },
  { id: 'settings', label: 'Settings', icon: 'settings', adminOnly: true },
];

// Sub-tabs for Round1AI Ads section
const ROUND_ONE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaign Performance' },
  { id: 'linkedin', label: 'LinkedIn Ads' },
  { id: 'roi', label: 'Campaign ROI' },
];

function AppContent() {
  const { isAuthenticated, isLoading: authLoading, logout, isAdmin, user } = useAuth();
  const [activeSidebarTab, setActiveSidebarTab] = useState('round-one-ads');
  const [activeSubTab, setActiveSubTab] = useState('roi'); // Default to Campaign ROI within Round One
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && activeSidebarTab === 'round-one-ads' && activeSubTab === 'overview') {
      loadApplications();
    }
  }, [selectedDate, activeSubTab, activeSidebarTab, isAuthenticated]);

  const loadApplications = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchJobApplications(selectedDate || undefined);
      setApplications(data);
    } catch (err) {
      setError('Failed to fetch applications');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const totalApplications = applications.reduce((sum, app) => sum + app.count, 0);
  const uniqueRoles = applications.length;
  const uniqueCompanies = new Set(applications.map((app) => app.company_name)).size;
  const topRole = applications.length > 0
    ? [...applications].sort((a, b) => b.count - a.count)[0]
    : null;

  const renderSidebarIcon = (iconType: string, isActive: boolean) => {
    const className = `w-5 h-5 ${isActive ? 'text-orange-500' : 'text-gray-400 group-hover:text-gray-600'}`;

    switch (iconType) {
      case 'chart':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        );
      case 'megaphone':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        );
      case 'users':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        );
      case 'settings':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'search':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        );
      case 'lightbulb':
        return (
          <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Filter tabs based on admin status
  const visibleSidebarTabs = SIDEBAR_TABS.filter(tab => {
    if ((tab as any).adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Prometheus</h1>
              <p className="text-xs text-gray-500">Analytics Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {visibleSidebarTabs.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveSidebarTab(tab.id)}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    activeSidebarTab === tab.id
                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {renderSidebarIcon(tab.icon, activeSidebarTab === tab.id)}
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Page Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {SIDEBAR_TABS.find(t => t.id === activeSidebarTab)?.label}
            </h2>
            {user && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{user.email}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  user.role === 'admin' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {user.role}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Round1AI Ads - Sub Tabs */}
        {activeSidebarTab === 'round-one-ads' && (
          <div className="bg-white border-b border-gray-200">
            <div className="px-6">
              <Tabs tabs={ROUND_ONE_TABS} activeTab={activeSubTab} onTabChange={setActiveSubTab} />
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">
          {/* Round1AI Ads Content */}
          {activeSidebarTab === 'round-one-ads' && (
            <>
              {activeSubTab === 'overview' && (
                <>
                  {/* Date Filter */}
                  <div className="mb-6 flex items-center justify-between">
                    <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
                    <button
                      onClick={loadApplications}
                      disabled={isLoading}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>

                  {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                      {error}
                    </div>
                  )}

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <MetricCard
                      title="Total Applications"
                      value={formatNumber(totalApplications)}
                      subtitle={selectedDate ? `On ${selectedDate}` : 'All time'}
                    />
                    <MetricCard
                      title="Active Roles"
                      value={uniqueRoles}
                      subtitle="With applications"
                    />
                    <MetricCard
                      title="Companies"
                      value={uniqueCompanies}
                      subtitle="Hiring on platform"
                    />
                    <MetricCard
                      title="Top Role"
                      value={topRole ? formatNumber(topRole.count) : '—'}
                      subtitle={topRole?.job_title?.substring(0, 25) || 'No data'}
                    />
                  </div>

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    <TopJobsChart applications={applications} limit={10} />
                    <CompanyBreakdown applications={applications} />
                  </div>

                  {/* Applications Table */}
                  <JobApplicationsTable
                    applications={applications}
                    isLoading={isLoading}
                    selectedDate={selectedDate}
                  />
                </>
              )}

              {activeSubTab === 'campaigns' && (
                <CampaignPerformance fetchApplications={fetchJobApplications} />
              )}

              {activeSubTab === 'linkedin' && (
                <LinkedInDashboard />
              )}

              {activeSubTab === 'roi' && (
                <CampaignROI fetchApplications={fetchJobApplications} />
              )}
            </>
          )}

          {/* Tal Ads - Placeholder */}
          {activeSidebarTab === 'tal-ads' && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Tal Ads</h3>
                <p className="text-gray-500">Coming soon</p>
              </div>
            </div>
          )}

          {/* Tal Character Marketing - Placeholder */}
          {activeSidebarTab === 'tal-character-marketing' && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Tal Character Marketing</h3>
                <p className="text-gray-500">Coming soon</p>
              </div>
            </div>
          )}

          {/* AI SEO - Placeholder */}
          {activeSidebarTab === 'ai-seo' && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">AI SEO</h3>
                <p className="text-gray-500">Coming soon</p>
              </div>
            </div>
          )}

          {/* Idea Ice-box - Placeholder */}
          {activeSidebarTab === 'idea-icebox' && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Idea Ice-box</h3>
                <p className="text-gray-500">Coming soon</p>
              </div>
            </div>
          )}

          {/* Settings - Admin Only */}
          {activeSidebarTab === 'settings' && (
            <Settings />
          )}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 px-6 py-3">
          <p className="text-sm text-gray-500 text-center">
            Prometheus v1.0 • Connected to Grapevine Backend API
          </p>
        </footer>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
