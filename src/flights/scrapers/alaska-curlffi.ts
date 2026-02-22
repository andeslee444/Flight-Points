/**
 * Alaska Airlines Award Search via curl_cffi (Python subprocess wrapper)
 *
 * Uses Alaska's hybrid ASP.NET + SvelteKit architecture.
 * Shop form POST -> 302 redirect -> __data.json (bypasses bot check).
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'Alaska-CurlFfi',
  script: 'alaska-curlffi.py',
  cachePrefix: 'alaska',
  timeoutMs: 60_000,
  maxRetries: 3,
  retryBaseDelayMs: 2000,
};

export function searchAlaskaCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchAlaskaCurlFfi };
