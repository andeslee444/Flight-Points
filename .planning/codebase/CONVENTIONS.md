# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- TypeScript scraper wrappers: `{airline}-{tier}.ts` (e.g., `aa-cdp.ts`, `delta-va-curlffi.ts`, `flying-blue-patchright.ts`)
- Python scraper implementations: `{airline}-{tier}.py` (e.g., `aa-cdp.py`, `alaska-curlffi.py`)
- Shared runners: `{tier}-runner.ts` (e.g., `curlffi-runner.ts`, `patchright-runner.ts`, `camoufox-runner.ts`)
- Test files: `test-{scope}.ts` (e.g., `test-curlffi-scrapers.ts`, `test-each-scraper.ts`, `test-registry.ts`)

**Functions:**
- Search functions: `search{Airline}` for primary, `search{Airline}{Tier}` for tier variants
  - e.g., `searchAA`, `searchAACdp`, `searchAACurlFfi`, `searchAACamoufox`
- Database functions: descriptive verbs — `loadSignups`, `markAlertSent`, `pruneSentAlerts`, `upsertCacheEntries`
- Health/circuit breaker: `recordSuccess`, `recordFailure`, `isScraperAvailable`, `writeHealthFile`
- Fallback chain functions: `search{Airline}WithFallback` (private in `scrapers/index.ts`)

**Variables:**
- camelCase for all variables and parameters
- SCREAMING_SNAKE_CASE for module-level constants: `SCAN_INTERVAL_MS`, `MAX_SEARCHES_PER_CYCLE`, `CIRCUIT_BREAKER_THRESHOLD`
- `OPTS` constant pattern for scraper config objects (all caps, single module-level declaration)

**Types/Interfaces:**
- PascalCase interfaces: `FlightResult`, `SearchParams`, `ScraperEntry`, `CurlFfiRunnerOptions`
- Type aliases in PascalCase: `CabinCode`
- Database row types suffixed with `Row`: `SignupRow`, `CacheEntry`

## Code Style

**Formatting:**
- No Prettier/ESLint config detected in project root — no enforced formatter
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- ES2022 target, NodeNext modules
- Numeric separators used for large numbers: `120_000`, `10 * 1024 * 1024`, `30 * 60 * 1000`

**Linting:**
- No project-level ESLint config — relies on TypeScript compiler for type safety
- `strict: true` with `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`

## Import Organization

**Order (TypeScript files):**
1. `dotenv/config` (when needed — at top of entry points and tests)
2. Node built-in modules (`fs`, `path`, `child_process`)
3. Third-party dependencies (`pg`, `playwright`, etc.)
4. Local project imports (relative paths with `.js` extension)

**Path pattern:**
- All local imports use explicit `.js` extension (NodeNext module resolution requirement):
  ```typescript
  import { FlightResult, SearchParams } from '../types.js';
  import { getCached, setCache } from './cache.js';
  ```
- No path aliases configured — uses relative paths throughout

## Error Handling

**Database layer (`src/flights/db.ts`):**
- Every function wraps in `try/catch` and returns a safe default on error
- Pattern: catch `err: any`, log with `[DB]` prefix, return empty array/object/0/null
  ```typescript
  } catch (err: any) {
    console.error('[DB] getCacheEntries error:', err.message);
    return [];
  }
  ```
- Transactions use explicit BEGIN/ROLLBACK/COMMIT with `client.release()` in `finally`

**Scraper fallback chains (`src/flights/scrapers/index.ts`):**
- Each tier wrapped in try/catch, logs via `console.warn` with `[Registry]` prefix
- Returns empty array on failure, triggering next tier in chain
  ```typescript
  try {
    const results = await searchAACdp(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] AA CDP failed: ${err.message}`);
  }
  ```
- Final fallback is always the Playwright variant (no try/catch — throws to caller)

**Subprocess runners (`src/flights/scrapers/curlffi-runner.ts`, `patchright-runner.ts`):**
- `resolve(null)` on subprocess error (signals retry)
- `resolve([])` on JSON parse failure
- Exponential backoff: `retryBaseDelay * Math.pow(2, attempt - 1)`
- All retries exhausted → resolve outer promise with `[]`

**Python scrapers:**
- All logging goes to `stderr`
- JSON output goes to `stdout`
- On validation error: log to stderr, `print("[]")`, `sys.exit(0)` (not exit code 1)
- `validate_params()` function called at top of `main()` for all Python scrapers

## Logging

**Framework:** `console.log` / `console.warn` / `console.error` directly (no logger library)

**Patterns:**
- Daemon: prefixed timestamps via local `log()` function: `[${ts}] ${msg}`
- Scrapers: bracketed module name + timestamp: `[AA-CDP 14:23:01] message`
- Registry: `[Registry] ${key} failed: ${msg}`
- DB layer: `[DB] ${functionName} error: ${msg.message}`
- Circuit breaker: `[CircuitBreaker] ${scraperKey} disabled after N consecutive failures`
- Cache: `[Cache] Disk read error for ${key}: ${msg}`
- Python scrapers: `[AA-CDP HH:MM:SS] message` to stderr

## Comments

**File-level JSDoc:**
- Every TypeScript file begins with a `/** ... */` block listing purpose and creation date
- Multi-line change history is included inline for major files:
  ```typescript
  /**
   * Flight Monitor Daemon
   * ...
   * Started: 2026-02-16
   * Updated: 2026-02-17 — atomic writes
   * Updated: 2026-02-18 — migrated to PostgreSQL
   */
  ```

**Inline Comments:**
- Section dividers with `// ====` or `// ──` for visual grouping within large files
- Inline comments explain non-obvious behavior: why a fallback chain is ordered a given way, why a scraper is blocked
- Status comments on registry entries include date and context: `// 2026-02-22: Real Chrome CDP WORKING — 124 results JFK→LHR, ~20s`

**Python Docstrings:**
- Module-level docstring at top of every `.py` file, includes `Usage:` section with example invocation

## Function Design

**Size:**
- Scraper wrapper functions are minimal — delegate immediately to shared runner:
  ```typescript
  export function searchAACdp(params: SearchParams): Promise<FlightResult[]> {
    return runPatchrightSearch(params, OPTS);
  }
  ```
- Business logic functions (fallback chains, daemon scan loop) are larger but sectioned with dividers

**Parameters:**
- Scraper functions uniformly accept `(params: SearchParams): Promise<FlightResult[]>`
- Options objects use named interfaces (`CurlFfiRunnerOptions`, `PatchrightRunnerOptions`) for readability
- Default values via `??` operator: `opts.maxRetries ?? CURLFFI_MAX_RETRIES`

**Return Values:**
- All scraper functions return `Promise<FlightResult[]>` — never null, never throws to caller
- DB functions return typed results or empty/null on error
- Health/utility functions return `void` or simple types

## Module Design

**Exports:**
- Named exports for all public functions and types
- No default export on most modules; `scrapers/index.ts` has `export default {}` for convenience
- Internal helpers (fallback chain functions) are not exported — they are `async function` closures at module scope

**Barrel Files:**
- `scrapers/index.ts` serves as the scraper barrel — imports all scrapers and re-exports registry + utilities
- No `index.ts` barrel for `src/flights/` — individual files imported directly

**Shared Runner Pattern:**
- New scraper tiers (curl_cffi, patchright, camoufox) use shared runner modules
- Each airline's `.ts` wrapper creates a module-level `const OPTS` config and delegates to the runner
- This eliminates duplicate retry/cache/subprocess logic across 30+ scrapers

---

*Convention analysis: 2026-02-26*
