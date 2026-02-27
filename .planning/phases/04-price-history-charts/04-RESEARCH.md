# Phase 4: Price History Charts - Research

**Researched:** 2026-02-27
**Domain:** Data visualization (Recharts v2 area chart), Next.js API routes, PostgreSQL time-series queries, transfer bonus config
**Confidence:** HIGH

---

## Summary

Phase 4 adds two features to the search page: (1) a 30-day historical price trend area chart displayed below search results for the searched route/cabin, and (2) transfer bonus labels on FlightResultCard that show the effective reduced cost when an active bonus applies (e.g. "30% Chase UR → Virgin Atlantic: effectively 71,429 pts").

The data pipeline for (1) is already built: `price_history` table exists on AWS RDS, `history-writer.ts` appends confirmed results each daemon cycle, and `getDrizzle()` is available for Vercel reads. The blocking question from the roadmap — "wait 3-4 weeks for data to accumulate" — means the chart UI will be ready before data is dense enough to be visually meaningful, but the implementation is straightforward. The chart can gracefully show an empty/sparse state.

For (2), there is no existing transfer bonus infrastructure anywhere in the codebase. Bonuses are real-world promotional offers (30% Chase → Virgin Atlantic through Feb 28, 30% Capital One → JAL through Feb 28, etc.) that change monthly and have no public API. The only viable implementation for v1 is a static config file manually updated when bonuses are announced. This is a deliberate simplification: auto-fetching from external sites would add scraping complexity out of scope for this phase.

**Primary recommendation:** Use shadcn/ui `chart` component (which wraps Recharts under the hood) for the area chart — it provides CSS variable theming that matches the existing dark zinc theme automatically. For transfer bonuses, use a static `lib/transfer-bonuses.ts` config file with bonus definitions that the planner can template for easy manual updates.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALU-05 | User sees historical price trend chart for a route ("this route usually costs X points") | price_history table exists with origin/destination/cabin/miles/scraped_at; Recharts AreaChart + shadcn chart component handle rendering; SQL query aggregates MIN(miles) per day |
| VALU-06 | User sees when active transfer bonuses reduce the effective cost of a redemption | Static `lib/transfer-bonuses.ts` config provides bonus data; enrichment layer computes effective points; FlightResultCard renders the label |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | ^2.x (installed via shadcn add chart) | Area chart rendering | Recharts is what shadcn/ui chart wraps — declarative SVG, zero config, React-native |
| shadcn/ui chart | added via `npx shadcn@latest add chart` | ChartContainer + ChartConfig + theming | Provides CSS variable theming that maps to existing dark zinc globals.css automatically; no extra theming work |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm (already installed) | 0.45.1 | Type-safe SQL query for price_history | History API route reads via getDrizzle() |
| date-fns or native Date | — | Date formatting for X-axis labels | Format 'YYYY-MM-DD' strings as 'Jan 15', 'Jan 22', etc. in chart tooltip |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn chart (Recharts wrapper) | Tremor | Tremor is heavier, separate design system — doesn't match zinc dark theme; shadcn chart is already the standard for this stack |
| shadcn chart (Recharts wrapper) | Victory Charts | Less ecosystem support in 2026; no CSS variable theming |
| Static transfer-bonuses.ts config | External scraper for transfer bonus data | External scraping adds unreliable maintenance surface; static file is reviewable, versionable, and correct for v1 |

**Installation:**
```bash
npx shadcn@latest add chart
# This installs recharts as a dependency and adds components/ui/chart.tsx
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
└── api/
    └── flights/
        └── history/
            └── route.ts         # New: GET /api/flights/history?from=JFK&to=LHR&cabin=business

components/
├── price-history-chart.tsx      # New: 'use client' AreaChart component
├── flight-result-card.tsx       # Modified: add transfer bonus label
└── ui/
    └── chart.tsx                # New: added by `npx shadcn@latest add chart`

lib/
├── transfer-bonuses.ts          # New: static bonus config + lookup helpers
└── enrichment.ts                # Modified: add effectiveCost() using bonus data
```

