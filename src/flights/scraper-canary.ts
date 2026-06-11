/**
 * Golden-route CANARY LOOP.
 *
 * A scheduled regression that proves each ACTIVE scraper still returns results
 * on a route known to have award space. This replaces the hand-edited
 * `status:` comments in SCRAPER_REGISTRY that rotted silently — the old harness
 * also rotted because it hardcoded a fixed date that drifted into the past.
 * Here the search date is ALWAYS computed at runtime (today + 45 days), so it
 * can never go stale.
 *
 * For each golden route we call the scraper and classify the outcome:
 *   PASS  — returned > 0 results
 *   EMPTY — ran cleanly, returned 0 results (no throw)
 *   FAIL  — threw, or exceeded the per-call timeout
 *
 * Outcomes feed scraper-health (recordSuccess / recordZero / recordFailure) and
 * are persisted via writeHealthFile() (best-effort — needs DB; if unavailable we
 * log and continue). A JSON report is written to data/canary-report.json.
 *
 * Usage:
 *   npx tsx src/flights/scraper-canary.ts            # run once, exit 0/1
 *   npx tsx src/flights/scraper-canary.ts --loop     # run every 6h until SIGINT
 *   npx tsx src/flights/scraper-canary.ts --loop=3600  # custom interval (s)
 *   CANARY_DRY=1 npx tsx src/flights/scraper-canary.ts  # print plan, no network
 *
 * Run periodically via launchd (deploy/com.flightpoints.canary.plist,
 * StartInterval 21600s) or with the built-in --loop flag.
 *
 * Exit codes (one-shot mode only): 0 = no FAILs, 1 = at least one FAIL.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { SCRAPER_REGISTRY } from './scrapers/index.js';
import { recordSuccess, recordZero, recordFailure, writeHealthFile } from './scraper-health.js';
import { atomicWriteFileSync } from './utils.js';
import { classifyAnomaly, findLatestDiagnostic, type AnomalyDiagnosis } from './vision-verify.js';
import type { CabinCode, FlightResult, SearchParams } from './types.js';

// ============================================================
// CONFIG
// ============================================================

/** Per-scraper-call hard timeout — a hung scraper is a FAIL, not a hang. */
const CANARY_TIMEOUT_MS = 120_000;

/** Default interval between loop iterations: 6 hours. */
const DEFAULT_LOOP_INTERVAL_S = 21_600;

/** Days into the future for the golden-route search date (computed, never hardcoded). */
const GOLDEN_DATE_OFFSET_DAYS = 45;

// Resolved from cwd (DATA_DIR env override, else ./data). The launchd agent and
// the npx invocation both set WorkingDirectory to the repo root, so cwd-relative
// is reliable here — and it avoids import.meta, which tsc rejects under NodeNext
// CommonJS output (matching staleness-check.ts, which also derives paths at runtime).
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const REPORT_PATH = path.join(DATA_DIR, 'canary-report.json');

/**
 * Today + GOLDEN_DATE_OFFSET_DAYS, formatted YYYY-MM-DD.
 * Computed fresh on every call so the canary never references a past date.
 */
function goldenDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + GOLDEN_DATE_OFFSET_DAYS);
  return d.toISOString().split('T')[0];
}

// ============================================================
// GOLDEN ROUTES
// ============================================================

interface GoldenRoute {
  origin: string;
  destination: string;
  cabin: CabinCode;
}

/**
 * Per-scraper-key route KNOWN to have award space. Only scrapers that have an
 * entry here AND are status==='active' in SCRAPER_REGISTRY get canaried — there
 * is no point regression-testing a scraper we already know is blocked.
 */
const GOLDEN_ROUTES: Record<string, GoldenRoute> = {
  aa: { origin: 'JFK', destination: 'LHR', cabin: 'business' },
  alaska: { origin: 'SEA', destination: 'LAX', cabin: 'economy' },
  jetblue: { origin: 'JFK', destination: 'LAX', cabin: 'economy' },
  cathay: { origin: 'JFK', destination: 'HKG', cabin: 'economy' },
};

// ============================================================
// TYPES
// ============================================================

type Verdict = 'PASS' | 'EMPTY' | 'FAIL';

interface CanaryResult {
  key: string;
  verdict: Verdict;
  count: number;
  ms: number;
  error?: string;
  diagnosis?: AnomalyDiagnosis; // vision classification (CANARY_VISION=1, on EMPTY/FAIL)
}

