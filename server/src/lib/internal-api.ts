import type { InternalRole, InternalDataInput } from '../types/index.js';

const BACKEND_API_URL = 'https://apis.gvine.app/api/v1/admin-access';
const UNIQUE_ID = 'H1P9Z3M7K6';

export async function fetchInternalData(input: InternalDataInput): Promise<InternalRole[]> {
  const { dateRange, companyFilter } = input;

  // If date range is provided, fetch day by day and aggregate
  if (dateRange?.start && dateRange?.end) {
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);
    const roleMap = new Map<string, InternalRole>();

    // Fetch data for each day in the range
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayData = await fetchForDate(dateStr);

      // Aggregate by job_title + company_name
      for (const item of dayData) {
        const key = `${item.jobTitle}|${item.companyName}`;
        const existing = roleMap.get(key);
        if (existing) {
          existing.resumes += item.resumes;
        } else {
          roleMap.set(key, { ...item });
        }
      }

      // Rate limiting - small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    let roles = Array.from(roleMap.values());

    // Apply company filter if provided
    if (companyFilter && companyFilter.length > 0) {
      const filterLower = companyFilter.map((c: string) => c.toLowerCase());
      roles = roles.filter((r: InternalRole) =>
        filterLower.some((f: string) => r.companyName.toLowerCase().includes(f))
      );
    }

    // Sort by resume count descending
    roles.sort((a, b) => b.resumes - a.resumes);

    console.log(`Fetched ${roles.length} internal roles for date range`);
    return roles;
  }

  // No date range - fetch all time
  const data = await fetchForDate();

  let roles = data;
  if (companyFilter && companyFilter.length > 0) {
    const filterLower = companyFilter.map((c: string) => c.toLowerCase());
    roles = roles.filter((r: InternalRole) =>
      filterLower.some((f: string) => r.companyName.toLowerCase().includes(f))
    );
  }

  roles.sort((a, b) => b.resumes - a.resumes);
  console.log(`Fetched ${roles.length} internal roles (all time)`);
  return roles;
}

async function fetchForDate(date?: string): Promise<InternalRole[]> {
  let url = `${BACKEND_API_URL}/round1-userResume-count/?unique_id=${UNIQUE_ID}`;

  if (date) {
    url += `&created_at=${date}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Internal API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .filter((item: any) => item.job_title && item.company_name)
    .map((item: any) => ({
      jobTitle: item.job_title,
      companyName: item.company_name,
      resumes: item.count || 0,
      source: 'linkedin', // Assuming all are from LinkedIn for now
    }));
}
