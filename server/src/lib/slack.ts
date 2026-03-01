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

// Get alert threshold from environment (default ₹350)
export function getAlertThreshold(): number {
  return parseInt(process.env.COST_ALERT_THRESHOLD || '350', 10);
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

// Campaign-level alert for cron job
interface CampaignAlert {
  company: string;
  role: string;
  campaignName: string;
  spend: number;
  resumes: number;
  costPerResume: number;
  excessAmount: number; // How much over threshold
}

// Send campaign-level alert with friendly message
export async function sendCampaignAlert(alerts: CampaignAlert[]): Promise<boolean> {
  if (alerts.length === 0) return true;

  const threshold = getAlertThreshold();
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit'
  });

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `⚠️ Campaign Cost Alert`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hey team! 👋\n\nJust checked our LinkedIn campaigns and found *${alerts.length} campaign(s)* spending more than *${formatINR(threshold)}/resume*. Please look into it once.`,
      },
    },
    { type: 'divider' },
  ];

  // Add each campaign alert
  for (const alert of alerts.slice(0, 8)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alert.company} - ${alert.role}*\n` +
          `This campaign has spent *${formatINR(alert.costPerResume)}/resume* — that's *${formatINR(alert.excessAmount)} more* than our ${formatINR(threshold)} target.\n` +
          `📊 Spend: ${formatINR(alert.spend)} | Resumes: ${alert.resumes}`,
      },
    });
  }

  if (alerts.length > 8) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_...and ${alerts.length - 8} more campaigns need attention_`,
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `💡 *Suggestion:* Consider reducing bids or pausing these campaigns to improve ROI.\n_Checked at ${time} IST by Prometheus_`,
        },
      ],
    }
  );

  return sendSlackMessage({
    text: `⚠️ ${alerts.length} campaign(s) exceeding ${formatINR(threshold)}/resume - please look into it`,
    blocks,
  });
}

// Check individual campaigns and send alerts (for cron job)
export async function checkCampaignCosts(
  campaigns: Array<{
    company: string;
    role: string;
    campaignName: string;
    spend: number;
    resumes: number;
  }>
): Promise<{ alertsSent: number; campaignsExceeded: number; alerts: CampaignAlert[] }> {
  const threshold = getAlertThreshold();

  const alerts: CampaignAlert[] = campaigns
    .filter((c) => c.resumes > 0 && (c.spend / c.resumes) > threshold)
    .map((c) => {
      const costPerResume = c.spend / c.resumes;
      return {
        company: c.company,
        role: c.role,
        campaignName: c.campaignName,
        spend: c.spend,
        resumes: c.resumes,
        costPerResume,
        excessAmount: costPerResume - threshold,
      };
    })
    .sort((a, b) => b.costPerResume - a.costPerResume); // Worst first

  if (alerts.length > 0) {
    const sent = await sendCampaignAlert(alerts);
    return { alertsSent: sent ? alerts.length : 0, campaignsExceeded: alerts.length, alerts };
  }

  return { alertsSent: 0, campaignsExceeded: 0, alerts: [] };
}

// Daily alert data structure
interface DailyAlert {
  date: string;
  totalSpend: number;
  totalResumes: number;
  costPerResume: number;
  paidResumes: number;
  campaigns: Array<{ company: string; role: string; spend: number; resumes: number; costPerResume: number }>;
}

// Send daily cost per resume alert
export async function sendDailyCostAlert(alerts: DailyAlert[]): Promise<boolean> {
  if (alerts.length === 0) return true;

  const threshold = getAlertThreshold();

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 Daily Cost/Resume Alert`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${alerts.length} day(s)* exceeded the cost threshold of *${formatINR(threshold)}* per resume.`,
      },
    },
    { type: 'divider' },
  ];

  // Add each day's alert
  for (const alert of alerts.slice(0, 5)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📅 ${alert.date}*\n` +
          `• Cost/Resume: *${formatINR(alert.costPerResume)}* ❌\n` +
          `• Total Spend: ${formatINR(alert.totalSpend)}\n` +
          `• Paid Resumes: ${alert.paidResumes}`,
      },
    });

    // Show top 3 worst performers for this day
    if (alert.campaigns.length > 0) {
      const worstCampaigns = alert.campaigns
        .filter(c => c.resumes > 0)
        .sort((a, b) => b.costPerResume - a.costPerResume)
        .slice(0, 3);

      if (worstCampaigns.length > 0) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_Worst performers:_ ` + worstCampaigns
                .map(c => `${c.company} ${c.role} (${formatINR(c.costPerResume)})`)
                .join(' · '),
            },
          ],
        });
      }
    }

    blocks.push({ type: 'divider' });
  }

  if (alerts.length > 5) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_...and ${alerts.length - 5} more days_`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `💡 *Action:* Review campaign bids and targeting for these days. | _Prometheus Analyzer_`,
      },
    ],
  });

  return sendSlackMessage({
    text: `🚨 ${alerts.length} day(s) exceeded ${formatINR(threshold)}/resume threshold`,
    blocks,
  });
}

