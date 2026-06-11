/**
 * PROOF TEST — Persistent run-history + per-scraper rot alerting.
 *
 * Demonstrates the mechanism produces a BETTER OUTCOME than a naive "alert on
 * every empty run" by asserting it:
 *   (1) FIRES exactly once when a scraper that WAS producing goes cold for K
 *       consecutive runs, and does NOT re-fire on a 4th empty (dedupe),
 *   (2) NEVER flags a healthy scraper (no false positive),
 *   (3) CLEARS on a good run and RE-ARMS, firing again on a fresh rot episode,
 *   (4) tracks two scrapers INDEPENDENTLY (one rotting doesn't taint the other).
 *
 * Storage is the offline InMemoryRunStore — deterministic, no network/DB.
 *
 * Run: tsx tests/frontier/run-history.test.ts
 */

import { test, assert, assertEqual, run } from '../_assert.js';
import {
  RunHistory,
  InMemoryRunStore,
  PgRunStore,
  type Run,
  type RotAlert,
} from '../../src/flights/monitoring/run-history.js';

let clock = 1_000_000;
function nextTs(): number {
  return (clock += 60_000); // 1-minute spacing, deterministic
}

/** Build a RunHistory with K=3 and an alert spy capturing fired episodes. */
function makeHistory() {
  const store = new InMemoryRunStore();
  const rh = new RunHistory(store, 3);
  const alerts: RotAlert[] = [];
  rh.onAlert((a) => alerts.push(a));
  return { rh, alerts, store };
}

async function ok(rh: RunHistory, scraper: string, count = 20): Promise<void> {
  await rh.recordRun({ ts: nextTs(), scraper, route: 'JFK-LHR', outcome: 'ok', count });
}
async function empty(rh: RunHistory, scraper: string): Promise<void> {
  await rh.recordRun({ ts: nextTs(), scraper, route: 'JFK-LHR', outcome: 'empty', count: 0 });
}
async function error(rh: RunHistory, scraper: string): Promise<void> {
  await rh.recordRun({ ts: nextTs(), scraper, route: 'JFK-LHR', outcome: 'error', count: 0 });
}

// ── (1) rot detected, fires exactly once ──
test('rot fires once when a working scraper goes cold for K runs', async () => {
  const { rh, alerts } = makeHistory();
  const S = 'flying-blue-cdp';

  // Healthy stretch — never suspect.
  for (let i = 0; i < 4; i++) {
    await ok(rh, S);
    const r = await rh.detectScraperRot(S);
    assert(!r.suspect && !r.fired, `healthy run ${i} should not be suspect`);
  }

  // Three consecutive empties → rot, fired exactly on the 3rd.
  await empty(rh, S);
  let r = await rh.detectScraperRot(S);
  assert(!r.suspect, '1st empty: not yet rot');

  await empty(rh, S);
  r = await rh.detectScraperRot(S);
  assert(!r.suspect, '2nd empty: not yet rot');

  await empty(rh, S);
  r = await rh.detectScraperRot(S);
  assert(r.suspect && r.fired, '3rd empty: rot detected + fired');

  // 4th empty → still suspect, but NO re-alert (dedupe).
  await empty(rh, S);
  r = await rh.detectScraperRot(S);
  assert(r.suspect && !r.fired, '4th empty: still rot but must not re-fire');

  assertEqual(alerts.length, 1, 'alert hook must fire exactly once per episode');
  assertEqual(alerts[0].scraper, S, 'alert carries the rotting scraper');
  assertEqual(alerts[0].runs.length, 3, 'alert carries the K offending runs');
});

// ── (2) healthy scraper never flagged ──
test('healthy scraper is never flagged', async () => {
  const { rh, alerts } = makeHistory();
  const S = 'aa-cdp';
  for (let i = 0; i < 8; i++) {
    await ok(rh, S);
    const r = await rh.detectScraperRot(S);
    assert(!r.suspect && !r.fired, `run ${i} must stay healthy`);
  }
  assertEqual(alerts.length, 0, 'no alerts for a healthy scraper');
});

