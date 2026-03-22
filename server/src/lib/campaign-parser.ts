/**
 * Campaign Parser - Deterministic pre-processing for LinkedIn campaign names
 *
 * Campaign naming conventions:
 * - Format: {Company} - {CompanyTag} - {Role} - {TargetingVariant}
 * - Examples:
 *   - "Swiggy - Engg - SDE" → Company: Swiggy, Role: SDE, Variant: base
 *   - "Swiggy - Engg - SDE - Pedigree" → Company: Swiggy, Role: SDE, Variant: pedigree
 *   - "Razorpay - BE - Company TG" → Company: Razorpay, Role: BE, Variant: company_tg
 */

export interface ParsedCampaign {
  campaignId: string;
  originalName: string;
  company: string;
  companyTag: string | null;
  role: string;
  variantType: VariantType;
  parseConfidence: 'high' | 'medium' | 'low';
  parseWarning?: string;
}

export type VariantType =
  | 'base'
  | 'pedigree'
  | 'company_tg'
  | 'job_title'
  | 'pedigree_jt'
  | 'community'
  | 'startups'
  | 'geo'
  | 'other';

// Known variant suffixes (case-insensitive)
const VARIANT_PATTERNS: { pattern: RegExp; type: VariantType; priority: number }[] = [
  // Compound variants first (higher priority)
  { pattern: /pedigree\s*jt|jt\s*pedigree/i, type: 'pedigree_jt', priority: 1 },
  { pattern: /pedigree\s*job\s*title|job\s*title\s*pedigree/i, type: 'pedigree_jt', priority: 1 },

  // Single variants
  { pattern: /^pedigree[s]?$/i, type: 'pedigree', priority: 2 },
  { pattern: /^company\s*tg$/i, type: 'company_tg', priority: 2 },
  { pattern: /^compan[yi]es?\s*tg$/i, type: 'company_tg', priority: 2 },
  { pattern: /^jt$/i, type: 'job_title', priority: 2 },
  { pattern: /^job\s*title[s]?$/i, type: 'job_title', priority: 2 },
  { pattern: /^communit[yi]$/i, type: 'community', priority: 2 },
  { pattern: /^startup[s]?$/i, type: 'startups', priority: 2 },
  { pattern: /^geo$/i, type: 'geo', priority: 2 },

  // Geographic locations (treat as geo variant)
  { pattern: /^(bangalore|bengaluru|delhi|ncr|mumbai|pune|hyderabad|chennai|kolkata|india|us|usa|remote)$/i, type: 'geo', priority: 3 },

  // Generic TG suffix
  { pattern: /^tg$/i, type: 'other', priority: 4 },
];

// Known company tags that aren't roles
const COMPANY_TAGS = new Set([
  'engg', 'engineering', 'eng',
  'tech', 'technology',
  'product', 'prod',
  'design',
  'data',
  'ml', 'ai',
  'platform',
  'infra', 'infrastructure',
  'core',
  'growth',
  'b2b', 'b2c',
  'hiring',
]);

