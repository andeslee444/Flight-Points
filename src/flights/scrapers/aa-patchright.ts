/**
 * AA Award Search via Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) to bypass Akamai Bot Manager.
 * Chromium renders AA's Angular SPA properly (unlike Camoufox Firefox).
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, runPatchrightBatch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'AA-Patchright',
  script: 'aa-patchright.py',
  cachePrefix: 'aa',
  timeoutMs: 120_000,
  maxRetries: 1,  // Fail fast — Akamai almost always blocks; Camoufox is now primary
  retryBaseDelayMs: 2000,
};

export function searchAAPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export async function searchAAPatchrightBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  return runPatchrightBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs });
}
