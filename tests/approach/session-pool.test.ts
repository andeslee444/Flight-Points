/**
 * PROOF test for SessionPool (Crawlee SessionPool pattern).
 *
 * This is a proof, not a smoke test: it demonstrates the mechanism IMPROVES
 * outcomes by asserting the pool fires when it SHOULD and not when it shouldn't:
 *   (1) reuse — acquire() returns the SAME session id across repeated calls
 *       for a host (warm session preserved, no needless rotation),
 *   (2) retirement — after maxBlocks block-marks, the next acquire() returns a
 *       DIFFERENT (fresh) session id (poisoned identity burned),
 *   (3) health — healthScore drops after a block and is 1.0 after only
 *       successes (no-block optimism),
 *   (4) isolation — two different hosts get different sessions.
 *
 * Deterministic: no network, no DB. Uses an injected id factory so reuse vs.
 * fresh-identity is unambiguous.
 */

import { test, assert, assertEqual, run } from '../_assert.js';
import { SessionPool } from '../../src/flights/net/session-pool.js';

/** Deterministic monotonic id factory so assertions on "same vs fresh" are exact. */
function seqIdFactory(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

const HOST_A = 'api.cathaypacific.com';
const HOST_B = 'www.aa.com';

test('(1) acquire() reuses the SAME session id across repeated calls for a host', () => {
  const pool = new SessionPool({ idFactory: seqIdFactory() });

  const first = pool.acquire(HOST_A);
  let reuseHits = 0;
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const s = pool.acquire(HOST_A);
    if (s.id === first.id) reuseHits++;
    // Mark success so the warm session keeps its lead — mirrors real usage.
    pool.markSuccess(s);
  }
  assertEqual(reuseHits, attempts, 'every repeat acquire() should reuse the warm session');

  const stats = pool.stats();
  assertEqual(stats.created, 1, 'reuse must NOT create extra sessions for one host');
  assertEqual(stats.totalSessions, 1, 'host should hold exactly one live session');
});

test('(2) after maxBlocks blocks, acquire() returns a DIFFERENT fresh session (retirement)', () => {
  const pool = new SessionPool({ maxBlocks: 2, idFactory: seqIdFactory() });

  const original = pool.acquire(HOST_A);
  assertEqual(pool.acquire(HOST_A).id, original.id, 'still reused before any block');

  // First block: under threshold, MUST NOT retire — session still reused.
  pool.markBlocked(original);
  assertEqual(
    pool.acquire(HOST_A).id,
    original.id,
    'fires-when-it-should-not: one block (< maxBlocks) must not retire',
  );

  // Second block: reaches maxBlocks=2, MUST retire.
  pool.markBlocked(original);
  const fresh = pool.acquire(HOST_A);
  assert(fresh.id !== original.id, 'fires-when-it-should: reaching maxBlocks must retire & rotate');
  assertEqual(fresh.blockCount, 0, 'fresh session starts clean');
  assertEqual(fresh.successCount, 0, 'fresh session starts clean');

  const stats = pool.stats();
  assertEqual(stats.retired, 1, 'exactly one session retired');
  assertEqual(stats.totalSessions, 1, 'one fresh live session remains');
});

test('(2b) maxBlocks default is 2 and a single block does not retire', () => {
  const pool = new SessionPool({ idFactory: seqIdFactory() }); // default maxBlocks
  const s = pool.acquire(HOST_A);
  pool.markBlocked(s);
  assertEqual(pool.acquire(HOST_A).id, s.id, 'default: one block must not retire');
  pool.markBlocked(s);
  assert(pool.acquire(HOST_A).id !== s.id, 'default: second block (==2) must retire');
});

test('(3) healthScore is 1.0 after only successes and drops after a block', () => {
  const pool = new SessionPool({ maxBlocks: 5, idFactory: seqIdFactory() });
  const s = pool.acquire(HOST_A);

  assertEqual(s.healthScore(), 1.0, 'brand-new session is optimistically healthy (1.0)');

  pool.markSuccess(s);
  pool.markSuccess(s);
  pool.markSuccess(s);
  assertEqual(s.healthScore(), 1.0, 'pure successes keep health at 1.0');

  const before = s.healthScore();
  pool.markBlocked(s); // 3 success / 1 block => 0.75 (maxBlocks=5 so not retired)
  const after = s.healthScore();
  assert(after < before, 'a block must lower healthScore');
  assertEqual(after, 0.75, '3 successes + 1 block => 0.75');
});

test('(4) two different hosts get different sessions (per-host isolation)', () => {
  const pool = new SessionPool({ idFactory: seqIdFactory() });

  const a = pool.acquire(HOST_A);
  const b = pool.acquire(HOST_B);
  assert(a.id !== b.id, 'different hosts must not share a session');

  // Re-acquiring each host still returns that host's own session.
  assertEqual(pool.acquire(HOST_A).id, a.id, 'host A keeps its session');
  assertEqual(pool.acquire(HOST_B).id, b.id, 'host B keeps its session');

  // Retiring host A must not touch host B.
  pool.markBlocked(a);
  pool.markBlocked(a); // retire A (default maxBlocks=2)
  assert(pool.acquire(HOST_A).id !== a.id, 'host A rotated after retirement');
  assertEqual(pool.acquire(HOST_B).id, b.id, 'host B unaffected by host A retirement');

  const stats = pool.stats();
  assertEqual(stats.hosts, 2, 'two distinct hosts tracked');
});

test('OUTCOME summary', () => {
  // Reproduce the core reuse measurement for a single, human-readable summary.
  const pool = new SessionPool({ maxBlocks: 2, idFactory: seqIdFactory() });

  const first = pool.acquire(HOST_A);
  const acquires = 10;
  let reuseHits = 1; // count `first`
  for (let i = 1; i < acquires; i++) {
    const s = pool.acquire(HOST_A);
    if (s.id === first.id) reuseHits++;
    pool.markSuccess(s);
  }
  const reuseRatio = reuseHits / acquires;
  assertEqual(reuseRatio, 1.0, 'all warm acquires reused before any block');

  // Block to threshold, confirm rotation.
  pool.markBlocked(first);
  pool.markBlocked(first);
  const rotated = pool.acquire(HOST_A);
  const retiredOk = rotated.id !== first.id;
  assert(retiredOk, 'rotation after maxBlocks');

  console.log(
    `OUTCOME: reuse ratio ${(reuseRatio * 100).toFixed(0)}% (${reuseHits}/${acquires}) ok, ` +
      `healthScore 1.0-when-clean / drops-on-block ok, ` +
      `per-host isolation ok, retired-on-block ok`,
  );
});

run();
