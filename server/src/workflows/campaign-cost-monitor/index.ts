// Campaign Cost Monitor - Main Workflow
// Monitors LinkedIn campaign spend vs resume inflow and sends intelligent Slack alerts

import { runPrometheusAnalysis } from '../../mastra/index.js';
import { ALERT_CONFIG, getISTTimeInfo, getISTTimeString, getTodayIST } from './config.js';
import { calculateBreaches } from './steps/calculate-breaches.js';
import { generateAIAnalysis } from './steps/analyze-cost.js';
import { sendToSlack } from './steps/send-slack-alert.js';
import { shouldSendAlert, recordAlert, getTodaysAlerts } from './utils/deduplication.js';
import { formatINR } from './utils/currency.js';
import type { CampaignDailySnapshot, BreachedCampaign, AnalysisResult } from './types.js';

// Re-export types and config
export * from './types.js';
export { ALERT_CONFIG } from './config.js';

interface MonitorResult {
  success: boolean;
  timestamp: string;
  timeIST: string;
  campaignsAnalyzed: number;
  breachedCampaigns: number;
  alertsSent: number;
  alertsSkipped: number;
  details: {
    campaigns: Array<{
      company: string;
      role: string;
      spend: number;
      resumes: number;
      cpr: number;
      severity?: 'warning' | 'critical';
      alertSent: boolean;
    }>;
    thresholdUsed: number;
  };
  error?: string;
}

/**
 * Run the full campaign cost monitoring workflow
 */
