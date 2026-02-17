import 'dotenv/config';
import { searchSingaporeAirlines } from './scrapers/singapore.js';

(async () => {
  console.log('SQ_KRISFLYER_ID:', process.env.SQ_KRISFLYER_ID ? `${process.env.SQ_KRISFLYER_ID.substring(0,4)}...` : 'NOT SET');
  console.log('SQ_KRISFLYER_PASSWORD:', process.env.SQ_KRISFLYER_PASSWORD ? '***set***' : 'NOT SET');

  try {
    const result = await searchSingaporeAirlines({ origin: 'JFK', destination: 'NRT', date: '2026-03-15', cabin: 'business' });
    console.log(`SQ results: ${result.flights.length} (method: ${result.method}, source: ${result.source})`);
    for (const r of result.flights.slice(0, 3)) {
      console.log(`  ${r.source} | ${r.airline} ${r.flightNumber} | ${r.pointsRequired} miles | ${r.awardType}`);
    }
  } catch (e: any) {
    console.error('SQ error:', e.message);
  }
  process.exit(0);
})();
