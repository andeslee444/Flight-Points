# Feature Landscape

**Domain:** Award flight search and deal discovery platform (points and miles travel)
**Project:** Flight Points
**Researched:** 2026-02-26
**Confidence:** HIGH (primary sources: competitor live analysis, NerdWallet, FrequentMiler, ThePointsAnalyst, AwardFares blog)

---

## Competitive Landscape Context

The field is crowded but none of the competitors nail all dimensions simultaneously:

| Tool | Strength | Weakness |
|------|----------|----------|
| point.me | Beginner UX, step-by-step guidance, 30+ programs | Slow (~2 min per search), paywalled alerts, no CPP display |
| seats.aero | Speed, breadth (23 programs), calendar view | No value assessment, no CPP, primarily availability-only |
| Roame | Transfer bonus tracking, credit card integration, map view | Paywalled flex search, 21 programs |
| AwardFares | Aircraft type filters, live alerts, real-time availability | Niche focus, premium-priced ($20/mo Diamond) |
| ExpertFlyer | Depth of seat-level data, 200 alerts | Old UX, expensive, aviation-enthusiast oriented |
| Thrifty Traveler Premium | Curated deal emails, text alerts for mistake fares | Subscription, editorial not live data, no search |
| Pointhound | Home-airport-specific deal digests | Very new, limited |

**Flight Points opportunity:** The only tool combining (1) real live availability data, (2) CPP value assessment, (3) sweet spot identification, (4) transfer partner awareness, and (5) clean Google Flights-level UX — all in one free tier. The competitors either charge $10–$20/mo for basic features or sacrifice value assessment for speed.

---

## Table Stakes

Features users expect in an award flight search tool. Missing these and users immediately leave.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Route search: origin, destination, cabin, date | Core task — what every user arrives to do | Low | Already partially built; needs clean UX redesign |
| Results showing: airline, departure time, miles required, program name | Without this, results are meaningless | Low | `FlightResult` type already carries all fields |
| Multi-program results in one search | Users expect cross-program comparison, not one-at-a-time | Medium | Existing scraper registry + SSE handles this |
| Transfer partner display ("book with Amex MR") | Users think in credit card currencies, not airline miles | Low | `transfer-partners.ts` already maps this |
| Deal quality indicator (good / great / incredible) | Users need a fast signal — don't make them do math | Low | `computeDealRating()` already exists |
| CPP (cents per point) display | The universal metric users use to compare redemptions | Low | Already computed; needs display in UI |
| Cash vs miles comparison ("saves you $X") | Users want to know if using points beats paying cash | Medium | Google Flights cash lookup + CPP gives this |
| Mobile-responsive layout | >50% of travel searches happen on mobile | Medium | Current UI is desktop-only; needs responsive rebuild |
| Loading state / progress feedback | Live scraping takes 20–60s — need to show progress | Low | SSE already streams; UI just needs progress bar |
| Direct airline booking link | After finding a deal, users need to know where to book | Low | `getBookingUrl()` already exists |
| Fresh data indicator (when was this last scraped) | Users need to know if data is real-time or stale | Low | `last_scraped` timestamp already tracked |
| Basic email alerts for routes user is watching | Standard for any monitoring tool — SMS/email is the contract | Medium | Infrastructure exists (WhatsApp); email channel needed |

---

## Differentiators

