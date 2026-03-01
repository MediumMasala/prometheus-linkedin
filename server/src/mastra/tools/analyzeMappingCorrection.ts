import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  loadBatchingRules,
  updateMapping,
  saveBatchingRules,
  type MappingInfo,
} from '../../lib/batching-rules.js';

function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY || '';
}

export interface MappingCorrectionSuggestion {
  action: 'reassign' | 'bifurcate' | 'remove' | 'merge';
  campaignName: string;
  currentCompany: string;
  currentRole: string;
  suggestedCompany?: string;
  suggestedRole?: string;
  suggestedBatchId?: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * AI-powered tool to analyze why a mapping was rejected and suggest corrections
 */
async function analyzeRejectedMapping(
  campaignName: string,
  currentMapping: MappingInfo,
  rejectionReason: string,
  allMappings: Record<string, MappingInfo>,
  internalRoles?: Array<{ companyName: string; jobTitle: string; resumes: number }>
): Promise<MappingCorrectionSuggestion[]> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    console.error('[MappingCorrection] No OpenAI API key');
    return [];
  }

  // Build context of all current mappings grouped by batch
  const batchGroups = new Map<string, string[]>();
  for (const [name, mapping] of Object.entries(allMappings)) {
    if (!batchGroups.has(mapping.batchId)) {
      batchGroups.set(mapping.batchId, []);
    }
    batchGroups.get(mapping.batchId)!.push(name);
  }

  const batchContext = Array.from(batchGroups.entries())
    .map(([batchId, campaigns]) => {
      const mapping = Object.values(allMappings).find(m => m.batchId === batchId);
      return `Batch: ${mapping?.company} | ${mapping?.role} (${batchId})
  Campaigns: ${campaigns.join(', ')}`;
    })
    .join('\n\n');

  const rolesContext = internalRoles
    ? internalRoles.map(r => `- ${r.companyName}: ${r.jobTitle} (${r.resumes} resumes)`).join('\n')
    : 'No internal roles provided';

  const systemPrompt = `You are an expert at analyzing LinkedIn campaign mappings and suggesting corrections.

A user has REJECTED a mapping, meaning they believe the current assignment is WRONG.

CURRENT BATCH GROUPS:
${batchContext}

AVAILABLE INTERNAL ROLES (company hiring data):
${rolesContext}

ACTIONS YOU CAN SUGGEST:
1. "reassign" - Move campaign to a DIFFERENT existing batch or create a new one
2. "bifurcate" - Split this campaign from current batch into its own new batch
3. "remove" - Remove from all batches (standalone)
4. "merge" - Merge with another batch (if two batches should be one)

Analyze the rejection reason and suggest the best correction.

IMPORTANT:
- If "AI Product Manager" was grouped with "AI Engineer", they should be SEPARATE roles
- Different job functions (PM vs Engineer vs Designer) should be separate batches
- Same job at same company with different targeting (Pedigree, Company TG) should be SAME batch

Return JSON array of suggestions:
[{
  "action": "reassign|bifurcate|remove|merge",
  "campaignName": "campaign name",
  "currentCompany": "current company",
  "currentRole": "current role",
  "suggestedCompany": "new company (if different)",
  "suggestedRole": "new role name",
  "suggestedBatchId": "new-batch-id",
  "reason": "why this correction makes sense",
  "confidence": "high|medium|low"
}]`;

  const userPrompt = `REJECTED MAPPING:
Campaign: "${campaignName}"
Currently mapped to: ${currentMapping.company} | ${currentMapping.role}
Batch ID: ${currentMapping.batchId}

USER'S REJECTION REASON: "${rejectionReason}"

Analyze this rejection and suggest the best correction.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      console.error('[MappingCorrection] OpenAI error:', await response.text());
      return [];
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[MappingCorrection] Failed to parse response:', text);
      return [];
    }

    const suggestions: MappingCorrectionSuggestion[] = JSON.parse(jsonMatch[0]);
    console.log('[MappingCorrection] Generated suggestions:', suggestions);
    return suggestions;
  } catch (error) {
    console.error('[MappingCorrection] Error:', error);
    return [];
  }
}

/**
 * Apply a mapping correction suggestion
 */
export function applySuggestion(suggestion: MappingCorrectionSuggestion): boolean {
  const rules = loadBatchingRules();
  const mapping = rules.manualMappings[suggestion.campaignName];

  if (!mapping) {
    console.error('[MappingCorrection] Mapping not found:', suggestion.campaignName);
    return false;
  }

  // Cannot modify approved mappings
  if (mapping.approved) {
    console.error('[MappingCorrection] Cannot modify approved mapping:', suggestion.campaignName);
    return false;
  }

  switch (suggestion.action) {
    case 'reassign':
    case 'bifurcate':
      // Update to new company/role
      rules.manualMappings[suggestion.campaignName] = {
        ...mapping,
        company: suggestion.suggestedCompany || mapping.company,
        role: suggestion.suggestedRole || mapping.role,
        batchId: suggestion.suggestedBatchId ||
          `${(suggestion.suggestedCompany || mapping.company).toLowerCase().replace(/\s+/g, '-')}-${(suggestion.suggestedRole || mapping.role).toLowerCase().replace(/\s+/g, '-')}`,
        rejected: false,
        rejectionReason: undefined,
        source: 'manual',
        createdAt: new Date().toISOString(),
      };
      break;

    case 'remove':
      // Delete from mappings entirely
      delete rules.manualMappings[suggestion.campaignName];
      break;

    case 'merge':
      // Update to use the target batch
      rules.manualMappings[suggestion.campaignName] = {
        ...mapping,
        company: suggestion.suggestedCompany || mapping.company,
        role: suggestion.suggestedRole || mapping.role,
        batchId: suggestion.suggestedBatchId || mapping.batchId,
        rejected: false,
        rejectionReason: undefined,
        source: 'manual',
        createdAt: new Date().toISOString(),
      };
      break;
  }

  saveBatchingRules(rules);
  console.log(`[MappingCorrection] Applied ${suggestion.action} for ${suggestion.campaignName}`);
  return true;
}

export const analyzeMappingCorrectionTool = createTool({
  id: 'analyze-mapping-correction',
  description: 'AI-powered analysis of rejected mappings with correction suggestions',
  inputSchema: z.object({
    campaignName: z.string(),
    rejectionReason: z.string(),
    internalRoles: z.array(z.object({
      companyName: z.string(),
      jobTitle: z.string(),
      resumes: z.number(),
    })).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    suggestions: z.array(z.object({
      action: z.enum(['reassign', 'bifurcate', 'remove', 'merge']),
      campaignName: z.string(),
      currentCompany: z.string(),
      currentRole: z.string(),
      suggestedCompany: z.string().optional(),
      suggestedRole: z.string().optional(),
      suggestedBatchId: z.string().optional(),
      reason: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    })),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { campaignName, rejectionReason, internalRoles } = context;

    const rules = loadBatchingRules();
    const mapping = rules.manualMappings[campaignName];

    if (!mapping) {
      return {
        success: false,
        suggestions: [],
        error: `Mapping not found: ${campaignName}`,
      };
    }

    const suggestions = await analyzeRejectedMapping(
      campaignName,
      mapping,
      rejectionReason,
      rules.manualMappings,
      internalRoles
    );

    return {
      success: true,
      suggestions,
    };
  },
});

// Export for direct use
export { analyzeRejectedMapping };
