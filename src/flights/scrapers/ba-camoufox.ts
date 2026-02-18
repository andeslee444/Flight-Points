/**
 * BA Award Search via Camoufox (Python subprocess wrapper)
 *
 * Calls ba-camoufox.py which uses Camoufox anti-detect browser
 * to search BA.com for Avios reward flight availability.
 * Shows oneworld partner airlines: CX, JL, QR, AA, QF, AY, IB, etc.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCamoufoxSearch, runCamoufoxBatch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'BA-Camoufox-TS',
  script: 'ba-camoufox.py',
  cachePrefix: 'ba-avios',
  timeoutMs: 150_000, // BA can be slow
};

export function searchBACamoufox(params: SearchParams): Promise<FlightResult[]> {
  return runCamoufoxSearch(params, OPTS);
}

export async function searchBACamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runCamoufoxBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
