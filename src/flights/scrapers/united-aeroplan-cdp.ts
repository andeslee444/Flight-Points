/**
 * United/Aeroplan Award Search via real Chrome CDP (Python subprocess wrapper)
 *
 * Launches Chrome normally with --remote-debugging-port and connects via
 * Patchright CDP. Bypasses Akamai because no automation flags are set.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, runPatchrightBatch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'UA-Aeroplan-CDP',
  script: 'united-aeroplan-cdp.py',
  cachePrefix: 'united-aeroplan',
  timeoutMs: 90_000,
  maxRetries: 2,
  retryBaseDelayMs: 5000,
};

export function searchUnitedViaAeroplanCdp(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export async function searchUnitedViaAeroplanCdpBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runPatchrightBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
