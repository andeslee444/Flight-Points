# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Multi-tier scraper pipeline with daemon-driven batch processing and on-demand SSE streaming

**Key Characteristics:**
- Two runtime modes: a background daemon (30-minute cycles) and a web server with live on-demand scraping via SSE
- Each airline has a tiered fallback chain of scrapers (Chrome CDP → curl_cffi → Patchright → Camoufox → Playwright), tried in order until one succeeds
- Alliance gateway strategy: ~4 scrapers cover ~80% of all award flights by searching partner availability across entire alliances (AA=oneworld, United/Aeroplan=Star, Flying Blue=SkyTeam)
- TypeScript orchestrates Python subprocesses; Python handles anti-detect browser automation
- PostgreSQL (AWS RDS) is the shared data store between daemon and web server; in-memory cache with optional disk backing bridges the gap within a scraper process

## Layers

**Types Layer:**
- Purpose: Shared data contracts — no logic, only interfaces and enums
- Location: `src/flights/types.ts`
- Contains: `FlightResult`, `SearchParams`, `CabinCode`, `PriceHistory`, `getCacheKey()`
- Depends on: Nothing
- Used by: Every other module

**Domain Knowledge Layer:**
- Purpose: Static knowledge about airports, sweet spots, and transfer partners — no I/O
- Location: `src/flights/airports.ts`, `src/flights/sweet-spots.ts`, `src/flights/transfer-partners.ts`
- Contains: Airport region sets (`US_AIRPORTS`, `EUROPE_AIRPORTS`, etc.), sweet spot definitions (S/A/B tier), credit card → airline transfer partner mappings
- Depends on: `types.ts`
- Used by: Daemon, web server, monitor engine

**Scraper Infrastructure Layer:**
- Purpose: Reusable runner logic (cache, subprocess exec, retry, batching) shared across all scrapers of the same tier
- Location: `src/flights/scrapers/cache.ts`, `src/flights/scrapers/camoufox-runner.ts`, `src/flights/scrapers/curlffi-runner.ts`, `src/flights/scrapers/patchright-runner.ts`
- Contains: In-memory cache (500 entries, 30min TTL), `execFile` subprocess wrapping with retry/backoff, JSON parse + debug output
- Depends on: `types.ts`, `scraper-config.ts`
- Used by: All individual scraper `.ts` wrapper files

**Individual Scrapers Layer:**
- Purpose: Thin airline-specific wrappers that configure a runner with a script name, cache prefix, and timeout
- Location: `src/flights/scrapers/{airline}-{tier}.ts` (e.g., `aa-cdp.ts`, `alaska-curlffi.ts`, `flying-blue-patchright.ts`)
- Contains: A `OPTS` config object and an exported `search{Airline}{Tier}()` function that delegates to the matching runner
- Depends on: The corresponding runner (`patchright-runner.ts`, `curlffi-runner.ts`, or `camoufox-runner.ts`)
- Used by: `scrapers/index.ts`

**Python Scraper Layer:**
- Purpose: Actual anti-detect browser automation and HTTP requests — runs as subprocess
- Location: `src/flights/scrapers/{airline}-{tier}.py` (e.g., `aa-cdp.py`, `alaska-curlffi.py`)
- Contains: Reads `sys.argv[1]` as JSON params, logs to stderr, outputs `FlightResult[]` JSON to stdout
- Shared Python modules: `chrome_cdp.py` (real Chrome launcher), `curlffi_base.py` (shared HTTP session), `cookie_farm.py` (Akamai cookie harvesting)
- Depends on: Python packages (patchright, camoufox, curl_cffi)
- Used by: Called by `execFile('python3', [scriptPath, paramsJson])` in runners

**Scraper Registry Layer:**
- Purpose: Declares all scrapers, their alliance coverage, and fallback chains; provides helpers to select scrapers for a program
- Location: `src/flights/scrapers/index.ts`
- Contains: `SCRAPER_REGISTRY` (map of scraper key → `ScraperEntry`), fallback chain functions (`searchAAWithFallback`, `searchFlyingBlueWithFallback`, etc.), `searchAll()`, `getScrapersForProgram()`, `deduplicateResults()`
- Depends on: All individual scraper `.ts` wrappers, `transfer-partners.ts`
- Used by: Daemon, live scraper, monitor engine

**Health & Config Layer:**
- Purpose: Circuit breaker tracking and centralized timeout/retry constants
- Location: `src/flights/scraper-health.ts`, `src/flights/scraper-config.ts`
- Contains: Per-scraper `ScraperStats` (in-memory Map), circuit breaker logic (5 failures → 15min cooldown), all timeout/retry constants for each tier
- Depends on: `scraper-config.ts`, `db.ts` (writes stats to PostgreSQL)
- Used by: Daemon, live scraper

