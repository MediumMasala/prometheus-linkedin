import { Mastra } from '@mastra/core';
import { prometheusAgent } from './agents/prometheus.js';
import { fetchLinkedInCampaignsTool } from './tools/fetchLinkedInCampaigns.js';
import { batchCampaignsTool } from './tools/batchCampaigns.js';
import { fetchInternalDataTool } from './tools/fetchInternalData.js';
import { mapAndReconcileTool } from './tools/mapAndReconcile.js';

// Video pipeline tools - will be added in separate deployment
// import { ... } from './tools/video-pipeline/index.js';

// Export Prometheus tools for direct use
export { fetchLinkedInCampaignsTool };
export { batchCampaignsTool };
export { fetchInternalDataTool };
export { mapAndReconcileTool };

// Export the agent
export { prometheusAgent } from './agents/prometheus.js';

// Create and export Mastra instance
export const mastra = new Mastra({
  agents: { prometheusAgent },
});

// Helper function to run the full analysis pipeline
export async function runPrometheusAnalysis(config: {
  linkedInAccountId: string;
  linkedInAccessToken: string;
  dateRange?: { start: string; end: string };
}) {
  const { linkedInAccountId, linkedInAccessToken, dateRange } = config;

  console.log('[Prometheus] Starting analysis pipeline...');

  // Step 1 & 3: Fetch LinkedIn campaigns AND internal data in PARALLEL
  console.log('[Prometheus] Step 1 & 3: Fetching LinkedIn campaigns and internal data in parallel...');

  const [linkedInResult, internalResult] = await Promise.all([
    fetchLinkedInCampaignsTool.execute!({
      context: {
        accountId: linkedInAccountId,
        accessToken: linkedInAccessToken,
        dateRange,
        statuses: ['ACTIVE', 'PAUSED'],
      },
    }),
    fetchInternalDataTool.execute!({
      context: {
        dateRange,
      },
    }),
  ]);

  if (!linkedInResult.campaigns || linkedInResult.campaigns.length === 0) {
    throw new Error('No LinkedIn campaigns found');
  }

  console.log(`[Prometheus] Found ${linkedInResult.campaigns.length} campaigns`);
  console.log(`[Prometheus] Found ${internalResult.roles.length} internal roles`);

  // Step 2: Batch campaigns using AI (with internal roles as context)
  console.log('[Prometheus] Step 2: Batching campaigns with AI (using internal roles as context)...');
  const batchResult = await batchCampaignsTool.execute!({
    context: {
      campaigns: linkedInResult.campaigns,
      internalRoles: internalResult.roles, // Pass internal roles for context
    },
  });

  console.log(`[Prometheus] Created ${batchResult.batches.length} batches`);
  const whatsappCampaigns = batchResult.whatsappCampaigns || [];
  if (whatsappCampaigns.length > 0) {
    console.log(`[Prometheus] Found ${whatsappCampaigns.length} WhatsApp campaigns (₹${batchResult.stats.whatsappSpend?.toFixed(0) || 0} spend)`);
  }

  // Step 4: Map and reconcile
  console.log('[Prometheus] Step 4: Mapping and reconciling...');
  const report = await mapAndReconcileTool.execute!({
    context: {
      batches: batchResult.batches,
      internalRoles: internalResult.roles,
      ungroupedCampaigns: batchResult.ungrouped,
      whatsappCampaigns, // WhatsApp acquisition campaigns
    },
  });

  console.log('[Prometheus] Analysis complete!');

  return {
    linkedIn: {
      campaigns: linkedInResult.campaigns,
      totalCampaigns: linkedInResult.totalCampaigns,
      totalSpend: linkedInResult.totalSpend,
      dateRange: linkedInResult.dateRange,
    },
    batches: {
      batches: batchResult.batches,
      ungrouped: batchResult.ungrouped,
      totalBatches: batchResult.totalBatches,
      whatsappCampaigns: batchResult.whatsappCampaigns || [],
      stats: {
        whatsappSpend: batchResult.stats?.whatsappSpend || 0,
      },
    },
    internal: {
      roles: internalResult.roles,
      totalRoles: internalResult.totalRoles,
      totalResumes: internalResult.totalResumes,
    },
    report,
  };
}
