import React, { useState, useEffect, useCallback } from 'react';
import type { JobApplication } from '../types';
import { authFetch, useAuth } from '../contexts/AuthContext';

// Mapping info type (from backend)
interface MappingInfo {
  campaignName: string;
  company: string;
  role: string;
  batchId: string;
  approved?: boolean;
  approvedAt?: string;
  rejected?: boolean;
  rejectionReason?: string;
  rejectedAt?: string;
  source?: 'ai' | 'manual';
  createdAt?: string;
}

interface MappingsResponse {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  mappings: MappingInfo[];
  lastUpdated: string;
}

interface MappingCorrectionSuggestion {
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

interface RejectResponse {
  success: boolean;
  message: string;
  suggestions: MappingCorrectionSuggestion[];
}

// Types from Prometheus API
interface CampaignVariant {
  campaignId: string;
  name: string;
  variantType: string;
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

interface CampaignBatch {
  batchId: string;
  baseName: string;
  company: string;
  role: string;
  campaigns: CampaignVariant[];
  aggregatedMetrics: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalLandingPageClicks: number;
    weightedCTR: number;
    weightedCPC: number;
  };
  // Matched data (computed on frontend)
  matchedResumes?: number;
  costPerResume?: number;
}

interface InternalRole {
  jobTitle: string;
  companyName: string;
  resumes: number;
  source?: string;
}

interface CacheInfo {
  hit: boolean;
  fetchedAt: string;
  fetchedAtIST: string;
  cacheKey: string;
}

interface WhatsAppCampaign {
  campaignId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageClicks: number;
  status: string;
}

interface PrometheusResponse {
  linkedIn: {
    campaigns: any[];
    totalCampaigns: number;
  };
  internal: {
    roles: InternalRole[];
    totalRoles: number;
    totalResumes: number;
  };
  batches: {
    batches: CampaignBatch[];
    ungrouped: any[];
    totalBatches: number;
    whatsappCampaigns?: WhatsAppCampaign[];
    stats?: {
      whatsappSpend?: number;
    };
  };
  report: string;
  _cache?: CacheInfo;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function getStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'LIVE', className: 'bg-green-100 text-green-800' };
    case 'PAUSED':
      return { label: 'PAUSED', className: 'bg-amber-100 text-amber-800' };
    case 'ARCHIVED':
      return { label: 'ARCHIVED', className: 'bg-gray-200 text-gray-600' };
    case 'DRAFT':
      return { label: 'DRAFT', className: 'bg-blue-100 text-blue-700' };
    case 'CANCELED':
      return { label: 'CANCELED', className: 'bg-red-100 text-red-700' };
    default:
      return { label: status || 'UNKNOWN', className: 'bg-gray-100 text-gray-600' };
  }
}

