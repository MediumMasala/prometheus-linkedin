import type { JobApplication } from '../types';

interface TopJobsChartProps {
  applications: JobApplication[];
  limit?: number;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

const COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-cyan-500',
];

export function TopJobsChart({ applications, limit = 10 }: TopJobsChartProps) {
  const topJobs = [...applications]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const maxCount = Math.max(...topJobs.map((j) => j.count), 1);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Top {limit} Roles by Applications</h3>
      <div className="space-y-3">
        {topJobs.map((job, index) => {
          const width = (job.count / maxCount) * 100;
          return (
            <div key={`${job.job_title}-${index}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-700 truncate max-w-xs" title={job.job_title}>
                  {job.job_title}
                </span>
                <span className="text-sm font-semibold text-gray-900 ml-2">
                  {formatNumber(job.count)}
                </span>
              </div>
              <div className="h-6 bg-gray-100 rounded-lg overflow-hidden">
                <div
                  className={`h-full ${COLORS[index % COLORS.length]} rounded-lg transition-all duration-500`}
                  style={{ width: `${width}%` }}
                />
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
