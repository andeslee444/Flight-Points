# Project Research Summary

**Project:** Flight Points — Award Flight Search Platform (Frontend + Features Rebuild)
**Domain:** Award flight search and deal discovery (points and miles travel)
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

Flight Points is an award flight search platform that scrapes airline booking portals in real time, scores redemptions by cents-per-point value, and surfaces sweet-spot deals to users. The existing infrastructure — a TypeScript daemon with Python scraper subprocesses (Chrome CDP, curl_cffi, Patchright, Camoufox), a circuit-breaker health system, and an AWS RDS PostgreSQL database — is mature and working. The project is now in a frontend rebuild and feature-addition phase. The backend scraping infrastructure is preserved as-is; everything being built goes on top of it.

The recommended approach is a Next.js 16 frontend deployed to Vercel, with PostgreSQL as the integration boundary between the Vercel-hosted frontend and the Harbor Mac Mini daemon. The daemon cannot run on Vercel (Python, Chrome CDP, long-running processes). The architecture cleanly separates concerns: Harbor scrapes and writes to PostgreSQL; Vercel reads from PostgreSQL and serves the UI. Live scraping for fresh data is either proxied from Vercel back to a lightweight Harbor endpoint, or kept warm enough via the 30-minute daemon cycle that live-search is rarely needed. The stack choices (Next.js 16, shadcn/ui + Tailwind v4, TanStack Query v5, Drizzle ORM, Better Auth, Resend) are all current-stable and specifically selected to avoid known pitfalls in the Vercel serverless environment.

The key risks are trust-related, not technical. Award travel users transfer non-reversible points based on alert data. If the platform shows phantom availability (calendar-level data displayed as confirmed bookable seats) or fires alerts on stale cache results, users lose real money. Research is unambiguous: this is the #1 trust-killer in the space and the reason several competitors have user backlash. Prevention requires: (1) an `availabilityType` field on `FlightResult` distinguishing confirmed vs calendar-level data from day one, (2) explicit freshness timestamps on all displayed results, and (3) alert messages that include the scrape timestamp and a direct "verify before transferring" warning. The normalized `price_history` table must also be built before the daemon accumulates any historical data — the current JSONB blob cache is not queryable for time-series aggregation.

---

## Key Findings

### Recommended Stack

The stack is tightly aligned: Next.js 16 with the App Router is the clear choice for mixing React Server Components (deal feed, cached results) with Client Components (search form, SSE live updates, charts). shadcn/ui built on Tailwind v4 and Radix UI provides owned, accessible components without fighting an opinionated library. TanStack Query v5 handles all client-side async state except SSE streaming (which uses native `EventSource` + Zustand). Drizzle ORM handles new tables (users, sessions, alert_subscriptions, price_history) while existing tables keep their raw `pg` queries. Better Auth replaces Lucia Auth (deprecated March 2025) and supersedes Auth.js for new projects. Resend + React Email provides transactional email on Vercel Edge. MapLibre GL + deck.gl ArcLayer renders flight route arcs on a WebGL canvas — Leaflet cannot handle animated arc visualization cleanly.

See `.planning/research/STACK.md` for full rationale and alternatives considered.

**Core technologies:**
- **Next.js 16 + React 19**: Full-stack framework with stable Turbopack, React Compiler, and native SSE via Route Handlers
- **shadcn/ui + Tailwind v4**: Owned component primitives, dark theme, Radix accessibility — no library version friction
- **TanStack Query v5**: Client-side async state with mutations, DevTools, pagination — SWR is insufficient for this use case
- **Drizzle ORM**: Edge-native ORM for new DB tables; sits alongside existing raw `pg` without migration
- **Better Auth**: Self-hosted open-source auth; Lucia deprecated, Auth.js team merged into Better Auth
- **Resend + React Email**: HTTP-based transactional email (works on Vercel Edge; Nodemailer does not)
- **MapLibre GL + deck.gl**: WebGL-powered maps and animated arc layers (Mapbox proprietary; Leaflet lacks WebGL)
- **Recharts v2 (via shadcn/ui)**: Pre-styled chart components integrated with Tailwind; stay on v2 until shadcn officially supports v3
- **Zustand v5**: Minimal client-side UI state (search form, filters, map viewport) — Redux is overkill here
- **SSE (native Web API)**: Live scrape result streaming; avoid WebSockets (incompatible with Vercel serverless)
- **Biome**: Replaces ESLint + Prettier (Next.js 16 removed `next lint`)

