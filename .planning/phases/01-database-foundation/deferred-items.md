# Deferred Items — Phase 01 Database Foundation

## Pre-existing TypeScript Errors (out of scope)

Discovered during plan 01-04 execution. These errors exist BEFORE the availabilityType type change and are NOT caused by it. They are in scraper files unrelated to this plan.

### cathay.ts (7 errors)
- Line 107: `Type 'number' is not assignable to type 'string'`
- Line 343, 372: Object literal uses `miles` field not in FlightResult
- Line 391, 392: Property `miles`/`taxes` don't exist on FlightResult

**Fix**: Cathay scraper uses `miles`/`taxes` instead of FlightResult's `pointsRequired`/`taxesAndFees`. Needs field name alignment.

### korean-air.ts (4 errors)
- Line 69: Casting FlightResult[] to SkyTeamAvailability[] is incompatible
- Line 110: Wrong number of arguments
- Line 126: Object literal missing required `departureDate` and `scrapedAt` fields

**Fix**: Korean Air scraper doesn't fully implement FlightResult contract — missing required fields.

### scrapers/index.ts (1 error)
- Line 454: `string` not assignable to `"oneworld" | "skyteam" | "star" | "independent"`

**Fix**: A scraper's `covers` array or alliance lookup is returning an untyped string where a union literal is expected.

## Recommendation
Address in a dedicated "Scraper Type Cleanup" task. None of these prevent the active scrapers (AA, Flying Blue, Alaska, Delta) from running — they are in blocked/testing scrapers (cathay DOM parser, korean-air).
