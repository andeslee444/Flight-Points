---
phase: 01-database-foundation
plan: "02"
subsystem: database
tags: [price-history, scraper-registry, history-writer, postgresql, daemon]

# Dependency graph
requires:
  - "01-01: price_history table on AWS RDS"
  - "01-04: AvailabilityType type in types.ts"
provides:
  - "SCRAPER_REGISTRY.availabilityType on all 15 entries — confirmed or calendar classification"
  - "src/flights/history-writer.ts — writeHistoryBatch() function with confirmed gate"
  - "Daemon writes confirmed scrape results to price_history after each cycle"
affects:
  - 04-price-history-charts: reads price_history via getDrizzle() — data now being accumulated
  - live-scraper.ts: if called with writeHistoryBatch, will need confirmed classification

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "availabilityType declared once per registry entry — history-writer reads registry, not per-result"
    - "cycleId generated once per daemon scan cycle — consistent ISO timestamp across all scrapers"
    - "writeHistoryBatch wrapped in try/catch in daemon — history writes never crash the daemon"
    - "Confirmed gate in writeHistoryBatch: if availabilityType !== 'confirmed' return 0 immediately"

key-files:
  created:
    - "src/flights/history-writer.ts — writeHistoryBatch() with confirmed gate, bulk INSERT, transaction"
  modified:
    - "src/flights/scrapers/index.ts — ScraperEntry interface + availabilityType on all 15 registry entries"
    - "src/flights/flight-daemon.ts — import writeHistoryBatch, generate cycleId, call after allResults populated"

key-decisions:
  - "Used r.pointsRequired and r.taxesAndFees (actual FlightResult fields) — plan specified r.milesRequired/r.taxesUSD which do not exist on FlightResult; auto-fixed per Rule 1"
  - "scraperKey='daemon' with 'confirmed' type for daemon's writeHistoryBatch call — daemon uses legacy batch scrapers not in SCRAPER_REGISTRY; all are confirmed scrapers so hard-coding 'confirmed' is accurate"
  - "writeHistoryBatch called once per cycle with all allResults — cleaner than per-scraper calls given daemon's legacy architecture"
  - "cathay is the only registry entry classified as 'calendar' — AFR API returns H/L/NA availability codes only, no real point prices per flight"

metrics:
  duration_minutes: 4
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
  completed_date: "2026-02-26"
---

# Phase 1 Plan 2: History Writer and Scraper Registry AvailabilityType Summary

**availabilityType declared on all 15 SCRAPER_REGISTRY entries; history-writer.ts created with confirmed gate; daemon wired to write allResults to price_history after each scan cycle**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-26T08:39:09Z
- **Completed:** 2026-02-26T08:46:00Z
- **Tasks:** 2
- **Files modified:** 1 created, 2 modified

## Accomplishments

- Added `AvailabilityType` import and `availabilityType` field to `ScraperEntry` interface
- Classified all 15 SCRAPER_REGISTRY entries: 14 as `'confirmed'`, 1 (`cathay`) as `'calendar'`
- Created `src/flights/history-writer.ts` with `writeHistoryBatch()` — confirmed gate, transaction-wrapped bulk INSERT into price_history
- Fixed field name mismatch: plan specified `r.milesRequired`/`r.taxesUSD` but actual FlightResult uses `r.pointsRequired`/`r.taxesAndFees`
- Wired `writeHistoryBatch` into `flight-daemon.ts` after each scan's allResults are populated
- cycleId generated once per scan, shared across all history writes in that cycle
- History write wrapped in try/catch — failure never crashes daemon

## Task Commits

Each task was committed atomically:

1. **Task 1: Add availabilityType to SCRAPER_REGISTRY** - `ef1899f` (feat)
2. **Task 2: Implement history-writer and wire into daemon** - `e52cb9c` (feat)

## Files Created/Modified

- `src/flights/history-writer.ts` — writeHistoryBatch() with confirmed gate, pg pool transaction, uses r.pointsRequired/r.taxesAndFees
- `src/flights/scrapers/index.ts` — ScraperEntry interface gets availabilityType field; all 15 entries classified
- `src/flights/flight-daemon.ts` — import writeHistoryBatch, cycleId at scan start, call after allResults populated

