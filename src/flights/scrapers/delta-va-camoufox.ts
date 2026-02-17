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

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const SCRIPT_PATH = resolve(__dirname, 'delta-va-camoufox.py');
const TIMEOUT_MS = 120_000; // 2 minutes

function log(msg: string) {
  console.log(`[Delta-VA-Camoufox ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export function searchDeltaViaCamoufox(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('delta-va', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return Promise.resolve(cached);
  }

  log(`Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  return new Promise((resolve) => {
    const paramsJson = JSON.stringify(params);
    const child = execFile('python3', [SCRIPT_PATH, paramsJson], {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout, stderr) => {
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          log(`  py: ${line}`);
        }
      }

      if (error) {
        log(`Error: ${error.message}`);
        resolve([]);
        return;
      }

      try {
        const results: FlightResult[] = JSON.parse(stdout.trim() || '[]');
        log(`Got ${results.length} results`);

        if (results.length > 0) {
          setCache(cacheKey, results, 30 * 60 * 1000); // 30 min cache
        }

        resolve(results);
      } catch (parseErr: any) {
        log(`JSON parse error: ${parseErr.message}`);
        log(`stdout: ${stdout.substring(0, 200)}`);
        resolve([]);
      }
    });

    child.on('error', (err) => {
      log(`Process error: ${err.message}`);
      resolve([]);
    });
  });
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
