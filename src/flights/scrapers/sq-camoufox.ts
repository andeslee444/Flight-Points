/**
 * Singapore Airlines KrisFlyer Award Search via Camoufox
 *
 * Primary: Camoufox anti-detect browser with API interception
 * Fallback: Award chart estimates (no external API dependency)
 *
 * Requires: SQ_KRISFLYER_ID, SQ_KRISFLYER_PASSWORD env vars (for Camoufox)
 *
 * NOTE: seats.aero is NOT used here — non-commercial license only.
 */

import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';
import { estimateAwardCost } from './singapore.js';
import { runCamoufoxSearch, runCamoufoxBatch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'SQ-Camoufox-TS',
  script: 'sq-camoufox.py',
  cachePrefix: 'singapore',
  timeoutMs: 120_000,
};

function log(msg: string) {
  console.log(`[SQ-Camoufox-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

/**
 * Try Camoufox scraper first, fall back to award chart estimates
 */
export async function searchSQCamoufox(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('singapore', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return cached;
  }

  log(`Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  // Strategy 1: Camoufox (if credentials available)
  if (process.env.SQ_KRISFLYER_ID && process.env.SQ_KRISFLYER_PASSWORD) {
    try {
      const camoufoxResults = await runCamoufoxSearch(params, {
        ...OPTS,
        // Skip cache check in runner since we already checked above
        cachePrefix: '__sq_inner',
      });
      if (camoufoxResults.length > 0) {
        log(`Camoufox returned ${camoufoxResults.length} results`);
        setCache(cacheKey, camoufoxResults);
        return camoufoxResults;
      }
      log('Camoufox returned 0 results');
    } catch (e: any) {
      log(`Camoufox error: ${e.message}`);
    }
  }

  // Award chart estimates DISABLED — real data only, no fabricated results
  log('No real SQ data available (Camoufox failed, estimates disabled)');
  return [];

  log('No results from any source');
  return [];
}

export async function searchSQCamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runCamoufoxBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs }, searchSQCamoufox);
}
