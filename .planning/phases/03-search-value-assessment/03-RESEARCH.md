# Phase 3: Search + Value Assessment - Research

**Researched:** 2026-02-27
**Domain:** Next.js 16 App Router search page, Route Handlers, React Client Components, airport autocomplete, result display
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | User can search award flights by origin, destination, cabin class, and date | Search form as Client Component with router.push + searchParams prop on RSC page |
| SRCH-02 | User sees results from multiple airline programs in a single search | Route Handler queries flight_cache by origin/dest/cabin via getCacheEntries; enrichFlightResult already merges multi-program results |
| SRCH-03 | User sees which credit card programs can transfer to each result | EnrichedDeal.transferFrom already computed in lib/enrichment.ts; display as pill badges on FlightResultCard |
| SRCH-04 | User can click a direct booking link to the airline's award booking page | EnrichedDeal.bookingUrl already populated by getBookingUrl(); render as <a target="_blank"> |
| SRCH-06 | User sees when results were last scraped (freshness indicator) | flight_cache.updated_at returned by getCacheEntries(); display relative time ("3 hours ago") |
| SRCH-07 | User experience is fully responsive on mobile devices | Tailwind responsive prefixes (sm:, md:); search form stacks vertically on mobile |
| SRCH-08 | Nearby airports deduplicated by default (JFK/EWR/LGA as one metro) with expand option | METRO_GROUPS already in live-scraper.ts; collapseToRepresentative() exists; UI toggle stored in Zustand |
| SRCH-09 | Results show alliance gateway coverage labels ("Covers 80+ airlines via oneworld") | SCRAPER_REGISTRY has covers[] field; derive static labels from registry; display as info badges |
| SRCH-10 | User sees scraper health transparency ("Star Alliance data temporarily unavailable") | SCRAPER_REGISTRY has status field; derive coverage notices server-side; show inline notice |
| VALU-01 | User sees cents-per-point (CPP) for each result | EnrichedDeal.cpp already calculated in enrichFlightResult(); display on card |
| VALU-02 | User sees a deal quality badge on each result (good / great / incredible) | EnrichedDeal.dealRating ('hot'/'good'/'fair') already computed; map to badge labels |
| VALU-03 | User sees cash price comparison showing dollar savings ("Saves you $X vs cash") | EnrichedDeal.cashPrice already estimated; compute savings = cashPrice - (points * cpp / 100); display |
| VALU-04 | Results matching known sweet spots show S/A/B tier badge ("S-Tier: Holy Grail") | EnrichedDeal.sweetSpot already matched via matchSweetSpots(); display tier badge on card |
</phase_requirements>

---

## Summary

Phase 3 builds the core search experience — a route-search form that dispatches to a Next.js RSC page, a Route Handler that queries the existing `flight_cache` PostgreSQL table (via the already-working `getCacheEntries` function in `db.ts`), and a `FlightResultCard` component that renders the already-computed enrichment fields (`cpp`, `dealRating`, `sweetSpot`, `transferFrom`, `bookingUrl`). The infrastructure is largely complete from Phases 1 and 2: `lib/enrichment.ts` computes all value fields, `SCRAPER_REGISTRY` provides alliance coverage labels, `METRO_GROUPS` provides metro deduplication, and `EnrichedDeal` already has every field this phase needs.

The main new work is: (1) the search form UI (Client Component with controlled inputs, router.push on submit), (2) the `/search` RSC page that reads `searchParams` and queries the DB, (3) the `/api/flights/search` Route Handler port from Express, (4) `FlightResultCard` (heavier than `DealCard` — adds freshness, booking link, transfer partners, cash savings, metro toggle), and (5) the alliance gateway label and scraper health notice layer.

No new data infrastructure is required. All needed fields exist on `EnrichedDeal`. The shadcn/ui Combobox (Popover + Command) is the right approach for airport autocomplete — it is already in the project's style (new-york, zinc, cssVariables). Metro deduplication should be stored in a new Zustand search store, not the filter store.

