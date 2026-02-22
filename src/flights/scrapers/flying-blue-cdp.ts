/**
 * Air France/KLM Flying Blue Award Search via real Chrome CDP (Python subprocess wrapper)
 *
 * Launches Chrome normally with --remote-debugging-port and connects via
 * Patchright CDP. Bypasses Akamai because no automation flags are set.
 * No login required.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, runPatchrightBatch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'FlyingBlue-CDP',
  script: 'flying-blue-cdp.py',
  cachePrefix: 'flying-blue',
  timeoutMs: 60_000,
  maxRetries: 2,
  retryBaseDelayMs: 3000,
};

export function searchFlyingBlueCdp(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export async function searchFlyingBlueCdpBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runPatchrightBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