function getVariantBadge(variantType: string): { label: string; className: string } {
  switch (variantType) {
    case 'pedigree':
      return { label: 'Pedigree', className: 'bg-purple-100 text-purple-800' };
    case 'pedigree_jt':
      return { label: 'Pedigree JT', className: 'bg-violet-100 text-violet-800' };
    case 'company_tg':
      return { label: 'Company TG', className: 'bg-blue-100 text-blue-800' };
    case 'job_title':
      return { label: 'Job Title', className: 'bg-cyan-100 text-cyan-800' };
    case 'community':
      return { label: 'Community', className: 'bg-teal-100 text-teal-800' };
    case 'startups':
      return { label: 'Startups', className: 'bg-orange-100 text-orange-800' };
    case 'geo':
      return { label: 'Geo', className: 'bg-emerald-100 text-emerald-800' };
    case 'base':
      return { label: 'Base', className: 'bg-gray-100 text-gray-700' };
    default:
      return { label: variantType, className: 'bg-gray-100 text-gray-600' };
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

interface CampaignROIProps {
  fetchApplications: (date?: string) => Promise<JobApplication[]>;
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function CampaignROI(_props: CampaignROIProps) {
  const { token } = useAuth();
  const [data, setData] = useState<PrometheusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'batches' | 'ungrouped' | 'all'>('all');
  const [columnSize, setColumnSize] = useState<'compact' | 'medium' | 'full'>('compact');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string>('spend');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showOrganicSection, setShowOrganicSection] = useState<boolean>(true);

  // Mapping approval state
  const [mappings, setMappings] = useState<MappingsResponse | null>(null);
  const [showMappingPanel, setShowMappingPanel] = useState(false);
  const [rejectingMapping, setRejectingMapping] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [mappingActionLoading, setMappingActionLoading] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MappingCorrectionSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Initialize dates on mount - default to Today
  useEffect(() => {
    const today = new Date();
    setStartDate(getDateString(today));
    setEndDate(getDateString(today));
  }, []);

  // Fetch mappings only when token is available
  const fetchMappings = useCallback(async () => {
    if (!token) return; // Wait for auth
    try {
      const response = await authFetch('/api/prometheus/mappings');
      if (response.ok) {
        const data: MappingsResponse = await response.json();
        setMappings(data);
      }
    } catch (err) {
      console.error('Error fetching mappings:', err);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchMappings();
    }
  }, [token, fetchMappings]);

  // Show feedback toast
  const showFeedback = (type: 'success' | 'error', message: string) => {
    setActionFeedback({ type, message });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  // Approve a batch
  const handleApproveBatch = async (batchId: string, batchName: string) => {
    setMappingActionLoading(batchId);
    try {
      const response = await authFetch('/api/prometheus/mappings/approve-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });

      if (response.ok) {
        const data = await response.json();
        await fetchMappings();
        showFeedback('success', `Approved & locked: ${batchName} (${data.approvedCount} campaigns)`);
      }
    } catch (err) {
      console.error('Error approving batch:', err);
      showFeedback('error', 'Failed to approve batch');
    } finally {
      setMappingActionLoading(null);
    }
  };

  // Reject a single mapping with AI analysis
  const handleRejectMapping = async (campaignName: string, reason: string) => {
    setMappingActionLoading(campaignName);
    try {
      const response = await authFetch('/api/prometheus/mappings/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignName, reason }),
      });

      if (response.ok) {
        const data: RejectResponse = await response.json();
        await fetchMappings();
        setRejectingMapping(null);
        setRejectionReason('');

        // Show AI suggestions if any
        if (data.suggestions && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
          setShowSuggestions(true);
          showFeedback('success', `Rejected. AI generated ${data.suggestions.length} correction suggestion(s).`);
        } else {
          showFeedback('success', `Rejected: ${campaignName}`);
        }
      }
    } catch (err) {
      console.error('Error rejecting mapping:', err);
      showFeedback('error', 'Failed to reject mapping');
    } finally {
      setMappingActionLoading(null);
    }
  };

  // Apply an AI suggestion
  const handleApplySuggestion = async (suggestion: MappingCorrectionSuggestion) => {
    setMappingActionLoading(suggestion.campaignName);
    try {
      const response = await authFetch('/api/prometheus/mappings/apply-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion }),
      });

      if (response.ok) {
        await fetchMappings();
        // Remove applied suggestion from list
        setSuggestions(prev => prev.filter(s => s.campaignName !== suggestion.campaignName));
        showFeedback('success', `Applied: ${suggestion.action} - ${suggestion.suggestedCompany || suggestion.currentCompany} | ${suggestion.suggestedRole || suggestion.currentRole}`);

        // Hide panel if no more suggestions
        if (suggestions.length <= 1) {
          setShowSuggestions(false);
        }
      }
    } catch (err) {
      console.error('Error applying suggestion:', err);
      showFeedback('error', 'Failed to apply suggestion');
    } finally {
      setMappingActionLoading(null);
    }
  };

  // Get mapping status for a batch
  const getBatchMappingStatus = (batchId: string): 'approved' | 'pending' | 'mixed' | 'unknown' => {
    if (!mappings) return 'unknown';

    const batchMappings = mappings.mappings.filter(m => m.batchId === batchId);
    if (batchMappings.length === 0) return 'unknown';

    const allApproved = batchMappings.every(m => m.approved);
    const someApproved = batchMappings.some(m => m.approved);

    if (allApproved) return 'approved';
    if (someApproved) return 'mixed';
    return 'pending';
  };

  const toggleBatchExpand = (batchId: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  };

  const getColumnWidth = () => {
    switch (columnSize) {
      case 'compact': return 'max-w-[200px]';
      case 'medium': return 'max-w-[350px]';
      case 'full': return '';
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc'); // Default to descending for new column
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return (
        <svg className="w-3 h-3 ml-1 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  useEffect(() => {
    if (token && startDate && endDate) {
      loadData();
    }
  }, [token, startDate, endDate]);

  const loadData = async (forceRefresh = false) => {
    if (!token) return; // Wait for auth
    setIsLoading(true);
    setError(null);

    try {
      // Build request body with optional force refresh
      const body: any = {};
      if (startDate && endDate) {
        body.startDate = startDate;
        body.endDate = endDate;
      }
      if (forceRefresh) {
        body.forceRefresh = true;
      }

      const response = await authFetch('/api/prometheus/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Prometheus data');
      }

      const result: PrometheusResponse = await response.json();
      setData(result);

      // Show feedback about cache status
      if (result._cache) {
        if (result._cache.hit) {
          showFeedback('success', `Using cached data from ${result._cache.fetchedAtIST}`);
        } else {
          showFeedback('success', `Fresh data fetched at ${result._cache.fetchedAtIST}`);
        }
      }
    } catch (err) {
      console.error('Error loading Prometheus data:', err);
      setError('Failed to load campaign analysis data');
    } finally {
      setIsLoading(false);
    }
  };

  const setDatePreset = (preset: string) => {
    const end = new Date();
    const start = new Date();

    switch (preset) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case '7days':
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start.setDate(start.getDate() - 30);
        break;
      case '90days':
        start.setDate(start.getDate() - 90);
        break;
      case 'thisMonth':
        start.setDate(1);
        break;
      case 'lastMonth':
        start.setMonth(start.getMonth() - 1);
        start.setDate(1);
        end.setDate(0); // Last day of previous month
        break;
    }

    setStartDate(getDateString(start));
    setEndDate(getDateString(end));
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Running Prometheus Analysis...</p>
        <p className="mt-2 text-xs text-gray-400">Fetching LinkedIn campaigns + Internal roles + AI batching</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        {error || 'No data available'}
        <button
          onClick={() => loadData()}
          className="ml-4 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { batches, internal } = data;

  // Company aliases - same company with different names
  const COMPANY_ALIASES: Record<string, string[]> = {
    'appsforbharat': ['afb', 'apps for bharat', 'appsforbharat'],
    'fampay': ['fampay', 'fam pay'],
    'waterlabs ai': ['waterlabs ai', 'waterlabsai', 'waterlabs'],
    'kaigentic': ['kaigentic', 'kaigentic'],
    'stealth': ['stealth'],
    'sarvam': ['sarvam'],
    'seekho': ['seekho'],
    'zilo': ['zilo'],
    'zoop': ['zoop'],
  };

  // Normalize role name by stripping company prefix for consistent display
  const normalizeRoleForDisplay = (jobTitle: string, companyName: string): string => {
    if (!jobTitle || !companyName) return jobTitle;

    let normalized = jobTitle.trim();
    const companyLower = companyName.toLowerCase().trim();
    const titleLower = normalized.toLowerCase();

    // Check if title starts with company name followed by space or dash
    if (titleLower.startsWith(companyLower + ' ') || titleLower.startsWith(companyLower + '-')) {
      normalized = normalized.slice(companyName.length).trim();
      normalized = normalized.replace(/^[-–—:|\s]+/, '').trim();
    }

    return normalized || jobTitle;
  };

  // Check if two company names match (including aliases)
  const companiesMatch = (company1: string, company2: string): boolean => {
    const c1 = company1.toLowerCase().trim();
    const c2 = company2.toLowerCase().trim();
    if (c1 === c2) return true;

    // Check if they share an alias group
    for (const [canonical, aliases] of Object.entries(COMPANY_ALIASES)) {
      const allNames = [canonical, ...aliases];
      if (allNames.includes(c1) && allNames.includes(c2)) return true;
      if (allNames.some(a => c1.includes(a) || a.includes(c1)) &&
          allNames.some(a => c2.includes(a) || a.includes(c2))) return true;
    }
    return false;
  };

  // Match batches with internal roles to get resume counts
  // Rule: One batch maps to exactly ONE internal role
  const matchBatchToRole = (batch: CampaignBatch): InternalRole | null => {
    const batchCompany = batch.company.toLowerCase().trim();
    const batchRole = batch.role.toLowerCase().trim();

    // Get all roles from this company (using alias matching)
    const companyRoles = internal.roles.filter(
      (r) => companiesMatch(r.companyName, batch.company)
    );

    if (companyRoles.length === 0) return null;

    // Helper: normalize role name by removing company prefix
    const normalizeRole = (jobTitle: string, company: string): string => {
      let normalized = jobTitle.toLowerCase().trim();
      // Remove company name prefix if present (e.g., "Waterlabs AI AI Product Manager" -> "AI Product Manager")
      const companyLower = company.toLowerCase().trim();
      if (normalized.startsWith(companyLower)) {
        normalized = normalized.slice(companyLower.length).trim();
      }
      // Also try removing with dash/hyphen variations
      const companyVariants = [companyLower, companyLower.replace(/\s+/g, '-'), companyLower.replace(/\s+/g, '')];
      for (const variant of companyVariants) {
        if (normalized.startsWith(variant)) {
          normalized = normalized.slice(variant.length).trim();
          break;
        }
      }
      return normalized;
    };

    const normalizedBatchRole = normalizeRole(batchRole, batchCompany);

    // Score each role for match quality
    let bestMatch: InternalRole | null = null;
    let bestScore = 0;

    for (const role of companyRoles) {
      const normalizedTitle = normalizeRole(role.jobTitle, role.companyName);
      let score = 0;

      // Exact match after normalization (highest priority)
      if (normalizedTitle === normalizedBatchRole) {
        score = 100;
      }
      // One contains the other
      else if (normalizedTitle.includes(normalizedBatchRole) || normalizedBatchRole.includes(normalizedTitle)) {
        score = 80;
      }
      // Word-level matching
      else {
        const batchWords = normalizedBatchRole.split(/\s+/).filter(w => w.length > 2);
        const titleWords = normalizedTitle.split(/\s+/).filter(w => w.length > 2);

        // Count matching words (exact or partial)
        const matchingWords = batchWords.filter(bw =>
          titleWords.some(tw => tw.includes(bw) || bw.includes(tw))
        );

        // Score based on percentage of batch words matched
        if (batchWords.length > 0) {
          score = (matchingWords.length / batchWords.length) * 60;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = role;
      }
    }

    // Only return match if score is high enough (at least 50% word match)
    return bestScore >= 30 ? bestMatch : null;
  };

  // Enrich batches with resume data (ONE batch = ONE role, no double counting)
  const enrichedBatches = batches.batches.map((batch) => {
    const matchedRole = matchBatchToRole(batch);
    const resumes = matchedRole?.resumes || 0;
    const cpr = resumes > 0 ? batch.aggregatedMetrics.totalSpend / resumes : 0;
    return {
      ...batch,
      matchedResumes: resumes,
      costPerResume: cpr,
      matchedRole, // Single matched role (no double counting)
    };
  });

  // Sort batches based on selected column
  const sortedBatches = [...enrichedBatches].sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortColumn) {
      case 'company':
        aVal = a.company.toLowerCase();
        bVal = b.company.toLowerCase();
        break;
      case 'spend':
        aVal = a.aggregatedMetrics.totalSpend;
        bVal = b.aggregatedMetrics.totalSpend;
        break;
      case 'resumes':
        aVal = a.matchedResumes || 0;
        bVal = b.matchedResumes || 0;
        break;
      case 'costPerResume':
        aVal = a.costPerResume || Infinity;
        bVal = b.costPerResume || Infinity;
        break;
      case 'lpClicks':
        aVal = a.aggregatedMetrics.totalLandingPageClicks;
        bVal = b.aggregatedMetrics.totalLandingPageClicks;
        break;
      case 'ctr':
        aVal = a.aggregatedMetrics.weightedCTR || 0;
        bVal = b.aggregatedMetrics.weightedCTR || 0;
        break;
      case 'cpc':
        aVal = a.aggregatedMetrics.weightedCPC || 0;
        bVal = b.aggregatedMetrics.weightedCPC || 0;
        break;
      default:
        aVal = a.aggregatedMetrics.totalSpend;
        bVal = b.aggregatedMetrics.totalSpend;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  // Sort ungrouped campaigns
  const sortedUngrouped = [...batches.ungrouped].sort((a: any, b: any) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortColumn) {
      case 'company':
        aVal = (a.name || '').toLowerCase();
        bVal = (b.name || '').toLowerCase();
        break;
      case 'spend':
        aVal = a.spend || 0;
        bVal = b.spend || 0;
        break;
      case 'lpClicks':
        aVal = a.landingPageClicks || 0;
        bVal = b.landingPageClicks || 0;
        break;
      case 'ctr':
        aVal = a.ctr || 0;
        bVal = b.ctr || 0;
        break;
      case 'cpc':
        aVal = a.cpc || 0;
        bVal = b.cpc || 0;
        break;
      default:
        aVal = a.spend || 0;
        bVal = b.spend || 0;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  // Calculate stats from available data
  const matchedCampaigns = batches.batches.reduce((sum, b) => sum + b.campaigns.length, 0);
  const unmatchedCampaigns = batches.ungrouped.length;
  const totalCampaigns = matchedCampaigns + unmatchedCampaigns;

  // Resume campaigns spend (batched + ungrouped, excludes WhatsApp since they're separated in backend)
  const resumeCampaignsSpend = batches.batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalSpend, 0) +
    batches.ungrouped.reduce((sum, c) => sum + c.spend, 0);
  const totalClicks = batches.batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalLandingPageClicks, 0) +
    batches.ungrouped.reduce((sum, c) => sum + c.landingPageClicks, 0);
  const totalResumes = internal.totalResumes;

  // Calculate organic roles - internal roles NOT matched to any LinkedIn campaign
  // Using the already-computed matchedRole from enrichedBatches (one batch = one role)
  const matchedRoleKeys = new Set<string>();
  sortedBatches.forEach((batch) => {
    if (batch.matchedRole) {
      matchedRoleKeys.add(`${batch.matchedRole.companyName}|${batch.matchedRole.jobTitle}`);
    }
  });

  const organicRoles = internal.roles.filter(
    (role) => !matchedRoleKeys.has(`${role.companyName}|${role.jobTitle}`)
  );
  const organicResumes = organicRoles.reduce((sum, r) => sum + r.resumes, 0);
  const paidResumes = totalResumes - organicResumes;

  // WhatsApp campaigns data
  const whatsappCampaigns = batches.whatsappCampaigns || [];
  const whatsappSpend = batches.stats?.whatsappSpend || whatsappCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
  const whatsappClicks = whatsappCampaigns.reduce((sum, c) => sum + (c.landingPageClicks || 0), 0);
  const whatsappImpressions = whatsappCampaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
  const whatsappCTR = whatsappImpressions > 0 ? (whatsappClicks / whatsappImpressions) * 100 : 0;
  const whatsappCPC = whatsappClicks > 0 ? whatsappSpend / whatsappClicks : 0;

  // CORRECT totals: Resume campaigns + WhatsApp = Total LinkedIn spend
  const totalSpend = resumeCampaignsSpend + whatsappSpend;
  const paidSpend = resumeCampaignsSpend; // Paid = Resume acquisition campaigns (already excludes WhatsApp)
  const paidImpressions = batches.batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalImpressions, 0) +
    batches.ungrouped.reduce((sum, c) => sum + (c.impressions || 0), 0);
  const paidLPClicks = totalClicks; // LP clicks from paid campaigns
  const paidCPC = paidLPClicks > 0 ? paidSpend / paidLPClicks : 0;

  // Cost per Paid Resume = Total Paid Spend / Paid Resumes
  const costPerPaidResume = paidResumes > 0 ? paidSpend / paidResumes : 0;

  return (
    <div className="space-y-6">
      {/* Feedback Toast */}
      {actionFeedback && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg transition-all ${
          actionFeedback.type === 'success'
            ? 'bg-green-600 text-white'
            : 'bg-red-600 text-white'
        }`}>
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'success' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium">{actionFeedback.message}</span>
          </div>
        </div>
      )}

      {/* AI Suggestions Panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">AI Correction Suggestions</h3>
                    <p className="text-sm text-gray-600">Based on your rejection, here's what the AI suggests</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSuggestions(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[50vh]">
              {suggestions.map((suggestion, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          suggestion.action === 'bifurcate' ? 'bg-blue-100 text-blue-700' :
                          suggestion.action === 'reassign' ? 'bg-green-100 text-green-700' :
                          suggestion.action === 'remove' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {suggestion.action.toUpperCase()}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          suggestion.confidence === 'high' ? 'bg-green-50 text-green-600' :
                          suggestion.confidence === 'medium' ? 'bg-amber-50 text-amber-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          {suggestion.confidence} confidence
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1">{suggestion.campaignName}</p>
                      <p className="text-sm text-gray-600 mb-2">
                        <span className="text-gray-400">Current:</span> {suggestion.currentCompany} | {suggestion.currentRole}
                      </p>
                      {(suggestion.suggestedCompany || suggestion.suggestedRole) && (
                        <p className="text-sm text-green-700 font-medium mb-2">
                          <span className="text-gray-400">Suggested:</span> {suggestion.suggestedCompany || suggestion.currentCompany} | {suggestion.suggestedRole || suggestion.currentRole}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">{suggestion.reason}</p>
                    </div>
                    <button
                      onClick={() => handleApplySuggestion(suggestion)}
                      disabled={mappingActionLoading === suggestion.campaignName}
                      className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      {mappingActionLoading === suggestion.campaignName ? 'Applying...' : 'Apply Fix'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setShowSuggestions(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Prometheus Campaign Analysis</h2>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-sm text-gray-500">
                AI-powered campaign batching with internal role matching
              </p>
              {data?._cache && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  data._cache.hit
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {data._cache.hit ? (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Cached: {data._cache.fetchedAtIST}
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Fresh: {data._cache.fetchedAtIST}
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-2"
              title="Load from cache if available"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={() => loadData(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2"
              title="Force fetch fresh data from APIs"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Force Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Date Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setDatePreset('today')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Today</button>
            <button onClick={() => setDatePreset('yesterday')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Yesterday</button>
            <button onClick={() => setDatePreset('7days')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">7 Days</button>
            <button onClick={() => setDatePreset('30days')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">30 Days</button>
            <button onClick={() => setDatePreset('90days')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">90 Days</button>
            <button onClick={() => setDatePreset('thisMonth')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">This Month</button>
            <button onClick={() => setDatePreset('lastMonth')} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Last Month</button>
          </div>
          <div className="text-sm text-gray-500 ml-auto">
            {startDate} to {endDate}
          </div>
        </div>
      </div>

      {/* Spend Overview Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-4">
        <div className="flex items-center justify-between gap-6">
          {/* Total Spend */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</span>
            <span className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpend)}</span>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-gray-200"></div>

          {/* Paid Spend */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">Paid (Resume)</span>
            <span className="text-xl font-semibold text-gray-800">{formatCurrency(paidSpend)}</span>
            <span className="text-xs text-gray-400">{totalCampaigns} campaigns</span>
          </div>

          {/* Divider */}
          <div className="h-8 w-px bg-gray-200"></div>

          {/* WhatsApp Spend */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-emerald-600 uppercase tracking-wide">WhatsApp</span>
            <span className="text-xl font-semibold text-gray-800">{formatCurrency(whatsappSpend)}</span>
            <span className="text-xs text-gray-400">{whatsappCampaigns.length} campaigns</span>
          </div>

          {/* Spacer */}
          <div className="flex-1"></div>

          {/* Date Range Indicator */}
          <div className="text-xs text-gray-400">
            {startDate === endDate ? startDate : `${startDate} → ${endDate}`}
          </div>
        </div>
      </div>

      {/* Paid Campaigns - Compact Inline Row */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-3">
        <div className="flex items-center gap-6 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid Campaigns</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Impressions</span>
            <span className="text-sm font-semibold text-gray-700">{formatNumber(paidImpressions)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">LP Clicks</span>
            <span className="text-sm font-semibold text-gray-700">{formatNumber(paidLPClicks)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">CPC</span>
            <span className="text-sm font-semibold text-gray-700">{formatCurrency(paidCPC)}</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-blue-500">Paid Resumes</span>
            <span className="text-sm font-bold text-blue-700">{paidResumes}</span>
          </div>
        </div>
      </div>

      {/* Hero Outcome Cards - Cost/Resume + Total Resumes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Cost per Resume Card */}
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-l-orange-400 border-t border-r border-b border-gray-100 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-1">Cost / Paid Resume</p>
              <p className="text-4xl font-bold text-gray-900">{formatCurrency(costPerPaidResume)}</p>
              <p className="text-sm text-gray-500 mt-2">
                {formatCurrency(paidSpend)} ÷ {paidResumes} resumes
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-full">
              <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Total Resumes Card */}
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-l-blue-400 border-t border-r border-b border-gray-100 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Total Resumes</p>
              <p className="text-4xl font-bold text-gray-900">{totalResumes}</p>
              <p className="text-sm text-gray-500 mt-2">
                <span className="text-blue-600 font-medium">{paidResumes}</span> paid · <span className="text-green-600 font-medium">{organicResumes}</span> organic
              </p>
            </div>
            <div className="p-3 bg-blue-50 rounded-full">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* WhatsApp Section - Left Border Accent */}
      {whatsappCampaigns.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-l-emerald-400 border-t border-r border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">WhatsApp</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">Spend</span>
              <span className="text-sm font-semibold text-gray-700">{formatCurrency(whatsappSpend)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">Impressions</span>
              <span className="text-sm font-semibold text-gray-700">{formatNumber(whatsappImpressions)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">CTR</span>
              <span className="text-sm font-semibold text-gray-700">{whatsappCTR.toFixed(2)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">CPC</span>
              <span className="text-sm font-semibold text-gray-700">{formatCurrency(whatsappCPC)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Batches Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Campaign Batches by Role</h3>
            <p className="text-sm text-gray-500">
              {batches.totalBatches} role batches with {matchedCampaigns} campaigns
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">View:</span>
              <button
                onClick={() => setViewMode('batches')}
                className={`px-3 py-1 text-sm rounded ${viewMode === 'batches' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Batches ({batches.totalBatches})
              </button>
              <button
                onClick={() => setViewMode('ungrouped')}
                className={`px-3 py-1 text-sm rounded ${viewMode === 'ungrouped' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Stand-alone ({batches.ungrouped.length})
              </button>
              <button
                onClick={() => setViewMode('all')}
                className={`px-3 py-1 text-sm rounded ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                All
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Columns:</span>
              <button
                onClick={() => setColumnSize('compact')}
                className={`px-3 py-1 text-sm rounded ${columnSize === 'compact' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Compact
              </button>
              <button
                onClick={() => setColumnSize('full')}
                className={`px-3 py-1 text-sm rounded ${columnSize === 'full' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Full
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('company')}
                >
                  <div className="flex items-center">
                    Company / Role
                    <SortIcon column="company" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('spend')}
                >
                  <div className="flex items-center justify-end">
                    Spend
                    <SortIcon column="spend" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('resumes')}
                >
                  <div className="flex items-center justify-end">
                    Resumes
                    <SortIcon column="resumes" />
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase bg-blue-50">
                  Role Details
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase bg-orange-50 cursor-pointer hover:bg-orange-100 select-none"
                  onClick={() => handleSort('costPerResume')}
                >
                  <div className="flex items-center justify-end">
                    Cost/Resume
                    <SortIcon column="costPerResume" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('lpClicks')}
                >
                  <div className="flex items-center justify-end">
                    LP Clicks
                    <SortIcon column="lpClicks" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('ctr')}
                >
                  <div className="flex items-center justify-end">
                    CTR
                    <SortIcon column="ctr" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('cpc')}
                >
                  <div className="flex items-center justify-end">
                    CPC
                    <SortIcon column="cpc" />
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase bg-indigo-50">
                  <div className="flex items-center justify-center gap-1">
                    Mapping
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMappingPanel(!showMappingPanel);
                      }}
                      className="ml-1 text-indigo-600 hover:text-indigo-800"
                      title="View all mappings"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Batched Campaigns */}
              {(viewMode === 'batches' || viewMode === 'all') && sortedBatches.map((batch) => (
                <React.Fragment key={batch.batchId}>
                  <tr
                    className="hover:bg-purple-50 cursor-pointer bg-purple-25"
                    onClick={() => toggleBatchExpand(batch.batchId)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-purple-600">
                          {expandedBatches.has(batch.batchId) ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </span>
                        <div>
                          <div className={`font-semibold text-gray-900 ${columnSize === 'full' ? '' : `truncate ${getColumnWidth()}`}`}>
                            {batch.company}
                          </div>
                          <div className={`text-sm text-purple-700 ${columnSize === 'full' ? '' : `truncate ${getColumnWidth()}`}`}>
                            {batch.role}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                              {batch.campaigns.length} campaigns
                            </span>
                            {batch.campaigns.filter(c => c.status === 'ACTIVE').length > 0 && (
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                {batch.campaigns.filter(c => c.status === 'ACTIVE').length} live
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                      {formatCurrency(batch.aggregatedMetrics.totalSpend)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {batch.matchedResumes && batch.matchedResumes > 0 ? (
                        <span className="text-sm font-semibold text-blue-600">{batch.matchedResumes}</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 bg-blue-50">
                      {batch.matchedRole ? (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-700 truncate max-w-[150px]" title={normalizeRoleForDisplay(batch.matchedRole.jobTitle, batch.matchedRole.companyName)}>
                            {normalizeRoleForDisplay(batch.matchedRole.jobTitle, batch.matchedRole.companyName)}
                          </span>
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium whitespace-nowrap">
                            {batch.matchedRole.resumes} resume{batch.matchedRole.resumes !== 1 ? 's' : ''}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-500 truncate max-w-[150px]" title={batch.role}>
                            {batch.role}
                          </span>
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-medium whitespace-nowrap">
                            0 resumes today
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right bg-orange-50">
                      {batch.costPerResume && batch.costPerResume > 0 ? (
                        <span className={`text-sm font-bold ${batch.costPerResume < 300 ? 'text-green-600' : batch.costPerResume < 500 ? 'text-orange-600' : 'text-red-600'}`}>
                          {formatCurrency(batch.costPerResume)}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {formatNumber(batch.aggregatedMetrics.totalLandingPageClicks)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {batch.aggregatedMetrics.weightedCTR?.toFixed(2) || '0.00'}%
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600">
                      {formatCurrency(batch.aggregatedMetrics.weightedCPC || 0)}
                    </td>
                    <td className="px-4 py-3 text-center bg-indigo-50" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const status = getBatchMappingStatus(batch.batchId);
                        const isLoading = mappingActionLoading === batch.batchId;

                        if (status === 'approved') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Locked
                            </span>
                          );
                        }

                        if (status === 'mixed') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                              Partial
                            </span>
                          );
                        }

                        return (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleApproveBatch(batch.batchId, `${batch.company} | ${batch.role}`)}
                              disabled={isLoading}
                              className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 transition-colors"
                              title="Approve - Lock this mapping forever"
                            >
                              {isLoading ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                const firstMapping = mappings?.mappings.find(m => m.batchId === batch.batchId);
                                if (firstMapping) {
                                  setRejectingMapping(firstMapping.campaignName);
                                }
                              }}
                              disabled={isLoading}
                              className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 transition-colors"
                              title="Reject - Mark as incorrect"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                  {/* Expanded campaign details */}
                  {expandedBatches.has(batch.batchId) && batch.campaigns.map((campaign) => (
                    <tr key={campaign.campaignId} className="bg-purple-50/50 hover:bg-purple-100/50">
                      <td className="px-4 py-2 pl-10">
                        <div className={`text-sm text-gray-700 ${columnSize === 'full' ? '' : `truncate ${getColumnWidth()}`}`}>
                          {campaign.name}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {(() => {
                            const statusBadge = getStatusBadge(campaign.status);
                            const variantBadge = getVariantBadge(campaign.variantType);
                            return (
                              <>
                                <span className={`px-1 py-0.5 rounded text-xs ${statusBadge.className}`}>
                                  {statusBadge.label}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded text-xs ${variantBadge.className}`}>
                                  {variantBadge.label}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">
                        {formatCurrency(campaign.metrics.spend)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-400">
                        —
                      </td>
                      <td className="px-4 py-2 bg-blue-50/50 text-sm text-gray-400">
                        —
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-400 bg-orange-50/50">
                        —
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-500">
                        {formatNumber(campaign.metrics.landingPageClicks)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-500">
                        {campaign.metrics.ctr.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-gray-500">
                        {formatCurrency(campaign.metrics.cpc)}
                      </td>
                      <td className="px-4 py-2 text-center bg-indigo-50/50 text-sm text-gray-400">
                        —
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}

              {/* Ungrouped Campaigns */}
              {(viewMode === 'ungrouped' || viewMode === 'all') && sortedUngrouped.length > 0 && (
                <>
                  {viewMode === 'all' && (
                    <tr className="bg-orange-50">
                      <td colSpan={9} className="px-4 py-2 text-sm font-semibold text-orange-800">
                        Stand-alone Campaigns ({sortedUngrouped.length})
                      </td>
                    </tr>
                  )}
                  {sortedUngrouped.map((campaign: any) => (
                    <tr key={campaign.campaignId} className="hover:bg-orange-50/50 bg-orange-25">
                      <td className="px-4 py-3">
                        <div className={`font-medium text-gray-900 ${columnSize === 'full' ? '' : `truncate ${getColumnWidth()}`}`}>
                          {campaign.name}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          {(() => {
                            const badge = getStatusBadge(campaign.status);
                            return (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            Stand-alone
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                        {formatCurrency(campaign.spend)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-400">
                        —
                      </td>
                      <td className="px-4 py-3 bg-blue-50 text-sm text-gray-400">
                        —
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-400 bg-orange-50">
                        —
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600">
                        {formatNumber(campaign.landingPageClicks)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600">
                        {campaign.ctr?.toFixed(2) || 0}%
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600">
                        {formatCurrency(campaign.cpc || 0)}
                      </td>
                      <td className="px-4 py-3 text-center bg-indigo-50 text-sm text-gray-400">
                        —
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rejection Modal */}
      {rejectingMapping && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Reject Mapping</h3>
            <p className="text-sm text-gray-600 mb-4">
              Rejecting: <span className="font-medium">{rejectingMapping}</span>
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Why is this mapping incorrect?
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g., This should map to 'Backend Engineer' not 'AI Engineer'"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRejectingMapping(null);
                  setRejectionReason('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRejectMapping(rejectingMapping, rejectionReason)}
                disabled={!rejectionReason.trim() || mappingActionLoading === rejectingMapping}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mappingActionLoading === rejectingMapping ? 'Analyzing...' : 'Reject & Analyze'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Summary Panel */}
      {showMappingPanel && mappings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Campaign Mappings</h3>
                <p className="text-sm text-gray-500">
                  {mappings.approved} approved (locked) · {mappings.pending} pending · {mappings.rejected} rejected
                </p>
              </div>
              <button
                onClick={() => setShowMappingPanel(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Campaign</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {mappings.mappings.map((mapping, idx) => (
                    <tr key={idx} className={`hover:bg-gray-50 ${mapping.approved ? 'bg-green-50/30' : mapping.rejected ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-2 text-sm text-gray-900 max-w-[200px] truncate" title={mapping.campaignName}>
                        {mapping.campaignName}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">{mapping.company}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{mapping.role}</td>
                      <td className="px-4 py-2 text-center">
                        {mapping.approved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Locked
                          </span>
                        ) : mapping.rejected ? (
                          <span className="inline-flex items-center px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-medium" title={mapping.rejectionReason}>
                            Rejected
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${mapping.source === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {mapping.source || 'ai'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
              Last updated: {new Date(mappings.lastUpdated).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Organic Resumes Section */}
      {organicRoles.length > 0 && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl shadow-sm border border-green-200 overflow-hidden">
          <div
            className="px-6 py-4 border-b border-green-200 cursor-pointer hover:bg-green-100/50 transition-colors"
            onClick={() => setShowOrganicSection(!showOrganicSection)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-green-600">
                  {showOrganicSection ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-green-900">Organic Resumes</h3>
                  <p className="text-sm text-green-700">
                    Roles receiving resumes without LinkedIn ad spend
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-800">{organicResumes}</p>
                  <p className="text-xs text-green-600">resumes</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-800">{organicRoles.length}</p>
                  <p className="text-xs text-green-600">roles</p>
                </div>
                <div className="text-right border-l border-green-300 pl-6">
                  <p className="text-lg font-semibold text-green-700">
                    {totalResumes > 0 ? ((organicResumes / totalResumes) * 100).toFixed(1) : 0}%
                  </p>
                  <p className="text-xs text-green-600">of total</p>
                </div>
              </div>
            </div>
          </div>
          {showOrganicSection && (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full">
                <thead className="bg-green-100/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-green-800 uppercase">Company</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-green-800 uppercase">Role</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-green-800 uppercase">Resumes</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-green-800 uppercase">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-green-100">
                  {organicRoles
                    .sort((a, b) => b.resumes - a.resumes)
                    .map((role, idx) => (
                      <tr key={idx} className="hover:bg-green-100/30">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{role.companyName}</td>
                        <td className="px-4 py-2 text-sm text-gray-700">{role.jobTitle}</td>
                        <td className="px-4 py-2 text-right text-sm font-semibold text-green-700">{role.resumes}</td>
                        <td className="px-4 py-2 text-right">
                          <span className="px-2 py-0.5 bg-green-200 text-green-800 rounded text-xs font-medium">
                            FREE
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