**Primary recommendation:** Port `/api/flights/search` from Express to a Next.js Route Handler (`app/api/flights/search/route.ts`) using `request.nextUrl.searchParams`, then build the search page as an RSC that awaits `searchParams`, calls the DB directly (not via fetch to the Route Handler), and hydrates a Client Component result list.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16.1.6 (installed) | RSC pages + Route Handlers | Already in project, Phase 2 established patterns |
| Zustand | 5.0.11 (installed) | Client state (metro toggle, search form state) | Already used for filter-store.ts in Phase 2 |
| shadcn/ui | new-york style (installed) | Combobox, Button, Input, Badge, Card components | Already used in Phase 2 (Select, Card, Badge) |
| Tailwind CSS v4 | installed | Responsive layout | Already established in Phase 2 |
| Drizzle ORM + pg | installed | DB reads via getDrizzle() | Already used in lib/deals.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next/navigation` useRouter | built-in | Navigate with query params on search form submit | In the SearchForm Client Component |
| `next/navigation` useSearchParams | built-in | Read query params in Client Components | In SearchForm to pre-fill from URL |
| `cmdk` (Command) | via shadcn | Airport autocomplete dropdown | Shadcn Combobox uses Popover + Command |
| lucide-react | installed | Icons (Search, Calendar, Plane, ExternalLink, etc.) | Already in package.json |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn Combobox (Popover + Command) | react-select or downshift | shadcn Combobox is already in project style; react-select is heavier and dark-mode handling is manual |
| RSC page reads DB directly | RSC page fetches /api/flights/search | Direct DB read is faster (no extra HTTP round-trip); route handler still needed for external consumers |
| Zustand metro toggle | URL search param ?metro=true | URL param approach enables shareable links; Zustand is simpler and already established; use URL param |

**Installation (no new packages needed):**
```bash
# All required packages already installed. Only shadcn components to add:
npx shadcn@latest add combobox  # Actually: Combobox is a composition — add popover + command
npx shadcn@latest add popover
npx shadcn@latest add command
npx shadcn@latest add input
npx shadcn@latest add separator
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── search/
│   ├── page.tsx              # RSC: awaits searchParams, queries DB, renders results
│   └── loading.tsx           # Skeleton cards while page loads
├── api/
│   └── flights/
│       └── search/
│           └── route.ts      # Route Handler: GET ?from=JFK&to=LHR&class=business&program=amex-mr
components/
├── search-form.tsx           # Client Component: origin/dest autocomplete, cabin, date, program
├── flight-result-card.tsx    # Server-safe display component: CPP, badges, transfer partners, booking link
├── metro-toggle.tsx          # Client Component: show/hide nearby airport dedup toggle
└── search-results.tsx        # Client Component: wraps results with metro Zustand state
stores/
├── filter-store.ts           # Existing Phase 2 store
└── search-store.ts           # NEW: { showMetro: boolean, setShowMetro }
lib/
├── enrichment.ts             # Existing: enrichFlightResult() — NO CHANGES NEEDED
├── deals.ts                  # Existing: getTopDeals() — NO CHANGES NEEDED
└── search.ts                 # NEW: getSearchResults(params) — queries DB, enriches, returns EnrichedDeal[]
```

### Pattern 1: RSC Page reads searchParams directly from DB

**What:** The search results page is a Server Component. It receives `searchParams` as a prop (Promise in Next.js 16), awaits it, queries `flight_cache` via `getDrizzle()`, enriches with `enrichFlightResult()`, and passes results to a Client Component for metro toggling.

**When to use:** Always for initial page render. Eliminates HTTP round-trip, works with Vercel Edge caching.

**Example:**
```typescript
// Source: Context7 Next.js docs — searchParams prop pattern
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; class?: string; program?: string; date?: string }>
}) {
  const params = await searchParams;
  const { from, to, class: cabin, program = 'amex-mr', date } = params;

  if (!from || !to) {
    return <SearchEmptyState />;
  }

  const results = await getSearchResults({ from, to, cabin, program, date });

  return (
    <main className="container mx-auto px-4 py-8">
      <SearchForm initialFrom={from} initialTo={to} initialCabin={cabin} initialDate={date} initialProgram={program} />
      <SearchResults results={results} from={from} to={to} />
    </main>
  );
}
```

### Pattern 2: SearchForm as Client Component with router.push

**What:** SearchForm holds controlled input state, shows autocomplete dropdown for origin/dest, and dispatches `router.push('/search?from=...&to=...')` on submit. URL is the source of truth for search state.

**When to use:** When the form needs user interaction before submitting; URL-driven state enables bookmarkable searches.

**Example:**
```typescript
// Source: Context7 Next.js docs — createQueryString + router.push pattern
'use client';

