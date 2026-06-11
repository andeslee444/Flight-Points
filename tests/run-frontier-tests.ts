/**
 * Master proof-loop for the frontier roadmap modules.
 *
 * Runs every frontier proof test as a child process and aggregates the result.
 * Each child asserts its mechanism produces a measurably better OUTCOME
 * (throughput, ordering, dedup ratio, recovery) and prints an `OUTCOME:` line.
 *
 *   npx tsx tests/run-frontier-tests.ts   (npm run test:frontier)
 *
 * Exit 0 only if every frontier proof passes.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const TESTS = [
  ['queue', 'throughput scales with workers + fan-out + priority + dedupe'],
  ['crawl-score', 'high-value routes prioritized over cold'],
  ['singleflight', '100 concurrent identical calls → 1 execution'],
  ['ttl-policy', 'volatile routes expire faster than stable'],
  ['run-history', 'per-scraper rot detected, fires once, recovers'],
];

const dir = path.join('tests', 'frontier');
let failed = 0;

console.log('=== FRONTIER PROOF LOOP ===\n');
for (const [name, desc] of TESTS) {
  try {
    const out = execFileSync('npx', ['tsx', path.join(dir, `${name}.test.ts`)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outcome = out.split('\n').find((l) => l.includes('OUTCOME:')) || '(no OUTCOME line)';
    console.log(`✓ ${name.padEnd(16)} ${desc}`);
    console.log(`    ${outcome.trim()}`);
  } catch (e: any) {
    failed++;
    console.log(`✗ ${name.padEnd(16)} FAILED`);
    console.log(((e.stdout || e.message || '') as string).split('\n').slice(-6).join('\n'));
  }
}

console.log(`\n=== ${TESTS.length - failed}/${TESTS.length} frontier modules proven, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
