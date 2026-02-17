/**
 * AA Award Search — Fast batch mode with persistent Camoufox session.
 * 
 * Instead of launching Camoufox per search (~60s each), this:
 * 1. Launches Camoufox ONCE for the entire batch
 * 2. Warms cookies, then runs searches sequentially (~15-25s each)
 * 3. Streams results via JSONL (one line per search)
 * 
 * Expected speedup: 3-5x for batches of 5+ searches.
 */

import { execFile, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';
import { searchAACamoufox } from './aa-camoufox.js';

const SCRIPT_PATH = resolve(__dirname, 'aa-fast.py');
const BATCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for full batch

function log(msg: string) {
  console.log(`[AA-Fast ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

/**
 * Single search — just delegates to original Camoufox (no benefit for single).
 */
export async function searchAAFast(params: SearchParams): Promise<FlightResult[]> {
  return searchAACamoufox(params);
}

/**
 * Batch search — launches ONE Camoufox session for all searches.
 * Much faster than sequential single-browser launches.
 */
export async function searchAAFastBatch(
  paramsList: SearchParams[],
  _delayBetweenMs: number = 2000, // ignored, Python handles delays
): Promise<Map<string, FlightResult[]>> {
  const results = new Map<string, FlightResult[]>();

  // Check cache first, only search uncached
  const uncached: SearchParams[] = [];
  for (const params of paramsList) {
    const key = `${params.origin}-${params.destination}-${params.date}`;
    const cacheKey = getCacheKey('aa', params);
    const cached = getCached(cacheKey);
    if (cached) {
      log(`Cache hit: ${key} (${cached.length} results)`);
      results.set(key, cached);
    } else {
      uncached.push(params);
    }
  }

  if (uncached.length === 0) {
    log('All searches cached');
    return results;
  }

  log(`Batch: ${uncached.length} uncached searches (${paramsList.length - uncached.length} cached)`);

  const input = JSON.stringify({ searches: uncached });

  return new Promise((resolve_p) => {
    const child = execFile('python3', [SCRIPT_PATH, input], {
      timeout: BATCH_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout, stderr) => {
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          log(`  py: ${line}`);
        }
      }

      if (error) {
        log(`Batch error: ${error.message}`);
      }

      // Parse JSONL output
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.key && data.results) {
            results.set(data.key, data.results);
            // Cache non-empty results
            if (data.results.length > 0) {
              // Find matching params
              const params = uncached.find(p =>
                `${p.origin}-${p.destination}-${p.date}` === data.key
              );
              if (params) {
                setCache(getCacheKey('aa', params), data.results);
              }
            }
          }
        } catch {
          log(`Failed to parse JSONL line: ${line.slice(0, 100)}`);
        }
      }

      // Fill in any missing keys with empty arrays
      for (const params of uncached) {
        const key = `${params.origin}-${params.destination}-${params.date}`;
        if (!results.has(key)) {
          results.set(key, []);
        }
      }

      let total = 0;
      for (const [, flights] of results) total += flights.length;
      log(`Batch complete: ${total} total results across ${results.size} searches`);

      resolve_p(results);
    });
  });
}