**Critical version notes:**
- Use Next.js 16, NOT 15 — 16 is current stable (Oct 2025 release)
- Stay on Recharts v2 — shadcn/ui not yet updated for v3 (open issue as of Feb 2026)
- TypeScript 5.1+ required by Next.js 16

### Expected Features

The award flight search market is crowded but none of the top tools (point.me, seats.aero, Roame, AwardFares, ExpertFlyer) combine live availability data, CPP value assessment, sweet spot identification, transfer partner awareness, and a clean UI all in one free tier. Flight Points' differentiation is being the only tool that does all five things without a $10-20/month paywall.

Nearly all table-stakes backend logic already exists in the codebase (`computeDealRating()`, `matchSweetSpots()`, `getBookingUrl()`, `transfer-partners.ts`, `sweet-spots.ts`). The primary work is building the frontend display layer and adding missing channels (email alerts, user accounts).

See `.planning/research/FEATURES.md` for competitive landscape and full complexity reference.

**Must have (table stakes — gates all else):**
- Clean route search UI: origin, destination, cabin, date inputs with mobile-responsive layout
- Multi-program results: miles required, program name, direct booking link
- CPP display + deal quality badge (good/great/incredible) — `computeDealRating()` exists, needs display
- Transfer partner display ("Book with Amex MR, Chase UR") — `transfer-partners.ts` exists
- Real-time loading progress via SSE — backend exists, UI needs progress bar
- Fresh data indicator (when last scraped) — `last_scraped` timestamp already tracked

**Should have (competitive differentiators):**
- Sweet spot tier badges on results (S/A/B — `sweet-spots.ts` exists, needs display layer)
- Global deal feed page ("Top deals right now") — `/api/flights/deals` exists, needs frontend
- Email alert signup for specific routes (new channel; WhatsApp already working)
- Booking guidance per program (step-by-step transfer instructions)
- Alliance gateway labeling ("This result covers 80+ airlines via AA oneworld")
- Transfer partner filter ("Show only Chase UR bookable") — `getScrapersForProgram()` exists
- Coverage transparency ("Star Alliance: Limited coverage") — builds trust around known gaps
- Nearby airport deduplication UI — `collapseToRepresentative()` exists in live-scraper

**Defer to v2+ (high complexity or accumulation dependencies):**
- Historical price trend chart — requires 30+ days of accumulated `price_history` data before chart is meaningful
- Calendar heatmap / flexible date view — requires multi-date parallel scraping architecture
- Transfer bonus awareness in results — requires live external bonus data source or manual updates
- Aircraft/product tagging (Boeing 787, QSuites) — scraper data is inconsistent across sources
- AI trip planner / chatbot — adds complexity with unclear return; v2+ only
- Native mobile app — responsive web covers mobile; PWA if warranted later
- Paid subscription paywalling — free-first approach is competitive advantage

### Architecture Approach

The system has two permanently separate runtime environments: Harbor Mac Mini (daemon + Python scrapers) and Vercel (Next.js frontend). PostgreSQL is the sole integration boundary — Harbor writes, Vercel reads. No direct daemon-to-frontend communication exists or is needed. The daemon runs on 30-minute cycles; PostgreSQL polling at 5-minute intervals is more than sufficient for freshness. Live scraping for on-demand user queries either proxies from Vercel to a lightweight Harbor Express endpoint at `:3001`, or is kept warm enough by the daemon that live-search is rarely triggered.

The frontend layer uses the RSC/CSC split deliberately: React Server Components for deal feed, price history fetch, and sweet spot sidebar (direct DB access, zero client JS); Client Components for search form (Zustand), live SSE stream (EventSource hook), and charts (Recharts requires `"use client"`). API Route Handlers in Next.js replace the existing Express server endpoints. New DB tables (users, sessions, alert_subscriptions, price_history) use Drizzle ORM; existing tables keep raw `pg` queries.

See `.planning/research/ARCHITECTURE.md` for full data flow diagrams, anti-patterns, and DB schemas.

