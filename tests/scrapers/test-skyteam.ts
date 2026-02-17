/**
 * Test SkyTeam scrapers: Virgin Atlantic, Flying Blue, Delta
 * Route: JFK → NRT, Business, March 15 2026
 */

import { searchVirginAtlantic } from './virgin-atlantic.js';
import { searchFlyingBlue } from './flying-blue.js';
import { searchDelta } from './delta.js';
import { SearchParams } from '../types.js';

const params: SearchParams = {
  origin: 'JFK',
  destination: 'NRT',
  date: '2026-03-15',
  cabin: 'business',
  passengers: 1,
};

async function testScraper(name: string, fn: (p: SearchParams) => Promise<any[]>) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`Route: ${params.origin} → ${params.destination} | ${params.date} | ${params.cabin}`);
  console.log('='.repeat(60));

  const start = Date.now();
  try {
    const results = await fn(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ ${name}: ${results.length} results in ${elapsed}s`);

    for (const r of results.slice(0, 5)) {
      console.log(`  ${r.airline} ${r.flightNumber} | ${r.departureTime}→${r.arrivalTime} | ${r.stops} stops | ${r.pointsRequired?.toLocaleString()} ${r.pointsProgram} + $${r.taxesAndFees} | ${r.awardType}`);
    }
    if (results.length > 5) console.log(`  ... and ${results.length - 5} more`);
    return results;
  } catch (err: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`\n❌ ${name}: Failed in ${elapsed}s — ${err.message}`);
    return [];
  }
}

async function main() {
  const scraper = process.argv[2] || 'all';

  if (scraper === 'va' || scraper === 'all') {
    await testScraper('Virgin Atlantic', searchVirginAtlantic);
  }
  if (scraper === 'fb' || scraper === 'all') {
    await testScraper('Flying Blue', searchFlyingBlue);
  }
  if (scraper === 'delta' || scraper === 'all') {
    await testScraper('Delta', searchDelta);
  }

  console.log('\nDone.');
}

main().catch(console.error);
