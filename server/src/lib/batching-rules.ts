import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_FILE = path.join(__dirname, '..', '..', 'batching-rules.json');

// Batching rule structure
interface BatchingRule {
  campaignPattern: string;  // Regex or exact match
  company: string;
  role: string;
  batchId: string;
}

// Mapping with approval status
export interface MappingInfo {
  company: string;
  role: string;
  batchId: string;
  approved?: boolean;           // true = locked forever, never change
  approvedAt?: string;          // ISO timestamp when approved
  rejected?: boolean;           // true = user rejected this mapping
  rejectionReason?: string;     // why it was rejected
  rejectedAt?: string;          // ISO timestamp when rejected
  source?: 'ai' | 'manual';     // how this mapping was created
  createdAt?: string;           // when first created
}

interface BatchingRules {
  version: number;
  lastUpdated: string;
  rules: BatchingRule[];
  // Manual overrides: campaign name -> batch info
  manualMappings: Record<string, MappingInfo>;
}

// Default rules based on known patterns
const DEFAULT_RULES: BatchingRules = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  rules: [],
  manualMappings: {
    // AFB campaigns
    "AFB - Performace Marketing": { company: "AFB", role: "Performance Marketing", batchId: "afb-performance-marketing" },
    "AFB - Performace Marketing - Agency TG": { company: "AFB", role: "Performance Marketing", batchId: "afb-performance-marketing" },

    // Shaadi campaigns
    "Shaadi - Stealth- Head of DS - Company": { company: "Shaadi", role: "Head of DS", batchId: "shaadi-head-of-ds" },
    "Shaadi - Stealth- Head of DS - Pedigree JT": { company: "Shaadi", role: "Head of DS", batchId: "shaadi-head-of-ds" },
    "Shaadi - Stealth - Head of DS": { company: "Shaadi", role: "Head of DS", batchId: "shaadi-head-of-ds" },
  },
};

// Load rules from file
export function loadBatchingRules(): BatchingRules {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const data = fs.readFileSync(RULES_FILE, 'utf-8');
      const rules = JSON.parse(data) as BatchingRules;
      console.log(`[BatchingRules] Loaded ${Object.keys(rules.manualMappings).length} manual mappings`);
      return rules;
    }
  } catch (e) {
    console.log('[BatchingRules] Error loading rules file, using defaults');
  }

  // Save default rules
  saveBatchingRules(DEFAULT_RULES);
  return DEFAULT_RULES;
}

// Save rules to file
export function saveBatchingRules(rules: BatchingRules): void {
  rules.lastUpdated = new Date().toISOString();
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  console.log(`[BatchingRules] Saved ${Object.keys(rules.manualMappings).length} manual mappings`);
}

// Get batch info for a campaign (returns null if not found)
export function getBatchForCampaign(campaignName: string): { company: string; role: string; batchId: string } | null {
  const rules = loadBatchingRules();

  // Check exact match first (case-sensitive)
  if (rules.manualMappings[campaignName]) {
    return rules.manualMappings[campaignName];
  }

  // Check case-insensitive match
  const campaignLower = campaignName.toLowerCase().trim();
  for (const [name, mapping] of Object.entries(rules.manualMappings)) {
    if (name.toLowerCase().trim() === campaignLower) {
      return mapping;
    }
  }

  // Special handling for Zoop Founder's Office variations
  if (campaignLower.includes('zoop') && (campaignLower.includes('founder') || campaignLower.includes('fo '))) {
    return {
      company: 'Zoop',
      role: "Zoop Founder's Office",
      batchId: 'zoop-zoop-founders-office'
    };
  }

  // Check pattern rules
  for (const rule of rules.rules) {
    const regex = new RegExp(rule.campaignPattern, 'i');
    if (regex.test(campaignName)) {
      return { company: rule.company, role: rule.role, batchId: rule.batchId };
    }
  }

  return null;
}

// Add a manual mapping
export function addManualMapping(
  campaignName: string,
  company: string,
  role: string,
  batchId?: string
): void {
  const rules = loadBatchingRules();
  const id = batchId || `${company.toLowerCase().replace(/\s+/g, '-')}-${role.toLowerCase().replace(/\s+/g, '-')}`;

  rules.manualMappings[campaignName] = { company, role, batchId: id };
  saveBatchingRules(rules);
}

// Add multiple mappings at once (from AI results)
export function saveAIBatchingResults(
  results: Array<{ campaignName: string; company: string; role: string; batchId: string }>
): void {
  const rules = loadBatchingRules();

  for (const result of results) {
    const existing = rules.manualMappings[result.campaignName];

    // NEVER overwrite approved mappings
    if (existing?.approved) {
      console.log(`[BatchingRules] Skipping ${result.campaignName} - already approved`);
      continue;
    }

    // Skip if mapping exists and is not rejected (let it be)
    if (existing && !existing.rejected) {
      continue;
    }

    // Save new mapping or replace rejected one
    rules.manualMappings[result.campaignName] = {
      company: result.company,
      role: result.role,
      batchId: result.batchId,
      source: 'ai',
      createdAt: new Date().toISOString(),
    };
  }

  saveBatchingRules(rules);
}

