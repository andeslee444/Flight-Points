/**
 * Singapore Airlines KrisFlyer Award Search via curl_cffi (Python subprocess wrapper)
 *
 * Uses curl_cffi to impersonate Chrome 131's TLS/JA3/HTTP2 fingerprints,
 * bypassing Akamai at the network level. ~2-3s per search vs 30s+ for browser scrapers.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'SQ-CurlFfi',
  script: 'sq-curlffi.py',
  cachePrefix: 'sq',
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 2000,
};

export function searchSQCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchSQCurlFfi };
