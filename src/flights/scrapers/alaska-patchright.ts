/**
 * Alaska Airlines Award Search via Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) to bypass Akamai that blocks
 * stock Playwright. No login required.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'Alaska-Patchright',
  script: 'alaska-patchright.py',
  cachePrefix: 'alaska',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — anti-bot blocks immediately; fail fast
  retryBaseDelayMs: 3000,
};

export function searchAlaskaPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export default { searchAlaskaPatchright };
