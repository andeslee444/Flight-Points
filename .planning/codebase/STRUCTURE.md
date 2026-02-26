# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
Flight-Points/
├── api/                    # Vercel serverless entry point
│   └── index.ts            # Initializes DB pool, re-exports Express app
├── config/                 # Static config files (not secrets)
│   ├── stealth-config.json
│   ├── airline-accounts.json       # Gitignored — has real credentials
│   └── airline-accounts.example.json
├── data/                   # Runtime state files (JSON fallbacks + cache)
│   ├── flight-signups.json
│   ├── flight-cache.json
│   ├── flight-rotation-state.json
│   ├── sent-alerts.json
│   ├── daemon-status.json
│   ├── scraper-health.json
│   ├── flight-monitor-history.json
│   └── cookie-cache/       # Akamai cookie farm cache
├── migrations/             # SQL schema files
│   ├── 001_initial_schema.sql
│   └── 002_seed_from_json.ts
├── research/               # Exploratory scripts and notes (not production)
├── scripts/                # One-off utility scripts
├── src/
│   ├── stealth.ts          # (Legacy) Playwright stealth plugin setup
│   └── flights/            # All production code lives here
│       ├── types.ts         # Shared interfaces: FlightResult, SearchParams, CabinCode
│       ├── airports.ts      # Canonical airport region sets and helper functions
│       ├── sweet-spots.ts   # Sweet spot database (S/A/B tier award definitions)
│       ├── transfer-partners.ts  # Credit card → airline transfer partner mappings
│       ├── scraper-config.ts     # Centralized timeouts, retry settings, cache limits
│       ├── scraper-health.ts     # Circuit breaker + per-scraper success/failure tracking
│       ├── utils.ts         # atomicWriteFileSync / atomicWriteFile
│       ├── history.ts       # Price history tracking (90-day pruning, atomic writes)
│       ├── db.ts            # PostgreSQL singleton pool + typed query functions
│       ├── monitor.ts       # Result enrichment helpers (CPP, deal rating, booking URLs)
│       ├── live-scraper.ts  # On-demand SSE scraping (max 2 concurrent, metro dedup)
│       ├── web-server.ts    # Express server + all /api/flights/* endpoints
│       ├── flight-daemon.ts # Production daemon: 30-min cycles, alerts, DB writes
│       └── scrapers/        # Scraper registry, runners, and all airline scrapers
│           ├── index.ts          # SCRAPER_REGISTRY + fallback chains + searchAll()
│           ├── cache.ts          # In-memory bounded cache (500 entries, 30min TTL)
│           ├── camoufox-runner.ts  # Shared Camoufox subprocess runner
│           ├── curlffi-runner.ts   # Shared curl_cffi subprocess runner
│           ├── patchright-runner.ts # Shared Patchright/CDP subprocess runner
│           ├── chrome_cdp.py     # Shared Python: real Chrome launcher via CDP
│           ├── curlffi_base.py   # Shared Python: curl_cffi session + impersonation
│           ├── cookie_farm.py    # Shared Python: Akamai _abck cookie farming
│           ├── {airline}.ts      # Playwright-based scraper (legacy fallback)
│           ├── {airline}-cdp.ts  # Chrome CDP wrapper (highest priority)
│           ├── {airline}-curlffi.ts   # curl_cffi wrapper (fast tier)
│           ├── {airline}-patchright.ts # Patchright wrapper (stealth browser)
│           ├── {airline}-camoufox.ts  # Camoufox wrapper (anti-detect Firefox)
│           ├── {airline}-cdp.py       # Chrome CDP Python implementation
│           ├── {airline}-curlffi.py   # curl_cffi Python implementation
│           ├── {airline}-patchright.py # Patchright Python implementation
│           └── {airline}-camoufox.py  # Camoufox Python implementation
├── tests/                  # Standalone test scripts (no test framework)
│   ├── test-all-scrapers.ts    # Full regression across all active scrapers
│   ├── test-{airline}-scraper.ts  # Per-airline scraper test
│   ├── test-live-scrapers.ts
│   ├── test-registry.ts
│   └── scrapers/           # Lower-level exploratory tests written during development
│       └── test-*.ts
├── web/
│   └── public/             # Static frontend files
│       ├── flights.html     # Search UI (entry page)
│       ├── flight-results.html  # Results display with SSE live search
│       ├── styles.css       # Dark theme with warm gold accents
│       └── airports.json    # Airport data for frontend autocomplete
├── .env                    # Local secrets (gitignored)
├── .env.example            # Template showing all required env vars
├── package.json
├── tsconfig.json           # ES2022, NodeNext modules, strict mode, outDir: dist/
├── vercel.json             # Serverless config: api/index.ts, static rewrites
├── requirements.txt        # Python dependencies (camoufox, curl_cffi, patchright)
└── CLAUDE.md               # Project guidance for Claude Code
```

## Directory Purposes

**`src/flights/`:**
- Purpose: All production TypeScript — daemon, web server, scrapers, domain logic
- Contains: Organized as flat files for domain modules + one subdirectory for scrapers
- Key files: `types.ts` (data contracts), `flight-daemon.ts` (production entry), `web-server.ts` (API server)

**`src/flights/scrapers/`:**
- Purpose: Scraper registry and all airline implementations across tiers
- Contains: Per-airline `.ts` wrappers, `.py` implementations, shared Python modules, shared TS runners
- Key files: `index.ts` (registry + fallback chains), `cache.ts`, `curlffi-runner.ts`, `patchright-runner.ts`, `camoufox-runner.ts`

**`tests/`:**
- Purpose: Manual regression scripts — standalone `tsx` files, no test framework
- Contains: Top-level tests for production scraper paths; `scrapers/` subdirectory for exploratory/debug tests written during development
- Key files: `test-all-scrapers.ts` (full regression), `test-{airline}-scraper.ts` (per-airline)

**`web/public/`:**
- Purpose: Static frontend — copied to `public/` for Vercel static hosting via `npm run vercel-build`
- Contains: Two HTML pages (search UI + results), one CSS file, airports JSON for autocomplete

**`api/`:**
- Purpose: Vercel serverless function entry — thin wrapper that initializes DB and exports the Express app
- Key files: `api/index.ts`

**`migrations/`:**
- Purpose: PostgreSQL schema and seed scripts — run manually against `DATABASE_URL`
- Key files: `001_initial_schema.sql` (all 7 tables), `002_seed_from_json.ts` (initial data migration)

**`data/`:**
- Purpose: Runtime JSON state files used as fallback/cache when DB is unavailable; also Chrome cookie cache
- Generated: Yes (by daemon and web server)
- Committed: Partially — `.gitignore` excludes most; `flight-signups.json` is the user watch list

**`config/`:**
- Purpose: Static configuration — stealth browser config, airline account credentials example
- Key files: `stealth-config.json`, `airline-accounts.example.json`

## Key File Locations

**Entry Points:**
- `src/flights/flight-daemon.ts`: Production daemon (`npm run daemon`)
- `src/flights/web-server.ts`: Express web server (`npm run dev`)
- `api/index.ts`: Vercel serverless wrapper

**Configuration:**
- `.env`: All secrets and runtime config (gitignored)
- `.env.example`: Documents every required env var with descriptions
- `tsconfig.json`: TypeScript compiler options (ES2022, NodeNext, strict)
- `vercel.json`: Vercel deployment config with URL rewrites
- `src/flights/scraper-config.ts`: All timeout/retry/cache constants

**Core Logic:**
- `src/flights/types.ts`: `FlightResult` and `SearchParams` — the contracts everything else depends on
- `src/flights/scrapers/index.ts`: `SCRAPER_REGISTRY`, fallback chains, `searchAll()`, `deduplicateResults()`
- `src/flights/db.ts`: Every database operation as a typed function
- `src/flights/sweet-spots.ts`: `SWEET_SPOTS` array — the deal definitions driving alerts

**Testing:**
- `tests/test-all-scrapers.ts`: Run all active scrapers
- `tests/test-{airline}-scraper.ts`: Per-airline tests
- Run with: `npx tsx tests/<filename>.ts`

## Naming Conventions

**Files:**
- TypeScript source: `kebab-case.ts` — e.g., `flight-daemon.ts`, `scraper-health.ts`
- Scraper wrappers: `{airline}-{tier}.ts` — e.g., `aa-cdp.ts`, `alaska-curlffi.ts`, `flying-blue-patchright.ts`
- Python implementations: `{airline}-{tier}.py` — mirrors the `.ts` wrapper exactly
- Legacy Playwright scrapers: `{airline}.ts` (no tier suffix) — e.g., `aa.ts`, `united.ts`
- Tests: `test-{airline}-scraper.ts` for main tests; exploratory tests have varied names in `tests/scrapers/`

**Directories:**
- All lowercase with hyphens: `src/flights/scrapers/`
- Top-level dirs are single words: `api/`, `web/`, `data/`, `tests/`, `config/`, `migrations/`

**Exported Functions:**
- Scraper search functions: `search{Airline}{Tier}()` — e.g., `searchAACdp()`, `searchAlaskaCurlFfi()`, `searchFlyingBlueCdp()`
- Database functions: verb + noun — e.g., `loadSignups()`, `markAlertSent()`, `upsertCacheEntries()`
- Health functions: `recordSuccess()`, `recordFailure()`, `isScraperAvailable()`, `writeHealthFile()`

**SCRAPER_REGISTRY keys:**
- Kebab-case airline identifier: `'aa'`, `'flying-blue'`, `'united'`, `'delta'`, `'alaska'`, `'cathay'`

## Where to Add New Code

**New Airline Scraper:**
1. Choose tier (curl_cffi for APIs, cdp for Akamai sites, patchright/camoufox as fallbacks)
2. Python implementation: `src/flights/scrapers/{airline}-{tier}.py` — reads `sys.argv[1]` as JSON, outputs `FlightResult[]` to stdout
3. TypeScript wrapper: `src/flights/scrapers/{airline}-{tier}.ts` — configure `OPTS` object, export `search{Airline}{Tier}()`
4. Register in `SCRAPER_REGISTRY` in `src/flights/scrapers/index.ts` — add fallback chain function if multiple tiers
5. Test: `tests/test-{airline}-scraper.ts`

**New API Endpoint:**
- Add route handler in `src/flights/web-server.ts`
- If it needs database access, add typed query function to `src/flights/db.ts`

**New Database Table:**
- Add SQL to `migrations/` as next numbered file (e.g., `003_add_table.sql`)
- Add typed query functions to `src/flights/db.ts`

**New Sweet Spot:**
- Add entry to `SWEET_SPOTS` array in `src/flights/sweet-spots.ts`
- Fields: `id`, `route`, `cabin`, `bookingProgram`, `programCode`, `pointsRequired`, `tier` ('S'/'A'/'B'), `transferFrom[]`, etc.

**New Credit Card Program:**
- Add to `POINTS_PROGRAMS` array in `src/flights/transfer-partners.ts` with `TransferPartner[]` list

**Shared Utility:**
- Shared TypeScript utilities: `src/flights/utils.ts`
- Shared Python utilities: `src/flights/scrapers/curlffi_base.py` or `src/flights/scrapers/chrome_cdp.py`

## Special Directories

**`data/`:**
- Purpose: Runtime JSON state and fallback cache
- Generated: Yes — daemon writes `daemon-status.json`, `scraper-health.json`, `flight-cache.json`; web server reads these
- Committed: `flight-signups.json` only (user watch list); rest gitignored

**`dist/`:**
- Purpose: TypeScript compiled output (`tsc` → `dist/`)
- Generated: Yes
- Committed: No (gitignored)

**`.venv/`:**
- Purpose: Python virtual environment for Python scraper dependencies
- Generated: Yes
- Committed: No (gitignored)

**`tests/scrapers/`:**
- Purpose: Exploratory and debug tests written during scraper development — not part of the regression suite
- Generated: No
- Committed: Yes

**`src/flights/scrapers/__pycache__/`:**
- Purpose: Python bytecode cache
- Generated: Yes
- Committed: No (gitignored)

---

*Structure analysis: 2026-02-26*
