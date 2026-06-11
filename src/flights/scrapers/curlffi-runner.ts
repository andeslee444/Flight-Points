/**
 * Shared curl_cffi Python subprocess runner.
 *
 * Mirrors patchright-runner.ts but with faster defaults (no browser startup).
 * Provides: cache check, subprocess execution, JSON parsing with debug output,
 * retry with exponential backoff, and batch sequential execution.
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';
import { resolveProxyBudgeted } from '../net/proxy-router.js';
import { getSharedBudget } from '../scheduling/cost-budget.js';
import { fullJitterBackoff } from '../net/rate-limit.js';
import {
  CURLFFI_SCRAPER_TIMEOUT_MS,
  CURLFFI_MAX_RETRIES,
  CURLFFI_RETRY_BASE_DELAY_MS,
  CURLFFI_BATCH_DELAY_MS,
} from '../scraper-config.js';

/** Derive a SCRAPER_REGISTRY-ish key from a script filename for proxy routing.
 *  'alaska-curlffi.py' → 'alaska', 'cathay-curlffi.py' → 'cathay'. Unknown keys
 *  fall back to the akamai tier in proxy-router, so this is always safe. */
function scraperKeyFromScript(script: string): string {
  return script.replace(/\.py$/, '').replace(/-curlffi$/, '').replace(/-fast$/, '');
}

export interface CurlFfiRunnerOptions {
  /** Display name for logging, e.g. 'DeltaVA-CurlFfi' */
  label: string;
  /** Python script filename (relative to scrapers dir), e.g. 'delta-va-curlffi.py' */
  script: string;
  /** Cache key prefix, e.g. 'delta-va' */
  cachePrefix: string;
  /** Subprocess timeout in ms */
  timeoutMs: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (doubled each retry, default: 2000) */
  retryBaseDelayMs?: number;
  /** Delay between batch searches in ms (default: 5000) */
  batchDelayMs?: number;
  /** Route crawl-score priority 0..1 (cost-budget escalation gate; default 0.5). */
  routePriority?: number;
}

function makeLogger(label: string) {
  return (msg: string) => {
    console.log(`[${label} ${new Date().toISOString().slice(11, 23)}] ${msg}`);
  };
}

/**
 * Run a single curl_cffi search with caching and retry.
 */
export function runCurlFfiSearch(
  params: SearchParams,
  opts: CurlFfiRunnerOptions,
): Promise<FlightResult[]> {
  const log = makeLogger(opts.label);
  const cacheKey = getCacheKey(opts.cachePrefix, params);
  const cached = getCached(cacheKey);
  if (cached) {
    log(`Cache hit: ${cacheKey} (${cached.length} results)`);
    return Promise.resolve(cached);
  }

  log(`Search: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);

  const maxRetries = opts.maxRetries ?? CURLFFI_MAX_RETRIES;
  const retryBaseDelay = opts.retryBaseDelayMs ?? CURLFFI_RETRY_BASE_DELAY_MS;
  const scriptPath = resolve(__dirname, opts.script);

  // Route this scraper through the proxy tier its difficulty calls for
  // (public→datacenter, akamai→residential, auth→mobile), degrading to the
  // VPS when higher tiers aren't configured. Passed to Python via PROXY_URL,
  // which curlffi_base.py already reads. When COST_BUDGET_USD is set, the budget
  // gates escalation: low-priority routes / an exhausted budget stay on the
  // cheap datacenter tier even if a residential/mobile proxy is configured.
  const scraperKey = scraperKeyFromScript(opts.script);
  const routed = resolveProxyBudgeted(scraperKey, opts.routePriority ?? 0.5);
  const proxyUrl = routed.proxyUrl;
  const budget = getSharedBudget();
  if (budget && routed.degradedForBudget) {
    log(`Budget exhausted — degraded ${scraperKey} to ${routed.tier} (est $${routed.estCostUsd.toFixed(3)})`);
  }

  return new Promise(async (outerResolve) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        // Full jitter (not fixed exponential): parallel scrapers retrying on
        // the shared IP must not synchronize and amplify a block.
        const delay = fullJitterBackoff(attempt - 1, retryBaseDelay);
        log(`Retry ${attempt}/${maxRetries - 1} after ${delay}ms (jittered)...`);
        await new Promise(r => setTimeout(r, delay));
      }

      const result = await new Promise<FlightResult[] | null>((resolve) => {
        const paramsJson = JSON.stringify(params);
        execFile('python3', [scriptPath, paramsJson], {
          timeout: opts.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
            ...(proxyUrl ? { PROXY_URL: proxyUrl } : {}),
          },
        }, (error: Error | null, stdout: string, stderr: string) => {
          if (stderr) {
            const lines = stderr.split('\n').filter(Boolean);
            for (const line of lines.slice(-10)) {
              log(`  py: ${line}`);
            }
          }

          if (error) {
            const isExitCode = error.message.includes('exit code');
            log(`${isExitCode ? 'Retryable failure' : 'Error'} (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);
            resolve(null);
            return;
          }

          try {
            const results: FlightResult[] = JSON.parse(stdout.trim() || '[]');
            log(`Got ${results.length} results`);
            resolve(results);
          } catch (e: any) {
            log(`JSON parse error: ${e.message}`);
            log(`stdout (first 200 chars): ${stdout.substring(0, 200)}`);
            resolve(null);
          }
        });
      });

      if (result !== null) {
        if (result.length > 0) {
          setCache(cacheKey, result);
        }
        // Meter the marginal cost of this proxied job against the shared budget
        // (once per logical search, not per retry — a first-order estimate).
        if (budget && routed.estCostUsd > 0) budget.recordSpend(routed.estCostUsd);
        outerResolve(result);
        return;
      }
    }

    if (budget && routed.estCostUsd > 0) budget.recordSpend(routed.estCostUsd);
    log(`All ${maxRetries} attempts failed`);
    outerResolve([]);
  });
}

/**
 * Run batch searches sequentially with delays between them.
 */
export async function runCurlFfiBatch(
  paramsList: SearchParams[],
  opts: CurlFfiRunnerOptions,
  searchFn?: (params: SearchParams) => Promise<FlightResult[]>,
): Promise<Map<string, FlightResult[]>> {
  const log = makeLogger(opts.label);
  const results = new Map<string, FlightResult[]>();
  const delayMs = opts.batchDelayMs ?? CURLFFI_BATCH_DELAY_MS;

  const doSearch = searchFn || ((p: SearchParams) => runCurlFfiSearch(p, opts));

  for (let i = 0; i < paramsList.length; i++) {
    const params = paramsList[i];
    const key = `${params.origin}-${params.destination}-${params.date}`;

    const flights = await doSearch(params);
    results.set(key, flights);

    if (i < paramsList.length - 1) {
      const delay = delayMs + Math.random() * 4000 - 2000;
      log(`Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}
