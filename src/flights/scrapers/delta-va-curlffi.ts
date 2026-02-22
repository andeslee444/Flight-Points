/**
 * Delta Award Search via Virgin Atlantic + curl_cffi (Python subprocess wrapper)
 *
 * Uses curl_cffi to impersonate Chrome 131's TLS/JA3/HTTP2 fingerprints,
 * bypassing Akamai at the network level. ~2-3s per search vs 30s+ for browser scrapers.
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCurlFfiSearch, type CurlFfiRunnerOptions } from './curlffi-runner.js';

const OPTS: CurlFfiRunnerOptions = {
  label: 'DeltaVA-CurlFfi',
  script: 'delta-va-curlffi.py',
  cachePrefix: 'delta-va',
  timeoutMs: 30_000,
  maxRetries: 3,
  retryBaseDelayMs: 2000,
};

export function searchDeltaViaCurlFfi(params: SearchParams): Promise<FlightResult[]> {
  return runCurlFfiSearch(params, OPTS);
}

export function filterDeltaOnly(results: FlightResult[]): FlightResult[] {
  return results.filter(r => {
    const code = (r as any).metadata?.operatingAirlineCode;
    if (code === 'DL') return true;
    if (r.airline === 'Delta') return true;
    if (r.flightNumber?.startsWith('DL')) return true;
    return false;
  });
}

export default { searchDeltaViaCurlFfi, filterDeltaOnly };
