/**
 * Proof test for Singleflight in-flight coalescing.
 *
 * Outcome under test: a burst of N concurrent calls for the same key collapses
 * to exactly ONE underlying execution (throughput / dedup win), every caller
 * gets the same result, and — crucially — it is NOT a permanent cache: once the
 * in-flight promise settles, a later call re-runs the work.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import { Singleflight } from '../../src/flights/scrapers/singleflight.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test('100 concurrent calls → 1 execution; settled → re-runs (in-flight dedup, not cache)', async () => {
  const sf = new Singleflight();
  let executions = 0;

  // A counting fn: increments on each REAL invocation, resolves after a tick so
  // all concurrent callers latch onto the same in-flight promise.
  const makeFn = (returnValue: number) => async () => {
    executions++;
    await tick();
    return returnValue;
  };

  // --- Burst: 100 concurrent calls for the same key ---
  const N = 100;
  const fn = makeFn(42);
  const promises = Array.from({ length: N }, () => sf.run('JFK-NRT', fn));

  // Coalescing must be SYNCHRONOUS: by the time we've issued all 100 calls,
  // only one execution has begun and only one key is in flight.
  assertEqual(executions, 1, 'burst must collapse to a single execution');
  assertEqual(sf.size, 1, 'only one in-flight entry should exist for the shared key');

  const results = await Promise.all(promises);

  // Dedup proof: still exactly one execution after all settle.
  assertEqual(executions, 1, 'still exactly one execution after all 100 resolve');
  // All callers got the SAME value.
  assert(results.every((v) => v === 42), 'all callers must resolve to the same value');
  // Entry cleared on settle.
  assertEqual(sf.size, 0, 'in-flight entry must be cleared once it settles');

  // --- Not-a-cache proof: a fresh call AFTER settle re-runs the work ---
  const second = await sf.run('JFK-NRT', makeFn(99));
  assertEqual(executions, 2, 're-run after settle must execute again (proves dedup, not caching)');
  assertEqual(second, 99, 'post-settle call returns the new execution result, not a cached value');

  // --- Negative case: it does NOT collapse calls for DIFFERENT keys ---
  let aRan = 0;
  let bRan = 0;
  const pa = sf.run('A', async () => { aRan++; await tick(); return 'a'; });
  const pb = sf.run('B', async () => { bRan++; await tick(); return 'b'; });
  assertEqual(sf.size, 2, 'distinct keys must run independently (no false coalescing)');
  const [ra, rb] = await Promise.all([pa, pb]);
  assertEqual(ra, 'a', 'key A result');
  assertEqual(rb, 'b', 'key B result');
  assertEqual(aRan, 1, 'key A executed once');
  assertEqual(bRan, 1, 'key B executed once');

  // --- Rejection still clears the entry (so retries are possible) ---
  let rejRuns = 0;
  await sf.run('R', async () => { rejRuns++; await tick(); throw new Error('boom'); })
    .then(() => assert(false, 'rejected fn should reject'))
    .catch((e) => assertEqual((e as Error).message, 'boom', 'rejection propagates'));
  assertEqual(sf.size, 0, 'entry cleared after rejection');
  await sf.run('R', async () => { rejRuns++; await tick(); return 'ok'; });
  assertEqual(rejRuns, 2, 'a rejected key can be retried (entry was not stuck)');

  console.log(
    'OUTCOME: 100 concurrent → 1 execution ok, re-runs after settle ok ' +
    `(executions=${executions} for shared key; distinct keys & rejected-retry isolated)`,
  );
});

run();
