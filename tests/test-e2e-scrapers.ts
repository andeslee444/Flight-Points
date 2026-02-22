/**
 * E2E Scraper Test Suite
 *
 * Validates each scraper returns correct flight award data from live airline sites.
 * Empty results on known-availability routes = FAILURE.
 * Route matrix per scraper with data quality checks.
 *
 * Usage:
 *   npx tsx tests/test-e2e-scrapers.ts              # all 7 scrapers
 *   npx tsx tests/test-e2e-scrapers.ts delta aa      # specific scrapers
 *
 * Report saved to data/e2e-test-report.json
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCRAPER_REGISTRY } from '../src/flights/scrapers/index.js';
import type { FlightResult, SearchParams } from '../src/flights/types.js';

// ============================================================
// PATHS
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================
// TYPES
// ============================================================

interface RouteTestCase {
  origin: string;
  destination: string;
  cabin: 'economy' | 'business' | 'first';
  expectResults: boolean;
  reason: string;
}

interface ScraperE2EConfig {
  key: string;           // SCRAPER_REGISTRY key
  name: string;          // display name
  envVars: { name: string; required: boolean }[];
  expectedSources: string[];
  timeoutMs: number;
  routes: RouteTestCase[];
}

type TestStatus = 'PASS' | 'FAIL' | 'EMPTY_FAIL' | 'EMPTY_OK' | 'TIMEOUT' | 'ERROR' | 'SKIP';

interface DataQualityIssue {
  check: string;
  severity: 'error' | 'warning';
  message: string;
}

interface DataQualityReport {
  checked: number;
  passed: number;
  errors: number;
  warnings: number;
  issues: DataQualityIssue[];
}

interface RouteTestResult {
  scraperKey: string;
  route: string;
  cabin: string;
  expectResults: boolean;
  status: TestStatus;
  resultCount: number;
  durationMs: number;
  dateUsed: string;
  quality: DataQualityReport | null;
  error?: string;
  sampleResults?: Partial<FlightResult>[];
}

interface E2ETestReport {
  testedAt: string;
  dates: string[];
  scrapers: string[];
  results: RouteTestResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    emptyFail: number;
    emptyOk: number;
    timeout: number;
    error: number;
    skip: number;
  };
  totalDurationMs: number;
}

// ============================================================
// TEST DATES (today+30d and today+45d)
// ============================================================

function generateTestDates(): [string, string] {
  const d1 = new Date();
  d1.setDate(d1.getDate() + 30);
  const d2 = new Date();
  d2.setDate(d2.getDate() + 45);
  return [
    d1.toISOString().split('T')[0],
    d2.toISOString().split('T')[0],
  ];
}

// ============================================================
// SCRAPER CONFIGS (7 scrapers x 4 routes each)
// ============================================================

const SCRAPER_CONFIGS: ScraperE2EConfig[] = [
  // 1. Delta-VA (SkyTeam)
  {
    key: 'delta',
    name: 'Delta SkyMiles',
    envVars: [
      { name: 'VA_EMAIL', required: true },
      { name: 'VA_PASSWORD', required: true },
    ],
    expectedSources: ['virgin-atlantic'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'JFK', destination: 'LHR', cabin: 'business', expectResults: true, reason: 'VS daily, always has award space' },
      { origin: 'JFK', destination: 'CDG', cabin: 'economy', expectResults: true, reason: 'AF daily SkyTeam economy' },
      { origin: 'JFK', destination: 'NRT', cabin: 'business', expectResults: true, reason: 'DL daily transpacific' },
      { origin: 'ATL', destination: 'LAX', cabin: 'economy', expectResults: true, reason: 'DL hub-to-hub domestic' },
    ],
  },
  // 2. AA (oneworld)
  {
    key: 'aa',
    name: 'American AAdvantage',
    envVars: [],
    expectedSources: ['aa'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'JFK', destination: 'LHR', cabin: 'business', expectResults: true, reason: 'BA/AA flagship' },
      { origin: 'JFK', destination: 'NRT', cabin: 'business', expectResults: true, reason: 'JAL via oneworld' },
      { origin: 'DFW', destination: 'LAX', cabin: 'economy', expectResults: true, reason: 'AA hub domestic' },
      { origin: 'JFK', destination: 'HKG', cabin: 'first', expectResults: false, reason: 'CX first class very limited' },
    ],
  },
  // 3. SQ (Star Alliance)
  {
    key: 'singapore',
    name: 'Singapore Airlines KrisFlyer',
    envVars: [
      { name: 'SQ_KRISFLYER_ID', required: true },
      { name: 'SQ_KRISFLYER_PASSWORD', required: true },
    ],
    expectedSources: ['singapore'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'SIN', destination: 'NRT', cabin: 'business', expectResults: true, reason: 'SQ flagship route' },
      { origin: 'SIN', destination: 'LHR', cabin: 'business', expectResults: true, reason: 'SQ daily A380' },
      { origin: 'JFK', destination: 'SIN', cabin: 'business', expectResults: false, reason: 'Multi-stop, limited' },
      { origin: 'SIN', destination: 'SYD', cabin: 'economy', expectResults: true, reason: 'SQ multiple daily' },
    ],
  },
  // 4. United/Aeroplan (Star Alliance)
  {
    key: 'united',
    name: 'United MileagePlus / Aeroplan',
    envVars: [
      { name: 'AEROPLAN_USERNAME', required: true },
      { name: 'AEROPLAN_PASSWORD', required: true },
    ],
    expectedSources: ['aeroplan', 'united'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'JFK', destination: 'NRT', cabin: 'business', expectResults: true, reason: 'UA/ANA daily' },
      { origin: 'JFK', destination: 'LHR', cabin: 'economy', expectResults: true, reason: 'UA + LH always available' },
      { origin: 'SFO', destination: 'LAX', cabin: 'economy', expectResults: true, reason: 'UA domestic shuttle' },
      { origin: 'ORD', destination: 'FRA', cabin: 'business', expectResults: true, reason: 'LH daily nonstop' },
    ],
  },
  // 5. Flying Blue (SkyTeam)
  {
    key: 'flying-blue',
    name: 'Air France/KLM Flying Blue',
    envVars: [],
    expectedSources: ['flying-blue'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'JFK', destination: 'CDG', cabin: 'business', expectResults: true, reason: 'AF flagship' },
      { origin: 'JFK', destination: 'AMS', cabin: 'economy', expectResults: true, reason: 'KLM daily' },
      { origin: 'CDG', destination: 'NRT', cabin: 'business', expectResults: false, reason: 'AF long-haul, limited' },
      { origin: 'LAX', destination: 'CDG', cabin: 'economy', expectResults: true, reason: 'AF transatlantic' },
    ],
  },
  // 6. Alaska (oneworld + independent)
  {
    key: 'alaska',
    name: 'Alaska Mileage Plan',
    envVars: [],
    expectedSources: ['alaska'],
    timeoutMs: 120_000,
    routes: [
      { origin: 'JFK', destination: 'LHR', cabin: 'business', expectResults: true, reason: 'BA partner' },
      { origin: 'SEA', destination: 'LAX', cabin: 'economy', expectResults: true, reason: 'AS hub domestic' },
      { origin: 'JFK', destination: 'NRT', cabin: 'business', expectResults: false, reason: 'JAL, limited allocation' },
      { origin: 'JFK', destination: 'HKG', cabin: 'business', expectResults: false, reason: 'CX, may be limited' },
    ],
  },
  // 7. ANA (Star Alliance)
  {
    key: 'ana',
    name: 'ANA Mileage Club',
    envVars: [
      { name: 'ANA_USERNAME', required: true },
      { name: 'ANA_PASSWORD', required: true },
    ],
    expectedSources: ['ana'],
    timeoutMs: 180_000,
    routes: [
      { origin: 'JFK', destination: 'NRT', cabin: 'business', expectResults: true, reason: 'ANA flagship, near-guaranteed' },
      { origin: 'JFK', destination: 'HND', cabin: 'first', expectResults: false, reason: 'ANA first, very limited' },
      { origin: 'LAX', destination: 'NRT', cabin: 'economy', expectResults: true, reason: 'ANA daily transpacific' },
      { origin: 'NRT', destination: 'SIN', cabin: 'business', expectResults: false, reason: 'Star Alliance partner, varies' },
    ],
  },
];

// ============================================================
// DATA QUALITY CHECKS
// ============================================================

function runDataQualityChecks(
  results: FlightResult[],
  params: SearchParams,
  expectedSources: string[],
): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const toCheck = results.slice(0, 5);
  let totalChecks = 0;
  let passedChecks = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i];
    const tag = `result[${i}]`;

    // 1. Source match (error)
    totalChecks++;
    if (expectedSources.length > 0 && !expectedSources.includes(r.source)) {
      issues.push({ check: 'source', severity: 'error', message: `${tag}: source "${r.source}" not in expected [${expectedSources.join(', ')}]` });
    } else {
      passedChecks++;
    }

    // 2. Points > 0 (error)
    totalChecks++;
    if (!r.pointsRequired || r.pointsRequired <= 0) {
      issues.push({ check: 'points', severity: 'error', message: `${tag}: pointsRequired=${r.pointsRequired}` });
    } else {
      passedChecks++;
    }

    // 3. Cabin match (error)
    totalChecks++;
    if (r.cabin !== params.cabin) {
      issues.push({ check: 'cabin', severity: 'error', message: `${tag}: cabin "${r.cabin}" != expected "${params.cabin}"` });
    } else {
      passedChecks++;
    }

    // 4. Origin match (error)
    totalChecks++;
    if (r.origin !== params.origin) {
      issues.push({ check: 'origin', severity: 'error', message: `${tag}: origin "${r.origin}" != expected "${params.origin}"` });
    } else {
      passedChecks++;
    }

    // 5. Destination match (error)
    totalChecks++;
    if (r.destination !== params.destination) {
      issues.push({ check: 'destination', severity: 'error', message: `${tag}: destination "${r.destination}" != expected "${params.destination}"` });
    } else {
      passedChecks++;
    }

    // 6. Date valid & future (error)
    totalChecks++;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().split('T')[0];
    if (!r.departureDate || !dateRegex.test(r.departureDate) || r.departureDate < today) {
      issues.push({ check: 'date', severity: 'error', message: `${tag}: departureDate="${r.departureDate}" (invalid or past)` });
    } else {
      passedChecks++;
    }

    // 7. Airline non-empty (error)
    totalChecks++;
    if (!r.airline) {
      issues.push({ check: 'airline', severity: 'error', message: `${tag}: airline is empty` });
    } else {
      passedChecks++;
    }

    // 8. Flight number (warning)
    totalChecks++;
    if (!r.flightNumber) {
      issues.push({ check: 'flightNumber', severity: 'warning', message: `${tag}: flightNumber is empty` });
    } else {
      passedChecks++;
    }

    // 9. scrapedAt fresh (warning)
    totalChecks++;
    if (!r.scrapedAt) {
      issues.push({ check: 'scrapedAt', severity: 'warning', message: `${tag}: scrapedAt is empty` });
    } else {
      const scrapedDate = new Date(r.scrapedAt);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (isNaN(scrapedDate.getTime()) || scrapedDate < twoHoursAgo) {
        issues.push({ check: 'scrapedAt', severity: 'warning', message: `${tag}: scrapedAt="${r.scrapedAt}" (stale or invalid)` });
      } else {
        passedChecks++;
      }
    }

    // 10. Departure time (warning)
    totalChecks++;
    if (!r.departureTime) {
      issues.push({ check: 'departureTime', severity: 'warning', message: `${tag}: departureTime is empty` });
    } else {
      passedChecks++;
    }

    // 11. Duration (warning)
    totalChecks++;
    if (!r.duration) {
      issues.push({ check: 'duration', severity: 'warning', message: `${tag}: duration is empty` });
    } else {
      passedChecks++;
    }

    // 12. Stops >= 0 (warning)
    totalChecks++;
    if (r.stops === undefined || r.stops === null || r.stops < 0 || !Number.isInteger(r.stops)) {
      issues.push({ check: 'stops', severity: 'warning', message: `${tag}: stops=${r.stops} (missing or invalid)` });
    } else {
      passedChecks++;
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  return { checked: totalChecks, passed: passedChecks, errors, warnings, issues };
}

// ============================================================
// HELPERS
// ============================================================

function checkEnvVars(vars: ScraperE2EConfig['envVars']): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const v of vars) {
    if (v.required && !process.env[v.name]) {
      missing.push(v.name);
    }
  }
  return { ok: missing.length === 0, missing };
}

function maskValue(val: string | undefined): string {
  if (!val) return 'NOT SET';
  return val.substring(0, 3) + '***';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

// ANSI color helpers
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const STATUS_DISPLAY: Record<TestStatus, string> = {
  PASS: c.green('PASS      '),
  FAIL: c.red('FAIL      '),
  EMPTY_FAIL: c.red('EMPTY_FAIL'),
  EMPTY_OK: c.gray('EMPTY_OK  '),
  TIMEOUT: c.yellow('TIMEOUT   '),
  ERROR: c.red('ERROR     '),
  SKIP: c.gray('SKIP      '),
};

// ============================================================
// ROUTE TEST RUNNER
// ============================================================

async function runRouteTest(
  config: ScraperE2EConfig,
  route: RouteTestCase,
  dates: string[],
): Promise<RouteTestResult> {
  const entry = SCRAPER_REGISTRY[config.key];
  if (!entry) {
    return {
      scraperKey: config.key,
      route: `${route.origin}→${route.destination}`,
      cabin: route.cabin,
      expectResults: route.expectResults,
      status: 'ERROR',
      resultCount: 0,
      durationMs: 0,
      dateUsed: dates[0],
      quality: null,
      error: `Scraper "${config.key}" not found in SCRAPER_REGISTRY`,
    };
  }

  const start = Date.now();

  // Try date1, then date2 if empty
  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const params: SearchParams = {
      origin: route.origin,
      destination: route.destination,
      date,
      cabin: route.cabin,
    };

    try {
      const rawResults = await Promise.race([
        entry.search(params),
        new Promise<'TIMEOUT'>((resolve) =>
          setTimeout(() => resolve('TIMEOUT'), config.timeoutMs)
        ),
      ]);

      const durationMs = Date.now() - start;

      if (rawResults === 'TIMEOUT') {
        return {
          scraperKey: config.key,
          route: `${route.origin}→${route.destination}`,
          cabin: route.cabin,
          expectResults: route.expectResults,
          status: 'TIMEOUT',
          resultCount: 0,
          durationMs,
          dateUsed: date,
          quality: null,
          error: `Timed out after ${formatDuration(config.timeoutMs)}`,
        };
      }

      // Normalize results
      let results: FlightResult[];
      if (Array.isArray(rawResults)) {
        results = rawResults;
      } else if (rawResults && typeof rawResults === 'object' && 'flights' in rawResults) {
        results = (rawResults as any).flights || [];
      } else {
        results = [];
      }

      if (results.length === 0) {
        // If first date returned empty, try second date
        if (di < dates.length - 1) continue;

        return {
          scraperKey: config.key,
          route: `${route.origin}→${route.destination}`,
          cabin: route.cabin,
          expectResults: route.expectResults,
          status: route.expectResults ? 'EMPTY_FAIL' : 'EMPTY_OK',
          resultCount: 0,
          durationMs,
          dateUsed: date,
          quality: null,
        };
      }

      // Data quality checks
      const quality = runDataQualityChecks(results, params, config.expectedSources);
      const hasErrors = quality.errors > 0;

      const sampleResults = results.slice(0, 3).map(r => ({
        source: r.source,
        airline: r.airline,
        flightNumber: r.flightNumber,
        origin: r.origin,
        destination: r.destination,
        departureDate: r.departureDate,
        cabin: r.cabin,
        pointsRequired: r.pointsRequired,
      }));

      return {
        scraperKey: config.key,
        route: `${route.origin}→${route.destination}`,
        cabin: route.cabin,
        expectResults: route.expectResults,
        status: hasErrors ? 'FAIL' : 'PASS',
        resultCount: results.length,
        durationMs,
        dateUsed: date,
        quality,
        sampleResults,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      // If first date errored, try second date
      if (di < dates.length - 1) continue;

      return {
        scraperKey: config.key,
        route: `${route.origin}→${route.destination}`,
        cabin: route.cabin,
        expectResults: route.expectResults,
        status: 'ERROR',
        resultCount: 0,
        durationMs,
        dateUsed: dates[di],
        quality: null,
        error: (err.message || String(err)).slice(0, 500),
      };
    }
  }

  // Should not reach here, but just in case
  return {
    scraperKey: config.key,
    route: `${route.origin}→${route.destination}`,
    cabin: route.cabin,
    expectResults: route.expectResults,
    status: 'ERROR',
    resultCount: 0,
    durationMs: Date.now() - start,
    dateUsed: dates[0],
    quality: null,
    error: 'Unexpected: exhausted all dates without result',
  };
}

// ============================================================
// PRINT HELPERS
// ============================================================

function printRouteResult(r: RouteTestResult): void {
  const status = STATUS_DISPLAY[r.status];
  const route = `${r.route}`.padEnd(9);
  const cabin = r.cabin.padEnd(10);
  const count = r.resultCount > 0 ? `${r.resultCount} results`.padEnd(12) : '0 results'.padEnd(12);
  const dur = formatDuration(r.durationMs).padEnd(8);
  const qualStr = r.quality
    ? `quality: ${r.quality.passed}/${r.quality.checked}${r.quality.warnings > 0 ? ` (${r.quality.warnings}w)` : ''}`
    : '';
  console.log(`  ${status} ${route} ${cabin} ${count} ${dur} ${qualStr}`);

  // Print error details
  if (r.error) {
    console.log(`             ${c.red(r.error.slice(0, 120))}`);
  }

  // Print quality issues (only errors, limit 3)
  if (r.quality && r.quality.errors > 0) {
    const errorIssues = r.quality.issues.filter(i => i.severity === 'error').slice(0, 3);
    for (const issue of errorIssues) {
      console.log(`             ${c.red(`✗ ${issue.message}`)}`);
    }
  }
}

function printSummaryTable(allResults: RouteTestResult[]): void {
  const counts = {
    total: allResults.length,
    pass: allResults.filter(r => r.status === 'PASS').length,
    fail: allResults.filter(r => r.status === 'FAIL').length,
    emptyFail: allResults.filter(r => r.status === 'EMPTY_FAIL').length,
    emptyOk: allResults.filter(r => r.status === 'EMPTY_OK').length,
    timeout: allResults.filter(r => r.status === 'TIMEOUT').length,
    error: allResults.filter(r => r.status === 'ERROR').length,
    skip: allResults.filter(r => r.status === 'SKIP').length,
  };

  const sep = '='.repeat(64);
  console.log(`\n${sep}`);
  console.log(`  SUMMARY${' '.repeat(44)}${counts.total} tests`);
  console.log(sep);

  // Per-scraper summary
  const scraperKeys = [...new Set(allResults.map(r => r.scraperKey))];
  for (const key of scraperKeys) {
    const scraperResults = allResults.filter(r => r.scraperKey === key);
    const pass = scraperResults.filter(r => r.status === 'PASS').length;
    const fail = scraperResults.filter(r => ['FAIL', 'EMPTY_FAIL', 'ERROR', 'TIMEOUT'].includes(r.status)).length;
    const skip = scraperResults.filter(r => r.status === 'SKIP').length;
    const ok = scraperResults.filter(r => ['PASS', 'EMPTY_OK'].includes(r.status)).length;
    const icon = fail > 0 ? c.red('✗') : (skip === scraperResults.length ? c.gray('○') : c.green('✓'));
    console.log(`  ${icon} ${key.padEnd(16)} ${ok}/${scraperResults.length} ok${fail > 0 ? `  ${c.red(`${fail} failed`)}` : ''}${skip > 0 ? `  ${c.gray(`${skip} skipped`)}` : ''}`);
  }

  console.log('');
  const parts: string[] = [];
  if (counts.pass > 0) parts.push(c.green(`${counts.pass} PASS`));
  if (counts.emptyOk > 0) parts.push(c.gray(`${counts.emptyOk} EMPTY_OK`));
  if (counts.emptyFail > 0) parts.push(c.red(`${counts.emptyFail} EMPTY_FAIL`));
  if (counts.fail > 0) parts.push(c.red(`${counts.fail} FAIL`));
  if (counts.error > 0) parts.push(c.red(`${counts.error} ERROR`));
  if (counts.timeout > 0) parts.push(c.yellow(`${counts.timeout} TIMEOUT`));
  if (counts.skip > 0) parts.push(c.gray(`${counts.skip} SKIP`));
  console.log(`  ${parts.join(' | ')}`);

  const totalMs = allResults.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(`  Total time: ${formatDuration(totalMs)}`);

  return;
}

// ============================================================
// REPORT
// ============================================================

function saveReport(allResults: RouteTestResult[], dates: string[]): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const counts = {
    total: allResults.length,
    pass: allResults.filter(r => r.status === 'PASS').length,
    fail: allResults.filter(r => r.status === 'FAIL').length,
    emptyFail: allResults.filter(r => r.status === 'EMPTY_FAIL').length,
    emptyOk: allResults.filter(r => r.status === 'EMPTY_OK').length,
    timeout: allResults.filter(r => r.status === 'TIMEOUT').length,
    error: allResults.filter(r => r.status === 'ERROR').length,
    skip: allResults.filter(r => r.status === 'SKIP').length,
  };

  const report: E2ETestReport = {
    testedAt: new Date().toISOString(),
    dates,
    scrapers: [...new Set(allResults.map(r => r.scraperKey))],
    results: allResults,
    summary: counts,
    totalDurationMs: allResults.reduce((sum, r) => sum + r.durationMs, 0),
  };

  const reportPath = path.join(DATA_DIR, 'e2e-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dates = generateTestDates();

  // Filter scrapers by CLI args
  let configs: ScraperE2EConfig[];
  if (args.length > 0) {
    configs = SCRAPER_CONFIGS.filter(cfg =>
      args.some(arg => cfg.key.includes(arg) || cfg.key === arg)
    );
    if (configs.length === 0) {
      console.error(`No scrapers matched: ${args.join(', ')}`);
      console.error(`Available keys: ${SCRAPER_CONFIGS.map(c => c.key).join(', ')}`);
      process.exit(1);
    }
  } else {
    configs = SCRAPER_CONFIGS;
  }

  // Header
  const sep = '='.repeat(64);
  console.log(sep);
  console.log('  FLIGHT SCRAPER E2E TEST SUITE');
  console.log(sep);
  console.log(`  Dates:    ${dates[0]}, ${dates[1]}`);
  console.log(`  Scrapers: ${configs.length} (${configs.map(c => c.key).join(', ')})`);

  const allResults: RouteTestResult[] = [];

  // Run sequentially per scraper (browsers are heavy, shared proxy)
  for (const config of configs) {
    console.log(`\n${sep}`);

    // Credential summary line
    const credParts = config.envVars
      .filter(v => v.required)
      .map(v => `${v.name}: ${maskValue(process.env[v.name])}`)
      .join('  ');
    console.log(`  ${c.bold(config.name)} [${config.key}]${credParts ? ` — ${credParts}` : ''}`);
    console.log(sep);

    // Credential preflight
    const envCheck = checkEnvVars(config.envVars);
    if (!envCheck.ok) {
      console.log(c.gray(`  SKIPPED: missing required env vars: ${envCheck.missing.join(', ')}`));
      for (const route of config.routes) {
        const result: RouteTestResult = {
          scraperKey: config.key,
          route: `${route.origin}→${route.destination}`,
          cabin: route.cabin,
          expectResults: route.expectResults,
          status: 'SKIP',
          resultCount: 0,
          durationMs: 0,
          dateUsed: dates[0],
          quality: null,
          error: `Missing env vars: ${envCheck.missing.join(', ')}`,
        };
        allResults.push(result);
        printRouteResult(result);
      }
      continue;
    }

    // Run each route
    for (const route of config.routes) {
      const result = await runRouteTest(config, route, dates);
      allResults.push(result);
      printRouteResult(result);
    }
  }

  // Summary
  printSummaryTable(allResults);

  // Save report
  const reportPath = saveReport(allResults, dates);
  console.log(`  Report: ${reportPath}`);

  // Exit code
  const failures = allResults.filter(r =>
    ['FAIL', 'EMPTY_FAIL', 'ERROR', 'TIMEOUT'].includes(r.status)
  ).length;
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('E2E test runner crashed:', err);
  process.exit(1);
});