## Decisions Made

1. **r.pointsRequired / r.taxesAndFees field names:** Plan's template code used `r.milesRequired` and `r.taxesUSD` which do not exist on `FlightResult`. Auto-fixed to use the actual field names (Rule 1 - Bug). The Drizzle schema column is `taxes_usd` which is correct for the DB column, but the TypeScript insert parameter uses the value from `r.taxesAndFees`.

2. **scraperKey='daemon' with hard-coded 'confirmed':** The daemon uses legacy batch scrapers (`searchAAFastBatch`, `searchAACamoufoxBatch`, `searchANACamoufox`, etc.) that are not SCRAPER_REGISTRY keys. All of these are confirmed scrapers. Rather than refactoring the daemon to use the registry, we call `writeHistoryBatch(allResults, 'daemon', 'confirmed', cycleId)` once per cycle. The 'confirmed' type is accurate since the daemon only runs confirmed scrapers.

3. **cathay is 'calendar' only:** The Cathay Pacific AFR API returns `H/L/NA` availability codes with no per-flight point prices — it's purely calendar-level availability. All other 14 scrapers return real bookable prices and are classified as 'confirmed'.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed field name mismatch in history-writer.ts**
- **Found during:** Task 2 (implementing history-writer.ts)
- **Issue:** Plan template used `r.milesRequired` and `r.taxesUSD`, but `FlightResult` defines `pointsRequired` and `taxesAndFees`. The `milesRequired`/`taxesUSD` fields don't exist on the type.
- **Fix:** Used `r.pointsRequired` and `r.taxesAndFees` in the INSERT query parameters
- **Files modified:** src/flights/history-writer.ts
- **Committed in:** e52cb9c (Task 2 commit)

**2. [Rule 3 - Blocking] Plan 01-03 already modified flight-daemon.ts**
- **Found during:** Task 2 (editing flight-daemon.ts)
- **Issue:** When attempting first edit, file had been modified since initial read (plan 01-03 running in parallel added `checkAlerts` import and wiring). Re-read file, placed writeHistoryBatch import alongside the new 01-03 imports to avoid conflict.
- **Fix:** Re-read file, added import at the correct position, placed writeHistoryBatch call before checkAlerts call
- **Files modified:** src/flights/flight-daemon.ts

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking continuation)
**Impact on plan:** No user-visible impact. Field names corrected, daemon integration complete, all success criteria met.

## Verification

- `npx tsx /tmp/verify-registry.ts` — `missing availabilityType: []`, calendar scrapers: `['cathay']`, confirmed count: 14
- `npx tsc --noEmit` — 0 new errors introduced by this plan (pre-existing: cathay.ts, korean-air.ts, index.ts)
- `writeHistoryBatch` import resolves at runtime
- cycleId generated once per scan, consistent across all calls

## Next Phase Readiness

- price_history accumulation begins with first daemon cycle after deployment
- Phase 4 (price history charts) has weeks of lead time — data will be meaningful by then
- SCRAPER_REGISTRY.availabilityType can be used by live-scraper.ts if history writes are added there later

---
*Phase: 01-database-foundation*
*Completed: 2026-02-26*

## Self-Check: PASSED

All created files verified:
- FOUND: src/flights/history-writer.ts
- FOUND: src/flights/scrapers/index.ts (modified)
- FOUND: src/flights/flight-daemon.ts (modified)
- FOUND: .planning/phases/01-database-foundation/01-02-SUMMARY.md

All commits verified:
- FOUND: ef1899f (Task 1 - availabilityType in registry)
- FOUND: e52cb9c (Task 2 - history-writer created, daemon wired)

Functional checks:
- writeHistoryBatch import resolves at runtime: PASSED
- SCRAPER_REGISTRY has no missing availabilityType: PASSED
- cathay entry classified as 'calendar': PASSED
- confirmed scrapers count: 14 (all others): PASSED
- npx tsc --noEmit: 0 new errors from this plan: PASSED
