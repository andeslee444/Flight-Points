/**
 * ANA Award Search via Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) as an additional fallback for ANA.
 * Rate limiting is still the main issue regardless of browser.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'ANA-Patchright',
  script: 'ana-patchright.py',
  cachePrefix: 'ana',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — "heavy traffic" anti-bot blocks login; retries waste time
  retryBaseDelayMs: 5000,
};

export function searchANAPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export default { searchANAPatchright };
