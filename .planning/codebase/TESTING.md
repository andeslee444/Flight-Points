# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- No test framework — tests are standalone `tsx` scripts executed directly via Node
- No jest, vitest, mocha, or any assertion library
- Config: none (no `jest.config.*`, no `vitest.config.*`)

**Assertion Library:**
- None — tests use `console.log` output and exit codes to communicate pass/fail
- `process.exit(1)` on failure, `process.exit(0)` on success

**Run Commands:**
```bash
npx tsx tests/test-all-scrapers.ts      # Run full scraper regression test
npx tsx tests/test-each-scraper.ts      # Per-scraper with data quality validation
npx tsx tests/test-curlffi-scrapers.ts  # curl_cffi scrapers only
npx tsx tests/test-e2e-scrapers.ts      # E2E test of working scrapers via proxy
npx tsx tests/test-registry.ts          # Registry inspection (no network)
npx tsx tests/test-each-scraper.ts aa   # Single scraper by key
npx tsx tests/test-each-scraper.ts delta united   # Multiple scrapers by key
```

## Test File Organization

**Location:**
- All tests in `/tests/` directory at project root
- Legacy/exploratory tests in `/tests/scrapers/` subdirectory
- Source lives in `/src/` — tests import from `../src/flights/...`

**Naming:**
- Pattern: `test-{scope}.ts` (e.g., `test-each-scraper.ts`, `test-curlffi-scrapers.ts`, `test-registry.ts`)
- Individual airline tests: `test-{airline}-{scraper|api}.ts` (e.g., `test-jetblue-api.ts`, `test-turkish-api.ts`, `test-ana-scraper.ts`)

**Structure:**
```
tests/
├── test-all-scrapers.ts         # Full regression: all scrapers, saves report to data/
├── test-each-scraper.ts         # Per-scraper with data quality validation, filterable by key
├── test-curlffi-scrapers.ts     # curl_cffi-specific tests with field validation
├── test-e2e-scrapers.ts         # E2E test of active scrapers (requires proxy)
├── test-live-scrapers.ts        # E2E test via SCRAPER_REGISTRY
├── test-registry.ts             # Registry inspection/status check (no network calls)
├── test-jetblue-api.ts          # JetBlue API single-scraper test
├── test-turkish-api.ts          # Turkish API single-scraper test
├── test-ana-scraper.ts          # ANA single-scraper test
├── test-cathay.ts               # Cathay curl_cffi single-scraper test
├── test-united-v2.ts            # United scraper test
├── test-sq-scraper.ts           # Singapore Airlines test
├── test-scraper-list.ts         # Scraper enumeration utility
└── scrapers/                    # Legacy exploratory tests (not for regular use)
```

## Test Structure

**Suite Organization:**

Tests follow one of two patterns:

**Pattern 1 — IIFE single-scraper test** (simple, for one scraper):
```typescript
import 'dotenv/config';
import { searchANA } from '../src/flights/scrapers/ana.js';

(async () => {
  console.log('ANA_USERNAME:', process.env.ANA_USERNAME ? `${process.env.ANA_USERNAME.substring(0,4)}...` : 'NOT SET');

  try {
    const results = await searchANA({ origin: 'JFK', destination: 'NRT', date: '2026-03-15', cabin: 'business' });
    console.log(`ANA results: ${results.length}`);
    for (const r of results.slice(0, 3)) {
      console.log(`  ${r.source} | ${r.airline} ${r.flightNumber} | ${r.pointsRequired} miles`);
    }
  } catch (e: any) {
    console.error('ANA error:', e.message);
  }
  process.exit(0);
})();
```

**Pattern 2 — main() with test array + summary** (multi-scraper, filterable):
```typescript
import 'dotenv/config';
import { SearchParams, FlightResult } from '../src/flights/types.js';

const filter = process.argv[2]?.toLowerCase() || '';

interface TestCase {
  name: string;
  search: (params: SearchParams) => Promise<FlightResult[]>;
  params: SearchParams;
  filter: string;
}

const tests: TestCase[] = [ /* ... */ ];

async function runTest(tc: TestCase): Promise<{ pass: boolean; count: number; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const results = await tc.search(tc.params);
    const ms = Date.now() - start;
    return { pass: results.length > 0, count: results.length, ms };
  } catch (err: any) {
    return { pass: false, count: 0, ms: Date.now() - start, error: err.message };
  }
}

async function main() {
  const filtered = filter ? tests.filter(t => t.filter === filter) : tests;
  let passed = 0, failed = 0;
  for (const tc of filtered) {
    const result = await runTest(tc);
    if (result.pass) { passed++; } else { failed++; }
  }
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

**Patterns:**
- Timing: every test captures `Date.now()` before and after the scraper call
- Results printed as `N results in X.Xs`
- Sample display: always show `results.slice(0, 3)` for spot-checking
- Separator lines: `'='.repeat(50)` or `'='.repeat(60)` before each test
- Future dates: generated dynamically with `new Date()` + offset, not hardcoded

## Mocking

**Framework:** None — no mocking library used

**Patterns:**
- No mocking at all — tests call real scrapers against live airline websites
- Tests run with `dotenv/config` to load real credentials from `.env`
- Proxy dependency: curl_cffi tests require `PROXY_URL` env var pointing to Oracle VPS

**What is tested (real calls only):**
- Live HTTP requests to airline APIs
- Subprocess invocation of Python scripts
- Result count and structure validation

**What is NOT tested:**
- Unit logic in isolation (no mocking of HTTP, subprocess, or DB)
- Error paths (no simulated failures)
- Edge cases (no synthetic data)

## Fixtures and Factories

**Test Data:**
- No fixtures or factories — uses hardcoded `SearchParams` objects per test
- Standard test route: `JFK → NRT, business class` (most common)
- Secondary routes: `JFK → LHR`, `SEA → LAX`, `SIN → NRT`, `JFK → HKG`
- Dates: either hardcoded (`'2026-03-15'`) or dynamic (`today + N days`):

```typescript
// Hardcoded (pinned to a specific date):
const TEST_PARAMS: SearchParams = {
  origin: 'JFK', destination: 'NRT', date: '2026-03-15', cabin: 'business',
};

