/**
 * Test all flight scrapers
 * Run: npx tsx src/flights/scrapers/test-scrapers.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { SearchParams, FlightResult } from '../types.js';
import { SCRAPERS, getScraperStatus } from './index.js';

const TEST_PARAMS: SearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  date: '2026-03-15',
  cabin: 'business',
  passengers: 1,
};

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface ScraperTestResult {
  scraper: string;
  name: string;
  status: string;
  resultsCount: number;
  results: FlightResult[];
  error?: string;
  durationMs: number;
}

async function main() {
  console.log('=== Flight Scraper Tests ===');
  console.log(`Route: ${TEST_PARAMS.origin} → ${TEST_PARAMS.destination}`);
  console.log(`Date: ${TEST_PARAMS.date}`);
  console.log(`Cabin: ${TEST_PARAMS.cabin}`);
  console.log('');

  // Show status summary
  console.log('--- Scraper Status ---');
  const status = getScraperStatus();
  for (const [key, s] of Object.entries(status)) {
    const icon = s.status === 'active' ? '✅' : s.status === 'blocked' ? '❌' : '⚠️';
    console.log(`  ${icon} ${key}: ${s.name} [${s.status}] ${s.partners ? '(shows partners)' : ''}`);
  }
  console.log('');

  const allResults: FlightResult[] = [];
  const testResults: ScraperTestResult[] = [];

  // Test only active scrapers
  const activeScrapers = Object.entries(SCRAPERS).filter(([_, s]) => s.status === 'active');

  for (const [key, scraper] of activeScrapers) {
    console.log(`\n--- Testing ${scraper.name} ---`);
    const start = Date.now();

    try {
      const results = await scraper.search(TEST_PARAMS);
      const duration = Date.now() - start;

      console.log(`${scraper.name}: ${results.length} results (${duration}ms)`);
      results.forEach(r => {
        console.log(`  ${r.airline} ${r.flightNumber} | ${r.departureTime}-${r.arrivalTime} | ${r.pointsRequired} ${r.pointsProgram || 'pts'} | $${r.taxesAndFees || 0} taxes | ${r.stops} stops`);
      });

      allResults.push(...results);
      testResults.push({
        scraper: key,
        name: scraper.name,
        status: results.length > 0 ? 'success' : 'no-results',
        resultsCount: results.length,
        results,
        durationMs: duration,
      });
    } catch (e: any) {
      const duration = Date.now() - start;
      console.error(`${scraper.name} FAILED: ${e.message}`);
      testResults.push({
        scraper: key,
        name: scraper.name,
        status: 'error',
        resultsCount: 0,
        results: [],
        error: e.message,
        durationMs: duration,
      });
    }

    await delay(5000);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total scrapers tested: ${activeScrapers.length}`);
  console.log(`Total results: ${allResults.length}`);
  for (const t of testResults) {
    const icon = t.status === 'success' ? '✅' : t.status === 'no-results' ? '⚠️' : '❌';
    console.log(`  ${icon} ${t.name}: ${t.resultsCount} results (${t.durationMs}ms) ${t.error || ''}`);
  }

  // Save results
  const dataDir = path.join(__dirname, '../../../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const outputPath = path.join(dataDir, 'flight-scraper-tests.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    searchParams: TEST_PARAMS,
    timestamp: new Date().toISOString(),
    totalResults: allResults.length,
    scraperResults: testResults,
    results: allResults,
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  process.exit(0);
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
