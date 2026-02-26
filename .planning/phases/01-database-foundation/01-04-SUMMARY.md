---
phase: 01-database-foundation
plan: "04"
subsystem: types
tags: [types, typescript, availability-type, flight-result]
dependency_graph:
  requires: []
  provides: [AvailabilityType, FlightResult.availabilityType]
  affects: [src/flights/types.ts, src/flights/scrapers/index.ts, src/flights/history.ts]
tech_stack:
  added: []
  patterns: [optional-field-extension, type-alias-export]
key_files:
  created: []
  modified:
    - src/flights/types.ts
decisions:
  - "availabilityType is optional on FlightResult — existing scrapers do not set it; confirmed status comes from the SCRAPER_REGISTRY entry (Plan 02)"
  - "AvailabilityType exported as a standalone type alias so ScraperRegistryEntry can reuse the same union without duplication"
  - "Pre-existing TSC errors in cathay.ts and korean-air.ts are out-of-scope and deferred — they predate this plan and do not affect active scrapers"
metrics:
  duration_minutes: 2
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
  completed_date: "2026-02-26"
---

# Phase 1 Plan 4: AvailabilityType Field Addition Summary

**One-liner:** Optional `availabilityType?: 'confirmed' | 'calendar' | 'estimated'` field added to `FlightResult` with exported `AvailabilityType` alias — no breaking changes, zero new TypeScript errors.

## What Was Built

Added availability provenance classification to the core `FlightResult` type. This is the type-system foundation that Plans 02 and 03 use to gate which scraper results are written to the database. By adding the field in Phase 1, the type system is consistent from day one — no retrofitting required when Phase 2+ reads `availabilityType` for display filtering.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add availabilityType to FlightResult type | 62a0405 | src/flights/types.ts |
| 2 | Verify no breakage in monitor/live-scraper | 6b25954 | .planning/phases/01-database-foundation/deferred-items.md |

## Changes Made

### src/flights/types.ts

Added before `FlightResult` interface:
```typescript
export type AvailabilityType = 'confirmed' | 'calendar' | 'estimated';
```

Added to `FlightResult` interface (extended fields section):
```typescript
// Availability provenance — single source of truth for confirmed vs excluded data.
// Set at the scraper registry level (SCRAPER_REGISTRY.availabilityType) rather than
// per-result. Optional because existing scrapers inherit 'confirmed' from the registry entry.
availabilityType?: AvailabilityType;
```

## Verification Results

- `npx tsx -e "import type { FlightResult, AvailabilityType } from './src/flights/types.js'; ..."` — PASSED
- `npx tsc --noEmit`: 0 new errors from this change (pre-existing errors in cathay.ts, korean-air.ts are out-of-scope)
- `monitor.ts` loads cleanly (no TypeScript errors, no NON_BOOKABLE_SOURCES references)
- `live-scraper.ts` loads cleanly (no TypeScript errors, no NON_BOOKABLE_SOURCES references)
- `AvailabilityType[]` = `['confirmed', 'calendar', 'estimated']` — all three values confirmed usable

## Decisions Made

1. **availabilityType is optional on FlightResult** — Existing scrapers don't set it per-result; the gate operates at the registry level (Plan 02 adds `availabilityType` to `ScraperRegistryEntry`). Making it required would break all existing scraper code.

2. **AvailabilityType as a named alias** — Exporting the union type as `AvailabilityType` allows `ScraperRegistryEntry` (Plan 02) to reuse the same union without repeating the literal strings. Single source of truth for the classification vocabulary.

3. **No changes to monitor.ts or live-scraper.ts** — Neither file references `NON_BOOKABLE_SOURCES`. No TypeScript errors from the new field in either file. The plan's verification goal (zero new errors, both modules load) is met without any code changes.

## Deviations from Plan

None — plan executed exactly as written. The pre-existing TypeScript errors in `cathay.ts`, `korean-air.ts`, and `scrapers/index.ts` were documented in `deferred-items.md` per scope boundary rules (they predate this plan and are not caused by the availabilityType change).

## Pre-existing Issues (Out of Scope)

Documented in `.planning/phases/01-database-foundation/deferred-items.md`:

- `cathay.ts`: 7 TSC errors — uses `miles`/`taxes` field names instead of `pointsRequired`/`taxesAndFees`; number assigned to string field
- `korean-air.ts`: 4 TSC errors — SkyTeamAvailability cast incompatibility, missing required FlightResult fields
- `scrapers/index.ts`: 1 TSC error — `covers` array string not assignable to alliance union literal

These all predate plan 01-04 and are in blocked/testing scrapers (cathay DOM parser, korean-air). Active scrapers (AA, Flying Blue, Alaska, Delta) are unaffected.

## Self-Check: PASSED

- [x] `src/flights/types.ts` — modified with `AvailabilityType` alias and `availabilityType` field
- [x] Commit 62a0405 — feat(01-04): add AvailabilityType alias and availabilityType field to FlightResult
- [x] Commit 6b25954 — chore(01-04): verify type propagation in monitor/live-scraper, document pre-existing TSC errors
- [x] 0 new TypeScript errors introduced by this plan
- [x] monitor.ts and live-scraper.ts load without runtime errors
