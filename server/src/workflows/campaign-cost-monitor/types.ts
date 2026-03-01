// Campaign Cost Monitor - Type Definitions

export interface CampaignDailySnapshot {
  campaignId: string;
  campaignName: string;
  company: string;
  role: string;
  spendToday: number;       // in INR
  resumesToday: number;
  costPerResume: number;    // spendToday / resumesToday (Infinity if zero resumes)
  timestamp: string;        // ISO timestamp
  hourOfDay: number;        // 0-23
  dayOfWeek: number;        // 0 = Sunday, 6 = Saturday
  isWeekend: boolean;
}

export interface BreachedCampaign extends CampaignDailySnapshot {
  breachType: 'high_cpr' | 'zero_resumes' | 'critical_cpr';
  breachAmount: number;     // How much over threshold
}

export interface AnalysisResult {
  severity: 'warning' | 'critical';
  campaignId: string;
  campaignName: string;
  company: string;
  role: string;
  message: string;          // AI-generated Slack message
  assessment: string;       // AI-generated insight
  suggestedAction: string;  // AI-generated recommendation
  metrics: {
    spendToday: number;
    resumesToday: number;
    costPerResume: number;
  };
  breachType: 'high_cpr' | 'zero_resumes' | 'critical_cpr';
}

export interface AlertRecord {
  campaignId: string;
  severity: 'warning' | 'critical';
  timestamp: number;        // Unix timestamp
  date: string;             // YYYY-MM-DD for daily reset
}

export interface WorkflowContext {
  campaigns: CampaignDailySnapshot[];
  breachedCampaigns: BreachedCampaign[];
  analysisResults: AnalysisResult[];
  alertsSent: number;
  alertsSkipped: number;
}
