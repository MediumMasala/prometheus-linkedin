// AI Analysis Tool - Uses Claude to generate contextual campaign insights

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ALERT_CONFIG, getISTTimeString } from '../config.js';
import { formatINR } from '../utils/currency.js';
import type { BreachedCampaign, AnalysisResult } from '../types.js';

// Get API key at runtime
function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY || '';
}

/**
 * Determine severity based on metrics and time of day
 */
function determineSeverity(campaign: BreachedCampaign): 'warning' | 'critical' {
  const { costPerResume, resumesToday, spendToday, hourOfDay, isWeekend } = campaign;

  // Critical conditions (always)
  if (costPerResume >= ALERT_CONFIG.criticalCprThreshold) {
    return 'critical';
  }

  // Zero resumes with significant spend
  if (resumesToday === 0 && spendToday >= ALERT_CONFIG.zeroCostThreshold) {
    return 'critical';
  }

  // Late in the day - unlikely to recover
  if (hourOfDay >= ALERT_CONFIG.lateDayCutoff && costPerResume > ALERT_CONFIG.cprThreshold) {
    return 'critical';
  }

  // End of day - definitely critical
  if (hourOfDay >= ALERT_CONFIG.endOfDayCutoff) {
    return 'critical';
  }

  // Weekend with high CPR after noon
  if (isWeekend && hourOfDay >= 12 && costPerResume > ALERT_CONFIG.cprThreshold) {
    return 'critical';
  }

  // Default to warning (might recover)
  return 'warning';
}

/**
 * Call Claude/OpenAI to generate contextual analysis
 */
