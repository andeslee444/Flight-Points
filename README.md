# ✈️ Harbor Flights

Airline award flight scraper & alert system. Monitors multiple airlines for award availability and sends WhatsApp alerts when sweet spot deals appear.

## ✨ Features

- **Multi-Airline Scraping** — American Airlines, ANA, Singapore Airlines, British Airways
- **AA Camoufox Scraper** — Anti-detect browser with Cloudflare WARP proxy for stealth scraping
- **Flight Daemon** — Automated 30-minute scan cycles for continuous monitoring
- **WhatsApp Alerts** — Instant notifications for sweet spot award deals
- **Dedup Alerts** — Smart deduplication so you only get notified once per deal
- **Cache Layer** — Reduces redundant scraping and speeds up lookups

## 🛠 Tech Stack

- **Backend:** TypeScript + Python
- **Browser Automation:** Playwright + Stealth Plugin, Camoufox
- **Proxy:** Cloudflare WARP
- **Web Server:** Express
- **Alerts:** WhatsApp API

## 🚀 Setup

```bash
# Install Node dependencies
npm install

# Install Python dependencies (for Camoufox scrapers)
pip install -r requirements.txt

# Configure environment
cp .env.example .env  # Add airline credentials, WARP proxy, WhatsApp config

# Run the flight daemon
npm run daemon

# Or run a one-off search
npm run search
```

## 📋 Commands

| Command | Description |
|---------|-------------|
| `npm run daemon` | Start the flight monitoring daemon (30-min cycles) |
| `npm run search` | Run a one-off award search |
| `npm run dev` | Start the monitor in dev mode |

## ⚙️ How It Works

1. Configure target routes, dates, and cabin classes
2. The daemon scrapes airline award portals on a 30-minute cycle
3. Results are cached and deduplicated against previous alerts
4. New sweet spot availability triggers a WhatsApp notification
