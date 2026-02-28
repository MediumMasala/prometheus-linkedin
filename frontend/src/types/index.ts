export interface Campaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  startDate: string;
  endDate: string;
}

export interface ConversionData {
  signups: number;
  logins: number;
  resumeSubmissions: number;
  interviewsStarted: number;
}

export interface RolePerformance {
  roleId: string;
  roleName: string;
  campaigns: Campaign[];
  conversions: ConversionData;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  avgCtr: number;
  costPerSignup: number;
  costPerResume: number;
  costPerInterview: number;
  clickToSignupRate: number;
  signupToInterviewRate: number;
  fullFunnelConversion: number;
}

export interface FunnelStep {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

// Backend API types
export interface JobApplication {
  job_title: string;
  company_name: string;
  count: number;
}

export interface JobApplicationResponse {
  data: JobApplication[];
}
