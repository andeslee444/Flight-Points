# Codebase Concerns

**Analysis Date:** 2026-02-26

---

## Security Considerations

**Hardcoded credentials in source file:**
- Risk: Real email and password are hardcoded as default fallback values inside the scraper
- Files: `src/flights/scrapers/flying-blue-cdp.py` lines 101–102
  ```python
  email = os.environ.get('FB_LOGIN_EMAIL', 'harbortheoctopus@gmail.com')
  password = os.environ.get('FB_LOGIN_PASSWORD', 'Cheeseslice8!')
  ```
- Current mitigation: `config/airline-accounts.json` is in `.gitignore`. But `flying-blue-cdp.py` is **not** in `.gitignore` and is committed.
- Recommendation: Remove the hardcoded defaults entirely. Fail loudly if `FB_LOGIN_EMAIL` / `FB_LOGIN_PASSWORD` are not set. Run `git log --all --full-history -- src/flights/scrapers/flying-blue-cdp.py` to check if credentials are already in git history.

**Database SSL certificate verification disabled:**
- Risk: TLS connection to AWS RDS does not verify the server certificate, making it vulnerable to MITM attacks
- Files: `src/flights/db.ts` line 30
  ```typescript
  ssl: sslOff ? false : { rejectUnauthorized: false },
  ```
- Current mitigation: Production uses SSL transport (connection is encrypted), just not verified
- Recommendation: Download the AWS RDS CA bundle and set `ssl: { ca: fs.readFileSync('rds-ca.pem') }` in production

**Unauthenticated API with live scraping capability:**
- Risk: Any party can trigger live browser scrapes (CPU/memory-intensive) via `GET /api/flights/live-search`. No auth, no rate limiting, no IP blocking.
- Files: `src/flights/web-server.ts` line 376, `src/flights/live-scraper.ts`
- Current mitigation: Concurrency capped at 2 (`MAX_CONCURRENT_LIVE_SCRAPES = 2`); concurrency cap returns a soft error, not a 429
- Recommendation: Add API key header check or IP-based rate limiting via `express-rate-limit`. At minimum, return HTTP 429 instead of a 200 SSE stream with an error event when the limit is hit.

**CORS wildcard on all origins:**
- Risk: Any website can make cross-origin requests to the API, reading flight data
- Files: `src/flights/web-server.ts` line 39: `app.use(cors())`
- Current mitigation: None — defaults to `Access-Control-Allow-Origin: *`
- Recommendation: Restrict to known origins (e.g. vercel deployment URL) using `cors({ origin: [...] })`

**Signup endpoint accepts arbitrary JSON without validation:**
- Risk: POST `/api/flights/signup` inserts raw `body` fields directly into the database with minimal sanitization. `addSignup(body)` uses `entry.type || null`, etc., but does not validate field types or lengths.
- Files: `src/flights/web-server.ts` lines 192–207, `src/flights/db.ts` `addSignup()` lines 274–295
- Current mitigation: PostgreSQL parameterized queries prevent SQL injection; field length is unchecked
- Recommendation: Validate and whitelist allowed fields before calling `addSignup()`

---

## Tech Debt

**`monitor.ts` is a god-file with mixed concerns:**
- Issue: `src/flights/monitor.ts` contains: the search orchestrator (`searchFlights()`), helper utilities exported to `web-server.ts` (`cabinDisplayName`, `computeDealRating`, `findPartnerForSource`, `estimateCashPrice`, `getBookingUrl`, `normalizeAirlineName`), an in-memory rate limiter, a file-based cache to `data/flight-cache/`, and a signup converter. The search orchestrator (`searchFlights`) is no longer called anywhere — only the utility exports are used.
- Files: `src/flights/monitor.ts` (465 lines)
- Impact: Misleading entrypoint (`"main": "dist/flights/monitor.js"` in `package.json` points here). Dead rate-limit code and file-based cache remain alongside live utility functions.
- Fix approach: Extract the six utility functions (`cabinDisplayName` etc.) into a dedicated `src/flights/result-enrichment.ts` module. Remove the dead `searchFlights`, `isRateLimited`, `cacheResults`, `getCachedResults` code.

