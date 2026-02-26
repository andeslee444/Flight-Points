# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.3 - Orchestration, daemon, web server, scraper wrappers, all business logic
- Python 3.14 - Anti-detect browser scrapers (Camoufox, Patchright, curl_cffi, Chrome CDP)

**Secondary:**
- SQL - PostgreSQL schema and migrations (`migrations/001_initial_schema.sql`)
- HCL - Infrastructure provisioning (`terraform/main.tf`)

## Runtime

**Environment:**
- Node.js 24 (v24.13.0 confirmed locally)

**Package Manager:**
- npm (package-lock.json present)
- Lockfile: `package-lock.json` — present and committed

## Frameworks

**Core:**
- Express 4.22 - HTTP web server and REST API (`src/flights/web-server.ts`)

**Browser Automation (TypeScript):**
- Playwright 1.41 - Headless Chromium for Google Flights and fallback scrapers
- playwright-extra 4.3 - Playwright with plugin support
- puppeteer-extra-plugin-stealth 2.11 - Bot-detection evasion plugin for Playwright

**Browser Automation (Python):**
- Camoufox 0.4.11 - Anti-detect Firefox fork; Python subprocess (`src/flights/scrapers/*-camoufox.py`)
- Patchright 1.58.0 - Patched Playwright for stealth; Python subprocess (`src/flights/scrapers/*-patchright.py`)
- curl_cffi 0.14.0 - TLS/JA3 fingerprint impersonation with `impersonate="chrome131"`; Python subprocess (`src/flights/scrapers/*-curlffi.py`)

**Build/Dev:**
- tsx 4.7 - Direct TypeScript execution (dev, daemon, all test scripts)
- TypeScript compiler (tsc) - Production build to `dist/`
- sharp 0.34 - Image processing (devDependency; used for web assets)

## Key Dependencies

**Critical:**
- `pg` 8.13 - PostgreSQL client; singleton pool in `src/flights/db.ts`; all persistent state goes through here
- `dotenv` 16.4 - Environment variable loading; imported as `import 'dotenv/config'` in entry points
- `cors` 2.8 - CORS middleware for Express API
- `express` 4.22 - Web server and API handler, also exported as Vercel serverless function via `api/index.ts`

**Infrastructure:**
- Node `child_process.execFile` / `execFileSync` - Used by all TS scraper wrappers to spawn Python subprocesses
- Node `child_process.execFileSync` - Used by daemon to send WhatsApp alerts via OpenClaw CLI

## Configuration

**Environment:**
- Loaded via `dotenv/config` at entry points (`flight-daemon.ts`, `web-server.ts`)
- `.env.example` documents all required variables — copy to `.env` for local dev
- Key configs: `DATABASE_URL`, `PROXY_URL`, `DATA_DIR`, `WEB_CACHE_PATH`, `DATE_SAMPLING_DAYS`, `SCRAPER_CACHE_DIR`, `PG_SSL`
- Airline credentials per-scraper: `ANA_USERNAME`/`ANA_PASSWORD`, `SQ_KRISFLYER_ID`/`SQ_KRISFLYER_PASSWORD`, `BA_EXEC_CLUB_NUMBER`/`BA_EXEC_CLUB_PASSWORD`, `AEROPLAN_USERNAME`/`AEROPLAN_PASSWORD`, `TK_API_KEY`/`TK_API_SECRET`

**Build:**
- `tsconfig.json` — target ES2022, module NodeNext, strict mode, outputs to `dist/`, excludes `tests/`
- `vercel.json` — Vercel deployment config; routes `/api/*` to `api/index.ts` serverless function; build copies `web/public/` to `public/`

**Scraper Tuning:**
- `src/flights/scraper-config.ts` — Centralized timeouts, retry counts, batch delays, cache limits, circuit breaker thresholds
- `config/stealth-config.json` — Browser stealth options
- `config/airline-accounts.json` — Airline credential file (gitignored; example at `config/airline-accounts.example.json`)

## Platform Requirements

**Development:**
- Node.js 24+
- Python 3.10+ (3.14 in use locally)
- `pip install -r requirements.txt` (camoufox, patchright, curl_cffi)
- Google Chrome installed locally (for Chrome CDP scrapers; `aa-cdp.py`, `flying-blue-cdp.py`, `united-cdp.py`)
- SOCKS5 proxy optional but recommended (`PROXY_URL=socks5://127.0.0.1:1081`) — Oracle Cloud VPS

**Production:**
- Daemon runs on Harbor (Mac Mini) via `npm run daemon` (tsx, not compiled)
- Frontend and API deployed to Vercel (GitHub: `andeslee444/Flight-Points`)
- Database on AWS RDS PostgreSQL 16 (`us-east-1`, `db.t3.micro`, provisioned via Terraform)
- Python scrapers do NOT run on Vercel — daemon-only components

---

*Stack analysis: 2026-02-26*