const DIAGNOSTIC_DIR = path.join(DATA_DIR, 'diagnostics');

interface PlannedRoute {
  key: string;
  name: string;
  route: string;
  cabin: CabinCode;
}

// ============================================================
// HELPERS
// ============================================================

function log(msg: string): void {
  console.error(`[canary ${new Date().toISOString()}] ${msg}`);
}

/**
 * The scrapers we will canary this run: those with a golden route AND
 * status==='active' in the registry. Returns the planned routes in registry
 * order for stable, readable output.
 */
function plannedRoutes(): PlannedRoute[] {
  const date = goldenDate();
  const planned: PlannedRoute[] = [];
  for (const key of Object.keys(GOLDEN_ROUTES)) {
    const entry = SCRAPER_REGISTRY[key];
    if (!entry || entry.status !== 'active') continue;
    const r = GOLDEN_ROUTES[key];
    planned.push({
      key,
      name: entry.name,
      route: `${r.origin}→${r.destination} on ${date}`,
      cabin: r.cabin,
    });
  }
  return planned;
}

/** Run one scraper against its golden route with a hard timeout. */
async function canaryOne(key: string, date: string): Promise<CanaryResult> {
  const entry = SCRAPER_REGISTRY[key];
  const route = GOLDEN_ROUTES[key];
  const params: SearchParams = {
    origin: route.origin,
    destination: route.destination,
    date,
    cabin: route.cabin,
  };

  const start = Date.now();
  try {
    const raw = await Promise.race([
      entry.search(params),
      new Promise<'TIMEOUT'>((resolve) =>
        setTimeout(() => resolve('TIMEOUT'), CANARY_TIMEOUT_MS),
      ),
    ]);
    const ms = Date.now() - start;

    if (raw === 'TIMEOUT') {
      recordFailure(key);
      return { key, verdict: 'FAIL', count: 0, ms, error: `timeout after ${CANARY_TIMEOUT_MS}ms` };
    }

    const results: FlightResult[] = Array.isArray(raw) ? raw : [];
    if (results.length === 0) {
      recordZero(key);
      return { key, verdict: 'EMPTY', count: 0, ms };
    }

    recordSuccess(key);
    return { key, verdict: 'PASS', count: results.length, ms };
  } catch (err: any) {
    const ms = Date.now() - start;
    recordFailure(key);
    return { key, verdict: 'FAIL', count: 0, ms, error: (err?.message || String(err)).slice(0, 300) };
  }
}

function printPlan(planned: PlannedRoute[]): void {
  console.log('\n=== CANARY PLAN (golden routes) ===');
  if (planned.length === 0) {
    console.log('  (no active scrapers with a golden route — nothing to canary)');
    return;
  }
  for (const p of planned) {
    console.log(`  ${p.key.padEnd(10)} ${p.name.padEnd(34)} ${p.route}  [${p.cabin}]`);
  }
  console.log('');
}

function printResults(results: CanaryResult[], date: string): void {
  const verdictColor: Record<Verdict, string> = {
    PASS: '\x1b[32mPASS\x1b[0m',
    EMPTY: '\x1b[33mEMPTY\x1b[0m',
    FAIL: '\x1b[31mFAIL\x1b[0m',
  };
  console.log('\n=== CANARY RESULTS ===');
  console.log(`  date: ${date}`);
  console.log(`  ${'scraper'.padEnd(12)} ${'verdict'.padEnd(7)} ${'count'.padEnd(7)} seconds`);
  console.log(`  ${'-'.repeat(12)} ${'-'.repeat(7)} ${'-'.repeat(7)} -------`);
  for (const r of results) {
    const secs = (r.ms / 1000).toFixed(1);
    const err = r.error ? `  ${r.error}` : '';
    // padEnd on the colorized verdict would miscount ANSI bytes — pad the plain
    // verdict separately so columns line up.
    console.log(`  ${r.key.padEnd(12)} ${verdictColor[r.verdict]}${' '.repeat(Math.max(0, 7 - r.verdict.length))} ${String(r.count).padEnd(7)} ${secs}${err}`);
  }
  const pass = results.filter((r) => r.verdict === 'PASS').length;
  const empty = results.filter((r) => r.verdict === 'EMPTY').length;
  const fail = results.filter((r) => r.verdict === 'FAIL').length;
  console.log(`\n  Totals: ${pass} pass, ${empty} empty, ${fail} fail`);
}

