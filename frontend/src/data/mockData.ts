import type { RolePerformance, Campaign, ConversionData } from '../types';

const sde2Campaigns: Campaign[] = [
  {
    id: 'camp_001',
    name: 'SDE2-Backend_Creative-A_Jan25',
    status: 'ACTIVE',
    spend: 18500,
    impressions: 22000,
    clicks: 520,
    ctr: 2.36,
    cpc: 35.58,
    cpm: 840.91,
    startDate: '2025-01-15',
    endDate: '2025-02-15',
  },
  {
    id: 'camp_002',
    name: 'SDE2-Backend_Creative-B_Jan25',
    status: 'ACTIVE',
    spend: 15200,
    impressions: 18000,
    clicks: 410,
    ctr: 2.28,
    cpc: 37.07,
    cpm: 844.44,
    startDate: '2025-01-15',
    endDate: '2025-02-15',
  },
  {
    id: 'camp_003',
    name: 'SDE2-Backend_Video-Ad_Feb25',
    status: 'ACTIVE',
    spend: 11300,
    impressions: 12000,
    clicks: 270,
    ctr: 2.25,
    cpc: 41.85,
    cpm: 941.67,
    startDate: '2025-02-01',
    endDate: '2025-02-28',
  },
];

const sde2Conversions: ConversionData = {
  signups: 340,
  logins: 312,
  resumeSubmissions: 180,
  interviewsStarted: 95,
};

const pmCampaigns: Campaign[] = [
  {
    id: 'camp_004',
    name: 'PM-Growth_Carousel_Jan25',
    status: 'ACTIVE',
    spend: 16500,
    impressions: 15000,
    clicks: 520,
    ctr: 3.47,
    cpc: 31.73,
    cpm: 1100.0,
    startDate: '2025-01-10',
    endDate: '2025-02-10',
  },
  {
    id: 'camp_005',
    name: 'PM-Growth_SingleImage_Feb25',
    status: 'PAUSED',
    spend: 11500,
    impressions: 11000,
    clicks: 370,
    ctr: 3.36,
    cpc: 31.08,
    cpm: 1045.45,
    startDate: '2025-02-01',
    endDate: '2025-02-28',
  },
];

const pmConversions: ConversionData = {
  signups: 210,
  logins: 195,
  resumeSubmissions: 120,
  interviewsStarted: 62,
};

const designerCampaigns: Campaign[] = [
  {
    id: 'camp_006',
    name: 'Designer-UI_Portfolio_Jan25',
    status: 'ACTIVE',
    spend: 12000,
    impressions: 14000,
    clicks: 380,
    ctr: 2.71,
    cpc: 31.58,
    cpm: 857.14,
    startDate: '2025-01-20',
    endDate: '2025-02-20',
  },
];

const designerConversions: ConversionData = {
  signups: 125,
  logins: 118,
  resumeSubmissions: 72,
  interviewsStarted: 38,
};

const dataAnalystCampaigns: Campaign[] = [
  {
    id: 'camp_007',
    name: 'DataAnalyst_SQL-Focus_Feb25',
    status: 'ACTIVE',
    spend: 8500,
    impressions: 9500,
    clicks: 245,
    ctr: 2.58,
    cpc: 34.69,
    cpm: 894.74,
    startDate: '2025-02-05',
    endDate: '2025-03-05',
  },
  {
    id: 'camp_008',
    name: 'DataAnalyst_Python-Focus_Feb25',
    status: 'ACTIVE',
    spend: 7200,
    impressions: 8200,
    clicks: 198,
    ctr: 2.41,
    cpc: 36.36,
    cpm: 878.05,
    startDate: '2025-02-05',
    endDate: '2025-03-05',
  },
];

const dataAnalystConversions: ConversionData = {
  signups: 98,
  logins: 91,
  resumeSubmissions: 55,
  interviewsStarted: 28,
};

function calculateRolePerformance(
  roleId: string,
  roleName: string,
  campaigns: Campaign[],
  conversions: ConversionData
): RolePerformance {
  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  return {
    roleId,
    roleName,
    campaigns,
    conversions,
    totalSpend,
    totalImpressions,
    totalClicks,
    avgCtr,
    costPerSignup: conversions.signups > 0 ? totalSpend / conversions.signups : 0,
    costPerResume: conversions.resumeSubmissions > 0 ? totalSpend / conversions.resumeSubmissions : 0,
    costPerInterview: conversions.interviewsStarted > 0 ? totalSpend / conversions.interviewsStarted : 0,
    clickToSignupRate: totalClicks > 0 ? (conversions.signups / totalClicks) * 100 : 0,
    signupToInterviewRate: conversions.signups > 0 ? (conversions.interviewsStarted / conversions.signups) * 100 : 0,
    fullFunnelConversion: totalClicks > 0 ? (conversions.interviewsStarted / totalClicks) * 100 : 0,
  };
}

export const mockRolePerformance: RolePerformance[] = [
  calculateRolePerformance('role_001', 'SDE-2 Backend', sde2Campaigns, sde2Conversions),
  calculateRolePerformance('role_002', 'PM - Growth', pmCampaigns, pmConversions),
  calculateRolePerformance('role_003', 'UI/UX Designer', designerCampaigns, designerConversions),
  calculateRolePerformance('role_004', 'Data Analyst', dataAnalystCampaigns, dataAnalystConversions),
];

export const totalMetrics = {
  totalSpend: mockRolePerformance.reduce((sum, r) => sum + r.totalSpend, 0),
  totalClicks: mockRolePerformance.reduce((sum, r) => sum + r.totalClicks, 0),
  totalSignups: mockRolePerformance.reduce((sum, r) => sum + r.conversions.signups, 0),
  totalInterviews: mockRolePerformance.reduce((sum, r) => sum + r.conversions.interviewsStarted, 0),
  activeCampaigns: mockRolePerformance.flatMap((r) => r.campaigns).filter((c) => c.status === 'ACTIVE').length,
  totalCampaigns: mockRolePerformance.flatMap((r) => r.campaigns).length,
};