**Major components:**
1. **Daemon (unchanged)**: 30-min scrape cycles, circuit breaker, WhatsApp alerts via OpenClaw, writes to PostgreSQL
2. **History Writer (new daemon extension)**: Appends each scrape result to normalized `price_history` table — must start early so data accumulates
3. **Alert Checker (new daemon extension)**: Compares flight_cache against user alert_subscriptions, sends email via Resend
4. **Next.js App (new)**: App Router pages — `/` (deal feed RSC), `/search` (search + SSE), `/alerts` (user watches), `/account`
5. **Flight API Routes (ported from Express)**: Search, deals, live-search SSE, history — all Route Handlers in Next.js
6. **Auth Routes (new)**: Better Auth handler at `/api/auth/[...all]/route.ts`
7. **PostgreSQL (shared)**: AWS RDS, existing + new tables via Drizzle migrations
8. **Harbor Live-Search API (new, lightweight)**: Minimal Express endpoint at `:3001` that Vercel proxies for live scraping

### Critical Pitfalls

Detailed mitigations in `.planning/research/PITFALLS.md`.

1. **Phantom availability without staleness indicators** — Calendar-level scrapers (Cathay AFR) return bucket availability, not confirmed bookable seats. Add `availabilityType: 'confirmed' | 'calendar'` to `FlightResult` before the first user-facing render. Display calendar results with explicit "Unconfirmed — verify before transferring points" warning. Never alert on calendar-only data. This must be in the data model from Phase 1; retrofitting is painful.

2. **SSE live-search deployed to Vercel** — Python scrapers cannot run on Vercel (no Python runtime, 60s function timeout vs 20-50s scraper times). Never implement `/api/flights/live-search` as a Vercel Route Handler that attempts to spawn scrapers. Keep the SSE endpoint on Harbor's Express server; Vercel proxies to it. Document this boundary explicitly — it is the most likely accidental violation.

3. **CPP calculations based on static cash price estimates** — `estimateCashPrice()` uses flat lookup tables (US-EU business = $4,000). When Google Flights cash lookup fails, static estimates inflate deal ratings. Always show CPP with its source label ("via Google Flights" vs "estimated"). Never display S-tier rating when CPP is estimated. Fail visibly, not silently, when Google Flights times out.

4. **Alert firing on unconfirmed or stale availability** — Alerts can trigger point transfers of non-reversible loyalty currency. Include scrape timestamp in every alert. Add "alert confidence" field — only fire instant alerts for confirmed-availability scrapers (AA CDP, Flying Blue CDP). Never alert on calendar-level data. Consider "soft alert" daily digest mode as default to reduce urgency-driven hasty transfers.

5. **JSONB blobs blocking historical trend queries** — Current `award_flights.results` JSONB blob schema cannot support time-series aggregation. Historical trends require a normalized `price_history` table with indexed rows per (route, cabin, program, scrape_date). This table must be created and the daemon extension must start writing to it before any data is needed. JSONB can stay for live cache; price_history is a parallel append-only store.

**Additional moderate pitfalls:**
- `"use client"` boundary placed too high (page level) eliminating RSC benefits — SSE listener should be a leaf component, not a root
- Chrome CDP port collisions under concurrent live-search + daemon load — needs file-based locking before increasing concurrency above current 2-session cap
- Flying Blue session expiry returns `[]` instead of `LOGIN_REQUIRED` error — currently invisible in production, masking SkyTeam coverage gaps
- Star Alliance coverage gaps not disclosed in UI — Aeroplan blocked by Gigya reCAPTCHA; UI must show "Star Alliance: Limited" with tooltip
- User accounts must never store airline credentials — scope to email, preferences, and route watches only; airline credentials storage is ToS violation + GDPR exposure

---

## Implications for Roadmap

Research points to a 7-phase build order driven by two hard dependencies: (1) historical data only accumulates over time, so the price_history daemon extension must start before the chart UI is built; (2) the Next.js shell must exist before interactive features can be added to it.

### Phase 1: Database Foundation + Daemon Extensions

**Rationale:** Price history data only has value if it has been accumulating. Start the daemon extension immediately so 30+ days of data exist by the time the chart UI is built. Better Auth also needs its schema migration applied before any user-facing auth can work.

**Delivers:** Normalized `price_history` table (time-series queryable), `alert_subscriptions` table, Better Auth user/session tables, `history-writer.ts` daemon extension appending on each scrape, Drizzle migrations applied to AWS RDS.

**Addresses:** Table stakes (historical data infrastructure), Defer items (price history chart data accumulation)

**Avoids:**
- Pitfall 5 (JSONB blobs blocking historical queries) — normalized table built before any data accumulates
- Pitfall 1 (phantom availability) — `availabilityType` field added to FlightResult schema now

**Research flag:** Standard patterns (Drizzle schema, PostgreSQL migrations). Skip research-phase.

---

