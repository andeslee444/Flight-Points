/**
 * Master proof-loop for the scraping-resilience approaches.
 *
 * Runs every approach's proof test as a child process and aggregates the
 * result. Each child test asserts its mechanism fires when it SHOULD and NOT
 * when it shouldn't, then prints an `OUTCOME:` line — so a green run here is
 * evidence the approaches actually improve outcomes, not just that code runs.
 *
 *   npx tsx tests/run-approach-tests.ts
 *
 * Exit 0 only if every approach test passes.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const TESTS = [
  ['session-pool', 'session reuse + retire-on-block'],
  ['rate-limit', 'rate cap + full jitter + Retry-After'],
  ['proxy-router', 'difficulty routing + graceful degradation'],
  ['fingerprint-coherence', 'flags UA skew / geo mismatch'],
  ['route-baseline', 'soft-block: count-drop + miles-drift detection'],
];

const dir = path.join('tests', 'approach');
let failed = 0;
const outcomes: string[] = [];

console.log('=== APPROACH PROOF LOOP ===\n');
for (const [name, desc] of TESTS) {
  try {
    const out = execFileSync('npx', ['tsx', path.join(dir, `${name}.test.ts`)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outcome = out.split('\n').find((l) => l.includes('OUTCOME:')) || '(no OUTCOME line)';
    console.log(`✓ ${name.padEnd(22)} ${desc}`);
    console.log(`    ${outcome.trim()}`);
    outcomes.push(`${name}: ${outcome.trim()}`);
  } catch (e: any) {
    failed++;
    console.log(`✗ ${name.padEnd(22)} FAILED`);
    const tail = (e.stdout || e.message || '').toString().split('\n').slice(-6).join('\n');
    console.log(tail);
  }
}

console.log(`\n=== ${TESTS.length - failed}/${TESTS.length} approaches proven, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
