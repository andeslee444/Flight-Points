/**
 * American Airlines Award Search via curl_cffi (Python subprocess wrapper)
 *
 * Uses AA's Angular SPA API directly with Chrome 131 TLS impersonation.
 * POST /booking/api/search/itinerary with XSRF-TOKEN cookie.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'AA-CurlFfi',
  script: 'aa-curlffi.py',
  cachePrefix: 'aa',
  timeoutMs: 90_000,  // AA search can be slow (65s server timeout)
  maxRetries: 2,
  retryBaseDelayMs: 3000,
};

export function searchAACurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchAACurlFfi };
