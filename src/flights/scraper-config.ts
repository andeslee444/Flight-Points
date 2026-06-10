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

// ── Live search tuning ──────────────────────────────────────

/** Per-individual-search timeout for live search (ms) — fail fast, move to next date */
export const LIVE_SEARCH_PER_CALL_TIMEOUT_MS = 90_000;

/** Number of sample dates to generate for live search (daemon uses 4) */
export const LIVE_SEARCH_DATE_COUNT = 2;

// ── curl_cffi scraper tuning (fast, no browser startup) ───────
export const CURLFFI_SCRAPER_TIMEOUT_MS = 30_000;
export const CURLFFI_MAX_RETRIES = 3;
export const CURLFFI_RETRY_BASE_DELAY_MS = 2_000;
export const CURLFFI_BATCH_DELAY_MS = 5_000;

/** Circuit breaker: consecutive failures before disabling a scraper */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker: cooldown period after tripping (ms) */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Silent-zero detection: how many consecutive cycles a scraper may return
 * 0 results (with no thrown error) before it's flagged "suspect". A genuinely
 * working scraper hitting low-availability dates returns 0 occasionally; a
 * soft-blocked or DOM-drifted scraper returns 0 every cycle. This flag is a
 * SIGNAL (surfaced in health + alerts), not an auto-disable — zeros can be
 * legitimate, so we never trip the circuit breaker on them.
 */
export const ZERO_SUSPECT_THRESHOLD = 3;

/**
 * Sanity ceilings to catch parser corruption (e.g. a DOM-drift bug reading a
 * flight number as a mileage value). Real award fares stay well under these.
 */
export const MAX_REASONABLE_POINTS = 2_000_000;
export const MAX_REASONABLE_TAXES_USD = 5_000;