// Approve a mapping - locks it forever
export function approveMapping(campaignName: string): boolean {
  const rules = loadBatchingRules();
  const mapping = rules.manualMappings[campaignName];

  if (!mapping) {
    console.log(`[BatchingRules] Cannot approve - mapping not found: ${campaignName}`);
    return false;
  }

  mapping.approved = true;
  mapping.approvedAt = new Date().toISOString();
  mapping.rejected = false;
  mapping.rejectionReason = undefined;
  mapping.rejectedAt = undefined;

  saveBatchingRules(rules);
  console.log(`[BatchingRules] ✅ Approved: ${campaignName} → ${mapping.company} | ${mapping.role}`);
  return true;
}

// Reject a mapping - marks it for re-evaluation
export function rejectMapping(campaignName: string, reason: string): boolean {
  const rules = loadBatchingRules();
  const mapping = rules.manualMappings[campaignName];

  if (!mapping) {
    console.log(`[BatchingRules] Cannot reject - mapping not found: ${campaignName}`);
    return false;
  }

  // Cannot reject an approved mapping
  if (mapping.approved) {
    console.log(`[BatchingRules] Cannot reject approved mapping: ${campaignName}`);
    return false;
  }

  mapping.rejected = true;
  mapping.rejectionReason = reason;
  mapping.rejectedAt = new Date().toISOString();

  saveBatchingRules(rules);
  console.log(`[BatchingRules] ❌ Rejected: ${campaignName} - Reason: ${reason}`);
  return true;
}

// Update a rejected mapping with correct values
export function updateMapping(
  campaignName: string,
  company: string,
  role: string,
  batchId?: string
): boolean {
  const rules = loadBatchingRules();
  const existing = rules.manualMappings[campaignName];

  // Cannot update approved mappings
  if (existing?.approved) {
    console.log(`[BatchingRules] Cannot update approved mapping: ${campaignName}`);
    return false;
  }

  const id = batchId || `${company.toLowerCase().replace(/\s+/g, '-')}-${role.toLowerCase().replace(/\s+/g, '-')}`;

  rules.manualMappings[campaignName] = {
    company,
    role,
    batchId: id,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };

  saveBatchingRules(rules);
  console.log(`[BatchingRules] Updated: ${campaignName} → ${company} | ${role}`);
  return true;
}

// Get all mappings that need approval (not yet approved or rejected)
export function getPendingMappings(): Array<{ campaignName: string; mapping: MappingInfo }> {
  const rules = loadBatchingRules();

  return Object.entries(rules.manualMappings)
    .filter(([_, mapping]) => !mapping.approved && !mapping.rejected)
    .map(([campaignName, mapping]) => ({ campaignName, mapping }));
}

// Get all approved mappings
export function getApprovedMappings(): Array<{ campaignName: string; mapping: MappingInfo }> {
  const rules = loadBatchingRules();

  return Object.entries(rules.manualMappings)
    .filter(([_, mapping]) => mapping.approved)
    .map(([campaignName, mapping]) => ({ campaignName, mapping }));
}

// Get all rejected mappings (need AI re-evaluation)
export function getRejectedMappings(): Array<{ campaignName: string; mapping: MappingInfo }> {
  const rules = loadBatchingRules();

  return Object.entries(rules.manualMappings)
    .filter(([_, mapping]) => mapping.rejected)
    .map(([campaignName, mapping]) => ({ campaignName, mapping }));
}

// Batch approve multiple mappings by batchId
export function approveBatch(batchId: string): number {
  const rules = loadBatchingRules();
  let count = 0;

  for (const [campaignName, mapping] of Object.entries(rules.manualMappings)) {
    if (mapping.batchId === batchId && !mapping.approved) {
      mapping.approved = true;
      mapping.approvedAt = new Date().toISOString();
      mapping.rejected = false;
      mapping.rejectionReason = undefined;
      count++;
    }
  }

  if (count > 0) {
    saveBatchingRules(rules);
    console.log(`[BatchingRules] ✅ Batch approved ${count} campaigns for batchId: ${batchId}`);
  }

  return count;
}

// Get all campaigns that need AI batching (not in rules)
export function getCampaignsNeedingAI(campaignNames: string[]): string[] {
  const rules = loadBatchingRules();

  return campaignNames.filter(name => {
    // Check if already in manual mappings
    if (rules.manualMappings[name]) return false;

    // Check pattern rules
    for (const rule of rules.rules) {
      const regex = new RegExp(rule.campaignPattern, 'i');
      if (regex.test(name)) return false;
    }

    return true;
  });
}

// Clear all rules (reset)
export function clearBatchingRules(): void {
  saveBatchingRules({
    version: 1,
    lastUpdated: new Date().toISOString(),
    rules: [],
    manualMappings: {},
  });
}

// Clear AI-generated non-approved mappings (to re-process with better prompts)
export function clearAIGeneratedMappings(): number {
  const rules = loadBatchingRules();
  let cleared = 0;

  const toRemove: string[] = [];
  for (const [campaignName, mapping] of Object.entries(rules.manualMappings)) {
    // Keep approved mappings
    if (mapping.approved) continue;

    // Remove AI-generated or untagged mappings that aren't approved
    toRemove.push(campaignName);
    cleared++;
  }

  for (const name of toRemove) {
    delete rules.manualMappings[name];
  }

  if (cleared > 0) {
    saveBatchingRules(rules);
    console.log(`[BatchingRules] Cleared ${cleared} AI-generated non-approved mappings`);
  }

  return cleared;
}

// Export rules for API
export function exportRules(): BatchingRules {
  return loadBatchingRules();
}
