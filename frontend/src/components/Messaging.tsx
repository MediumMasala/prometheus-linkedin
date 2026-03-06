import { useState, useEffect } from 'react';
import { authFetch, useAuth } from '../contexts/AuthContext';

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING COMPONENT - Auto-generate client messages with campaign metrics
// Uses the same data as Campaign ROI for consistency
// ═══════════════════════════════════════════════════════════════════════════════

interface CampaignMetrics {
  impressions: number;
  clicks: number;
  landingPageClicks: number;
  spend: number;
  ctr: number;
  cpc: number;
}

interface InternalRole {
  jobTitle: string;
  companyName: string;
  resumes: number;
  tier1Count?: number;
  supremeCount?: number;
  nonTier1Count?: number;
  interviewCount?: number;
  totalInterviewDuration?: number;
  avgInterviewDuration?: number;
}

interface CampaignBatch {
  batchId: string;
  baseName: string;
  company: string;
  role: string;
  aggregatedMetrics: {
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalLandingPageClicks: number;
    weightedCTR: number;
    weightedCPC: number;
  };
  // Matched resume data (from internal roles)
  matchedResumes?: number;
  matchedRole?: InternalRole | null;
}

interface CompanyData {
  company: string;
  roles: {
    role: string;
    batchId: string;
    metrics: CampaignMetrics;
    matchedResumes: number;
    matchedRole: InternalRole | null;
    interviewMinutes: number;
  }[];
  totalImpressions: number;
  totalInterviewMinutes: number;
  totalResumes: number;
}

interface GeneratedMessage {
  message: string;
  metrics: {
    impressions: number;
    totalResumes: number;
    tier1Count: number;
    supremeCount: number;
    nonTier1Count: number;
    landingPageClicks: number;
    interviewMinutes: number;
  };
}

type MessageType = 'company' | 'role';

// Company aliases - same as CampaignROI
const COMPANY_ALIASES: Record<string, string[]> = {
  appsforbharat: ['afb', 'apps for bharat', 'appsforbharat'],
  fampay: ['fampay', 'fam pay'],
  'waterlabs ai': ['waterlabs ai', 'waterlabsai', 'waterlabs'],
  kaigentic: ['kaigentic', 'kaigentic'],
  stealth: ['stealth'],
  sarvam: ['sarvam'],
  seekho: ['seekho'],
  zilo: ['zilo'],
  zoop: ['zoop'],
};

function formatNumber(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return new Intl.NumberFormat('en-IN').format(value);
}

// Top Indian startups for candidate companies
const TOP_INDIAN_STARTUPS = [
  'Razorpay', 'Zerodha', 'CRED', 'PhonePe', 'Swiggy', 'Zomato', 'Flipkart',
  'Meesho', 'Groww', 'Slice', 'Jupiter', 'Dream11', 'ShareChat',
  'Unacademy', 'upGrad', 'Freshworks', 'Chargebee', 'Postman', 'BrowserStack',
  'Ola', 'Paytm', 'Myntra', 'Nykaa', 'Lenskart', 'Urban Company', 'Dunzo',
  'Curefit', 'Spinny', 'Cars24', 'OYO', 'Byju\'s', 'PharmEasy', 'Licious'
];

function getRandomCompanies(count: number = 3): string {
  const shuffled = [...TOP_INDIAN_STARTUPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).join(', ');
}

// Check if two company names match (including aliases) - same as CampaignROI
function companiesMatch(company1: string, company2: string): boolean {
  const c1 = company1.toLowerCase().trim();
  const c2 = company2.toLowerCase().trim();
  if (c1 === c2) return true;

  for (const [canonical, aliases] of Object.entries(COMPANY_ALIASES)) {
    const allNames = [canonical, ...aliases];
    if (allNames.includes(c1) && allNames.includes(c2)) return true;
    if (
      allNames.some((a) => c1.includes(a) || a.includes(c1)) &&
      allNames.some((a) => c2.includes(a) || a.includes(c2))
    )
      return true;
  }
  return false;
}

