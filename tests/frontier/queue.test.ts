/**
 * Proof tests for the job queue + producer + worker pool (InMemory backend).
 *
 * The point of these tests is not "does it run" but "does the mechanism produce
 * a measurably BETTER OUTCOME than the naive alternative":
 *   1. THROUGHPUT  — concurrency=5 finishes 20 jobs in ~4x less wall-time than
 *                    serial, and the pool actually keeps 5 handlers in flight.
 *   2. FAN-OUT     — buildJobs over 12 distinct identities → exactly 12 jobs,
 *                    each run exactly once (no double-run, no drops).
 *   3. PRIORITY    — higher-priority jobs dequeue before lower ones.
 *   4. DEDUPE      — adding the same dedupeKey twice while pending → one run.
 *
 * Deterministic: no network, no DB. Uses real timers with small sleeps (the
 * repo allows normal timers in test code).
 *
 *   npx tsx tests/frontier/queue.test.ts
 */
import { test, assert, assertEqual, run } from '../_assert.js';
import { InMemoryQueue } from '../../src/flights/queue/job-queue.js';
import { buildJobs, type SearchSpec } from '../../src/flights/queue/producer.js';
import { runWorkers } from '../../src/flights/queue/worker-pool.js';
import type { CabinCode } from '../../src/flights/types.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Collect outcome fragments to print one OUTCOME line at the very end.
const outcome: string[] = [];

// ── 1. THROUGHPUT: concurrency is worker-bounded, not serial ──────────────────

test('throughput: 20 jobs @ concurrency=5 ≈ ⌈20/5⌉×fake (not serial) and peak==5', async () => {
  const FAKE_MS = 10;
  const N = 20;
  const C = 5;
  const SERIAL_MS = N * FAKE_MS; // 200ms if run one-at-a-time

  const queue = new InMemoryQueue<number>();
  let peakSeenInHandler = 0;
  let live = 0;

  for (let i = 0; i < N; i++) {
    await queue.add(i);
  }
  assertEqual(queue.size(), N, 'all 20 jobs should be enqueued before processing');

  const fake = async (_job: number) => {
    live++;
    if (live > peakSeenInHandler) peakSeenInHandler = live;
    await sleep(FAKE_MS);
    live--;
  };

  const start = Date.now();
  const pool = runWorkers(queue, C, fake);
  await pool.done;
  const elapsed = Date.now() - start;

  // All jobs ran exactly once.
  assertEqual(pool.stats.jobsRun, N, 'every job should run exactly once');
  assertEqual(queue.size(), 0, 'queue should be fully drained');

  // Parallelism is REAL: peak in-flight is exactly the concurrency cap (proves
  // it is worker-bounded, not stuck at 1, and never exceeds the cap).
  assertEqual(pool.stats.maxObservedConcurrency, C, 'pool should observe exactly 5 concurrent');
  assertEqual(peakSeenInHandler, C, 'handler should see exactly 5 simultaneous in-flight');

  // Wall-time is near the parallel ideal (⌈20/5⌉×10 = 40ms), nowhere near serial
  // (200ms). Allow generous slack for timer jitter but stay well under serial.
  const ideal = Math.ceil(N / C) * FAKE_MS; // 40ms
  assert(
    elapsed < SERIAL_MS * 0.6,
    `wall-time ${elapsed}ms should be far below serial ${SERIAL_MS}ms (≈${ideal}ms ideal)`,
  );
  assert(elapsed >= ideal, `wall-time ${elapsed}ms cannot beat the parallel ideal ${ideal}ms`);

  const speedup = (SERIAL_MS / elapsed).toFixed(1);
  outcome.push(
    `throughput ${N} jobs @c${C} in ${elapsed}ms (~${speedup}x serial speedup) ok, max-concurrency=${pool.stats.maxObservedConcurrency} ok`,
  );
});

// ── 2. FAN-OUT: 12 distinct identities → 12 jobs, each run exactly once ───────

test('fan-out: buildJobs over 12 distinct (scraper,route,date) → 12 jobs, each run once', async () => {
  const cabins: CabinCode[] = ['economy', 'business', 'first'];
  const scrapers = ['aa-cdp', 'flyingblue-cdp', 'alaska-curlffi'];
  const dates = ['2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15'];

  // Build 12 distinct identities: 3 scrapers × 4 dates (route fixed). Then add
  // CABIN VARIANTS of the same identities — these must collapse, not multiply.
  const searches: SearchSpec[] = [];
  let ci = 0;
  for (const scraperKey of scrapers) {
    for (const date of dates) {
      const cabin = cabins[ci++ % cabins.length];
      searches.push({ scraperKey, params: { origin: 'JFK', destination: 'LHR', date, cabin } });
    }
  }
  // Inject cabin-variant + exact duplicates of the first identity (3 extra rows).
  searches.push({ scraperKey: 'aa-cdp', params: { origin: 'JFK', destination: 'LHR', date: '2026-07-01', cabin: 'business' } });
  searches.push({ scraperKey: 'aa-cdp', params: { origin: 'JFK', destination: 'LHR', date: '2026-07-01', cabin: 'first' } });
  searches.push({ scraperKey: 'aa-cdp', params: { origin: 'JFK', destination: 'LHR', date: '2026-07-01', cabin: 'economy' } });

  const jobs = buildJobs(searches);
  assertEqual(jobs.length, 12, 'dedup must collapse cabin variants → exactly 12 unique jobs');

  // Identity keys are all unique.
  const keys = new Set(jobs.map((j) => j.dedupeKey));
  assertEqual(keys.size, 12, 'all 12 job identities must be unique');

  // Process and assert each runs exactly once.
  const queue = new InMemoryQueue<typeof jobs[number]>();
  const runCount = new Map<string, number>();
  for (const j of jobs) await queue.add(j, { dedupeKey: j.dedupeKey });

  const handler = async (job: typeof jobs[number]) => {
    runCount.set(job.dedupeKey, (runCount.get(job.dedupeKey) ?? 0) + 1);
    await sleep(1);
  };
  const pool = runWorkers(queue, 4, handler);
  await pool.done;

  assertEqual(pool.stats.jobsRun, 12, '12 jobs should run');
  for (const j of jobs) {
    assertEqual(runCount.get(j.dedupeKey), 1, `job ${j.dedupeKey} must run exactly once (no double-run)`);
  }
  outcome.push('fan-out 12/12 once ok');
});