import { useRouter } from 'next/navigation';

export function SearchForm({ initialFrom, initialTo, initialCabin, initialDate, initialProgram }) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom || '');
  const [to, setTo] = useState(initialTo || '');
  const [cabin, setCabin] = useState(initialCabin || 'business');
  const [program, setProgram] = useState(initialProgram || 'amex-mr');
  const [date, setDate] = useState(initialDate || '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({ from, to, class: cabin, program });
    if (date) params.set('date', date);
    router.push('/search?' + params.toString());
  }

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### Pattern 3: Route Handler for external API access

**What:** `app/api/flights/search/route.ts` mirrors the Express `/api/flights/search` logic. Ports directly from `src/flights/web-server.ts`. Used by the old HTML frontend and any future API consumers.

**When to use:** When external (non-Next.js) consumers need the search endpoint. RSC page bypasses this for its own render.

**Example:**
```typescript
// Source: Context7 Next.js docs — NextRequest searchParams
import { type NextRequest, NextResponse } from 'next/server';
import { getSearchResults } from '@/lib/search';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const cabin = sp.get('class') || 'business';
  const program = sp.get('program') || 'amex-mr';
  const date = sp.get('date') || undefined;

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to' }, { status: 400 });
  }

  const results = await getSearchResults({ from, to, cabin, program, date });
  return NextResponse.json({ results, count: results.length });
}
```

### Pattern 4: Airport Combobox with shadcn Popover + Command

**What:** Airport autocomplete using Popover + Command from shadcn/ui. Filtered against a static airport list (already in `airports.ts`). No API call needed — all airports fit in memory.

**When to use:** For origin and destination inputs. Popover opens on focus, filters as user types, closes on selection.

**Anti-Patterns to Avoid**

- **Fetching `/api/flights/search` from the RSC page:** Adds a cold-start penalty. The RSC page should call `getSearchResults()` directly (same pattern as `getTopDeals()` in Phase 2).
- **Storing search form state in URL AND Zustand simultaneously:** Single source of truth — URL owns the "submitted" search state, form local state owns the "typing" state.
- **Metro toggle as URL param with router.push:** This triggers a full server re-render. Metro dedup should be client-side filtering in the results component (Zustand), same as Phase 2's cabin/region filter.
- **Rendering FlightResultCard as `'use client'`:** Keep it a Server Component to avoid extra JS bundle. Only the SearchForm and metro toggle need `'use client'`.
- **Importing from `src/flights/monitor.ts` or `src/flights/web-server.ts` in Next.js app dir:** Already established as a Phase 2 decision — use `lib/enrichment.ts` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Airport autocomplete dropdown | Custom input + dropdown div | shadcn Combobox (Popover + Command) | Keyboard nav, a11y, focus management — cmdk handles all of it |
| Relative time formatting ("3 hours ago") | String parsing + date math | `Intl.RelativeTimeFormat` (built-in browser API, no package) | Works server-side in Node 16+, no bundle cost |
| Points → CPP calculation | Re-implementing enrichment | `enrichFlightResult()` from `lib/enrichment.ts` | Already handles ratio, taxes, CPP, sweetSpot — do not duplicate |
| Metro airport grouping | New Set-based collapse logic | `METRO_GROUPS` + `collapseToRepresentative()` from `live-scraper.ts` | Already exported and tested |
| Alliance label lookup | New registry scan | `SCRAPER_REGISTRY` `.covers` and `.status` fields | Truth source is already there |

