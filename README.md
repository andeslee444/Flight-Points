# Harbor Flight Sniper

Automated airline award flight monitoring system. Runs 24/7 on Harbor (Mac Mini), scrapes award portals every 30 minutes using anti-detect browsers, identifies sweet spot deals, and sends WhatsApp alerts.

## What It Does

You define routes you care about (e.g., NYC to Tokyo, Business class, March-June). The daemon continuously scrapes airline websites for award availability, compares results against a database of known sweet spot redemptions, and sends you a WhatsApp message when a deal appears. It only alerts once per flight (90-day dedup window), so you won't get spammed.

### Scan Cycle (every 30 minutes)

1. Loads your watch list from `data/flight-signups.json`
2. Generates all search combinations (origin x destination x date x cabin)
3. Rotates through max 25 searches per cycle (54 total combinations cycle across ~2 runs)
4. Scrapes AA via Camoufox anti-detect browser (tiered fallback: fast cookie replay -> Camoufox -> Playwright)
5. Runs ANA, Singapore Airlines, British Airways scrapers in parallel per route
6. Filters results against sweet spot thresholds (e.g., Business to Japan under 75K miles)
7. Deduplicates against previously sent alerts
8. Sends WhatsApp alerts via OpenClaw for new deals
9. Writes results to web cache for the Andes-Website frontend

### Scraper Architecture

Each airline has a fallback chain to handle bot detection:

| Tier | Method | Speed | Reliability |
|------|--------|-------|-------------|
| 1 | `aa-fast.py` — curl_cffi cookie replay | ~2s | High when cookies valid |
| 2 | `*-camoufox.py` — Camoufox anti-detect Firefox | ~30s | High |
| 3 | `aa.ts` — Playwright + stealth plugin | ~30s | Often blocked |

6 Camoufox wrappers (AA, ANA, BA, SQ, Delta/VA, United/Aeroplan) all use the shared `camoufox-runner.ts` which provides caching, retry with exponential backoff, and JSON parse error diagnostics.

### Alliance Gateway Strategy

~4 scrapers cover ~80% of all award flights:
- **AA** -> all oneworld partners (Cathay, JAL, Qatar, Qantas, BA, Finnair, Iberia)
- **United** -> all Star Alliance partners (ANA, Singapore, Lufthansa, Turkish, EVA)
- **Delta / Flying Blue** -> all SkyTeam partners
- **Google Flights** -> cash prices for CPP calculation

### Deal Detection

Results are checked against the sweet spots database (`sweet-spots.ts`) with a 1.2x margin. If a flight costs <= 120% of the sweet spot threshold, it's flagged as a deal. Fallback generic thresholds cover routes not in the database:
- Business to Asia: <= 75K miles
- Business transatlantic: <= 60K miles
- First to Asia: <= 120K miles

### Reliability Features

- **Circuit breaker**: Scrapers disabled after 5 consecutive failures, re-enabled after 15min cooldown
- **Graceful shutdown**: SIGTERM/SIGINT handlers, interruptible sleep, atomic file writes
- **Memory monitoring**: Forces GC if RSS exceeds 450MB
- **Rotation state**: Persists to disk, survives restarts
- **Bounded cache**: Max 500 entries in-memory, 30min TTL, optional disk persistence

## Deployment on Harbor (Mac Mini)

### First-Time Setup

```bash
# Clone the repo
git clone <repo-url> ~/Flight-Points
cd ~/Flight-Points

# Install Node dependencies
npm install

# Create Python virtual environment and install Camoufox
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
cp config/airline-accounts.example.json config/airline-accounts.json
```

Edit `.env` with your credentials:
```
ANA_USERNAME=<your ANA membership number>
ANA_PASSWORD=<your ANA password>
SQ_KRISFLYER_ID=<your KrisFlyer number>
SQ_KRISFLYER_PASSWORD=<your KrisFlyer password>
BA_EXEC_CLUB_NUMBER=<your BA number>
BA_EXEC_CLUB_PASSWORD=<your BA password>
WEB_CACHE_PATH=/path/to/Andes-Website/data/flight-cache.json
```

Edit `config/airline-accounts.json` with your airline account details.

### Configure Your Watch List

Edit `data/flight-signups.json`:
```json
[
  {
    "from": "JFK, EWR, LGA",
    "to": "NRT, HND",
    "class": "Business",
    "contact": "+14255336828",
    "alertMethod": "whatsapp",
    "startDate": "2026-03-01",
    "endDate": "2026-06-30"
  }
]
```

Fields:
- `from` / `to`: Comma-separated airport codes
- `class`: `"Business"`, `"First"`, or `"Either"`
- `contact`: WhatsApp number for alerts
- `alertMethod`: `"whatsapp"`
- `startDate` / `endDate`: Date range to search (YYYY-MM-DD)

### Running the Daemon

```bash
cd ~/Flight-Points
source .venv/bin/activate
npm run daemon
```

The daemon will:
- Log startup info (PID, memory, config)
- Start scanning immediately
- Sleep 30 minutes between cycles
- Run indefinitely until stopped

### Auto-Deploy from GitHub

When you push changes, Harbor should:

```bash
cd ~/Flight-Points
git pull origin main
npm install
source .venv/bin/activate
pip install -r requirements.txt

# Restart the daemon (send SIGTERM to gracefully stop, then restart)
kill $(cat data/daemon-status.json | python3 -c "import sys,json; print(json.load(sys.stdin)['pid'])") 2>/dev/null
nohup bash -c 'source .venv/bin/activate && npm run daemon' > logs/daemon.log 2>&1 &
```

Or as a one-liner for OpenClaw:
```bash
cd ~/Flight-Points && git pull && npm install && source .venv/bin/activate && pip install -r requirements.txt && kill $(python3 -c "import json; print(json.load(open('data/daemon-status.json'))['pid'])" 2>/dev/null) 2>/dev/null; nohup bash -c 'cd ~/Flight-Points && source .venv/bin/activate && npm run daemon' > ~/Flight-Points/logs/daemon.log 2>&1 &
```

### Health Monitoring

Check if the daemon is alive:
```bash
# Quick status
cat ~/Flight-Points/data/daemon-status.json | python3 -m json.tool

# Check process
ps aux | grep flight-daemon

# Tail live logs
tail -f ~/Flight-Points/logs/daemon.log

# Scraper health (circuit breaker status)
cat ~/Flight-Points/data/scraper-health.json | python3 -m json.tool
```

`daemon-status.json` contains:
```json
{
  "pid": 62925,
  "rssMB": 87,
  "startedAt": "2026-02-17T20:15:29.570Z",
  "lastScanTime": "2026-02-17T20:15:29.572Z",
  "resultsCount": 426,
  "alertsCount": 25,
  "nextScanTime": "2026-02-17T20:56:20.640Z"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run daemon` | Start the flight monitoring daemon (production) |
| `npm run search` | Run a one-off award search |
| `npm run dev` | Start the monitor in dev mode |
| `npm run build` | Compile TypeScript to `dist/` |

## Project Structure

```
src/flights/
  flight-daemon.ts        # Main entry point — 30-min scan loop
  types.ts                # FlightResult, SearchParams interfaces
  airports.ts             # Airport region sets (US, Europe, Japan, etc.)
  sweet-spots.ts          # Deal tier definitions (S/A/B-tier)
  transfer-partners.ts    # Credit card program -> airline mappings
  scraper-config.ts       # Centralized timeouts, retry settings
  scraper-health.ts       # Circuit breaker + health tracking
  history.ts              # Price history (90-day pruning)
  monitor.ts              # Search orchestrator (used by dev mode)
  utils.ts                # Atomic file writes
  scrapers/
    index.ts              # Scraper registry
    cache.ts              # Bounded in-memory + disk cache
    camoufox-runner.ts    # Shared Python subprocess runner
    aa-camoufox.ts/.py    # American Airlines (Camoufox)
    aa-fast.ts/.py        # American Airlines (cookie replay)
    aa.ts                 # American Airlines (Playwright)
    ana-camoufox.ts/.py   # ANA Mileage Club
    ba-camoufox.ts/.py    # British Airways Avios
    sq-camoufox.ts/.py    # Singapore Airlines KrisFlyer
    delta-va-camoufox.ts/.py  # Delta via Virgin Atlantic
    united-aeroplan-camoufox.ts/.py  # United via Aeroplan
    google-flights.ts     # Cash prices for CPP
    [+ other airlines]

data/                     # Runtime state (gitignored)
  flight-signups.json     # Your watch list
  flight-monitor-history.json  # Last 48 scans
  flight-rotation-state.json   # Cycle offset
  sent-alerts.json        # Alert dedup (90-day TTL)
  daemon-status.json      # Health metrics
  scraper-health.json     # Per-scraper stats
  flight-cache.json       # Web cache for frontend

config/
  stealth-config.json     # Anti-bot settings
  airline-accounts.json   # Airline credentials (gitignored)
```

## Environment Variables

See `.env.example` for the full list with descriptions. Key ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANA_USERNAME` | For ANA scraper | ANA Mileage Club membership number |
| `ANA_PASSWORD` | For ANA scraper | ANA web password |
| `SQ_KRISFLYER_ID` | For SQ scraper | KrisFlyer membership number |
| `SQ_KRISFLYER_PASSWORD` | For SQ scraper | KrisFlyer password |
| `BA_EXEC_CLUB_NUMBER` | For BA scraper | BA Executive Club number |
| `BA_EXEC_CLUB_PASSWORD` | For BA scraper | BA Executive Club password |
| `WEB_CACHE_PATH` | Optional | Path to Andes-Website flight cache |
| `DATA_DIR` | Optional | Base data directory (default: `./data`) |
| `PROXY_URL` | Optional | SOCKS5 proxy for scrapers |
| `SCRAPER_CACHE_DIR` | Optional | Enable disk-backed scraper cache |
| `DATE_SAMPLING_DAYS` | Optional | Days between sampled dates (default: 14) |

## Tech Stack

- **TypeScript + Python** — TS orchestration, Python for anti-detect browsers
- **Camoufox** — Anti-detect Firefox fork (bypasses Akamai, Cloudflare)
- **Playwright + stealth plugin** — Fallback browser automation
- **Cloudflare WARP** — SOCKS5 proxy for IP rotation
- **OpenClaw** — WhatsApp alert delivery
- **Node.js** — ES2022, NodeNext modules, strict mode
