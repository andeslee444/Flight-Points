/**
 * Offline unit tests for the pure daemon helpers: generateDates, parseList,
 * isValidFlight. No network, no DB, no env requirements (deterministic).
 */
import { test, assert, assertEqual, assertDeepEqual } from '../_assert.js';
import { generateDates, parseList, isValidFlight } from '../../src/flights/daemon-helpers.js';
import { MAX_REASONABLE_POINTS, MAX_REASONABLE_TAXES_USD } from '../../src/flights/scraper-config.js';
import type { FlightResult } from '../../src/flights/types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = new Date().toISOString().slice(0, 10);

// ── generateDates ─────────────────────────────────────────────

test('generateDates clamps a past startDate to today (no past dates)', () => {
  const dates = generateDates('2000-01-01', undefined, 14);
  assert(dates.length > 0, 'should produce at least one date');
  // The clamp means the first date is today, and nothing precedes it.
  assertEqual(dates[0], today, 'first sampled date should be clamped to today');
  for (const d of dates) {
    assert(d >= today, `no date should be before today: ${d}`);
    assert(DATE_RE.test(d), `date should match YYYY-MM-DD: ${d}`);
  }
});

test('generateDates respects samplingDays step and endDate bound', () => {
  // Use a fixed forward window relative to today so the test is deterministic.
  const start = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const step = 14;
  const dates = generateDates(start, end, step);

  assert(dates.length >= 2, 'window should yield multiple samples');
  assertEqual(dates[0], start, 'first date should be the (future) start');
  for (const d of dates) {
    assert(DATE_RE.test(d), `date should match YYYY-MM-DD: ${d}`);
    assert(d <= end, `date should not exceed endDate: ${d} > ${end}`);
  }
  // Consecutive dates must differ by exactly `step` days.
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T00:00:00');
    const cur = new Date(dates[i] + 'T00:00:00');
    const deltaDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    assertEqual(deltaDays, step, `step between samples should be ${step} days`);
  }
});

// ── parseList ─────────────────────────────────────────────────

test('parseList splits on commas and semicolons, trims, drops empties', () => {
  assertDeepEqual(parseList('JFK, LAX ;  SFO'), ['JFK', 'LAX', 'SFO'], 'mixed delimiters');
  assertDeepEqual(parseList('  A , , B '), ['A', 'B'], 'empty token dropped');
  assertDeepEqual(parseList(''), [], 'empty string yields empty list');
  assertDeepEqual(parseList('SOLO'), ['SOLO'], 'single token');
});

// ── isValidFlight ─────────────────────────────────────────────

function goodFlight(overrides: Partial<FlightResult> = {}): FlightResult {
  return {
    source: 'test',
    airline: 'United',
    flightNumber: 'UA1',
    origin: 'JFK',
    destination: 'LHR',
    departureDate: '2026-07-01',
    departureTime: '09:00',
    arrivalTime: '21:00',
    duration: '7h00',
    stops: 0,
    cabin: 'business',
    pointsRequired: 60000,
    taxesAndFees: 50,
    scrapedAt: new Date().toISOString(),
    ...overrides,
  } as FlightResult;
}

test('isValidFlight accepts a well-formed flight', () => {
  assertEqual(isValidFlight(goodFlight()), true, 'baseline good flight should be valid');
});

test('isValidFlight rejects empty / Unknown airline', () => {
  assertEqual(isValidFlight(goodFlight({ airline: '' })), false, 'empty airline');
  assertEqual(isValidFlight(goodFlight({ airline: '   ' })), false, 'whitespace airline');
  assertEqual(isValidFlight(goodFlight({ airline: 'Unknown' })), false, 'Unknown airline');
  assertEqual(isValidFlight(goodFlight({ airline: 'N/A' })), false, 'N/A airline');
});

test('isValidFlight rejects non-positive and oversized points', () => {
  assertEqual(isValidFlight(goodFlight({ pointsRequired: 0 })), false, 'zero points');
  assertEqual(isValidFlight(goodFlight({ pointsRequired: -1 })), false, 'negative points');
  assertEqual(isValidFlight(goodFlight({ pointsRequired: undefined })), false, 'missing points');
  assertEqual(
    isValidFlight(goodFlight({ pointsRequired: MAX_REASONABLE_POINTS + 1 })),
    false,
    'points above ceiling',
  );
  assertEqual(
    isValidFlight(goodFlight({ pointsRequired: MAX_REASONABLE_POINTS })),
    true,
    'points exactly at ceiling are allowed',
  );
});

test('isValidFlight rejects negative and oversized taxes', () => {
  assertEqual(isValidFlight(goodFlight({ taxesAndFees: -1 })), false, 'negative taxes');
  assertEqual(
    isValidFlight(goodFlight({ taxesAndFees: MAX_REASONABLE_TAXES_USD + 1 })),
    false,
    'taxes above ceiling',
  );
  assertEqual(isValidFlight(goodFlight({ taxesAndFees: 0 })), true, 'zero taxes allowed');
  assertEqual(
    isValidFlight(goodFlight({ taxesAndFees: MAX_REASONABLE_TAXES_USD })),
    true,
    'taxes exactly at ceiling are allowed',
  );
});

test('isValidFlight rejects missing origin/destination/date', () => {
  assertEqual(isValidFlight(goodFlight({ origin: '' })), false, 'missing origin');
  assertEqual(isValidFlight(goodFlight({ destination: '' })), false, 'missing destination');
  assertEqual(isValidFlight(goodFlight({ departureDate: '' })), false, 'missing departureDate');
});
