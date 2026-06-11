/**
 * Proof test for the adaptive cadence controllers.
 *
 * Outcomes under test:
 *
 *  (1) AIMD concurrency (HostConcurrency) produces a measurably BETTER outcome
 *      than a fixed cap: it CLIMBS one additive step per success (probing for more
 *      throughput), and the instant a host blocks it HALVES (×factor) to back off
 *      — the classic sawtooth that converges on the sustainable rate. Negative
 *      controls: blocks never push below min, successes never exceed max.
 *
 *  (2) RouteCadence fires the right cadence: a hot route (volatile / nearDeal /
 *      just-changed) yields a SHORTER interval than a flat, stable route (deals
 *      get caught), repeated stable observations RELAX the interval monotonically
 *      up toward max (scrapes saved), and a volatile run pulls toward min — all
 *      bounded.
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import {
  HostConcurrency,
  RouteCadence,
  DEFAULT_HOST_MIN,
  DEFAULT_HOST_MAX,
  DEFAULT_ROUTE_MIN_MS,
  DEFAULT_ROUTE_MAX_MS,
  DEFAULT_ROUTE_BASE_MS,
} from '../../src/flights/scheduling/adaptive-cadence.js';

test('AIMD: additive climb, multiplicative halve on block, bounded sawtooth', () => {
  const min = 1;
  const max = 8;
  const step = 1;
  const factor = 0.5;
  const c = new HostConcurrency({ min, max, additiveStep: step, multiplicativeFactor: factor });

  // Starts at the floor.
  assertEqual(c.current(), min, 'should start at min');

  // ADDITIVE INCREASE: each success climbs by exactly +step, up to the cap.
  let prev = c.current();
  for (let i = 0; i < 20; i++) {
    c.onSuccess();
    const now = c.current();
    if (prev < max) {
      assertEqual(now, prev + step, `success #${i + 1} should climb by +${step} (was ${prev})`);
    } else {
      // NEGATIVE CONTROL: successes never exceed max.
      assertEqual(now, max, `success #${i + 1} must cap at max (${max})`);
    }
    prev = now;
  }
  assertEqual(c.current(), max, 'a run of successes should saturate at max');

  // MULTIPLICATIVE DECREASE: a single block halves the cap (≈ ×factor).
  const beforeBlock = c.current(); // 8
  c.onBlock();
  const afterBlock = c.current(); // 4
  assertEqual(afterBlock, Math.floor(beforeBlock * factor), 'one block should ≈ ×factor the cap');
  assert(afterBlock < beforeBlock, 'block must lower the cap');

  // SAWTOOTH: a success after the block climbs again (probe back up).
  c.onSuccess();
  assertEqual(c.current(), afterBlock + step, 'success after block should resume additive climb');

  // Repeated blocks compose multiplicatively but FLOOR at min (never below).
  const d = new HostConcurrency({ min, max, additiveStep: step, multiplicativeFactor: factor, start: max });
  const seen: number[] = [d.current()];
  for (let i = 0; i < 10; i++) {
    d.onBlock();
    const v = d.current();
    seen.push(v);
    // NEGATIVE CONTROL: blocks never push below min.
    assert(v >= min, `block #${i + 1} must not go below min (${min}), got ${v}`);
  }
  assertEqual(d.current(), min, 'a storm of blocks should converge to min, not lower');
  // 8 → 4 → 2 → 1 → 1 → ... (multiplicative decrease then floor).
  assert(seen[0] === 8 && seen[1] === 4 && seen[2] === 2 && seen[3] === 1,
    `expected sawtooth descent 8,4,2,1 — got ${seen.slice(0, 4).join(',')}`);

  // Defaults sanity.
  const def = new HostConcurrency();
  assertEqual(def.current(), DEFAULT_HOST_MIN, 'default starts at DEFAULT_HOST_MIN');
  for (let i = 0; i < 50; i++) def.onSuccess();
  assertEqual(def.current(), DEFAULT_HOST_MAX, 'default saturates at DEFAULT_HOST_MAX');
});

test('RouteCadence: hot interval < cold interval, relaxes when stable, pulls to min when volatile, bounded', () => {
  const min = DEFAULT_ROUTE_MIN_MS;
  const max = DEFAULT_ROUTE_MAX_MS;

  // HOT route: volatile + nearDeal + just-changed → tightens from base.
  const hot = new RouteCadence();
  const hotInterval = hot.nextInterval({ volatility: 0.9, nearDeal: true, lastChanged: true });
  assert(hotInterval < DEFAULT_ROUTE_BASE_MS, `hot route must tighten below base (got ${hotInterval})`);

  // COLD route: flat, not near a deal, unchanged → relaxes from base.
  const cold = new RouteCadence();
  const coldInterval = cold.nextInterval({ volatility: 0, nearDeal: false, lastChanged: false });
  assert(coldInterval > DEFAULT_ROUTE_BASE_MS, `cold route must relax above base (got ${coldInterval})`);

  // CORE OUTCOME: hot route polls more often than cold route.
  assert(hotInterval < coldInterval,
    `hot interval (${hotInterval}) must be < cold interval (${coldInterval})`);

  // RELAX: repeated stable observations climb MONOTONICALLY toward max, bounded.
  const relaxing = new RouteCadence();
  let prev = relaxing.peek();
  for (let i = 0; i < 40; i++) {
    const next = relaxing.nextInterval({ volatility: 0, nearDeal: false, lastChanged: false });
    assert(next >= prev, `stable observation #${i + 1} must not shorten interval (${next} < ${prev})`);
    assert(next <= max, `interval must stay <= max (got ${next})`);
    prev = next;
  }
  assertEqual(relaxing.peek(), max, 'many stable observations should saturate at max');

  // TIGHTEN: a volatile run pulls MONOTONICALLY toward min, bounded.
  const tightening = new RouteCadence({ baseMs: max }); // start high to show the descent
  let p = tightening.peek();
  for (let i = 0; i < 60; i++) {
    const next = tightening.nextInterval({ volatility: 1, nearDeal: true, lastChanged: true });
    assert(next <= p, `volatile observation #${i + 1} must not lengthen interval (${next} > ${p})`);
    assert(next >= min, `interval must stay >= min (got ${next})`);
    p = next;
  }
  assertEqual(tightening.peek(), min, 'a sustained volatile run should bottom out at min');

  // nearDeal alone (zero volatility) still tightens — deal protection lever.
  const dealOnly = new RouteCadence();
  const before = dealOnly.peek();
  const after = dealOnly.nextInterval({ volatility: 0, nearDeal: true, lastChanged: false });
  assert(after < before, `nearDeal alone should tighten (${after} >= ${before})`);

  console.log(
    'OUTCOME: AIMD sawtooth (climbs +step, halves on block, bounded) ok, ' +
    `hot-route interval < cold ok (${hotInterval}ms < ${coldInterval}ms), ` +
    'relaxes when stable ok',
  );
});

run();
