/**
 * United Award Search via Aeroplan + Camoufox (Python subprocess wrapper)
 *
 * Uses Aeroplan (Air Canada) to find Star Alliance award space including United metal.
 * Requires AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars (login required since March 2025).
 *
 * Created: 2026-02-16
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const SCRIPT_PATH = resolve(__dirname, 'united-aeroplan-camoufox.py');
const TIMEOUT_MS = 150_000; // 2.5 minutes (login + search)

function log(msg: string) {
  console.log(`[UA-Aeroplan-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export function searchUnitedViaAeroplan(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('united-aeroplan', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return Promise.resolve(cached);
  }

  if (!process.env.AEROPLAN_USERNAME || !process.env.AEROPLAN_PASSWORD) {
    log('Skipping: AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars required');
    return Promise.resolve([]);
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
 * Search and filter for United-operated flights only.
 */
export async function searchUnitedMetalViaAeroplan(params: SearchParams): Promise<FlightResult[]> {
  const all = await searchUnitedViaAeroplan(params);
  return all.filter(f =>
    f.flightNumber?.includes('UA') ||
    f.airline === 'United Airlines'
  );
}

/**
 * Batch search with delays between requests.
 */
export async function searchUnitedViaAeroplanBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 45000,
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;
    const flights = await searchUnitedViaAeroplan(params);
    results.set(key, flights);

    if (i < paramsList.length - 1) {
      const delay = delayBetweenMs + Math.random() * 10000 - 5000;
      log(`Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}