### Pattern 1: shadcn ChartContainer + Recharts AreaChart

**What:** shadcn/ui chart provides `ChartContainer` (wraps Recharts' ResponsiveContainer) and `ChartConfig` (CSS variable theming). You use Recharts components directly inside it. The container handles responsive sizing and CSS variable injection.

**When to use:** Any chart in the app. ChartContainer ensures the chart colors match the design system variables already defined in globals.css.

**Example (from Context7 / shadcn official docs):**
```tsx
// Source: https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/chart.mdx
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';

const chartConfig = {
  miles: {
    label: 'Points Required',
    color: 'var(--chart-1)',  // maps to --chart-1 in globals.css
  },
} satisfies ChartConfig;

export function PriceHistoryChart({ data }: { data: HistoryPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[200px] w-full">
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="milesGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
        <Tooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="miles"
          stroke="var(--chart-1)"
          fill="url(#milesGrad)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
```

### Pattern 2: History API Route — SQL Aggregation

**What:** GET `/api/flights/history?from=JFK&to=LHR&cabin=business` queries `price_history` for the past 30 days, groups by `scrape_cycle_id` date (or `DATE(scraped_at)`), and returns MIN(miles) per day as the chart data points. MIN is correct — shows the cheapest confirmed seat available that day.

**When to use:** Any time the chart component needs data.

**Example (raw SQL via drizzle execute):**
```typescript
// Source: pattern from lib/search.ts (db.execute with drizzle raw SQL)
import { getDrizzle } from '@/src/flights/db-drizzle';
import { sql } from 'drizzle-orm';

export async function getPriceHistory(
  origin: string,
  destination: string,
  cabin: string,
  days = 30,
): Promise<{ date: string; miles: number }[]> {
  const db = getDrizzle();
  const result = await db.execute(
    sql`SELECT
          DATE(scraped_at) AS date,
          MIN(miles)       AS miles
        FROM price_history
        WHERE origin      = ${origin.toUpperCase()}
          AND destination = ${destination.toUpperCase()}
          AND cabin       = ${cabin}
          AND scraped_at >= NOW() - INTERVAL '${sql.raw(String(days))} days'
          AND availability_type = 'confirmed'
        GROUP BY DATE(scraped_at)
        ORDER BY date ASC`,
  );
  return result.rows.map((r) => ({
    date: String(r.date).slice(0, 10), // YYYY-MM-DD
    miles: Number(r.miles),
  }));
}
```

**Critical note on SQL injection safety:** The `days` param must be a validated integer (not user string) before interpolation into `sql.raw()`. In the route handler, parse with `parseInt()` and validate range.

**Critical note on multi-airport queries:** The route currently supports comma-separated airports (e.g. `from=JFK,EWR`). The history query should support `origin = ANY(${originsArray})` like `lib/search.ts` does, OR default to only the primary airport. The simplest v1 approach: use the first airport from the comma-separated list (or the exact value if single). The user is searching a specific route so the chart context is already route-specific.

### Pattern 3: Transfer Bonus Static Config

**What:** A `lib/transfer-bonuses.ts` file defines current active bonuses as a typed array. A lookup function `getBonusForProgram(programCode, ccSlug)` returns the active bonus or null. The enrichment layer uses this to compute `effectiveCost` when applicable.

**When to use:** When FlightResultCard needs to display the bonus label.

**Example structure:**
```typescript
// lib/transfer-bonuses.ts

export interface TransferBonus {
  fromProgram: string;      // CC slug, e.g. 'chase-ur'
  toProgram: string;        // Airline programCode, e.g. 'virgin-atlantic'
  bonusPct: number;         // e.g. 40 for 40% bonus
  description: string;      // e.g. '40% Chase UR → Virgin Atlantic'
  expiresAt: string;        // 'YYYY-MM-DD' — used to filter expired bonuses
}

// Manually updated when bonuses are announced
export const ACTIVE_TRANSFER_BONUSES: TransferBonus[] = [
  {
    fromProgram: 'chase-ur',
    toProgram: 'virgin-atlantic',
    bonusPct: 40,
    description: '40% Chase UR → Virgin Atlantic',
    expiresAt: '2026-02-28',
  },
  {
    fromProgram: 'capital-one',
    toProgram: 'jal',
    bonusPct: 30,
    description: '30% Capital One → JAL Mileage Bank',
    expiresAt: '2026-02-28',
  },
  // Add new bonuses here when announced
];

export function getActiveBonuses(): TransferBonus[] {
  const today = new Date().toISOString().slice(0, 10);
  return ACTIVE_TRANSFER_BONUSES.filter((b) => b.expiresAt >= today);
}

export function getBonusForResult(
  airlineProgramCode: string,
  ccProgramSlug: string,
): TransferBonus | null {
  const active = getActiveBonuses();
  return active.find(
    (b) => b.toProgram === airlineProgramCode && b.fromProgram === ccProgramSlug,
  ) ?? null;
}

// Compute effective points cost with bonus applied
// A 40% bonus means 1 CC point → 1.4 airline miles
// So you need FEWER CC points: effectiveCost = airlineMiles / (ratio * (1 + bonus/100))
export function effectiveBonusCost(
  milesRequired: number,
  transferRatio: number,
  bonusPct: number,
): number {
  const effectiveRatio = transferRatio * (1 + bonusPct / 100);
  return Math.ceil(milesRequired / effectiveRatio);
}
```

### Pattern 4: Placement in SearchResults (below results)

**What:** The PriceHistoryChart renders below the FlightResultCard list, scoped to the searched route/cabin. It requires an API call from a client component (or a server fetch if embedded in the RSC page).

**Recommended approach:** Fetch chart data server-side in `app/search/page.tsx` (already a server component) alongside `getSearchResults`. Pass data as a prop to `PriceHistoryChart`. This avoids an extra client-side fetch and keeps the loading model simple (chart loads with the page).

**Alternative (client-side fetch):** If the chart is a separate "lazy load" panel, use a client component that fetches `/api/flights/history` on mount. Acceptable if chart is hidden by default (e.g., collapsible). However, since the requirement says "below search results" (not hidden), server-side fetch is cleaner.

### Pattern 5: Transfer Bonus Label in FlightResultCard

**What:** When a deal's `transferFrom` includes a CC program with an active bonus to this airline, show a label: "30% Amex MR → ANA bonus: effectively X pts". This is computed at enrichment time.

**Where to add it:** Two options:
1. Add `effectiveCost` field to `EnrichedDeal` in `lib/enrichment.ts`, computed using `getBonusForResult`. FlightResultCard reads it directly.
2. Compute in FlightResultCard at render time.

Option 1 is cleaner (enrichment layer is the right place for derived values). However, it adds a dependency on `lib/transfer-bonuses.ts` from `lib/enrichment.ts`. This is safe — both are Vercel-only lib files, no daemon imports.

### Anti-Patterns to Avoid

- **Fetching live transfer bonus data from external sites:** No public API exists for this data. Scraping TPG or similar would be brittle and potentially violate ToS. Static config is the right answer for v1.
- **Using raw Recharts `ResponsiveContainer` directly:** The shadcn chart component wraps this properly with CSS variable injection — going around it means manually handling theme colors.
- **Querying all price_history rows then aggregating in JS:** The `price_history` table will grow large over time. Always aggregate at the SQL level (`MIN(miles) GROUP BY DATE(scraped_at)`).
- **Showing the chart when history is empty:** Render a "Not enough data yet" state instead of an empty chart with no axes or data lines. The chart was intentionally delayed 3-4 weeks after Phase 1 for data accumulation.
- **Using `sql.raw()` for user-provided strings:** The origin/destination params should be validated and uppercased before use in parameterized queries.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Responsive chart container | Custom div with resize observer | `ChartContainer` from shadcn/ui chart | Handles ResponsiveContainer + CSS variable theming automatically |
| Chart color theming | Inline hex colors | `var(--chart-1)` via `ChartConfig` | globals.css already has --chart-1 through --chart-5 in both light/dark; CSS vars just work |
| Custom tooltip UI | Hand-coded tooltip div | `ChartTooltipContent` from shadcn chart | Styled to match shadcn design system; handles active/inactive state |
| Transfer bonus lookup | External API scraper | Static `ACTIVE_TRANSFER_BONUSES` array in lib | No public API; static config is maintainable and correct for v1 |

**Key insight:** shadcn/ui chart is deliberately non-wrapping ("The components are yours") — you use Recharts components directly inside `ChartContainer`. This means Recharts knowledge transfers 1:1, no abstraction to fight.

---

## Common Pitfalls

### Pitfall 1: Empty History — No Data Yet

**What goes wrong:** The chart renders with no data points. An empty Recharts `AreaChart` renders a blank SVG with axes but no line. Visually confusing.

**Why it happens:** Phase 4 is being built 3-4 weeks after Phase 1 (per roadmap), but the daemon may not have had enough cycles on a specific route to accumulate meaningful history, especially for less-searched routes.

**How to avoid:** Check `data.length === 0` before rendering the chart. Show a muted placeholder: "Price history will appear after a few days of monitoring this route." This is also the state on first load before any daemon data.

**Warning signs:** Chart renders with no visible line, just empty axes.

### Pitfall 2: sql.raw() Injection with days Parameter

**What goes wrong:** PostgreSQL does not allow parameterized interval values (e.g., `$1 days`). Developers reach for `sql.raw()` for the interval, which opens injection if `days` is user-controlled.

**Why it happens:** Drizzle's parameterized query (`${days}`) fails for `INTERVAL '${days} days'` syntax in PostgreSQL.

**How to avoid:** Parse `days` with `parseInt(sp.get('days') ?? '30', 10)`, validate `1 <= days <= 365`, then use `sql.raw(String(days))` only after validation. The route handler owns this validation.

### Pitfall 3: Multi-Airport Comma Param Mismatch

**What goes wrong:** The search page sends `from=JFK,EWR,LGA` (metro group) but the history query does a simple `origin = 'JFK,EWR,LGA'` equality check.

**Why it happens:** `lib/search.ts` uses `origin = ANY(${originsArray})` for the flight_cache query. A naive history route might not follow the same pattern.

**How to avoid:** The history route handler must split `from` on commas and pass an array, using `WHERE origin = ANY(${sql.array(origins)})`. OR simplify to only use the first airport (since the chart is route-context-specific, one canonical airport is fine for history).

### Pitfall 4: Transfer Bonus Expiry Not Checked at Runtime

**What goes wrong:** A bonus defined in `ACTIVE_TRANSFER_BONUSES` with `expiresAt: '2026-02-28'` still displays on March 1 if nobody updated the config.

**Why it happens:** The config is static — no daemon updates it.

**How to avoid:** `getActiveBonuses()` filters by `expiresAt >= today` at runtime. Expired bonuses are silently hidden. The display is correct as long as the config is updated when new bonuses launch (a manual task, tracked as a reminder in CLAUDE.md or a GitHub issue).

### Pitfall 5: --chart-N CSS Variables Not Defined in globals.css

**What goes wrong:** shadcn chart component generates `var(--chart-1)` but the existing `globals.css` in this project uses Tailwind 4 syntax (`@theme inline`) not `@layer base {}`. The chart CSS variables must be added in the right place.

**Why it happens:** The existing `globals.css` uses `@theme inline` (Tailwind 4 way) not `@layer base`. shadcn chart docs show `@layer base` for CSS variables. These are different scopes.

**How to avoid:** Add the chart CSS variables inside `@theme inline` in `globals.css` (the Tailwind 4 way), NOT in `@layer base`. Concretely:
```css
/* Add inside @theme inline block in globals.css */
--chart-1: oklch(0.769 0.188 70.08);   /* warm gold — matches --color-primary */
--chart-2: oklch(0.6 0.118 184.704);
--chart-3: oklch(0.696 0.17 162.48);
--chart-4: oklch(0.627 0.265 303.9);
--chart-5: oklch(0.645 0.246 16.439);
```
This is the Tailwind 4 equivalent of `@layer base :root { --chart-1: ... }`.

### Pitfall 6: webpack vs turbopack Build

**What goes wrong:** The `next-build` script uses `next build --webpack` explicitly. If a plan task runs `next build` (without `--webpack`) it will use Turbopack, which cannot resolve the `.js → .ts` extensionAlias and fails.

**Why it happens:** Turbopack (Next.js default in dev) cannot handle `experimental.extensionAlias` — this is a known project constraint from Phase 02-02. See STATE.md decision: "webpack chosen over Turbopack for production build."

**How to avoid:** All build verification commands must use `npm run next-build` (which is `next build --webpack`), never bare `next build`.

---

## Code Examples

Verified patterns from official sources and codebase:

### shadcn Chart Installation
```bash
# Source: https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/chart.mdx
npx shadcn@latest add chart
# Adds: components/ui/chart.tsx + installs recharts as npm dependency
```

### ChartConfig with CSS Variables
```tsx
// Source: Context7 /shadcn-ui/ui — ChartConfig theming pattern
import type { ChartConfig } from '@/components/ui/chart';

const chartConfig = {
  miles: {
    label: 'Points Required',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig;
```

### SQL: Aggregate price_history by day
```typescript
// Source: Drizzle raw SQL pattern established in lib/search.ts (Phase 03)
import { getDrizzle } from '@/src/flights/db-drizzle';
import { sql } from 'drizzle-orm';

const db = getDrizzle();
const result = await db.execute(
  sql`SELECT
        DATE(scraped_at) AS date,
        MIN(miles)       AS miles
      FROM price_history
      WHERE origin      = ${origin}
        AND destination = ${destination}
        AND cabin       = ${cabin}
        AND scraped_at >= NOW() - INTERVAL '30 days'
        AND availability_type = 'confirmed'
      GROUP BY DATE(scraped_at)
      ORDER BY date ASC`,
);
```

### Next.js API Route (pattern from existing routes)
```typescript
// Source: pattern from app/api/flights/search/route.ts
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from')?.toUpperCase() || '';
  const to   = sp.get('to')?.toUpperCase() || '';
  const cabin = sp.get('cabin') || 'business';

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to' }, { status: 400 });
  }
  // ... query and return
}
```

### Gradient AreaChart (Recharts)
```tsx
// Source: Context7 /recharts/recharts — GradientAreaChart pattern
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';

<ChartContainer config={chartConfig} className="h-[200px] w-full">
  <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
    <defs>
      <linearGradient id="milesGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
      </linearGradient>
    </defs>
    <CartesianGrid vertical={false} stroke="var(--border)" />
    <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(d) => d.slice(5)} />
    <YAxis hide />
    <Tooltip content={<ChartTooltipContent />} />
    <Area
      type="monotone"
      dataKey="miles"
      stroke="var(--chart-1)"
      fill="url(#milesGrad)"
      strokeWidth={2}
      dot={false}
    />
  </AreaChart>
</ChartContainer>
```

### Transfer Bonus Label in FlightResultCard
```tsx
// Computed in enrichment or at render time
{effectiveBonusCost && (
  <div className="mt-2 text-xs text-amber-400">
    {bonus.description} bonus: effectively {effectiveCost.toLocaleString()} pts
  </div>
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recharts standalone (no wrapper) | shadcn/ui chart wrapping Recharts | shadcn chart added ~2024 | CSS variable theming, accessible, composable |
| `next build` (Turbopack default) | `next build --webpack` (project constraint) | Phase 02-02 | Must use `--webpack` flag due to extensionAlias; documented in STATE.md |
| Raw Drizzle ORM queries | `db.execute(sql\`...\`)` for raw SQL | Phase 01 established pattern | flight_cache not in Drizzle schema; price_history in schema but raw SQL is acceptable for complex aggregations |

**Deprecated/outdated:**
- Turbopack for this project's production builds: cannot resolve `.js → .ts` extensionAlias. Always use `--webpack`.
- `@layer base` for CSS variables: this project uses Tailwind 4 with `@theme inline` — add chart variables inside the existing `@theme inline` block in `globals.css`.

---

## Open Questions

1. **Data accumulation timing**
   - What we know: Phase 1 history-writer has been running since ~2026-02-26; Phase 4 is being built ~2026-02-27 (1 day later, not 3-4 weeks). The DB may have little or no price_history data yet.
   - What's unclear: Whether the daemon has been actively running since Phase 1 completion and writing to `price_history`.
   - Recommendation: Plan 04-01 (API route) should include an explicit empty-state spec so the chart degrades gracefully. Do not block the phase — the chart renders correctly once data exists.

2. **Per-program vs. aggregate chart**
   - What we know: `price_history.program` stores the scraper key (e.g. 'daemon', 'aa-cdp'). The current search shows results across all programs.
   - What's unclear: Whether the chart should show one line per program or a single aggregate MIN line across all programs.
   - Recommendation: Single aggregate MIN line per day across all programs for the searched cabin. Keeps the chart simple and answers "what does this route usually cost" cleanly. Multiple lines would require a legend and are confusing at 200px height.

3. **Handling comma-separated metro airports in history route**
   - What we know: The search page passes `from=JFK,EWR,LGA` for metro areas. The history table stores individual airport codes.
   - What's unclear: Whether the chart should cover the full metro or just the searched origin.
   - Recommendation: For v1, use the primary airport from the URL param (split on comma, take first). The chart label should say "JFK route history" not "JFK/EWR/LGA." Metro aggregation adds complexity for marginal benefit.

4. **Transfer bonus data freshness**
   - What we know: Bonuses change monthly (current Feb 2026: Chase +40% Virgin Atlantic, Capital One +30% JAL). Static config will be stale if not maintained.
   - What's unclear: Who updates the config when bonuses change.
   - Recommendation: Add a comment in `lib/transfer-bonuses.ts` with the update process and links to TPG/NerdWallet trackers. This is an ongoing maintenance responsibility, not a code problem. Consider a GitHub issue template for "monthly bonus update."

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — this section is skipped.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/recharts/recharts` — AreaChart, gradient fill, ResponsiveContainer, custom tooltip patterns
- Context7 `/shadcn-ui/ui` — ChartContainer, ChartConfig, chart installation command, CSS variable theming
- `/Users/andeslee/Documents/Cursor-Projects/Flight-Points/src/flights/db-schema.ts` — price_history table structure verified
- `/Users/andeslee/Documents/Cursor-Projects/Flight-Points/src/flights/history-writer.ts` — confirms fields written (origin, destination, cabin, miles, scraped_at, availability_type='confirmed')
- `/Users/andeslee/Documents/Cursor-Projects/Flight-Points/lib/search.ts` — established pattern for getDrizzle() raw SQL queries in API routes
- `/Users/andeslee/Documents/Cursor-Projects/Flight-Points/app/globals.css` — confirms Tailwind 4 `@theme inline` syntax (not `@layer base`)
- `/Users/andeslee/Documents/Cursor-Projects/Flight-Points/next.config.ts` — confirms `extensionAlias` and webpack requirement

### Secondary (MEDIUM confidence)
- [The Points Guy — Current Transfer Bonuses Feb 2026](https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/) — Chase +40% Virgin Atlantic (exp Feb 28), Capital One +30% JAL (exp Feb 28), Amex no current airline bonuses
- [NerdWallet — Credit Card Transfer Bonuses Feb 2026](https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses) — corroborates TPG data

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — shadcn/ui chart + Recharts verified via Context7 official docs; already in use for this project style
- Architecture: HIGH — all patterns derived from existing codebase conventions (getDrizzle, raw SQL, ChartContainer); no novel patterns introduced
- Pitfalls: HIGH — CSS variable scope, webpack flag, multi-airport handling, and empty-state all verified against actual project files
- Transfer bonus config: MEDIUM — no existing codebase infrastructure; static config recommendation is a design choice, not a verified external pattern

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable libraries; transfer bonus data stale after ~30 days but that's config not code)
