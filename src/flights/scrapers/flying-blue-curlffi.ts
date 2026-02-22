/**
 * Flying Blue Award Search via cookie farm + curl_cffi (Python subprocess wrapper)
 *
 * Uses cookie farm (Patchright browser) to solve Akamai, then curl_cffi
 * for fast GraphQL API calls to Air France. No login required.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'FlyingBlue-CurlFfi',
  script: 'flying-blue-curlffi.py',
  cachePrefix: 'flying-blue',
  timeoutMs: 90_000,  // Cookie farming takes ~15s + search ~5s
  maxRetries: 2,
  retryBaseDelayMs: 3000,
};

export function searchFlyingBlueCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchFlyingBlueCurlFfi };
