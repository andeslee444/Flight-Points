---
phase: 02-app-shell-deal-feed
plan: 02
subsystem: ui
tags: [nextjs, react, rsc, postgresql, drizzle, enrichment, deal-feed, sweet-spots]

# Dependency graph
requires:
  - phase: 02-01
    provides: Next.js App Router scaffold, shadcn/ui components (Badge, Card), Tailwind v4 dark theme
  - phase: 01-database-foundation
    provides: flight_cache PostgreSQL table with JSONB award_flights, getDrizzle() Vercel-safe client
provides:
  - getTopDeals() server-side function reading flight_cache and returning EnrichedDeal[]
  - enrichFlightResult() pure function (ported from monitor.ts) with CPP, sweet spot matching
  - DealCard component with S/A/B tier badges, points, CPP, route display
  - DealFeed grid component with empty state handling
  - /deals page as RSC fetching live data from flight_cache via Drizzle raw SQL
  - webpack production build (--webpack flag) resolving NodeNext .js imports via extensionAlias
affects: [02-03, 03-filter-bar, all pages reading EnrichedDeal]

# Tech tracking
tech-stack:
  added:
    - experimental.extensionAlias .js→.ts (next.config.ts) for webpack builds
  patterns:
    - RSC data fetch: async server component calls getTopDeals() → no client-side loading spinner for initial render
    - Pure enrichment layer: lib/enrichment.ts copies helper functions from monitor.ts to avoid transitive daemon imports
    - webpack production build: next build --webpack to handle NodeNext .js extension imports via extensionAlias
    - Drizzle raw SQL: getDrizzle().execute(sql`SELECT...`) for JSONB tables not in Drizzle schema

key-files:
  created:
    - lib/enrichment.ts (enrichFlightResult(), EnrichedDeal interface, NON_BOOKABLE_SOURCES)
    - lib/deals.ts (getTopDeals() — Drizzle raw SQL + enrichment + sort + dedup)
    - components/deal-card.tsx (DealCard with TIER_COLORS, TIER_LABELS, sweetSpot badge)
    - components/deal-feed.tsx (DealFeed grid with empty state)
  modified:
    - app/deals/page.tsx (replaced placeholder with RSC data fetch + DealFeed render)
    - next.config.ts (added experimental.extensionAlias for webpack .js→.ts resolution)
    - vercel.json (updated buildCommand to next build --webpack)
    - package.json (updated next-build script to next build --webpack)

key-decisions:
  - "Helper functions copied from monitor.ts into lib/enrichment.ts — monitor.ts is excluded from Next.js tsconfig (transitive scraper imports), so copying ~80 lines is cleaner than restructuring daemon code"
  - "Webpack chosen over Turbopack for production build — experimental.extensionAlias only works with webpack; Turbopack cannot resolve NodeNext .js→.ts extension aliasing"
  - "amex-mr used as default program perspective for deal feed — most popular transferable currency; plan 03 adds program filter UI"
  - "Dedup by route+cabin+airline keeps best CPP per combo after sorting — ensures deal feed shows unique opportunities"

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 2 Plan 02: Deal Feed Data Layer and Components Summary

**RSC deal feed reading flight_cache via Drizzle raw SQL, enriching with CPP and sweet spot tier badges, rendered as DealCard grid with S=gold/A=green/B=blue badges**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T22:05:02Z
- **Completed:** 2026-02-27T22:11:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created `lib/enrichment.ts` with `enrichFlightResult()` ported from `monitor.ts` — pure function, no daemon imports, computes CPP, deal rating, booking URLs, sweet spot matches, transfer-from credit card programs
- Created `lib/deals.ts` with `getTopDeals()` — queries 200 most recent `flight_cache` rows, flattens JSONB `award_flights`, filters non-bookable sources, enriches with amex-mr as default program, sorts by CPP desc, dedupes by route+cabin+airline
- Built `DealCard` component with amber/gold S-tier badge, emerald A-tier, blue B-tier, points display in amber, CPP in emerald
- Built `DealFeed` responsive grid (1 col mobile → 2 col tablet → 3 col desktop) with empty state
- Replaced `/deals` placeholder with async RSC that fetches live data — `force-dynamic` ensures fresh DB reads on every request
- Fixed blocking build issue: switched production build from Turbopack to webpack via `--webpack` flag; configured `experimental.extensionAlias` in next.config.ts to resolve NodeNext `.js` → `.ts` imports

