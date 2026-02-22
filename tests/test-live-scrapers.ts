/**
 * E2E test: Run the actual working scrapers and verify results.
 * Tests Delta/VA (curl_cffi) and Alaska (curl_cffi) through the Oracle VPS proxy.
 */

import 'dotenv/config';
import { SCRAPER_REGISTRY } from '../src/flights/scrapers/index.js';
import type { SearchParams, FlightResult } from '../src/flights/types.js';

const tests = [
  { key: 'delta', params: { origin: 'JFK', destination: 'LHR', date: '2026-04-15', cabin: 'business' as const } },
  { key: 'alaska', params: { origin: 'SEA', destination: 'LAX', date: '2026-04-15', cabin: 'economy' as const } },
  { key: 'cathay', params: { origin: 'JFK', destination: 'HKG', date: '2026-04-15', cabin: 'economy' as const } },
];

async function runTest(key: string, params: SearchParams) {
  const entry = SCRAPER_REGISTRY[key];
  if (!entry) {
    console.log(`❌ ${key}: not found in registry`);
    return;
  }
  if (entry.status === 'blocked') {
    console.log(`⏭️  ${key}: skipped (blocked)`);
    return;
  }

  console.log(`🔍 ${key}: ${params.origin}→${params.destination} ${params.date} ${params.cabin}...`);
  const start = Date.now();

  try {
    const results = await Promise.race([
      entry.search(params),
      new Promise<FlightResult[]>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 90s')), 90_000)
      ),
    ]);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (results.length > 0) {
      console.log(`✅ ${key}: ${results.length} results in ${elapsed}s`);
      // Show first 3 results
      for (const r of results.slice(0, 3)) {
        console.log(`   ${r.airline} ${r.flightNumber} ${r.departureTime} ${r.pointsRequired}pts ${r.cabin}`);
      }
    } else {
      console.log(`⚠️  ${key}: 0 results in ${elapsed}s`);
    }
  } catch (err: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`❌ ${key}: ${err.message} (${elapsed}s)`);
  }
}

async function main() {
  console.log('=== Live Scraper E2E Test ===');
  console.log(`PROXY_URL: ${process.env.PROXY_URL || 'direct'}`);
  console.log(`VA_EMAIL: ${process.env.VA_EMAIL ? 'set' : 'missing'}`);
  console.log();

  for (const { key, params } of tests) {
    await runTest(key, params);
    console.log();
  }

  console.log('=== Done ===');
}

main().catch(console.error);
