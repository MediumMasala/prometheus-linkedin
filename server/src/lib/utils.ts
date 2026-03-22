import type { CampaignVariant, AggregatedMetrics, RoleBatch, VariantType } from '../types/index.js';

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate string similarity (0 to 1, where 1 is exact match)
 */
export function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const maxLen = Math.max(s1.length, s2.length);
  const distance = levenshteinDistance(s1, s2);

  return 1 - distance / maxLen;
}

/**
 * Extract company name and role from campaign name
 */
export function extractCompanyAndRole(campaignName: string): {
  company: string;
  role: string;
  variantType: string;
} {
  // Common variant suffixes to strip
  const variantPatterns = [
    { pattern: /\s*-?\s*pedigree[s]?\s*$/i, type: 'pedigree' },
    { pattern: /\s*-?\s*startup[s]?\s*$/i, type: 'startup' },
    { pattern: /\s*-?\s*job\s*title[s]?\s*$/i, type: 'job_title' },
    { pattern: /\s*-?\s*geo\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*industry\s*$/i, type: 'industry' },
    { pattern: /\s*-?\s*IIT\s*$/i, type: 'pedigree' },
    { pattern: /\s*-?\s*NIT\s*$/i, type: 'pedigree' },
    { pattern: /\s*-?\s*tier\s*1\s*$/i, type: 'pedigree' },
    { pattern: /\s*-?\s*bangalore\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*delhi\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*mumbai\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*hyderabad\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*india\s*$/i, type: 'geo' },
    { pattern: /\s*-?\s*TG\s*$/i, type: 'other' },
    { pattern: /\s*-?\s*SM\s*$/i, type: 'other' },
  ];

  let baseName = campaignName;
  let variantType = 'base';

  for (const { pattern, type } of variantPatterns) {
    if (pattern.test(baseName)) {
      baseName = baseName.replace(pattern, '');
      variantType = type;
      break;
    }
  }

  // Try to split by common separators
  const parts = baseName.split(/\s*[-–—]\s*|\s+/).filter((p) => p.length > 0);

  if (parts.length >= 2) {
    // Assume first part is company, rest is role
    const company = parts[0];
    const role = parts.slice(1).join(' ');
    return { company, role, variantType };
  }

  // Can't determine structure
  return { company: baseName, role: '', variantType };
}

/**
 * Aggregate metrics for a batch of campaigns
 */
export function aggregateBatchMetrics(campaigns: CampaignVariant[]): AggregatedMetrics {
  const totalSpend = campaigns.reduce((sum, c) => sum + c.metrics.spend, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.metrics.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.metrics.clicks, 0);
  const totalLandingPageClicks = campaigns.reduce((sum, c) => sum + c.metrics.landingPageClicks, 0);

  return {
    totalSpend,
    totalImpressions,
    totalClicks,
    totalLandingPageClicks,
    weightedCPC: totalLandingPageClicks > 0 ? totalSpend / totalLandingPageClicks : 0,
    weightedCTR: totalImpressions > 0 ? (totalLandingPageClicks / totalImpressions) * 100 : 0,
  };
}

/**
 * Aggregate metrics for multiple role batches
 */
export function aggregateRoleBatchMetrics(roles: RoleBatch[]): AggregatedMetrics {
  const allCampaigns = roles.flatMap((r) => r.campaigns);
  return aggregateBatchMetrics(allCampaigns);
}

/**
 * Build variant breakdown for a role batch
 */
export function buildVariantBreakdown(
  campaigns: CampaignVariant[]
): RoleBatch['variantBreakdown'] {
  const breakdown: RoleBatch['variantBreakdown'] = {};

  for (const campaign of campaigns) {
    const variantType = campaign.variantType as VariantType;

    if (!breakdown[variantType]) {
      breakdown[variantType] = {
        count: 0,
        spend: 0,
        campaigns: [],
      };
    }

    breakdown[variantType]!.count++;
    breakdown[variantType]!.spend += campaign.metrics.spend;
    breakdown[variantType]!.campaigns.push(campaign);
  }

  return breakdown;
}

/**
 * Format currency in INR
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Normalize string for comparison
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two company names match
 */
export function companiesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeString(name1);
  const n2 = normalizeString(name2);

  // Exact match
  if (n1 === n2) return true;

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // High similarity
  if (stringSimilarity(n1, n2) > 0.8) return true;

  return false;
}

/**
 * Check if two role names match
 */
export function rolesMatch(role1: string, role2: string): boolean {
  const r1 = normalizeString(role1);
  const r2 = normalizeString(role2);

  // Exact match
  if (r1 === r2) return true;

  // One contains the other
  if (r1.includes(r2) || r2.includes(r1)) return true;

  // Common role synonyms
  const synonymGroups = [
    ['engineer', 'engineering', 'developer', 'dev', 'sde', 'swe'],
    ['backend', 'back end', 'server', 'api'],
    ['frontend', 'front end', 'ui', 'react', 'web'],
    ['fullstack', 'full stack', 'full-stack'],
    ['ml', 'machine learning', 'ai', 'artificial intelligence'],
    ['product', 'pm', 'product manager'],
    ['senior', 'sr', 'lead', 'principal'],
    ['intern', 'internship', 'trainee'],
    ['cos', 'chief of staff'],
  ];

  for (const group of synonymGroups) {
    const r1HasAny = group.some((syn) => r1.includes(syn));
    const r2HasAny = group.some((syn) => r2.includes(syn));
    if (r1HasAny && r2HasAny) return true;
  }

  // Decent similarity
  if (stringSimilarity(r1, r2) > 0.6) return true;

  return false;
}
