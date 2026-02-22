/**
 * United Award Search via Aeroplan + cookie farm + curl_cffi (Python subprocess wrapper)
 *
 * Hybrid approach: Patchright browser farms Akamai cookies AND performs login,
 * then curl_cffi uses those authenticated cookies for fast API searches.
 * Covers all Star Alliance award space including United metal.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'UA-Aeroplan-CurlFfi',
  script: 'united-aeroplan-curlffi.py',
  cachePrefix: 'united-aeroplan',
  timeoutMs: 120_000,  // Cookie farming with login takes ~20s + search ~5s
  maxRetries: 2,
  retryBaseDelayMs: 5000,
};

export function searchUnitedViaAeroplanCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export default { searchUnitedViaAeroplanCurlFfi };