export async function runCampaignCostMonitor(
  linkedInAccountId: string,
  linkedInAccessToken: string
): Promise<MonitorResult> {
  const timeInfo = getISTTimeInfo();
  const timeStr = getISTTimeString();

  console.log(`\n[CampaignMonitor] ═══════════════════════════════════════════`);
  console.log(`[CampaignMonitor] Starting check at ${timeStr} IST`);
  console.log(`[CampaignMonitor] ═══════════════════════════════════════════`);

  try {
    // Step 1: Fetch today's campaign data via Prometheus
    console.log('[CampaignMonitor] Step 1: Fetching campaign data...');
    const today = getTodayIST();

    const prometheusResult = await runPrometheusAnalysis({
      linkedInAccountId,
      linkedInAccessToken,
      dateRange: { start: today, end: today },
    });

    if (!prometheusResult.report?.matchedCampaigns) {
      console.log('[CampaignMonitor] No matched campaigns found');
      return {
        success: true,
        timestamp: new Date().toISOString(),
        timeIST: timeStr,
        campaignsAnalyzed: 0,
        breachedCampaigns: 0,
        alertsSent: 0,
        alertsSkipped: 0,
        details: {
          campaigns: [],
          thresholdUsed: ALERT_CONFIG.cprThreshold,
        },
      };
    }

    // Step 2: Transform to CampaignDailySnapshot format
    console.log('[CampaignMonitor] Step 2: Processing campaign snapshots...');
    const campaigns: CampaignDailySnapshot[] = prometheusResult.report.matchedCampaigns.map((m: any) => ({
      campaignId: m.linkedin.batchId || m.linkedin.batchName,
      campaignName: m.linkedin.batchName,
      company: m.linkedin.company,
      role: m.linkedin.role,
      spendToday: m.linkedin.totalSpend,
      resumesToday: m.internal.resumes,
      costPerResume: m.internal.resumes > 0 ? m.linkedin.totalSpend / m.internal.resumes : Infinity,
      timestamp: timeInfo.timestamp,
      hourOfDay: timeInfo.hour,
      dayOfWeek: timeInfo.dayOfWeek,
      isWeekend: timeInfo.isWeekend,
    }));

    console.log(`[CampaignMonitor] Found ${campaigns.length} campaigns to analyze`);

    // Step 3: Calculate breaches
    console.log('[CampaignMonitor] Step 3: Identifying breached campaigns...');
    const breachedCampaigns = calculateBreaches(campaigns);
    console.log(`[CampaignMonitor] ${breachedCampaigns.length} campaigns breached thresholds`);

    if (breachedCampaigns.length === 0) {
      console.log('[CampaignMonitor] ✅ All campaigns within budget!');
      return {
        success: true,
        timestamp: new Date().toISOString(),
        timeIST: timeStr,
        campaignsAnalyzed: campaigns.length,
        breachedCampaigns: 0,
        alertsSent: 0,
        alertsSkipped: 0,
        details: {
          campaigns: campaigns.map(c => ({
            company: c.company,
            role: c.role,
            spend: c.spendToday,
            resumes: c.resumesToday,
            cpr: c.costPerResume,
            alertSent: false,
          })),
          thresholdUsed: ALERT_CONFIG.cprThreshold,
        },
      };
    }

    // Step 4: AI Analysis
    console.log('[CampaignMonitor] Step 4: Running AI analysis...');
    const analysisResults = await generateAIAnalysis(breachedCampaigns);
    console.log(`[CampaignMonitor] Generated ${analysisResults.length} analysis results`);

    // Step 5: Send Slack alerts (with deduplication)
    console.log('[CampaignMonitor] Step 5: Sending Slack alerts...');
    let alertsSent = 0;
    let alertsSkipped = 0;

    const campaignDetails: MonitorResult['details']['campaigns'] = [];

    for (const result of analysisResults) {
      const shouldSend = shouldSendAlert(result);

      if (shouldSend) {
        const sent = await sendToSlack(result);
        if (sent) {
          recordAlert(result);
          alertsSent++;
          console.log(`[CampaignMonitor] 📤 Alert sent: ${result.company} - ${result.role} (${result.severity})`);
        }
      } else {
        alertsSkipped++;
        console.log(`[CampaignMonitor] ⏭️ Skipped (dedup): ${result.company} - ${result.role}`);
      }

      campaignDetails.push({
        company: result.company,
        role: result.role,
        spend: result.metrics.spendToday,
        resumes: result.metrics.resumesToday,
        cpr: result.metrics.costPerResume,
        severity: result.severity,
        alertSent: shouldSend,
      });
    }

    // Add non-breached campaigns to details
    for (const campaign of campaigns) {
      if (!breachedCampaigns.find(b => b.campaignId === campaign.campaignId)) {
        campaignDetails.push({
          company: campaign.company,
          role: campaign.role,
          spend: campaign.spendToday,
          resumes: campaign.resumesToday,
          cpr: campaign.costPerResume,
          alertSent: false,
        });
      }
    }

    console.log(`[CampaignMonitor] ═══════════════════════════════════════════`);
    console.log(`[CampaignMonitor] Check complete: ${alertsSent} alerts sent, ${alertsSkipped} skipped`);
    console.log(`[CampaignMonitor] ═══════════════════════════════════════════\n`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      timeIST: timeStr,
      campaignsAnalyzed: campaigns.length,
      breachedCampaigns: breachedCampaigns.length,
      alertsSent,
      alertsSkipped,
      details: {
        campaigns: campaignDetails,
        thresholdUsed: ALERT_CONFIG.cprThreshold,
      },
    };

  } catch (error: any) {
    console.error('[CampaignMonitor] Error:', error);
    return {
      success: false,
      timestamp: new Date().toISOString(),
      timeIST: timeStr,
      campaignsAnalyzed: 0,
      breachedCampaigns: 0,
      alertsSent: 0,
      alertsSkipped: 0,
      details: {
        campaigns: [],
        thresholdUsed: ALERT_CONFIG.cprThreshold,
      },
      error: error.message,
    };
  }
}

/**
 * Get status of today's alerts (for debugging)
 */
export function getMonitorStatus(): {
  todaysAlerts: ReturnType<typeof getTodaysAlerts>;
  config: typeof ALERT_CONFIG;
  currentTime: string;
} {
  return {
    todaysAlerts: getTodaysAlerts(),
    config: ALERT_CONFIG,
    currentTime: getISTTimeString(),
  };
}
