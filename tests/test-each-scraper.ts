/**
 * Comprehensive Per-Scraper Test Runner
 *
 * Tests every scraper individually with proper timeouts, credential checks,
 * and data quality validation.
 *
 * Usage:
 *   npx tsx tests/test-each-scraper.ts          # run all
 *   npx tsx tests/test-each-scraper.ts aa        # run one by key
 *   npx tsx tests/test-each-scraper.ts delta united  # run several
 *
 * Report saved to data/scraper-test-report.json
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// --- Correct imports from tests/ directory ---
import { searchAA } from '../src/flights/scrapers/aa.js';
import { searchANA } from '../src/flights/scrapers/ana.js';
import { searchSQCamoufox } from '../src/flights/scrapers/sq-camoufox.js';
import { searchBAAvios } from '../src/flights/scrapers/ba-avios.js';
import { searchDelta } from '../src/flights/scrapers/delta.js';
import { searchDeltaViaCamoufox } from '../src/flights/scrapers/delta-va-camoufox.js';
import { searchUnited } from '../src/flights/scrapers/united.js';
import { searchUnitedViaAeroplan } from '../src/flights/scrapers/united-aeroplan-camoufox.js';
import { searchVirginAtlantic } from '../src/flights/scrapers/virgin-atlantic.js';
import { searchFlyingBlue } from '../src/flights/scrapers/flying-blue.js';
import { searchAlaska } from '../src/flights/scrapers/alaska.js';
import { searchJetBlue } from '../src/flights/scrapers/jetblue.js';
import { searchCathay } from '../src/flights/scrapers/cathay.js';
import { searchGoogleFlights } from '../src/flights/scrapers/google-flights.js';
import { searchSingaporeAirlines } from '../src/flights/scrapers/singapore.js';
import type { FlightResult, SearchParams } from '../src/flights/types.js';

// ============================================================
// CONFIG
// ============================================================

const TIMEOUT_MS = 120_000; // 120s per scraper

// Future date: today + 30 days
const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 30);
const TEST_DATE = futureDate.toISOString().split('T')[0]; // YYYY-MM-DD

const TEST_PARAMS: SearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  date: TEST_DATE,
  cabin: 'business',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================
// SCRAPER DEFINITIONS (ordered for testing)
// ============================================================

interface ScraperTest {
  key: string;
  name: string;
  path: 'camoufox' | 'playwright' | 'api' | 'hybrid';
  search: (params: SearchParams) => Promise<FlightResult[] | any>;
  envVars: { name: string; required: boolean }[];
  notes?: string;
}

const SCRAPER_TESTS: ScraperTest[] = [
  // 1. AA — fast sanity check
  {
    key: 'aa',
    name: 'American AAdvantage',
    path: 'api',
    search: searchAA,
    envVars: [{ name: 'PROXY_URL', required: false }],
    notes: 'Direct URL with slices param, usually fast',
  },
  // 2. ANA — Camoufox
  {
    key: 'ana',
    name: 'ANA Mileage Club (Camoufox)',
    path: 'camoufox',
    search: searchANA,
    envVars: [
      { name: 'ANA_USERNAME', required: true },
      { name: 'ANA_PASSWORD', required: true },
    ],
  },
  // 3. SQ — Camoufox
  {
    key: 'sq',
    name: 'Singapore Airlines KrisFlyer (Camoufox)',
    path: 'camoufox',
    search: searchSQCamoufox,
    envVars: [
      { name: 'SQ_KRISFLYER_ID', required: false },
      { name: 'SQ_KRISFLYER_PASSWORD', required: false },
    ],
  },
  // 4. BA — Camoufox
  {
    key: 'ba',
    name: 'British Airways Avios',
    path: 'camoufox',
    search: searchBAAvios,
    envVars: [
      { name: 'BA_EXEC_CLUB_NUMBER', required: false },
      { name: 'BA_EXEC_CLUB_PASSWORD', required: false },
      { name: 'PROXY_URL', required: false },
    ],
    notes: 'Akamai blocks frequently',
  },
  // 5. Delta — Camoufox path only
  {
    key: 'delta-camoufox',
    name: 'Delta SkyMiles (via Delta-VA Camoufox)',
    path: 'camoufox',
    search: searchDeltaViaCamoufox,
    envVars: [],
    notes: 'NEW: Delta-VA Camoufox path',
  },
  // 5b. Delta — Playwright fallback
  {
    key: 'delta-playwright',
    name: 'Delta SkyMiles (Playwright fallback)',
    path: 'playwright',
    search: searchDelta,
    envVars: [{ name: 'PROXY_URL', required: false }],
    notes: 'playwright-extra + StealthPlugin',
  },
  // 6. United — Aeroplan Camoufox path only
  {
    key: 'united-aeroplan',
    name: 'United via Aeroplan (Camoufox)',
    path: 'camoufox',
    search: searchUnitedViaAeroplan,
    envVars: [
      { name: 'AEROPLAN_USERNAME', required: true },
      { name: 'AEROPLAN_PASSWORD', required: true },
    ],
    notes: 'NEW: Aeroplan Camoufox path',
  },
  // 6b. United — Playwright fallback
  {
    key: 'united-playwright',
    name: 'United MileagePlus (Playwright fallback)',
    path: 'playwright',
    search: searchUnited,
    envVars: [
      { name: 'SEATS_AERO_API_KEY', required: false },
      { name: 'PROXY_URL', required: false },
    ],
  },
  // 7. Virgin Atlantic — Camoufox reuses Delta-VA
  {
    key: 'virgin-camoufox',
    name: 'Virgin Atlantic (via Delta-VA Camoufox)',
    path: 'camoufox',
    search: searchDeltaViaCamoufox,
    envVars: [],
    notes: 'Reuses Delta-VA Camoufox; results may include Delta metal',
  },
  // 7b. Virgin Atlantic — Playwright fallback
  {
    key: 'virgin-playwright',
    name: 'Virgin Atlantic (Playwright fallback)',
    path: 'playwright',
    search: searchVirginAtlantic,
    envVars: [{ name: 'PROXY_URL', required: false }],
    notes: 'playwright-extra + StealthPlugin',
  },
  // 8. Flying Blue
  {
    key: 'flying-blue',
    name: 'Air France/KLM Flying Blue',
    path: 'playwright',
    search: searchFlyingBlue,
    envVars: [{ name: 'PROXY_URL', required: false }],
    notes: 'NEW: playwright-extra upgrade',
  },
  // 9. Alaska
  {
    key: 'alaska',
    name: 'Alaska Mileage Plan',
    path: 'playwright',
    search: searchAlaska,
    envVars: [{ name: 'PROXY_URL', required: false }],
    notes: 'NEW: playwright-extra upgrade',
  },
  // 10. JetBlue
  {
    key: 'jetblue',
    name: 'JetBlue TrueBlue',
    path: 'api',
    search: searchJetBlue,
    envVars: [],
    notes: 'Simple, no anti-bot. JFK→NRT unlikely to have results (domestic carrier)',
  },
  // 11. Cathay
  {
    key: 'cathay',
    name: 'Cathay Pacific Asia Miles',
    path: 'api',
    search: searchCathay,
    envVars: [{ name: 'SEATS_AERO_API_KEY', required: false }],
    notes: 'seats.aero API',
  },
  // 12. Google Flights
  {
    key: 'google-flights',
    name: 'Google Flights (cash prices)',
    path: 'playwright',
    search: searchGoogleFlights,
    envVars: [],
  },
];

// ============================================================
// TEST RESULT TYPE
// ============================================================

interface TestResult {
  key: string;
  name: string;
  path: string;
  status: 'pass' | 'empty' | 'fail' | 'timeout' | 'skipped';
  resultCount: number;
  durationMs: number;
  sampleResults: Partial<FlightResult>[];
  dataQuality: DataQualityReport | null;
  error?: string;
  notes?: string;
}

interface DataQualityReport {
  hasAirline: boolean;
  hasFlightNumber: boolean;
  hasPoints: boolean;
  hasCabin: boolean;
  hasDates: boolean;
  hasTimes: boolean;
  issues: string[];
}

// ============================================================
// HELPERS
// ============================================================

function checkEnvVars(vars: ScraperTest['envVars']): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const v of vars) {
    const val = process.env[v.name];
    if (v.required && !val) {
      missing.push(v.name);
    }
  }
  return { ok: missing.length === 0, missing };
}

function printEnvStatus(vars: ScraperTest['envVars']): void {
  if (vars.length === 0) {
    console.log('  Env vars: none needed');
    return;
  }
  for (const v of vars) {
    const val = process.env[v.name];
    const icon = val ? '\x1b[32m✓\x1b[0m' : (v.required ? '\x1b[31m✗\x1b[0m' : '\x1b[33m-\x1b[0m');
    const label = v.required ? '(required)' : '(optional)';
    const masked = val ? `${val.substring(0, 3)}***` : 'NOT SET';
    console.log(`  ${icon} ${v.name} ${label}: ${masked}`);
  }
}

function validateResults(results: FlightResult[]): DataQualityReport {
  const issues: string[] = [];
  let hasAirline = true, hasFlightNumber = true, hasPoints = true;
  let hasCabin = true, hasDates = true, hasTimes = true;

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    if (!r.airline) { hasAirline = false; issues.push(`result[${i}]: missing airline`); }
    if (!r.flightNumber) { hasFlightNumber = false; issues.push(`result[${i}]: missing flightNumber`); }
    if (!r.pointsRequired && !r.cashPrice) { hasPoints = false; issues.push(`result[${i}]: missing points & cash`); }
    if (!r.cabin) { hasCabin = false; issues.push(`result[${i}]: missing cabin`); }
    if (!r.departureDate) { hasDates = false; issues.push(`result[${i}]: missing departureDate`); }
    if (!r.departureTime) { hasTimes = false; issues.push(`result[${i}]: missing departureTime`); }
  }

  return { hasAirline, hasFlightNumber, hasPoints, hasCabin, hasDates, hasTimes, issues };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSampleResults(results: FlightResult[], max: number = 3): void {
  const samples = results.slice(0, max);
  for (const r of samples) {
    const pts = r.pointsRequired ? `${r.pointsRequired.toLocaleString()} pts` : (r.cashPrice ? `$${r.cashPrice}` : 'no price');
    const time = r.departureTime ? `dep ${r.departureTime}` : '';
    const stops = r.stops !== undefined ? `${r.stops} stop${r.stops !== 1 ? 's' : ''}` : '';
    console.log(`    ${r.source || '?'} | ${r.airline || '?'} ${r.flightNumber || '?'} | ${r.cabin || '?'} | ${pts} | ${time} ${stops}`);
  }
}

// ============================================================
// TEST RUNNER
// ============================================================

async function runScraperTest(scraper: ScraperTest): Promise<TestResult> {
  const separator = '='.repeat(60);
  console.log(`\n${separator}`);
  console.log(`  ${scraper.name} [${scraper.key}] — ${scraper.path}`);
  if (scraper.notes) console.log(`  Note: ${scraper.notes}`);
  console.log(separator);

  // Check credentials
  printEnvStatus(scraper.envVars);
  const envCheck = checkEnvVars(scraper.envVars);
  if (!envCheck.ok) {
    console.log(`\x1b[31m  SKIPPED: missing required env vars: ${envCheck.missing.join(', ')}\x1b[0m`);
    return {
      key: scraper.key,
      name: scraper.name,
      path: scraper.path,
      status: 'skipped',
      resultCount: 0,
      durationMs: 0,
      sampleResults: [],
      dataQuality: null,
      error: `Missing env vars: ${envCheck.missing.join(', ')}`,
    };
  }

  const start = Date.now();

  try {
    // Race the scraper against a timeout
    const rawResults = await Promise.race([
      scraper.search(TEST_PARAMS),
      new Promise<'TIMEOUT'>((resolve) =>
        setTimeout(() => resolve('TIMEOUT'), TIMEOUT_MS)
      ),
    ]);

    const durationMs = Date.now() - start;

    if (rawResults === 'TIMEOUT') {
      console.log(`\x1b[33m  TIMEOUT after ${formatDuration(TIMEOUT_MS)}\x1b[0m`);
      return {
        key: scraper.key, name: scraper.name, path: scraper.path,
        status: 'timeout', resultCount: 0, durationMs, sampleResults: [], dataQuality: null,
        error: `Timed out after ${TIMEOUT_MS}ms`,
      };
    }

    // Normalize: some scrapers return { flights: [...] } instead of FlightResult[]
    let results: FlightResult[];
    if (Array.isArray(rawResults)) {
      results = rawResults;
    } else if (rawResults && typeof rawResults === 'object' && 'flights' in rawResults) {
      results = (rawResults as any).flights || [];
    } else {
      results = [];
    }

    if (results.length === 0) {
      console.log(`\x1b[33m  EMPTY — 0 results in ${formatDuration(durationMs)} (no availability or blocked)\x1b[0m`);
      return {
        key: scraper.key, name: scraper.name, path: scraper.path,
        status: 'empty', resultCount: 0, durationMs, sampleResults: [], dataQuality: null,
      };
    }

    // Validate data quality
    const quality = validateResults(results);
    const qualityIcon = quality.issues.length === 0 ? '\x1b[32m✓\x1b[0m' : `\x1b[33m⚠ ${quality.issues.length} issues\x1b[0m`;

    console.log(`\x1b[32m  PASS — ${results.length} results in ${formatDuration(durationMs)}  data quality: ${qualityIcon}\x1b[0m`);
    printSampleResults(results);

    if (quality.issues.length > 0) {
      console.log('  Data quality issues:');
      for (const issue of quality.issues.slice(0, 5)) {
        console.log(`    - ${issue}`);
      }
    }

    // Build sample (strip verbose fields for the report)
    const sampleResults = results.slice(0, 3).map(r => ({
      source: r.source,
      airline: r.airline,
      flightNumber: r.flightNumber,
      origin: r.origin,
      destination: r.destination,
      departureDate: r.departureDate,
      departureTime: r.departureTime,
      cabin: r.cabin,
      pointsRequired: r.pointsRequired,
      cashPrice: r.cashPrice,
      stops: r.stops,
      awardType: r.awardType,
    }));

    return {
      key: scraper.key, name: scraper.name, path: scraper.path,
      status: 'pass', resultCount: results.length, durationMs, sampleResults, dataQuality: quality,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const msg = err.message || String(err);
    console.log(`\x1b[31m  FAIL in ${formatDuration(durationMs)}: ${msg.slice(0, 200)}\x1b[0m`);
    return {
      key: scraper.key, name: scraper.name, path: scraper.path,
      status: 'fail', resultCount: 0, durationMs, sampleResults: [], dataQuality: null,
      error: msg.slice(0, 500),
    };
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  let testsToRun: ScraperTest[];

  if (args.length > 0) {
    // Filter to requested scrapers (partial match on key)
    testsToRun = SCRAPER_TESTS.filter(s =>
      args.some(arg => s.key.includes(arg) || s.key === arg)
    );
    if (testsToRun.length === 0) {
      console.error(`No scrapers matched: ${args.join(', ')}`);
      console.error(`Available keys: ${SCRAPER_TESTS.map(s => s.key).join(', ')}`);
      process.exit(1);
    }
  } else {
    testsToRun = SCRAPER_TESTS;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         FLIGHT SCRAPER TEST SUITE                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Route:   ${TEST_PARAMS.origin} → ${TEST_PARAMS.destination}`);
  console.log(`  Date:    ${TEST_PARAMS.date} (today + 30 days)`);
  console.log(`  Cabin:   ${TEST_PARAMS.cabin}`);
  console.log(`  Timeout: ${TIMEOUT_MS / 1000}s per scraper`);
  console.log(`  Testing: ${testsToRun.length} scraper(s): ${testsToRun.map(s => s.key).join(', ')}`);

  const allResults: TestResult[] = [];

  for (const scraper of testsToRun) {
    const result = await runScraperTest(scraper);
    allResults.push(result);
  }

  // ============================================================
  // SUMMARY TABLE
  // ============================================================

  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));

  const statusIcons: Record<string, string> = {
    pass: '\x1b[32mPASS\x1b[0m',
    empty: '\x1b[33mEMPTY\x1b[0m',
    fail: '\x1b[31mFAIL\x1b[0m',
    timeout: '\x1b[33mTIMEOUT\x1b[0m',
    skipped: '\x1b[90mSKIPPED\x1b[0m',
  };

  for (const r of allResults) {
    const status = statusIcons[r.status] || r.status;
    const count = r.resultCount > 0 ? `${r.resultCount} results` : '';
    const dur = r.durationMs > 0 ? formatDuration(r.durationMs) : '';
    const err = r.error ? `  ${r.error.slice(0, 60)}` : '';
    console.log(`  ${status}  ${r.key.padEnd(22)} ${count.padEnd(14)} ${dur.padEnd(8)} ${err}`);
  }

  // Counts
  const counts = {
    pass: allResults.filter(r => r.status === 'pass').length,
    empty: allResults.filter(r => r.status === 'empty').length,
    fail: allResults.filter(r => r.status === 'fail').length,
    timeout: allResults.filter(r => r.status === 'timeout').length,
    skipped: allResults.filter(r => r.status === 'skipped').length,
  };
  console.log(`\n  Totals: ${counts.pass} pass, ${counts.empty} empty, ${counts.fail} fail, ${counts.timeout} timeout, ${counts.skipped} skipped`);
  const totalDuration = allResults.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(`  Total time: ${formatDuration(totalDuration)}`);

  // ============================================================
  // SAVE REPORT
  // ============================================================

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const reportPath = path.join(DATA_DIR, 'scraper-test-report.json');
  const report = {
    testParams: TEST_PARAMS,
    testedAt: new Date().toISOString(),
    totalDurationMs: totalDuration,
    summary: counts,
    results: allResults,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: ${reportPath}`);

  // Exit with error code if any required scrapers failed
  if (counts.fail > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