async function generateAIAnalysis(
  campaigns: BreachedCampaign[]
): Promise<AnalysisResult[]> {
  if (campaigns.length === 0) return [];

  const currentTime = getISTTimeString();

  // Build context for AI
  const campaignsContext = campaigns.map((c, i) => {
    const severity = determineSeverity(c);
    return `${i + 1}. ${c.company} - ${c.role}
   - Spend Today: ${formatINR(c.spendToday)}
   - Resumes Today: ${c.resumesToday}
   - Cost Per Resume: ${c.resumesToday > 0 ? formatINR(c.costPerResume) : 'No resumes yet'}
   - Current Hour: ${c.hourOfDay}:00 IST
   - Day: ${c.isWeekend ? 'Weekend' : 'Weekday'}
   - Breach Type: ${c.breachType}
   - Preliminary Severity: ${severity}`;
  }).join('\n\n');

  const systemPrompt = `You are a LinkedIn campaign performance analyst for a recruiting company. Your job is to analyze campaign cost-per-resume data and generate concise, actionable Slack alerts.

THRESHOLDS:
- Target CPR: ₹400 or below
- Critical CPR: ₹600+
- Zero resume alert: ₹500+ spend with 0 resumes

TIME CONTEXT (IST):
- Before 10 AM: Very early, resume inflow typically picks up later
- 10 AM - 12 PM: Morning ramp-up period
- 12 PM - 3 PM: Peak hours for resume submission
- After 3 PM: Late day, recovery unlikely
- After 8 PM: Day is essentially over
- Weekends: Naturally lower inflow, be more lenient

YOUR TASK:
For each breached campaign, generate:
1. severity: "warning" or "critical"
2. assessment: 1-2 sentences explaining WHY this is concerning and what pattern you see
3. suggestedAction: A specific, actionable recommendation

TONE: Direct, professional, no fluff. The team glances at these between meetings.

IMPORTANT: Return ONLY a valid JSON array, no other text.`;

  const userPrompt = `Current Time: ${currentTime}

BREACHED CAMPAIGNS:
${campaignsContext}

For each campaign, return a JSON array with objects containing:
{
  "campaignIndex": number (1-based),
  "severity": "warning" | "critical",
  "assessment": "string (1-2 sentences)",
  "suggestedAction": "string (specific action)"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getOpenAIKey()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      console.error('[AnalyzeCost] OpenAI API error:', response.status);
      // Fall back to rule-based analysis
      return campaigns.map(c => createFallbackAnalysis(c));
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[AnalyzeCost] Failed to parse AI response, using fallback');
      return campaigns.map(c => createFallbackAnalysis(c));
    }

    const aiResults = JSON.parse(jsonMatch[0]);

    // Map AI results to our format
    return campaigns.map((campaign, index) => {
      const aiResult = aiResults.find((r: any) => r.campaignIndex === index + 1);

      if (!aiResult) {
        return createFallbackAnalysis(campaign);
      }

      const severity = aiResult.severity || determineSeverity(campaign);
      const currentTime = getISTTimeString();

      return {
        severity,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        company: campaign.company,
        role: campaign.role,
        message: formatSlackMessage(campaign, severity, aiResult.assessment, aiResult.suggestedAction, currentTime),
        assessment: aiResult.assessment,
        suggestedAction: aiResult.suggestedAction,
        metrics: {
          spendToday: campaign.spendToday,
          resumesToday: campaign.resumesToday,
          costPerResume: campaign.costPerResume,
        },
        breachType: campaign.breachType,
      };
    });

  } catch (error) {
    console.error('[AnalyzeCost] AI analysis failed:', error);
    return campaigns.map(c => createFallbackAnalysis(c));
  }
}

/**
 * Create fallback analysis when AI is unavailable
 */
function createFallbackAnalysis(campaign: BreachedCampaign): AnalysisResult {
  const severity = determineSeverity(campaign);
  const currentTime = getISTTimeString();

  let assessment: string;
  let suggestedAction: string;

  if (campaign.resumesToday === 0) {
    assessment = `Campaign has spent ${formatINR(campaign.spendToday)} with zero resumes received. This needs immediate attention.`;
    suggestedAction = 'Consider pausing this campaign until targeting is reviewed.';
  } else if (campaign.hourOfDay >= ALERT_CONFIG.lateDayCutoff) {
    assessment = `Late in the day with CPR at ${formatINR(campaign.costPerResume)}. Unlikely to improve today.`;
    suggestedAction = 'Review tomorrow morning. Consider reducing daily budget.';
  } else {
    assessment = `CPR currently at ${formatINR(campaign.costPerResume)}, above the ${formatINR(ALERT_CONFIG.cprThreshold)} threshold.`;
    suggestedAction = campaign.hourOfDay < ALERT_CONFIG.earlyDayCutoff
      ? 'Monitor for 2 more hours - might improve with daytime traffic.'
      : 'Consider reducing bids or pausing if no improvement in 1 hour.';
  }

  return {
    severity,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    company: campaign.company,
    role: campaign.role,
    message: formatSlackMessage(campaign, severity, assessment, suggestedAction, currentTime),
    assessment,
    suggestedAction,
    metrics: {
      spendToday: campaign.spendToday,
      resumesToday: campaign.resumesToday,
      costPerResume: campaign.costPerResume,
    },
    breachType: campaign.breachType,
  };
}

/**
 * Format the Slack message
 */
function formatSlackMessage(
  campaign: BreachedCampaign,
  severity: 'warning' | 'critical',
  assessment: string,
  suggestedAction: string,
  currentTime: string
): string {
  const emoji = severity === 'critical' ? '🚨' : '⚠️';
  const cprDisplay = campaign.resumesToday > 0
    ? formatINR(campaign.costPerResume)
    : '∞ (no resumes)';

  return `${emoji} *Campaign Alert — ${campaign.company} | ${campaign.role}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *Today's Numbers (as of ${currentTime}):*
• Spend: ${formatINR(campaign.spendToday)}
• Resumes Received: ${campaign.resumesToday}
• Cost Per Resume: ${cprDisplay}

${severity === 'critical' ? '🚨' : '⚠️'} *CPR has crossed the ${formatINR(ALERT_CONFIG.cprThreshold)} threshold.*

💡 *Assessment:* ${assessment}

🔧 *Suggested Action:* ${suggestedAction}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// Mastra Tool Definition
export const analyzeCampaignCostTool = createTool({
  id: 'analyze-campaign-cost',
  description: 'Analyze breached campaigns using AI to generate contextual insights and Slack-ready messages',
  inputSchema: z.object({
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
  }),
  outputSchema: z.object({
    results: z.array(z.object({
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
    analysisMethod: z.enum(['ai', 'fallback']),
  }),
  execute: async ({ context }) => {
    const { breachedCampaigns } = context;

    console.log(`[AnalyzeCost] Analyzing ${breachedCampaigns.length} breached campaigns`);

    if (breachedCampaigns.length === 0) {
      return { results: [], analysisMethod: 'ai' as const };
    }

    const results = await generateAIAnalysis(breachedCampaigns as BreachedCampaign[]);

    // Determine if we used AI or fallback
    const analysisMethod: 'ai' | 'fallback' = getOpenAIKey() ? 'ai' : 'fallback';

    console.log(`[AnalyzeCost] Generated ${results.length} analysis results using ${analysisMethod}`);

    return { results, analysisMethod };
  },
});

// Export standalone function for direct use
export { generateAIAnalysis, determineSeverity };