// Match batch to internal role - same logic as CampaignROI
function matchBatchToRole(
  batch: { company: string; role: string },
  internalRoles: InternalRole[]
): InternalRole | null {
  const batchCompany = batch.company.toLowerCase().trim();
  const batchRole = batch.role.toLowerCase().trim();

  // Get all roles from this company (using alias matching)
  const companyRoles = internalRoles.filter((r) => companiesMatch(r.companyName, batch.company));

  if (companyRoles.length === 0) return null;

  // Helper: normalize role name by removing company prefix
  const normalizeRole = (jobTitle: string, company: string): string => {
    let normalized = jobTitle.toLowerCase().trim();
    const companyLower = company.toLowerCase().trim();
    if (normalized.startsWith(companyLower)) {
      normalized = normalized.slice(companyLower.length).trim();
    }
    const companyVariants = [
      companyLower,
      companyLower.replace(/\s+/g, '-'),
      companyLower.replace(/\s+/g, ''),
    ];
    for (const variant of companyVariants) {
      if (normalized.startsWith(variant)) {
        normalized = normalized.slice(variant.length).trim();
        break;
      }
    }
    return normalized;
  };

  const normalizedBatchRole = normalizeRole(batchRole, batchCompany);

  let bestMatch: InternalRole | null = null;
  let bestScore = 0;

  for (const role of companyRoles) {
    const normalizedTitle = normalizeRole(role.jobTitle, role.companyName);
    let score = 0;

    if (normalizedTitle === normalizedBatchRole) {
      score = 100;
    } else if (
      normalizedTitle.includes(normalizedBatchRole) ||
      normalizedBatchRole.includes(normalizedTitle)
    ) {
      score = 80;
    } else {
      const batchWords = normalizedBatchRole.split(/\s+/).filter((w) => w.length > 2);
      const titleWords = normalizedTitle.split(/\s+/).filter((w) => w.length > 2);
      const matchingWords = batchWords.filter((bw) =>
        titleWords.some((tw) => tw.includes(bw) || bw.includes(tw))
      );
      if (batchWords.length > 0) {
        score = (matchingWords.length / batchWords.length) * 60;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = role;
    }
  }

  return bestScore >= 30 ? bestMatch : null;
}

export function Messaging() {
  const { token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [messageType, setMessageType] = useState<MessageType>('role');
  const [generatedMessage, setGeneratedMessage] = useState<GeneratedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Date range state (default to last 3 days)
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Calculate days from date range
  const daysSinceLive = startDate && endDate
    ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 1;

  // Initialize date range on mount
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 2); // Last 3 days
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }, []);

  // Fetch campaigns when date range changes
  useEffect(() => {
    if (token && startDate && endDate) {
      fetchCampaigns();
    }
  }, [token, startDate, endDate]);

  // Fetch all campaigns and group by company - uses same data as Campaign ROI
  const fetchCampaigns = async () => {
    setIsLoading(true);
    setError(null);
    setSelectedCompany('');
    setSelectedRole('');
    setGeneratedMessage(null);

    try {
      const response = await authFetch('/api/prometheus/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });

      if (!response.ok) throw new Error('Failed to fetch campaign data');

      const data = await response.json();
      const batches: CampaignBatch[] = data.batches?.batches || [];
      const internalRoles: InternalRole[] = (data.internal?.roles || []).map((r: any) => ({
        jobTitle: r.jobTitle,
        companyName: r.companyName,
        resumes: r.resumes || 0,
        tier1Count: r.tier1Count || 0,
        supremeCount: r.supremeCount || 0,
        nonTier1Count: r.nonTier1Count || 0,
        interviewCount: r.interviewCount || 0,
        totalInterviewDuration: r.totalInterviewDuration || 0,
        avgInterviewDuration: r.avgInterviewDuration || 0,
      }));

      // Group by company and match with internal roles
      const companyMap = new Map<string, CompanyData>();

      batches.forEach((batch) => {
        const matchedRole = matchBatchToRole(batch, internalRoles);
        const existing = companyMap.get(batch.company);
        const interviewMinutes = matchedRole?.totalInterviewDuration
          ? Math.round(matchedRole.totalInterviewDuration / 60)
          : 0;

        const roleData = {
          role: batch.role,
          batchId: batch.batchId,
          metrics: {
            impressions: batch.aggregatedMetrics.totalImpressions,
            clicks: batch.aggregatedMetrics.totalClicks,
            landingPageClicks: batch.aggregatedMetrics.totalLandingPageClicks,
            spend: batch.aggregatedMetrics.totalSpend,
            ctr: batch.aggregatedMetrics.weightedCTR,
            cpc: batch.aggregatedMetrics.weightedCPC,
          },
          matchedResumes: matchedRole?.resumes || 0,
          matchedRole,
          interviewMinutes,
        };

        if (existing) {
          existing.roles.push(roleData);
          existing.totalImpressions += batch.aggregatedMetrics.totalImpressions;
          existing.totalInterviewMinutes += interviewMinutes;
          existing.totalResumes += matchedRole?.resumes || 0;
        } else {
          companyMap.set(batch.company, {
            company: batch.company,
            roles: [roleData],
            totalImpressions: batch.aggregatedMetrics.totalImpressions,
            totalInterviewMinutes: interviewMinutes,
            totalResumes: matchedRole?.resumes || 0,
          });
        }
      });

      // Sort by total impressions (most active first)
      const sortedCompanies = Array.from(companyMap.values()).sort(
        (a, b) => b.totalImpressions - a.totalImpressions
      );

      setCompanies(sortedCompanies);

      if (sortedCompanies.length === 0) {
        setError('No live campaigns found for the selected date range.');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Failed to fetch campaigns. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Get roles for selected company
  const selectedCompanyData = companies.find((c) => c.company === selectedCompany);
  const availableRoles = selectedCompanyData?.roles || [];

  // Get selected role data
  const selectedRoleData = availableRoles.find((r) => r.role === selectedRole);

  // Generate message when role is selected
  const handleGenerateMessage = async () => {
    if (!selectedCompany) return;
    if (messageType === 'role' && (!selectedRole || !selectedRoleData)) return;

    setIsGenerating(true);
    setError(null);

    try {
      const companyData = companies.find(c => c.company === selectedCompany);

      if (messageType === 'company' && companyData) {
        // Company-level metrics (aggregate)
        const totalLPClicks = companyData.roles.reduce((sum, r) => sum + r.metrics.landingPageClicks, 0);
        const metrics = {
          impressions: companyData.totalImpressions,
          totalResumes: companyData.totalResumes,
          tier1Count: 0,
          supremeCount: 0,
          nonTier1Count: 0,
          landingPageClicks: totalLPClicks,
          interviewMinutes: companyData.totalInterviewMinutes,
        };

        const message = generateRound1Message(messageType, selectedCompany, '', metrics, companyData);
        setGeneratedMessage({ message, metrics });
      } else if (selectedRoleData) {
        // Role-level metrics
        const matchedRole = selectedRoleData.matchedRole;
        const metrics = {
          impressions: selectedRoleData.metrics.impressions,
          totalResumes: selectedRoleData.matchedResumes,
          tier1Count: matchedRole?.tier1Count || 0,
          supremeCount: matchedRole?.supremeCount || 0,
          nonTier1Count: matchedRole?.nonTier1Count || 0,
          landingPageClicks: selectedRoleData.metrics.landingPageClicks,
          interviewMinutes: selectedRoleData.interviewMinutes,
        };

        const message = generateRound1Message(messageType, selectedCompany, selectedRole, metrics);
        setGeneratedMessage({ message, metrics });
      }
    } catch (err) {
      console.error('Error generating message:', err);
      setError('Failed to generate message');
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generate when role is selected or message type changes
  useEffect(() => {
    if (messageType === 'company' && selectedCompany) {
      handleGenerateMessage();
    } else if (messageType === 'role' && selectedRole && selectedRoleData) {
      handleGenerateMessage();
    }
  }, [selectedRole, messageType, startDate, endDate]);

  // Generate message following Round1AI format (WhatsApp markdown)
  // WhatsApp formatting: *bold*, _italic_, ~strikethrough~
  const generateRound1Message = (
    type: MessageType,
    company: string,
    role: string,
    metrics: GeneratedMessage['metrics'],
    companyData?: CompanyData
  ): string => {
    const days = daysSinceLive;
    // Auto-randomize candidate companies each time
    const candidateCompanies = getRandomCompanies().split(',').map(c => c.trim());

    // Format reach number (e.g., 27900 -> "27.9k")
    const formatReach = (value: number): string => {
      if (value >= 1000) {
        return (value / 1000).toFixed(1) + 'k';
      }
      return value.toString();
    };

    if (type === 'company' && companyData) {
      // TYPE 1: Company-level update
      const totalInterest = companyData.roles.reduce((sum, r) => sum + r.metrics.landingPageClicks, 0);

      const lines: string[] = [];
      lines.push('*Updates from Round1AI Team*');
      lines.push(`*${company}* (${days} day${days > 1 ? 's' : ''} update)`);
      lines.push('');
      lines.push(`*${companyData.totalInterviewMinutes} Minutes* of AI Interview were conducted`);
      lines.push(`*${companyData.totalResumes}+* resumes received`);
      lines.push(`*${totalInterest}+* people showed interest`);
      lines.push(`*${formatReach(companyData.totalImpressions)}* reach across our candidate network`);
      lines.push('');

      // Role-wise breakdown
      lines.push('*Role-wise breakdown:*');
      companyData.roles.forEach(r => {
        lines.push(`• ${r.role}: ${r.matchedResumes} resumes, ${r.interviewMinutes} min AI interviews`);
      });
      lines.push('');

      if (candidateCompanies.length > 0) {
        lines.push(`Candidates showing interest from: *${candidateCompanies.join(', ')}*`);
        lines.push('');
      }
      lines.push('Our AI Agents are evaluating candidates. We are sharing shortlist soon.');

      return lines.join('\n');
    } else {
      // TYPE 2: Role-level update
      const lines: string[] = [];
      lines.push('*Updates from Round1AI Team*');
      lines.push(`*${role}*, ${company} (${days} day${days > 1 ? 's' : ''} update)`);
      lines.push('');
      lines.push(`*${metrics.interviewMinutes} Minutes* of AI Interview were conducted`);
      lines.push(`*${metrics.totalResumes}+* resumes received`);
      lines.push(`*${metrics.landingPageClicks}+* people showed interest`);
      lines.push(`*${formatReach(metrics.impressions)}* reach across our candidate network`);
      lines.push('');
      if (candidateCompanies.length > 0) {
        lines.push(`Candidates showing interest from: *${candidateCompanies.join(', ')}*`);
        lines.push('');
      }
      lines.push('Our AI Agents are evaluating candidates. We are sharing shortlist soon.');

      return lines.join('\n');
    }
  };

  // Copy message to clipboard
  const handleCopy = () => {
    if (generatedMessage) {
      navigator.clipboard.writeText(generatedMessage.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Handle company change
  const handleCompanyChange = (company: string) => {
    setSelectedCompany(company);
    setSelectedRole('');
    setGeneratedMessage(null);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Message Generator</h2>
        <p className="text-gray-600">
          Select a company and role to generate client update messages with campaign metrics.
        </p>
      </div>

      {/* Date Range Selection */}
      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">From:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">To:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const end = new Date();
              const start = new Date();
              start.setDate(start.getDate() - 2);
              setStartDate(start.toISOString().split('T')[0]);
              setEndDate(end.toISOString().split('T')[0]);
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
          >
            Last 3 days
          </button>
          <button
            onClick={() => {
              const end = new Date();
              const start = new Date();
              start.setDate(start.getDate() - 6);
              setStartDate(start.toISOString().split('T')[0]);
              setEndDate(end.toISOString().split('T')[0]);
            }}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
          >
            Last 7 days
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading live campaigns...</p>
        </div>
      )}

      {/* Error Message */}
      {error && !isLoading && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          {error}
        </div>
      )}

      {/* Selection Dropdowns */}
      {!isLoading && companies.length > 0 && (
        <div className="mb-8 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          {/* Message Type Toggle */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Message Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMessageType('role')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  messageType === 'role'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Role-level Update
              </button>
              <button
                onClick={() => setMessageType('company')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  messageType === 'company'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Company-level Update
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Company Dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Company
              </label>
              <select
                value={selectedCompany}
                onChange={(e) => handleCompanyChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                <option value="">Choose a company...</option>
                {companies.map((company) => (
                  <option key={company.company} value={company.company}>
                    {company.company} ({company.roles.length} roles, {formatNumber(company.totalImpressions)} reach)
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-gray-500">
                {companies.length} live companies
              </p>
            </div>

            {/* Role Dropdown - only for role-level */}
            {messageType === 'role' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  disabled={!selectedCompany}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {selectedCompany ? 'Choose a role...' : 'Select a company first'}
                  </option>
                  {availableRoles.map((role) => (
                    <option key={role.batchId} value={role.role}>
                      {role.role} ({role.matchedResumes} resumes, {role.interviewMinutes} min)
                    </option>
                  ))}
                </select>
                {selectedCompany && (
                  <p className="mt-2 text-xs text-gray-500">
                    {availableRoles.length} role{availableRoles.length !== 1 ? 's' : ''} available
                  </p>
                )}
              </div>
            )}

          </div>

          {/* Selected Preview */}
          {(messageType === 'company' && selectedCompany) || (messageType === 'role' && selectedRoleData) ? (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h4 className="font-semibold text-gray-900">
                    {messageType === 'company'
                      ? `${selectedCompany} (${availableRoles.length} roles)`
                      : `${selectedCompany} - ${selectedRole}`}
                  </h4>
                  <p className="text-sm text-gray-500">Campaign metrics for selected period</p>
                </div>
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  {messageType === 'company' && selectedCompanyData && (
                    <>
                      <span className="px-3 py-1 bg-teal-50 text-teal-700 rounded-full">
                        {selectedCompanyData.totalInterviewMinutes} min AI interviews
                      </span>
                      <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full">
                        {selectedCompanyData.totalResumes} resumes
                      </span>
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full">
                        {formatNumber(selectedCompanyData.totalImpressions)} reach
                      </span>
                    </>
                  )}
                  {messageType === 'role' && selectedRoleData && (
                    <>
                      <span className="px-3 py-1 bg-teal-50 text-teal-700 rounded-full">
                        {selectedRoleData.interviewMinutes} min AI interviews
                      </span>
                      <span className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full">
                        {selectedRoleData.matchedResumes} resumes
                      </span>
                      <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full">
                        {selectedRoleData.metrics.landingPageClicks} page visits
                      </span>
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full">
                        {formatNumber(selectedRoleData.metrics.impressions)} reach
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* Generate Button */}
          {selectedCompany && (messageType === 'company' || selectedRole) && (
            <div className="mt-6">
              <button
                onClick={handleGenerateMessage}
                disabled={isGenerating}
                className="w-full px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isGenerating ? 'Generating...' : 'Generate Message'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Generating State */}
      {isGenerating && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-blue-800">Generating message with Gemini...</span>
        </div>
      )}

      {/* Generated Message */}
      {generatedMessage && !isGenerating && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-full">
                  <svg
                    className="w-5 h-5 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Generated Message</h3>
                  <p className="text-sm text-gray-500">
                    {selectedCompany} - {selectedRole}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                      />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Metrics Summary */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-6 text-sm flex-wrap">
              <div>
                <span className="text-gray-500">AI Interviews:</span>{' '}
                <span className="font-semibold text-teal-700">
                  {generatedMessage.metrics.interviewMinutes} min
                </span>
              </div>
              <div>
                <span className="text-gray-500">Resumes:</span>{' '}
                <span className="font-semibold text-gray-900">
                  {generatedMessage.metrics.totalResumes}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Page Visits:</span>{' '}
                <span className="font-semibold text-gray-900">
                  {generatedMessage.metrics.landingPageClicks}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Reach:</span>{' '}
                <span className="font-semibold text-gray-900">
                  {formatNumber(generatedMessage.metrics.impressions)}
                </span>
              </div>
            </div>
          </div>

          {/* Message Content */}
          <div className="p-5">
            <pre className="whitespace-pre-wrap font-sans text-gray-800 leading-relaxed">
              {generatedMessage.message}
            </pre>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && companies.length === 0 && !error && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No campaigns found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Try adjusting the date range to find active campaigns.
          </p>
        </div>
      )}
    </div>
  );
}