**`history.ts` is orphaned dead code:**
- Issue: `src/flights/history.ts` implements a price-history file store, but nothing imports it. The project migrated all data to PostgreSQL, leaving this module unused.
- Files: `src/flights/history.ts` (109 lines)
- Impact: Confusing — suggests a price-history feature exists when it does not
- Fix approach: Delete `src/flights/history.ts` or, if price-history tracking is a desired future feature, add a DB-backed version

**`seats-aero.ts`, `awardfares.ts`, `expertflyer.ts` are dead code:**
- Issue: None of these files are imported by any active module. `seats-aero.ts` is still referenced inside `src/flights/scrapers/united.ts` via an inline `searchSeatsAero()` helper that calls the seats.aero API, but the registry never routes through `united.ts` for live searches.
- Files: `src/flights/scrapers/seats-aero.ts` (360 lines), `src/flights/scrapers/awardfares.ts` (196 lines), `src/flights/scrapers/expertflyer.ts` (225 lines)
- Impact: Maintenance noise; seats.aero is explicitly prohibited (see CLAUDE.md)
- Fix approach: Delete these three files and remove the `searchSeatsAero` call in `united.ts`

**10 leftover debug Python files committed to the repository:**
- Issue: 10 sequential debug iterations of the Delta/VA scraper exist in the scrapers directory: `delta-va-debug.py` through `delta-va-debug10.py`
- Files: `src/flights/scrapers/delta-va-debug.py` — `src/flights/scrapers/delta-va-debug10.py`
- Impact: ~4,000 lines of debug noise; confuses new developers about the authoritative implementation
- Fix approach: Delete all 10 files. The production scraper is `delta-va-curlffi.py`.

**`scripts/` directory contains 5 redundant exploratory test files:**
- Issue: `scripts/test-united-api.ts` through `scripts/test-united-api5.ts` and `scripts/inspect-gf.ts` are one-off investigation scripts, not part of the test suite
- Files: `scripts/test-united-api.ts`, `scripts/test-united-api2.ts`, `scripts/test-united-api3.ts`, `scripts/test-united-api4.ts`, `scripts/test-united-api5.ts`, `scripts/inspect-gf.ts`
- Impact: Repository clutter; unclear whether they are authoritative
- Fix approach: Delete or move to a `scratch/` folder excluded by `.gitignore`

**`data/flight-monitor-history.json` is an orphaned 1.7MB file no longer read:**
- Issue: This file was the pre-migration persistence layer. All data moved to PostgreSQL. The file remains on disk (45,000 lines) and is in `.gitignore`, but it persists on the production machine consuming space and creating confusion.
- Files: `data/flight-monitor-history.json`
- Impact: Disk space on the daemon host; confusion about whether the system uses files or DB
- Fix approach: Delete file on the Harbor Mac Mini host after confirming PostgreSQL data is populated

**`aa-fast.ts` batch mode ignores the `aa-cdp.ts` fast path used by the daemon:**
- Issue: `flight-daemon.ts` calls `searchAAFastBatch()` (Camoufox batch) as the first tier, but the registry's `searchAAWithFallback()` uses `searchAACdp()` (real Chrome CDP, faster and more reliable) first. The daemon and the live-search code use different fallback orderings for the same airline.
- Files: `src/flights/flight-daemon.ts` lines 300–330, `src/flights/scrapers/index.ts` lines 66–96
- Impact: The daemon may use the slower/less-reliable Camoufox path while live search uses the faster CDP path
- Fix approach: Have the daemon call `searchAAWithFallback()` (or its batch equivalent) instead of `searchAAFastBatch()`

**`requirements.txt` has no pinned versions:**
- Issue: `requirements.txt` specifies only minimum versions (`camoufox>=0.4.0`, `curl_cffi>=0.7.0`, `patchright>=1.58.0`). Breaking changes in any of these anti-detect libraries can silently break scrapers.
- Files: `requirements.txt`
- Impact: Non-reproducible builds; VPS environment (`patchright 1.58`) may differ from local
- Fix approach: Pin exact versions that are known to work, e.g. `patchright==1.58.0`. Generate with `pip freeze > requirements-lock.txt`.

---

## Known Bugs

**`is_logged_in()` in flying-blue-cdp.py uses a hardcoded username string for login detection:**
- Symptoms: If the Flying Blue account username is changed or a different account is used, the login check `'harbor' in header.lower()` returns `False`, causing the scraper to re-attempt login every single run and hit rate limits (session becomes a "Due to a technical error" block after 3 failed attempts)
- Files: `src/flights/scrapers/flying-blue-cdp.py` line 57
- Trigger: Any change to the Flying Blue account name or login email
- Workaround: The fallback `'log in' not in header.lower()` catches most cases, but is fragile

