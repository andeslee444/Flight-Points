import { getScrapersForLiveSearch, getScrapersForProgram, SCRAPER_REGISTRY } from '../src/flights/scrapers/index.js';

const programs = ['amex-mr', 'chase-ur', 'citi-typ'];
for (const prog of programs) {
  const allKeys = getScrapersForProgram(prog);
  const liveKeys = getScrapersForLiveSearch(prog);
  console.log(`\n=== ${prog} ===`);
  console.log(`getScrapersForProgram: [${allKeys.join(', ')}]`);
  console.log(`getScrapersForLiveSearch: [${liveKeys.join(', ')}]`);
  for (const k of liveKeys) {
    const e = SCRAPER_REGISTRY[k];
    console.log(`  ${k.padEnd(20)} ${(e?.status || '?').padEnd(10)} ${e?.name || ''}`);
  }
}
