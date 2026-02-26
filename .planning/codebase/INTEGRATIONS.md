# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Airline Award Search APIs (Scraped — no official partnership):**

- **American Airlines AAdvantage** — oneworld alliance gateway; covers Cathay, JAL, Qatar, Qantas, BA, Finnair, Iberia partner availability
  - Scrapers: `src/flights/scrapers/aa-cdp.py` (Real Chrome CDP, primary), `src/flights/scrapers/aa-curlffi.py` (curl_cffi fallback), `src/flights/scrapers/aa-patchright.py`, `src/flights/scrapers/aa-camoufox.py`
  - TS wrappers: `src/flights/scrapers/aa-cdp.ts`, `src/flights/scrapers/aa-curlffi.ts`, etc.
  - Auth: Akamai bot protection bypassed via real Chrome CDP (no login required for search)
  - Endpoint: `https://www.aa.com/booking/api/search/itinerary` (POST, award search)

- **Air France/KLM Flying Blue** — SkyTeam alliance gateway; covers Air France, KLM, Delta, Korean Air partners
  - Scrapers: `src/flights/scrapers/flying-blue-cdp.py` (Real Chrome CDP + OTP login, primary), `src/flights/scrapers/flying-blue-curlffi.py`, `src/flights/scrapers/flying-blue-patchright.py`
  - GQL endpoint: `https://wwws.airfrance.us/gql/v1?bookingFlow=REWARD`
  - Auth: Email login with OTP; session persisted in Chrome profile at `/tmp/chrome-cdp-flyingblue/`; session lasts ~1 hour

- **Delta/Virgin Atlantic (SkyTeam)** — SkyTeam coverage via Virgin Atlantic GraphQL API
  - Scrapers: `src/flights/scrapers/delta-va-curlffi.py` (primary, ~12s), `src/flights/scrapers/delta-va-patchright.py`, `src/flights/scrapers/delta-va-camoufox.py`
  - Auth: Virgin Atlantic login via Azure AD B2C (`SETTINGS` extraction); credentials via `VA_EMAIL`/`VA_PASSWORD`

- **Alaska Airlines Mileage Plan** — oneworld + independent partners (Emirates)
  - Scrapers: `src/flights/scrapers/alaska-curlffi.py` (primary, ~6s), `src/flights/scrapers/alaska-patchright.py`
  - Method: SvelteKit `__data.json` endpoint bypass — no bot protection

- **Cathay Pacific Asia Miles (AFR API)** — Public REST API, no auth, no bot protection
  - Scraper: `src/flights/scrapers/cathay-curlffi.py`
  - Endpoints:
    - `GET https://api.cathaypacific.com/afr/search/availability/en.{o}.{d}.{cabin}.CX.1.{start}.{end}.json`
    - `GET https://api.cathaypacific.com/afr/searchpanel/searchoptions/en.{o}.{d}.OW.std.CX.json`
  - Coverage: CX-operated routes to/from HKG + intra-Asia only (~13 routes)

- **JetBlue TrueBlue** — Public REST API, static API key, no login required
  - Scraper: `src/flights/scrapers/jetblue-api.ts` (TypeScript, native fetch)
  - Endpoint: `POST https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB`
  - Auth: Static Azure APIM subscription key `a5ee654e981b4577a58264fed9b1669c` (hardcoded in `jetblue-api.ts`)

- **Turkish Airlines Miles&Smiles** — Official developer API
  - Scraper: `src/flights/scrapers/turkish-api.ts`
  - Base URL: `https://api.turkishairlines.com/test`
  - Endpoints: `getAvailability`, `getFareFamilyList`, `calculateAwardMilesWithTax`
  - Auth: `TK_API_KEY` + `TK_API_SECRET` env vars; register at `developer.apim.turkishairlines.com`

- **Google Flights** — Cash price scraping for CPP (cents per point) calculation
  - Scraper: `src/flights/scrapers/google-flights.ts`
  - Method: Playwright headless browser; DOM parsing of `li.pIav2d` elements
  - URL pattern: `https://www.google.com/travel/flights?q=Flights+from+{origin}+to+{dest}+on+{date}+{cabin}+one+way`
  - No auth, no rate limiting workarounds — vanilla Playwright

**Blocked/Degraded Scrapers:**
- United/Aeroplan: Gigya reCAPTCHA blocks login (`src/flights/scrapers/united-aeroplan-*.py`)
- Singapore Airlines: 428 JS challenge on login (`src/flights/scrapers/sq-*.py`)
- British Airways: Auth0 CAPTCHA blocks login (`src/flights/scrapers/ba-camoufox.py`)
- ANA: Anti-bot "heavy traffic" blocks after login (`src/flights/scrapers/ana-camoufox.py`)

## Data Storage

**Databases:**
- PostgreSQL 16 (AWS RDS)
  - Connection: `DATABASE_URL` env var (full connection string with `sslmode=require`)
  - SSL: Enabled in production; set `PG_SSL=false` for local dev
  - Client: `pg` (node-postgres) singleton pool, max 10 connections, 30s idle timeout
  - Pool singleton: `src/flights/db.ts` — `initPool()`, `getPool()`, `closePool()`
  - Tables: `flight_cache`, `flight_signups`, `sent_alerts`, `monitor_scans`, `known_flights`, `rotation_state`, `daemon_status`, `scraper_health`
  - JSONB columns: `award_flights`, `cash_flights` in `flight_cache`; `results` in `monitor_scans`
  - Schema: `migrations/001_initial_schema.sql`
  - Infra: Terraform at `terraform/main.tf` — AWS RDS `db.t3.micro`, 20GB gp3, `us-east-1`

