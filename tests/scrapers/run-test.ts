/**
 * Individual scraper tester — runs each active scraper sequentially,
 * captures results and errors, saves to data/flight-test-results.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { SearchParams, FlightResult } from '../types.js';
import { SCRAPER_REGISTRY } from './index.js';

const TEST_PARAMS: SearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  date: '2026-03-15',
  cabin: 'business',
  passengers: 1,
};

interface TestResult {
  scraper: string;
  name: string;
  registryStatus: string;
  status: 'success' | 'no-results' | 'error' | 'skipped';
  resultCount: number;
  errors: string[];
  sampleResults: Partial<FlightResult>[];
  durationMs: number;
}

async function testScraper(key: string): Promise<TestResult> {
  const entry = SCRAPER_REGISTRY[key];
  if (!entry) return { scraper: key, name: 'unknown', registryStatus: 'missing', status: 'error', resultCount: 0, errors: ['Not found in registry'], sampleResults: [], durationMs: 0 };

  if (entry.status === 'needs-login' || entry.status === 'blocked') {
    console.log(`\n⏭️  Skipping ${entry.name} [${entry.status}]`);
    return { scraper: key, name: entry.name, registryStatus: entry.status, status: 'skipped', resultCount: 0, errors: [], sampleResults: [], durationMs: 0 };
  }

  console.log(`\n🔍 Testing ${entry.name} [${entry.status}]...`);
  const start = Date.now();
  try {
    const results = await Promise.race([
      entry.search(TEST_PARAMS),
      new Promise<FlightResult[]>((_, reject) => setTimeout(() => reject(new Error('Timeout after 90s')), 90000)),
    ]);
    const duration = Date.now() - start;

    // Validate results
    const errors: string[] = [];
    for (const r of results.slice(0, 3)) {
      if (!r.airline && !r.flightNumber) errors.push('Missing airline AND flightNumber');
      if (!r.departureTime && !r.arrivalTime) errors.push('Missing times');
      if (!r.pointsRequired && !r.cashPrice) errors.push('Missing both points and cash price');
    }

    const sample = results.slice(0, 3).map(r => ({
      airline: r.airline,
      flightNumber: r.flightNumber,
      departureTime: r.departureTime,
      arrivalTime: r.arrivalTime,
      duration: r.duration,
      stops: r.stops,
      cabin: r.cabin,
      pointsRequired: r.pointsRequired,
      pointsProgram: r.pointsProgram,
      cashPrice: r.cashPrice,
      taxesAndFees: r.taxesAndFees,
    }));

    const icon = results.length > 0 ? '✅' : '⚠️';
    console.log(`${icon} ${entry.name}: ${results.length} results (${duration}ms)`);
    if (errors.length) console.log(`   ⚠️  Data issues: ${errors.join(', ')}`);
    sample.forEach((s, i) => console.log(`   [${i}] ${s.airline} ${s.flightNumber} | ${s.departureTime}-${s.arrivalTime} | ${s.pointsRequired || '$' + s.cashPrice} | ${s.stops} stops`));

    return {
      scraper: key,
      name: entry.name,
      registryStatus: entry.status,
      status: results.length > 0 ? 'success' : 'no-results',
      resultCount: results.length,
      errors,
      sampleResults: sample,
      durationMs: duration,
    };
  } catch (e: any) {
    const duration = Date.now() - start;
    console.log(`❌ ${entry.name}: FAILED (${duration}ms) — ${e.message}`);
    return {
      scraper: key,
      name: entry.name,
      registryStatus: entry.status,
      status: 'error',
      resultCount: 0,
      errors: [e.message],
      sampleResults: [],
      durationMs: duration,
    };
  }
}

async function main() {
  console.log('=== Flight Scraper E2E Test ===');
  console.log(`Route: ${TEST_PARAMS.origin} → ${TEST_PARAMS.destination} | ${TEST_PARAMS.date} | ${TEST_PARAMS.cabin}\n`);

  // Only test specific scraper if passed as arg
  const targetScraper = process.argv[2];
  const keys = targetScraper ? [targetScraper] : Object.keys(SCRAPER_REGISTRY);

  const results: TestResult[] = [];
  for (const key of keys) {
    const result = await testScraper(key);
    results.push(result);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'skipped' ? '⏭️' : r.status === 'no-results' ? '⚠️' : '❌';
    console.log(`${icon} ${r.name}: ${r.resultCount} results (${r.durationMs}ms) ${r.errors.length ? '— ' + r.errors[0] : ''}`);
  }

  // Save
  const dataDir = path.join(__dirname, '../../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, 'flight-test-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    searchParams: TEST_PARAMS,
    timestamp: new Date().toISOString(),
    results,
  }, null, 2));
  console.log(`\nSaved to ${outPath}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
