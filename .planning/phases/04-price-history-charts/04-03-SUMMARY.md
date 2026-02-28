---
phase: 04-price-history-charts
plan: 04-03
subsystem: ui
tags: [transfer-bonuses, enrichment, flight-result-card, react, typescript]

# Dependency graph
requires:
  - phase: 04-01
    provides: EnrichedDeal type, enrichFlightResult function, FlightResultCard component
provides:
  - lib/transfer-bonuses.ts with static bonus config and helpers
  - TransferBonus interface + ACTIVE_TRANSFER_BONUSES array
  - getActiveBonuses(), getBonusesForProgram(), effectiveBonusCost() utilities
  - EnrichedDeal.transferBonuses field populated by enrichFlightResult
  - FlightResultCard amber transfer bonus label (shows when active bonus applies)
affects: [future-plan-updates, search-results, deal-feed]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static config pattern for external promotional data — no API, manually maintained array with runtime expiry filtering"
    - "IIFE in JSX for complex conditional rendering — avoids local variable in render function"

key-files:
  created:
    - lib/transfer-bonuses.ts
  modified:
    - lib/enrichment.ts
    - components/flight-result-card.tsx

key-decisions:
  - "ACTIVE_TRANSFER_BONUSES starts empty with commented example — avoids including expired bonuses from launch day"
  - "Expiry filtering uses string comparison of YYYY-MM-DD dates — ISO date strings sort lexicographically"
  - "transferBonuses cross-references transferFrom list — only shows bonus if CC program can actually transfer to this airline"
  - "FlightResultCard shows best bonus only (highest bonusPct) when multiple apply — avoids UI clutter"
  - "IIFE pattern in JSX for reduce() logic — avoids declaring local variables in component render scope"

patterns-established:
  - "Transfer bonus label pattern: amber color scheme (text-amber-400, bg-amber-500/10, border-amber-500/20) for promotional callouts"

requirements-completed: [VALU-06]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 4 Plan 03: Transfer Bonus Display on FlightResultCard Summary

**Static transfer bonus config with runtime expiry filtering, enrichment integration, and amber label on FlightResultCard showing effectively reduced point cost**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T00:31:04Z
- **Completed:** 2026-02-28T00:32:47Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `lib/transfer-bonuses.ts` with `TransferBonus` interface, empty `ACTIVE_TRANSFER_BONUSES` array (commented example for easy updates), `getActiveBonuses()` (runtime date filtering), `getBonusesForProgram()` (lookup by airline program), and `effectiveBonusCost()` (math: `ceil(miles / (ratio * (1 + pct/100)))`)
- Added `transferBonuses` field to `EnrichedDeal` interface and computed it in `enrichFlightResult()` — cross-references active bonuses with `transferFrom` list to ensure only applicable bonuses are shown
- Added amber bonus label to `FlightResultCard` between transfer partner pills and footer — shows best (highest %) bonus when active, nothing when empty

## Task Commits

Each task was committed atomically:

1. **Task 1: Create transfer bonus config + add to enrichment layer** - `3cc9a2b` (feat)
2. **Task 2: Add transfer bonus label to FlightResultCard** - `694512c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `lib/transfer-bonuses.ts` - Static transfer bonus config with expiry-filtered lookup helpers and effectiveBonusCost() math
- `lib/enrichment.ts` - Added transferBonuses field to EnrichedDeal interface + bonus computation in enrichFlightResult()
- `components/flight-result-card.tsx` - Added amber transfer bonus label between transfer pills and footer

## Decisions Made

- `ACTIVE_TRANSFER_BONUSES` starts empty with commented example — avoids including potentially-expired bonuses from launch day (Feb 28, 2026); maintainer checks current bonuses before deploying
- Expiry filtering uses ISO date string comparison (`b.expiresAt >= today`) — YYYY-MM-DD strings sort lexicographically, no Date parsing needed
- `transferBonuses` computation cross-references active bonuses against `transferFrom` list — only shows bonus if the CC program already has a transfer path to this airline
- FlightResultCard shows only the best bonus (highest `bonusPct`) when multiple apply — avoids cluttering the card with multiple promotional labels
- IIFE pattern (`{deal.transferBonuses.length > 0 && (() => { ... })()}`) used in JSX to run `reduce()` without declaring local variables in the component render scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

Transfer bonuses are manually maintained in `lib/transfer-bonuses.ts`. To add an active bonus:
1. Check https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/
2. Add an entry to `ACTIVE_TRANSFER_BONUSES` with `fromProgram`, `toProgram`, `bonusPct`, `description`, `expiresAt`
3. Expired entries are automatically hidden at runtime (no cleanup needed)

## Next Phase Readiness

- Transfer bonus infrastructure complete — ready for Plan 04-04 if additional Phase 4 work is planned
- `lib/transfer-bonuses.ts` is easy to update when new promotions are announced
- Build verified clean: `npm run next-build` passes with all routes

## Self-Check: PASSED

- FOUND: lib/transfer-bonuses.ts
- FOUND: lib/enrichment.ts (modified)
- FOUND: components/flight-result-card.tsx (modified)
- FOUND: .planning/phases/04-price-history-charts/04-03-SUMMARY.md
- FOUND commit: 3cc9a2b (Task 1 — transfer bonus config + enrichment)
- FOUND commit: 694512c (Task 2 — FlightResultCard amber label)
- FOUND commit: 5481771 (docs — plan metadata)

---
*Phase: 04-price-history-charts*
*Completed: 2026-02-28*
