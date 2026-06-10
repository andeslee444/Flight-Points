/**
 * Scraper Health Tracking & Circuit Breaker
 *
 * Tracks success/failure per scraper. If a scraper fails consecutively
 * beyond the threshold, it's temporarily disabled (circuit breaker pattern).
 *
 * Health stats are written to data/scraper-health.json for monitoring.
 */

import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_COOLDOWN_MS, ZERO_SUSPECT_THRESHOLD } from './scraper-config.js';
import { writeScraperHealth } from './db.js';

interface ScraperStats {
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  // Silent-zero tracking: a scraper that ran cleanly (no error) but returned 0
  // results. Tracked separately from failures so legitimate low-availability
  // doesn't trip the circuit breaker, but a scraper stuck at zero is still visible.
  totalZeros: number;
  consecutiveZeros: number;
  suspect: boolean; // consecutiveZeros >= ZERO_SUSPECT_THRESHOLD
  lastSuccess: string | null;
  lastFailure: string | null;
  lastZero: string | null;
  circuitOpen: boolean;
  circuitOpenedAt: string | null;
}

const stats = new Map<string, ScraperStats>();

function getStats(scraperKey: string): ScraperStats {
  let s = stats.get(scraperKey);
  if (!s) {
    s = {
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      totalZeros: 0,
      consecutiveZeros: 0,
      suspect: false,
      lastSuccess: null,
      lastFailure: null,
      lastZero: null,
      circuitOpen: false,
      circuitOpenedAt: null,
    };
    stats.set(scraperKey, s);
  }
  return s;
}

/**
 * Record a successful scraper call.
 */
export function recordSuccess(scraperKey: string): void {
  const s = getStats(scraperKey);
  s.totalCalls++;
  s.totalSuccesses++;
  s.consecutiveFailures = 0;
  // A real result clears the suspect/zero state too.
  s.consecutiveZeros = 0;
  s.suspect = false;
  s.lastSuccess = new Date().toISOString();
  // Close circuit on success
  if (s.circuitOpen) {
    s.circuitOpen = false;
    s.circuitOpenedAt = null;
  }
}

/**
 * Record a clean run that returned zero results (no error thrown).
 * Distinct from success and failure: it does NOT trip the circuit breaker
 * (zeros can be legitimate low-availability) but a scraper stuck at zero for
 * ZERO_SUSPECT_THRESHOLD consecutive cycles is flagged `suspect` so the
 * silent-block / DOM-drift / session-expiry case becomes visible.
 * Returns true if this call newly flipped the scraper to suspect.
 */
export function recordZero(scraperKey: string): boolean {
  const s = getStats(scraperKey);
  s.totalCalls++;
  s.totalZeros++;
  s.consecutiveZeros++;
  s.lastZero = new Date().toISOString();
  const wasSuspect = s.suspect;
  if (s.consecutiveZeros >= ZERO_SUSPECT_THRESHOLD) s.suspect = true;
  return s.suspect && !wasSuspect;
}

/**
 * Record a failed scraper call.
 */
export function recordFailure(scraperKey: string): void {
  const s = getStats(scraperKey);
  s.totalCalls++;
  s.totalFailures++;
  s.consecutiveFailures++;
  // A thrown error ends any silent-zero streak — this is a loud failure,
  // tracked by the circuit breaker below, not the suspect flag.
  s.consecutiveZeros = 0;
  s.suspect = false;
  s.lastFailure = new Date().toISOString();

  // Trip circuit breaker if threshold exceeded
  if (s.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && !s.circuitOpen) {
    s.circuitOpen = true;
    s.circuitOpenedAt = new Date().toISOString();
    console.warn(`[CircuitBreaker] ${scraperKey} disabled after ${s.consecutiveFailures} consecutive failures`);
  }
}

/**
 * Check if a scraper is currently available (circuit closed or cooldown elapsed).
 */
export function isScraperAvailable(scraperKey: string): boolean {
  const s = stats.get(scraperKey);
  if (!s || !s.circuitOpen) return true;

  // Check if cooldown period has elapsed
  if (s.circuitOpenedAt) {
    const elapsed = Date.now() - new Date(s.circuitOpenedAt).getTime();
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Half-open: allow one attempt
      s.circuitOpen = false;
      s.circuitOpenedAt = null;
      s.consecutiveFailures = CIRCUIT_BREAKER_THRESHOLD - 1; // Will re-trip on next failure
      console.log(`[CircuitBreaker] ${scraperKey} re-enabled after cooldown`);
      return true;
    }
  }

  return false;
}

/**
 * Write health stats to database for monitoring.
 */
export function writeHealthFile(): void {
  const data: Record<string, ScraperStats> = {};
  for (const [key, s] of stats) {
    data[key] = { ...s };
  }
  writeScraperHealth(data).catch(err => {
    console.error('[ScraperHealth] Failed to write to DB:', err.message);
  });
}

/**
 * Scrapers currently flagged suspect (stuck returning clean zeros). The daemon
 * surfaces these each cycle and the staleness/canary tooling can alert on them.
 */
export function getSuspectScrapers(): string[] {
  const out: string[] = [];
  for (const [key, s] of stats) {
    if (s.suspect) out.push(key);
  }
  return out;
}

/**
 * Get health summary for all tracked scrapers.
 */
export function getHealthSummary(): Record<string, ScraperStats> {
  const summary: Record<string, ScraperStats> = {};
  for (const [key, s] of stats) {
    summary[key] = { ...s };
  }
  return summary;
}
