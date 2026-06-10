/**
 * Offline unit tests for scraper-health circuit breaker + silent-zero tracking.
 *
 * The module keeps in-memory state keyed by scraper name, with no reset between
 * calls, so every test uses a UNIQUE key to avoid shared-state bleed.
 */
import { test, assert, assertEqual } from '../_assert.js';
import {
  recordSuccess,
  recordFailure,
  recordZero,
  isScraperAvailable,
  getSuspectScrapers,
} from '../../src/flights/scraper-health.js';
import { ZERO_SUSPECT_THRESHOLD, CIRCUIT_BREAKER_THRESHOLD } from '../../src/flights/scraper-config.js';

test('recordZero: not suspect before threshold, flips exactly at threshold', () => {
  const key = 'health-test:zero-flip';
  // The first (THRESHOLD - 1) zeros stay below the line.
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD - 1; i++) {
    const flipped = recordZero(key);
    assertEqual(flipped, false, `zero #${i + 1} should not flip to suspect`);
    assert(!getSuspectScrapers().includes(key), `key should not be suspect at zero #${i + 1}`);
  }
  // The Nth zero (== threshold) flips it, and returns true exactly on that flip.
  const flipped = recordZero(key);
  assertEqual(flipped, true, 'reaching threshold should return true (newly suspect)');
  assert(getSuspectScrapers().includes(key), 'key should be suspect at threshold');
});

test('recordZero: returns true only on the flip, false on subsequent zeros', () => {
  const key = 'health-test:zero-flip-once';
  let flips = 0;
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD + 2; i++) {
    if (recordZero(key)) flips++;
  }
  assertEqual(flips, 1, 'recordZero should return true exactly once (the flip)');
});

test('getSuspectScrapers: includes suspect, excludes healthy', () => {
  const suspectKey = 'health-test:suspect-included';
  const healthyKey = 'health-test:healthy-excluded';
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD; i++) recordZero(suspectKey);
  recordSuccess(healthyKey);
  const suspects = getSuspectScrapers();
  assert(suspects.includes(suspectKey), 'suspect key should be listed');
  assert(!suspects.includes(healthyKey), 'healthy key should not be listed');
});

test('silent zeros never open the circuit (stays available)', () => {
  const key = 'health-test:zero-no-circuit';
  // Many more zeros than the circuit-breaker failure threshold.
  for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD + ZERO_SUSPECT_THRESHOLD + 5; i++) {
    recordZero(key);
  }
  assert(getSuspectScrapers().includes(key), 'should be suspect after many zeros');
  assertEqual(isScraperAvailable(key), true, 'zeros must not trip the circuit breaker');
});

test('recordSuccess clears suspect and consecutive zeros', () => {
  const key = 'health-test:success-clears';
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD; i++) recordZero(key);
  assert(getSuspectScrapers().includes(key), 'should be suspect before success');
  recordSuccess(key);
  assert(!getSuspectScrapers().includes(key), 'success should clear suspect');
  // After clearing, it takes a full threshold of zeros to become suspect again.
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD - 1; i++) {
    assertEqual(recordZero(key), false, 'consecutiveZeros should have reset after success');
  }
  assertEqual(recordZero(key), true, 'should flip to suspect again only after a fresh full streak');
});

test('recordFailure x CIRCUIT_BREAKER_THRESHOLD opens the circuit', () => {
  const key = 'health-test:circuit-opens';
  for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
    recordFailure(key);
    assertEqual(isScraperAvailable(key), true, `circuit should stay closed before threshold (failure #${i + 1})`);
  }
  recordFailure(key); // Nth failure trips it.
  assertEqual(isScraperAvailable(key), false, 'circuit should be open at threshold');
});

test('recordFailure resets consecutive zeros (and suspect)', () => {
  const key = 'health-test:failure-resets-zeros';
  // Build up zeros to just below suspect.
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD - 1; i++) recordZero(key);
  // A loud failure ends the silent-zero streak.
  recordFailure(key);
  assert(!getSuspectScrapers().includes(key), 'failure should not leave it suspect');
  // Because consecutiveZeros reset to 0, it now takes a full fresh streak to flip.
  for (let i = 0; i < ZERO_SUSPECT_THRESHOLD - 1; i++) {
    assertEqual(recordZero(key), false, 'consecutiveZeros must have reset after failure');
  }
  assertEqual(recordZero(key), true, 'flips suspect only after a fresh full zero streak post-failure');
});