**Circuit breaker health state is lost on daemon restart:**
- Symptoms: If a scraper is circuit-broken (after 5 consecutive failures), the state lives only in in-memory `stats` Map in `scraper-health.ts`. Restarting the daemon resets all circuit breakers, allowing known-broken scrapers to retry immediately.
- Files: `src/flights/scraper-health.ts` (in-memory `stats` Map, never read from DB on startup), `src/flights/db.ts` `writeScraperHealth()` (writes but no corresponding `readScraperHealth()`)
- Trigger: Normal daemon restart or crash
- Workaround: None — scraper health is written to DB but never loaded back

**Zero-result fallback chains can silently succeed with stale route coverage:**
- Symptoms: In all fallback chains (e.g. `searchAAWithFallback`), each tier returns early only if `results.length > 0`. A route that genuinely has no available award seats causes ALL tiers to run serially, adding significant latency (up to ~3 minutes for a fully-blocked route) with no way to distinguish "no flights" from "scraper blocked."
- Files: `src/flights/scrapers/index.ts` lines 66–260 (all `if (results.length > 0) return results;` patterns)
- Impact: Live search latency inflated for routes where all scrapers return empty

**Flying Blue CDP session requires manual re-login approximately every hour:**
- Symptoms: After session expiry, `searchFlyingBlueCdp()` fails silently (returns `[]`) rather than alerting that a re-login is needed. The daemon will fall through to other (blocked) tiers.
- Files: `src/flights/scrapers/flying-blue-cdp.py`, `src/flights/scrapers/flying-blue-cdp.ts`
- Trigger: Normal session expiry (~1 hour per CLAUDE.md)
- Workaround: Run `python3 src/flights/scrapers/flying-blue-cdp.py login` manually to refresh the Chrome profile

---

## Performance Bottlenecks

**Full scan results stored as JSONB in `monitor_scans`:**
- Problem: `addScan(scanTime, allResults)` serializes the entire `FlightResult[]` array (potentially hundreds of flights) as a JSONB blob into `monitor_scans.results` every 30 minutes. After 48 scans (the prune limit) this table holds up to 48 full scan payloads.
- Files: `src/flights/db.ts` lines 355–364, `src/flights/flight-daemon.ts` line 419
- Cause: `monitor_scans.results` column is `JSONB NOT NULL DEFAULT '[]'` in the schema; no per-row size limits
- Improvement path: `monitor_scans.results` is never actually queried by the web server — only `scan_time` is read (`getLastScanTime()`). Remove the `results` column from `monitor_scans` inserts, or replace it with a result count integer.

**Flying Blue CDP scraper has ~50s latency from hardcoded `time.sleep()` calls:**
- Problem: `flying-blue-cdp.py` contains 20+ `time.sleep()` calls with fixed delays (ranging from 0.3s to 5s) for DOM interactions. Total UI interaction time is approximately 40–60 seconds per search, making it the slowest active scraper.
- Files: `src/flights/scrapers/flying-blue-cdp.py` (20+ sleep calls)
- Cause: Conservative delays for anti-bot avoidance; no use of `page.wait_for_selector()` or `expect(locator).to_be_visible()`
- Improvement path: Replace fixed sleeps with Patchright `page.wait_for_selector(selector, timeout=...)` where possible; keep minimum human-like jitter only where required

**`upsertLiveCacheResults()` performs a read-modify-write per route key inside a transaction:**
- Problem: For each route key returned by a live search, the function reads the existing `award_flights` JSON blob, deduplicates in Python, then writes back the full array. For routes with many cached flights this is an O(n²) in-memory dedup operation.
- Files: `src/flights/db.ts` lines 160–232
- Cause: JSONB dedup must be done in application layer; no DB-level unique constraint on flight entries within the JSONB array
- Improvement path: Use a proper `flights` table (one row per flight) with a unique index on `(route_key, flight_number, departure_date, source)` instead of JSONB arrays