**File Storage:**
- Local JSON files in `data/` as fallback/supplementary:
  - `data/flight-cache.json` — Web cache for frontend display (written by daemon via `WEB_CACHE_PATH`)
  - `data/scraper-health.json` — Per-scraper health metrics written by `src/flights/scraper-health.ts`
  - `data/daemon-status.json` — Daemon health metrics
- All writes use `atomicWriteFileSync` / `atomicWriteFile` from `src/flights/utils.ts` (write-to-temp then rename)

**Caching:**
- In-memory scraper result cache: bounded LRU, max 500 entries, 30-minute TTL
  - Implementation: `src/flights/scrapers/cache.ts`
  - Optional disk persistence: `SCRAPER_CACHE_DIR` env var

## Authentication & Identity

**Airline Credentials:**
- Stored in `.env` file (local) and read via `process.env`
- Per-airline: `ANA_USERNAME`/`ANA_PASSWORD`, `SQ_KRISFLYER_ID`/`SQ_KRISFLYER_PASSWORD`, `BA_EXEC_CLUB_NUMBER`/`BA_EXEC_CLUB_PASSWORD`, `AEROPLAN_USERNAME`/`AEROPLAN_PASSWORD`, `UNITED_USERNAME`/`UNITED_PASSWORD`
- Chrome CDP session persistence: profiles stored in `/tmp/chrome-cdp-{name}/` (e.g. `/tmp/chrome-cdp-flyingblue/`)
- Account details backup: `config/airline-accounts.json` (gitignored)

**Web Server Auth:**
- None — all API endpoints are unauthenticated
- CORS enabled for all origins via `cors()` middleware

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)

**Logs:**
- `console.log` / `console.error` to stdout/stderr
- All Python scrapers log to stderr with timestamp prefix (e.g. `[AA-CDP 14:23:01]`)
- TypeScript daemon logs with ISO timestamp prefix
- RDS slow query log: queries >1000ms logged (configured via `terraform/main.tf` parameter group)
- Logs directory: `logs/` (present at root, contents not committed)

**Health Metrics:**
- Circuit breaker state: `src/flights/scraper-health.ts` + DB table `scraper_health`
- Daemon health: DB table `daemon_status` (pid, RSS, last scan time, results count)
- RSS memory monitoring: daemon checks every cycle, max 450MB (`src/flights/flight-daemon.ts`)

## CI/CD & Deployment

**Hosting:**
- Production daemon: Harbor (Mac Mini), `npm run daemon` (long-running tsx process)
- Frontend + API: Vercel (serverless), auto-deployed on push to `main` branch of `andeslee444/Flight-Points`
- Database: AWS RDS in `us-east-1`, provisioned via Terraform

**Vercel Deployment:**
- Build command: `npm run vercel-build` — copies `web/public/` to `public/`
- Serverless function: `api/index.ts` — re-exports Express `app` from `web-server.ts`
- Max function duration: 30 seconds (`vercel.json`)
- Limitations: Python scrapers and SSE live-search endpoints do NOT work on Vercel (no Python runtime, no persistent connections)

**CI Pipeline:**
- None (no GitHub Actions or other CI; manual testing via `tsx tests/` scripts)

## Environment Configuration

**Required env vars (production):**
- `DATABASE_URL` — PostgreSQL connection string (must be set in both local `.env` and Vercel dashboard)
- `PROXY_URL` — SOCKS5 proxy (`socks5://127.0.0.1:1081` via Oracle Cloud VPS SSH tunnel)

**Optional env vars:**
- `PG_SSL` — Set `"false"` for local dev only
- `DATA_DIR` — Base directory for JSON data files (default: `./data`)
- `WEB_CACHE_PATH` — Shared flight cache JSON path for frontend
- `SCRAPER_CACHE_DIR` — Enables disk-backed scraper cache
- `DATE_SAMPLING_DAYS` — Days between sampled dates (default: 14)

**Secrets location:**
- `.env` file at project root (gitignored)
- `config/airline-accounts.json` (gitignored)
- Vercel dashboard for production `DATABASE_URL`

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- WhatsApp alerts via OpenClaw CLI: `execFileSync('openclaw', ['send', ...])` in `src/flights/flight-daemon.ts`
  - Triggered when sweet spot deals found and not already sent (90-day dedup window via `sent_alerts` DB table)
  - No shell injection risk — uses `execFileSync` with argument array, not shell string

## Proxy Infrastructure

**Oracle Cloud VPS (Anti-detect proxy):**
- IP: `150.136.249.186` (Always Free, US-Ashburn, Ubuntu 22.04)
- SSH tunnel: `ssh -D 1081 -N -f ubuntu@150.136.249.186`
- Used as SOCKS5 proxy for all Python scrapers via `PROXY_URL` env var
- Purpose: IP reputation bypass (Akamai cross-site reputation tracking tier)
- Also has wireproxy on port 1080

---

*Integration audit: 2026-02-26*