## Task Commits

1. **Task 1: Enrichment and data access layer** - `7d8330c` (feat)
2. **Task 2: DealCard, DealFeed, /deals page** - `ac510f9` (feat)

## Files Created/Modified

- `lib/enrichment.ts` — `enrichFlightResult()` pure function, `EnrichedDeal` interface, `NON_BOOKABLE_SOURCES`
- `lib/deals.ts` — `getTopDeals()` server-side data access with Drizzle raw SQL
- `components/deal-card.tsx` — DealCard with tier badges, points, CPP, route display
- `components/deal-feed.tsx` — DealFeed grid with empty state
- `app/deals/page.tsx` — RSC page (replaced placeholder)
- `next.config.ts` — `experimental.extensionAlias` for webpack .js→.ts resolution
- `vercel.json` — buildCommand updated to `next build --webpack`
- `package.json` — next-build script updated to `next build --webpack`

## Decisions Made

- **Helper functions copied, not imported from monitor.ts**: `monitor.ts` is excluded from the Next.js tsconfig because it transitively imports `scrapers/index.ts` which has pre-existing type errors in `cathay.ts` and `korean-air.ts`. Copying 5 helper functions (~80 lines) into `lib/enrichment.ts` is cleaner than restructuring daemon code or adding complex tsconfig overrides.

- **webpack over Turbopack for production**: The daemon source files (`transfer-partners.ts`, `sweet-spots.ts`, `airports.ts`, `db-drizzle.ts`) use NodeNext-style `.js` extensions in internal imports. `experimental.extensionAlias` in Next.js only applies to webpack — Turbopack cannot resolve `.js` → `.ts` via this config path. Switching to `next build --webpack` fixes the module resolution without touching daemon source files.

- **amex-mr as default program perspective**: The deal feed has no user-specific program yet (Plan 03 adds the filter UI). Using `amex-mr` as the default gives the most coverage (15 airline partners) for CPP computation and booking URLs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Switched production build from Turbopack to webpack**
- **Found during:** Task 2 (build verification)
- **Issue:** Daemon source files use NodeNext `.js` extensions in imports (e.g. `import ... from './airports.js'`). Turbopack production build fails with "Module not found: Can't resolve './airports.js'" because it looks for the exact file — `airports.js` doesn't exist, only `airports.ts`.
- **Fix:** Added `experimental.extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }` to `next.config.ts`. Updated `vercel.json` buildCommand and `package.json` next-build script to use `next build --webpack`. Webpack respects `extensionAlias`; Turbopack does not.
- **Files modified:** `next.config.ts`, `vercel.json`, `package.json`
- **Verification:** `npx next build --webpack` succeeds — `/deals` route shows as `ƒ (Dynamic)` (correct — force-dynamic)
- **Impact:** Dev mode still uses Turbopack (fast HMR). Only production build uses webpack. No functionality change.

## Self-Check: PASSED

Key files verified:
- `lib/enrichment.ts` — FOUND
- `lib/deals.ts` — FOUND
- `components/deal-card.tsx` — FOUND
- `components/deal-feed.tsx` — FOUND
- `app/deals/page.tsx` — FOUND (modified from placeholder)
- `next.config.ts` — FOUND (modified with extensionAlias)

Commits verified:
- `7d8330c` — FOUND (feat(02-02): add enrichment layer and data access)
- `ac510f9` — FOUND (feat(02-02): build DealCard, DealFeed, wire /deals page)

Build verified: `npx next build --webpack` → success, `/deals` renders as `ƒ (Dynamic)` RSC

---
*Phase: 02-app-shell-deal-feed*
*Completed: 2026-02-27*