// ── 3. PRIORITY: higher priority dequeues first ──────────────────────────────

test('priority: higher-priority jobs dequeue before lower-priority ones', async () => {
  // Concurrency 1 so dequeue order is fully observable.
  const queue = new InMemoryQueue<string>();
  const order: string[] = [];

  // Add in deliberately scrambled priority order.
  await queue.add('low-A', { priority: 0 });
  await queue.add('high-1', { priority: 100 });
  await queue.add('mid-M', { priority: 50 });
  await queue.add('high-2', { priority: 100 }); // tie with high-1, must keep FIFO
  await queue.add('low-B', { priority: 0 });

  const handler = async (job: string) => {
    order.push(job);
    await sleep(1);
  };
  const pool = runWorkers(queue, 1, handler);
  await pool.done;

  // Expected: priority desc, FIFO within ties.
  assert(order[0] === 'high-1', `first dequeued should be highest priority, got ${order[0]}`);
  assert(order[1] === 'high-2', `tie should preserve FIFO (high-2 second), got ${order[1]}`);
  assert(order[2] === 'mid-M', `mid priority third, got ${order[2]}`);
  assert(order[3] === 'low-A', `low FIFO: low-A fourth, got ${order[3]}`);
  assert(order[4] === 'low-B', `low FIFO: low-B fifth, got ${order[4]}`);

  // Negative control: order is NOT the insertion order (which started with low-A).
  assert(order[0] !== 'low-A', 'priority must override insertion order (low-A not first)');

  outcome.push('__PRIORITY_OK__');
});

// ── 4. DEDUPE: same dedupeKey twice while pending → one execution ─────────────

test('dedupe: same dedupeKey added twice while pending yields exactly one run', async () => {
  const queue = new InMemoryQueue<string>();
  let runs = 0;

  // Fire two adds with the SAME dedupeKey before any processing starts (both pending).
  await queue.add('payload-v1', { dedupeKey: 'aa-cdp|JFK|LHR|2026-07-01' });
  await queue.add('payload-v2', { dedupeKey: 'aa-cdp|JFK|LHR|2026-07-01' });

  // Also add a DIFFERENT key — proves dedupe is per-key, not global suppression.
  await queue.add('other', { dedupeKey: 'aa-cdp|JFK|LHR|2026-07-02' });

  assertEqual(queue.size(), 2, 'duplicate pending dedupeKey must be suppressed → 2 pending, not 3');

  const handler = async (_job: string) => {
    runs++;
    await sleep(1);
  };
  const pool = runWorkers(queue, 2, handler);
  await pool.done;

  assertEqual(runs, 2, 'dedup → one run for the repeated key + one for the distinct key');

  // POSITIVE control: once a key has STARTED, the same key can re-enqueue (the
  // key is released at start, not held forever). Re-add after drain → runs again.
  await queue.add('payload-v3', { dedupeKey: 'aa-cdp|JFK|LHR|2026-07-01' });
  const pool2 = runWorkers(queue, 1, handler);
  await pool2.done;
  assertEqual(runs, 3, 'a fresh enqueue of a now-released key must run again (not permanently suppressed)');

  outcome.push('__DEDUPE_OK__');
});

// ── Final single OUTCOME line ────────────────────────────────────────────────

test('OUTCOME summary', async () => {
  // This test runs last; it just emits the consolidated outcome line.
  assert(outcome.length === 4, 'all four proof sub-tests should have contributed an outcome fragment');
  // Combine priority + dedupe fragments into one "priority+dedupe ok" clause,
  // matching the required OUTCOME shape.
  const hasPriority = outcome.includes('__PRIORITY_OK__');
  const hasDedupe = outcome.includes('__DEDUPE_OK__');
  assert(hasPriority && hasDedupe, 'priority and dedupe proofs must both have passed');
  const head = outcome.filter((f) => f !== '__PRIORITY_OK__' && f !== '__DEDUPE_OK__');
  console.log(`OUTCOME: ${head.join(', ')}, priority+dedupe ok`);
});

run();
