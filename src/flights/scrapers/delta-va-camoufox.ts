/**
 * Delta Award Search via Virgin Atlantic + Camoufox (Python subprocess wrapper)
 *
 * Searches Virgin Atlantic's website for SkyTeam partner award flights,
 * which includes Delta-operated flights. Uses Camoufox to bypass Akamai
 * bot protection on virginatlantic.com.
 *
 * Points shown are Virgin Atlantic Flying Club points.
 *
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCamoufoxSearch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'Delta-VA-Camoufox',
  script: 'delta-va-camoufox.py',
  cachePrefix: 'delta-va',
  timeoutMs: 90_000,
  maxRetries: 1,  // Single attempt — Akamai blocks retries too; fail fast for fallback chain
  retryBaseDelayMs: 2000,
};

export function searchDeltaViaCamoufox(params: SearchParams): Promise<FlightResult[]> {
  return runCamoufoxSearch(params, OPTS);
}

/**
 * Filter results to only Delta-operated flights.
 */
export function filterDeltaOnly(results: FlightResult[]): FlightResult[] {
  return results.filter(r => {
    const code = (r as any).metadata?.operatingAirlineCode;
    if (code === 'DL') return true;
    if (r.airline === 'Delta') return true;
    if (r.flightNumber?.startsWith('DL')) return true;
    return false;
  });
}

export default { searchDeltaViaCamoufox, filterDeltaOnly };
