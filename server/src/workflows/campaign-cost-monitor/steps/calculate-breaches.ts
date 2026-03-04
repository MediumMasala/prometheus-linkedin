// Calculate and Filter Breached Campaigns

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ALERT_CONFIG } from '../config.js';
import type { CampaignDailySnapshot, BreachedCampaign } from '../types.js';

/**
 * Calculate cost per resume and identify breaches
 * CPR = Live Spend / Paid Resumes (only for ACTIVE/live roles)
 */
function calculateBreaches(campaigns: CampaignDailySnapshot[]): BreachedCampaign[] {
  const breached: BreachedCampaign[] = [];

  for (const campaign of campaigns) {
    // Use live spend if available, otherwise fall back to total spend
    const liveSpend = campaign.liveSpendToday ?? campaign.spendToday;

    // Use paid resumes if available, otherwise fall back to total resumes
    const paidResumes = campaign.paidResumesToday ?? campaign.resumesToday;

    // Skip campaigns with minimal live spend
    if (liveSpend < ALERT_CONFIG.minimumSpendForAlert) {
      continue;
    }

    // Skip if role is not live (if specified)
    if (campaign.isLive === false) {
      continue;
    }

    // CPR = Live Spend / Paid Resumes
    const costPerResume = paidResumes > 0
      ? liveSpend / paidResumes
      : Infinity;

    // Update the campaign's CPR
    campaign.costPerResume = costPerResume;

    // Check for breaches
    let breachType: 'high_cpr' | 'zero_resumes' | 'critical_cpr' | null = null;
    let breachAmount = 0;

    // Critical CPR (always breach)
    if (costPerResume >= ALERT_CONFIG.criticalCprThreshold) {
      breachType = 'critical_cpr';
      breachAmount = costPerResume - ALERT_CONFIG.cprThreshold;
    }
    // Zero resumes with significant spend
    else if (campaign.resumesToday === 0 && campaign.spendToday >= ALERT_CONFIG.zeroCostThreshold) {
      breachType = 'zero_resumes';
      breachAmount = campaign.spendToday; // The entire spend is "wasted"
    }
    // High CPR (above threshold)
    else if (costPerResume > ALERT_CONFIG.cprThreshold) {
      breachType = 'high_cpr';
      breachAmount = costPerResume - ALERT_CONFIG.cprThreshold;
    }

    if (breachType) {
      breached.push({
        ...campaign,
        costPerResume,
        breachType,
        breachAmount,
      });
    }
  }

  // Sort by severity: critical_cpr > zero_resumes > high_cpr, then by breach amount
  breached.sort((a, b) => {
    const severityOrder = { critical_cpr: 0, zero_resumes: 1, high_cpr: 2 };
    const severityDiff = severityOrder[a.breachType] - severityOrder[b.breachType];
    if (severityDiff !== 0) return severityDiff;
    return b.breachAmount - a.breachAmount;
  });

  return breached;
}

// Mastra Tool Definition
export const calculateBreachesTool = createTool({
  id: 'calculate-breaches',
  description: 'Calculate cost per resume for each campaign and identify those breaching thresholds',
  inputSchema: z.object({
    campaigns: z.array(z.object({
      campaignId: z.string(),
      campaignName: z.string(),
      company: z.string(),
      role: z.string(),
      spendToday: z.number(),
      resumesToday: z.number(),
      costPerResume: z.number(),
      timestamp: z.string(),
      hourOfDay: z.number(),
      dayOfWeek: z.number(),
      isWeekend: z.boolean(),
    })),
  }),
  outputSchema: z.object({
    breachedCampaigns: z.array(z.object({
      campaignId: z.string(),
      campaignName: z.string(),
      company: z.string(),
      role: z.string(),
      spendToday: z.number(),
      resumesToday: z.number(),
      costPerResume: z.number(),
      timestamp: z.string(),
      hourOfDay: z.number(),
      dayOfWeek: z.number(),
      isWeekend: z.boolean(),
      breachType: z.enum(['high_cpr', 'zero_resumes', 'critical_cpr']),
      breachAmount: z.number(),
    })),
    totalCampaigns: z.number(),
    breachedCount: z.number(),
    skippedCount: z.number(),
    thresholds: z.object({
      cprThreshold: z.number(),
      criticalCprThreshold: z.number(),
      zeroCostThreshold: z.number(),
      minimumSpendForAlert: z.number(),
    }),
  }),
  execute: async ({ context }) => {
    const { campaigns } = context;

    console.log(`[CalculateBreaches] Processing ${campaigns.length} campaigns`);

    const breachedCampaigns = calculateBreaches(campaigns as CampaignDailySnapshot[]);

    const skippedCount = campaigns.filter(
      c => c.spendToday < ALERT_CONFIG.minimumSpendForAlert
    ).length;

    console.log(`[CalculateBreaches] Found ${breachedCampaigns.length} breached campaigns`);
    console.log(`[CalculateBreaches] Skipped ${skippedCount} low-spend campaigns`);

    return {
      breachedCampaigns,
      totalCampaigns: campaigns.length,
      breachedCount: breachedCampaigns.length,
      skippedCount,
      thresholds: {
        cprThreshold: ALERT_CONFIG.cprThreshold,
        criticalCprThreshold: ALERT_CONFIG.criticalCprThreshold,
        zeroCostThreshold: ALERT_CONFIG.zeroCostThreshold,
        minimumSpendForAlert: ALERT_CONFIG.minimumSpendForAlert,
      },
    };
  },
});

// Export standalone function
export { calculateBreaches };
