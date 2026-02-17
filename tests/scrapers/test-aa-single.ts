import { searchAA } from './aa.js';

async function main() {
  console.log('Starting single AA test...');
  const start = Date.now();
  const r = await searchAA({ origin: 'JFK', destination: 'NRT', date: '2026-03-15', cabin: 'business', passengers: 1 });
  console.log(`RESULT COUNT: ${r.length} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  if (r.length > 0) {
    r.slice(0, 3).forEach(f => console.log(`  ${f.flightNumber} | ${f.pointsRequired} miles | ${f.cabin}`));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
