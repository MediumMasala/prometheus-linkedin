# Prometheus — Claude Code Prompt

## Context & Problem Statement

You are building **Prometheus**, a LinkedIn Ads campaign analysis and reporting system for a hiring platform called **NextBoss**. NextBoss connects companies directly with candidates, bypassing recruitment agencies. LinkedIn is the primary user acquisition channel.

### How the funnel works:

1. **LinkedIn Ads** → Users click on ads and land on NextBoss
2. **NextBoss Platform** → Users sign up, log in, submit resumes, and start interviews
3. Each "interview" is called a **Round**
4. Each **Role** (job opening) can have **multiple LinkedIn campaigns** pointing to it
5. The goal is to unify LinkedIn ad spend data with backend conversion data to get a full-funnel view per Role/Round

### Data Sources:

**Source 1: LinkedIn Ads API** (access token will be provided)
- Campaign-level data: spends, impressions, clicks, CTR, CPC, CPM
- Campaign metadata: campaign name, campaign ID, status, objective, date range
- Account-level data: ad account ID, currency (INR)

**Source 2: NextBoss Backend Database** (connection details will be provided)
- Users who signed up / logged in
- Users who submitted resumes
- Users who started an interview (Round)
- Each event should be attributable to a campaign via UTM params or referral tracking

---

## What to Build

### Architecture: Mastra-based Tool System