Features that set Flight Points apart. Not universally expected, but create strong retention and word-of-mouth when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sweet spot database with S/A/B tier ratings | Curated editorial intelligence — "this is one of the top 10 deals in all of points travel" | Low | `sweet-spots.ts` database already exists with 15+ entries; needs display layer |
| Historical points price trend chart | "Is this a good price relative to history?" — same insight that made Google Flights price history so popular | High | `history.ts` module exists but is orphaned (no data yet); requires 30+ days of daemon data accumulation |
| Transfer bonus awareness ("50% bonus this month = effectively 29K miles") | Real cost in credit card points is lower during bonuses; no competitor displays this in results | Medium | Transfer bonus data exists (Roame tracks it publicly); display in results is unbuilt |
| Alliance gateway labeling ("This result covers 80+ airlines") | Users don't know that searching AA finds JAL, Cathay, Qatar, etc. — teaching this earns trust | Low | Registry knows alliance coverage; just needs display |
| Nearby airport deduplication with expansion option | JFK/EWR/LGA should show as one origin by default, expandable — same as Google Flights | Low | `collapseToRepresentative()` already in `live-scraper.ts` |
| Flexible date browsing (calendar heatmap: cheapest days) | "When is the cheapest month to fly business to Japan?" is a top user question | High | Requires parallel multi-date scraping + storage across 30+ days |
| Global sweet spot deal feed (not route-specific) | Browse the best deals happening right now across all routes — like a curated deal newsletter in real-time | Medium | Daemon already scrapes continuously; `/api/flights/deals` endpoint exists but needs frontend |
| Aircraft type / product tagging (e.g., "Boeing 787 Dreamliner", "Qatar QSuites") | Enthusiasts specifically want certain cabin products, not just any business class | Medium | Some product names in `sweet-spots.ts`; scraper data is inconsistent |
| Booking guidance: step-by-step transfer instructions per program | Users fear the transfer; clear instructions remove the final barrier to booking | Medium | point.me does this and users love it; we have the knowledge, need the UI |
| WhatsApp / SMS alerts for time-sensitive unicorn deals | Email is too slow for seats that sell in minutes; WhatsApp is already built | Low | OpenClaw WhatsApp infra already working; just needs user-facing signup flow |
| Transfer partner filter ("show me only what I can book with Chase UR") | Users want to search within their actual points balance — most competitors ignore this | Low | `getScrapersForProgram()` already exists; UI just needs the filter |
| Scraper health transparency ("Star Alliance data temporarily unavailable") | Honest about gaps — builds trust when a competitor might silently show incomplete results | Low | `scraper-health.json` data already tracked; just needs UI surface |
| Deal tier badges on sweet spots ("S-Tier: Holy Grail") | Editorial voice creates brand identity and helps users prioritize | Low | Tier system already defined in `sweet-spots.ts` |

---

## Anti-Features

Features to deliberately NOT build in the near term. These would dilute focus or create problems that outweigh their value.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| AI trip planner / chatbot interface | seats.aero added this in 2025; adds complexity with unclear return for a search-first product | Keep the search-and-filter UX; AI can be a Phase N feature after core is solid |
| Seats.aero or point.me API integration | Explicitly out of scope per PROJECT.md; creates competitor dependency and legal risk | Build own data via scrapers |
| Multi-city itinerary builder | Complex booking workflows (e.g., "fly JFK→Tokyo→Bangkok→home") are outside the MVP scope | Focus on one-way and round-trip single-segment search first |
| Hotel / car award redemptions | Flights only for v1 per PROJECT.md; hotels require entirely different scraper infrastructure | Document as explicit Phase N future work |
| Social features (trip sharing, community forum) | No evidence this creates retention for points tools; seats.aero/point.me don't have it either | Points travel is personal finance — keep it private by default |
| Native mobile app (iOS / Android) | Web-first with responsive design covers mobile; app store overhead not justified at this stage | Responsive web; PWA if demand warrants |
| Booking aggregation / direct booking through the platform | Requires airline partnerships or deep API access; creates liability; not how award travel works | Deep-link to airline booking pages with step-by-step instructions |
| Points buying marketplace / points brokerage | Regulatory and legal exposure; different business entirely | Stick to search and discovery |
| Real-time seat maps (ExpertFlyer-style) | Seat map data requires expensive GDS access; not the value prop | Seat map link to SeatGuru / ExpertFlyer for users who need it |
| Points portfolio tracker / aggregation (like AwardWallet) | Requires users to share loyalty credentials with us — high-trust feature with security surface area | Link to AwardWallet for portfolio tracking |
| "Book for me" concierge service | 10xTravel does this as a paid service; requires human labor; not scalable | Booking guidance docs + direct links are sufficient |
| Paid subscription with paywalled search | Competitors ($10–$20/mo) face user friction; Flight Points' advantage is being free-first | Free core, optional premium alerts tier later |

---

## Feature Dependencies

```
User Authentication
  → Email alert signup (requires user account for alert delivery)
  → Alert deduplication per user (90-day window already exists for daemon)
  → Transfer partner filter persistence (save "I have Chase UR")

Sweet Spot Database (exists)
  → Deal tier badge display
  → Sweet spot match on search results
  → Global deal feed (filter by S/A/B tier)
  → Incredible-deal text/WhatsApp alerts

Google Flights Cash Lookup (exists)
  → CPP calculation (cash / points = CPP)
  → "Saves you $X" display
  → Value assessment (good/great/incredible) is CPP-relative

Historical Price Data (no data yet)
  → Price trend chart requires 30+ days of collected data
  → "Is this cheap right now?" indicator requires baseline
  → Calendar heatmap of cheapest dates requires multi-date data

Live SSE Scraping (exists)
  → Progress bar during search
  → "Loading airline by airline" real-time results
  → Fresh cache for subsequent display

Daemon 30-min Cycles (exists)
  → Global deal feed (populated continuously)
  → Background alert checking
  → Historical trend data accumulation

Transfer Bonus Tracking
  → "Effective cost" display in results
  → Transfer bonus alert ("Chase→Hyatt 30% bonus ends Sunday")
```

