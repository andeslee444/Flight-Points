/**
 * Singapore Airlines KrisFlyer Award Search via Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) to render the SQ SPA that Camoufox Firefox cannot.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'SQ-Patchright',
  script: 'sq-patchright.py',
  cachePrefix: 'sq',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — Akamai blocks login; retries don't help
  retryBaseDelayMs: 5000,
};

export function searchSQPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export default { searchSQPatchright };
