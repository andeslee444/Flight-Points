/**
 * curl_cffi Scraper Tests
 *
 * Tests the curl_cffi-based scrapers (Delta/VA, SQ).
 *
 * Usage:
 *   npx tsx tests/test-curlffi-scrapers.ts              # Run all
 *   npx tsx tests/test-curlffi-scrapers.ts delta-va      # Delta/VA only
 *   npx tsx tests/test-curlffi-scrapers.ts sq             # SQ only
 */

import 'dotenv/config';
import { SearchParams, FlightResult } from '../src/flights/types.js';
import { searchDeltaViaCurlFfi } from '../src/flights/scrapers/delta-va-curlffi.js';
import { searchSQCurlFfi } from '../src/flights/scrapers/sq-curlffi.js';

const filter = process.argv[2]?.toLowerCase() || '';

interface TestCase {
  name: string;
  search: (params: SearchParams) => Promise<FlightResult[]>;
  params: SearchParams;
  filter: string;
}

// Generate a date ~30 days from now
function futureDate(daysOut: number = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().split('T')[0];
}

const tests: TestCase[] = [
  {
    name: 'Delta/VA CurlFfi — JFK→LHR Business',
    search: searchDeltaViaCurlFfi,
    params: { origin: 'JFK', destination: 'LHR', date: futureDate(30), cabin: 'business' },
    filter: 'delta-va',
  },
  {
    name: 'Delta/VA CurlFfi — LAX→NRT Economy',
    search: searchDeltaViaCurlFfi,
    params: { origin: 'LAX', destination: 'NRT', date: futureDate(45), cabin: 'economy' },
    filter: 'delta-va',
  },
  {
    name: 'SQ CurlFfi — SIN→NRT Business',
    search: searchSQCurlFfi,
    params: { origin: 'SIN', destination: 'NRT', date: futureDate(30), cabin: 'business' },
    filter: 'sq',
  },
  {
    name: 'SQ CurlFfi — SIN→LHR Economy',
    search: searchSQCurlFfi,
    params: { origin: 'SIN', destination: 'LHR', date: futureDate(45), cabin: 'economy' },
    filter: 'sq',
  },
];

async function runTest(tc: TestCase): Promise<{ pass: boolean; count: number; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const results = await tc.search(tc.params);
    const ms = Date.now() - start;
    const pass = results.length > 0;

    // Validate result structure
    for (const r of results.slice(0, 3)) {
      if (!r.source || !r.airline || !r.origin || !r.destination || !r.departureDate) {
        return { pass: false, count: results.length, ms, error: 'Missing required fields' };
      }
      if (r.pointsRequired !== undefined && r.pointsRequired <= 0) {
        console.warn(`  Warning: pointsRequired=${r.pointsRequired} for ${r.airline} ${r.flightNumber}`);
      }
    }

    return { pass, count: results.length, ms };
  } catch (err: any) {
    return { pass: false, count: 0, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  console.log('=== curl_cffi Scraper Tests ===\n');

  const filtered = filter ? tests.filter(t => t.filter === filter) : tests;
  if (filtered.length === 0) {
    console.log(`No tests matching filter: "${filter}"`);
    console.log(`Available filters: ${[...new Set(tests.map(t => t.filter))].join(', ')}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const tc of filtered) {
    console.log(`\nTest: ${tc.name}`);
    console.log(`  Params: ${tc.params.origin}→${tc.params.destination} ${tc.params.date} ${tc.params.cabin}`);

    const result = await runTest(tc);

    if (result.pass) {
      console.log(`  PASS: ${result.count} results in ${(result.ms / 1000).toFixed(1)}s`);
      passed++;
    } else {
      console.log(`  FAIL: ${result.count} results in ${(result.ms / 1000).toFixed(1)}s${result.error ? ` — ${result.error}` : ''}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
