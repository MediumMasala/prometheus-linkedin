import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { companiesMatch, rolesMatch, stringSimilarity, formatINR } from '../../lib/utils.js';
import type { CampaignBatch, InternalRole, MatchedCampaign, UnifiedReport } from '../../types/index.js';

// Read API key at runtime
function getOpenAIKey(): string {
  return process.env.OPENAI_API_KEY || '';
}

interface MatchResult {
  batchId: string;
  internalRoleKey: string;
  confidence: 'high' | 'medium' | 'low';
}

async function callOpenAIForMatching(
  batches: { batchId: string; baseName: string; company: string; role: string }[],
  roles: { key: string; jobTitle: string; companyName: string; resumes: number }[]
): Promise<MatchResult[]> {
  if (batches.length === 0 || roles.length === 0) {
    return [];
  }

  const systemPrompt = `You are an expert at matching LinkedIn advertising campaign batches to internal job roles.

Your task is to match campaign batches (LinkedIn ads) to internal roles (job openings with resume counts).

MATCHING RULES:
1. Company name MUST match (Sarvam → Sarvam, FamPay → FamPay)
2. Role/title should be similar (ML Engineer ≈ Machine Learning Engineer, Backend AI ≈ AI Backend)
3. One batch can only match ONE role
4. One role can only match ONE batch (pick the best if multiple could match)
5. If no good match exists, don't include it

CONFIDENCE LEVELS:
- "high": Company AND role match clearly (exact or very similar)
- "medium": Company matches, role is approximate
- "low": Partial match, uncertain

Return ONLY a JSON array:
[{"batchId": "...", "internalRoleKey": "...", "confidence": "high|medium|low"}]`;

  const userPrompt = `LINKEDIN CAMPAIGN BATCHES:
${batches.map((b, i) => `${i + 1}. ID: "${b.batchId}" | Company: "${b.company}" | Role: "${b.role}"`).join('\n')}

INTERNAL JOB ROLES (with resume counts):
${roles.slice(0, 100).map((r, i) => `${i + 1}. Key: "${r.key}" | Company: "${r.companyName}" | Role: "${r.jobTitle}" | Resumes: ${r.resumes}`).join('\n')}

Match each batch to the most relevant internal role.`;

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
      console.error('[mapAndReconcile] OpenAI API error:', JSON.stringify(error, null, 2));
      return [];
    }

    console.log('[mapAndReconcile] OpenAI API call successful');

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[mapAndReconcile] Failed to parse OpenAI response:', text);
      return [];
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[mapAndReconcile] OpenAI matching failed:', error);
    return [];
  }
}

function fallbackMatching(
  batch: CampaignBatch,
  roles: InternalRole[]
): { role: InternalRole; confidence: 'high' | 'medium' | 'low' } | null {
  let bestMatch: { role: InternalRole; score: number; confidence: 'high' | 'medium' | 'low' } | null = null;

  for (const role of roles) {
    const companyMatches = companiesMatch(batch.company, role.companyName);
    const roleMatches = rolesMatch(batch.role, role.jobTitle);

    if (companyMatches && roleMatches) {
      const companyScore = stringSimilarity(batch.company, role.companyName);
      const roleScore = stringSimilarity(batch.role, role.jobTitle);
      const totalScore = companyScore * 0.5 + roleScore * 0.5;

      let confidence: 'high' | 'medium' | 'low' = 'low';
      if (companyScore > 0.8 && roleScore > 0.6) confidence = 'high';
      else if (companyScore > 0.6 || roleScore > 0.5) confidence = 'medium';

      if (!bestMatch || totalScore > bestMatch.score) {
        bestMatch = { role, score: totalScore, confidence };
      }
    }
  }

  return bestMatch ? { role: bestMatch.role, confidence: bestMatch.confidence } : null;
}

