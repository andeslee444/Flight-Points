/**
 * Tiny zero-dependency assertion + test-registry helper for offline unit tests.
 * Matches the repo's standalone-tsx convention: import test/assert helpers,
 * register cases at module load, then call run() from a single entry point.
 */

type TestFn = () => void | Promise<void>;

interface RegisteredTest {
  name: string;
  fn: TestFn;
}

const tests: RegisteredTest[] = [];

/** Register a test case. Executed in registration order by run(). */
export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

/** Assert a condition is truthy. */
export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Assert strict (===) equality. */
export function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Assert structural equality via JSON serialization (sufficient for plain data). */
export function assertDeepEqual(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    throw new Error(`${msg} — expected ${sb}, got ${sa}`);
  }
}

/** Execute all registered tests, print results, and exit (0 = all pass, 1 = any fail). */
export async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`PASS ${t.name}`);
      passed++;
    } catch (err: any) {
      console.log(`FAIL ${t.name}`);
      console.log(`     ${err?.message ?? err}`);
      failed++;
    }
  }
  console.log(`(${passed} passed, ${failed} failed)`);
  process.exit(failed > 0 ? 1 : 0);
}
