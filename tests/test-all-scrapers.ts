/**
 * Test All Flight Scrapers
 *
 * Tests each scraper with JFK → NRT, today + 45 days, Business
 * Saves report to data/scraper-test-report.json
 *
 * Run: npx tsx tests/test-all-scrapers.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { SCRAPER_REGISTRY } from '../src/flights/scrapers/index.js';
import type { SearchParams } from '../src/flights/types.js';

const DATA_DIR = path.join(__dirname, '../data');

// Dynamic test date: today + 45 days (YYYY-MM-DD)
const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 45);
const TEST_DATE = futureDate.toISOString().split('T')[0];

const TEST_PARAMS: SearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  date: TEST_DATE,
  cabin: 'business',
};

interface ScraperTestResult {
  scraper: string;
  name: string;
  status: 'success' | 'empty' | 'error' | 'blocked';
  resultCount: number;
  sampleData: any | null;
  durationMs: number;
  error?: string;
}

async function testScraper(key: string): Promise<ScraperTestResult> {
  const entry = SCRAPER_REGISTRY[key];
  if (!entry) {
    return { scraper: key, name: 'Unknown', status: 'error', resultCount: 0, sampleData: null, durationMs: 0, error: 'Not found in registry' };
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${entry.name} (${key}) — status: ${entry.status}`);
  console.log(`${'='.repeat(50)}`);

  const start = Date.now();
  try {
    const results = await entry.search(TEST_PARAMS);
    const durationMs = Date.now() - start;

    if (results.length === 0) {
      console.log(`⚠️  ${key}: No results (may be blocked or no availability)`);
      return { scraper: key, name: entry.name, status: 'empty', resultCount: 0, sampleData: null, durationMs };
    }

    console.log(`✅ ${key}: ${results.length} results in ${durationMs}ms`);
    console.log(`   Sample:`, JSON.stringify(results[0], null, 2).slice(0, 300));

    return {
      scraper: key,
      name: entry.name,
      status: 'success',
      resultCount: results.length,
      sampleData: results[0],
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`❌ ${key}: Error — ${err.message}`);
    return {
      scraper: key,
      name: entry.name,
      status: 'error',
      resultCount: 0,
      sampleData: null,
      durationMs,
      error: err.message,
    };
  }
}

async function main() {
  console.log('🧪 Testing All Flight Scrapers');
  console.log(`Test route: ${TEST_PARAMS.origin} → ${TEST_PARAMS.destination}`);
  console.log(`Date: ${TEST_PARAMS.date} | Cabin: ${TEST_PARAMS.cabin}`);
  console.log(`Scrapers: ${Object.keys(SCRAPER_REGISTRY).join(', ')}`);

  const results: ScraperTestResult[] = [];

  for (const key of Object.keys(SCRAPER_REGISTRY)) {
    const result = await testScraper(key);
    results.push(result);
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(50)}`);

  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'empty' ? '⚠️' : '❌';
    console.log(`${icon} ${r.scraper.padEnd(15)} ${r.name.padEnd(25)} ${r.resultCount} results (${r.durationMs}ms) ${r.error || ''}`);
  }

  // Save report
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const reportPath = path.join(DATA_DIR, 'scraper-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    testParams: TEST_PARAMS,
    testedAt: new Date().toISOString(),
    results,
  }, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}`);
}

// Only run when executed directly (npx tsx tests/test-all-scrapers.ts),
// not when imported by another module.
const isDirectRun = !!process.argv[1] && process.argv[1].includes('test-all-scrapers');
if (isDirectRun) {
  main().catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
  });
}
