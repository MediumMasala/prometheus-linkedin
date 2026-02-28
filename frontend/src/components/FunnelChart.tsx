import type { RolePerformance } from '../types';

interface FunnelChartProps {
  role: RolePerformance;
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

export function FunnelChart({ role }: FunnelChartProps) {
  const funnelSteps = [
    {
      name: 'Impressions',
      value: role.totalImpressions,
      color: 'bg-blue-500',
    },
    {
      name: 'Clicks',
      value: role.totalClicks,
      color: 'bg-blue-400',
      rate: role.avgCtr.toFixed(1) + '% CTR',
    },
    {
      name: 'Signups',
      value: role.conversions.signups,
      color: 'bg-green-500',
      rate: role.clickToSignupRate.toFixed(1) + '% of clicks',
    },
    {
      name: 'Resumes',
      value: role.conversions.resumeSubmissions,
      color: 'bg-yellow-500',
      rate: ((role.conversions.resumeSubmissions / role.conversions.signups) * 100).toFixed(1) + '% of signups',
    },
    {
      name: 'Interviews',
      value: role.conversions.interviewsStarted,
      color: 'bg-purple-500',
      rate: ((role.conversions.interviewsStarted / role.conversions.resumeSubmissions) * 100).toFixed(1) + '% of resumes',
    },
  ];

  const maxValue = Math.max(...funnelSteps.map((s) => s.value));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{role.roleName}</h3>
        <p className="text-sm text-gray-500">
          {role.campaigns.length} campaign{role.campaigns.length > 1 ? 's' : ''} • {formatCurrency(role.totalSpend)} spent
        </p>
      </div>

      <div className="space-y-4">
        {funnelSteps.map((step, index) => {
          const width = (step.value / maxValue) * 100;
          return (
            <div key={step.name} className="relative">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">{step.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900">{formatNumber(step.value)}</span>
                  {step.rate && (
                    <span className="text-xs text-gray-500">({step.rate})</span>
                  )}
                </div>
              </div>
              <div className="h-8 bg-gray-100 rounded-lg overflow-hidden">
                <div
                  className={`h-full ${step.color} rounded-lg transition-all duration-500 ease-out`}
                  style={{ width: `${Math.max(width, 2)}%` }}
                />
              </div>
              {index < funnelSteps.length - 1 && (
                <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 text-gray-300">
                  ↓
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-100">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cost/Click</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(role.totalSpend / role.totalClicks)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cost/Signup</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(role.costPerSignup)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cost/Interview</p>
            <p className="text-lg font-semibold text-blue-600">
              {formatCurrency(role.costPerInterview)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
