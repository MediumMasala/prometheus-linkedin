import { useState, useEffect } from 'react';
import type { JobApplication } from '../types';

interface DayData {
  date: string;
  applications: JobApplication[];
  total: number;
}

interface CampaignPerformanceProps {
  fetchApplications: (date: string) => Promise<JobApplication[]>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function CampaignPerformance({ fetchApplications }: CampaignPerformanceProps) {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [dateRange, setDateRange] = useState<number>(7);
  const [dayData, setDayData] = useState<DayData[]>([]);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Get last N days
  const getLastNDays = (n: number): string[] => {
    const dates: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
  };

  useEffect(() => {
    loadData();
  }, [dateRange]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const dates = getLastNDays(dateRange);
      const results: DayData[] = [];
      const rolesSet = new Set<string>();

      for (const date of dates) {
        const applications = await fetchApplications(date);
        applications.forEach((app) => rolesSet.add(app.job_title));
        const total = applications.reduce((sum, app) => sum + app.count, 0);
        results.push({ date, applications, total });
      }

      setDayData(results);
      setAllRoles(Array.from(rolesSet).sort());

      if (!selectedRole && rolesSet.size > 0) {
        // Select the role with most applications
        const roleCounts = new Map<string, number>();
        results.forEach((day) => {
          day.applications.forEach((app) => {
            roleCounts.set(app.job_title, (roleCounts.get(app.job_title) || 0) + app.count);
          });
        });
        const topRole = Array.from(roleCounts.entries()).sort((a, b) => b[1] - a[1])[0];
        if (topRole) setSelectedRole(topRole[0]);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Get data for selected role across days
  const getRoleData = () => {
    if (!selectedRole) return [];
    return dayData.map((day) => {
      const app = day.applications.find((a) => a.job_title === selectedRole);
      return {
        date: day.date,
        count: app?.count || 0,
      };
    });
  };

  const roleData = getRoleData();
  const maxCount = Math.max(...roleData.map((d) => d.count), 1);
  const totalForRole = roleData.reduce((sum, d) => sum + d.count, 0);
  const avgForRole = roleData.length > 0 ? totalForRole / roleData.length : 0;

  // Get role company
  const getRoleCompany = () => {
    for (const day of dayData) {
      const app = day.applications.find((a) => a.job_title === selectedRole);
      if (app) return app.company_name;
    }
    return '';
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading campaign data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Role/Campaign</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Select a role...</option>
              {allRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
          <button
            onClick={loadData}
            className="mt-6 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {selectedRole && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Total Applications</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(totalForRole)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Daily Average</p>
              <p className="text-2xl font-bold text-gray-900">{avgForRole.toFixed(1)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Peak Day</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(maxCount)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Company</p>
              <p className="text-lg font-bold text-gray-900 truncate">{getRoleCompany()}</p>
            </div>
          </div>

          {/* Day-by-Day Chart */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Day-by-Day Performance: {selectedRole}
            </h3>
            <div className="space-y-3">
              {roleData.map((day) => {
                const width = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                return (
                  <div key={day.date} className="flex items-center gap-4">
                    <div className="w-24 text-sm text-gray-600 shrink-0">
                      {formatDateDisplay(day.date)}
                    </div>
                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-lg transition-all duration-300 flex items-center justify-end pr-2"
                        style={{ width: `${Math.max(width, day.count > 0 ? 5 : 0)}%` }}
                      >
                        {day.count > 0 && (
                          <span className="text-white text-xs font-medium">{day.count}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-16 text-right text-sm font-semibold text-gray-900">
                      {formatNumber(day.count)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Day-by-Day Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Daily Breakdown</h3>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Applications</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">vs Avg</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {roleData.map((day) => {
                  const vsAvg = avgForRole > 0 ? ((day.count - avgForRole) / avgForRole) * 100 : 0;
                  const pctOfTotal = totalForRole > 0 ? (day.count / totalForRole) * 100 : 0;
                  return (
                    <tr key={day.date} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{formatDateDisplay(day.date)}</td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                        {formatNumber(day.count)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <span className={vsAvg >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {vsAvg >= 0 ? '+' : ''}{vsAvg.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-600">
                        {pctOfTotal.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!selectedRole && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-500">Select a role/campaign above to view day-by-day performance</p>
        </div>
      )}
    </div>
  );
}
