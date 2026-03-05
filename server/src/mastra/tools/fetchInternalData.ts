import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchInternalData as fetchFromInternal } from '../../lib/internal-api.js';
import type { InternalRole } from '../../types/index.js';

export const fetchInternalDataTool = createTool({
  id: 'fetch-internal-data',
  description:
    'Fetch candidate/resume data from NextBoss internal backend API. Returns resume counts per job role and company.',
  inputSchema: z.object({
    dateRange: z
      .object({
        start: z.string().describe('Start date in ISO format (YYYY-MM-DD)'),
        end: z.string().describe('End date in ISO format (YYYY-MM-DD)'),
      })
      .optional()
      .describe('Date range to filter data. If not provided, returns all-time data.'),
    source: z
      .string()
      .optional()
      .describe('Source filter (default: linkedin)'),
    companyFilter: z
      .array(z.string())
      .optional()
      .describe('Filter by company names'),
  }),
  outputSchema: z.object({
    roles: z.array(
      z.object({
        jobTitle: z.string(),
        companyName: z.string(),
        resumes: z.number(),
        source: z.string().optional(),
        interviewCount: z.number().optional(),
        totalInterviewDuration: z.number().optional(),
        avgInterviewDuration: z.number().optional(),
      })
    ),
    totalRoles: z.number(),
    totalResumes: z.number(),
    totalInterviews: z.number().optional(),
    totalInterviewDuration: z.number().optional(),
    dateRange: z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    const { dateRange, source, companyFilter } = context;

    console.log(
      `[Tool: fetchInternalData] Fetching internal data${dateRange ? ` for ${dateRange.start} to ${dateRange.end}` : ' (all time)'}`
    );

    const roles = await fetchFromInternal({
      dateRange,
      source,
      companyFilter,
    });

    const totalResumes = roles.reduce((sum: number, r: InternalRole) => sum + r.resumes, 0);
    const totalInterviews = roles.reduce((sum: number, r: InternalRole) => sum + (r.interviewCount || 0), 0);
    const totalInterviewDuration = roles.reduce((sum: number, r: InternalRole) => sum + (r.totalInterviewDuration || 0), 0);

    console.log(
      `[Tool: fetchInternalData] Found ${roles.length} roles with ${totalResumes} total resumes, ${totalInterviews} interviews`
    );

    return {
      roles,
      totalRoles: roles.length,
      totalResumes,
      totalInterviews,
      totalInterviewDuration,
      dateRange,
    };
  },
});
