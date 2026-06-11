/**
 * Proof test for the volatility-keyed TTL policy.
 *
 * Outcome under test: volatile / near-sweet-spot routes get a SHORTER cache TTL
 * (so they are re-scraped more often and deals are caught) than flat / far
 * routes — and the TTL is always clamped to [min,max] and monotonically
 * non-increasing in volatility (so the freshness ordering is well-behaved).
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  ttlForRoute,
  DEFAULT_MIN_MS,
  DEFAULT_MAX_MS,
  DEFAULT_BASE_MS,
} from '../../src/flights/scheduling/ttl-policy.js';

test('volatile/near routes get shorter TTL than flat/far; clamped; monotonic', () => {
  const min = DEFAULT_MIN_MS;
  const max = DEFAULT_MAX_MS;

  const volatileNear = ttlForRoute({ milesVolatility: 0.95, nearSweetSpot: true });
  const flatFar = ttlForRoute({ milesVolatility: 0.0, nearSweetSpot: false });

  // Core outcome: the high-churn route refreshes sooner.
  assert(
    volatileNear < flatFar,
    `volatile/near TTL (${volatileNear}) must be < flat/far TTL (${flatFar})`,
  );

  // Both clamped to [min, max].
  for (const [label, v] of [['volatileNear', volatileNear], ['flatFar', flatFar]] as const) {
    assert(v >= min, `${label} TTL ${v} must be >= min ${min}`);
    assert(v <= max, `${label} TTL ${v} must be <= max ${max}`);
  }

  // Flat/far should anchor at the base TTL (no near-sweet-spot shortening).
  assertEqual(flatFar, DEFAULT_BASE_MS, 'flat/far route should equal base TTL');

  // Monotonic non-increasing in volatility (nearSweetSpot held constant).
  let prev = Infinity;
  for (let v = 0; v <= 1.0 + 1e-9; v += 0.1) {
    const ttl = ttlForRoute({ milesVolatility: v, nearSweetSpot: false });
    assert(ttl <= prev + 1e-6, `TTL must not increase with volatility (v=${v.toFixed(1)}: ${ttl} > prev ${prev})`);
    assert(ttl >= min && ttl <= max, `TTL out of clamp range at v=${v.toFixed(1)}: ${ttl}`);
    prev = ttl;
  }

  // Near-sweet-spot shortens further at equal volatility (the deal-protection lever).
  const farMid = ttlForRoute({ milesVolatility: 0.3, nearSweetSpot: false });
  const nearMid = ttlForRoute({ milesVolatility: 0.3, nearSweetSpot: true });
  assert(nearMid < farMid, `near-sweet-spot (${nearMid}) must shorten vs far (${farMid}) at equal volatility`);

  // Clamp proof: extreme inputs and out-of-range volatility stay bounded.
  const overVolatile = ttlForRoute({ milesVolatility: 5, nearSweetSpot: true }); // v clamped to 1
  assertEqual(overVolatile, min, 'fully volatile + near should clamp to min');
  const negVolatile = ttlForRoute({ milesVolatility: -3, nearSweetSpot: false }); // v clamped to 0
  assertEqual(negVolatile, DEFAULT_BASE_MS, 'negative volatility clamps to 0 → base TTL');

  // Custom opts honored and clamped.
  const tight = ttlForRoute(
    { milesVolatility: 0, nearSweetSpot: false },
    { minMs: 1000, maxMs: 2000, baseMs: 9999 },
  );
  assertEqual(tight, 2000, 'baseMs above maxMs must clamp to maxMs');

  console.log(
    'OUTCOME: volatile-ttl < stable-ttl ok, clamped ok ' +
    `(volatile/near=${volatileNear}ms, flat/far=${flatFar}ms, ` +
    `range=[${min}..${max}]ms, monotonic-decreasing verified)`,
  );
});

run();
