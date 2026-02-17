/**
 * AA Award Search via Camoufox (Python subprocess wrapper)
 * 
 * Calls aa-camoufox.py which uses the Camoufox anti-detect browser
 * to bypass Akamai Bot Manager detection.
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const SCRIPT_PATH = resolve(__dirname, 'aa-camoufox.py');
const TIMEOUT_MS = 120_000; // 2 minutes per search

function log(msg: string) {
  console.log(`[AA-Camoufox-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export function searchAACamoufox(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('aa', params);
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
        // Log Python stderr (info messages)
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
 * Batch search using Camoufox — runs searches sequentially with delays.
 */
export async function searchAACamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;

    const flights = await searchAACamoufox(params);
    results.set(key, flights);

    // Delay between searches (skip after last)
    if (i < paramsList.length - 1) {
      const delay = delayBetweenMs + Math.random() * 10000 - 5000;
      log(`Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}
