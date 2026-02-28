# Requirements: Flight Points

**Defined:** 2026-02-26
**Core Value:** Users instantly know whether a points redemption is a good deal — and never miss an incredible one.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Search

- [x] **SRCH-01**: User can search award flights by origin, destination, cabin class, and date
- [x] **SRCH-02**: User sees results from multiple airline programs in a single search
- [x] **SRCH-03**: User sees which credit card programs can transfer to each result (e.g., "Amex MR, Chase UR")
- [x] **SRCH-04**: User can click a direct booking link to the airline's award booking page
- [ ] **SRCH-05**: User sees real-time loading progress as scrapers return results via SSE
- [x] **SRCH-06**: User sees when results were last scraped (freshness indicator)
- [x] **SRCH-07**: User experience is fully responsive on mobile devices
- [x] **SRCH-08**: Nearby airports are deduplicated by default (JFK/EWR/LGA as one metro) with expand option
- [x] **SRCH-09**: Results show alliance gateway coverage labels ("Covers 80+ airlines via oneworld")
- [x] **SRCH-10**: User sees scraper health transparency ("Star Alliance data temporarily unavailable")

### Value Assessment

- [x] **VALU-01**: User sees cents-per-point (CPP) for each result
- [x] **VALU-02**: User sees a deal quality badge on each result (good / great / incredible)
- [x] **VALU-03**: User sees cash price comparison showing dollar savings ("Saves you $X vs cash")
- [x] **VALU-04**: Results matching known sweet spots show S/A/B tier badge ("S-Tier: Holy Grail")
- [x] **VALU-05**: User sees historical price trend chart for a route ("this route usually costs X points")
- [ ] **VALU-06**: User sees when active transfer bonuses reduce the effective cost of a redemption

### Deal Discovery

- [x] **DEAL-01**: User can browse a global deal feed showing best current deals across all routes
- [x] **DEAL-02**: Deal feed can be filtered by cabin class, region, and credit card program
- [x] **DEAL-03**: Deal feed highlights sweet spot matches with tier badges

### Alerts

- [ ] **ALRT-01**: User can set a route-specific watch (origin/destination/cabin) and receive email when availability appears or price drops
- [ ] **ALRT-02**: User can subscribe to global sweet spot alerts (notified when incredible deals appear on any route)
- [ ] **ALRT-03**: Email alerts include deal details, CPP, tier badge, and direct booking link
- [ ] **ALRT-04**: WhatsApp/SMS alerts available for time-sensitive unicorn deals
- [ ] **ALRT-05**: User can manage (view, edit, delete) their active alerts

### User Accounts

- [ ] **ACCT-01**: User can create an account with email and password
- [ ] **ACCT-02**: User can log in and maintain a session across browser refresh
- [ ] **ACCT-03**: User can reset their password via email link
- [ ] **ACCT-04**: User can save their credit card programs ("I have Chase UR, Amex MR") and filter results accordingly
- [ ] **ACCT-05**: User preferences persist across sessions (saved programs, default cabin, home airport)

### Booking Guidance

- [ ] **BOOK-01**: User sees step-by-step transfer instructions for each credit card program (e.g., "Transfer Amex MR to ANA Mileage Club")
- [ ] **BOOK-02**: Booking guidance includes estimated transfer time, minimum transfer amounts, and any gotchas
- [ ] **BOOK-03**: Each result links to its corresponding booking guidance page

### Infrastructure

- [x] **INFR-01**: Normalized price_history table accumulates historical price data from daemon scrape cycles
- [x] **INFR-02**: Daemon history-writer extension appends time-series data on each scrape cycle
- [x] **INFR-03**: Alert-checker daemon extension compares fresh cache against user alert subscriptions
- [x] **INFR-04**: Frontend deployed to Vercel with Next.js; scrapers remain on Harbor daemon
- [x] **INFR-05**: PostgreSQL serves as sole integration boundary between Harbor (writes) and Vercel (reads)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Search

- **ASRCH-01**: Flexible date browsing with calendar heatmap showing cheapest days across a month
- **ASRCH-02**: Multi-city / open-jaw itinerary search
- **ASRCH-03**: Aircraft type / cabin product filtering (e.g., "Qatar QSuites only")

### Advanced Alerts

- **AALRT-01**: Transfer bonus alerts ("Chase → Hyatt 30% bonus ends Sunday")
- **AALRT-02**: Push notification channel (browser or mobile)

### Analytics

- **ANLT-01**: Points portfolio tracking integration (link to AwardWallet)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| AI trip planner / chatbot | Adds complexity with unclear return for a search-first product |
| seats.aero or point.me API integration | Competitor dependency and legal risk |
| Hotel / car award redemptions | Flights only for v1; entirely different scraper infra |
| Native mobile app (iOS/Android) | Web-first with responsive design covers mobile |
| Booking aggregation / "book for me" | Requires airline partnerships; liability exposure |
| Points buying marketplace | Regulatory/legal exposure; different business |
| Real-time seat maps | Requires expensive GDS access; not core value prop |
| Points portfolio tracker | Requires users to share loyalty credentials; high trust bar |
| Paid subscription with paywalled search | Free-first is the competitive advantage |
| Social features / community | No evidence this creates retention for points tools |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRCH-01 | Phase 3 | Complete |
| SRCH-02 | Phase 3 | Complete |
| SRCH-03 | Phase 3 | Complete |
| SRCH-04 | Phase 3 | Complete |
| SRCH-05 | Phase 5 | Pending |
| SRCH-06 | Phase 3 | Complete |
| SRCH-07 | Phase 3 | Complete |
| SRCH-08 | Phase 3 | Complete |
| SRCH-09 | Phase 3 | Complete |
| SRCH-10 | Phase 3 | Complete |
| VALU-01 | Phase 3 | Complete |
| VALU-02 | Phase 3 | Complete |
| VALU-03 | Phase 3 | Complete |
| VALU-04 | Phase 3 | Complete |
| VALU-05 | Phase 4 | Complete |
| VALU-06 | Phase 4 | Pending |
| DEAL-01 | Phase 2 | Complete |
| DEAL-02 | Phase 2 | Complete |
| DEAL-03 | Phase 2 | Complete |
| ALRT-01 | Phase 6 | Pending |
| ALRT-02 | Phase 6 | Pending |
| ALRT-03 | Phase 6 | Pending |
| ALRT-04 | Phase 6 | Pending |
| ALRT-05 | Phase 6 | Pending |
| ACCT-01 | Phase 6 | Pending |
| ACCT-02 | Phase 6 | Pending |
| ACCT-03 | Phase 6 | Pending |
| ACCT-04 | Phase 6 | Pending |
| ACCT-05 | Phase 6 | Pending |
| BOOK-01 | Phase 6 | Pending |
| BOOK-02 | Phase 6 | Pending |
| BOOK-03 | Phase 6 | Pending |
| INFR-01 | Phase 1 | Complete |
| INFR-02 | Phase 1 | Complete |
| INFR-03 | Phase 1 | Complete |
| INFR-04 | Phase 1 | Complete |
| INFR-05 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 — Phase 1 complete, INFR-01 through INFR-05 marked complete*
