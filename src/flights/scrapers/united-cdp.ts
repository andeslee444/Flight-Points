/**
 * United.com Award Search via real Chrome CDP (Python subprocess wrapper)
 *
 * Launches Chrome normally with --remote-debugging-port and connects via
 * Patchright CDP. Bypasses Akamai because no automation flags are set.
 *
 * Shows Star Alliance partner availability directly from united.com,
 * bypassing the Aeroplan/Gigya reCAPTCHA block.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, runPatchrightBatch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'United-CDP',
  script: 'united-cdp.py',
  cachePrefix: 'united',
  timeoutMs: 60_000,
  maxRetries: 2,
  retryBaseDelayMs: 5000,
};

export function searchUnitedCdp(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export async function searchUnitedCdpBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runPatchrightBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
