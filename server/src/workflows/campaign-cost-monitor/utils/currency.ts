// Indian Currency Formatting Utilities

/**
 * Format amount in INR with Indian numbering system
 * e.g., 100000 → ₹1,00,000
 */
export function formatINR(amount: number): string {
  if (!isFinite(amount)) {
    return '₹∞';
  }

  // Round to nearest integer for amounts > ₹100
  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;

  // Use Indian numbering system
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: rounded >= 100 ? 0 : 1,
    minimumFractionDigits: 0,
  });

  return formatter.format(rounded);
}

/**
 * Format amount without currency symbol
 */
export function formatNumber(amount: number): string {
  if (!isFinite(amount)) {
    return '∞';
  }

  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10;

  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: rounded >= 100 ? 0 : 1,
    minimumFractionDigits: 0,
  }).format(rounded);
}

/**
 * Format percentage
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Calculate how much over threshold
 */
export function calculateExcess(actual: number, threshold: number): number {
  return Math.max(0, actual - threshold);
}

/**
 * Format excess as readable string
 */
export function formatExcess(actual: number, threshold: number): string {
  const excess = calculateExcess(actual, threshold);
  if (excess <= 0) return '';
  return `${formatINR(excess)} over`;
}
