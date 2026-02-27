---
phase: 02-app-shell-deal-feed
plan: 03
subsystem: ui
tags: [nextjs, react, zustand, client-component, filter-bar, shadcn, deal-feed]

# Dependency graph
requires:
  - phase: 02-02
    provides: DealFeed server component, EnrichedDeal interface with cabin/region/transferFrom fields, /deals RSC page
  - phase: 02-01
    provides: shadcn/ui Select component, Zustand installed, Tailwind v4 dark theme
provides:
  - stores/filter-store.ts: useDealFilterStore with cabin/region/program Zustand state
  - components/filter-bar.tsx: Client Component with three shadcn/ui Select dropdowns
  - components/deal-feed.tsx: Client Component with Zustand filter integration (cabin + region + program)
  - /deals page: FilterBar above DealFeed, RSC passes full deals array as props to client components
affects: [03-live-search, all pages using DealFeed or filter state]

# Tech tracking
tech-stack:
  added:
    - zustand create() pattern for client-side filter state (already installed in 02-01)
  patterns:
    - RSC passes data as props to client components — data fetch stays in server, filtering is client-side
    - Zustand store shared between sibling client components (FilterBar + DealFeed) without prop drilling
    - 'use client' at file top — both filter-store.ts and components that use it must have directive

key-files:
  created:
    - stores/filter-store.ts (useDealFilterStore — cabin/region/program state + setters)
    - components/filter-bar.tsx (FilterBar — three Select dropdowns, reads/writes Zustand store)
  modified:
    - components/deal-feed.tsx (converted from server to client component, added Zustand filtering)
    - app/deals/page.tsx (added FilterBar import and render above DealFeed)

key-decisions:
  - "Filtering is entirely client-side — no server round-trip on filter change; full deals array passed once from RSC"
  - "Two empty states: 'No deals available right now' (empty DB) vs 'No deals match your filters' (filter mismatch) — distinct messages for distinct causes"
  - "Zustand store shared via module-level singleton — FilterBar and DealFeed share state without passing props between them"

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 2 Plan 03: Filter Bar and Client-Side Filtering Summary

**Zustand filter store with cabin/region/program state wired into FilterBar (three shadcn/ui Select dropdowns) and client-side DealFeed filtering — no server round-trip on filter change**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T22:13:56Z
- **Completed:** 2026-02-27T22:15:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `stores/filter-store.ts` with `useDealFilterStore` — Zustand store holding `cabin`, `region`, `program` filter state with typed setters. Both `CabinFilter`, `RegionFilter`, and `ProgramFilter` types exported for use in FilterBar.
- Created `components/filter-bar.tsx` — Client Component with three `shadcn/ui` Select dropdowns: Cabin (160px), Region (180px), Program (170px). Reads/writes Zustand store directly. Flex-wrap layout responds to mobile screens.
- Converted `components/deal-feed.tsx` from server to client component — added `'use client'`, imports `useDealFilterStore`, applies three-filter intersection logic. Two distinct empty states: DB empty vs filter mismatch.
- Updated `app/deals/page.tsx` — RSC still fetches `getTopDeals({ limit: 50 })` server-side, now renders `<FilterBar />` above `<DealFeed deals={deals} />`. Full deals array passed as props once; all filtering is client-side.

## Task Commits

1. **Task 1: Zustand filter store and FilterBar component** - `8f44ac5` (feat)
2. **Task 2: Convert DealFeed to client component, wire into page** - `70e59ea` (feat)

## Files Created/Modified

- `stores/filter-store.ts` — `useDealFilterStore` with `CabinFilter | RegionFilter | ProgramFilter` state
- `components/filter-bar.tsx` — FilterBar with Cabin / Region / Program Select dropdowns
- `components/deal-feed.tsx` — Client Component with Zustand filter integration
- `app/deals/page.tsx` — Added FilterBar render above DealFeed

## Decisions Made

- **Client-side filtering, server-side data fetch**: The RSC `DealsPage` fetches all 50 deals once on page load and passes them to client components as props. Filter changes are instant — no server round-trip, no loading states for filter interactions.

- **Two distinct empty states**: `deals.length === 0` shows "No deals available right now — The daemon scrapes flights every 30 minutes" (DB empty, not the user's fault). `filtered.length === 0` shows "No deals match your filters — Try broadening your search" (filter combination too narrow). Distinct messages prevent confusion.

- **Zustand store as module singleton**: `FilterBar` and `DealFeed` are sibling components in the React tree (both rendered from the RSC page). Using a Zustand store avoids lifting state to a client wrapper — the store is the shared state layer without prop drilling or a context provider.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Key files verified:
- `stores/filter-store.ts` — FOUND
- `components/filter-bar.tsx` — FOUND
- `components/deal-feed.tsx` — FOUND (modified, 'use client' added)
- `app/deals/page.tsx` — FOUND (FilterBar added)

Commits verified:
- `8f44ac5` — FOUND (feat(02-03): add Zustand filter store and FilterBar component)
- `70e59ea` — FOUND (feat(02-03): convert DealFeed to client component, wire FilterBar into /deals page)

Build verified: `npx next build --webpack` succeeds — `/deals` renders as `ƒ (Dynamic)` RSC

---
*Phase: 02-app-shell-deal-feed*
*Completed: 2026-02-27*
