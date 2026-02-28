---
phase: 05-live-search-sse
plan: 05-03
subsystem: frontend-live-search
tags: [live-search, sse, react, zustand, components, search-results]
dependency_graph:
  requires:
    - 05-01  # SSE proxy + Zustand store (LiveFlightResult, useLiveSearchStore)
    - 05-02  # useLiveSearch hook with EventSource lifecycle
  provides:
    - LiveSearchProgress component (per-scraper status panel)
    - SearchResults with merged SSR + live results
    - liveResultToEnrichedDeal mapper
  affects:
    - app/search/page.tsx (prop changes)
    - components/search-results.tsx (full rewrite)
tech_stack:
  added: []
  patterns:
    - useMemo for SSR+live result merge with deduplication
    - CSS-only spinner (border-t-primary animate-spin)
    - Zustand store consumed in leaf client component
key_files:
  created:
    - components/live-search-progress.tsx
  modified:
    - components/search-results.tsx
    - app/search/page.tsx
decisions:
  - LiveSearchProgress reads directly from useLiveSearchStore (no props) — leaf 'use client' component
  - liveResultToEnrichedDeal fills transferFrom=[], sweetSpot=null, region='' as sensible defaults for Harbor-enriched flights
  - SSR results placed before live results in merge — they have full enrichment (sweetSpot, transferFrom, transferBonuses)
  - Dedup key is airline+flightNumber+departureDate+cabin — same as store's seenKeys
  - Metro dedup operates on mergedResults (SSR+live combined) not just SSR results
  - Empty state still renders LiveSearchProgress so users see scrapers working before first result arrives
metrics:
  duration: 74s
  completed: "2026-02-28"
  tasks_completed: 2
  files_changed: 3
---

# Phase 05 Plan 03: LiveSearchProgress Component + SearchResults Integration Summary

LiveSearchProgress component with per-scraper status dots and elapsed timer, integrated with SearchResults which now merges SSR and live results via useLiveSearch hook.

## What Was Built

### Task 1: LiveSearchProgress component (`components/live-search-progress.tsx`)

New leaf `'use client'` component that reads directly from `useLiveSearchStore` and renders:
- CSS-only spinner during live search (`border-t-primary animate-spin`)
- Status label ("Live search in progress" / "Live search complete")
- Elapsed seconds counter with `tabular-nums` (prevents digit-width jitter)
- Per-scraper rows with colored status dots: green=done, yellow=running, red=error, gray=pending/skipped
- `__search-error` pseudo-scraper rendered as separate message block above rows (for concurrency limit errors)
- Returns `null` when `isLive=false` AND `scrapers` is empty — panel only appears after search starts

### Task 2: SearchResults + page integration

**`components/search-results.tsx`** — Full rewrite:
- New props: `cabin`, `program`, `date` (added to `SearchResultsProps`)
- Calls `useLiveSearch(from, to, cabin, program, date)` on every render — per MEMORY.md "Every search triggers a live scrape"
- `liveResultToEnrichedDeal()` mapper: converts `LiveFlightResult` to `EnrichedDeal` with defaults for missing fields (`transferFrom: []`, `sweetSpot: null`, `region: ''`, `transferBonuses: []`, unique `id` with `live-` prefix)
- `mergedResults` via `useMemo`: SSR results first (full enrichment), then non-duplicate live results. Dedup key: `airline-flightNumber-departureDate-cabin`
- `LiveSearchProgress` rendered above results (and above empty state)
- Metro dedup operates on `mergedResults` (SSR+live combined)
- Result count shows merged total, updates as live results arrive

**`app/search/page.tsx`** — Prop addition:
- Passes `cabin`, `program`, `date` to `SearchResults` (all already extracted from `searchParams`)

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 — LiveSearchProgress | 18ce481 | components/live-search-progress.tsx (new) |
| 2 — SearchResults integration | d7c99f7 | components/search-results.tsx, app/search/page.tsx |

## Verification

- [x] `components/live-search-progress.tsx` exists with `'use client'` directive
- [x] Shows spinner and "Live search in progress" when `isLive` is true
- [x] Shows "Live search complete" when `isLive` is false (after search finishes)
- [x] Shows elapsed seconds with `tabular-nums` class
- [x] Lists each scraper with colored status dot and message
- [x] Returns `null` when no search has been started
- [x] Displays `__search-error` message for concurrency limit errors
- [x] `app/search/page.tsx` passes `cabin`, `program`, `date` to `SearchResults`
- [x] `SearchResults` calls `useLiveSearch(from, to, cabin, program, date)`
- [x] `LiveSearchProgress` appears above results when live search is running
- [x] Duplicate flights (same airline + flightNumber + date + cabin) deduplicated
- [x] Metro dedup works on merged results (SSR + live)
- [x] Result count updates as live results arrive
- [x] Empty state shows `LiveSearchProgress` so users see scrapers working
- [x] `npm run next-build` succeeds

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All files present and all commits verified:
- FOUND: components/live-search-progress.tsx
- FOUND: components/search-results.tsx
- FOUND: app/search/page.tsx
- FOUND commit 18ce481 (Task 1)
- FOUND commit d7c99f7 (Task 2)
