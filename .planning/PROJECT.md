# Flight Points

## What This Is

A public award flight search and deal discovery platform that helps travelers find the best value for their credit card points. Users can search specific routes to see if they're getting a good deal (with CPP analysis, historical trends, and sweet spot identification), or browse a curated feed of the best current deals and set alerts for when incredible redemptions become available. Think "Google Flights meets points optimization" — faster, more comprehensive, and smarter than point.me or seats.aero.

## Core Value

Users instantly know whether a points redemption is a good deal — and never miss an incredible one.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Multi-airline award flight scraping (AA, Flying Blue, Delta/VA, Alaska, Cathay, Google Flights) — existing
- ✓ Tiered scraper fallback chains (Chrome CDP → curl_cffi → Patchright → Camoufox → Playwright) — existing
- ✓ Alliance gateway strategy (~4 scrapers cover ~80% of award flights) — existing
- ✓ 30-minute daemon scrape cycles with rotation and circuit breaker — existing
- ✓ Sweet spot deal definitions with S/A/B tier thresholds — existing
- ✓ Credit card transfer partner mappings (Amex, Chase, Citi, Capital One, Bilt) — existing
- ✓ CPP calculation and deal rating enrichment — existing
- ✓ WhatsApp alert dispatch via OpenClaw CLI — existing
- ✓ PostgreSQL persistence (signups, cache, alerts, health metrics) — existing
- ✓ Live SSE scraping from web UI (max 2 concurrent) — existing
- ✓ Basic search UI with results display — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Modern Google Flights-like frontend (clean, functional, map-friendly)
- [ ] Targeted search mode: origin/dest/dates/cabin → results across all programs with value context
- [ ] Deal browsing mode: curated feed of best current deals across all routes
- [ ] Historical price trends: "this route usually costs X points" with visual chart (like Google Flights price history)
- [ ] Value assessment: CPP vs cash price, good/great/incredible rating, sweet spot highlights
- [ ] Route-specific alert watches: user sets route/cabin, notified when availability appears or price drops
- [ ] Global sweet spot alerts: notified when known incredible deals appear on any route
- [ ] Email alert channel
- [ ] WhatsApp/SMS alert channel (extends existing WhatsApp infra)
- [ ] User accounts and authentication
- [ ] All major credit card program support (Amex MR, Chase UR, Citi TYP, Capital One, Bilt)
- [ ] Fresh cached data (<30 min old) with instant display + live scrape on demand
- [ ] Booking guidance: direct links to airline booking pages with transfer instructions

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Mobile native app — web-first, responsive design covers mobile use cases
- Social features / community — focused on utility, not social
- Monetization / payment processing — build product first, monetize after traction
- Hotel/car award redemptions — flights only for v1
- seats.aero or point.me API integration — competitor services, build our own data

## Context

- Existing codebase has ~6 working scrapers covering oneworld (AA), SkyTeam (Flying Blue, Delta/VA), and select partners (Alaska, Cathay, Google Flights)
- Star Alliance coverage (United/Aeroplan) is blocked by Gigya reCAPTCHA — major gap
- Anti-bot landscape is the primary technical challenge: Akamai, Cloudflare, and reCAPTCHA all actively block scraping
- Chrome CDP approach (real Chrome + remote debugging port) is the most reliable bypass for Akamai-protected sites
- Oracle Cloud VPS provides SOCKS5 proxy for IP reputation management
- Production daemon runs on Harbor (Mac Mini); Vercel hosts frontend (but can't run Python scrapers)
- User specified fresh start with modern framework — port scraper logic, rebuild everything else

## Constraints

- **Anti-bot**: Airline sites actively detect and block automation — scraper reliability is never 100%
- **Python dependency**: Anti-detect browsers (Camoufox, Patchright, curl_cffi) only have Python bindings — TypeScript must orchestrate Python subprocesses
- **Deployment split**: Python scrapers can only run on a server with Chrome/Python (not Vercel) — need daemon + web frontend architecture
- **Rate limits**: Airlines rate-limit searches — daemon rotation (25/cycle) and circuit breakers are essential
- **Credential management**: Most scrapers require airline loyalty program accounts — credentials must be securely managed
- **IP reputation**: Residential IPs risk being flagged across airline sites — VPS proxy required for scraping

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fresh codebase with modern frontend framework | Existing static HTML/Express won't scale to the full vision (maps, charts, real-time updates) | — Pending |
| Port existing scraper infrastructure | 6 working scrapers + daemon logic is proven and battle-tested — don't rewrite | — Pending |
| Google Flights-like design language | Clean, functional, trusted — users already know this UX pattern | — Pending |
| All major credit card programs from day 1 | Transfer partner coverage is a key differentiator vs competitors | — Pending |
| Email + WhatsApp/SMS for alerts | Email is standard, WhatsApp extends existing infra — covers most users | — Pending |

---
*Last updated: 2026-02-26 after initialization*