**Database Layer:**
- Purpose: Singleton PostgreSQL pool with typed query functions; all data persistence
- Location: `src/flights/db.ts`
- Contains: `initPool()`, `closePool()`, typed functions for every table: `flight_cache`, `flight_signups`, `sent_alerts`, `monitor_scans`, `known_flights`, `rotation_state`, `daemon_status`, `scraper_health`
- Depends on: `pg` package, `DATABASE_URL` env var
- Used by: Daemon, web server, scraper-health

**Monitor Engine Layer:**
- Purpose: Result enrichment (CPP calculation, deal rating, booking URLs, transfer paths) and high-level search orchestration
- Location: `src/flights/monitor.ts`
- Contains: `cabinDisplayName()`, `computeDealRating()`, `findPartnerForSource()`, `estimateCashPrice()`, `getBookingUrl()`, `normalizeAirlineName()`, `FlightSignup` and `MonitorSearchParams` types
- Depends on: `scrapers/index.ts`, `transfer-partners.ts`, `airports.ts`
- Used by: Web server (imports enrichment helpers directly)

**Live Scraper Layer:**
- Purpose: On-demand scraping triggered from web UI via SSE, max 2 concurrent, with metro airport deduplication
- Location: `src/flights/live-scraper.ts`
- Contains: `runLiveScrape()`, `canStartLiveScrape()`, `collapseToRepresentative()`, metro airport group mappings, date generation for live searches
- Depends on: `scrapers/index.ts`, `scraper-health.ts`, `scraper-config.ts`
- Used by: Web server (`/api/flights/live-search` SSE endpoint)

**Web Server Layer:**
- Purpose: Express server — serves static frontend and REST/SSE API endpoints
- Location: `src/flights/web-server.ts`
- Contains: All `/api/flights/*` route handlers, `enrichFlightResult()` helper, SSE streaming for live search
- Depends on: `db.ts`, `monitor.ts`, `transfer-partners.ts`, `sweet-spots.ts`, `live-scraper.ts`
- Used by: Frontend HTML pages, Vercel serverless wrapper (`api/index.ts`)

**Daemon Layer:**
- Purpose: Production background process — 30-minute scrape cycles, alert dispatch via WhatsApp
- Location: `src/flights/flight-daemon.ts`
- Contains: Main loop, search combination generation, rotation offset management, sweet spot matching, WhatsApp alert dispatch (`execFileSync` to OpenClaw CLI), memory monitoring, graceful shutdown
- Depends on: All scraper wrappers, `db.ts`, `sweet-spots.ts`, `airports.ts`, `scraper-health.ts`
- Used by: Run directly via `npm run daemon`

## Data Flow

**Daemon Cycle (30-minute background scraping):**

1. Daemon loads signups from `flight_signups` table via `db.loadSignups()`
2. Generates search combinations (origin × destination × sampled dates × cabin)
3. Loads rotation offset from `rotation_state` table; selects up to 25 searches for this cycle
4. For each search, checks circuit breaker (`isScraperAvailable()`), then calls the relevant scraper's fallback chain function
5. Fallback chain: tries Tier 1 (Chrome CDP or curl_cffi), on failure tries next tier, returns first non-empty result
6. Each tier: TypeScript runner calls `execFile('python3', [script, paramsJSON])`, parses stdout as `FlightResult[]`
7. Results filtered through `matchSweetSpots()` (1.2× threshold margin), deduped against `sent_alerts` table
8. Alert dispatched via `execFileSync` to OpenClaw WhatsApp CLI
9. Results written to `flight_cache` table via `upsertCacheEntries()`
10. Health metrics written to `daemon_status` and `scraper_health` tables

**Web Request → Cached Results:**

1. Frontend sends `GET /api/flights/search?from=JFK&to=NRT&class=business&program=amex-mr`
2. Web server calls `getCacheEntries()` from PostgreSQL `flight_cache`
3. Results enriched by `enrichFlightResult()`: adds transfer ratio, CPP, deal rating, booking URL, transfer path
4. Non-bookable sources (`ana-estimated`, `ana-chart`) filtered out
5. JSON response returned to frontend

**Web Request → Live Scraping (SSE):**

1. Frontend opens `GET /api/flights/live-search` SSE connection
2. Web server checks `canStartLiveScrape()` (max 2 concurrent)
3. `runLiveScrape()` called — generates 2 sample dates, collapses metro airports, gets all relevant scrapers for program
4. Each scraper runs with 90s per-call timeout; results streamed as SSE `data:` events as they arrive
5. Results written to `live_search_cache` via `upsertLiveCacheResults()` for subsequent requests
6. SSE stream closed with `event: done` when all scrapers complete