// Dynamic (preferred for CI stability):
function futureDate(daysOut: number = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().split('T')[0];
}
const params = { origin: 'JFK', destination: 'LHR', date: futureDate(30), cabin: 'business' as const };
```

**Location:**
- No dedicated fixtures directory — test params are inline in each test file

## Coverage

**Requirements:** None enforced — no coverage tooling configured

**View Coverage:**
- Not applicable — no coverage tool in the project

## Test Types

**Integration Tests (primary):**
- All tests are effectively integration tests: they call real scrapers with real network access
- `tests/test-each-scraper.ts` — comprehensive per-scraper integration test with data quality checks
- `tests/test-all-scrapers.ts` — runs all scrapers sequentially, writes `data/scraper-test-report.json`
- `tests/test-curlffi-scrapers.ts` — curl_cffi scrapers with field-level validation

**E2E Tests:**
- `tests/test-e2e-scrapers.ts` — tests active scrapers via SCRAPER_REGISTRY with `Promise.race` timeout
- `tests/test-live-scrapers.ts` — SSE/live search path

**Registry/Unit-like Tests:**
- `tests/test-registry.ts` — inspects SCRAPER_REGISTRY without making network calls; verifies registry structure and program mappings
- `tests/test-scraper-list.ts` — enumerates scrapers for audit

**Single-Scraper Smoke Tests:**
- `tests/test-{airline}-api.ts` — quick API smoke test for a new scraper
- Pattern: one airline, multiple cabin classes, multiple routes

## Common Patterns

**Timeout Handling:**
```typescript
// Standard pattern: Promise.race with timeout
const results = await Promise.race([
  entry.search(params),
  new Promise<FlightResult[]>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout 90s')), 90_000)
  ),
]);
```

**Field Validation:**
```typescript
// Data quality check pattern (from test-each-scraper.ts)
function validateResults(results: FlightResult[]): DataQualityReport {
  const issues: string[] = [];
  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const r = results[i];
    if (!r.airline) issues.push(`result[${i}]: missing airline`);
    if (!r.flightNumber) issues.push(`result[${i}]: missing flightNumber`);
    if (!r.pointsRequired && !r.cashPrice) issues.push(`result[${i}]: missing points & cash`);
    // ...
  }
  return { hasAirline, hasFlightNumber, ..., issues };
}
```

**Credential Checking:**
```typescript
// Env var check before running test
function checkEnvVars(vars: ScraperTest['envVars']): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const v of vars) {
    if (v.required && !process.env[v.name]) missing.push(v.name);
  }
  return { ok: missing.length === 0, missing };
}
// If check fails: status = 'skipped', process continues
```

**Report Saving:**
```typescript
// All comprehensive test runners save a JSON report:
const reportPath = path.join(DATA_DIR, 'scraper-test-report.json');
fs.writeFileSync(reportPath, JSON.stringify({
  testParams: TEST_PARAMS,
  testedAt: new Date().toISOString(),
  results,
}, null, 2));
console.log(`Report saved to: ${reportPath}`);
```

**Error Testing:**
```typescript
// Error testing pattern: catch and return error string (no throw)
} catch (err: any) {
  const durationMs = Date.now() - start;
  return { pass: false, count: 0, ms: durationMs, error: err.message };
}
```

## Adding a New Test

1. Create `tests/test-{airline}-api.ts` for a single-scraper smoke test
2. Import `dotenv/config` at the top
3. Use IIFE pattern (`(async () => { ... })()`) for simple tests
4. Set `cabin: 'business' as const` to satisfy TypeScript literal type
5. Print result count, timing, and first 3-5 results
6. `process.exit(0)` at the end
7. Add to `tests/test-each-scraper.ts` SCRAPER_TESTS array for regression coverage

---

*Testing analysis: 2026-02-26*