// ── (3) clears on recovery and re-arms for a new episode ──
test('recovers on a good run and re-arms for a fresh rot episode', async () => {
  const { rh, alerts } = makeHistory();
  const S = 'alaska-curlffi';

  // Establish history, then rot #1 (mix of error+empty both count).
  await ok(rh, S);
  await ok(rh, S);
  await error(rh, S);
  await empty(rh, S);
  await error(rh, S);
  let r = await rh.detectScraperRot(S);
  assert(r.suspect && r.fired, 'rot episode #1 fires');
  assertEqual(alerts.length, 1, 'one alert so far');

  // A good run clears the rot.
  await ok(rh, S);
  r = await rh.detectScraperRot(S);
  assert(!r.suspect && !r.fired, 'good run clears rot');

  // New rot episode → must fire AGAIN (re-armed).
  await empty(rh, S);
  await empty(rh, S);
  await empty(rh, S);
  r = await rh.detectScraperRot(S);
  assert(r.suspect && r.fired, 'rot episode #2 re-fires after recovery');
  assertEqual(alerts.length, 2, 'two distinct episodes alerted');
});

// ── (4) two scrapers tracked independently ──
test('two scrapers are tracked independently', async () => {
  const { rh, alerts } = makeHistory();
  const A = 'cathay-curlffi';
  const B = 'delta-va-curlffi';

  // B stays healthy throughout; A rots.
  await ok(rh, A);
  await ok(rh, A);
  await ok(rh, B);

  await empty(rh, A);
  await ok(rh, B);
  let ra = await rh.detectScraperRot(A);
  let rb = await rh.detectScraperRot(B);
  assert(!ra.suspect && !rb.suspect, 'neither rotting yet');

  await empty(rh, A);
  await ok(rh, B);
  await empty(rh, A);
  ra = await rh.detectScraperRot(A);
  rb = await rh.detectScraperRot(B);
  assert(ra.suspect && ra.fired, 'A rots and fires');
  assert(!rb.suspect && !rb.fired, "B unaffected by A's rot");

  assertEqual(alerts.length, 1, 'only A alerted');
  assertEqual(alerts[0].scraper, A, 'the alert is for A, not B');
});

// ── guard: cold-start / never-worked scraper is not flagged as rot ──
test('a scraper that has only ever been empty is NOT flagged (no prior good run)', async () => {
  const { rh, alerts } = makeHistory();
  const S = 'turkish-api';
  await empty(rh, S);
  await empty(rh, S);
  await empty(rh, S);
  await empty(rh, S);
  const r = await rh.detectScraperRot(S);
  assert(!r.suspect && !r.fired, 'never-worked scraper is not rot — nothing to lose');
  assertEqual(alerts.length, 0, 'no alert for a scraper that never produced');
});

// ── guard: PgRunStore is injectable and offline-safe (no real DB touched) ──
test('PgRunStore uses the injected pool only (offline)', async () => {
  const calls: { text: string; params?: unknown[] }[] = [];
  const fakePool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (/SELECT/i.test(text)) {
        // Return one persisted productive run, newest-first.
        const rows: any[] = [{ ts: 1, scraper: 'x', route: 'r', outcome: 'ok', count: 5 }];
        return { rows };
      }
      return { rows: [] };
    },
  };
  const store = new PgRunStore(() => fakePool);
  const rh = new RunHistory(store, 3);
  await rh.recordRun({ scraper: 'x', route: 'r', outcome: 'ok', count: 5 });
  const recent = await store.recent('x', 4);
  assert(calls.some((c) => /INSERT/i.test(c.text)), 'record() issues an INSERT via injected pool');
  assert(recent.length === 1 && recent[0].outcome === 'ok', 'recent() maps injected rows');
  // No exception, no network — proves the DB is fully behind the injection seam.
  const _r: Run[] = recent; // type-check the mapped shape
  assert(typeof _r[0].ts === 'number', 'mapped row has numeric ts');
});

// Final case re-proves the headline end-to-end and prints the OUTCOME line.
// (run() calls process.exit() synchronously, so this must run inside the suite.)
test('OUTCOME', async () => {
  const { rh, alerts } = makeHistory();
  const S = 'headline';
  // Working stretch, then three empties (K=3) → rot fires.
  await ok(rh, S);
  await ok(rh, S);
  await empty(rh, S);
  await empty(rh, S);
  await empty(rh, S);
  let r = await rh.detectScraperRot(S);
  assert(r.suspect && r.fired, 'rot detected + fired');
  // Re-check without a new run → still suspect, no re-fire (dedupe).
  r = await rh.detectScraperRot(S);
  assert(r.suspect && !r.fired, 'no re-fire on re-check (dedupe)');
  // Recovery clears the latch.
  await ok(rh, S);
  r = await rh.detectScraperRot(S);
  assert(!r.suspect, 'recovers on good run');
  assertEqual(alerts.length, 1, 'fired once for the episode');
  console.log(
    'OUTCOME: per-scraper rot detected ✓ fires once ✓, healthy not flagged ✓, recovers+re-arms ✓',
  );
});

run();