// Check daily data and send alerts
export async function checkDailyCosts(
  dailyData: Array<{
    date: string;
    totalSpend: number;
    paidResumes: number;
    campaigns: Array<{ company: string; role: string; spend: number; resumes: number }>;
  }>
): Promise<{ alertsSent: number; daysExceeded: number }> {
  const threshold = getAlertThreshold();

  const alertDays: DailyAlert[] = dailyData
    .map((day) => {
      const costPerResume = day.paidResumes > 0 ? day.totalSpend / day.paidResumes : 0;
      return {
        date: day.date,
        totalSpend: day.totalSpend,
        totalResumes: day.paidResumes,
        costPerResume,
        paidResumes: day.paidResumes,
        campaigns: day.campaigns.map(c => ({
          ...c,
          costPerResume: c.resumes > 0 ? c.spend / c.resumes : 0,
        })),
      };
    })
    .filter((day) => day.costPerResume > threshold && day.paidResumes > 0);

  if (alertDays.length > 0) {
    const sent = await sendDailyCostAlert(alertDays);
    return { alertsSent: sent ? alertDays.length : 0, daysExceeded: alertDays.length };
  }

  return { alertsSent: 0, daysExceeded: 0 };
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

// ============================================
// SCHEDULED REPORTS - Morning, Status, EOD
// ============================================

export interface ScheduledReportData {
  date: string;
  totalSpend: number;
  paidResumes: number;
  organicResumes: number;
  avgCostPerResume: number;
  campaigns: Array<{
    company: string;
    role: string;
    spend: number;
    paidResumes: number;
    costPerResume: number;
  }>;
}

// Get current time in IST formatted nicely
function getISTTime(): string {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Get date string in readable format
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * 8:30 AM - Yesterday's Expense Summary
 */
export async function sendMorningSummary(data: ScheduledReportData): Promise<boolean> {
  const threshold = getAlertThreshold();

  // Get top and worst performers
  const campaignsWithResumes = data.campaigns.filter(c => c.paidResumes > 0);
  const topPerformers = [...campaignsWithResumes]
    .sort((a, b) => a.costPerResume - b.costPerResume)
    .slice(0, 3);
  const worstPerformers = [...campaignsWithResumes]
    .sort((a, b) => b.costPerResume - a.costPerResume)
    .slice(0, 3);

  const totalResumes = data.paidResumes + data.organicResumes;

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `☀️ Good Morning! Yesterday's Expense Summary`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📊 ${formatDate(data.date)} - Aggregate*\n━━━━━━━━━━━━━━━━━━━━━━━━━`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Spend*\n${formatINR(data.totalSpend)}` },
        { type: 'mrkdwn', text: `*Total Resumes*\n${totalResumes}` },
        { type: 'mrkdwn', text: `*Paid | Organic*\n${data.paidResumes} | ${data.organicResumes}` },
        { type: 'mrkdwn', text: `*Avg CPR*\n${data.paidResumes > 0 ? formatINR(data.avgCostPerResume) : 'N/A'}` },
      ],
    },
    { type: 'divider' },
  ];

  // Top Performers
  if (topPerformers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🏆 Top Performers (Lowest CPR)*\n` +
          topPerformers
            .map(c => `• ${c.company} - ${c.role}: *${formatINR(c.costPerResume)}*/resume (${c.paidResumes} resumes)`)
            .join('\n'),
      },
    });
  }

  // Worst Performers
  if (worstPerformers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ Underperformers (Highest CPR)*\n` +
          worstPerformers
            .map(c => `• ${c.company} - ${c.role}: *${formatINR(c.costPerResume)}*/resume (${c.paidResumes} resumes)`)
            .join('\n'),
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Threshold: ${formatINR(threshold)}/resume | Sent by Prometheus_`,
      },
    ],
  });

  return sendSlackMessage({
    text: `☀️ Yesterday's Summary: ${formatINR(data.totalSpend)} spent, ${totalResumes} resumes`,
    blocks,
  });
}

