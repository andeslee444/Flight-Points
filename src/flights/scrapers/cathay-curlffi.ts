/**
 * Cathay Pacific Award Search via curl_cffi (Python subprocess wrapper)
 *
 * Uses Cathay's public AFR (Award Flight Redemption) API.
 * Returns calendar-level availability for CX-operated routes to/from HKG.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'Cathay-CurlFfi',
  script: 'cathay-curlffi.py',
  cachePrefix: 'cathay',
  timeoutMs: 30_000,
  maxRetries: 2,
  retryBaseDelayMs: 1000,
};

export function searchCathayCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchCathayCurlFfi };
