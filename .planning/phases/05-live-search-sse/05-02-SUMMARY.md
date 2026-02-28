---
phase: 05-live-search-sse
plan: 02
subsystem: ui
tags: [react, zustand, sse, eventsource, typescript, hooks]

# Dependency graph
requires:
  - phase: 05-01
    provides: useLiveSearchStore Zustand store with startLive/addResult/updateScraper/finishLive/resetLive/setElapsed actions
provides:
  - useLiveSearch React hook managing EventSource lifecycle with SSE event dispatching
  - hooks/use-live-search.ts — drop-in hook for any component needing live search data
affects: [05-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - EventSource lifecycle managed in useEffect with full cleanup (close + resetLive) on unmount/param change
    - All SSE named events use addEventListener (never onmessage) — required for Harbor named event protocol
    - Elapsed timer via setInterval in useEffect, cleared on complete/error/cleanup
    - search-error stored as pseudo-scraper entry (__search-error) for uniform UI rendering

key-files:
  created:
    - hooks/use-live-search.ts
  modified:
    - tsconfig.json

key-decisions:
  - "useLiveSearch accesses store via useLiveSearchStore() at top level; stable Zustand ref is safe to exclude from effect deps"
  - "URLSearchParams encodes query string; class param (not cabin) matches Harbor Express req.query.class"
  - "eslint-disable-next-line react-hooks/exhaustive-deps on effect — store ref stable, adding would cause infinite re-renders"
  - "search-error stored as __search-error pseudo-scraper — allows uniform rendering in LiveSearchProgress without special-casing"
  - "onerror only calls finishLive() when readyState === CLOSED (not CONNECTING) — preserves auto-reconnect resilience"

patterns-established:
  - "Hook pattern: useRef<EventSource> + useRef<interval> for cleanup in useEffect return"
  - "Named SSE events: addEventListener is the only correct API — Harbor events never fire on onmessage"

requirements-completed: [SRCH-05]

# Metrics
duration: 1min
completed: 2026-02-28
---

# Phase 5 Plan 02: useLiveSearch Hook with EventSource Lifecycle Summary

**React hook managing EventSource SSE lifecycle — opens connection, dispatches 8 event types to Zustand store, runs elapsed timer, cleans up on unmount**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-28T02:41:47Z
- **Completed:** 2026-02-28T02:42:57Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created `hooks/use-live-search.ts` with complete EventSource lifecycle management
- All 8 Harbor SSE event types handled via `addEventListener` (scraper-started, scraper-progress, result, scraper-done, scraper-error, scraper-skipped, complete, search-error)
- Elapsed timer starts at connection open, clears on complete/error/cleanup
- onerror fallback detects permanent connection death (CLOSED state) without interfering with auto-reconnect (CONNECTING state)
- Added `hooks/**/*` to `tsconfig.json` include array so TypeScript picks up the new directory

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useLiveSearch hook with EventSource lifecycle management** - `61edd6a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `hooks/use-live-search.ts` - React hook managing EventSource connection to Harbor live-search SSE endpoint, dispatching all named events to useLiveSearchStore
- `tsconfig.json` - Added `"hooks/**/*"` to include array after `"stores/**/*"`

## Decisions Made
- `useLiveSearchStore()` called at hook top level (not inside effect) — Zustand store ref is stable, actions are stable; safe to exclude from dependency array
- `class` param (not `cabin`) used in URLSearchParams — matches Harbor Express endpoint's `req.query.class`
- `search-error` stored as `__search-error` pseudo-scraper key — allows LiveSearchProgress (Plan 05-03) to render error using same scraper status logic, no special case needed
- `onerror` only triggers `finishLive()` when `readyState === EventSource.CLOSED` — when `CONNECTING`, EventSource is auto-reconnecting per spec; we let it retry

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `useLiveSearch` hook is ready to be called from `SearchResults` in Plan 05-03
- Hook signature: `useLiveSearch(from, to, cabin, program, date?, enabled?)`
- Store actions are all typed — `LiveFlightResult` type exported from `live-search-store.ts` for use in Plan 05-03 component mapping

---
*Phase: 05-live-search-sse*
*Completed: 2026-02-28*
