/**
 * Scraper Health Tracking & Circuit Breaker
 *
 * Tracks success/failure per scraper. If a scraper fails consecutively
 * beyond the threshold, it's temporarily disabled (circuit breaker pattern).
 *
 * Health stats are written to data/scraper-health.json for monitoring.
 */

import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { atomicWriteFileSync } from './utils.js';
import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_COOLDOWN_MS } from './scraper-config.js';

interface ScraperStats {
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastSuccess: string | null;
  lastFailure: string | null;
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
      lastSuccess: null,
      lastFailure: null,
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
  s.lastSuccess = new Date().toISOString();
  // Close circuit on success
  if (s.circuitOpen) {
    s.circuitOpen = false;
    s.circuitOpenedAt = null;
  }
}

/**
 * Record a failed scraper call.
 */
export function recordFailure(scraperKey: string): void {
  const s = getStats(scraperKey);
  s.totalCalls++;
  s.totalFailures++;
  s.consecutiveFailures++;
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
 * Write health stats to disk for monitoring.
 */
export function writeHealthFile(dataDir: string): void {
  const healthDir = dataDir;
  if (!existsSync(healthDir)) mkdirSync(healthDir, { recursive: true });

  const healthFile = path.join(healthDir, 'scraper-health.json');
  const data: Record<string, ScraperStats> = {};
  for (const [key, s] of stats) {
    data[key] = { ...s };
  }

  atomicWriteFileSync(healthFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    scrapers: data,
  }, null, 2));
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
