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
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { fetchJobApplications } from './services/api';
import type { JobApplication } from './types';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaign Performance' },
  { id: 'linkedin', label: 'LinkedIn Ads' },
  { id: 'roi', label: 'Campaign ROI' },
];

function AppContent() {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('roi'); // Default to Campaign ROI
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'overview') {
      loadApplications();
    }
  }, [selectedDate, activeTab, isAuthenticated]);

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Prometheus</h1>
                <p className="text-sm text-gray-500">Grapevine / Round1 Analytics</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
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

        {activeTab === 'campaigns' && (
          <CampaignPerformance fetchApplications={fetchJobApplications} />
        )}

        {activeTab === 'linkedin' && (
          <LinkedInDashboard />
        )}

        {activeTab === 'roi' && (
          <CampaignROI fetchApplications={fetchJobApplications} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-gray-500 text-center">
            Prometheus v1.0 • Connected to Grapevine Backend API
          </p>
        </div>
      </footer>
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