**The in-memory scraper cache is per-process and not shared between daemon and web server:**
- Problem: The daemon and web server run as separate processes. The in-memory cache in `src/flights/scrapers/cache.ts` is not shared; each process maintains its own 500-entry cache. A live search result cached in the web server process is not visible to the daemon and vice versa.
- Files: `src/flights/scrapers/cache.ts`, `src/flights/scraper-config.ts` (`CACHE_MAX_ENTRIES = 500`)
- Current mitigation: Both processes share the PostgreSQL `flight_cache` table as the durable shared store
- Improvement path: This is acceptable as-is since the DB is the authoritative cache; just be aware the in-memory layer only benefits individual process call patterns

---

## Fragile Areas

**Chrome CDP port allocation uses random ports 9222–9322 with a 3-try limit:**
- Files: `src/flights/scrapers/chrome_cdp.py` lines 78–113
- Why fragile: If multiple scrapers run concurrently (daemon + live-search), they may collide on ports. The 3-attempt limit means a third concurrent CDP scraper could fail silently with "Port X failed" and return empty results.
- Safe modification: Increase port range or implement file-based port locking via `fcntl` lockfiles in `/tmp/`
- Test coverage: None — port collision is untested

**Flying Blue login check relies on DOM text scanning of first 300 characters:**
- Files: `src/flights/scrapers/flying-blue-cdp.py` lines 52–57
  ```python
  header = page.evaluate("() => document.body?.innerText?.substring(0, 300) || ''")
  return 'harbor' in header.lower() or ('log in' not in header.lower() and len(header) > 50)
  ```
- Why fragile: Depends on account display name and Air France UI layout. Any UI redesign (moving the username further down the page) or account name change breaks the login detection silently.
- Safe modification: Check for the presence of a logout button selector (e.g. `[data-testid="logout-button"]`) rather than scanning text content

**`estimateCashPrice()` uses static lookup tables with no market data:**
- Files: `src/flights/monitor.ts` lines 188–206
- Why fragile: Cash price estimates drive CPP calculations and deal ratings. The values are fixed (e.g. US-EU business = $4,000 regardless of season or route). A route like JFK→LHR might vary from $2,500 to $12,000. Stale estimates can inflate or deflate CPP, causing false "hot deal" ratings.
- Safe modification: These are fallback-only — `estimateCashPrice()` is only called when Google Flights doesn't return a result. Acceptable short-term; consider adding route-specific overrides for the highest-traffic routes.
- Test coverage: None

**`deduplicateResults()` falls back to a 5-field key when `flightNumber` is missing:**
- Files: `src/flights/scrapers/index.ts` lines 530–552
  ```typescript
  const key = result.flightNumber
    ? `${result.flightNumber}-${result.departureDate}-${result.cabin}`
    : `${result.source}-${result.origin}-${result.destination}-${result.departureDate}-${result.departureTime}-${result.cabin}`;
  ```
- Why fragile: Scrapers that don't return `flightNumber` (e.g. calendar-level scrapers like Cathay AFR) will produce a key from `departureTime`. If two scrapers return the same flight with slightly different departure times (e.g. "14:30" vs "14:30:00"), both will be kept as separate results.
- Safe modification: Normalize departure time to HH:MM before building the fallback key

**`generateSampleDates()` in live-scraper.ts hardcodes a 7-day offset:**
- Files: `src/flights/live-scraper.ts` lines 86–95
- Why fragile: Dates are always 7, 21, 35, and 49 days out (configurable count in `LIVE_SEARCH_DATE_COUNT = 2` → only 7 and 21 days out in practice). A user searching for travel in 3 days or 6 months will get no relevant results from the live search.
- Safe modification: Accept a user-specified date from the frontend (the SSE endpoint already accepts an optional `date` query param) and use it as the primary date when present

---

## Scaling Limits

**Daemon is single-process with no horizontal scaling:**
- Current capacity: 25 searches per 30-minute cycle × 1 daemon process. At 14-day date sampling, 4 origins × 4 destinations × 4 dates = 64 search combinations per signup. A single user with a complex watch list saturates the cycle.
- Limit: Adding more users or routes requires lowering `DATE_SAMPLING_DAYS` or increasing cycle count, both with quality tradeoffs
- Scaling path: Shard searches across multiple daemon instances using PostgreSQL advisory locks on `rotation_state`

**PostgreSQL `flight_cache` table has no size limit:**
- Current capacity: Unknown; depends on number of routes and flights per route
- Limit: `pruneStaleCacheEntries(24 * 60 * 60 * 1000)` prunes entries older than 24 hours, but a sudden burst of live searches can fill the table with routes that the daemon never monitors
- Scaling path: Add a max row count guard or separate TTLs for daemon-populated vs live-populated cache entries

