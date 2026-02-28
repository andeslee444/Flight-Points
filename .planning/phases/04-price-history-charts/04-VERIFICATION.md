---
phase: 04-price-history-charts
verified: 2026-02-27T22:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 4: Price History Charts Verification Report

**Phase Goal:** Historical trend chart and transfer bonus display
**Verified:** 2026-02-27T22:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees a historical price trend chart below search results | VERIFIED | `PriceHistoryChart` rendered in `app/search/page.tsx` when `hasSearch` is true; server-side `getPriceHistory()` call confirmed wired |
| 2 | Chart shows MIN(miles) per day with date X-axis and Xk Y-axis | VERIFIED | `lib/price-history.ts` uses `MIN(miles) GROUP BY DATE(scraped_at)` SQL; `formatDate` and `formatMiles` formatters in `components/price-history-chart.tsx` |
| 3 | Chart shows graceful empty state when no history data exists | VERIFIED | `data.length === 0` guard in `PriceHistoryChart` renders "Price history will appear after a few days of monitoring this route"; API route returns `{ data: [], message: "Not enough data yet..." }` |
| 4 | API route validates params and handles multi-airport codes | VERIFIED | `app/api/flights/history/route.ts` validates `from`/`to` required, `days` as integer 1-365; splits comma-separated codes and takes first airport |
| 5 | User sees transfer bonus label when an active bonus applies | VERIFIED | `FlightResultCard` renders amber label block at line 139-148 of `components/flight-result-card.tsx`; uses `deal.transferBonuses` populated by `enrichFlightResult()` |
| 6 | Transfer bonus label shows best bonus with effective reduced cost | VERIFIED | IIFE with `reduce((a, b) => a.bonusPct > b.bonusPct ? a : b)` selects highest bonus; displays `{description} bonus: effectively {effectiveCost} pts` |
| 7 | No bonus label renders when no active bonuses exist (clean absence) | VERIFIED | `ACTIVE_TRANSFER_BONUSES` starts empty; `getActiveBonuses()` filters by expiry date; `deal.transferBonuses.length > 0` guard prevents rendering |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/price-history.ts` | `getPriceHistory()` query function with MIN(miles)/day aggregation | VERIFIED | Exports `getPriceHistory` and `HistoryPoint`; uses `MIN(miles) GROUP BY DATE(scraped_at)` with `availability_type='confirmed'` filter; INTERVAL parameterized SQL |
| `app/api/flights/history/route.ts` | GET handler with param validation and graceful empty state | VERIFIED | Validates `from`/`to` required, `days` 1-365, handles comma-separated airports, returns `{ data: [], message }` when empty |
| `components/ui/chart.tsx` | shadcn ChartContainer, ChartConfig, ChartTooltipContent | VERIFIED | Created by `npx shadcn@latest add chart`; exports `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle` |
| `app/globals.css` | `--chart-1` through `--chart-5` inside `@theme inline` | VERIFIED | Lines 27-31 inside the single `@theme inline` block (Tailwind 4 syntax, not `@layer base`) |
| `package.json` | `recharts` as dependency | VERIFIED | `"recharts": "^2.15.4"` at line 34 |
| `components/price-history-chart.tsx` | 'use client' AreaChart with warm gold gradient, empty state | VERIFIED | Uses `ChartContainer`, `AreaChart`, `linearGradient` with `var(--chart-1)`, empty state guard, `ChartTooltip` (not raw `Tooltip`) |
| `lib/transfer-bonuses.ts` | Static bonus config with `getActiveBonuses()`, `getBonusesForProgram()`, `effectiveBonusCost()` | VERIFIED | Exports all five items: `TransferBonus` interface, `ACTIVE_TRANSFER_BONUSES`, `getActiveBonuses`, `getBonusesForProgram`, `effectiveBonusCost` |
| `lib/enrichment.ts` | `EnrichedDeal.transferBonuses` field populated in `enrichFlightResult()` | VERIFIED | `transferBonuses` field added to `EnrichedDeal` interface (lines 76-81); computed at lines 270-283 and included in return object at line 314 |
| `components/flight-result-card.tsx` | Amber transfer bonus label between transfer pills and footer | VERIFIED | Lines 139-148: conditional IIFE renders amber `div` with `text-amber-400 bg-amber-500/10 border border-amber-500/20` when `deal.transferBonuses.length > 0` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/search/page.tsx` | `lib/price-history.ts` | `import { getPriceHistory }` + server-side `await` call | WIRED | Import on line 2; call on line 32 with `primaryFrom`, `primaryTo`, `cabin`; result passed as `data` prop to `PriceHistoryChart` |
| `app/search/page.tsx` | `components/price-history-chart.tsx` | `import { PriceHistoryChart }` + JSX render | WIRED | Import on line 6; rendered at lines 51-58 with `data`, `from`, `to`, `cabin` props when `hasSearch` is true |
| `app/api/flights/history/route.ts` | `lib/price-history.ts` | `import { getPriceHistory }` + `await getPriceHistory(from, to, cabin, days)` | WIRED | Import on line 3; called at line 27; result returned as JSON `data` array |
| `lib/enrichment.ts` | `lib/transfer-bonuses.ts` | `import { getBonusesForProgram, effectiveBonusCost }` | WIRED | Import at lines 18-20; `getBonusesForProgram` called at line 271; `effectiveBonusCost` called at line 280; result assigned to `transferBonuses` and returned in `EnrichedDeal` |
| `components/flight-result-card.tsx` | `lib/enrichment.ts` | `deal.transferBonuses` (via `EnrichedDeal` type) | WIRED | `deal.transferBonuses.length > 0` guard at line 140; `reduce()` to find best bonus; renders label with `best.description` and `best.effectiveCost` |
| `components/price-history-chart.tsx` | `components/ui/chart.tsx` | `import { ChartContainer, ChartTooltip, ChartTooltipContent }` | WIRED | Imports on lines 11-14; `ChartContainer` wraps chart at line 60; `ChartTooltip` used at line 83 (shadcn alias, not raw Recharts Tooltip — correct for `useChart()` context) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VALU-05 | 04-01, 04-02 | User sees historical price trend chart for a route ("this route usually costs X points") | SATISFIED | `getPriceHistory()` queries `price_history` table with MIN(miles)/day; `PriceHistoryChart` renders AreaChart below search results; empty state shown when no data |
| VALU-06 | 04-03 | User sees when active transfer bonuses reduce the effective cost of a redemption | SATISFIED | `lib/transfer-bonuses.ts` provides runtime-filtered bonus config; `enrichFlightResult()` populates `transferBonuses` on `EnrichedDeal`; `FlightResultCard` displays amber label with effective reduced cost when bonuses are active |

