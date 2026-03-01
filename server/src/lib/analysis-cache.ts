// Analysis Cache - Stores Prometheus analysis results to avoid redundant API calls
// Cache invalidates after a configurable TTL or when explicitly refreshed

interface CachedAnalysis {
  dateRange: { start: string; end: string };
  fetchedAt: string;           // ISO timestamp when data was fetched
  fetchedAtIST: string;        // Human readable IST time
  linkedInCampaigns: number;   // Count for quick reference
  internalRoles: number;       // Count for quick reference
  data: any;                   // The full analysis result
  cacheKey: string;
}

interface CacheStore {
  analyses: Map<string, CachedAnalysis>;
  lastCleanup: string;
}

// In-memory cache (resets on server restart)
const cache: CacheStore = {
  analyses: new Map(),
  lastCleanup: new Date().toISOString(),
};

// Cache TTL in minutes - data older than this will be refreshed
const CACHE_TTL_MINUTES = 30;

// Generate cache key from date range
function getCacheKey(startDate: string, endDate: string): string {
  return `${startDate}_${endDate}`;
}

// Get IST time string
function getISTTimeString(date: Date = new Date()): string {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// Check if cache entry is still valid
function isCacheValid(entry: CachedAnalysis): boolean {
  const fetchedAt = new Date(entry.fetchedAt);
  const now = new Date();
  const ageMinutes = (now.getTime() - fetchedAt.getTime()) / (1000 * 60);

  // For today's data, use shorter TTL (data changes frequently)
  const today = new Date().toISOString().split('T')[0];
  const isToday = entry.dateRange.end === today;

  const ttl = isToday ? CACHE_TTL_MINUTES : CACHE_TTL_MINUTES * 4; // 30 min for today, 2 hours for past

  return ageMinutes < ttl;
}

// Get cached analysis if available and valid
export function getCachedAnalysis(startDate: string, endDate: string): CachedAnalysis | null {
  const key = getCacheKey(startDate, endDate);
  const entry = cache.analyses.get(key);

  if (!entry) {
    console.log(`[Cache] MISS - No cache for ${key}`);
    return null;
  }

  if (!isCacheValid(entry)) {
    console.log(`[Cache] EXPIRED - Cache for ${key} is stale (fetched at ${entry.fetchedAtIST})`);
    cache.analyses.delete(key);
    return null;
  }

  console.log(`[Cache] HIT - Using cached data for ${key} (fetched at ${entry.fetchedAtIST})`);
  return entry;
}

// Store analysis in cache
export function setCachedAnalysis(
  startDate: string,
  endDate: string,
  data: any
): CachedAnalysis {
  const key = getCacheKey(startDate, endDate);
  const now = new Date();

  const entry: CachedAnalysis = {
    dateRange: { start: startDate, end: endDate },
    fetchedAt: now.toISOString(),
    fetchedAtIST: getISTTimeString(now),
    linkedInCampaigns: data.linkedIn?.totalCampaigns || 0,
    internalRoles: data.internal?.totalRoles || 0,
    data,
    cacheKey: key,
  };

  cache.analyses.set(key, entry);
  console.log(`[Cache] STORED - Cached analysis for ${key} at ${entry.fetchedAtIST}`);

  return entry;
}

// Force refresh - invalidate cache for a date range
export function invalidateCache(startDate: string, endDate: string): boolean {
  const key = getCacheKey(startDate, endDate);
  const existed = cache.analyses.has(key);
  cache.analyses.delete(key);

  if (existed) {
    console.log(`[Cache] INVALIDATED - Cleared cache for ${key}`);
  }

  return existed;
}

// Clear all cache
export function clearAllCache(): number {
  const count = cache.analyses.size;
  cache.analyses.clear();
  console.log(`[Cache] CLEARED - Removed ${count} cached entries`);
  return count;
}

// Get cache status (for debugging/API)
export function getCacheStatus(): {
  entries: number;
  details: Array<{
    dateRange: string;
    fetchedAt: string;
    fetchedAtIST: string;
    campaigns: number;
    roles: number;
    isValid: boolean;
    ageMinutes: number;
  }>;
} {
  const details = Array.from(cache.analyses.values()).map((entry) => {
    const ageMinutes = Math.round(
      (new Date().getTime() - new Date(entry.fetchedAt).getTime()) / (1000 * 60)
    );

    return {
      dateRange: entry.cacheKey,
      fetchedAt: entry.fetchedAt,
      fetchedAtIST: entry.fetchedAtIST,
      campaigns: entry.linkedInCampaigns,
      roles: entry.internalRoles,
      isValid: isCacheValid(entry),
      ageMinutes,
    };
  });

  return {
    entries: cache.analyses.size,
    details,
  };
}

// Export cache config
export const CACHE_CONFIG = {
  ttlMinutes: CACHE_TTL_MINUTES,
  ttlMinutesToday: CACHE_TTL_MINUTES,
  ttlMinutesPast: CACHE_TTL_MINUTES * 4,
};