**Key insight:** The enrichment layer is already complete. FlightResultCard is purely a display component — it renders fields that are already computed. The only computation in Phase 3 is the "saves $X vs cash" calculation (`cashPrice - (points * cpp / 100)`) and the freshness timestamp formatting.

---

## Common Pitfalls

### Pitfall 1: searchParams must be awaited in Next.js 16

**What goes wrong:** `const { from } = searchParams` (without await) throws a runtime error in Next.js 16 — `searchParams` is a Promise.

**Why it happens:** Next.js 16 made `searchParams` async to unblock PPR (Partial Prerendering). Phase 2's `DealsPage` uses `dynamic = 'force-dynamic'` which bypasses this for a simple page, but search results page needs the params.

**How to avoid:** Always `const params = await searchParams` before destructuring. Match the established Phase 2 pattern (`dynamic = 'force-dynamic'`).

**Warning signs:** TypeScript error: "Property 'from' does not exist on type 'Promise<...>'"

### Pitfall 2: useSearchParams requires Suspense boundary

**What goes wrong:** `useSearchParams()` in a Client Component throws during SSR without a Suspense boundary wrapping the component.

**Why it happens:** Next.js requires Suspense around `useSearchParams()` calls to handle the async nature of search params during SSR.

**How to avoid:** Wrap `SearchForm` (which reads `useSearchParams` to pre-fill) in `<Suspense fallback={<SearchFormSkeleton />}>`. The RSC page passes initial values as props so the form can be static if needed.

**Warning signs:** Build error: "useSearchParams() should be wrapped in a suspense boundary"

### Pitfall 3: Importing src/flights/* files with daemon-only transitive imports

**What goes wrong:** Importing `monitor.ts` or `web-server.ts` from any `app/` or `lib/` file pulls Playwright, Camoufox, and Python subprocess modules into the Next.js bundle. Build fails.

**Why it happens:** Already documented in Phase 2 decisions. The workaround is `lib/enrichment.ts` which copies the needed functions without transitive imports.

**How to avoid:** `lib/search.ts` (the new data layer) must only import from `lib/enrichment.ts`, `src/flights/db-drizzle.ts`, `src/flights/transfer-partners.ts`, `src/flights/airports.ts`, and `src/flights/sweet-spots.ts`. Never import `monitor.ts` or anything from `scrapers/`.

**Warning signs:** Build error referencing Playwright or Python child_process modules.

### Pitfall 4: Metro dedup as server-side filter causes stale data display

**What goes wrong:** If metro dedup is implemented in the Route Handler / RSC, toggling it requires a full page re-render (round-trip to DB). Users expect instant toggle.

**Why it happens:** Metro dedup is a display concern, not a data concern — the raw results include all airports.

**How to avoid:** Fetch all results for the expanded airport list, pass full array to Client Component, dedup client-side in Zustand based on `METRO_GROUPS`. Mirror Phase 2's cabin/region filter pattern exactly.

**Warning signs:** Search page slow to respond when toggling metro airports.

### Pitfall 5: getCacheEntries needs origins AND dests as arrays

**What goes wrong:** Passing a comma-separated string `"JFK,EWR"` directly to `getCacheEntries` returns no results — it expects `string[]`.

**Why it happens:** The existing Express handler in `web-server.ts` correctly splits on comma before calling DB. The port to Route Handler or `lib/search.ts` must replicate this split.

**How to avoid:** `const origins = from.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)` — copy exactly from `web-server.ts` line 133.

### Pitfall 6: Date input format mismatch

**What goes wrong:** Browser `<input type="date">` returns `YYYY-MM-DD` but `flight_cache` stores `departureDate` in the same format. However, the date is not currently used as a filter in `getCacheEntries` — it returns all cabin results across dates. The search form date field needs to filter post-query.

**Why it happens:** `getCacheEntries` in `db.ts` searches by `(origin, destination, cabin)` only, not by date. Date filtering currently happens in `processScraperResults` at the monitor level.

**How to avoid:** Add a date filter to `getSearchResults()` in `lib/search.ts` that filters `EnrichedDeal[]` after enrichment: `results.filter(r => !date || r.departureDate >= date)`. Or pass date to the DB query — research which is simpler based on current `getCacheEntries` SQL.