// Known role patterns
const ROLE_PATTERNS = [
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?sde(\s*[iv123]+)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?software\s*(dev|developer|engineer|engg)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?backend(\s+engineer|\s+dev|\s+developer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?frontend(\s+engineer|\s+dev|\s+developer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?fullstack(\s+engineer|\s+dev|\s+developer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?full[\s\-]?stack(\s+engineer|\s+dev|\s+developer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?devops(\s+engineer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?sre$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?data\s*(scientist|engineer|analyst)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?ml(\s+engineer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?machine\s+learning(\s+engineer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+|staff\s+)?product\s*(manager|designer)?$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+)?pm$/i,
  /^(senior\s+|sr\.?\s+|lead\s+|principal\s+)?apm$/i,
  /^be$/i, // Backend Engineer abbreviation
  /^fe$/i, // Frontend Engineer abbreviation
  /^fs$/i, // Fullstack abbreviation
  /^ios(\s+engineer|\s+dev|\s+developer)?$/i,
  /^android(\s+engineer|\s+dev|\s+developer)?$/i,
  /^mobile(\s+engineer|\s+dev|\s+developer)?$/i,
  /^qa(\s+engineer)?$/i,
  /^sdet$/i,
  /^test\s*(engineer|automation)?$/i,
  /^intern(ship)?$/i,
  /^trainee$/i,
  /^fresher$/i,
  /^cos$/i, // Chief of Staff
  /^chief\s+of\s+staff$/i,
];

/**
 * Detect variant type from a string segment
 */
function detectVariantType(segment: string): { type: VariantType; matched: boolean } {
  const trimmed = segment.trim();

  // Sort patterns by priority
  const sortedPatterns = [...VARIANT_PATTERNS].sort((a, b) => a.priority - b.priority);

  for (const { pattern, type } of sortedPatterns) {
    if (pattern.test(trimmed)) {
      return { type, matched: true };
    }
  }

  return { type: 'base', matched: false };
}

/**
 * Check if a segment looks like a company tag
 */
function isCompanyTag(segment: string): boolean {
  return COMPANY_TAGS.has(segment.toLowerCase().trim());
}

/**
 * Check if a segment looks like a role
 */
function looksLikeRole(segment: string): boolean {
  const trimmed = segment.trim();
  return ROLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Parse a single campaign name
 */
export function parseCampaignName(campaignId: string, name: string): ParsedCampaign {
  const segments = name.split(/\s*[-–—]\s*/).map((s) => s.trim()).filter((s) => s.length > 0);

  // Default result for unparseable names
  const defaultResult: ParsedCampaign = {
    campaignId,
    originalName: name,
    company: name,
    companyTag: null,
    role: 'Unknown',
    variantType: 'base',
    parseConfidence: 'low',
    parseWarning: 'Could not parse campaign name structure',
  };

  if (segments.length === 0) {
    return defaultResult;
  }

  // Single segment - just company name
  if (segments.length === 1) {
    return {
      ...defaultResult,
      company: segments[0],
      parseConfidence: 'low',
      parseWarning: 'Single segment name - no role detected',
    };
  }

  // Two segments: Company - Role OR Company - CompanyTag
  if (segments.length === 2) {
    const [first, second] = segments;

    // Check if second is a variant
    const variantCheck = detectVariantType(second);
    if (variantCheck.matched) {
      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: null,
        role: 'Unknown',
        variantType: variantCheck.type,
        parseConfidence: 'low',
        parseWarning: 'Two segments with variant but no role',
      };
    }

    // Check if second is a company tag
    if (isCompanyTag(second)) {
      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: second,
        role: 'Unknown',
        variantType: 'base',
        parseConfidence: 'low',
        parseWarning: 'Two segments - company and tag only',
      };
    }

    // Assume it's Company - Role
    return {
      campaignId,
      originalName: name,
      company: first,
      companyTag: null,
      role: second,
      variantType: 'base',
      parseConfidence: looksLikeRole(second) ? 'high' : 'medium',
    };
  }

  // Three segments: Company - CompanyTag - Role OR Company - Role - Variant
  if (segments.length === 3) {
    const [first, second, third] = segments;

    // Check if third is a variant
    const variantCheck = detectVariantType(third);
    if (variantCheck.matched) {
      // Company - Role - Variant or Company - CompanyTag - Variant
      if (isCompanyTag(second)) {
        return {
          campaignId,
          originalName: name,
          company: first,
          companyTag: second,
          role: 'Unknown',
          variantType: variantCheck.type,
          parseConfidence: 'low',
          parseWarning: 'Company - Tag - Variant but no role',
        };
      }

      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: null,
        role: second,
        variantType: variantCheck.type,
        parseConfidence: looksLikeRole(second) ? 'high' : 'medium',
      };
    }

    // Check if second is a company tag
    if (isCompanyTag(second)) {
      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: second,
        role: third,
        variantType: 'base',
        parseConfidence: looksLikeRole(third) ? 'high' : 'medium',
      };
    }

    // Ambiguous: treat as Company - Role - Something
    return {
      campaignId,
      originalName: name,
      company: first,
      companyTag: null,
      role: `${second} ${third}`,
      variantType: 'base',
      parseConfidence: 'medium',
      parseWarning: 'Three segments - merged second and third as role',
    };
  }

  // Four or more segments: Company - CompanyTag - Role - Variant (+ extras)
  if (segments.length >= 4) {
    const [first, second, ...rest] = segments;
    const last = rest[rest.length - 1];

    // Check if last is a variant
    const variantCheck = detectVariantType(last);

    if (variantCheck.matched) {
      const roleParts = rest.slice(0, -1);

      if (isCompanyTag(second)) {
        return {
          campaignId,
          originalName: name,
          company: first,
          companyTag: second,
          role: roleParts.join(' '),
          variantType: variantCheck.type,
          parseConfidence: roleParts.length === 1 && looksLikeRole(roleParts[0]) ? 'high' : 'medium',
        };
      }

      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: null,
        role: [second, ...roleParts].join(' '),
        variantType: variantCheck.type,
        parseConfidence: 'medium',
      };
    }

    // No variant detected
    if (isCompanyTag(second)) {
      return {
        campaignId,
        originalName: name,
        company: first,
        companyTag: second,
        role: rest.join(' '),
        variantType: 'base',
        parseConfidence: 'medium',
      };
    }

    return {
      campaignId,
      originalName: name,
      company: first,
      companyTag: null,
      role: [second, ...rest].join(' '),
      variantType: 'base',
      parseConfidence: 'medium',
    };
  }

  return defaultResult;
}

/**
 * Normalize role name for grouping
 */
export function normalizeRole(role: string): string {
  let normalized = role.toLowerCase().trim();

  // Common abbreviation expansions
  const expansions: [RegExp, string][] = [
    [/^sde$/i, 'Software Development Engineer'],
    [/^be$/i, 'Backend Engineer'],
    [/^fe$/i, 'Frontend Engineer'],
    [/^fs$/i, 'Fullstack Engineer'],
    [/^pm$/i, 'Product Manager'],
    [/^apm$/i, 'Associate Product Manager'],
    [/^sre$/i, 'Site Reliability Engineer'],
    [/^qa$/i, 'QA Engineer'],
    [/^sdet$/i, 'SDET'],
    [/^ml$/i, 'Machine Learning'],
    [/^cos$/i, 'Chief of Staff'],
  ];

  for (const [pattern, expansion] of expansions) {
    if (pattern.test(normalized)) {
      return expansion;
    }
  }

  // Title case
  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Normalize company name for grouping
 */
export function normalizeCompany(company: string): string {
  return company
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Create a grouping key for a parsed campaign
 */
export function createGroupingKey(parsed: ParsedCampaign): {
  companyKey: string;
  roleKey: string;
} {
  return {
    companyKey: normalizeCompany(parsed.company).toLowerCase().replace(/\s+/g, '_'),
    roleKey: normalizeRole(parsed.role).toLowerCase().replace(/\s+/g, '_'),
  };
}

/**
 * Parse multiple campaigns
 */
export function parseCampaigns(
  campaigns: { campaignId: string; name: string }[]
): ParsedCampaign[] {
  return campaigns.map((c) => parseCampaignName(c.campaignId, c.name));
}

/**
 * Get parsing statistics
 */
export function getParsingStats(parsed: ParsedCampaign[]): {
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  withWarnings: number;
} {
  return {
    total: parsed.length,
    highConfidence: parsed.filter((p) => p.parseConfidence === 'high').length,
    mediumConfidence: parsed.filter((p) => p.parseConfidence === 'medium').length,
    lowConfidence: parsed.filter((p) => p.parseConfidence === 'low').length,
    withWarnings: parsed.filter((p) => p.parseWarning).length,
  };
}
