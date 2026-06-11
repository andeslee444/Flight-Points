/**
 * PROOF TEST for the crawl-score priority model.
 *
 * The point of crawl-score is a measurably BETTER scheduling outcome: when the
 * daemon can only afford N searches per cycle, ranking by score must put the
 * routes that matter (watched, volatile, deal-likely, stale) ahead of the ones
 * that don't — and must NOT promote a route that has no reason to jump the queue.
 *
 * This proves the OUTCOME, not just "a function returns a number":
 *   (1) a HOT route scores STRICTLY higher than a COLD route (fires when it should);
 *   (2) rankRoutes on a SCRAMBLED list still emits hot-first, cold-last (the
 *       ordering survives arbitrary input order — the actual scheduler payoff);
 *   (3) monotonicity: raising staleness alone never DECREASES score; raising
 *       dealLikelihood alone never decreases score (no perverse de-prioritization);
 *   (4) weighting intent: a watched-but-FRESH route outranks an unwatched-but-STALE
 *       route — demand dominates, so we never starve real users to chase a stale
 *       route nobody watches (fires only when it should — staleness alone is not
 *       enough to jump the queue).
 *
 * Deterministic, offline, no network/DB.
 *
 *   npx tsx tests/frontier/crawl-score.test.ts
 */
import { test, assert, run } from '../_assert.js';
import {
  crawlScore,
  rankRoutes,
  DEFAULT_WEIGHTS,
  saturateStaleness,
  type RankableRoute,
} from '../../src/flights/scheduling/crawl-score.js';

// Canonical HOT route: everyone wants it, prices swing, it's near a sweet spot,
// and we haven't scraped it in ages.
const HOT = { userDemand: 1.0, milesVolatility: 0.9, dealLikelihood: 0.95, stalenessHours: 72 };
// Canonical COLD route: nobody watching, flat prices, far from any deal, just scraped.
const COLD = { userDemand: 0.0, milesVolatility: 0.05, dealLikelihood: 0.05, stalenessHours: 0.1 };

// Shared deltas printed in the OUTCOME line.
let hotMinusCold = 0;
let scrambledOk = false;
let monotonicOk = false;

test('(1) hot route scores strictly higher than cold route', () => {
  const hot = crawlScore(HOT);
  const cold = crawlScore(COLD);
  hotMinusCold = hot - cold;
  assert(hot > cold, `hot (${hot.toFixed(3)}) must beat cold (${cold.toFixed(3)})`);
  // Sanity: the gap is large, not a rounding artifact.
  assert(hotMinusCold > 0.5, `hot-vs-cold gap should be decisive, got ${hotMinusCold.toFixed(3)}`);
});

test('(2) rankRoutes on a SCRAMBLED list puts hot first, cold last', () => {
  // Build a mix of routes with a deterministic spread of scores.
  const routes: RankableRoute[] = [
    { key: 'COLD', ...COLD },
    { key: 'HOT', ...HOT },
    { key: 'MID-demand', userDemand: 0.6, milesVolatility: 0.4, dealLikelihood: 0.3, stalenessHours: 4 },
    { key: 'MID-stale', userDemand: 0.2, milesVolatility: 0.3, dealLikelihood: 0.2, stalenessHours: 48 },
    { key: 'MID-deal', userDemand: 0.3, milesVolatility: 0.5, dealLikelihood: 0.8, stalenessHours: 2 },
  ];

  // Scramble deterministically (fixed permutation — no RNG needed for determinism).
  const scrambled = [routes[3], routes[0], routes[4], routes[1], routes[2]];
  const ranked = rankRoutes(scrambled);

  assert(ranked[0] === 'HOT', `expected HOT first, got ${ranked[0]} (full: ${ranked.join(',')})`);
  assert(
    ranked[ranked.length - 1] === 'COLD',
    `expected COLD last, got ${ranked[ranked.length - 1]} (full: ${ranked.join(',')})`,
  );
  // The ranking must be fully sorted by descending score: verify it's stable.
  const scores = ranked.map((k) => {
    const r = routes.find((x) => x.key === k)!;
    return crawlScore(r);
  });
  for (let i = 1; i < scores.length; i++) {
    assert(scores[i - 1] >= scores[i], `ranked output not descending at index ${i}: ${ranked.join(',')}`);
  }
  scrambledOk = true;
});

test('(3a) monotonic: increasing staleness (others equal) never DECREASES score', () => {
  const base = { userDemand: 0.5, milesVolatility: 0.5, dealLikelihood: 0.5, stalenessHours: 0 };
  let prev = -Infinity;
  for (const hours of [0, 1, 3, 6, 12, 24, 48, 96, 240, 1000]) {
    const s = crawlScore({ ...base, stalenessHours: hours });
    assert(s >= prev - 1e-12, `score dropped as staleness rose to ${hours}h: ${s} < ${prev}`);
    prev = s;
  }
  // The saturating curve must actually move (not flat): more stale => meaningfully higher.
  const fresh = crawlScore({ ...base, stalenessHours: 0 });
  const ancient = crawlScore({ ...base, stalenessHours: 1000 });
  assert(ancient > fresh, `staleness must raise priority: ancient ${ancient} !> fresh ${fresh}`);
});

test('(3b) monotonic: increasing dealLikelihood (others equal) never DECREASES score', () => {
  const base = { userDemand: 0.5, milesVolatility: 0.5, dealLikelihood: 0, stalenessHours: 5 };
  let prev = -Infinity;
  for (const d of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
    const s = crawlScore({ ...base, dealLikelihood: d });
    assert(s >= prev - 1e-12, `score dropped as dealLikelihood rose to ${d}: ${s} < ${prev}`);
    prev = s;
  }
  monotonicOk = true;
});

test('(4) weighting intent: watched-but-fresh outranks unwatched-but-stale', () => {
  // A real user is watching this route; we scraped it 5 minutes ago.
  const watchedFresh = { userDemand: 1.0, milesVolatility: 0.3, dealLikelihood: 0.3, stalenessHours: 0.08 };
  // Nobody watches this; it's been cold for days.
  const unwatchedStale = { userDemand: 0.0, milesVolatility: 0.3, dealLikelihood: 0.3, stalenessHours: 240 };

  const a = crawlScore(watchedFresh);
  const b = crawlScore(unwatchedStale);
  assert(a > b, `demand must dominate staleness: watched-fresh ${a.toFixed(3)} !> unwatched-stale ${b.toFixed(3)}`);

  // Document WHY structurally: demand weight exceeds the maximum staleness contribution,
  // so staleness alone can never out-vote a fully-watched route.
  const maxStalenessContribution = saturateStaleness(1e9, DEFAULT_WEIGHTS.stalenessHalfLifeHours) * DEFAULT_WEIGHTS.staleness;
  assert(
    DEFAULT_WEIGHTS.demand > maxStalenessContribution,
    `demand weight (${DEFAULT_WEIGHTS.demand}) must exceed max staleness contribution (${maxStalenessContribution.toFixed(3)})`,
  );
});

test('OUTCOME', () => {
  assert(hotMinusCold > 0.5 && scrambledOk && monotonicOk, 'all proof conditions must hold');
  console.log(
    `OUTCOME: hot>cold by Δ ${hotMinusCold.toFixed(3)} ok, ` +
      `ranks hot-first from scrambled ok, monotonic in staleness+deal ok`,
  );
});

run();
