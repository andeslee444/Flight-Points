/**
 * AA Award Search via Camoufox (Python subprocess wrapper)
 *
 * Calls aa-camoufox.py which uses the Camoufox anti-detect browser
 * to bypass Akamai Bot Manager detection.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCamoufoxSearch, runCamoufoxBatch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'AA-Camoufox-TS',
  script: 'aa-camoufox.py',
  cachePrefix: 'aa',
  timeoutMs: 120_000,
};

export function searchAACamoufox(params: SearchParams): Promise<FlightResult[]> {
  return runCamoufoxSearch(params, OPTS);
}

export async function searchAACamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runCamoufoxBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
