/**
 * Flying Blue Award Search via Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) to bypass Akamai that blocks
 * stock Playwright. No login required.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'FlyingBlue-Patchright',
  script: 'flying-blue-patchright.py',
  cachePrefix: 'flying-blue',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — Akamai blocks both AF and KLM; fail fast
  retryBaseDelayMs: 3000,
};

export function searchFlyingBluePatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export default { searchFlyingBluePatchright };
