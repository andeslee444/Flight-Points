# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Airline award flight scraper and monitoring system. Scrapes multiple airline award portals (AA, ANA, Singapore Airlines, British Airways, United, etc.) on 30-minute cycles, identifies sweet spot deals, and sends WhatsApp alerts. Uses anti-detect browsers (Camoufox) and Playwright with stealth plugins to bypass Cloudflare/Akamai bot detection.

## Commands

| Command | Description |
|---------|-------------|
| `npm run daemon` | Start the flight monitoring daemon (`src/flights/flight-daemon.ts`) |
| `npm run search` | Run a one-off award search (`src/flights/scrapers/index.ts`) |
| `npm run dev` | Start Express web server on port 3000 (`src/flights/web-server.ts`) |
| `npm run build` | Compile TypeScript to `dist/` via `tsc` |
| `tsx tests/test-all-scrapers.ts` | Run full scraper regression tests |
| `tsx tests/<test-file>.ts` | Run a specific test (e.g. `tsx tests/test-ana-scraper.ts`) |
| `python3 src/flights/scrapers/<scraper>-camoufox.py '<json>'` | Run a Python scraper directly for debugging |

No test framework — tests are standalone tsx scripts in `tests/`.

## Architecture

### Scraper Pattern (Tiered Fallback)

Each airline has multiple scraper implementations with a fallback chain:
1. **Fast** (`aa-fast.ts/py`) — curl_cffi cookie replay, ~2s per search
2. **Camoufox** (`aa-camoufox.ts` calling `.py`) — anti-detect browser via Python subprocess, ~30s
3. **Playwright** (`aa.ts`) — headless browser with stealth plugin, ~30s, most likely to be blocked

TypeScript `.ts` wrappers call Python `.py` scripts via `execFile` for Camoufox/curl_cffi scrapers. All scrapers return `FlightResult[]` from `types.ts`.

**Camoufox wrapper pattern**: All 6 Camoufox TS wrappers use the shared `camoufox-runner.ts` helper which provides: cache check, subprocess execution, JSON parsing with debug output, retry with exponential backoff, and batch sequential execution. Add new Camoufox scrapers by defining a `CamoufoxRunnerOptions` config and calling `runCamoufoxSearch()`.

### Daemon Flow (`flight-daemon.ts`)

The daemon is the production entry point:
- Loads user signups from `data/flight-signups.json`
- Generates search combinations (origin x dest x date x cabin)
- Rotates through max 25 searches per 30-minute cycle (state in `data/flight-rotation-state.json`)
- Runs scrapers with fallback chains per airline (ANA/SQ/BA in parallel per route)
- **Circuit breaker**: Scrapers that fail 5 consecutive times are disabled for 15 minutes (`scraper-health.ts`)
- Filters results against sweet spot thresholds (`sweet-spots.ts`) with 1.2x margin
- Deduplicates alerts (90-day window in `data/sent-alerts.json`)
- Sends WhatsApp notifications via OpenClaw CLI (`execFileSync`, no shell injection)
- Updates web cache for frontend display (path configurable via `WEB_CACHE_PATH` env)
- Monitors RSS memory (max 450MB) with automatic GC
- Graceful shutdown on SIGTERM/SIGINT
- Writes health metrics to `data/daemon-status.json` and `data/scraper-health.json`

### Key Modules

- **`types.ts`** — `FlightResult` (with optional extended fields for monitor/daemon), `SearchParams`, `CabinCode`
- **`airports.ts`** — Canonical airport region sets and helpers (`isTransatlantic`, `isToAsia`, `isInternational`, `REGION_LABELS`)
- **`sweet-spots.ts`** — S/A/B-tier deal definitions with point thresholds and CPP values
- **`transfer-partners.ts`** — Credit card program → airline partner mappings (Amex, Chase, etc.), derives sweet spots from `sweet-spots.ts`
- **`scraper-config.ts`** — Centralized timeouts, retry settings, cache limits, circuit breaker thresholds
- **`scraper-health.ts`** — Circuit breaker + per-scraper success/failure tracking
- **`history.ts`** — Price history tracking with 90-day pruning and atomic writes
- **`utils.ts`** — `atomicWriteFileSync` and async `atomicWriteFile` for data integrity
- **`scrapers/index.ts`** — Scraper registry (`SCRAPER_REGISTRY`); ~4 alliance-gateway scrapers cover ~80% of flights
- **`scrapers/cache.ts`** — Bounded in-memory cache (500 max entries, 30min TTL) with optional disk persistence
- **`scrapers/camoufox-runner.ts`** — Shared Python subprocess runner with retry logic