**State Management:**
- In-memory scraper cache: 500-entry LRU in `cache.ts`, 30-min TTL, optional disk persistence via `SCRAPER_CACHE_DIR`
- Circuit breaker state: in-memory `Map<string, ScraperStats>` in `scraper-health.ts`, persisted to `scraper_health` table
- All user data and scraped results: PostgreSQL via singleton pool in `db.ts`

## Key Abstractions

**`FlightResult`:**
- Purpose: Universal flight data record returned by every scraper
- Examples: `src/flights/types.ts`
- Pattern: Optional extended fields (`id`, `cpp`, `dealRating`, etc.) are populated by monitor/daemon after scraping; core fields always set by scrapers

**`ScraperEntry`:**
- Purpose: Registry record linking a scraper key to its fallback-chain search function, alliance coverage, and program codes it can service
- Examples: `src/flights/scrapers/index.ts` — `SCRAPER_REGISTRY`
- Pattern: `{ name, covers, search, status, coversPrograms, supportsNearbyAirports? }`

**Runner Options (`PatchrightRunnerOptions`, `CurlFfiRunnerOptions`, `CamoufoxRunnerOptions`):**
- Purpose: Configuration object that makes individual scraper `.ts` wrappers trivial — just declare `OPTS` and call the runner
- Examples: `src/flights/scrapers/aa-cdp.ts`, `src/flights/scrapers/alaska-curlffi.ts`
- Pattern: `{ label, script, cachePrefix, timeoutMs, maxRetries?, retryBaseDelayMs?, batchDelayMs? }`

**`SweetSpotEntry`:**
- Purpose: A known high-value award redemption with tier (S/A/B), route, points threshold, and transferable-from programs
- Examples: `src/flights/sweet-spots.ts` — `SWEET_SPOTS` array
- Pattern: Used by daemon for alert filtering, by web server for `/api/flights/sweet-spots`, and derived into per-partner `SweetSpot[]` in `transfer-partners.ts`

## Entry Points

**Daemon (`npm run daemon`):**
- Location: `src/flights/flight-daemon.ts`
- Triggers: Direct invocation; SIGTERM/SIGINT for graceful shutdown
- Responsibilities: Continuous 30-min scrape cycles, sweet spot alert dispatch, database persistence, health reporting, memory monitoring

**Web Server (`npm run dev`):**
- Location: `src/flights/web-server.ts`
- Triggers: HTTP requests on port 3000
- Responsibilities: Serve static HTML/CSS, provide REST API over PostgreSQL cache, stream live scraping results via SSE

**Vercel Serverless Entry:**
- Location: `api/index.ts`
- Triggers: HTTP requests routed by `vercel.json` (`/api/*` → `api/index.ts`)
- Responsibilities: Initialize DB pool at module scope, re-export Express app; NOTE: Python scrapers and SSE do not function in this environment

**TypeScript CLI Search (`npm run search`):**
- Location: `src/flights/scrapers/index.ts`
- Triggers: Direct invocation
- Responsibilities: One-off award search for debugging

## Error Handling

**Strategy:** Fail-forward with layered fallbacks; never crash the daemon on scraper failure

**Patterns:**
- Every fallback chain function wraps each tier in `try/catch`; on failure logs warning and moves to next tier
- Runners return empty array `[]` after exhausting all retries rather than throwing
- Circuit breaker (`scraper-health.ts`) disables scrapers after 5 consecutive failures for 15 minutes
- PostgreSQL queries all wrapped in `try/catch` with `console.error` and graceful degradation
- `Promise.race()` with timeout resolvers prevents hung scrapers from blocking the cycle
- `atomicWriteFileSync` / `atomicWriteFile` (`utils.ts`) prevent partial writes on crash

## Cross-Cutting Concerns

**Logging:** `console.log/warn/error` with `[Label HH:MM:SS.mmm]` prefixes in runners; ISO timestamp prefix in daemon `log()` helper; Python scrapers log to stderr (shown by runner)

**Validation:** None formalized — Python scrapers are trusted to output valid `FlightResult[]` JSON; runners catch JSON parse errors and treat as retry-able failures

**Authentication:** Airline credentials stored in `.env` and passed via `process.env` to Python subprocesses; Chrome CDP sessions persisted in `/tmp/chrome-cdp-{name}/` profile directories for session reuse between calls

---

*Architecture analysis: 2026-02-26*
