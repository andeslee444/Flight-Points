---
phase: 05-live-search-sse
plan: 05-01
subsystem: ui
tags: [next.js, zustand, sse, proxy, rewrites]

# Dependency graph
requires: []
provides:
  - next.config.ts rewrites() proxying /api/flights/live-search to Harbor Express server
  - next.config.ts headers() setting X-Accel-Buffering: no on SSE route
  - stores/live-search-store.ts Zustand store with LiveFlightResult accumulation and per-scraper status
affects:
  - 05-02-live-search-hook (consumes useLiveSearchStore)
  - 05-03-live-search-ui (consumes useLiveSearchStore and LiveFlightResult)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - next.config.ts rewrites() as TCP-level transparent SSE proxy (no serverless timeout)
    - Zustand store with Set<string> for O(1) dedup (no persist middleware — Set not serializable)

key-files:
  created:
    - stores/live-search-store.ts
  modified:
    - next.config.ts
    - .env.example

key-decisions:
  - "HARBOR_URL fallback is http://HARBOR_URL_NOT_SET (not localhost) — missing env var fails loudly, not silently"
  - "rewrites() preferred over Route Handler for SSE: no serverless timeout constraint, transparent TCP proxy"
  - "LiveFlightResult not EnrichedDeal — Harbor enrichment omits transferFrom/sweetSpot/region/transferBonuses/scrapedAt; component layer maps in Plan 05-03"
  - "updateScraper uses scraperKey parameter (not key shorthand) to avoid TypeScript duplicate computed property error"

patterns-established:
  - "SSE proxy via next.config.ts rewrites(): source=/api/flights/live-search -> destination=${HARBOR_URL}/api/flights/live-search"
  - "Zustand stores use 'use client' directive, no persist middleware for ephemeral state with non-serializable types"

requirements-completed:
  - SRCH-05

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 05 Plan 01: Harbor SSE Proxy via next.config.ts Rewrites + Live Search Zustand Store Summary

**next.config.ts SSE proxy rewrites to Harbor Express with X-Accel-Buffering header, plus Zustand store holding live results and per-scraper status with O(1) Set-based deduplication**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T02:37:48Z
- **Completed:** 2026-02-28T02:39:16Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `rewrites()` to `next.config.ts` that transparently proxies `/api/flights/live-search` to `${HARBOR_URL}/api/flights/live-search` — avoids Vercel serverless 60s timeout for 20-60s scrapes
- Added `headers()` to `next.config.ts` setting `X-Accel-Buffering: no` on SSE path to prevent proxy buffering of streaming events
- Created `stores/live-search-store.ts` with `useLiveSearchStore` holding `isLive`, `elapsedSeconds`, `liveResults`, `scrapers` map, and all required actions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rewrites and headers to next.config.ts for SSE proxy** - `5c2087c` (feat)
2. **Task 2: Create live search Zustand store** - `d312b2c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `next.config.ts` - Added rewrites() SSE proxy and headers() anti-buffering config, preserved extensionAlias
- `.env.example` - Added HARBOR_URL with Harbor SSE Proxy section comment
- `stores/live-search-store.ts` - New Zustand store: LiveFlightResult, ScraperState, ScraperStatus types + useLiveSearchStore

## Decisions Made

- `HARBOR_URL` fallback is `http://HARBOR_URL_NOT_SET` (not `localhost`) — missing env var fails loudly at the rewrite layer, not silently succeeding against a local server
- `rewrites()` preferred over a Next.js Route Handler for SSE proxy: Route Handlers on Vercel serverless have a hard timeout (10-60s); rewrites() is a transparent TCP proxy with no timeout
- `LiveFlightResult` instead of `EnrichedDeal`: Harbor's SSE enrichment omits `transferFrom`, `sweetSpot`, `region`, `transferBonuses`, `scrapedAt` — storing Harbor format avoids lossy mapping, component layer maps in Plan 05-03
- `updateScraper` uses `scraperKey` parameter (renamed from `key`) to avoid TypeScript error: duplicate computed property key when using `key,` shorthand inside `[key]: { ... }` object

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed duplicate computed property key in updateScraper**
- **Found during:** Task 2 (Create live search Zustand store)
- **Issue:** The plan's code template had `key,` shorthand inside `[key]: { key, ... }` — TypeScript strict mode raises "key is specified more than once, so this usage will be overwritten" error, failing the build
- **Fix:** Renamed parameter from `key` to `scraperKey`, extracted `defaults: ScraperState` object separately, spread `defaults` then `existing` then `patch` — same semantics, no TypeScript error
- **Files modified:** `stores/live-search-store.ts`
- **Verification:** `npm run next-build` succeeds with no TypeScript errors
- **Committed in:** `d312b2c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix required for build to pass. Semantics are identical — existing state overrides defaults, patch overrides existing state. No scope creep.

## Issues Encountered

- TypeScript strict mode caught duplicate computed property key in plan template code — auto-fixed per Rule 1 (see above)

## User Setup Required

`HARBOR_URL` must be set in both local `.env` and Vercel dashboard before live search works:
- Local dev: add `HARBOR_URL=http://150.136.249.186:3000` (or your Harbor IP) to `.env`
- Vercel: add `HARBOR_URL` env var in Vercel dashboard Project Settings > Environment Variables

## Next Phase Readiness

- SSE proxy configured — Plan 05-02 can create the `useLiveSearch` hook that opens `EventSource` against `/api/flights/live-search` and calls store actions
- `useLiveSearchStore` ready for consumption by hook (Plan 05-02) and UI components (Plan 05-03)
- `LiveFlightResult` type defined — component layer in Plan 05-03 will map to `EnrichedDeal`-compatible shape for `FlightResultCard`

---
*Phase: 05-live-search-sse*
*Completed: 2026-02-28*

## Self-Check: PASSED

- FOUND: next.config.ts
- FOUND: .env.example
- FOUND: stores/live-search-store.ts
- FOUND: .planning/phases/05-live-search-sse/05-01-SUMMARY.md
- FOUND commit: 5c2087c (feat(05-01): add SSE proxy rewrites)
- FOUND commit: d312b2c (feat(05-01): create live search Zustand store)
