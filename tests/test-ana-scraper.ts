import 'dotenv/config';
import { searchANA } from './scrapers/ana.js';

(async () => {
  console.log('ANA_USERNAME:', process.env.ANA_USERNAME ? `${process.env.ANA_USERNAME.substring(0,4)}...` : 'NOT SET');
  console.log('ANA_PASSWORD:', process.env.ANA_PASSWORD ? '***set***' : 'NOT SET');

  try {
    const results = await searchANA({ origin: 'JFK', destination: 'NRT', date: '2026-03-15', cabin: 'business' });
    console.log(`ANA results: ${results.length}`);
    for (const r of results.slice(0, 3)) {
      console.log(`  ${r.source} | ${r.airline} ${r.flightNumber} | ${r.pointsRequired} miles | ${r.awardType}`);
    }
  } catch (e: any) {
    console.error('ANA error:', e.message);
  }
  process.exit(0);
})();
