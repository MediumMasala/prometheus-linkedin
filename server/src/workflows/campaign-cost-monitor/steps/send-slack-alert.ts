// Send Slack Alerts with Deduplication

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { shouldSendAlert, recordAlert } from '../utils/deduplication.js';
import { ALERT_CONFIG, getISTTimeString } from '../config.js';
import { formatINR } from '../utils/currency.js';
import type { AnalysisResult } from '../types.js';

// Get Slack webhook URL
function getSlackWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL || null;
}

/**
 * Send a single alert to Slack
 */
async function sendToSlack(result: AnalysisResult): Promise<boolean> {
  const webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    console.log('[SlackAlert] No webhook URL configured');
    return false;
  }

  const emoji = result.severity === 'critical' ? '🚨' : '⚠️';
  const severityLabel = result.severity === 'critical' ? 'CRITICAL' : 'WARNING';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Campaign Alert — ${result.company} | ${result.role}*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Spend Today*\n${formatINR(result.metrics.spendToday)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Resumes*\n${result.metrics.resumesToday}`,
        },
        {
          type: 'mrkdwn',
          text: `*Cost/Resume*\n${result.metrics.resumesToday > 0 ? formatINR(result.metrics.costPerResume) : '∞'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status*\n${severityLabel}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `💡 *Assessment:* ${result.assessment}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔧 *Suggested Action:* ${result.suggestedAction}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_Checked at ${getISTTimeString()} IST | Threshold: ${formatINR(ALERT_CONFIG.cprThreshold)}/resume | Prometheus_`,
        },
      ],
    },
    {
      type: 'divider',
    },
  ];

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} ${result.company} - ${result.role}: CPR ${formatINR(result.metrics.costPerResume)} [${severityLabel}]`,
        blocks,
      }),
    });

    if (!response.ok) {
      console.error('[SlackAlert] Failed to send:', response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[SlackAlert] Error:', error);
    return false;
  }
}

/**
 * Send summary message when multiple campaigns breach
 */
async function sendSummary(
  results: AnalysisResult[],
  sentCount: number,
  skippedCount: number
): Promise<boolean> {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) return false;

  const criticalCount = results.filter(r => r.severity === 'critical').length;
  const warningCount = results.filter(r => r.severity === 'warning').length;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 Campaign Monitor Summary`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hey team! 👋 Just ran the campaign cost check.\n\n` +
          `*${results.length} campaign(s)* are over the ${formatINR(ALERT_CONFIG.cprThreshold)}/resume threshold.\n` +
          `• 🚨 Critical: ${criticalCount}\n` +
          `• ⚠️ Warning: ${warningCount}\n\n` +
          `_Alerts sent: ${sentCount} | Skipped (dedup): ${skippedCount}_`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_${getISTTimeString()} IST | Prometheus Campaign Monitor_`,
        },
      ],
    },
  ];

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📊 Campaign Summary: ${criticalCount} critical, ${warningCount} warnings`,
        blocks,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('[SlackAlert] Summary error:', error);
    return false;
  }
}

// Mastra Tool Definition
export const sendSlackAlertTool = createTool({
  id: 'send-slack-alert',
  description: 'Send analyzed campaign alerts to Slack with deduplication',
  inputSchema: z.object({
    analysisResults: z.array(z.object({
      severity: z.enum(['warning', 'critical']),
      campaignId: z.string(),
      campaignName: z.string(),
      company: z.string(),
      role: z.string(),
      message: z.string(),
      assessment: z.string(),
      suggestedAction: z.string(),
      metrics: z.object({
        spendToday: z.number(),
        resumesToday: z.number(),
        costPerResume: z.number(),
      }),
      breachType: z.enum(['high_cpr', 'zero_resumes', 'critical_cpr']),
    })),
    sendSummary: z.boolean().optional(),
  }),
  outputSchema: z.object({
    alertsSent: z.number(),
    alertsSkipped: z.number(),
    summaryStent: z.boolean(),
    details: z.array(z.object({
      campaignId: z.string(),
      company: z.string(),
      role: z.string(),
      severity: z.enum(['warning', 'critical']),
      sent: z.boolean(),
      reason: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    const { analysisResults, sendSummary: shouldSendSummary = false } = context;

    console.log(`[SlackAlert] Processing ${analysisResults.length} alerts`);

    const details: Array<{
      campaignId: string;
      company: string;
      role: string;
      severity: 'warning' | 'critical';
      sent: boolean;
      reason: string;
    }> = [];

    let alertsSent = 0;
    let alertsSkipped = 0;

    for (const result of analysisResults as AnalysisResult[]) {
      // Check deduplication
      if (!shouldSendAlert(result)) {
        alertsSkipped++;
        details.push({
          campaignId: result.campaignId,
          company: result.company,
          role: result.role,
          severity: result.severity,
          sent: false,
          reason: 'Deduplicated (recently alerted)',
        });
        continue;
      }

      // Send alert
      const sent = await sendToSlack(result);

      if (sent) {
        recordAlert(result);
        alertsSent++;
        details.push({
          campaignId: result.campaignId,
          company: result.company,
          role: result.role,
          severity: result.severity,
          sent: true,
          reason: 'Alert sent successfully',
        });
      } else {
        details.push({
          campaignId: result.campaignId,
          company: result.company,
          role: result.role,
          severity: result.severity,
          sent: false,
          reason: 'Failed to send (Slack error)',
        });
      }
    }

    // Send summary if requested and there were multiple alerts
    let summarySent = false;
    if (shouldSendSummary && analysisResults.length > 1) {
      summarySent = await sendSummary(analysisResults as AnalysisResult[], alertsSent, alertsSkipped);
    }

    console.log(`[SlackAlert] Sent: ${alertsSent}, Skipped: ${alertsSkipped}`);

    return {
      alertsSent,
      alertsSkipped,
      summaryStent: summarySent,
      details,
    };
  },
});

// Export standalone functions
export { sendToSlack, sendSummary };
