import { searchTurkishApi } from '../src/flights/scrapers/turkish-api.js';

(async () => {
  // Test 1: JFK → IST business (core TK route)
  const params = { origin: 'JFK', destination: 'IST', date: '2026-07-01', cabin: 'business' as const };

  console.log(`\n=== Test 1: ${params.origin}→${params.destination} ${params.date} ${params.cabin} ===`);
  const start = Date.now();

  try {
    const results = await searchTurkishApi(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Got ${results.length} results in ${elapsed}s\n`);

    for (const r of results.slice(0, 10)) {
      console.log(`  ${r.flightNumber.padEnd(8)} ${r.departureTime.padEnd(10)} → ${r.arrivalTime.padEnd(10)} ${r.duration.padEnd(10)} ${r.stops === 0 ? 'nonstop' : r.stops + ' stop'} ${r.cabin.padEnd(10)} ${r.pointsRequired.toLocaleString()} pts + $${(r.taxesAndFees ?? 0).toFixed(2)}`);
    }
  } catch (err) {
    console.error('Test 1 Error:', err);
  }

  // Test 2: JFK → IST economy
  console.log(`\n=== Test 2: JFK→IST economy ===`);
  try {
    const ecoStart = Date.now();
    const ecoResults = await searchTurkishApi({ ...params, cabin: 'economy' });
    const ecoElapsed = ((Date.now() - ecoStart) / 1000).toFixed(1);
    console.log(`Got ${ecoResults.length} economy results in ${ecoElapsed}s`);
    for (const r of ecoResults.slice(0, 5)) {
      console.log(`  ${r.flightNumber.padEnd(8)} ${r.departureTime.padEnd(10)} → ${r.arrivalTime.padEnd(10)} ${r.cabin.padEnd(10)} ${r.pointsRequired.toLocaleString()} pts + $${(r.taxesAndFees ?? 0).toFixed(2)}`);
    }
  } catch (err) {
    console.error('Test 2 Error:', err);
  }

  // Test 3: JFK → FRA business (Star Alliance partner — does Lufthansa appear?)
  console.log(`\n=== Test 3: JFK→FRA business (partner test) ===`);
  try {
    const partnerStart = Date.now();
    const partnerResults = await searchTurkishApi({ origin: 'JFK', destination: 'FRA', date: '2026-07-01', cabin: 'business' });
    const partnerElapsed = ((Date.now() - partnerStart) / 1000).toFixed(1);
    console.log(`Got ${partnerResults.length} partner results in ${partnerElapsed}s`);
    for (const r of partnerResults.slice(0, 5)) {
      console.log(`  ${r.flightNumber.padEnd(8)} ${r.airline.padEnd(20)} ${r.departureTime.padEnd(10)} → ${r.arrivalTime.padEnd(10)} ${r.cabin.padEnd(10)} ${r.pointsRequired.toLocaleString()} pts`);
    }
  } catch (err) {
    console.error('Test 3 Error:', err);
  }

  console.log('\nDone.');
})();
