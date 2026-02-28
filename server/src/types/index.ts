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
  resumes: number;
  source?: string;
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
    totalImpressions: number;
    totalClicks: number;
    totalLandingPageClicks: number;
  };
  internal: {
    roleName: string;
    companyName: string;
    resumes: number;
  };
  combined: {
    costPerResume: number;
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
    totalSpend: number;
    totalResumes: number;
    matchedResumes: number;
    unmatchedResumes: number;
    overallCostPerResume: number;
    bestPerformingBatch: string | null;
    worstPerformingBatch: string | null;
    recommendations: string[];
  };
}
