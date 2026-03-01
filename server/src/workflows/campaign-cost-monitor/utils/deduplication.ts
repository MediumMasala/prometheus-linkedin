// Alert Deduplication Logic

import { ALERT_CONFIG, getTodayIST } from '../config.js';
import type { AlertRecord, AnalysisResult } from '../types.js';

// In-memory store for today's alerts (resets at midnight)
const alertStore: Map<string, AlertRecord> = new Map();
let lastResetDate: string = getTodayIST();

/**
 * Reset store if it's a new day
 */
function checkAndResetStore(): void {
  const today = getTodayIST();
  if (today !== lastResetDate) {
    console.log('[AlertDedup] New day detected, resetting alert store');
    alertStore.clear();
    lastResetDate = today;
  }
}

/**
 * Check if we should send an alert for this campaign
 * Returns true if alert should be sent, false if it should be skipped
 */
export function shouldSendAlert(result: AnalysisResult): boolean {
  checkAndResetStore();

  const key = result.campaignId;
  const existingAlert = alertStore.get(key);
  const now = Date.now();

  if (!existingAlert) {
    // First alert for this campaign today
    return true;
  }

  const hoursSinceLastAlert = (now - existingAlert.timestamp) / (1000 * 60 * 60);

  // Check for escalation (warning → critical)
  if (ALERT_CONFIG.allowEscalation &&
      existingAlert.severity === 'warning' &&
      result.severity === 'critical') {
    console.log(`[AlertDedup] Escalation: ${result.company} ${result.role} (warning → critical)`);
    return true;
  }

  // Check cooldown period
  const cooldownHours = result.severity === 'critical'
    ? ALERT_CONFIG.criticalCooldownHours
    : ALERT_CONFIG.warningCooldownHours;

  if (hoursSinceLastAlert < cooldownHours) {
    console.log(`[AlertDedup] Skipping: ${result.company} ${result.role} (last alert ${hoursSinceLastAlert.toFixed(1)}h ago)`);
    return false;
  }

  return true;
}

/**
 * Record that an alert was sent
 */
export function recordAlert(result: AnalysisResult): void {
  checkAndResetStore();

  alertStore.set(result.campaignId, {
    campaignId: result.campaignId,
    severity: result.severity,
    timestamp: Date.now(),
    date: getTodayIST(),
  });
}

/**
 * Get all alerts sent today (for debugging/monitoring)
 */
export function getTodaysAlerts(): AlertRecord[] {
  checkAndResetStore();
  return Array.from(alertStore.values());
}

/**
 * Clear all alerts (for testing)
 */
export function clearAlerts(): void {
  alertStore.clear();
}