export const mapAndReconcileTool = createTool({
  id: 'map-and-reconcile',
  description:
    'Match LinkedIn campaign batches with internal backend data (resumes) and produce a unified report with cost per resume, matched/unmatched items, and recommendations.',
  inputSchema: z.object({
    batches: z.array(
      z.object({
        batchId: z.string(),
        baseName: z.string(),
        company: z.string(),
        role: z.string(),
        campaigns: z.array(z.any()),
        aggregatedMetrics: z.object({
          totalSpend: z.number(),
          totalImpressions: z.number(),
          totalClicks: z.number(),
          totalLandingPageClicks: z.number(),
          weightedCPC: z.number(),
          weightedCTR: z.number(),
        }),
      })
    ),
    internalRoles: z.array(
      z.object({
        jobTitle: z.string(),
        companyName: z.string(),
        resumes: z.number(),
        source: z.string().optional(),
      })
    ),
    ungroupedCampaigns: z.array(z.any()).optional(),
  }),
  outputSchema: z.object({
    matchedCampaigns: z.array(z.any()),
    unmatchedLinkedIn: z.array(z.any()),
    unmatchedInternal: z.array(z.any()),
    other: z.object({
      linkedInSpend: z.number(),
      linkedInClicks: z.number(),
      organicResumes: z.number(),
    }),
    summary: z.object({
      totalSpend: z.number(),
      totalResumes: z.number(),
      matchedResumes: z.number(),
      unmatchedResumes: z.number(),
      overallCostPerResume: z.number(),
      bestPerformingBatch: z.string().nullable(),
      worstPerformingBatch: z.string().nullable(),
      recommendations: z.array(z.string()),
    }),
  }),
  execute: async ({ context }) => {
    const { batches, internalRoles, ungroupedCampaigns = [] } = context;

    console.log(
      `[Tool: mapAndReconcile] Matching ${batches.length} batches with ${internalRoles.length} internal roles`
    );

    // Create a map for quick role lookup
    const roleMap = new Map<string, InternalRole>();
    const roleKeyMap = new Map<string, string>();
    for (const role of internalRoles) {
      const key = `${role.jobTitle}|${role.companyName}`;
      roleMap.set(key, role);
      roleKeyMap.set(key, key);
    }

    // Try AI matching with OpenAI GPT-5.2
    const aiMatches = await callOpenAIForMatching(
      batches.map((b) => ({
        batchId: b.batchId,
        baseName: b.baseName,
        company: b.company,
        role: b.role,
      })),
      internalRoles.map((r) => ({
        key: `${r.jobTitle}|${r.companyName}`,
        jobTitle: r.jobTitle,
        companyName: r.companyName,
        resumes: r.resumes,
      }))
    );

    console.log(`[Tool: mapAndReconcile] OpenAI returned ${aiMatches.length} matches`);

    const matchedCampaigns: MatchedCampaign[] = [];
    const matchedBatchIds = new Set<string>();
    const matchedRoleKeys = new Set<string>();

    // Process AI matches
    for (const match of aiMatches) {
      const batch = batches.find((b) => b.batchId === match.batchId);
      const role = roleMap.get(match.internalRoleKey);

      if (batch && role && !matchedBatchIds.has(batch.batchId) && !matchedRoleKeys.has(match.internalRoleKey)) {
        const costPerResume = role.resumes > 0 ? batch.aggregatedMetrics.totalSpend / role.resumes : 0;
        const clickToResumeRate =
          batch.aggregatedMetrics.totalLandingPageClicks > 0
            ? (role.resumes / batch.aggregatedMetrics.totalLandingPageClicks) * 100
            : 0;

        matchedCampaigns.push({
          matchConfidence: match.confidence,
          linkedin: {
            batchName: batch.baseName,
            company: batch.company,
            role: batch.role,
            campaigns: batch.campaigns,
            totalSpend: batch.aggregatedMetrics.totalSpend,
            totalImpressions: batch.aggregatedMetrics.totalImpressions,
            totalClicks: batch.aggregatedMetrics.totalClicks,
            totalLandingPageClicks: batch.aggregatedMetrics.totalLandingPageClicks,
          },
          internal: {
            roleName: role.jobTitle,
            companyName: role.companyName,
            resumes: role.resumes,
          },
          combined: {
            costPerResume,
            clickToResumeRate,
          },
        });

        matchedBatchIds.add(batch.batchId);
        matchedRoleKeys.add(match.internalRoleKey);
      }
    }

    // Fallback matching for unmatched batches
    const remainingRoles = internalRoles.filter(
      (r) => !matchedRoleKeys.has(`${r.jobTitle}|${r.companyName}`)
    );

    for (const batch of batches) {
      if (matchedBatchIds.has(batch.batchId)) continue;

      const fallback = fallbackMatching(batch, remainingRoles);
      if (fallback) {
        const roleKey = `${fallback.role.jobTitle}|${fallback.role.companyName}`;
        if (!matchedRoleKeys.has(roleKey)) {
          const costPerResume =
            fallback.role.resumes > 0 ? batch.aggregatedMetrics.totalSpend / fallback.role.resumes : 0;
          const clickToResumeRate =
            batch.aggregatedMetrics.totalLandingPageClicks > 0
              ? (fallback.role.resumes / batch.aggregatedMetrics.totalLandingPageClicks) * 100
              : 0;

          matchedCampaigns.push({
            matchConfidence: fallback.confidence,
            linkedin: {
              batchName: batch.baseName,
              company: batch.company,
              role: batch.role,
              campaigns: batch.campaigns,
              totalSpend: batch.aggregatedMetrics.totalSpend,
              totalImpressions: batch.aggregatedMetrics.totalImpressions,
              totalClicks: batch.aggregatedMetrics.totalClicks,
              totalLandingPageClicks: batch.aggregatedMetrics.totalLandingPageClicks,
            },
            internal: {
              roleName: fallback.role.jobTitle,
              companyName: fallback.role.companyName,
              resumes: fallback.role.resumes,
            },
            combined: {
              costPerResume,
              clickToResumeRate,
            },
          });

          matchedBatchIds.add(batch.batchId);
          matchedRoleKeys.add(roleKey);
        }
      }
    }

    // Collect unmatched items
    const unmatchedLinkedIn = batches.filter((b) => !matchedBatchIds.has(b.batchId));
    const unmatchedInternal = internalRoles.filter(
      (r) => !matchedRoleKeys.has(`${r.jobTitle}|${r.companyName}`)
    );

    // Calculate "Other" category
    const otherLinkedInSpend = unmatchedLinkedIn.reduce(
      (sum, b) => sum + b.aggregatedMetrics.totalSpend,
      0
    ) + ungroupedCampaigns.reduce((sum: number, c: any) => sum + (c.spend || 0), 0);

    const otherLinkedInClicks = unmatchedLinkedIn.reduce(
      (sum, b) => sum + b.aggregatedMetrics.totalLandingPageClicks,
      0
    ) + ungroupedCampaigns.reduce((sum: number, c: any) => sum + (c.landingPageClicks || 0), 0);

    const organicResumes = unmatchedInternal.reduce((sum, r) => sum + r.resumes, 0);

    // Calculate summary
    const totalSpend = batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalSpend, 0);
    const totalResumes = internalRoles.reduce((sum, r) => sum + r.resumes, 0);
    const matchedResumes = matchedCampaigns.reduce((sum, m) => sum + m.internal.resumes, 0);
    const unmatchedResumes = totalResumes - matchedResumes;

    // Find best/worst performing batches
    const performingBatches = matchedCampaigns
      .filter((m) => m.internal.resumes > 0)
      .sort((a, b) => a.combined.costPerResume - b.combined.costPerResume);

    const bestPerforming = performingBatches[0]?.linkedin.batchName || null;
    const worstPerforming =
      performingBatches.length > 1 ? performingBatches[performingBatches.length - 1]?.linkedin.batchName : null;

    // Generate recommendations
    const recommendations: string[] = [];
    const avgCostPerResume = matchedResumes > 0 ? totalSpend / matchedResumes : 0;

    if (avgCostPerResume > 300) {
      recommendations.push(
        `Overall cost per resume (${formatINR(avgCostPerResume)}) is above target (₹200-300). Consider optimizing targeting.`
      );
    }

    if (unmatchedLinkedIn.length > 0) {
      recommendations.push(
        `${unmatchedLinkedIn.length} campaign batches couldn't be matched to internal roles. Review campaign naming or add corresponding roles.`
      );
    }

    if (organicResumes > matchedResumes * 0.3) {
      recommendations.push(
        `${organicResumes} resumes (${((organicResumes / totalResumes) * 100).toFixed(1)}%) are from unmatched/organic sources. Consider attributing them or expanding campaign coverage.`
      );
    }

    // Sort matched campaigns by cost per resume
    matchedCampaigns.sort((a, b) => a.combined.costPerResume - b.combined.costPerResume);

    console.log(
      `[Tool: mapAndReconcile] Matched ${matchedCampaigns.length} batches, ${unmatchedLinkedIn.length} unmatched LinkedIn, ${unmatchedInternal.length} unmatched internal`
    );

    return {
      matchedCampaigns,
      unmatchedLinkedIn,
      unmatchedInternal,
      other: {
        linkedInSpend: otherLinkedInSpend,
        linkedInClicks: otherLinkedInClicks,
        organicResumes,
      },
      summary: {
        totalSpend,
        totalResumes,
        matchedResumes,
        unmatchedResumes,
        overallCostPerResume: totalResumes > 0 ? totalSpend / totalResumes : 0,
        bestPerformingBatch: bestPerforming,
        worstPerformingBatch: worstPerforming,
        recommendations,
      },
    };
  },
});
