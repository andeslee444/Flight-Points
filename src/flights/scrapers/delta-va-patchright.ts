/**
 * Delta Award Search via Virgin Atlantic + Patchright (Python subprocess wrapper)
 *
 * Same as delta-va-camoufox.ts but uses Patchright (patched Chromium) to bypass
 * Akamai/Shape detection that stock Playwright leaks via CDP.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'Delta-VA-Patchright',
  script: 'delta-va-patchright.py',
  cachePrefix: 'delta-va',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — Akamai blocks retries too; fail fast for fallback chain
  retryBaseDelayMs: 2000,
};

export function searchDeltaViaPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export function filterDeltaOnly(results: FlightResult[]): FlightResult[] {
  return results.filter(r => {
    const code = (r as any).metadata?.operatingAirlineCode;
    if (code === 'DL') return true;
    if (r.airline === 'Delta') return true;
    if (r.flightNumber?.startsWith('DL')) return true;
    return false;
  });
}

export default { searchDeltaViaPatchright, filterDeltaOnly };
