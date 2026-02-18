/**
 * Centralized Scraper Configuration
 *
 * All scraper timeouts, retry settings, and rate limits in one place.
 * Individual scrapers import what they need.
 */

/** Default timeout for Python subprocess scrapers (ms) */
export const DEFAULT_SCRAPER_TIMEOUT_MS = 120_000;

/** Max retry attempts for failed scraper calls */
export const DEFAULT_MAX_RETRIES = 2;

/** Base delay between retries (doubled each attempt) */
export const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;

/** Default delay between batch searches (ms) */
export const DEFAULT_BATCH_DELAY_MS = 30_000;

/** Max buffer size for Python subprocess stdout (bytes) */
export const MAX_SUBPROCESS_BUFFER = 10 * 1024 * 1024;

/** In-memory cache TTL (ms) */
export const CACHE_TTL_MS = 30 * 60 * 1000;

/** Max entries in the in-memory cache before eviction */
export const CACHE_MAX_ENTRIES = 500;

/** Per-scraper timeout overrides */
export const SCRAPER_TIMEOUTS: Record<string, number> = {
  'aa': 120_000,
  'ana': 180_000,    // ANA is slower
  'ba-avios': 150_000, // BA can be slow
  'singapore': 120_000,
  'delta-va': 120_000,
  'united-aeroplan': 150_000, // login + search
};

/** Circuit breaker: consecutive failures before disabling a scraper */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker: cooldown period after tripping (ms) */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
