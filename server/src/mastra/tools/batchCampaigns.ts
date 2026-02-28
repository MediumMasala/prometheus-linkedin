import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  aggregateBatchMetrics,
  buildVariantBreakdown,
} from '../../lib/utils.js';
import type {
  CampaignBatch,
  CampaignVariant,
  LinkedInCampaign,
  ParsingWarning,
  VariantType,
  InternalRole,
} from '../../types/index.js';

// Read API key at runtime, not module load time
function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY || '';
}

// Variant detection patterns
const VARIANT_PATTERNS: { pattern: RegExp; type: VariantType }[] = [
  { pattern: /pedigree\s*jt|jt\s*pedigree/i, type: 'pedigree_jt' },
  { pattern: /company\s*tg|compan[yi]es?\s*tg/i, type: 'company_tg' },
  { pattern: /\bpedigree[s]?\b/i, type: 'pedigree' },
  { pattern: /\bjt\b|job\s*title/i, type: 'job_title' },
  { pattern: /\bcommunity\b/i, type: 'community' },
  { pattern: /\bstartup[s]?\b/i, type: 'startups' },
  { pattern: /\bgeo\b|bangalore|bengaluru|delhi|mumbai|hyderabad|chennai/i, type: 'geo' },
];

function detectVariant(campaignName: string): VariantType {
  for (const { pattern, type } of VARIANT_PATTERNS) {
    if (pattern.test(campaignName)) {
      return type;
    }
  }
  return 'base';
}

