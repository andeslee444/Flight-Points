/**
 * Singapore Airlines KrisFlyer Award Search via Camoufox
 *
 * Primary: Camoufox anti-detect browser with API interception
 * Fallback: Award chart estimates (no external API dependency)
 *
 * Requires: SQ_KRISFLYER_ID, SQ_KRISFLYER_PASSWORD env vars (for Camoufox)
 *
 * NOTE: seats.aero is NOT used here — non-commercial license only.
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';
import { estimateAwardCost } from './singapore.js';

const SCRIPT_PATH = resolve(__dirname, 'sq-camoufox.py');
const TIMEOUT_MS = 120_000; // 2 minutes (reduced — SPA often fails)

function log(msg: string) {
  console.log(`[SQ-Camoufox-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

/**
 * Try Camoufox scraper first, fall back to award chart estimates
 */
export async function searchSQCamoufox(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('singapore', params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return cached;
  }

  log(`Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  // Strategy 1: Camoufox (if credentials available)
  if (process.env.SQ_KRISFLYER_ID && process.env.SQ_KRISFLYER_PASSWORD) {
    try {
      const camoufoxResults = await runCamoufox(params);
      if (camoufoxResults.length > 0) {
        log(`Camoufox returned ${camoufoxResults.length} results`);
        setCache(cacheKey, camoufoxResults);
        return camoufoxResults;
      }
      log('Camoufox returned 0 results');
    } catch (e: any) {
      log(`Camoufox error: ${e.message}`);
    }
  }

  // Award chart estimates DISABLED — real data only, no fabricated results
  log('No real SQ data available (Camoufox failed, estimates disabled)');
  return [];

  log('No results from any source');
  return [];
}

function runCamoufox(params: SearchParams): Promise<FlightResult[]> {
  return new Promise((resolve) => {
    const paramsJson = JSON.stringify(params);
    execFile('python3', [SCRIPT_PATH, paramsJson], {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout, stderr) => {
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean).slice(-10)) {
          log(`  py: ${line}`);
        }
      }

      if (error) {
        log(`Camoufox process error: ${error.message}`);
        resolve([]);
        return;
      }

      try {
        const results: FlightResult[] = JSON.parse(stdout.trim() || '[]');
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
export async function searchSQCamoufoxBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 30000,
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;

    const flights = await searchSQCamoufox(params);
    results.set(key, flights);

    if (i < paramsList.length - 1) {
      const delay = delayBetweenMs + Math.random() * 10000 - 5000;
      log(`Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}