function writeReport(date: string, results: CanaryResult[]): void {
  const report = {
    testedAt: new Date().toISOString(),
    dateUsed: date,
    results: results.map((r) => ({
      key: r.key,
      verdict: r.verdict,
      count: r.count,
      ms: r.ms,
      error: r.error,
      diagnosis: r.diagnosis,
    })),
  };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    atomicWriteFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log(`Report written to ${REPORT_PATH}`);
  } catch (e: any) {
    log(`Could not write report: ${e.message}`);
  }
}

// ============================================================
// CANARY RUN
// ============================================================

/**
 * Run the canary once across all eligible golden routes.
 * Returns true if any verdict was FAIL.
 */
export async function runCanary(): Promise<boolean> {
  const date = goldenDate();
  const planned = plannedRoutes();

  if (process.env.CANARY_DRY === '1') {
    printPlan(planned);
    log('CANARY_DRY=1 — skipping live scraping. No network calls made.');
    return false;
  }

  if (planned.length === 0) {
    log('No active scrapers with a golden route — nothing to canary.');
    writeReport(date, []);
    return false;
  }

  log(`Canarying ${planned.length} scraper(s) for ${date}: ${planned.map((p) => p.key).join(', ')}`);

  const visionOn = process.env.CANARY_VISION === '1';
  const results: CanaryResult[] = [];
  for (const p of planned) {
    log(`→ ${p.key}: ${p.route} [${p.cabin}]`);
    const r = await canaryOne(p.key, date);
    log(`← ${p.key}: ${r.verdict} (${r.count} results, ${(r.ms / 1000).toFixed(1)}s)${r.error ? ` — ${r.error}` : ''}`);

    // On a non-PASS, classify WHY from the scraper's failure-time screenshot.
    // Gated behind CANARY_VISION so a missing API key never affects the core
    // regression. No-ops cleanly if no screenshot or no key.
    if (visionOn && r.verdict !== 'PASS') {
      const shot = findLatestDiagnostic(p.key, DIAGNOSTIC_DIR);
      if (shot) {
        const diagnosis = await classifyAnomaly(shot, `${p.name} ${p.route} [${p.cabin}]; scraper verdict ${r.verdict}`);
        if (diagnosis) {
          r.diagnosis = diagnosis;
          log(`  ⮑ vision: ${diagnosis.label} (conf ${diagnosis.confidence.toFixed(2)}) — ${diagnosis.evidence}`);
        }
      } else {
        log(`  ⮑ vision: no diagnostic screenshot found for ${p.key} (only CDP scrapers emit them)`);
      }
    }

    results.push(r);
  }

  printResults(results, date);

  // Persist health to DB (best-effort — needs DATABASE_URL).
  try {
    writeHealthFile();
  } catch (e: any) {
    log(`writeHealthFile failed (continuing): ${e.message}`);
  }

  writeReport(date, results);

  return results.some((r) => r.verdict === 'FAIL');
}

// ============================================================
// CLI / LOOP
// ============================================================

/** Parse `--loop` / `--loop=<seconds>` from argv. Returns interval in ms, or null if not present. */
function parseLoopInterval(argv: string[]): number | null {
  const arg = argv.find((a) => a === '--loop' || a.startsWith('--loop='));
  if (!arg) return null;
  if (arg === '--loop') return DEFAULT_LOOP_INTERVAL_S * 1000;
  const secs = Number(arg.split('=')[1]);
  if (!Number.isFinite(secs) || secs <= 0) {
    log(`Invalid --loop value "${arg}", using default ${DEFAULT_LOOP_INTERVAL_S}s.`);
    return DEFAULT_LOOP_INTERVAL_S * 1000;
  }
  return secs * 1000;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const loopMs = parseLoopInterval(argv);

  if (loopMs === null) {
    // One-shot: exit code reflects whether anything failed.
    const anyFail = await runCanary();
    process.exit(anyFail ? 1 : 0);
  }

  // Loop mode: run, sleep, repeat until SIGINT/SIGTERM.
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (sig: string) => {
    log(`Received ${sig} — exiting loop after current iteration.`);
    stopping = true;
    if (timer) clearTimeout(timer);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log(`Loop mode: canary every ${(loopMs / 1000).toFixed(0)}s. Ctrl-C to stop.`);
  while (!stopping) {
    try {
      await runCanary();
    } catch (e: any) {
      log(`Canary iteration crashed (continuing loop): ${e?.message || e}`);
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, loopMs);
    });
  }
  log('Loop stopped.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[canary] fatal:', err);
  process.exit(1);
});
