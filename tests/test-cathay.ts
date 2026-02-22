import 'dotenv/config';
import { searchCathayCurlFfi } from '../src/flights/scrapers/cathay-curlffi.js';

async function main() {
  console.log('=== Cathay Pacific AFR API Test ===\n');
  
  const tests = [
    { origin: 'JFK', destination: 'HKG', date: '2026-04-15', cabin: 'economy' as const },
    { origin: 'LAX', destination: 'HKG', date: '2026-04-20', cabin: 'business' as const },
    { origin: 'HKG', destination: 'NRT', date: '2026-04-15', cabin: 'economy' as const },
    { origin: 'JFK', destination: 'NRT', date: '2026-04-15', cabin: 'economy' as const },
    { origin: 'LHR', destination: 'HKG', date: '2026-04-15', cabin: 'first' as const },
  ];

  for (const params of tests) {
    console.log(`${params.origin}->${params.destination} ${params.cabin}:`);
    const start = Date.now();
    const results = await searchCathayCurlFfi(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (results.length > 0) {
      for (const r of results) {
        console.log(`  ✅ ${r.pointsRequired} ${r.pointsProgram} (${r.awardType}) [${elapsed}s]`);
      }
    } else {
      console.log(`  ❌ No availability [${elapsed}s]`);
    }
  }
}

main().catch(console.error);