---

## MVP Recommendation

The fastest path to a product that beats competitors on the dimensions that matter most.

**Must ship (table stakes that gate all else):**
1. Clean route search UI with origin / destination / cabin / date inputs
2. Multi-program results with miles required, program name, and direct booking link
3. CPP display + deal quality badge (good / great / incredible)
4. Transfer partner display ("Transferable from: Amex MR, Chase UR")
5. Mobile-responsive layout
6. Real-time loading progress via SSE (already works — just needs good UX)

**Ship immediately after (quick wins with high leverage):**
7. Sweet spot match badge on results (S/A/B tier — database already exists)
8. Global deal feed page ("Top deals right now across all routes")
9. Email alert signup for specific routes
10. Booking guidance page per program (step-by-step transfer instructions)

**Defer (high complexity, requires accumulation time or infra work):**
- Historical price trend chart — needs 30+ days of daemon data before chart is meaningful
- Calendar heatmap / flexible date view — needs multi-date parallel scraping
- Transfer bonus awareness in results — requires live bonus data source
- Aircraft/product tagging — scraper data is inconsistent across sources

---

## Feature Complexity Reference

| Feature | Build Complexity | Reason |
|---------|----------------|--------|
| Route search UI | Low | UI rebuild; backend exists |
| CPP + deal badge display | Low | Logic exists in `computeDealRating()` |
| Sweet spot match badge | Low | `matchSweetSpots()` exists |
| Booking link | Low | `getBookingUrl()` exists |
| Transfer partner display | Low | `transfer-partners.ts` exists |
| Email alerts | Medium | New channel; needs email provider integration |
| Deal feed page | Medium | `/api/flights/deals` exists; needs frontend |
| Booking guidance content | Medium | Content creation + per-program page design |
| Historical price chart | High | Requires 30+ days data + chart UI + schema work |
| Calendar heatmap | High | Multi-date scraping architecture + visualization |
| Transfer bonus integration | Medium | Requires external bonus data source or manual updates |
| User accounts / auth | High | Full auth stack: signup, login, session, password reset |

---

## Sources

- [Best Award Flight Search Tools 2026 — ThePointsAnalyst](https://www.thepointsanalyst.com/best-award-flight-search-tools/) — MEDIUM confidence (independent review site)
- [Which award search tool is best? — FrequentMiler](https://frequentmiler.com/which-award-search-tool-is-best/) — MEDIUM confidence (expert hobbyist analysis)
- [point.me Review — NerdWallet](https://www.nerdwallet.com/travel/learn/point-me-award-search-review) — MEDIUM confidence (mainstream review)
- [How Point.me Works — NerdWallet](https://www.nerdwallet.com/travel/learn/point-me-guide) — MEDIUM confidence
- [seats.aero How To Use — ThePointsAnalyst](https://www.thepointsanalyst.com/seats-aero/) — MEDIUM confidence
- [PointsYeah vs seats.aero — TheMilesMarket](https://www.themilesmarket.com/post/pointsyeah-vs-seats-aero-the-ultimate-award-search-tool-review) — MEDIUM confidence
- [AwardFares vs Roame — AwardFares Blog](https://blog.awardfares.com/roame-travel/) — LOW confidence (vendor-authored)
- [Roame Review 2025 — ThePointsParty](https://thepointsparty.com/articles/roame-travel-review) — MEDIUM confidence
- [10 Best Award Search Tools — ThriftyTraveler](https://thriftytraveler.com/guides/points/award-search-tools/) — MEDIUM confidence
- [Google Flights Price History — FlyerTalk](https://www.flyertalk.com/articles/google-flights-now-displays-flight-price-history-insights.html) — HIGH confidence (primary reporting)
- [Thrifty Traveler Premium Features](https://thriftytraveler.com/premium/) — HIGH confidence (first-party)
- [Current Transfer Bonuses — Roame](https://roame.travel/guides/points-transfer-bonuses) — HIGH confidence (first-party)
- Existing codebase analysis: `sweet-spots.ts`, `monitor.ts`, `transfer-partners.ts`, `scrapers/index.ts`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md` — HIGH confidence (direct code inspection)
