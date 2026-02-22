import { SCRAPER_REGISTRY, getScrapersForLiveSearch } from '../src/flights/scrapers/index.js';

// Show all scraper statuses
console.log('=== SCRAPER REGISTRY ===');
for (const [key, entry] of Object.entries(SCRAPER_REGISTRY)) {
  console.log(`  ${key}: ${entry.status} (${entry.name}) covers=[${entry.covers.join(',')}]`);
}

// Show what scrapers would run for common programs
const programs = ['chase-ur', 'amex-mr', 'capital-one'];
for (const prog of programs) {
  const scrapers = getScrapersForLiveSearch(prog);
  console.log(`\nLive search for ${prog}: [${scrapers.join(', ')}]`);
  for (const key of scrapers) {
    const entry = SCRAPER_REGISTRY[key];
    console.log(`  ${key}: ${entry?.status ?? 'missing'}`);
  }
}

console.log('\n=== Active scrapers ===');
const active = Object.entries(SCRAPER_REGISTRY).filter(([,e]) => e.status === 'active');
for (const [key, entry] of active) {
  console.log(`  ${key}: ${entry.name} → covers ${entry.covers.join(', ')}`);
}

console.log('\n=== Blocked scrapers ===');
const blocked = Object.entries(SCRAPER_REGISTRY).filter(([,e]) => e.status === 'blocked');
for (const [key, entry] of blocked) {
  console.log(`  ${key}: ${entry.name}`);
}