### Phase 2: Next.js Shell + Static Deal Feed

**Rationale:** Establishes the framework structure all subsequent features plug into. The deal feed (top deals from existing flight_cache) can be built as a pure RSC using existing DB data — no new features needed, immediate user value.

**Delivers:** Next.js 16 app scaffolded (App Router, TypeScript, Tailwind v4, shadcn/ui), deployed to Vercel, deal feed page (RSC reads from existing flight_cache), basic navigation shell, dark theme.

**Addresses:** Global deal feed page (differentiator), sweet spot tier badges display

**Uses:** Next.js 16, shadcn/ui + Tailwind v4, Drizzle ORM (read-only from flight_cache), Vercel deployment

**Avoids:**
- Pitfall 9 (`"use client"` too high) — component hierarchy defined at scaffolding time before pattern replication

**Research flag:** Standard patterns. shadcn/ui + Next.js 16 is extremely well-documented. Skip research-phase.

---

### Phase 3: Search Page + Cached Results

**Rationale:** Core user journey. Must be functional before live scraping or alerts add value. Nearly all backend logic exists; this is primarily a UI build porting the existing Express endpoints to Next.js Route Handlers.

**Delivers:** Route search form (origin/dest autocomplete from airports.ts, cabin, date), `/api/flights/search` Route Handler (ported from Express web-server.ts), FlightResultCard with CPP, deal rating badge, transfer partner display, booking link, freshness timestamp, mobile-responsive layout.

**Addresses:** All 6 "must have" table stakes features, transfer partner filter, coverage transparency indicators, alliance gateway labeling

**Uses:** TanStack Query v5, Zustand v5, shadcn/ui Command (autocomplete), FlightResult types shared with existing codebase

**Avoids:**
- Pitfall 1 (phantom availability) — `availabilityType` displayed in result cards with warning for calendar-level data
- Pitfall 3 (CPP estimates) — CPP source label ("via Google Flights" vs "estimated") required in result display
- Pitfall 10 (coverage gaps not disclosed) — program selector shows alliance coverage indicators

**Research flag:** Standard patterns. Skip research-phase.

---

### Phase 4: Price History Charts

**Rationale:** Depends on Phase 1 data accumulation. Cannot build this chart until 2-4 weeks of price_history data exists. By the time Phase 3 is complete (roughly 3-4 weeks), Phase 1's daemon extension will have accumulated sufficient data.

**Delivers:** `/api/flights/history` Route Handler (queries price_history time-series), PriceHistoryChart component (Recharts area chart), integrated below search results.

**Addresses:** Historical price trend chart (differentiator), "Is this a good price relative to history?" signal

**Uses:** Recharts v2 (via shadcn/ui), TanStack Query v5, Drizzle ORM queries against price_history

**Avoids:**
- Pitfall 5 (JSONB unqueryable) — normalized table from Phase 1 makes this straightforward

**Research flag:** Standard patterns. Recharts integration with shadcn/ui is well-documented. Skip research-phase.

---

### Phase 5: Live Search (SSE)

**Rationale:** Enhancement to the search experience, not a blocker for core value. The deployment architecture constraint (scraper on Harbor, not Vercel) requires careful implementation. Build after the search page is stable.

**Delivers:** Lightweight Harbor Express proxy endpoint at `:3001`, `useLiveSearch` hook with native EventSource, progressive result rendering as scrapers complete, stale cache detection ("Updating live..."), loading progress indicator.

**Addresses:** Real-time loading progress (table stakes), fresh data for uncached routes

**Uses:** Native EventSource API, Zustand for result accumulation, SSE headers (Content-Type: text/event-stream, X-Accel-Buffering: no)

**Avoids:**
- Pitfall 2 (SSE on Vercel) — live-search proxied to Harbor, never implemented as a Vercel Route Handler
- Pitfall 9 (`"use client"` too high) — SSE listener is a leaf Client Component, not a page root

**Research flag:** Implementation detail is tricky (Vercel SSE buffering, proxy architecture). Consider `/gsd:research-phase` for the specific Vercel proxy SSE pattern.

---

### Phase 6: User Auth + Email Alerts

**Rationale:** Auth requires a stable app structure. Alert emails require both the deal detection logic (Phase 3) and a user table (Phase 1 DB) to be working. Can run parallel to Phases 4-5.

