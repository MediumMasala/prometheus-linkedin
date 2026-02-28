import type { JobApplication } from '../types';

interface JobApplicationsTableProps {
  applications: JobApplication[];
  isLoading: boolean;
  selectedDate: string;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function JobApplicationsTable({ applications, isLoading, selectedDate }: JobApplicationsTableProps) {
  const sortedApplications = [...applications].sort((a, b) => b.count - a.count);
  const totalApplications = applications.reduce((sum, app) => sum + app.count, 0);

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Job Applications</h2>
          <p className="text-sm text-gray-500 mt-1">
            {selectedDate ? `Applications on ${selectedDate}` : 'All time applications'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-blue-600">{formatNumber(totalApplications)}</p>
          <p className="text-sm text-gray-500">Total Applications</p>
        </div>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Job Title
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Company
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Applications
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                % of Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedApplications.map((app, index) => (
              <tr key={`${app.job_title}-${app.company_name}-${index}`} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <span className="font-medium text-gray-900">{app.job_title}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-gray-600">{app.company_name}</span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="font-semibold text-gray-900">{formatNumber(app.count)}</span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-gray-500">
                    {totalApplications > 0 ? ((app.count / totalApplications) * 100).toFixed(1) : 0}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          No applications found for this date.
        </div>
      )}
    </div>
  );
}
