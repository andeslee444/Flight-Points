# Roadmap: Flight Points

## Overview

Six phases take Flight Points from bare database infrastructure to a complete public award flight search platform. Phase 1 starts the price history clock immediately — historical data only has value after it accumulates, so that daemon extension ships first. Phase 2 scaffolds the Next.js app and delivers the deal feed using data that already exists. Phase 3 builds the core search experience with CPP value assessment. Phase 4 ships the price history chart (meaningful only after 3-4 weeks of accumulated data from Phase 1). Phase 5 adds live SSE scraping to the search page. Phase 6 completes the platform with user accounts, email/WhatsApp alerts, and booking guidance.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Database Foundation** - Normalize price_history, extend daemon, scaffold auth tables
- [ ] **Phase 2: App Shell + Deal Feed** - Next.js 16 app deployed to Vercel with static deal feed
- [ ] **Phase 3: Search + Value Assessment** - Core route search with CPP, badges, transfer partners
- [ ] **Phase 4: Price History Charts** - Historical trend chart and transfer bonus display
- [ ] **Phase 5: Live Search (SSE)** - Real-time scraper result streaming via Harbor proxy
- [ ] **Phase 6: Auth + Alerts + Booking** - User accounts, email/WhatsApp alerts, booking guidance

## Phase Details

### Phase 1: Database Foundation
**Goal**: The database schema supports time-series price history queries and user alert subscriptions, and the daemon is extended to write historical data on every scrape cycle
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05
**Success Criteria** (what must be TRUE):
  1. A normalized `price_history` table exists in AWS RDS with indexed rows per (route, cabin, program, scrape_date) — queryable for time-series aggregation, not JSONB blobs
  2. The daemon appends a row to `price_history` on every scrape cycle — verified by querying the table after two daemon cycles
  3. An `alert_subscriptions` table exists with user, route, cabin, and channel columns ready to receive subscriptions
  4. Better Auth user/session tables are applied via Drizzle migration and the schema is live on AWS RDS
  5. The Next.js app (Vercel) reads results from PostgreSQL, and the daemon (Harbor) writes to PostgreSQL — no other integration boundary exists between the two environments
**Plans**: TBD

Plans:
- [ ] 01-01: Create and apply Drizzle migrations for price_history, alert_subscriptions, and Better Auth tables
- [ ] 01-02: Implement history-writer daemon extension (appends to price_history on each scrape cycle)
- [ ] 01-03: Implement alert-checker daemon skeleton (compares flight_cache against alert_subscriptions)
- [ ] 01-04: Add availabilityType field to FlightResult schema and propagate through existing scrapers

### Phase 2: App Shell + Deal Feed
**Goal**: A Next.js 16 app is deployed to Vercel with a dark-themed deal feed page showing the best current award deals from the existing flight cache
**Depends on**: Phase 1
**Requirements**: DEAL-01, DEAL-02, DEAL-03
**Success Criteria** (what must be TRUE):
  1. A user can navigate to the Flight Points URL on Vercel and see a curated list of the best current award deals across all routes
  2. A user can filter the deal feed by cabin class, region, and credit card program and the results update without a full page reload
  3. Deal cards on the feed show S/A/B tier sweet spot badges where applicable
  4. The app is dark-themed, mobile-responsive, and uses consistent shadcn/ui components throughout
**Plans**: TBD

Plans:
- [ ] 02-01: Scaffold Next.js 16 app (App Router, TypeScript, Tailwind v4, shadcn/ui, Biome) and deploy to Vercel
- [ ] 02-02: Build deal feed page as React Server Component reading from existing flight_cache via Drizzle
- [ ] 02-03: Add filter bar (cabin, region, credit card program) as Client Component with Zustand state

### Phase 3: Search + Value Assessment
**Goal**: Users can search award flights by route and see multi-program results with CPP, deal quality badges, transfer partner display, freshness indicators, and direct booking links
**Depends on**: Phase 2
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-06, SRCH-07, SRCH-08, SRCH-09, SRCH-10, VALU-01, VALU-02, VALU-03, VALU-04
**Success Criteria** (what must be TRUE):
  1. A user can enter an origin, destination, cabin class, and date and see award flight results from multiple airline programs in a single unified list
  2. Each result shows cents-per-point (CPP), a deal quality badge (good/great/incredible), cash price savings ("Saves you $X vs cash"), and which credit card programs can transfer to book it
  3. Results matching sweet spots display an S/A/B tier badge (e.g., "S-Tier: Holy Grail")
  4. Each result has a direct booking link to the airline's award booking page and a freshness timestamp showing when the data was last scraped
  5. Nearby airports are deduplicated by default (JFK/EWR/LGA shown as one metro), and the UI shows alliance gateway labels and scraper health transparency notices where coverage is limited
  6. The search UI is fully mobile-responsive and works correctly on phone-sized screens
