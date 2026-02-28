// Slack notification system for Prometheus alerts

interface SlackMessage {
  text: string;
  blocks?: any[];
}

interface CostAlert {
  batchName: string;
  company: string;
  role: string;
  costPerResume: number;
  threshold: number;
  spend: number;
  resumes: number;
}

// Get Slack webhook URL from environment
function getSlackWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL || null;
}

// Get alert threshold from environment (default ₹500)
export function getAlertThreshold(): number {
  return parseInt(process.env.COST_ALERT_THRESHOLD || '500', 10);
}

// Send a message to Slack
export async function sendSlackMessage(message: SlackMessage): Promise<boolean> {
  const webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    console.log('[Slack] No webhook URL configured, skipping notification');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send message:', response.statusText);
      return false;
    }

    console.log('[Slack] Message sent successfully');
    return true;
  } catch (error) {
    console.error('[Slack] Error sending message:', error);
    return false;
  }
}

// Format currency in INR
function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Send cost per resume alert
export async function sendCostAlert(alerts: CostAlert[]): Promise<boolean> {
  if (alerts.length === 0) return true;

  const threshold = getAlertThreshold();

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 Cost Per Resume Alert`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alerts.length} campaign(s)* have exceeded the cost threshold of *${formatINR(threshold)}* per resume.`,
      },
    },
    { type: 'divider' },
  ];

  // Add each alert as a section
  for (const alert of alerts.slice(0, 10)) { // Limit to 10 to avoid message size issues
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alert.company} - ${alert.role}*\n` +
          `• Cost/Resume: *${formatINR(alert.costPerResume)}* ❌\n` +
          `• Total Spend: ${formatINR(alert.spend)}\n` +
          `• Resumes: ${alert.resumes}`,
      },
    } as any);
  }

  if (alerts.length > 10) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_...and ${alerts.length - 10} more campaigns_`,
      },
    } as any);
  }

  blocks.push(
    { type: 'divider' } as any,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `💡 *Recommendation:* Consider reducing bids or pausing these campaigns to optimize ROI.`,
        },
      ],
    } as any,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_Sent by Prometheus Campaign Analyzer_`,
        },
      ],
    } as any
  );

  return sendSlackMessage({
    text: `🚨 ${alerts.length} campaign(s) exceeded cost threshold of ${formatINR(threshold)}/resume`,
    blocks,
  });
}

// Check campaigns and send alerts if needed
export async function checkAndAlertHighCosts(
  matchedCampaigns: Array<{
    linkedin: { batchName: string; company: string; role: string; totalSpend: number };
    internal: { resumes: number };
    combined: { costPerResume: number };
  }>
): Promise<{ alertsSent: number; alertsTriggered: CostAlert[] }> {
  const threshold = getAlertThreshold();

  const alertsTriggered: CostAlert[] = matchedCampaigns
    .filter((m) => m.combined.costPerResume > threshold && m.internal.resumes > 0)
    .map((m) => ({
      batchName: m.linkedin.batchName,
      company: m.linkedin.company,
      role: m.linkedin.role,
      costPerResume: m.combined.costPerResume,
      threshold,
      spend: m.linkedin.totalSpend,
      resumes: m.internal.resumes,
    }));

  if (alertsTriggered.length > 0) {
    const sent = await sendCostAlert(alertsTriggered);
    return { alertsSent: sent ? alertsTriggered.length : 0, alertsTriggered };
  }

  return { alertsSent: 0, alertsTriggered: [] };
}

// Send daily summary to Slack
export async function sendDailySummary(data: {
  totalSpend: number;
  totalResumes: number;
  avgCostPerResume: number;
  paidResumes: number;
  organicResumes: number;
  topPerformers: Array<{ company: string; role: string; costPerResume: number; resumes: number }>;
  worstPerformers: Array<{ company: string; role: string; costPerResume: number; resumes: number }>;
}): Promise<boolean> {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 Daily Campaign Summary`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Spend*\n${formatINR(data.totalSpend)}` },
        { type: 'mrkdwn', text: `*Total Resumes*\n${data.totalResumes}` },
        { type: 'mrkdwn', text: `*Avg Cost/Resume*\n${formatINR(data.avgCostPerResume)}` },
        { type: 'mrkdwn', text: `*Paid vs Organic*\n${data.paidResumes} / ${data.organicResumes}` },
      ],
    },
    { type: 'divider' },
  ];

  if (data.topPerformers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🏆 Top Performers (Lowest Cost/Resume)*\n` +
          data.topPerformers
            .slice(0, 3)
            .map((p, i) => `${i + 1}. ${p.company} - ${p.role}: ${formatINR(p.costPerResume)} (${p.resumes} resumes)`)
            .join('\n'),
      },
    } as any);
  }

  if (data.worstPerformers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ Needs Attention (Highest Cost/Resume)*\n` +
          data.worstPerformers
            .slice(0, 3)
            .map((p, i) => `${i + 1}. ${p.company} - ${p.role}: ${formatINR(p.costPerResume)} (${p.resumes} resumes)`)
            .join('\n'),
      },
    } as any);
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Generated by Prometheus at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}_`,
      },
    ],
  } as any);

  return sendSlackMessage({
    text: `📊 Daily Summary: ${formatINR(data.totalSpend)} spent, ${data.totalResumes} resumes, ${formatINR(data.avgCostPerResume)}/resume`,
    blocks,
  });
}