No orphaned requirements: only VALU-05 and VALU-06 are mapped to Phase 4 in REQUIREMENTS.md, and both are claimed by plans in this phase.

---

### Anti-Patterns Found

No anti-patterns detected across all six phase 04 files:
- `lib/price-history.ts` — no TODOs, no stub returns
- `app/api/flights/history/route.ts` — no TODOs, no stub returns
- `components/price-history-chart.tsx` — no TODOs; `return null` at line 33 is a legitimate empty-state guard, not a stub
- `lib/transfer-bonuses.ts` — commented-out example in `ACTIVE_TRANSFER_BONUSES` is intentional documentation, not a stub
- `lib/enrichment.ts` — no TODOs, no stub returns
- `components/flight-result-card.tsx` — no TODOs, no stub returns

---

### Human Verification Required

#### 1. Price History Chart Visual Rendering

**Test:** Navigate to `/search?from=JFK&to=LHR&class=business&program=amex-mr` after the daemon has run for a few days accumulating `price_history` rows.
**Expected:** A warm gold area chart appears below search results showing dates on the X-axis (MM/DD format) and points on the Y-axis (Xk format). Hovering shows a themed tooltip with exact values.
**Why human:** Chart rendering, gradient appearance, and tooltip interactivity require browser execution. Cannot verify SVG output from static analysis.

#### 2. Price History Empty State

**Test:** Navigate to `/search?from=JFK&to=NRT&class=economy&program=amex-mr` for a route with no history data yet.
**Expected:** A bordered card appears below results with text "Price history will appear after a few days of monitoring this route".
**Why human:** Requires confirming the UI renders correctly for a no-data scenario in the actual browser.

#### 3. Transfer Bonus Label

**Test:** Add a temporary entry to `ACTIVE_TRANSFER_BONUSES` in `lib/transfer-bonuses.ts` with a future `expiresAt`, then search for a matching route/program combination.
**Expected:** An amber-colored label appears between the transfer partner pills and the footer row: "{description} bonus: effectively {N} pts".
**Why human:** The `ACTIVE_TRANSFER_BONUSES` array is intentionally empty at launch (no current active bonuses), so the label cannot be verified in production without manual configuration.

---

### Notes on Design Decisions Verified

1. **`ChartTooltip` vs raw `Tooltip`:** The plan originally showed `<Tooltip>` from recharts imports, but the implementation correctly uses `<ChartTooltip>` from `@/components/ui/chart` (the shadcn alias for `RechartsPrimitive.Tooltip`). This is required because `ChartTooltipContent` calls `useChart()` which depends on the `ChartContext` provider that `ChartContainer` wraps. The deviation was noted in the 04-02 SUMMARY and the implementation is correct.

2. **Empty `ACTIVE_TRANSFER_BONUSES` array:** The array starts empty with a commented-out example. This is by design — the maintainer should check for current bonuses and populate when active promotions exist. The runtime expiry filtering means old entries do not need cleanup.

3. **`availability_type = 'confirmed'` filter in SQL:** Ensures only real live deal history appears in charts, excluding cathay-calendar estimates (`ana-estimated`, `ana-chart`). Consistent with `NON_BOOKABLE_SOURCES` set in `lib/enrichment.ts`.

---

_Verified: 2026-02-27T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
