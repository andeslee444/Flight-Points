/**
 * United Award Search via Aeroplan + Patchright (Python subprocess wrapper)
 *
 * Uses Patchright (patched Chromium) to render the Aeroplan SPA that
 * Camoufox Firefox cannot.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runPatchrightSearch, type PatchrightRunnerOptions } from './patchright-runner.js';

const OPTS: PatchrightRunnerOptions = {
  label: 'UA-Aeroplan-Patchright',
  script: 'united-aeroplan-patchright.py',
  cachePrefix: 'united-aeroplan',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — Akamai 403 blocks search URL; retries don't help
  retryBaseDelayMs: 5000,
};

export function searchUnitedViaAeroplanPatchright(params: SearchParams): Promise<FlightResult[]> {
  return runPatchrightSearch(params, OPTS);
}

export default { searchUnitedViaAeroplanPatchright };
