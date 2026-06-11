/**
 * PROOF TEST — Per-route baseline soft-block detection.
 *
 * Demonstrates the mechanism IMPROVES on a plain zero-check by asserting it:
 *   (1) FIRES when a route's count silently collapses (AA-Angular-style break
 *       that still returns >0 results so silent-zero never trips),
 *   (2) does NOT fire on a stable route (no false positive),
 *   (3) FIRES on field drift when miles parse to blanks/zeros, and
 *   (4) stays SAFE during cold start (1 obs) even on a huge change.
 *
 * Deterministic, no network/DB.
 *
 * Run: tsx tests/approach/route-baseline.test.ts
 */

import { test, assert, run } from '../_assert.js';
import {
  recordObservation,
  checkAnomaly,
  getBaselines,
  resetBaselines,
} from '../../src/flights/monitoring/route-baseline.js';

const SCRAPER = 'aa-cdp';
const ROUTE = 'JFK-LHR-business';

/** Seed ~10 healthy observations: count ~20, miles ~[80000, 90000]. */
function seedHealthyRoute(scraper: string, route: string): void {
  for (let i = 0; i < 10; i++) {
    // counts hover around 20 (18..22), miles vary within 80k..90k band.
    const count = 18 + (i % 5); // 18,19,20,21,22 repeating
    const lo = 80000 + (i % 3) * 1000; // 80000..82000
    const hi = 90000 - (i % 4) * 1000; // 87000..90000
    recordObservation(scraper, route, { count, sampleMiles: [lo, hi] });
  }
}

test('count-drop fires when results silently collapse (AA-Angular-style break)', () => {
  resetBaselines();
  seedHealthyRoute(SCRAPER, ROUTE);

  // Sanity: baseline actually recorded the window (capped at 10).
  const bl = getBaselines()[`${SCRAPER}::${ROUTE}`];
  assert(bl && bl.length === 10, `expected 10 baseline obs, got ${bl?.length}`);

  // A plain zero-check sees count=2 (>0) and says "fine". We must flag it.
  const res = checkAnomaly(SCRAPER, ROUTE, { count: 2, sampleMiles: [85000] });
  assert(res.anomaly === true, 'expected anomaly:true for count collapse 20→2');
  assert(
    res.reasons.some((r) => r.includes('count dropped')),
    `expected a count-drop reason, got: ${JSON.stringify(res.reasons)}`,
  );
});

test('no false positive on a stable route (count=19, miles in-band)', () => {
  resetBaselines();
  seedHealthyRoute(SCRAPER, ROUTE);

  const res = checkAnomaly(SCRAPER, ROUTE, { count: 19, sampleMiles: [85000] });
  assert(res.anomaly === false, `expected no anomaly on stable route, got: ${JSON.stringify(res.reasons)}`);
  assert(res.reasons.length === 0, `expected zero reasons, got: ${JSON.stringify(res.reasons)}`);
});

test('field-drift fires when parser captures blanks (miles=[0,0])', () => {
  resetBaselines();
  seedHealthyRoute(SCRAPER, ROUTE);

  // Count stays normal (so count-drop does NOT fire) — isolates the drift path.
  const res = checkAnomaly(SCRAPER, ROUTE, { count: 20, sampleMiles: [0, 0] });
  assert(res.anomaly === true, 'expected anomaly:true for miles=[0,0] blank capture');
  assert(
    res.reasons.some((r) => r.includes('miles out of historical range')),
    `expected a miles-drift reason, got: ${JSON.stringify(res.reasons)}`,
  );
  // And it must NOT spuriously also claim a count drop.
  assert(
    !res.reasons.some((r) => r.includes('count dropped')),
    `unexpected count-drop reason on stable-count drift case: ${JSON.stringify(res.reasons)}`,
  );
});

test('cold start is safe — 1 obs, huge change, no anomaly', () => {
  resetBaselines();
  const cs = 'cold-scraper';
  const csRoute = 'SFO-HND-economy';

  // Single healthy observation, then a drastic change.
  recordObservation(cs, csRoute, { count: 50, sampleMiles: [60000, 70000] });

  const drop = checkAnomaly(cs, csRoute, { count: 0, sampleMiles: [0] });
  assert(drop.anomaly === false, `cold start must not flag count change, got: ${JSON.stringify(drop.reasons)}`);

  const drift = checkAnomaly(cs, csRoute, { count: 50, sampleMiles: [999999] });
  assert(drift.anomaly === false, `cold start must not flag miles drift, got: ${JSON.stringify(drift.reasons)}`);
});

// ---- Extra rigor: prove the two reasons are independently gated -----------

test('count-drop does NOT fire above the drop threshold (boundary)', () => {
  resetBaselines();
  seedHealthyRoute(SCRAPER, ROUTE);
  // median count is 20; dropFactor 0.25 → threshold is <5. count=5 is NOT a drop.
  const ok = checkAnomaly(SCRAPER, ROUTE, { count: 5, sampleMiles: [85000] });
  assert(ok.anomaly === false, `count=5 should be above drop threshold, got: ${JSON.stringify(ok.reasons)}`);
  // count=4 (<5) IS a drop.
  const bad = checkAnomaly(SCRAPER, ROUTE, { count: 4, sampleMiles: [85000] });
  assert(bad.anomaly === true && bad.reasons.some((r) => r.includes('count dropped')),
    `count=4 should trip count-drop, got: ${JSON.stringify(bad.reasons)}`);
});

test('low-volume routes below COUNT_FLOOR are not flagged for count drop', () => {
  resetBaselines();
  const lv = 'cathay-curlffi';
  const lvRoute = 'JFK-HKG-economy'; // naturally returns ~2 seats
  for (let i = 0; i < 6; i++) {
    recordObservation(lv, lvRoute, { count: 2, sampleMiles: [70000, 72000] });
  }
  // Drop to 0 results — but median (2) is below COUNT_FLOOR (5), so no count-drop.
  const res = checkAnomaly(lv, lvRoute, { count: 0, sampleMiles: [71000] });
  assert(!res.reasons.some((r) => r.includes('count dropped')),
    `low-volume route should not trip count-drop, got: ${JSON.stringify(res.reasons)}`);
});

// Print a single clear OUTCOME line, then run the registry.
(async () => {
  // Recompute a few representative results for the summary line.
  resetBaselines();
  seedHealthyRoute(SCRAPER, ROUTE);
  const drop = checkAnomaly(SCRAPER, ROUTE, { count: 2, sampleMiles: [85000] });
  const stable = checkAnomaly(SCRAPER, ROUTE, { count: 19, sampleMiles: [85000] });
  const drift = checkAnomaly(SCRAPER, ROUTE, { count: 20, sampleMiles: [0, 0] });
  resetBaselines();
  recordObservation('cs', 'r', { count: 50, sampleMiles: [60000, 70000] });
  const cold = checkAnomaly('cs', 'r', { count: 0, sampleMiles: [0] });

  const ok = (b: boolean) => (b ? 'ok' : 'FAIL');
  console.log(
    `OUTCOME: detects count-drop ${ok(drop.anomaly)}, ` +
      `detects miles-drift ${ok(drift.anomaly)}, ` +
      `no false-positive on stable route ${ok(!stable.anomaly)}, ` +
      `cold-start safe ${ok(!cold.anomaly)}`,
  );

  await run();
})();
