import { searchJetBlueApi } from '../src/flights/scrapers/jetblue-api.js';

(async () => {
  const params = { origin: 'JFK', destination: 'AUA', date: '2026-07-01', cabin: 'economy' as const };

  console.log(`Testing JetBlue API: ${params.origin}→${params.destination} ${params.date} ${params.cabin}`);
  const start = Date.now();

  try {
    const results = await searchJetBlueApi(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nGot ${results.length} results in ${elapsed}s\n`);

    for (const r of results.slice(0, 10)) {
      console.log(`  ${r.flightNumber.padEnd(8)} ${r.departureTime.padEnd(10)} → ${r.arrivalTime.padEnd(10)} ${r.duration.padEnd(10)} ${r.stops === 0 ? 'nonstop' : r.stops + ' stop'} ${r.cabin.padEnd(10)} ${r.pointsRequired.toLocaleString()} pts + $${r.taxesAndFees?.toFixed(2)}`);
    }

    // Also test business (Mint)
    console.log(`\nTesting business class...`);
    const bizStart = Date.now();
    const bizResults = await searchJetBlueApi({ ...params, cabin: 'business' });
    const bizElapsed = ((Date.now() - bizStart) / 1000).toFixed(1);
    console.log(`Got ${bizResults.length} business results in ${bizElapsed}s`);
    for (const r of bizResults.slice(0, 5)) {
      console.log(`  ${r.flightNumber.padEnd(8)} ${r.departureTime.padEnd(10)} → ${r.arrivalTime.padEnd(10)} ${r.cabin.padEnd(10)} ${r.pointsRequired.toLocaleString()} pts + $${r.taxesAndFees?.toFixed(2)}`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
})();
