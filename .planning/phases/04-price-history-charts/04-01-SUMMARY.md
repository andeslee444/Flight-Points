---
phase: 04-price-history-charts
plan: 01
subsystem: api
tags: [recharts, shadcn, postgresql, drizzle, next.js, price-history]

# Dependency graph
requires:
  - phase: 01-database-foundation
    provides: price_history table with scraped_at, origin, destination, cabin, miles, availability_type columns
provides:
  - getPriceHistory() query function aggregating MIN(miles)/day from price_history
  - GET /api/flights/history route with param validation and graceful empty state
  - shadcn ChartContainer/ChartConfig/ChartTooltipContent via components/ui/chart.tsx (recharts)
  - --chart-1 through --chart-5 CSS variables in @theme inline
affects:
  - 04-02-price-history-chart-component (consumes chart.tsx + /api/flights/history)
  - 04-03-chart-integration (wires chart into search results page)

# Tech tracking
tech-stack:
  added:
    - recharts 2.15.4 (via npx shadcn@latest add chart)
    - components/ui/chart.tsx (shadcn chart primitives: ChartContainer, ChartConfig, ChartTooltipContent)
  patterns:
    - getPriceHistory() follows lib/search.ts pattern: getDrizzle() + raw Drizzle sql`` tag
    - API route follows app/api/flights/search/route.ts pattern: NextRequest + NextResponse.json
    - Multi-airport comma-separated params: split on comma, take first airport only (v1 simplification)
    - Graceful empty state: return { data: [], message } not 404 or error when no history exists

key-files:
  created:
    - lib/price-history.ts
    - app/api/flights/history/route.ts
    - components/ui/chart.tsx
  modified:
    - app/globals.css
    - package.json
    - package-lock.json

key-decisions:
  - "INTERVAL '1 day' * ${days} syntax used for parameterized SQL — avoids sql.raw() injection risk while keeping Drizzle parameterization"
  - "Multi-airport from/to params: take only first airport for v1 (split on comma) — matches how getSearchResults handles it for history queries"
  - "availability_type = 'confirmed' filter in SQL — ensures only real live deal history, not estimated/calendar data"
  - "Chart CSS vars added to @theme inline block (not @layer base) — required for Tailwind 4 CSS variable system"

patterns-established:
  - "Graceful empty state pattern: { data: [], message: '...' } for routes where no data is a valid non-error state"
  - "Days param validation: parseInt + isNaN check + range [1,365] before passing to query"

requirements-completed:
  - VALU-05

# Metrics
duration: 6min
completed: 2026-02-28
---

# Phase 4 Plan 01: Price History API Route + shadcn Chart Installation Summary

**shadcn chart primitives (recharts 2.15.4) installed + GET /api/flights/history route with MIN(miles)/day SQL aggregation and graceful empty state**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-28T00:27:14Z
- **Completed:** 2026-02-28T00:33:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed shadcn chart component via `npx shadcn@latest add chart` — brings in recharts 2.15.4 and creates `components/ui/chart.tsx` with ChartContainer, ChartConfig, ChartTooltipContent primitives
- Added `--chart-1` through `--chart-5` CSS variables inside the `@theme inline` block in `globals.css` (Tailwind 4 syntax, not @layer base)
- Created `lib/price-history.ts` with `getPriceHistory()` function querying MIN(miles) per day via SQL GROUP BY DATE(scraped_at), filtering to availability_type='confirmed' only
- Created `app/api/flights/history/route.ts` with parameter validation (from/to required, days integer 1-365), comma-separated airport handling (takes first), and graceful empty state message
- Both `npm run next-build` passes confirmed, `/api/flights/history` shows as dynamic route in build output

## Task Commits

Each task was committed atomically:

1. **Task 1: Install shadcn chart component + add CSS variables** - `560ebac` (chore)
2. **Task 2: Create price history query function + API route** - `2107761` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `components/ui/chart.tsx` - shadcn chart primitives (ChartContainer, ChartConfig, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartTooltip)
- `app/globals.css` - Added --chart-1 through --chart-5 CSS variables inside @theme inline block
- `lib/price-history.ts` - getPriceHistory() with MIN(miles)/day aggregation, confirmed-only filter, parameterized INTERVAL SQL
- `app/api/flights/history/route.ts` - GET handler with param validation, comma-airport handling, graceful empty state
- `package.json` / `package-lock.json` - recharts 2.15.4 added as dependency

## Decisions Made
- Used `INTERVAL '1 day' * ${days}` PostgreSQL syntax for parameterized integer multiplication in SQL — avoids `sql.raw()` injection risk while keeping Drizzle's safe parameterization
- Multi-airport comma-separated from/to params: take only first airport for v1 — matches existing `getSearchResults()` pattern for consistency
- `availability_type = 'confirmed'` filter ensures only real live deal history appears in charts, not cathay-calendar estimates
- Chart CSS vars placed inside `@theme inline` block per Tailwind 4 requirement (not `@layer base` which is Tailwind 3 pattern)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `components/ui/chart.tsx` is ready for use in price history chart component (Plan 04-02)
- `GET /api/flights/history` endpoint is live and returns properly typed data
- `getPriceHistory()` is importable from `@/lib/price-history` in any RSC or server action
- Plan 04-02 can immediately build a Recharts AreaChart/LineChart using ChartContainer wrapping the fetched data

---
*Phase: 04-price-history-charts*
*Completed: 2026-02-28*

## Self-Check: PASSED

- FOUND: components/ui/chart.tsx
- FOUND: lib/price-history.ts
- FOUND: app/api/flights/history/route.ts
- FOUND: 04-01-SUMMARY.md
- FOUND commit: 560ebac (chore(04-01): install shadcn chart component)
- FOUND commit: 2107761 (feat(04-01): add price history query + API route)