interface AIBatchingResult {
  campaignId: string;
  matchedRoleKey: string | null; // "companyName|jobTitle" or null if unmatched
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Call OpenAI to match campaigns to internal roles
 */
async function callOpenAIForBatching(
  campaigns: { campaignId: string; name: string }[],
  internalRoles: InternalRole[]
): Promise<AIBatchingResult[]> {
  if (campaigns.length === 0) {
    return [];
  }

  // Build the list of available roles
  const rolesContext = internalRoles
    .slice(0, 50) // Limit to top 50 roles
    .map((r, i) => `${i + 1}. Company: "${r.companyName}", Role: "${r.jobTitle}" (${r.resumes} resumes)`)
    .join('\n');

  const campaignsContext = campaigns
    .map((c, i) => `${i + 1}. "${c.name}" (ID: ${c.campaignId})`)
    .join('\n');

  const systemPrompt = `You are an expert at matching LinkedIn advertising campaigns to job roles.

You have a list of INTERNAL JOB ROLES that companies are actively hiring for.
You need to match each LINKEDIN CAMPAIGN to the most appropriate internal role.

IMPORTANT RULES:
1. Match campaigns to roles based on COMPANY NAME and JOB TITLE similarity
2. "Sarvam - AI Backend - Company TG" should match role "AI Backend Engineer" at "Sarvam"
3. "Sarvam - ML Eng - pedigree" should match role "ML Engineer" at "Sarvam"
4. Different roles at the same company should be SEPARATE batches (e.g., "AI Backend" and "ML Engineer" are different)
5. Campaign variants (Pedigree, Company TG, etc.) don't affect the role matching - they're targeting variants
6. If no good match exists, set matchedRoleKey to null

Return ONLY a JSON array:
[
  {"campaignId": "id", "matchedRoleKey": "CompanyName|JobTitle" or null, "confidence": "high|medium|low"}
]`;

  const userPrompt = `INTERNAL JOB ROLES (companies actively hiring):
${rolesContext}

LINKEDIN CAMPAIGNS to match:
${campaignsContext}

Match each campaign to the most appropriate internal role. Use the format "CompanyName|JobTitle" for matchedRoleKey.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getOpenAIKey()}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_completion_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[batchCampaigns] OpenAI API error:', JSON.stringify(error, null, 2));
      console.error('[batchCampaigns] Response status:', response.status);
      return [];
    }

    console.log('[batchCampaigns] OpenAI API call successful');

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[batchCampaigns] Failed to parse OpenAI response:', text);
      return [];
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[batchCampaigns] OpenAI batching failed:', error);
    return [];
  }
}

export const batchCampaignsTool = createTool({
  id: 'batch-campaigns',
  description:
    'Match LinkedIn campaigns to internal job roles and group them by role. Uses internal roles as the source of truth for batching.',
  inputSchema: z.object({
    campaigns: z.array(
      z.object({
        campaignId: z.string(),
        name: z.string(),
        status: z.string(),
        spend: z.number(),
        impressions: z.number(),
        clicks: z.number(),
        landingPageClicks: z.number(),
        ctr: z.number(),
        cpc: z.number(),
      })
    ),
    internalRoles: z.array(
      z.object({
        jobTitle: z.string(),
        companyName: z.string(),
        resumes: z.number(),
        source: z.string().optional(),
      })
    ).optional(),
  }),
  outputSchema: z.object({
    batches: z.array(z.any()),
    ungrouped: z.array(z.any()),
    parsingWarnings: z.array(
      z.object({
        campaignId: z.string(),
        campaignName: z.string(),
        warning: z.string(),
        confidence: z.enum(['medium', 'low']),
      })
    ),
    stats: z.object({
      totalCampaigns: z.number(),
      totalRoles: z.number(),
      matchedCampaigns: z.number(),
      unmatchedCampaigns: z.number(),
    }),
    totalBatches: z.number(),
  }),
  execute: async ({ context }) => {
    const { campaigns, internalRoles = [] } = context;

    console.log(`[Tool: batchCampaigns] Processing ${campaigns.length} campaigns with ${internalRoles.length} internal roles as context`);

    // Create lookup map for campaign metrics
    const campaignDataMap = new Map(
      campaigns.map((c) => [c.campaignId, c])
    );

    // Create a map of internal roles for quick lookup
    const roleMap = new Map<string, InternalRole>();
    for (const role of internalRoles) {
      const key = `${role.companyName}|${role.jobTitle}`;
      roleMap.set(key, role);
    }

    // Call OpenAI to match campaigns to roles
    let aiResults: AIBatchingResult[] = [];
    console.log('[Tool: batchCampaigns] getOpenAIKey() present:', !!getOpenAIKey());
    console.log('[Tool: batchCampaigns] getOpenAIKey() first 20 chars:', getOpenAIKey().substring(0, 20));
    console.log('[Tool: batchCampaigns] internalRoles count:', internalRoles.length);

    if (getOpenAIKey() && internalRoles.length > 0) {
      console.log('[Tool: batchCampaigns] Calling OpenAI to match campaigns to internal roles...');
      try {
        aiResults = await callOpenAIForBatching(
          campaigns.map((c) => ({ campaignId: c.campaignId, name: c.name })),
          internalRoles
        );
        console.log('[Tool: batchCampaigns] OpenAI returned', aiResults.length, 'results');
      } catch (err) {
        console.error('[Tool: batchCampaigns] OpenAI call threw error:', err);
      }
    } else {
      console.log('[Tool: batchCampaigns] Skipping OpenAI - API key:', !!getOpenAIKey(), 'roles:', internalRoles.length);
    }

    // Build batches based on matched roles
    const batchMap = new Map<string, CampaignVariant[]>();
    const ungrouped: LinkedInCampaign[] = [];
    const parsingWarnings: ParsingWarning[] = [];

    // Create a map of AI results
    const aiResultMap = new Map(aiResults.map((r) => [r.campaignId, r]));

    for (const campaign of campaigns) {
      const aiResult = aiResultMap.get(campaign.campaignId);
      const variantType = detectVariant(campaign.name);

      const campaignVariant: CampaignVariant = {
        campaignId: campaign.campaignId,
        name: campaign.name,
        variantType,
        status: campaign.status,
        metrics: {
          spend: campaign.spend,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          landingPageClicks: campaign.landingPageClicks,
          ctr: campaign.ctr,
          cpc: campaign.cpc,
        },
      };

      if (aiResult?.matchedRoleKey) {
        // Campaign matched to a role
        if (!batchMap.has(aiResult.matchedRoleKey)) {
          batchMap.set(aiResult.matchedRoleKey, []);
        }
        batchMap.get(aiResult.matchedRoleKey)!.push(campaignVariant);

        if (aiResult.confidence === 'low') {
          parsingWarnings.push({
            campaignId: campaign.campaignId,
            campaignName: campaign.name,
            warning: `Low confidence match to ${aiResult.matchedRoleKey}`,
            confidence: 'low',
          });
        }
      } else {
        // Campaign not matched
        ungrouped.push(campaign as unknown as LinkedInCampaign);
      }
    }

    // Convert batchMap to array of CampaignBatch
    const batches: CampaignBatch[] = [];
    for (const [roleKey, campaignVariants] of batchMap) {
      const [companyName, jobTitle] = roleKey.split('|');
      const internalRole = roleMap.get(roleKey);

      batches.push({
        batchId: `batch-${roleKey.toLowerCase().replace(/[|]/g, '-').replace(/\s+/g, '_')}`,
        baseName: `${companyName} ${jobTitle}`,
        company: companyName,
        role: jobTitle,
        campaigns: campaignVariants,
        aggregatedMetrics: aggregateBatchMetrics(campaignVariants),
      });
    }

    // Sort batches by total spend
    batches.sort((a, b) => b.aggregatedMetrics.totalSpend - a.aggregatedMetrics.totalSpend);

    const stats = {
      totalCampaigns: campaigns.length,
      totalRoles: batches.length,
      matchedCampaigns: campaigns.length - ungrouped.length,
      unmatchedCampaigns: ungrouped.length,
    };

    console.log(
      `[Tool: batchCampaigns] Created ${batches.length} role batches, ${ungrouped.length} ungrouped campaigns`
    );

    return {
      batches,
      ungrouped,
      parsingWarnings,
      stats,
      totalBatches: batches.length,
    };
  },
});