### Data Files (in `data/`)

- `flight-signups.json` — User route/cabin watch list
- `flight-monitor-history.json` — Last 48 scans + known flights
- `flight-rotation-state.json` — Cycle rotation offset
- `sent-alerts.json` — Alert dedup tracking (90-day TTL)
- `daemon-status.json` — Daemon health metrics (pid, RSS, last scan time)
- `scraper-health.json` — Per-scraper success/failure stats and circuit breaker state

### Web Server & Frontend (`web-server.ts`, `web/public/`)

Express server on port 3000. Serves static frontend from `web/public/` and provides API endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/api/flights/search?from=JFK&to=NRT&class=business&program=amex-mr` | Search daemon cache |
| `/api/flights/deals?program=amex-mr` | Top 20 deals across all cached routes |
| `/api/flights/sweet-spots?tier=S&program=amex-mr` | Sweet spot database |
| `/api/flights/programs` | List credit card programs |
| `/api/flights/routes` | All routes in cache |
| `/api/flights/cash-prices?from=...&to=...&date=...&class=...` | Google Flights prices (live) |
| `/api/flights/live-search?from=...&to=...&class=...&program=...` | SSE stream of live scraper results |
| `POST /api/flights/signup` | Register watch list entry |

**Data flow**: Daemon scrapes → writes `flight-cache.json` → web server reads cache → enriches results (transfer ratios, CPP, deal ratings, booking URLs) → serves to frontend. When cache has no results, frontend auto-triggers live scraping via SSE (`live-scraper.ts`, max 2 concurrent).

Frontend files: `flights.html` (search UI), `flight-results.html` (results), `styles.css` (dark theme with warm gold accents).

### Anti-Bot Strategy

- SOCKS5 proxy configurable via `PROXY_URL` env (falls back to WARP at `socks5://127.0.0.1:1080`)
- Camoufox anti-detect browser (Python)
- User-agent rotation and human-like delays
- Browser contexts kept alive to reduce startup overhead
- Config in `config/stealth-config.json`

## Tech Stack

- **TypeScript + Python** — TS for orchestration, Python for anti-detect browser automation
- **Playwright + stealth plugin** — Browser automation
- **Camoufox** — Anti-detect Firefox fork (Python subprocess)
- **Express** — Dev-mode web server
- **tsx** — TypeScript execution (dev/tests)
- Target: ES2022, module: NodeNext, strict mode

## Adding a New Scraper

1. Create `src/flights/scrapers/{airline}-camoufox.py` following the Python contract: reads JSON arg from `sys.argv[1]`, logs to stderr, outputs `FlightResult[]` JSON to stdout
2. Create `src/flights/scrapers/{airline}-camoufox.ts` wrapper using `CamoufoxRunnerOptions` + `runCamoufoxSearch()` from `camoufox-runner.ts`
3. Register in `SCRAPER_REGISTRY` in `scrapers/index.ts` with alliance coverage and fallback chain
4. Add test: `tests/test-{airline}-scraper.ts`

## Setup

```bash
npm install
pip install -r requirements.txt
cp .env.example .env           # Add airline credentials
cp config/airline-accounts.example.json config/airline-accounts.json  # Add airline account details
```

Key environment variables (see `.env.example` for full list with descriptions):
- `ANA_USERNAME`, `ANA_PASSWORD` — ANA scraper
- `SQ_KRISFLYER_ID`, `SQ_KRISFLYER_PASSWORD` — Singapore Airlines scraper
- `BA_EXEC_CLUB_NUMBER`, `BA_EXEC_CLUB_PASSWORD` — British Airways scraper
- `AEROPLAN_USERNAME`, `AEROPLAN_PASSWORD` — United via Aeroplan scraper
- `DATA_DIR` — Base directory for data files (default: `./data`)
- `PROXY_URL` — SOCKS5 proxy for anti-detect browsers
- `SCRAPER_CACHE_DIR` — Enable disk-backed scraper cache