---

## Code Examples

Verified patterns from official sources and codebase:

### Route Handler: Port from Express (confirmed pattern)
```typescript
// app/api/flights/search/route.ts
// Source: Context7 Next.js docs /vercel/next.js — Route Handler GET searchParams
import { type NextRequest, NextResponse } from 'next/server';
import { getSearchResults } from '@/lib/search';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const cabin = sp.get('class') || 'business';
  const program = sp.get('program') || 'amex-mr';
  const date = sp.get('date') || undefined;

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to parameters' }, { status: 400 });
  }

  const results = await getSearchResults({ from, to, cabin, program, date });
  return NextResponse.json({
    results,
    count: results.length,
    source: 'daemon-cache',
  });
}
```

### RSC Search Page: Direct DB read (confirmed pattern)
```typescript
// app/search/page.tsx
// Source: Context7 Next.js docs — searchParams Promise prop
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; class?: string; program?: string; date?: string }>
}) {
  const params = await searchParams;
  const { from, to, class: cabin = 'business', program = 'amex-mr', date } = params;

  const results = (from && to) ? await getSearchResults({ from, to, cabin, program, date }) : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <Suspense fallback={<SearchFormSkeleton />}>
        <SearchForm initialValues={params} />
      </Suspense>
      <SearchResults results={results} />
    </main>
  );
}
```

### lib/search.ts: Shared data access function
```typescript
// lib/search.ts — mirrors lib/deals.ts pattern
// Source: lib/deals.ts existing pattern + src/flights/web-server.ts getCacheEntries usage
import { getDrizzle } from '@/src/flights/db-drizzle';
import { sql } from 'drizzle-orm';
import { enrichFlightResult, NON_BOOKABLE_SOURCES, type EnrichedDeal } from './enrichment';
import { POINTS_PROGRAMS, getTransferPartnersForProgram } from '@/src/flights/transfer-partners';

export interface SearchResultsParams {
  from: string;   // comma-separated or single airport
  to: string;
  cabin?: string;
  program?: string;
  date?: string;
}

export async function getSearchResults(params: SearchResultsParams): Promise<EnrichedDeal[]> {
  const origins = params.from.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const dests = params.to.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const cabin = params.cabin === 'any' ? null : (params.cabin || 'business');
  const programSlug = params.program || 'amex-mr';

  const db = getDrizzle();
  // Raw SQL: flight_cache is JSONB, not in Drizzle schema (same as getTopDeals)
  const result = await db.execute(
    sql`SELECT origin, destination, date, cabin, award_flights, updated_at
        FROM flight_cache
        WHERE origin = ANY(${origins})
        AND destination = ANY(${dests})
        ${cabin ? sql`AND cabin = ${cabin}` : sql``}
        ORDER BY updated_at DESC`,
  );

  const programInfo = POINTS_PROGRAMS.find(p => p.slug === programSlug) || POINTS_PROGRAMS[0];
  const partners = getTransferPartnersForProgram(programSlug);

  const rawFlights: Record<string, unknown>[] = [];
  let lastUpdated: string | null = null;

  for (const row of result.rows) {
    const flights = Array.isArray(row.award_flights) ? row.award_flights : [];
    for (const f of flights as Record<string, unknown>[]) {
      if (f.pointsRequired && (f.pointsRequired as number) > 0 && !NON_BOOKABLE_SOURCES.has(f.source as string)) {
        rawFlights.push({ ...f, scrapedAt: row.updated_at });
      }
    }
    if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
      lastUpdated = row.updated_at as string;
    }
  }

  const deals = rawFlights.map(f => enrichFlightResult(f, programSlug, partners, programInfo.name));
  deals.sort((a, b) => (b.cpp || 0) - (a.cpp || 0));

  return deals;
}
```

### Relative time formatting (no package needed)
```typescript
// lib/time.ts — built-in Intl API
// Source: MDN Intl.RelativeTimeFormat (HIGH confidence, built-in)
export function relativeTime(isoString: string): string {
  const diff = (new Date(isoString).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
// Usage: relativeTime(deal.scrapedAt) → "3 hours ago"
```