Use **Mastra** (https://mastra.ai) as the orchestration framework. Build individual tools that Claude can call, and a workflow that chains them together.

### Tool 1: `linkedin-campaign-fetcher`
- Authenticates with LinkedIn Marketing API using the provided OAuth access token
- Fetches all campaigns under the ad account
- For each campaign, pulls: campaign ID, campaign name, status, daily/total spend, impressions, clicks, CTR, CPC, CPM, date range
- LinkedIn Marketing API endpoints to use:
  - `GET /adAccounts/{id}/adCampaigns` — list campaigns
  - `GET /adAnalytics` — pull performance metrics (use `pivot=CAMPAIGN`, `timeGranularity=DAILY` or `ALL`)
- Returns structured JSON of all campaign data
- Handle pagination and rate limits

### Tool 2: `campaign-role-mapper`
- Takes the list of campaigns from Tool 1
- Maps multiple campaigns → single Role/Round (job opening)
- Mapping logic options (implement all, fallback in order):
  1. **UTM-based**: Parse campaign names or UTM parameters for role identifiers (e.g., campaign name contains "sde-2-backend" or a role ID)
  2. **Manual mapping config**: Read from a `campaign-role-map.json` config file where user manually maps campaign IDs to role/round IDs
  3. **AI-assisted**: If campaign names follow a pattern, use Claude to infer groupings
- Output: A grouped structure like `{ roleId: string, roleName: string, campaigns: CampaignData[] }`

### Tool 3: `backend-data-fetcher`
- Connects to NextBoss backend (Postgres/MongoDB — ask for connection details)
- For a given role/round, fetches:
  - Total signups attributed to LinkedIn (via UTM or referral)
  - Total logins
  - Total resume submissions
  - Total interviews started
  - Conversion timestamps for funnel analysis
- Groups data by the same role/round identifiers used in Tool 2

### Tool 4: `funnel-analyzer`
- Merges LinkedIn campaign data (Tool 1+2) with backend conversion data (Tool 3)
- For each Role/Round, calculates:
  - **Total Spend** (sum of all campaigns mapped to this role)
  - **Total Impressions, Clicks, CTR** (aggregated)
  - **Signups, Resume Submissions, Interviews Started** (from backend)
  - **Cost per Signup** = Total Spend / Signups
  - **Cost per Resume Submitted** = Total Spend / Resumes
  - **Cost per Interview Started** = Total Spend / Interviews
  - **Click-to-Signup Rate** = Signups / Clicks
  - **Signup-to-Interview Rate** = Interviews / Signups
  - **Full Funnel Conversion** = Interviews / Clicks
- Flags underperforming campaigns (high spend, low conversion)

### Tool 5: `report-generator`
- Takes the analyzed data from Tool 4
- Generates a **summary table** (terminal-friendly + exportable):

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        PROMETHEUS — Role Performance Report                         │
├──────────────┬──────────┬────────┬────────┬─────────┬──────────┬───────────┬────────┤
│ Role/Round   │ Campaigns│ Spend  │ Clicks │ Signups │ Resumes  │ Interviews│ CPI    │
│              │ Count    │ (INR)  │        │         │ Submitted│ Started   │ (INR)  │
├──────────────┼──────────┼────────┼────────┼─────────┼──────────┼───────────┼────────┤
│ SDE-2 Backend│ 3        │ ₹45,000│ 1,200  │ 340     │ 180      │ 95        │ ₹473   │
│ PM - Growth  │ 2        │ ₹28,000│ 890    │ 210     │ 120      │ 62        │ ₹451   │
└──────────────┴──────────┴────────┴────────┴─────────┴──────────┴───────────┴────────┘

CPI = Cost per Interview Started
```

- Also generates a **funnel diagram** per role:

```
Role: SDE-2 Backend (3 campaigns, ₹45,000 spent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Impressions   ████████████████████████████  52,000
Clicks        ██████████░░░░░░░░░░░░░░░░░░   1,200  (2.3% CTR)
Signups       █████░░░░░░░░░░░░░░░░░░░░░░░     340  (28.3% of clicks)
Resumes       ███░░░░░░░░░░░░░░░░░░░░░░░░░     180  (52.9% of signups)
Interviews    ██░░░░░░░░░░░░░░░░░░░░░░░░░░      95  (52.8% of resumes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cost/Click: ₹37.50 → Cost/Signup: ₹132 → Cost/Interview: ₹473
```

- Optionally exports to CSV or renders as HTML dashboard

---

## Mastra Workflow Definition

```
Workflow: prometheus-analysis
  Step 1: linkedin-campaign-fetcher → raw campaign data
  Step 2: campaign-role-mapper → grouped campaigns by role
  Step 3: backend-data-fetcher → conversion data per role
  Step 4: funnel-analyzer → merged + calculated metrics
  Step 5: report-generator → table + funnel diagram output
```

---

## Project Structure

```
prometheus/
├── src/
│   ├── mastra/
│   │   ├── index.ts              # Mastra instance config
│   │   ├── tools/
│   │   │   ├── linkedin-fetcher.ts
│   │   │   ├── campaign-mapper.ts
│   │   │   ├── backend-fetcher.ts
│   │   │   ├── funnel-analyzer.ts
│   │   │   └── report-generator.ts
│   │   └── workflows/
│   │       └── prometheus-workflow.ts
│   ├── config/
│   │   ├── campaign-role-map.json    # Manual campaign→role mapping
│   │   └── env.ts                    # Environment variables
│   └── types/
│       └── index.ts                  # Shared TypeScript types
├── .env                              # LinkedIn token, DB credentials
├── package.json
└── tsconfig.json
```

---

## Environment Variables Needed

```env
# LinkedIn Marketing API
LINKEDIN_ACCESS_TOKEN=xxx
LINKEDIN_AD_ACCOUNT_ID=xxx

# NextBoss Backend Database
DATABASE_URL=postgresql://user:pass@host:5432/nextboss
# or MONGODB_URI=mongodb+srv://...

# Optional
ANTHROPIC_API_KEY=xxx   # For AI-assisted campaign grouping
```

---

## Key Implementation Notes

1. **LinkedIn API Versioning**: Use LinkedIn Marketing API v2. Set header `LinkedIn-Version: 202401` and `Authorization: Bearer {token}`. The analytics endpoint uses URN format for campaign references.

2. **Campaign-to-Role Mapping**: Start with the manual JSON config approach. The campaign naming convention on LinkedIn should follow a pattern like `{RoleName}_{CampaignVariant}_{Date}` (e.g., `SDE2-Backend_Creative-A_Jan25`). Parse this to auto-group.

3. **Attribution**: NextBoss landing pages should have UTM parameters: `?utm_source=linkedin&utm_medium=paid&utm_campaign={campaignId}&utm_content={roleId}`. The backend fetcher should query by these UTMs.

4. **Currency**: All monetary values in INR (₹). Format with Indian numbering system where relevant (lakhs/crores for large numbers).

5. **Incremental Updates**: Cache the last fetch timestamp. On subsequent runs, only pull delta data from LinkedIn API to avoid rate limits.

6. **Error Handling**: LinkedIn tokens expire. Build a token refresh mechanism or at minimum surface clear errors when the token is expired.

---

## First Run Instructions

When I provide:
- LinkedIn Ads access token + ad account ID
- Database connection string
- Campaign naming convention or manual mapping file

Then:
1. Set up the Mastra project with all 5 tools
2. Test Tool 1 (LinkedIn fetch) independently first
3. Build the campaign-role mapping logic based on actual campaign names
4. Connect to the backend and validate conversion data exists
5. Run the full workflow and generate the first Prometheus report
6. Iterate on the report format based on my feedback

---

## Future Enhancements (v2)

- Slack/Discord notifications for daily reports
- Time-series analysis (spend & conversion trends over days/weeks)
- Campaign recommendation engine (pause underperformers, scale winners)
- A/B test analysis across creatives within the same role
- Web dashboard (React) instead of terminal output
- Automated budget reallocation suggestions