**Delivers:** Better Auth integration (email/password, Google OAuth), `/account` and `/alerts` pages, `/api/alerts` CRUD Route Handlers (Drizzle queries against alert_subscriptions), `alert-checker.ts` daemon extension (compares flight_cache vs subscriptions), Resend + React Email alert templates, WhatsApp alert user-facing signup flow extension.

**Addresses:** Email alert signup (table stakes), WhatsApp/SMS alerts (differentiator), booking guidance per program

**Uses:** Better Auth v1, Resend v4 + React Email v3, Drizzle ORM, alert_subscriptions table from Phase 1

**Avoids:**
- Pitfall 4 (alerts fire on unconfirmed data) — alert templates include scrape timestamp + "verify before transferring" copy; only fire on confirmed-availability results
- Pitfall 6 (alert fatigue) — per-user frequency caps (max 1 alert per route per day) implemented from day 1
- Pitfall 11 (storing airline credentials) — user account scope explicitly limited to email, preferences, route watches

**Research flag:** Better Auth integration with Next.js 16 is medium-confidence (newer library). Consider `/gsd:research-phase` specifically for the Better Auth + pg adapter setup.

---

### Phase 7: Map Visualization

**Rationale:** Nice-to-have enhancement with high visual impact but no other feature depends on it. Build last when core product is stable.

**Delivers:** Interactive world map with animated arc routes (MapLibre GL + deck.gl ArcLayer), airport coordinate data integration, optional map panel on search results page.

**Addresses:** Map view differentiator (Roame has this; Flight Points would match), global route visualization

**Uses:** MapLibre GL JS v4, react-map-gl v8, deck.gl v9 (ArcLayer + GreatCircleLayer), OpenStreetMap/MapTiler tiles

**Research flag:** deck.gl ArcLayer with MapLibre is well-documented (official docs). Standard patterns. Skip research-phase unless WebGL performance issues arise.

---

### Phase Ordering Rationale

- **Phase 1 before everything**: Price history data only has value if it starts accumulating immediately. Waiting until Phase 4 to add the daemon extension means building a chart UI with no data behind it.
- **Phase 2 before Phases 3-7**: The Next.js App Router scaffold is the foundation. All subsequent pages and routes plug into it.
- **Phase 3 before Phases 4-5-6**: Search results page must exist before price history charts, live search enhancement, or alert subscriptions can be added to it.
- **Phase 4 after Phase 1 with delay**: The chart needs real data. Implement Phase 4 4-6 weeks after Phase 1 so the chart is immediately meaningful.
- **Phase 5 and 6 are parallel-eligible**: Both depend on Phase 3 but not each other. Can be developed simultaneously by separate efforts.
- **Phase 7 last**: No dependencies from other phases. Pure enhancement.

### Research Flags

**Needs deeper research during planning:**
- **Phase 5 (Live Search SSE)**: The Vercel-to-Harbor SSE proxy pattern has low-confidence documentation. One source (single Medium post) covers the buffering fix. Should do `/gsd:research-phase` focused specifically on: Vercel Fluid functions for long-lived SSE, the X-Accel-Buffering header behavior, and the Harbor proxy architecture.
- **Phase 6 (Better Auth)**: Better Auth's pg adapter + Next.js 16 integration is medium-confidence. The library is newer (teams merged recently). Should do `/gsd:research-phase` focused on the Better Auth pg adapter setup and session management patterns.

**Standard patterns (skip research-phase):**
- **Phase 1**: Drizzle schema + PostgreSQL migrations — extremely well-documented
- **Phase 2**: Next.js 16 + shadcn/ui + Tailwind v4 — official docs comprehensive, 65K+ star project
- **Phase 3**: TanStack Query v5 + Next.js Route Handlers — official docs comprehensive
- **Phase 4**: Recharts v2 via shadcn/ui charts — official shadcn charts docs cover this exactly
- **Phase 7**: deck.gl ArcLayer + MapLibre — official deck.gl docs include MapLibre integration guide

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Almost all choices verified against official docs; Better Auth is MEDIUM (newer project) |
| Features | HIGH | Based on direct codebase analysis + live competitor analysis; no speculation |
| Architecture | HIGH | Two-environment split is factual constraint (Vercel no Python); PostgreSQL-as-bus is proven pattern |
| Pitfalls | HIGH | Critical pitfalls backed by domain-specific authoritative sources (FrequentMiler, AWS, Heap JSONB benchmark); community pain points well-documented |

**Overall confidence:** HIGH

### Gaps to Address

