// LinkedIn Account Types (Multi-account support)
export interface LinkedInAccount {
  id: string;
  accountName: string;
  adAccountId: string;
  clientId?: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number | null;
  isDefault: boolean;
  createdAt: string;
  createdBy: string;
  needsAuth?: boolean;
}

export interface LinkedInAccountsData {
  accounts: LinkedInAccount[];
  version: number;
  migratedFromLegacy?: boolean;
}

// LinkedIn API Context (for multi-account API calls)
export interface LinkedInApiContext {
  accountId: string;
  adAccountId: string;
  accessToken: string;
}

// LinkedIn Campaign Types
export interface LinkedInCampaign {
  campaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT' | 'CANCELED';
  objectiveType?: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageClicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions?: number;
  costPerConversion?: number;
  targeting?: {
    jobTitles?: string[];
    companies?: string[];
    industries?: string[];
    skills?: string[];
  };
}

export interface LinkedInFetchInput {
  accountId: string;
  dateRange?: {
    start: string;
    end: string;
  };
  statuses?: string[];
}

// Variant Types
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

// Campaign Variant (individual campaign within a role)
export interface CampaignVariant {
  campaignId: string;
  name: string;
  variantType: VariantType;
  status: string;
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    landingPageClicks: number;
    ctr: number;
    cpc: number;
  };
}

// Aggregated Metrics
export interface AggregatedMetrics {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalLandingPageClicks: number;
  weightedCPC: number;
  weightedCTR: number;
}

// Role Batch - campaigns grouped by role within a company
export interface RoleBatch {
  roleKey: string;
  roleName: string;
  roleNameNormalized: string;
  campaigns: CampaignVariant[];
  variantBreakdown: {
    [key in VariantType]?: {
      count: number;
      spend: number;
      campaigns: CampaignVariant[];
    };
  };
  aggregatedMetrics: AggregatedMetrics;
}

// Company Batch - roles grouped by company
export interface CompanyBatch {
  companyKey: string;
  companyName: string;
  companyNameNormalized: string;
  companyTag?: string;
  roles: RoleBatch[];
  aggregatedMetrics: AggregatedMetrics;
}

// Parsing Warning
export interface ParsingWarning {
  campaignId: string;
  campaignName: string;
  warning: string;
  confidence: 'medium' | 'low';
}

// Legacy CampaignBatch (for backward compatibility with mapAndReconcile)
export interface CampaignBatch {
  batchId: string;
  baseName: string;
  company: string;
  role: string;
  campaigns: CampaignVariant[];
  aggregatedMetrics: AggregatedMetrics;
}

export interface BatchedCampaignsOutput {
  companyBatches: CompanyBatch[];
  flatBatches: CampaignBatch[]; // For backward compatibility
  ungrouped: LinkedInCampaign[];
  parsingWarnings: ParsingWarning[];
  stats: {
    totalCampaigns: number;
    totalCompanies: number;
    totalRoles: number;
    highConfidenceParsed: number;
    mediumConfidenceParsed: number;
    lowConfidenceParsed: number;
  };
}

// Internal Data Types
export interface InternalRole {
  jobTitle: string;
  companyName: string;
  resumes: number;           // Total resumes (paid + organic) - for backward compatibility
  paidResumes?: number;      // Resumes from paid campaigns (LinkedIn ads)
  organicResumes?: number;   // Resumes from organic sources (direct applications, referrals)
  source?: string;
  isLive?: boolean;          // Whether the role is currently live/active
  // Interview metrics
  interviewCount?: number;           // Number of candidates who completed interviews
  totalInterviewDuration?: number;   // Total interview time in seconds
  avgInterviewDuration?: number;     // Average interview duration in seconds
}

export interface InternalDataInput {
  dateRange?: {
    start: string;
    end: string;
  };
  source?: string;
  companyFilter?: string[];
}

// Mapped/Reconciled Types
export interface MatchedCampaign {
  matchConfidence: 'high' | 'medium' | 'low';
  linkedin: {
    batchName: string;
    company: string;
    role: string;
    campaigns: CampaignVariant[];
    totalSpend: number;
    liveSpend?: number;        // Spend from ACTIVE campaigns only
    totalImpressions: number;
    totalClicks: number;
    totalLandingPageClicks: number;
  };
  internal: {
    roleName: string;
    companyName: string;
    resumes: number;           // Total resumes (for backward compatibility)
    paidResumes?: number;      // Resumes from paid campaigns
    organicResumes?: number;   // Resumes from organic sources
    isLive?: boolean;          // Whether the role is currently live
  };
  combined: {
    costPerResume: number;     // liveSpend / paidResumes
    clickToResumeRate: number;
  };
}

export interface UnifiedReport {
  matchedCampaigns: MatchedCampaign[];
  unmatchedLinkedIn: CampaignBatch[];
  unmatchedInternal: InternalRole[];
  other: {
    linkedInSpend: number;
    linkedInClicks: number;
    organicResumes: number;
  };
  summary: {
    // Total spend breakdown
    totalSpend: number;                  // Total LinkedIn spend (resume + whatsapp)
    totalLiveSpend?: number;             // Spend from ACTIVE campaigns only (for transparency)
    matchedTotalSpend?: number;          // Spend on resume acquisition campaigns (used for CPR)
    whatsappSpend?: number;              // Spend on WhatsApp acquisition campaigns (separate tracking)

    // Resume metrics
    totalResumes: number;
    totalPaidResumes?: number;           // Paid resumes only
    matchedResumes: number;
    matchedPaidResumes?: number;         // Matched paid resumes
    unmatchedResumes: number;

    // CPR = matchedTotalSpend / matchedPaidResumes (excludes WhatsApp spend)
    overallCostPerResume: number;

    // Performance
    bestPerformingBatch: string | null;
    worstPerformingBatch: string | null;
    recommendations: string[];
  };

  // WhatsApp acquisition (separate category)
  whatsapp?: {
    campaigns: any[];
    totalSpend: number;
    campaignCount: number;
  };
}
