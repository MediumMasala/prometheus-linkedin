import type { JobApplication } from '../types';

interface CompanyBreakdownProps {
  applications: JobApplication[];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function CompanyBreakdown({ applications }: CompanyBreakdownProps) {
  // Group by company
  const companyMap = new Map<string, number>();

  applications.forEach((app) => {
    const current = companyMap.get(app.company_name) || 0;
    companyMap.set(app.company_name, current + app.count);
  });

  const companies = Array.from(companyMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalApplications = applications.reduce((sum, app) => sum + app.count, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Applications by Company</h3>
      <div className="space-y-3">
        {companies.map((company) => {
          const percentage = totalApplications > 0 ? (company.count / totalApplications) * 100 : 0;
          return (
            <div key={company.name} className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                  {company.name.charAt(0)}
                </div>
                <span className="text-sm font-medium text-gray-700 truncate">{company.name}</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-gray-900">{formatNumber(company.count)}</span>
                <span className="text-xs text-gray-500 ml-2">({percentage.toFixed(1)}%)</span>
              </div>
            </div>
          );
        })}
      </div>
      {applications.length === 0 && (
        <p className="text-gray-500 text-center py-4">No data available</p>
      )}
    </div>
  );
}
