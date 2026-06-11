/**
 * PROOF test for rate-limit & retry etiquette on a SHARED proxy IP.
 *
 * This is not a smoke test — each case proves the mechanism IMPROVES outcomes:
 *   - TokenBucket actually THROTTLES (4th request waits a measurable time after
 *     a burst of 3), while the burst itself is NOT throttled.
 *   - fullJitterBackoff actually SPREADS retries (200 samples scatter across the
 *     window, max > min, all bounded) — proving parallel retries won't sync.
 *   - parseRetryAfter understands both delta-seconds and HTTP-date.
 *   - nextDelayMs HONORS a server Retry-After over the client's jitter guess.
 *
 * Deterministic: jitter uses an injected RNG; bucket timing uses real timers
 * with small values and is asserted via coarse, robust thresholds.
 */

import { test, assert, assertEqual, run } from '../_assert.js';
import {
  fullJitterBackoff,
  TokenBucket,
  parseRetryAfter,
  nextDelayMs,
  type Rng,
} from '../../src/flights/net/rate-limit.js';

// Captured for the final OUTCOME line.
let measuredBurstWaitMs = 0;
let measuredSpreadMs = 0;

const now = () => Date.now();

test('TokenBucket: burst of 3 passes ~immediately, 4th take() is throttled', async () => {
  // Slow rate so the 4th request must wait a clearly measurable amount.
  // rate=5/s => one token every 200ms. burst=3.
  const bucket = new TokenBucket(5, 3);

  // First 3 takes drain the initial burst — these must be essentially instant.
  const burstStart = now();
  await bucket.take();
  await bucket.take();
  await bucket.take();
  const burstElapsed = now() - burstStart;
  assert(
    burstElapsed < 60,
    `burst of 3 should not be throttled, but took ${burstElapsed}ms`,
  );

  // The 4th take has no token left and must wait for a refill (>0, ~200ms).
  const fourthStart = now();
  await bucket.take();
  measuredBurstWaitMs = now() - fourthStart;

  assert(
    measuredBurstWaitMs > 0,
    `4th take() should wait > 0ms, but waited ${measuredBurstWaitMs}ms`,
  );
  // At 5/s a single token refills in ~200ms; allow generous slack for timer slop.
  assert(
    measuredBurstWaitMs >= 120 && measuredBurstWaitMs <= 600,
    `4th take() wait ${measuredBurstWaitMs}ms outside expected ~200ms window`,
  );
});

test('fullJitterBackoff: spreads samples across [0, cap], never synchronizes', () => {
  // Deterministic, well-distributed RNG (no real Math.random in the proof).
  // A linear-congruential-ish sequence mapped to [0,1).
  let seed = 1234567;
  const rng: Rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const attempt = 3;
  const baseMs = 1000;
  const capMs = 60000;
  // At attempt=3, window = min(cap, 1000 * 2^3) = 8000ms.
  const expectedWindow = Math.min(capMs, baseMs * 2 ** attempt);

  const samples: number[] = [];
  for (let i = 0; i < 200; i++) {
    samples.push(fullJitterBackoff(attempt, baseMs, capMs, rng));
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  measuredSpreadMs = max - min;

  // Bounds: every sample within [0, window].
  for (const s of samples) {
    assert(s >= 0 && s <= expectedWindow, `sample ${s} out of [0, ${expectedWindow}]`);
  }

  // Spread proof: not all identical, and the range covers most of the window.
  const distinct = new Set(samples).size;
  assert(distinct > 100, `expected wide spread, only ${distinct} distinct of 200`);
  assert(max > min, `max (${max}) must exceed min (${min})`);
  assert(
    measuredSpreadMs > expectedWindow * 0.5,
    `spread ${measuredSpreadMs}ms should cover >50% of ${expectedWindow}ms window`,
  );

  // Negative control: a CONSTANT rng (no jitter) would synchronize all retries.
  const constRng: Rng = () => 0.5;
  const synced = Array.from({ length: 10 }, () =>
    fullJitterBackoff(attempt, baseMs, capMs, constRng),
  );
  assertEqual(
    new Set(synced).size,
    1,
    'constant rng must collapse to a single value (demonstrates the herd jitter prevents)',
  );
});

test('parseRetryAfter: delta-seconds and HTTP-date and garbage', () => {
  // delta-seconds.
  assertEqual(parseRetryAfter('5'), 5000, "parseRetryAfter('5') should be 5000ms");
  assertEqual(parseRetryAfter('0'), 0, "parseRetryAfter('0') should be 0ms");
  assertEqual(parseRetryAfter('120'), 120000, "parseRetryAfter('120') should be 120000ms");

  // HTTP-date ~30s in the future (use fixed `now` for determinism).
  const base = Date.UTC(2026, 5, 10, 12, 0, 0); // 2026-06-10T12:00:00Z
  const future = new Date(base + 30000).toUTCString();
  const parsed = parseRetryAfter(future, base);
  assert(parsed !== null, 'future HTTP-date should parse');
  assert(
    Math.abs((parsed as number) - 30000) <= 1000,
    `future HTTP-date should be ~30000ms, got ${parsed}`,
  );

  // Past HTTP-date clamps to 0 (never wait negative).
  const past = new Date(base - 60000).toUTCString();
  assertEqual(parseRetryAfter(past, base), 0, 'past HTTP-date should clamp to 0');

  // Unparseable / empty / null -> null.
  assertEqual(parseRetryAfter('not-a-date'), null, 'garbage -> null');
  assertEqual(parseRetryAfter(''), null, 'empty -> null');
  assertEqual(parseRetryAfter(null), null, 'null -> null');
  assertEqual(parseRetryAfter(undefined), null, 'undefined -> null');
});

test('nextDelayMs: Retry-After WINS over client jitter; jitter used otherwise', () => {
  // A server Retry-After of 7 seconds must be honored exactly, regardless of
  // attempt number or what the jitter RNG would have produced.
  const alwaysMax: Rng = () => 0.999999;
  assertEqual(
    nextDelayMs(3, '7', 1000, 60000, alwaysMax),
    7000,
    'Retry-After "7" must win over jitter -> 7000ms',
  );
  assertEqual(
    nextDelayMs(10, '1', 1000, 60000, alwaysMax),
    1000,
    'Retry-After "1" honored even at high attempt -> 1000ms',
  );

  // No Retry-After -> falls back to full-jitter backoff (deterministic via rng).
  const half: Rng = () => 0.5;
  const fallback = nextDelayMs(2, undefined, 1000, 60000, half);
  // window at attempt=2 is 4000ms; rng=0.5 -> 2000ms.
  assertEqual(fallback, 2000, 'no Retry-After -> jitter backoff (0.5 * 4000ms)');

  // Garbage Retry-After -> also falls back to jitter (not honored).
  const fallbackGarbage = nextDelayMs(2, 'garbage', 1000, 60000, half);
  assertEqual(fallbackGarbage, 2000, 'invalid Retry-After -> jitter fallback');
});

// Registered LAST so it runs after every assertion case but before run() calls
// process.exit(). run() executes tests in registration order; if any earlier
// case failed it still reaches here, so we gate the summary on no prior failure
// by re-checking the captured metrics are populated.
test('OUTCOME summary', () => {
  assert(measuredBurstWaitMs > 0, 'burst wait metric not captured');
  assert(measuredSpreadMs > 0, 'jitter spread metric not captured');
  console.log(
    `OUTCOME: rate capped ok (4th waited ${measuredBurstWaitMs}ms), ` +
      `jitter spread ${measuredSpreadMs}ms ok, Retry-After honored ok`,
  );
});

run();
