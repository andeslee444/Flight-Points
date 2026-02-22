/**
 * ANA Award Search via Camoufox (Python subprocess wrapper)
 *
 * Calls ana-camoufox.py which uses the Camoufox anti-detect browser
 * to bypass bot detection on ANA's award search.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCamoufoxSearch, runCamoufoxBatch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'ANA-Camoufox-TS',
  script: 'ana-camoufox.py',
  cachePrefix: 'ana',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — "heavy traffic" anti-bot blocks; fail fast
  retryBaseDelayMs: 2000,
};

export function searchANACamoufox(params: SearchParams): Promise<FlightResult[]> {
  return runCamoufoxSearch(params, OPTS);
}

export async function searchANACamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runCamoufoxBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