- **Star Alliance coverage**: Aeroplan blocked by Gigya reCAPTCHA; United MileagePlus also blocked. No known clean workaround currently. UI must disclose this gap prominently. Turkish Airlines API scraper is written but untested — needs API credentials and integration testing (see MEMORY.md).
- **SSE Vercel buffering**: The specific buffering fix (X-Accel-Buffering, TransformStream pattern) has only one low-confidence source. Validate in a Vercel preview deployment early in Phase 5.
- **Better Auth pg adapter**: Medium confidence; library is newer. The specific setup with an existing raw `pg` pool (rather than Drizzle-only) needs validation during Phase 6 planning.
- **Flying Blue session reliability**: Session expires ~hourly, returns `[]` not error. The `LOGIN_REQUIRED` structured error return and automated re-login path need to be built before Flying Blue results are included in user-facing alerts.
- **Recharts v3 shadcn support**: Open issue as of Feb 2026. Stay on v2 but monitor — if shadcn upgrades to v3 before Phase 4 build, update the implementation plan.
- **Chrome CDP port collision under concurrency**: File-based locking in `chrome_cdp.py` must be implemented before live-search concurrency increases. Current 2-session cap manages this for now.

---

## Sources

### Primary (HIGH confidence)
- [Next.js 16 Release Blog](https://nextjs.org/blog/next-16) — framework version, Turbopack, React Compiler
- [Next.js App Router Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) — SSE pattern, API layer
- [shadcn/ui Tailwind v4 Docs](https://ui.shadcn.com/docs/tailwind-v4) — component system
- [shadcn/ui Charts](https://ui.shadcn.com/charts/area) — Recharts integration
- [TanStack Query v5 Comparison](https://tanstack.com/query/v5/docs/framework/react/comparison) — vs SWR
- [deck.gl with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre) — map architecture
- [Drizzle ORM schema documentation](https://orm.drizzle.team/docs/sql-schema-declaration) — new table design
- [Resend Node.js SDK](https://resend.com/docs/send-with-nodejs) — email delivery
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — timeout constraints
- [When To Avoid JSONB In A PostgreSQL Schema — Heap](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) — Pitfall 5 rationale
- [7 Best Ways To Troubleshoot Phantom Award Space — UpgradedPoints](https://upgradedpoints.com/travel/airlines/phantom-award-space/) — Pitfall 1 domain knowledge
- [Which award search tool is best? — FrequentMiler](https://frequentmiler.com/which-award-search-tool-is-best/) — competitor analysis, user trust concerns
- Existing codebase (`sweet-spots.ts`, `monitor.ts`, `transfer-partners.ts`, `scrapers/index.ts`, `.planning/codebase/CONCERNS.md`) — direct code inspection

### Secondary (MEDIUM confidence)
- [Better Auth Home](https://www.better-auth.com/) — auth library choice, pg adapter
- [Auth.js joins Better Auth announcement](https://www.better-auth.com/blog/authjs-joins-better-auth) — team merger confirmation
- [Best Award Flight Search Tools 2026 — ThePointsAnalyst](https://www.thepointsanalyst.com/best-award-flight-search-tools/) — competitive landscape
- [Roame Review 2025 — ThePointsParty](https://thepointsparty.com/articles/roame-travel-review) — differentiator analysis
- [SSE in Next.js 15/16 — Upstash Blog](https://upstash.com/blog/sse-streaming-llm-responses) — SSE streaming pattern
- [Drizzle vs Prisma — Bytebase](https://www.bytebase.com/blog/drizzle-vs-prisma/) — ORM comparison
- [MapLibre vs Leaflet — jawg.io](https://blog.jawg.io/maplibre-gl-vs-leaflet-choosing-the-right-tool-for-your-interactive-map/) — map library choice
- [Alert Fatigue: Impact on Users — MagicBell](https://www.magicbell.com/blog/alert-fatigue) — notification strategy
- [How We Calculate Cents Per Point — Roame](https://roame.travel/guides/cents-per-point-calculations) — CPP methodology

### Tertiary (LOW confidence)
- [Fixing Slow SSE in Next.js and Vercel — Medium, Jan 2026](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996) — SSE buffering fix (single source, needs validation in Vercel preview)
- [Long-Running Tasks with Next.js — DEV Community](https://dev.to/bardaq/long-running-tasks-with-nextjs-a-journey-of-reinventing-the-wheel-1cjg) — Fluid functions for long-lived connections

---

*Research completed: 2026-02-26*
*Ready for roadmap: yes*
