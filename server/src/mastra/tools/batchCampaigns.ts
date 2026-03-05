import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  aggregateBatchMetrics,
  buildVariantBreakdown,
} from '../../lib/utils.js';
import {
  getBatchForCampaign,
  saveAIBatchingResults,
  getCampaignsNeedingAI,
} from '../../lib/batching-rules.js';
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

/**
 * Check if a campaign is a WhatsApp acquisition campaign
 * These are special campaigns targeting top engineers via WhatsApp groups
 */
function isWhatsAppCampaign(campaignName: string): boolean {
  return /whatsapp/i.test(campaignName);
}

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
 * Strip company name prefix from role name
 * "Sarvam Machine Learning Engineer" → "Machine Learning Engineer"
 * "Stealth VP/SVP Engineering" → "VP/SVP Engineering"
 */
function normalizeRoleName(role: string, company: string): string {
  if (!role || !company) return role;

  let normalized = role.trim();
  const companyLower = company.toLowerCase().trim();
  let currentLower = normalized.toLowerCase();

  // Check if role starts with company name (exact or with space/dash after)
  if (currentLower.startsWith(companyLower + ' ') || currentLower.startsWith(companyLower + '-')) {
    normalized = normalized.slice(company.length).trim();
    normalized = normalized.replace(/^[-–—:|\s]+/, '').trim();
    return normalized || role;
  }

  // Check exact company prefix (for cases like "SarvamBackend" → less common)
  if (currentLower.startsWith(companyLower) && currentLower.length > companyLower.length) {
    const nextChar = currentLower[companyLower.length];
    // Only strip if followed by space, dash, or uppercase (new word)
    if (nextChar === ' ' || nextChar === '-' || normalized[company.length] === normalized[company.length].toUpperCase()) {
      normalized = normalized.slice(company.length).trim();
      normalized = normalized.replace(/^[-–—:|\s]+/, '').trim();
      return normalized || role;
    }
  }

  // Try variations without spaces
  const variations = [
    company.replace(/\s+/g, ''),      // "WaterlabsAI"
    company.replace(/\s+/g, '-'),     // "Waterlabs-AI"
  ];

  for (const variant of variations) {
    const variantLower = variant.toLowerCase();
    if (currentLower.startsWith(variantLower + ' ') || currentLower.startsWith(variantLower + '-')) {
      normalized = normalized.slice(variant.length).trim();
      normalized = normalized.replace(/^[-–—:|\s]+/, '').trim();
      return normalized || role;
    }
  }

  return role; // Return original if no prefix found
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

  // Build the list of available roles with normalized names
  const rolesContext = internalRoles
    .slice(0, 50) // Limit to top 50 roles
    .map((r, i) => {
      // Normalize the role name by stripping company prefix
      const normalizedRole = normalizeRoleName(r.jobTitle, r.companyName);
      return `${i + 1}. Company: "${r.companyName}", Role: "${normalizedRole}" [Backend: "${r.jobTitle}"] (${r.resumes} resumes)`;
    })
    .join('\n');

  const campaignsContext = campaigns
    .map((c, i) => `${i + 1}. "${c.name}" (ID: ${c.campaignId})`)
    .join('\n');

  const systemPrompt = `You are matching LinkedIn campaigns to internal job roles.

INTERNAL ROLES LIST: These are from the backend database. Use their EXACT names.
LINKEDIN CAMPAIGNS: These need to be matched to internal roles.

COMPANY ALIASES (these are the SAME company):
- AFB = AppsForBharat = Apps For Bharat = AppsforbBharat
- Shaadi account runs campaigns for: Stealth, AFB, Arintra (check campaign name)
- FamPay = Fampay
- Waterlabs AI = WaterlabsAI = Waterlabs
- kAIgentic = Kaigentic = KAIgentic
- Zilo = ZILO
- Zoop = ZOOP
- Seekho = SEEKHO

IMPORTANT: Use EXACT role names from internal roles list (including company prefix if present).
This makes debugging easier and ensures accurate mapping.

SPECIAL ROLE MAPPINGS (use exact backend names):
- Zilo campaigns → use "Zilo Backend Engineer" (exact backend name)
  Example: "Zilo Backend Engineer - skill TG mumbai" → Zilo|Zilo Backend Engineer
  Example: "Zilo - SM - Company TG" → Zilo|Zilo Backend Engineer

- Zoop campaigns → use "Zoop Founder's Office" (exact backend name)
  Example: "Zoop - Founders office - Open TG Grapevine.in" → Zoop|Zoop Founder's Office

CRITICAL RULES:
1. NEVER prefix role names with company name
   - WRONG: "Sarvam Machine Learning Engineer"
   - CORRECT: "Machine Learning Engineer"

2. Match company using aliases above
   - Campaign: "AFB - Backend Tech Lead"
   - Internal role: "Backend Tech Lead" at "AppsForBharat"
   - matchedRoleKey: "AppsForBharat|Backend Tech Lead" (use backend's company name)

3. If internal role exists, copy its EXACT jobTitle and companyName
   - Internal role: "ML Engineer" at "Sarvam"
   - Campaign: "Sarvam - ML Eng - pedigree"
   - matchedRoleKey: "Sarvam|ML Engineer"

4. If NO internal role exists, extract clean role WITHOUT company prefix
   - Campaign: "Waterlabs AI - AI Product Manager"
   - matchedRoleKey: "Waterlabs AI|AI Product Manager"

5. Campaign format: "Account - Company - Role - Variant" or "Company - Role - Variant"
   - "Shaadi - Stealth - VP Engineering" → Company: Stealth
   - "AFB - Backend Tech Lead - Industry TG" → Company: AppsForBharat (use backend name)
   - Ignore variants: "Company TG", "Pedigree", "JT", "Agency TG", "Industry TG"

Return JSON array:
[{"campaignId": "id", "matchedRoleKey": "BackendCompanyName|CleanRoleName", "confidence": "high|medium|low"}]

IMPORTANT: Use the company name AS IT APPEARS IN THE INTERNAL ROLES LIST, not the campaign abbreviation!`;

  const userPrompt = `INTERNAL ROLES (use EXACT jobTitle from this list):
${rolesContext}

CAMPAIGNS TO MATCH:
${campaignsContext}

For each campaign:
1. Find matching internal role by company + similar job title
2. Use the EXACT jobTitle from internal roles (e.g., "ML Engineer", not "Sarvam ML Engineer")
3. If no match, extract clean role WITHOUT company prefix

Format: "CompanyName|JobTitle" where JobTitle has NO company prefix`;

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
    whatsappCampaigns: z.array(z.any()).optional(), // WhatsApp acquisition campaigns (separate category)
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
      whatsappCampaigns: z.number().optional(), // Count of WhatsApp campaigns
      whatsappSpend: z.number().optional(),     // Total spend on WhatsApp campaigns
    }),
    totalBatches: z.number(),
  }),
  execute: async ({ context }) => {
    const { campaigns, internalRoles = [] } = context;

    console.log(`[Tool: batchCampaigns] Processing ${campaigns.length} campaigns with ${internalRoles.length} internal roles as context`);

    // STEP 0: Separate WhatsApp campaigns from regular campaigns
    // WhatsApp campaigns are a special acquisition channel and tracked separately
    const whatsappCampaigns: typeof campaigns = [];
    const regularCampaigns: typeof campaigns = [];

    for (const campaign of campaigns) {
      if (isWhatsAppCampaign(campaign.name)) {
        whatsappCampaigns.push(campaign);
      } else {
        regularCampaigns.push(campaign);
      }
    }

    const whatsappSpend = whatsappCampaigns.reduce((sum, c) => sum + c.spend, 0);
    console.log(`[Tool: batchCampaigns] Found ${whatsappCampaigns.length} WhatsApp campaigns (₹${whatsappSpend.toFixed(0)} spend)`);

    // Create lookup map for campaign metrics
    const campaignDataMap = new Map(
      regularCampaigns.map((c) => [c.campaignId, c])
    );

    // Create a map of internal roles for quick lookup
    const roleMap = new Map<string, InternalRole>();
    for (const role of internalRoles) {
      const key = `${role.companyName}|${role.jobTitle}`;
      roleMap.set(key, role);
    }

    // STEP 1: Check saved batching rules first (only for regular campaigns, not WhatsApp)
    const savedBatchResults = new Map<string, { company: string; role: string; batchId: string }>();
    const campaignsNeedingAI: { campaignId: string; name: string }[] = [];

    for (const campaign of regularCampaigns) {
      const savedBatch = getBatchForCampaign(campaign.name);
      if (savedBatch) {
        savedBatchResults.set(campaign.campaignId, savedBatch);
      } else {
        campaignsNeedingAI.push({ campaignId: campaign.campaignId, name: campaign.name });
      }
    }

    console.log(`[Tool: batchCampaigns] Found ${savedBatchResults.size} campaigns in saved rules`);
    console.log(`[Tool: batchCampaigns] ${campaignsNeedingAI.length} campaigns need AI batching`);

    // STEP 2: Call OpenAI only for campaigns not in saved rules
    let aiResults: AIBatchingResult[] = [];

    if (campaignsNeedingAI.length > 0 && getOpenAIKey() && internalRoles.length > 0) {
      console.log('[Tool: batchCampaigns] Calling OpenAI for remaining campaigns...');
      try {
        aiResults = await callOpenAIForBatching(campaignsNeedingAI, internalRoles);
        console.log('[Tool: batchCampaigns] OpenAI returned', aiResults.length, 'results');

        // Save AI results for future use - normalize role names to remove company prefixes
        const newMappings = aiResults
          .filter(r => r.matchedRoleKey)
          .map(r => {
            const campaign = campaignsNeedingAI.find(c => c.campaignId === r.campaignId);
            const [company, rawRole] = (r.matchedRoleKey || '').split('|');
            // Strip company prefix from role name
            const role = normalizeRoleName(rawRole, company);
            return {
              campaignName: campaign?.name || '',
              company,
              role,
              batchId: `${company.toLowerCase().replace(/\s+/g, '-')}-${role.toLowerCase().replace(/\s+/g, '-')}`,
            };
          })
          .filter(m => m.campaignName);

        if (newMappings.length > 0) {
          saveAIBatchingResults(newMappings);
          console.log(`[Tool: batchCampaigns] Saved ${newMappings.length} new batching rules`);
        }
      } catch (err) {
        console.error('[Tool: batchCampaigns] OpenAI call threw error:', err);
      }
    } else if (campaignsNeedingAI.length === 0) {
      console.log('[Tool: batchCampaigns] All campaigns found in saved rules - skipping OpenAI!');
    }

    // Build batches based on matched roles
    const batchMap = new Map<string, CampaignVariant[]>();
    const ungrouped: LinkedInCampaign[] = [];
    const parsingWarnings: ParsingWarning[] = [];

    // Create a map of AI results
    const aiResultMap = new Map(aiResults.map((r) => [r.campaignId, r]));

    for (const campaign of regularCampaigns) {
      const savedBatch = savedBatchResults.get(campaign.campaignId);
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

      // Check saved rules first, then AI results
      if (savedBatch) {
        // Use saved batching rule
        const roleKey = `${savedBatch.company}|${savedBatch.role}`;
        if (!batchMap.has(roleKey)) {
          batchMap.set(roleKey, []);
        }
        batchMap.get(roleKey)!.push(campaignVariant);
      } else if (aiResult?.matchedRoleKey) {
        // Campaign matched to a role via AI
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
      matchedCampaigns: regularCampaigns.length - ungrouped.length,
      unmatchedCampaigns: ungrouped.length,
      whatsappCampaigns: whatsappCampaigns.length,
      whatsappSpend,
    };

    console.log(
      `[Tool: batchCampaigns] Created ${batches.length} role batches, ${ungrouped.length} ungrouped, ${whatsappCampaigns.length} WhatsApp campaigns`
    );

    return {
      batches,
      ungrouped,
      whatsappCampaigns, // Separate WhatsApp campaigns for special tracking
      parsingWarnings,
      stats,
      totalBatches: batches.length,
    };
  },
});