/**
 * Status Update - Only sends if there are critical campaigns
 * Critical = CPR > threshold OR zero resumes with significant spend
 */
export async function sendStatusUpdate(data: ScheduledReportData): Promise<boolean> {
  const threshold = getAlertThreshold();
  const time = getISTTime();

  // Find critical campaigns
  const criticalCampaigns = data.campaigns.filter(
    c => (c.paidResumes === 0 && c.spend >= 500) || (c.paidResumes > 0 && c.costPerResume > threshold)
  ).sort((a, b) => b.costPerResume - a.costPerResume); // Worst first

  // If no critical campaigns, don't send anything
  if (criticalCampaigns.length === 0) {
    console.log('[Slack] No critical campaigns - skipping alert');
    return true;
  }

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 Campaign Alert (${time} IST)`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${criticalCampaigns.length} campaign(s)* need attention — CPR exceeds *${formatINR(threshold)}* threshold.`,
      },
    },
    { type: 'divider' },
  ];

  // List critical campaigns
  for (const c of criticalCampaigns.slice(0, 8)) {
    const status = c.paidResumes === 0
      ? `${formatINR(c.spend)} spent, *0 resumes* ❌`
      : `*${formatINR(c.costPerResume)}*/resume (${c.paidResumes} resumes) ⚠️`;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${c.company} - ${c.role}*\n${status}`,
      },
    });
  }

  if (criticalCampaigns.length > 8) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_...and ${criticalCampaigns.length - 8} more_` }],
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `💡 Consider reducing bids or pausing these campaigns | _Prometheus_`,
        },
      ],
    }
  );

  return sendSlackMessage({
    text: `🚨 ${criticalCampaigns.length} campaign(s) exceed ${formatINR(threshold)}/resume - please review`,
    blocks,
  });
}

/**
 * Midnight - End of Day Summary
 */
export async function sendEndOfDaySummary(data: ScheduledReportData): Promise<boolean> {
  const threshold = getAlertThreshold();
  const totalResumes = data.paidResumes + data.organicResumes;

  // Calculate campaign stats
  const campaignsWithResumes = data.campaigns.filter(c => c.paidResumes > 0);
  const withinBudget = campaignsWithResumes.filter(c => c.costPerResume <= threshold);
  const overBudget = campaignsWithResumes.filter(c => c.costPerResume > threshold);

  const withinBudgetPercent = campaignsWithResumes.length > 0
    ? Math.round((withinBudget.length / campaignsWithResumes.length) * 100)
    : 0;

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🌙 End of Day Summary - ${formatDate(data.date)}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📊 Final Numbers*\n━━━━━━━━━━━━━━━━━━━━━━━━━`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Spend*\n${formatINR(data.totalSpend)}` },
        { type: 'mrkdwn', text: `*Total Resumes*\n${totalResumes}` },
        { type: 'mrkdwn', text: `*Paid | Organic*\n${data.paidResumes} | ${data.organicResumes}` },
        { type: 'mrkdwn', text: `*Final CPR*\n${data.paidResumes > 0 ? formatINR(data.avgCostPerResume) : 'N/A'}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📉 Day Performance*\n` +
          `• Campaigns Run: ${data.campaigns.length}\n` +
          `• Within Budget: ${withinBudget.length} (${withinBudgetPercent}%)\n` +
          `• Over Budget: ${overBudget.length} (${100 - withinBudgetPercent}%)`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_See you tomorrow! 🚀 | Prometheus_`,
        },
      ],
    },
  ];

  return sendSlackMessage({
    text: `🌙 EOD Summary: ${formatINR(data.totalSpend)} spent, ${totalResumes} resumes, ${withinBudgetPercent}% within budget`,
    blocks,
  });
}
