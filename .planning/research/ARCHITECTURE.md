# Architecture Patterns

**Domain:** Award flight search and deal discovery platform
**Researched:** 2026-02-26
**Scope:** New frontend + feature additions integrating with existing scraper infrastructure. Existing Python scraper layer and daemon are preserved as-is.

---

## Recommended Architecture

### Overview

The system has two distinct runtime environments that cannot be merged due to the Python/Chrome CDP dependency:

1. **Harbor Mac Mini (daemon host)** — Runs TypeScript daemon + Python scrapers. Cannot be containerized cleanly due to real Chrome requirement for CDP-based scrapers. Has SOCKS5 proxy tunnel to Oracle VPS.
2. **Vercel (frontend host)** — Runs Next.js frontend + API route handlers. No Python runtime. No long-lived processes. Communicates with PostgreSQL (AWS RDS) as the shared data bus.

PostgreSQL is the single source of truth and the integration boundary between these two environments. The daemon writes; the frontend reads. There is no direct daemon-to-frontend communication — PostgreSQL is the message bus.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Harbor Mac Mini                              │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │   TypeScript  │    │        Python Scraper Layer          │   │
│  │    Daemon    │───▶│  Chrome CDP / curl_cffi / Patchright │   │
│  │ (30-min cycle)│    │  Camoufox / Playwright               │   │
│  └──────┬───────┘    └──────────────────────────────────────┘   │
│         │                        ▲                               │
│         │ execFile subprocess    │ stdout: FlightResult[] JSON   │
│         └────────────────────────┘                               │
│         │ writes                                                  │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────┐
│    AWS RDS PostgreSQL   │  ← shared data bus between environments
│                         │
│  flight_cache           │  ← daemon writes, frontend reads
│  price_history          │  ← new table (historical trend data)
│  users                  │  ← new (Better Auth)
│  sessions               │  ← new (Better Auth)
│  alert_subscriptions    │  ← new (user route watches)
│  sent_alerts            │  ← daemon reads (dedup)
│  flight_signups         │  ← existing
│  scraper_health         │  ← daemon writes, frontend reads
└─────────┬───────────────┘
          │ reads
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Vercel (Next.js 16)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    App Router Pages                       │   │
│  │  /  (deal feed)    /search  (route search)               │   │
│  │  /alerts  (user watches)    /account  (user profile)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Route Handlers (API layer)                   │   │
│  │  /api/flights/search          /api/flights/live-search   │   │
│  │  /api/flights/deals           /api/flights/history       │   │
│  │  /api/alerts  (CRUD)          /api/auth/*  (Better Auth) │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  NOTE: Python scrapers do NOT run on Vercel. SSE live-search    │
│  route handler calls back to Harbor Mac Mini via HTTP API if    │
│  live scraping is needed from the web.                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### Preserved Unchanged (Existing)

| Component | Responsibility | Location | Communicates With |
|-----------|---------------|----------|-------------------|
| **Scraper Registry** | Maps airline → fallback chain; `SCRAPER_REGISTRY` | `src/flights/scrapers/index.ts` | Daemon, live scraper |
| **Python Scrapers** | Anti-detect browser automation, HTTP requests | `src/flights/scrapers/*.py` | Called as subprocess by TS runners |
| **TS Scraper Wrappers** | Configure runner with script + timeout + cache | `src/flights/scrapers/{airline}-*.ts` | Scraper registry |
| **Scraper Runners** | `execFile` subprocess, retry, cache, JSON parse | `src/flights/scrapers/*-runner.ts` | Individual scraper wrappers |
| **Flight Daemon** | 30-min cycles, rotation, alert dispatch, memory monitoring | `src/flights/flight-daemon.ts` | Scrapers, PostgreSQL, OpenClaw CLI |
| **Circuit Breaker** | Per-scraper failure tracking, 5-failure → 15min cooldown | `src/flights/scraper-health.ts` | Daemon, live scraper |
| **Domain Knowledge** | Airports, sweet spots, transfer partners | `src/flights/{airports,sweet-spots,transfer-partners}.ts` | Daemon, web server |
| **Database Layer** | PostgreSQL singleton pool + typed query functions | `src/flights/db.ts` | Daemon, web server |
| **Types** | Shared data contracts (`FlightResult`, `SearchParams`) | `src/flights/types.ts` | All modules |

### New (To Build)

| Component | Responsibility | Location | Communicates With |
|-----------|---------------|----------|-------------------|
| **Next.js App** | Full-stack framework shell, routing, RSC/CSC split | `/app` (new repo) | All frontend components |
| **Search Page** | Origin/dest/dates/cabin form → results with enrichment | `/app/search` | Flight API routes, SSE |
| **Deal Feed Page** | Curated best deals, filterable by program | `/app` | Deals API route |
| **Price History Component** | Recharts area chart, route trend data | `/app/search/components` | History API route |
| **Map Component** | MapLibre + deck.gl ArcLayer for route visualization | `/app/components/map` | Search state (Zustand) |
| **Alerts Page** | User route watches + sweet spot alert management | `/app/alerts` | Alerts API route |
| **Account Page** | User profile, preferences, alert history | `/app/account` | Auth + alerts |
| **Flight API Routes** | Search, deals, live-search (SSE), history | `/app/api/flights/*` | PostgreSQL (Drizzle + raw pg) |
| **Alert API Routes** | CRUD for user alert subscriptions | `/app/api/alerts/*` | PostgreSQL (Drizzle), alert_subscriptions table |
| **Auth Routes** | Better Auth handler | `/app/api/auth/[...all]/route.ts` | Better Auth, PostgreSQL |
| **Alert Checker** | Daemon extension — compares new cache entries against user `alert_subscriptions`, sends email via Resend | `src/flights/alert-checker.ts` | PostgreSQL, Resend API |
| **Price History Writer** | Daemon extension — appends each scrape result to `price_history` table | `src/flights/history-writer.ts` | PostgreSQL |
| **Zustand Stores** | Client-side search form, filter, map viewport state | `/app/stores/*` | Client components |

---

## Data Flow

### Flow 1: Background Scraping → Cache (existing, unchanged)

```
Daemon 30-min cycle
  → load signups from flight_signups
  → generate origin × dest × date × cabin combinations
  → rotation offset → select 25 searches
  → for each search: fallback chain (CDP → curl_cffi → Patchright → ...)
    → execFile('python3', [script, paramsJSON])
    → stdout: FlightResult[] JSON
  → match against sweet spots (1.2× threshold)
  → dispatch WhatsApp alert via OpenClaw CLI
  → write to flight_cache (upsertCacheEntries)
  → write health metrics to daemon_status, scraper_health
```

### Flow 2: Background Scraping → Price History (new daemon extension)

```
Daemon after each successful scrape batch
  → pass FlightResult[] to alert-checker.ts + history-writer.ts

history-writer.ts:
  → for each FlightResult with pointsRequired:
    → INSERT INTO price_history (route, cabin, program, points, cash_price, cpp, scraped_at)
    → ON CONFLICT DO NOTHING (same route+program+date+scraped_date)
  → price_history table grows as time-series over weeks/months

alert-checker.ts:
  → SELECT * FROM alert_subscriptions WHERE status = 'active'
  → for each subscription: does any FlightResult match? (route, cabin, points <= threshold)
  → if match: send email via Resend API → INSERT INTO sent_alerts (dedup, 90-day TTL)
```

### Flow 3: User Searches → Cached Results (frontend, enhanced)

```
User on /search fills form → submit
  → TanStack Query: GET /api/flights/search?from=JFK&to=NRT&cabin=business&program=amex-mr
  → Route Handler: getCacheEntries(origins, dests, cabin) from flight_cache
  → enrichFlightResult(): adds transfer ratio, CPP, deal rating, booking URL
  → filter NON_BOOKABLE_SOURCES
  → check cache age: if updated_at > 30 min ago → flag as stale
  → return JSON to frontend
  → frontend shows results with deal rating badges, value context

Simultaneously:
  → GET /api/flights/history?from=JFK&to=NRT&cabin=business
  → Route Handler: SELECT from price_history (last 90 days, sampled weekly)
  → return time-series data points
  → frontend renders Recharts area chart (price trend)
```

### Flow 4: Live Scrape via SSE (enhanced, same pattern)

```
When cache is stale or empty:
  → EventSource opens /api/flights/live-search?...
  → Route Handler checks canStartLiveScrape() (max 2 concurrent)
  → runLiveScrape(): generates 2 sample dates, deduplicates metro airports
  → for each scraper in program's coverage:
    → spawn scraper (respects circuit breaker)
    → on result: stream SSE data event to client immediately
    → client: TanStack Query updates UI incrementally
    → write results to flight_cache via upsertLiveCacheResults()
  → SSE done event when all scrapers complete

LIMITATION: Vercel serverless functions time out at 60s (Pro). For scrapers
that take 20-50s (Chrome CDP, Flying Blue), use Vercel Fluid functions
(maxDuration: 300s) or keep live-search running on Harbor directly.
Recommended: live-search runs on Harbor daemon host, not Vercel.
```

### Flow 5: User Alert Subscription → Notification

```
User on /alerts creates route watch:
  → POST /api/alerts with { from, to, cabin, maxPoints, programs[] }
  → Route Handler: INSERT INTO alert_subscriptions (user_id, route, cabin, threshold, ...)
  → 200 OK

Daemon (alert-checker.ts runs after each scrape cycle):
  → compare flight_cache entries against alert_subscriptions
  → if match found and not in sent_alerts (90-day dedup):
    → Resend.emails.send({ to: user.email, template: DealAlertEmail })
    → INSERT INTO sent_alerts (alert_key)
    → WhatsApp via OpenClaw (if user opted in)
```

### Flow 6: Deal Feed (new)

```
User lands on / (home/deal feed):
  → Server Component: SELECT from flight_cache (all routes) → sort by deal rating
  → Filter by credit card program (Amex MR, Chase UR, etc.)
  → Render deal cards server-side (no SSE, no live scrape)
  → Periodic client-side refresh via TanStack Query (5-min stale time)

Deal ranking logic (server-side):
  → sweet spot matches: S-tier first, then A-tier, B-tier
  → fallback: sort by CPP descending
  → deduplicate by route (best deal per route)
  → top 20 per program shown
```

---

## Component Architecture: Frontend Layers

```
┌──────────────────────────────────────────────────────────────┐
│                    React Server Components                    │
│  (run on server, no client JS, access DB directly)           │
│                                                              │
│  DealFeedPage      HistoryFetcher      SweetSpotSidebar      │
│  (home page RSC)   (price data RSC)    (static knowledge)    │
└──────────────────────────────────────────────────────────────┘
                           │ passes data as props
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    React Client Components                    │
│  (browser JS, event handlers, real-time updates)             │
│                                                              │
│  SearchForm         DealFeed           PriceHistoryChart     │
│  (Zustand state)    (TanStack Query)   (Recharts area chart) │
│                                                              │
│  MapView            AlertManager       FlightResultCard      │
│  (MapLibre+deck.gl) (TanStack Query    (badges, ratings)     │
│                      mutations)                              │
└──────────────────────────────────────────────────────────────┘
                           │ calls
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Route Handlers (API)                       │
│  (Next.js server-side, access PostgreSQL)                    │
│                                                              │
│  GET /api/flights/search    GET /api/flights/live-search     │
│  GET /api/flights/deals     GET /api/flights/history         │
│  GET /api/flights/sweet-spots                                │
│  POST /api/alerts           DELETE /api/alerts/[id]          │
│  GET /api/auth/*            (Better Auth handler)            │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    PostgreSQL (AWS RDS)
```

---

## Patterns to Follow

### Pattern 1: RSC for Static/Cached Data, CSC for Interactive

**What:** Use React Server Components for any data that doesn't need real-time updates — deal feed, sweet spot information, initial search results. Use Client Components only for interactive elements — search form, live scrape progress, charts.

**Why:** RSCs run on the server with zero client JS bundle overhead. The deal feed page can be an RSC that directly queries PostgreSQL — no API round-trip, no hydration cost.

**Example:**
```typescript
// app/page.tsx — React Server Component
// Directly accesses PostgreSQL — no API layer needed
export default async function DealFeedPage() {
  const db = getDrizzleClient();
  const deals = await db.query.flightCache.findMany({
    orderBy: [desc(flightCache.updatedAt)],
    limit: 50,
  });
  return <DealFeedClient initialDeals={enrichDeals(deals)} />;
}

// app/components/DealFeedClient.tsx — 'use client'
'use client';
export function DealFeedClient({ initialDeals }: Props) {
  const { data } = useQuery({
    queryKey: ['deals'],
    queryFn: fetchDeals,
    initialData: initialDeals,    // RSC pre-populated
    staleTime: 5 * 60 * 1000,    // 5 min before refetch
  });
  return <DealList deals={data} />;
}
```

### Pattern 2: SSE Streaming with Incremental UI Updates

**What:** The live-search SSE stream delivers individual FlightResult objects as scrapers finish. The client accumulates results in a Zustand store and renders them incrementally.

**When:** Whenever cache is stale (> 30 min) or empty for the requested route.

**Example:**
```typescript
// app/hooks/useLiveSearch.ts
export function useLiveSearch(params: SearchParams) {
  const addResult = useSearchStore(s => s.addResult);
  const setDone = useSearchStore(s => s.setDone);

  useEffect(() => {
    const url = new URL('/api/flights/live-search', window.location.origin);
    url.searchParams.set('from', params.origin);
    // ...
    const es = new EventSource(url.toString());

    es.onmessage = (e) => {
      const result: FlightResult = JSON.parse(e.data);
      addResult(result);            // Zustand store → triggers re-render
    };
    es.addEventListener('done', () => {
      setDone(true);
      es.close();
    });
    return () => es.close();
  }, [params.origin, params.destination, params.cabin]);
}
```

### Pattern 3: PostgreSQL as Inter-Process Message Bus

**What:** The daemon (Harbor) and the frontend (Vercel) share no direct connection. All communication flows through PostgreSQL tables. The daemon writes; the frontend reads. New data is signaled by `updated_at` timestamps, not push notifications.

**Why it works:** The daemon runs every 30 minutes. The frontend shows cached data. There is no scenario where sub-second daemon-to-frontend communication is needed. PostgreSQL polling every 5 minutes is more than sufficient.

**Tables as channels:**
- `flight_cache` — daemon writes scraped results, frontend reads them
- `price_history` — daemon appends historical data, frontend reads time series
- `alert_subscriptions` — frontend writes user watches, daemon reads and checks
- `sent_alerts` — daemon writes dispatch records, used for dedup by both sides
- `scraper_health` — daemon writes health stats, frontend can read for status display

### Pattern 4: Drizzle ORM for New Tables Only

**What:** New tables (users, sessions, alert_subscriptions, price_history) use Drizzle ORM for schema definition and typed queries. Existing tables (flight_cache, scraper_health, etc.) continue using raw `pg` queries in `db.ts`.

**Why:** Drizzle sits alongside the existing raw `pg` pool cleanly. No migration of existing queries needed. Drizzle is edge-native — works on Vercel serverless without Prisma Accelerate.

```typescript
// src/db/schema.ts (new, Drizzle-managed)
export const alertSubscriptions = pgTable('alert_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id),
  fromAirport: text('from_airport').notNull(),
  toAirport: text('to_airport').notNull(),
  cabin: text('cabin').notNull(),
  maxPoints: integer('max_points'),
  programs: text('programs').array(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const priceHistory = pgTable('price_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  route: text('route').notNull(),        // "JFK-NRT"
  cabin: text('cabin').notNull(),
  program: text('program').notNull(),
  pointsRequired: integer('points_required').notNull(),
  cashPrice: numeric('cash_price'),
  centsPerPoint: numeric('cents_per_point'),
  travelDate: date('travel_date').notNull(),
  scrapedAt: timestamp('scraped_at').notNull().defaultNow(),
}, (t) => ({
  routeCabinIdx: index().on(t.route, t.cabin, t.scrapedAt),
}));
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running Python Scrapers on Vercel

**What:** Attempting to run Chrome CDP, Patchright, curl_cffi, or any Python scraper in a Vercel function.

**Why bad:** Vercel has no Python runtime for long-running processes. Chrome cannot be installed in the Vercel sandbox. curl_cffi requires compiled C extensions. Even if you got Python working, Vercel function timeouts (10s Hobby, 60s Pro) are incompatible with scraper timings (20-50s for CDP, 50s for Flying Blue).

**Instead:** All scraping runs on Harbor. The Vercel frontend serves cached data from PostgreSQL. For live scraping from the web UI, the SSE endpoint on Vercel should proxy to a Harbor-hosted endpoint — or the SSE endpoint lives on Harbor itself (accessible via public URL on Harbor).

### Anti-Pattern 2: Storing FlightResult[] as JSONB for Historical Trends

**What:** Reusing the `flight_cache.award_flights JSONB` column to derive price history.

**Why bad:** `flight_cache` is a snapshot cache — each upsert overwrites the previous data. Querying it for "what was the lowest price for JFK→NRT in the last 90 days" requires scanning all historical states, which are overwritten on every 30-min cycle.

**Instead:** A separate `price_history` table with one row per (route, cabin, program, scrape_date). The daemon appends on each successful scrape. This enables true time-series queries: `WHERE route = 'JFK-NRT' AND scraped_at > NOW() - INTERVAL '90 days'`.

### Anti-Pattern 3: User Alert Subscriptions Replacing the Existing `flight_signups` Table

**What:** Migrating or replacing `flight_signups` with the new `alert_subscriptions` table.

**Why bad:** `flight_signups` drives daemon search combinations. The daemon generates its route × date search matrix from `flight_signups`. Replacing this disrupts the daemon without adding value. The two tables serve different purposes.

**Instead:** Keep `flight_signups` for daemon route discovery (can be admin-managed). `alert_subscriptions` is purely for user-facing email/WhatsApp alerts — checked against already-scraped `flight_cache` data, not used to drive scraping.

### Anti-Pattern 4: WebSockets for Live Scrape Updates

**What:** Using WebSocket connections for the live-search streaming feature.

**Why bad:** Vercel does not support WebSocket connections on serverless functions. WebSockets require long-lived connections incompatible with serverless architecture. More complex to implement and debug than SSE.

**Instead:** SSE (Server-Sent Events) — unidirectional server-to-client streaming over HTTP. Works everywhere, including Vercel Fluid functions. The scrape stream is inherently one-directional (results flow server → client only).

### Anti-Pattern 5: TanStack Query for SSE Streaming

**What:** Using `useQuery` to poll the live-search endpoint.

**Why bad:** `useQuery` is for request/response patterns. Polling would miss incremental results between polls, defeating the purpose of SSE streaming.

**Instead:** `useEffect` + `EventSource` for the SSE connection. Results accumulate in a Zustand store. `useQuery` is used for everything else (cached search, deals, alerts).

---

## New Database Tables

### `price_history` (new)

```sql
CREATE TABLE price_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route        TEXT NOT NULL,          -- "JFK-NRT"
  cabin        TEXT NOT NULL,          -- "business"
  program      TEXT NOT NULL,          -- "aa" | "flying-blue"
  points       INTEGER NOT NULL,
  cash_price   NUMERIC(10,2),
  cpp          NUMERIC(6,4),           -- cents per point
  travel_date  DATE NOT NULL,
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ph_route_cabin ON price_history (route, cabin, scraped_at DESC);
CREATE INDEX idx_ph_scraped_at ON price_history (scraped_at);

-- Prevent exact duplicates from same scrape run
CREATE UNIQUE INDEX idx_ph_dedup ON price_history (route, cabin, program, travel_date, scraped_at::date);
```

### `alert_subscriptions` (new)

```sql
CREATE TABLE alert_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_airport TEXT NOT NULL,
  to_airport   TEXT NOT NULL,
  cabin        TEXT NOT NULL DEFAULT 'business',
  max_points   INTEGER,                -- null = any availability
  programs     TEXT[] NOT NULL DEFAULT '{}',  -- [] = all programs
  channels     TEXT[] NOT NULL DEFAULT '{email}',  -- 'email' | 'whatsapp'
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_as_user ON alert_subscriptions (user_id);
CREATE INDEX idx_as_status ON alert_subscriptions (status);
```

### `users` + `sessions` (Better Auth managed)

Better Auth creates and manages these tables automatically via its `pg` adapter. Schema is determined by Better Auth's migration system — do not create manually.

---

## Deployment Architecture

### Current (partially working)

```
Harbor Mac Mini
  - npm run daemon  (TypeScript + Python scrapers)
  - npm run dev     (Express web server, port 3000)

Vercel
  - Static HTML (web/public/) served directly
  - api/index.ts (Express adapter for /api/flights/* endpoints)
  - Python scrapers: NOT available
```

### Target Architecture

```
Harbor Mac Mini
  - npm run daemon          (unchanged — 30-min scrape cycles)
  - live-search proxy API   (new: lightweight Express endpoint at :3001
                             that can execute live scrapers on demand,
                             called by Vercel when user requests live search)
  - Chrome CDP sessions     (persistent in /tmp/chrome-cdp-*/profiles)
  - Oracle VPS SOCKS5 proxy (SSH tunnel, port 1081)

