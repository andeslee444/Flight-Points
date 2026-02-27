---
phase: 03-search-value-assessment
plan: 03-04
subsystem: frontend
tags: [metro-dedup, alliance-labels, coverage-notices, zustand, client-filtering]
depends_on:
  requires: [03-03]
  provides: [metro-airport-toggle, alliance-coverage-display, scraper-health-notices]
  affects: [search-page, search-results-component]
tech-stack:
  added: []
  patterns: [zustand-client-state, server-component-static-data, client-component-toggle]
key-files:
  created:
    - components/metro-toggle.tsx
    - components/coverage-notices.tsx
  modified:
    - components/search-results.tsx
    - app/search/page.tsx
decisions:
  - METRO_GROUPS constant copied into search-results.tsx (not imported from live-scraper.ts) to avoid daemon transitive deps
  - CoverageNotices is a Server Component (no 'use client') — data is static, no state needed
  - Metro dedup defaults to collapsed (showAllAirports=false in search-store) — users see clean view by default
metrics:
  duration: 70s
  completed: 2026-02-27T23:06:18Z
  tasks_completed: 2
  files_modified: 4
---

# Phase 3 Plan 4: Metro Dedup Toggle + Alliance Labels + Coverage Notices Summary

Metro airport deduplication toggle (JFK/EWR/LGA grouped), alliance gateway coverage badges (oneworld/Star/SkyTeam), and scraper health notices (Star Alliance limited, BA unavailable) added to search page.

## What Was Built

### Task 1: Metro Dedup Toggle + SearchResults Update (05a4dba)

**`components/metro-toggle.tsx`** — New Client Component toggle button using Zustand `useSearchStore`. Toggles `showAllAirports` state, rendering "Show all airports" / "Group nearby airports" text.

**`components/search-results.tsx`** — Updated with:
- `METRO_GROUPS` constant (exact copy from `live-scraper.ts` lines 30-61) — 15 metro areas
- Client-side dedup: when `showAllAirports=false`, collapses results by `originRep-destRep-cabin-airline-date` key
- Result count header: "15 results (3 nearby grouped)" — dynamically shows grouping count
- `MetroToggle` button in result header (right-aligned, ghost style)
- Result count header moved INTO `SearchResults` (removed from parent page)

**`app/search/page.tsx`** — Removed the `<h2>` result count + flex wrapper (now owned by SearchResults).

### Task 2: Coverage Notices + Alliance Labels (2eab232)

**`components/coverage-notices.tsx`** — New Server Component (no `'use client'`):
- Imports static `ALLIANCE_LABELS` + `SCRAPER_HEALTH_NOTICES` from `lib/coverage.ts`
- Alliance badges: three outline `<Badge>` elements in a flex-wrap row (oneworld, Star Alliance, SkyTeam with partner airlines listed)
- Health notices: amber warning banner for Star Alliance limited coverage, gray info banner for British Airways unavailability

**`app/search/page.tsx`** — Added `<CoverageNotices />` between `<SearchForm>` and the results section.

## Deviations from Plan

None — plan executed exactly as written. The required data files (`lib/coverage.ts`, `stores/search-store.ts`) already existed from Phase 3 Plan 2 work, making this plan straightforward.

## Self-Check: PASSED

- components/metro-toggle.tsx: FOUND
- components/coverage-notices.tsx: FOUND
- components/search-results.tsx: FOUND
- app/search/page.tsx: FOUND
- Commit 05a4dba (Task 1): FOUND
- Commit 2eab232 (Task 2): FOUND
- Next.js build: PASSED (webpack)
