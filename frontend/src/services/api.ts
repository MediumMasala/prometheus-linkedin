import type { JobApplication } from '../types';
import { authFetch } from '../contexts/AuthContext';

// Use proxy endpoint to avoid CORS issues
export async function fetchJobApplications(date?: string): Promise<JobApplication[]> {
  let url = '/api/applications';

  if (date) {
    url += `?date=${date}`;
  }

  const response = await authFetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch job applications');
  }

  const data = await response.json();
  return data.data || [];
}

export async function fetchJobApplicationsForDateRange(
  startDate: string,
  endDate: string
): Promise<{ date: string; applications: JobApplication[]; total: number }[]> {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }

  const results = await Promise.all(
    dates.map(async (date) => {
      const applications = await fetchJobApplications(date);
      const total = applications.reduce((sum, app) => sum + app.count, 0);
      return { date, applications, total };
    })
  );

  return results;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getLastNDays(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(formatDate(date));
  }
  return dates;
}