Vercel (Next.js 16)
  - / (deal feed page — RSC, PostgreSQL read)
  - /search (search page — SSC + SSE client)
  - /alerts (user alert management)
  - /account (user profile, Better Auth)
  - /api/flights/search (cached results from PostgreSQL)
  - /api/flights/deals (enriched deal feed from PostgreSQL)
  - /api/flights/history (price_history time series)
  - /api/flights/live-search (SSE — proxies to Harbor if needed)
  - /api/alerts/* (CRUD for alert_subscriptions)
  - /api/auth/* (Better Auth handler)

AWS RDS PostgreSQL
  - Shared between Harbor daemon and Vercel frontend
  - All existing tables preserved
  - New tables added via Drizzle migrations
```

### Deployment Split Boundary (Critical)

The boundary between Harbor and Vercel is `PostgreSQL`. Nothing else crosses this boundary directly.

```
Harbor writes → PostgreSQL ← Vercel reads
```

The one exception is live scraping: if the user requests a live search from the Vercel frontend and live scraping cannot run on Vercel (due to Python/Chrome dependency), the `/api/flights/live-search` route handler can either:
- **Option A (simple):** Forward the SSE connection to a Harbor-hosted mini API server (`harbor.local:3001/live-search`). Harbor does the actual scraping, SSE events flow back through Vercel to the browser.
- **Option B (recommended for production):** Keep the scraper cache warm enough that live scraping is rarely needed. The 30-min daemon cycle should provide reasonably fresh data.

---

## Suggested Build Order

Dependencies dictate the following sequence:

### Phase 1: Database Foundation (no frontend needed)

Build first because everything else depends on it:
1. Drizzle schema for `price_history`, `alert_subscriptions`, `users`, `sessions`
2. `history-writer.ts` daemon extension (appends to `price_history` on each scrape)
3. Better Auth setup with `pg` adapter and email/password provider
4. Drizzle migrations applied to AWS RDS

**Why first:** Price history data only accumulates over time. Start the daemon extension early so data exists by the time the chart UI is built.

### Phase 2: Next.js Shell + Static Pages

Before any interactive features:
1. `create-next-app` with TypeScript + Tailwind v4 + App Router
2. shadcn/ui initialization, component imports
3. Deal feed page (RSC, reads from existing `flight_cache`)
4. Basic search page layout (form shell, no results yet)
5. Vercel deployment of the new Next.js app

**Why second:** Establishes the framework structure that all subsequent features plug into.

### Phase 3: Search + Cached Results

Core user-facing value:
1. Search form with origin/dest autocomplete (airport data from `airports.ts`)
2. `/api/flights/search` route handler (port from Express `web-server.ts`)
3. FlightResultCard component with deal rating, CPP, transfer path display
4. TanStack Query integration for search results

**Why third:** This is the primary user journey. Should be functional before live scraping or alerts.

### Phase 4: Price History Charts

Depends on Phase 1 (data must be accumulating):
1. `/api/flights/history` route handler (queries `price_history`)
2. PriceHistoryChart component (Recharts area chart, time-series data)
3. Integrate into search results page below flight list

**Why fourth:** Needs accumulated data from Phase 1 daemon extension. Can't build until data exists.

### Phase 5: Live Search (SSE)

Depends on Phase 3 (search page must exist):
1. SSE route handler `/api/flights/live-search`
2. `useLiveSearch` hook with `EventSource`
3. Progressive result display as scrapers finish
4. Stale cache detection (show "live updating" indicator)

**Why fifth:** Enhancement to the search experience. Not a blocker for core search functionality.

### Phase 6: User Auth + Alert Subscriptions

Depends on Phase 2 (Next.js shell), can proceed in parallel with Phases 4-5:
1. Better Auth integration (email/password, Google OAuth)
2. User account pages (/account, /alerts)
3. `/api/alerts` CRUD route handlers (Drizzle queries)
4. `alert-checker.ts` daemon extension (compares cache vs subscriptions)
5. Resend + React Email for alert email templates
6. WhatsApp alert integration (extend existing OpenClaw CLI calls)

**Why sixth:** Auth requires a stable app structure. Alert emails require price data and deal detection to be working.

### Phase 7: Map Visualization

Depends on Phase 3 (search results page):
1. MapLibre GL + react-map-gl setup
2. deck.gl ArcLayer for route arcs
3. Airport coordinate data integration
4. Map integration into search page (optional panel)

**Why seventh:** Nice-to-have enhancement. Can be skipped if timeline pressure. No other feature depends on it.

---

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| PostgreSQL read load | RDS t3.micro (current) handles easily | Add read replica; cache frequent queries | Separate read/write endpoints; connection pooling (PgBouncer) |
| Price history volume | ~500 rows/day (reasonable) | ~50K rows/day — add weekly aggregates table | TimescaleDB hypertables with compression |
| SSE concurrent connections | Max 2 concurrent (existing cap) | Increase to 10; Harbor handles scraping load | Scraper fleet on dedicated hardware |
| Daemon scrape capacity | 25 searches/30 min (current) | Add second daemon instance, partition by alliance | Dedicated scraper workers per airline |
| Alert delivery | Resend free tier (100/day) | Resend paid ($20/mo for 50K/mo) | Resend pro + rate limiting |
| Authentication | Better Auth self-hosted handles millions of sessions | No change needed | Consider managed auth at this scale |

---

## Sources

- [Next.js App Router Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) — HIGH confidence, official docs
- [SSE in Next.js 15/16 — Upstash Blog](https://upstash.com/blog/sse-streaming-llm-responses) — MEDIUM confidence
- [Fixing Slow SSE in Next.js and Vercel — Medium, Jan 2026](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996) — LOW confidence (single source)
- [Long-Running Tasks with Next.js — DEV Community](https://dev.to/bardaq/long-running-tasks-with-nextjs-a-journey-of-reinventing-the-wheel-1cjg) — LOW confidence
- [Vercel Functions Limits — official](https://vercel.com/docs/functions/limitations) — HIGH confidence
- [deck.gl ArcLayer + MapLibre](https://deck.gl/docs/get-started/using-with-map) — HIGH confidence, official docs
- [Visualizing flight legs with React, Mapbox, and deck.gl — Medium](https://medium.com/greatescapeco/visualizing-flight-legs-using-react-mapbox-and-deck-gl-18e22771d53e) — MEDIUM confidence
- [pg-boss for PostgreSQL job queuing](https://github.com/timgit/pg-boss) — HIGH confidence, official repo
- [PostgreSQL LISTEN/NOTIFY — official docs](https://www.postgresql.org/docs/current/sql-notify.html) — HIGH confidence
- [Drizzle ORM schema documentation](https://orm.drizzle.team/docs/sql-schema-declaration) — HIGH confidence, official
- [Resend Node.js SDK](https://resend.com/docs/send-with-nodejs) — HIGH confidence, official
- [Better Auth Next.js integration](https://www.better-auth.com/docs/integrations/next) — MEDIUM confidence
- [Recharts — npm, recharts.github.io](https://recharts.github.io) — HIGH confidence, official
- [TanStack Query v5 vs SWR](https://tanstack.com/query/v5/docs/framework/react/comparison) — HIGH confidence, official

---

*Architecture research: 2026-02-26*