---

## Dependencies at Risk

**`playwright`, `playwright-extra`, and `puppeteer-extra-plugin-stealth` are largely superseded:**
- Risk: The legacy Playwright-based scrapers (`aa.ts`, `united.ts`, `delta.ts`, `singapore.ts`, `ba-avios.ts`, `flying-blue.ts`, etc.) use `playwright-extra` + `puppeteer-extra-plugin-stealth`. These are all blocked by Akamai/Auth0 and no longer provide working results. The packages remain as production dependencies (`package.json` `dependencies`, not `devDependencies`).
- Impact: Unnecessary install surface; `playwright-extra` (v4.3.6) has not been updated since 2023 and may have unpatched CVEs
- Migration plan: Move `playwright` to `devDependencies` (only used in tests). Remove `playwright-extra` and `puppeteer-extra-plugin-stealth` once the legacy `.ts` scrapers are retired.

**`patchright` Python package pinned to `>=1.58.0` without an upper bound:**
- Risk: The VPS has version 1.58 installed. Any version bump could change the CDP connect API or stealth behavior. `curl_cffi>=0.7.0` is similarly unpinned.
- Impact: Production breakage on `pip install -r requirements.txt` if a major version ships
- Migration plan: Pin to exact known-working versions; test upgrades in a separate environment first

---

## Missing Critical Features

**No alerting when a critical scraper session expires:**
- Problem: When the Flying Blue CDP session expires (roughly every hour), or when the AA CDP Chrome profile is corrupted, the system silently degrades: SkyTeam flights disappear from results, no notification is sent.
- Blocks: Reliable deal detection for SkyTeam routes (Air France, Delta, KLM)

**No database migration tooling:**
- Problem: Only `migrations/001_initial_schema.sql` exists. There is no migration runner, version tracking, or rollback mechanism. Future schema changes require manual `psql` execution.
- Blocks: Safe deployments when schema changes are needed; `migrations/002_seed_from_json.ts` was a one-time script, not a repeatable migration

**No authentication on the `POST /api/flights/signup` endpoint:**
- Problem: Anyone who discovers the endpoint can add arbitrary watch-list entries to the database, causing the daemon to execute searches and send WhatsApp alerts to an attacker-controlled phone number.
- Files: `src/flights/web-server.ts` lines 192–207
- Blocks: Safe public deployment

---

## Test Coverage Gaps

**No tests for the database layer (`db.ts`):**
- What's not tested: All functions in `src/flights/db.ts` — `upsertCacheEntries`, `upsertLiveCacheResults`, `loadSignups`, `markAlertSent`, etc. These are tested only indirectly via integration with the daemon.
- Risk: Schema changes or PostgreSQL behavior differences (e.g. JSONB NULL vs `[]`) could break silently
- Priority: High — `db.ts` is the single point of failure for all data persistence

**No tests for the alert/deal detection pipeline in `flight-daemon.ts`:**
- What's not tested: `isGoodDeal()`, `alertKey()`, `buildAllSearches()`, `isValidFlight()` in `src/flights/flight-daemon.ts`. These functions determine whether users receive notifications.
- Files: `src/flights/flight-daemon.ts` lines 94–166
- Risk: Changes to sweet-spot thresholds or deal logic could silently stop alerts or generate false positives
- Priority: High

**No tests for `monitor.ts` utility functions:**
- What's not tested: `findPartnerForSource()`, `estimateCashPrice()`, `getBookingUrl()`, `computeDealRating()` in `src/flights/monitor.ts`
- Files: `src/flights/monitor.ts` lines 70–236
- Risk: Transfer ratio calculations and deal ratings could be wrong for newly added programs
- Priority: Medium

**Existing test suite is manual-only, no CI execution:**
- What's not tested automatically: All tests under `tests/` are standalone `tsx` scripts requiring manual invocation with real airline credentials and network access. There is no CI pipeline, no mock/stub layer, and no test that runs without credentials.
- Files: `tests/*.ts`, `tests/scrapers/*.ts`
- Risk: Code changes can break scrapers without any automated signal until a human runs the test
- Priority: Medium — difficult to fix without a test-double strategy for browser automation

---

*Concerns audit: 2026-02-26*