### Cash savings computation
```typescript
// In FlightResultCard — pure display computation
// cashPrice is in USD, points is integer, cpp is ¢/point
function cashSavings(deal: EnrichedDeal): number | null {
  if (!deal.cashPrice || !deal.cpp || !deal.points) return null;
  const valueOfPoints = (deal.points * deal.cpp) / 100; // in USD
  return Math.round(deal.cashPrice - valueOfPoints);
}
// Display: "Saves you $1,240 vs cash"
```

### Alliance coverage labels (static lookup from SCRAPER_REGISTRY)
```typescript
// lib/coverage.ts — static, computed at build time, no DB needed
// Source: SCRAPER_REGISTRY in src/flights/scrapers/index.ts
export const ALLIANCE_LABELS: Record<string, string> = {
  star: 'Star Alliance — covers United, ANA, Singapore, Lufthansa, Turkish, Air Canada',
  oneworld: 'oneworld — covers American, British Airways, JAL, Cathay, Qatar, Qantas',
  skyteam: 'SkyTeam — covers Air France/KLM, Delta, Korean Air',
};

export const SCRAPER_HEALTH_NOTICES: string[] = [
  'Star Alliance: Limited coverage (Aeroplan login blocked by Gigya reCAPTCHA)',
  'British Airways: Temporarily unavailable (Auth0 CAPTCHA blocks login)',
];
// These notices come from SCRAPER_REGISTRY status='blocked' entries
```

### Metro dedup toggle (Client Component Zustand pattern)
```typescript
// stores/search-store.ts
'use client';
import { create } from 'zustand';

interface SearchState {
  showAllAirports: boolean; // false = metro collapsed, true = show all
  setShowAllAirports: (v: boolean) => void;
}

export const useSearchStore = create<SearchState>()((set) => ({
  showAllAirports: false,
  setShowAllAirports: (v) => set({ showAllAirports: v }),
}));
```

