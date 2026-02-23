/**
 * Air France/KLM Flying Blue Award Search via real Chrome CDP (Python subprocess wrapper)
 *
 * Launches Chrome normally with --remote-debugging-port and connects via
 * Patchright CDP. Bypasses Akamai because no automation flags are set.
 *
 * Requires one-time login (session persists in Chrome profile).
 * Login uses OTP via email — run: python3 flying-blue-cdp.py login
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, runPatchrightBatch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'FlyingBlue-CDP',
  script: 'flying-blue-cdp.py',
  cachePrefix: 'flying-blue',
  timeoutMs: 90_000,  // Needs form fill + calendar navigation + result load
  maxRetries: 2,
  retryBaseDelayMs: 5000,
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
