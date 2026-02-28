import type { RolePerformance } from '../types';

interface RolePerformanceTableProps {
  roles: RolePerformance[];
  onRoleSelect: (role: RolePerformance) => void;
  selectedRoleId?: string;
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

export function RolePerformanceTable({ roles, onRoleSelect, selectedRoleId }: RolePerformanceTableProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Role Performance Report</h2>
        <p className="text-sm text-gray-500 mt-1">Click on a role to view detailed funnel</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Role/Round
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Campaigns
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Spend
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Clicks
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Signups
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Resumes
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Interviews
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                CPI
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.map((role) => (
              <tr
                key={role.roleId}
                onClick={() => onRoleSelect(role)}
                className={`cursor-pointer transition-colors ${
                  selectedRoleId === role.roleId
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mr-3"></div>
                    <span className="font-medium text-gray-900">{role.roleName}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {role.campaigns.length}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-medium text-gray-900">
                  {formatCurrency(role.totalSpend)}
                </td>
                <td className="px-6 py-4 text-right text-gray-600">
                  {formatNumber(role.totalClicks)}
                </td>
                <td className="px-6 py-4 text-right text-gray-600">
                  {formatNumber(role.conversions.signups)}
                </td>
                <td className="px-6 py-4 text-right text-gray-600">
                  {formatNumber(role.conversions.resumeSubmissions)}
                </td>
                <td className="px-6 py-4 text-right text-gray-600">
                  {formatNumber(role.conversions.interviewsStarted)}
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="font-semibold text-blue-600">
                    {formatCurrency(role.costPerInterview)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td className="px-6 py-4 font-semibold text-gray-900">Total</td>
              <td className="px-6 py-4 text-center font-semibold text-gray-900">
                {roles.reduce((sum, r) => sum + r.campaigns.length, 0)}
              </td>
              <td className="px-6 py-4 text-right font-semibold text-gray-900">
                {formatCurrency(roles.reduce((sum, r) => sum + r.totalSpend, 0))}
              </td>
              <td className="px-6 py-4 text-right font-semibold text-gray-900">
                {formatNumber(roles.reduce((sum, r) => sum + r.totalClicks, 0))}
              </td>
              <td className="px-6 py-4 text-right font-semibold text-gray-900">
                {formatNumber(roles.reduce((sum, r) => sum + r.conversions.signups, 0))}
              </td>
              <td className="px-6 py-4 text-right font-semibold text-gray-900">
                {formatNumber(roles.reduce((sum, r) => sum + r.conversions.resumeSubmissions, 0))}
              </td>
              <td className="px-6 py-4 text-right font-semibold text-gray-900">
                {formatNumber(roles.reduce((sum, r) => sum + r.conversions.interviewsStarted, 0))}
              </td>
              <td className="px-6 py-4 text-right">
                <span className="font-semibold text-blue-600">—</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-500">CPI = Cost per Interview Started</p>
      </div>
    </div>
  );
}