```typescript
// In SearchResults Client Component:
const { showAllAirports } = useSearchStore();
const METRO_GROUPS = { JFK: 'JFK', LGA: 'JFK', EWR: 'JFK', NRT: 'NRT', HND: 'NRT', ... };

const filtered = showAllAirports ? results : results.filter((r, _i, arr) => {
  const rep = METRO_GROUPS[r.origin] || r.origin;
  return arr.findIndex(x => (METRO_GROUPS[x.origin] || x.origin) === rep) === results.indexOf(r);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `getServerSideProps` for search | RSC page with `await searchParams` | Next.js 13+ | No need for explicit SSR function; page auto-opts into dynamic rendering |
| `getStaticPaths` for route variants | No pre-generation needed | Next.js 13+ | Search routes are dynamic; no static generation |
| Express route handlers | Next.js Route Handlers (`route.ts`) | Phase 2 (established) | Express `api/index.ts` still exists for old HTML frontend fallback |
| `searchParams` as sync object | `searchParams` as Promise | Next.js 16 | Must `await searchParams` — this is the project's current version |
| `next build` (daemon tsc) | `next-build` copies to `next build --webpack` | Phase 2 decision | webpack chosen for `extensionAlias` NodeNext .js→.ts resolution |

**Deprecated/outdated:**
- Pages Router (`pages/api/*.ts`): Project uses App Router — do not create files in `pages/`
- `getServerSideProps`: Replaced by RSC + `searchParams` prop pattern
- Importing `monitor.ts` in Next.js: Established as forbidden in Phase 2 (transitive daemon imports)

---

## Open Questions

1. **Does `getCacheEntries` in db.ts filter by date?**
   - What we know: The Express handler in `web-server.ts` does NOT pass date to `getCacheEntries` — it returns all entries for the route/cabin pair, across all dates. Date filtering was done elsewhere.
   - What's unclear: Should `getSearchResults` filter by date client-side or add a SQL WHERE clause?
   - Recommendation: Filter post-enrichment in `getSearchResults` for simplicity. The flight_cache has `date` column — if needed, add `AND date >= ${date}` to the Drizzle raw SQL. The planner should decide: filter in SQL (fewer rows) or filter in JS (simpler code). Current volume is low enough that JS filter is fine.

2. **Airport autocomplete data source: static list or dynamic from DB?**
   - What we know: `src/flights/airports.ts` has static sets (US_AIRPORTS, EUROPE_AIRPORTS, etc.) with ~80 airports total. The DB has real routes in `flight_cache`.
   - What's unclear: Should autocomplete suggest only airports that have actual data, or all valid airports?
   - Recommendation: Start with the static airport sets from `airports.ts` — simpler, no DB call. Filter the combined set to ~100 IATA codes with city names added. A more dynamic approach (suggesting only airports with cached data) is better UX but a Phase 4 enhancement.

3. **Search form: standalone page vs. top-level nav change?**
   - What we know: Current app has `/deals` as the root (page.tsx redirects to /deals). Phase 3 adds `/search`.
   - What's unclear: Should the search form live at `/` (replacing redirect) or at `/search`? Should the deal feed page get a search bar added to it?
   - Recommendation: `/search` for the results page; add a prominent search bar to the `/deals` page header that links to `/search`. This is the established pattern (deals feed = discovery, search = intent). The planner should lay this out explicitly.

4. **Program selector on search form: all programs or just common ones?**
   - What we know: Phase 2's filter store has 5 program slugs. `POINTS_PROGRAMS` in transfer-partners.ts has more.
   - What's unclear: Should the search form's program dropdown be the same 5 as Phase 2 filters, or show all from `POINTS_PROGRAMS`?
   - Recommendation: Same 5 as Phase 2 filter store (amex-mr, chase-ur, citi-typ, capital-one, bilt). Keep in sync with `ProgramFilter` type.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` (only `workflow.research`, `workflow.plan_check`, `workflow.verifier` are defined). Treating as false — skipping Validation Architecture section.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/vercel/next.js` — Route Handler GET searchParams pattern (`request.nextUrl.searchParams`), RSC searchParams Promise prop, useSearchParams + Suspense requirement, router.push with createQueryString
- Codebase `lib/enrichment.ts` — `EnrichedDeal` type, `enrichFlightResult()`, `NON_BOOKABLE_SOURCES`, `matchSweetSpots()` — all fields needed by Phase 3 already exist
- Codebase `lib/deals.ts` — `getTopDeals()` pattern for DB reads using `getDrizzle()` + raw SQL — `getSearchResults()` should follow this exactly
- Codebase `src/flights/web-server.ts` — `getCacheEntries()` usage pattern, `enrichFlightResult()` call site, Express `/api/flights/search` to port
- Codebase `src/flights/live-scraper.ts` — `METRO_GROUPS` and `collapseToRepresentative()` — reuse for metro dedup toggle
- Codebase `src/flights/scrapers/index.ts` — `SCRAPER_REGISTRY` with `covers[]` and `status` fields for alliance labels and health notices
- Codebase `stores/filter-store.ts` — Zustand pattern established in Phase 2 to replicate for search-store
- Codebase `.planning/STATE.md` — Phase 2 decisions: webpack over Turbopack, `lib/enrichment.ts` pattern, monitor.ts import ban

### Secondary (MEDIUM confidence)
- WebSearch shadcn/ui combobox — confirmed: Popover + Command composition, no install needed if popover and command added via `shadcn add`
- MDN `Intl.RelativeTimeFormat` — HIGH (built-in API, no package needed, works in Node 16+ server-side)

### Tertiary (LOW confidence)
- None — all critical claims verified by Context7 or direct codebase inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed; verified against package.json
- Architecture: HIGH — patterns confirmed by Context7 Next.js docs and existing lib/deals.ts precedent in codebase
- Pitfalls: HIGH — pitfalls 1-4 verified by direct codebase inspection (Phase 2 decisions, db.ts API); pitfall 5-6 verified by reading web-server.ts source

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable — Next.js 16 is installed; no fast-moving dependencies)
