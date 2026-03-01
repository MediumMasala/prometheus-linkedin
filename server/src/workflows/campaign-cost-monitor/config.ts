// Campaign Cost Monitor - Configuration

export const ALERT_CONFIG = {
  // Cost per resume thresholds (INR)
  cprThreshold: 400,              // Base alert threshold
  criticalCprThreshold: 600,      // Always critical above this
  zeroCostThreshold: 500,         // Alert if ₹500+ spent with 0 resumes

  // Time-based severity rules (IST hours, 0-23)
  earlyMorningCutoff: 8,          // Before 8 AM - too early to judge
  earlyDayCutoff: 12,             // Before noon - might recover
  lateDayCutoff: 15,              // After 3 PM - unlikely to recover
  endOfDayCutoff: 20,             // After 8 PM - day is done

  // Minimum spend to trigger alert (ignore tiny spends)
  minimumSpendForAlert: 200,      // Don't alert if spend < ₹200

  // Deduplication settings
  warningCooldownHours: 4,        // Don't re-alert warning within 4 hours
  criticalCooldownHours: 4,       // Don't re-alert critical within 4 hours
  allowEscalation: true,          // Allow warning → critical re-alert

  // Scheduler
  checkIntervalMinutes: 120,      // Run every 2 hours

  // Slack
  slackChannel: '#campaign-alerts',

  // Currency
  currency: 'INR',
  currencySymbol: '₹',
};

// Get current IST time info
export function getISTTimeInfo(): { hour: number; dayOfWeek: number; isWeekend: boolean; timestamp: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset);

  const hour = istTime.getUTCHours();
  const dayOfWeek = istTime.getUTCDay(); // 0 = Sunday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    hour,
    dayOfWeek,
    isWeekend,
    timestamp: istTime.toISOString(),
  };
}

// Get readable time string
export function getISTTimeString(): string {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Get today's date in IST
export function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD format
}
