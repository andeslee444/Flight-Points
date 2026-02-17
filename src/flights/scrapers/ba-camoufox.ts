/**
 * BA Award Search via Camoufox (Python subprocess wrapper)
 *
 * Calls ba-camoufox.py which uses Camoufox anti-detect browser
 * to search BA.com for Avios reward flight availability.
 * Shows oneworld partner airlines: CX, JL, QR, AA, QF, AY, IB, etc.
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const SCRIPT_PATH = resolve(__dirname, 'ba-camoufox.py');
const TIMEOUT_MS = 150_000; // 2.5 minutes (BA can be slow)

function log(msg: string) {
  console.log(`[BA-Camoufox-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export function searchBACamoufox(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('ba-avios', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return Promise.resolve(cached);
  }

  log(`Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  return new Promise((resolve) => {
    const paramsJson = JSON.stringify(params);
    execFile('python3', [SCRIPT_PATH, paramsJson], {
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
          setCache(cacheKey, results);
        }
        resolve(results);
      } catch (e: any) {
        log(`JSON parse error: ${e.message}`);
        resolve([]);
      }
    });
  });
}

/**
 * Batch search — runs searches sequentially with delays.
 */
export async function searchBACamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;

    const flights = await searchBACamoufox(params);
    results.set(key, flights);

    if (i < paramsList.length - 1) {
      const delay = delayBetweenMs + Math.random() * 10000 - 5000;
      log(`Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}
