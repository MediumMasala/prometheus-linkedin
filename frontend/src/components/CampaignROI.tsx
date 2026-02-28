import React, { useState, useEffect } from 'react';
import type { JobApplication } from '../types';
import { authFetch } from '../contexts/AuthContext';

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
  };
  report: string;
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

  // Initialize dates on mount - default to Today
  useEffect(() => {
    const today = new Date();
    setStartDate(getDateString(today));
    setEndDate(getDateString(today));
  }, []);

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
    if (startDate && endDate) {
      loadData();
    }
  }, [startDate, endDate]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Only send dates if both are set, otherwise let backend use defaults
      const body = startDate && endDate ? { startDate, endDate } : {};
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
          onClick={loadData}
          className="ml-4 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { batches, internal } = data;

  // Match batches with internal roles to get resume counts
  const matchBatchToRole = (batch: CampaignBatch): InternalRole | null => {
    // Try exact match first (company + role)
    const exactMatch = internal.roles.find(
      (r) => r.companyName.toLowerCase() === batch.company.toLowerCase() &&
             (r.jobTitle.toLowerCase().includes(batch.role.toLowerCase()) ||
              batch.role.toLowerCase().includes(r.jobTitle.toLowerCase()) ||
              r.jobTitle.toLowerCase() === batch.role.toLowerCase())
    );
    if (exactMatch) return exactMatch;

    // Try company match with similar role
    const companyMatches = internal.roles.filter(
      (r) => r.companyName.toLowerCase() === batch.company.toLowerCase()
    );
    if (companyMatches.length > 0) {
      // Find best role match
      const roleWords = batch.role.toLowerCase().split(/\s+/);
      let bestMatch: InternalRole | null = null;
      let bestScore = 0;
      for (const role of companyMatches) {
        const titleWords = role.jobTitle.toLowerCase().split(/\s+/);
        const matchingWords = roleWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw)));
        if (matchingWords.length > bestScore) {
          bestScore = matchingWords.length;
          bestMatch = role;
        }
      }
      if (bestMatch && bestScore >= 1) return bestMatch;
    }
    return null;
  };

  // Enrich batches with resume data
  const enrichedBatches = batches.batches.map((batch) => {
    const matchedRole = matchBatchToRole(batch);
    const resumes = matchedRole?.resumes || 0;
    const cpr = resumes > 0 ? batch.aggregatedMetrics.totalSpend / resumes : 0;
    return {
      ...batch,
      matchedResumes: resumes,
      costPerResume: cpr,
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

  // Count active vs paused
  const activeBatched = batches.batches.reduce((sum, b) => sum + b.campaigns.filter(c => c.status === 'ACTIVE').length, 0);
  const activeUngrouped = batches.ungrouped.filter((c: any) => c.status === 'ACTIVE').length;
  const totalActive = activeBatched + activeUngrouped;
  const totalPaused = totalCampaigns - totalActive;

  const totalSpend = batches.batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalSpend, 0) +
    batches.ungrouped.reduce((sum, c) => sum + c.spend, 0);
  const totalClicks = batches.batches.reduce((sum, b) => sum + b.aggregatedMetrics.totalLandingPageClicks, 0) +
    batches.ungrouped.reduce((sum, c) => sum + c.landingPageClicks, 0);
  const totalResumes = internal.totalResumes;
  const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const costPerResume = totalResumes > 0 ? totalSpend / totalResumes : 0;

  // Calculate organic roles - internal roles NOT matched to any LinkedIn campaign
  const matchedRoleKeys = new Set<string>();
  sortedBatches.forEach((batch) => {
    const matchedRole = matchBatchToRole(batch);
    if (matchedRole) {
      matchedRoleKeys.add(`${matchedRole.companyName}|${matchedRole.jobTitle}`);
    }
  });

  const organicRoles = internal.roles.filter(
    (role) => !matchedRoleKeys.has(`${role.companyName}|${role.jobTitle}`)
  );
  const organicResumes = organicRoles.reduce((sum, r) => sum + r.resumes, 0);
  const paidResumes = totalResumes - organicResumes;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Prometheus Campaign Analysis</h2>
            <p className="text-sm text-gray-500 mt-1">
              AI-powered campaign batching with internal role matching
            </p>
          </div>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Campaigns</p>
          <p className="text-2xl font-bold text-gray-900">{totalCampaigns}</p>
          <p className="text-xs">
            <span className="text-green-600">{totalActive} live</span>
            {' · '}
            <span className="text-amber-600">{totalPaused} paused</span>
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Role Batches</p>
          <p className="text-2xl font-bold text-purple-600">{batches.totalBatches}</p>
          <p className="text-xs text-gray-400">{matchedCampaigns} campaigns matched</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Stand-alone</p>
          <p className="text-2xl font-bold text-orange-600">{unmatchedCampaigns}</p>
          <p className="text-xs text-gray-400">{activeUngrouped} active</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Internal Roles</p>
          <p className="text-2xl font-bold text-blue-600">{internal.totalRoles}</p>
          <p className="text-xs text-gray-400">{internal.totalResumes} resumes</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Spend</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpend)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg CPC</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(avgCPC)}</p>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-xl shadow-sm border border-orange-200 p-4">
          <p className="text-xs text-orange-700 uppercase tracking-wide">Cost/Resume</p>
          <p className="text-2xl font-bold text-orange-900">{formatCurrency(costPerResume)}</p>
        </div>
      </div>

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
                    </tr>
                  ))}
                </React.Fragment>
              ))}

              {/* Ungrouped Campaigns */}
              {(viewMode === 'ungrouped' || viewMode === 'all') && sortedUngrouped.length > 0 && (
                <>
                  {viewMode === 'all' && (
                    <tr className="bg-orange-50">
                      <td colSpan={7} className="px-4 py-2 text-sm font-semibold text-orange-800">
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
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      {/* Summary Stats */}
      {organicRoles.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500 uppercase">Paid Resumes</p>
              <p className="text-xl font-bold text-purple-600">{paidResumes}</p>
              <p className="text-xs text-gray-400">{totalResumes > 0 ? ((paidResumes / totalResumes) * 100).toFixed(1) : 0}% of total</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Organic Resumes</p>
              <p className="text-xl font-bold text-green-600">{organicResumes}</p>
              <p className="text-xs text-gray-400">{totalResumes > 0 ? ((organicResumes / totalResumes) * 100).toFixed(1) : 0}% of total</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Effective Cost/Resume</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(paidResumes > 0 ? totalSpend / paidResumes : 0)}</p>
              <p className="text-xs text-gray-400">paid resumes only</p>
            </div>
          </div>
        </div>
      )}

      {/* Internal Roles Reference */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Internal Roles (Grapevine)</h3>
          <p className="text-sm text-gray-500">
            {internal.totalRoles} active roles with {internal.totalResumes} total resumes
          </p>
        </div>
        <div className="overflow-x-auto max-h-64">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Company</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Resumes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {internal.roles.slice(0, 50).map((role, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900">{role.companyName}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{role.jobTitle}</td>
                  <td className="px-4 py-2 text-right text-sm font-medium text-blue-600">{role.resumes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