**Plans**: TBD

Plans:
- [ ] 03-01: Build search form (origin/dest autocomplete, cabin, date) as Client Component with Zustand
- [ ] 03-02: Port /api/flights/search from Express to Next.js Route Handler with cached result enrichment
- [ ] 03-03: Build FlightResultCard with CPP, deal badge, sweet spot badge, transfer partners, booking link, freshness
- [ ] 03-04: Add metro deduplication toggle, alliance gateway labels, and coverage transparency notices

### Phase 4: Price History Charts
**Goal**: Users can see a historical price trend chart for any searched route, showing how point costs have changed over time and whether active transfer bonuses reduce the effective redemption cost
**Depends on**: Phase 3 (and Phase 1 data accumulation — build 3-4 weeks after Phase 1)
**Requirements**: VALU-05, VALU-06
**Success Criteria** (what must be TRUE):
  1. Below search results for a route, a user can see an area chart showing point cost over the past 30 days for that route and cabin combination
  2. A user can see a label on relevant results when an active transfer bonus reduces the effective cost ("30% Amex MR → ANA bonus: effectively X pts")
**Plans**: TBD

Plans:
- [ ] 04-01: Build /api/flights/history Route Handler querying normalized price_history table
- [ ] 04-02: Build PriceHistoryChart component (Recharts v2 area chart via shadcn/ui) integrated below results
- [ ] 04-03: Add transfer bonus display layer to FlightResultCard (data source: manual config or external feed)

### Phase 5: Live Search (SSE)
**Goal**: Users see real-time loading progress as scrapers return results one by one, with fresh live data streaming in for routes not in the daemon cache
**Depends on**: Phase 3
**Requirements**: SRCH-05
**Success Criteria** (what must be TRUE):
  1. When a user submits a search, they see a progress indicator showing scrapers loading (e.g., "AA: 124 results", "Flying Blue: loading...") that updates in real time as each scraper completes
  2. Live scraper results stream into the results list progressively without requiring a page reload
  3. The SSE connection routes through Harbor's Express proxy (not a Vercel serverless function) and handles disconnection and reconnection gracefully
**Plans**: TBD

Plans:
- [ ] 05-01: Set up lightweight Harbor Express proxy endpoint at :3001 for live scraper SSE
- [ ] 05-02: Build useLiveSearch hook with native EventSource and result accumulation via Zustand
- [ ] 05-03: Build LiveSearchProgress component as leaf Client Component (not page root) with per-scraper status

### Phase 6: Auth + Alerts + Booking
**Goal**: Users can create accounts, save their credit card programs, set route-specific and global sweet spot alert watches, receive email and WhatsApp notifications when deals appear, and access step-by-step booking guidance
**Depends on**: Phase 3
**Requirements**: ACCT-01, ACCT-02, ACCT-03, ACCT-04, ACCT-05, ALRT-01, ALRT-02, ALRT-03, ALRT-04, ALRT-05, BOOK-01, BOOK-02, BOOK-03
**Success Criteria** (what must be TRUE):
  1. A user can create an account with email and password, log in, and remain logged in across browser refreshes and tab closes
  2. A user can save their credit card programs (e.g., "I have Chase UR and Amex MR") and have results automatically filtered to show only bookable options
  3. A user can set a route-specific watch (origin/destination/cabin) and receive an email alert when award availability appears or price drops, with the email including deal details, CPP, tier badge, scrape timestamp, and a direct booking link
  4. A user can subscribe to global sweet spot alerts and receive a WhatsApp or email notification when an incredible deal (S-tier) appears on any route
  5. A user can view, edit, and delete their active alert subscriptions from an /alerts page
  6. For any search result, a user can navigate to a booking guidance page with step-by-step transfer instructions for each credit card program, including estimated transfer time and transfer minimums
**Plans**: TBD

Plans:
- [ ] 06-01: Integrate Better Auth (email/password) with Next.js 16 App Router and pg adapter
- [ ] 06-02: Build /account page with saved programs, home airport, default cabin preferences
- [ ] 06-03: Build /alerts page with CRUD UI for route watches and global sweet spot subscriptions
- [ ] 06-04: Build /api/alerts Route Handlers (Drizzle queries against alert_subscriptions table)
- [ ] 06-05: Implement alert-checker daemon extension sending email via Resend + WhatsApp via OpenClaw
- [ ] 06-06: Build booking guidance pages with per-program transfer instructions

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Database Foundation | 0/4 | Not started | - |
| 2. App Shell + Deal Feed | 0/3 | Not started | - |
| 3. Search + Value Assessment | 0/4 | Not started | - |
| 4. Price History Charts | 0/3 | Not started | - |
| 5. Live Search (SSE) | 0/3 | Not started | - |
| 6. Auth + Alerts + Booking | 0/6 | Not started | - |
