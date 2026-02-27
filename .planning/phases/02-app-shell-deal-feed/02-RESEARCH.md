# Phase 2: App Shell + Deal Feed - Research

**Researched:** 2026-02-27
**Domain:** Next.js 16 App Router, Tailwind v4, shadcn/ui, Zustand, Biome, Drizzle ORM reads, Vercel deployment
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEAL-01 | User can browse a global deal feed showing best current deals across all routes | RSC data fetch from `flight_cache` via Drizzle; enrichment logic ported from `web-server.ts`; top-N sort by CPP |
| DEAL-02 | Deal feed can be filtered by cabin class, region, and credit card program — updates without full page reload | Zustand store in Client Component filter bar; URL search params pattern for server/client sync |
| DEAL-03 | Deal feed highlights sweet spot matches with tier badges | `matchSweetSpots()` from existing `sweet-spots.ts` called server-side; shadcn/ui `Badge` component |
</phase_requirements>

---

## Summary

Phase 2 scaffolds the new Next.js 16 frontend and ships the deal feed page. The core technical work is: (1) bootstrapping the Next.js app inside the existing monorepo without breaking the daemon, (2) connecting the deal feed page to the existing `flight_cache` PostgreSQL table via Drizzle ORM (already wired in Phase 1), and (3) building a filter bar as a Client Component with Zustand state while the deal cards themselves render as React Server Components.

The existing codebase already has all the data logic needed: `matchSweetSpots()` in `sweet-spots.ts`, `enrichFlightResult()` in `web-server.ts`, and `getDrizzle()`/`getAllCacheEntries()` already exist. Phase 2 is primarily a UI build on top of proven data infrastructure — port the enrichment, wrap it in a Next.js RSC, add shadcn/ui cards and badges, and deploy.

The critical constraint is the **monorepo boundary**: the existing `tsconfig.json` uses `module: "NodeNext"` targeting the daemon. The Next.js app requires its own `tsconfig.json` in the `app/` directory (or `next.config.ts` paths override). The daemon's `src/` must not be imported from Next.js pages except for the three safe modules: `db-drizzle.ts`, `db-schema.ts`, and the domain logic files (`sweet-spots.ts`, `transfer-partners.ts`, `airports.ts`) which have no daemon-only dependencies.

**Primary recommendation:** Scaffold the Next.js app at repo root (`app/` dir, `next.config.ts`, separate `tsconfig.next.json`), install Tailwind v4 with `@tailwindcss/postcss`, initialize shadcn/ui with `npx shadcn@latest init`, and use Zustand for filter state. The deal feed page reads from `flight_cache` server-side via the existing Drizzle client.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.1.6 (latest) | App Router, RSC, API routes | Phase requirement — "Next.js 16 app deployed to Vercel" |
| react | ^19.x (bundled with Next 16) | UI rendering | Bundled with Next 16 |
| tailwindcss | ^4.x | Utility-first CSS | Phase requirement — "Tailwind v4" |
| @tailwindcss/postcss | ^4.x | PostCSS plugin for Tailwind v4 with Next.js | v4 no longer uses the `tailwindcss` PostCSS plugin directly |
| shadcn/ui | latest (CLI-based) | Component library | Phase requirement — "shadcn/ui components throughout" |
| zustand | ^5.x | Client-side filter state | Phase requirement — "Zustand state"; lightweight, no boilerplate |
| @biomejs/biome | ^2.x | Linter + formatter replacing ESLint | Phase requirement — "Biome" |
| drizzle-orm | ^0.45.1 (already installed) | Type-safe DB reads | Already installed; `getDrizzle()` ready in `db-drizzle.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-themes | ^0.4.x | Dark mode theme provider | Required for shadcn/ui dark mode; manages system preference + localStorage |
| tw-animate-css | latest | Tailwind v4 animation utilities | shadcn/ui v4 uses `tw-animate-css` — `tailwindcss-animate` is deprecated in v4 |
| sharp | ^0.34.5 (already installed) | Image optimization | Already in devDeps — Next.js Image component uses it |
| pg | ^8.13.1 (already installed) | DB connection for Drizzle pool | Existing dep; `getDrizzle()` uses it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | React useState + URL params | URL params alone work but are awkward for multi-filter UI; Zustand adds 1KB and makes filter state trivially composable |
| Zustand | Jotai / Valtio | Zustand is explicitly required in ROADMAP plan 02-03; Jotai has more ceremony for simple filters |
| shadcn/ui | Radix primitives directly | shadcn/ui wraps Radix with pre-built accessible components; saves significant time |
| Biome | ESLint + Prettier | Next.js 16 `create-next-app` now supports Biome as a first-class linter option; it's faster and the phase requires it |

**Installation (for new Next.js app):**
```bash
# Scaffold (from repo root — answers: TypeScript yes, Biome yes, Tailwind yes, src/ no, App Router yes)
npx create-next-app@latest . --typescript --no-eslint --tailwind --app --no-src-dir --import-alias "@/*"

# Tailwind v4 PostCSS plugin (create-next-app may not set this up correctly for v4)
npm install tailwindcss @tailwindcss/postcss postcss

# shadcn/ui init (must run after Next.js scaffold + Tailwind)
npx shadcn@latest init

# Add specific components needed for Phase 2
npx shadcn@latest add badge card select button

# next-themes for dark mode
npm install next-themes

# Biome (if not installed by create-next-app)
npm install -D @biomejs/biome
npx @biomejs/biome init

# tw-animate-css (shadcn/ui v4 animation dependency)
npm install tw-animate-css
```

---

## Architecture Patterns

### Recommended Project Structure
```
/                             # repo root (existing)
├── app/                      # NEW: Next.js App Router (Vercel)
│   ├── layout.tsx            # Root layout — dark theme, ThemeProvider
│   ├── globals.css           # @import "tailwindcss"; CSS variables
│   ├── page.tsx              # Redirect → /deals
│   ├── deals/
│   │   ├── page.tsx          # RSC: fetches flight_cache, renders DealFeed
│   │   └── loading.tsx       # Suspense skeleton for deals
│   └── api/                  # Route handlers (Phase 3+)
├── components/               # NEW: shadcn/ui + custom components
│   ├── ui/                   # shadcn/ui generated files (Badge, Card, Select, Button)
│   ├── deal-card.tsx         # DealCard — RSC, receives enriched FlightResult
│   ├── deal-feed.tsx         # DealFeed — RSC, grid of DealCards
│   └── filter-bar.tsx        # FilterBar — 'use client', Zustand store
├── lib/                      # NEW: shared utilities for Next.js
│   ├── deals.ts              # getTopDeals() — Drizzle query + enrichment logic
│   ├── enrichment.ts         # Port of enrichFlightResult() from web-server.ts
│   └── utils.ts              # cn() helper (shadcn/ui standard)
├── stores/                   # NEW: Zustand stores
│   └── filter-store.ts       # useDealFilterStore — cabin, region, program state
├── src/flights/              # EXISTING: daemon code (DO NOT import from app/)
│   ├── db-drizzle.ts         # Safe to import from app/ (Drizzle client)
│   ├── db-schema.ts          # Safe to import from app/ (schema types)
│   ├── sweet-spots.ts        # Safe to import from app/ (no daemon deps)
│   ├── transfer-partners.ts  # Safe to import from app/ (no daemon deps)
│   └── airports.ts           # Safe to import from app/ (no daemon deps)
├── next.config.ts            # NEW: Next.js config
├── postcss.config.mjs        # NEW: @tailwindcss/postcss plugin
├── biome.json                # NEW: Biome config
├── tsconfig.json             # EXISTING: daemon tsconfig (NodeNext, rootDir: src)
└── tsconfig.next.json        # NEW or vercel-only: Next.js tsconfig (ES2022, module: ESNext)
```

### Pattern 1: RSC Deal Feed with Server-Side Data Fetch
**What:** The `/deals` page is an async Server Component that fetches from `flight_cache` directly via Drizzle. No API route needed for initial render — data is fetched on the server and rendered as HTML.

**When to use:** Whenever data doesn't need real-time updates and can be fetched at request time (or statically cached).

```typescript
// app/deals/page.tsx
// Source: Next.js v16 docs — RSC with ORM
import { getTopDeals } from '@/lib/deals'
import { DealFeed } from '@/components/deal-feed'
import { FilterBar } from '@/components/filter-bar'

export default async function DealsPage() {
  const deals = await getTopDeals({ limit: 50 })
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Best Award Deals</h1>
      <FilterBar />
      <DealFeed deals={deals} />
    </main>
  )
}
```

```typescript
// lib/deals.ts — server-only data access
import { getDrizzle } from '@/src/flights/db-drizzle'
// flight_cache table is accessed via raw SQL (it's JSONB, not in Drizzle schema)
// Use getDrizzle().execute() for raw queries or import from db.ts pattern

export async function getTopDeals({ limit = 50 }: { limit?: number } = {}) {
  // flight_cache stores award_flights as JSONB array — query all entries
  // then flatten, enrich, filter, sort by CPP desc
  // See web-server.ts getAllCacheEntries() for the raw pg pattern
  // Port enrichFlightResult() from web-server.ts → lib/enrichment.ts
}
```

**Key insight:** `flight_cache` table has `award_flights` as a JSONB column (not in Drizzle schema). The existing `getAllCacheEntries()` function in `db.ts` returns all rows. For the Next.js app, replicate this via `getDrizzle()` using a raw SQL execute call, or import the lightweight pure logic from `sweet-spots.ts`/`transfer-partners.ts` and run the enrichment server-side.

### Pattern 2: Zustand Filter Store for Client-Side Filtering
**What:** Filter bar is a Client Component with Zustand state. When filters change, the deal list re-filters in the browser (no server round-trip). The deals data is passed down from the RSC as a prop and the Client Component filters it client-side.

**When to use:** Fast filter UX where data is already fetched — avoid re-fetching for every filter change.

```typescript
// stores/filter-store.ts
// Source: Zustand v5 docs — create with TypeScript
'use client'
import { create } from 'zustand'

export type CabinFilter = 'all' | 'economy' | 'business' | 'first'
export type RegionFilter = 'all' | 'transatlantic' | 'transpacific' | 'asia' | 'europe' | 'middle-east'
export type ProgramFilter = 'all' | 'amex-mr' | 'chase-ur' | 'citi-typ' | 'capital-one' | 'bilt'

interface DealFilterState {
  cabin: CabinFilter
  region: RegionFilter
  program: ProgramFilter
  setCabin: (cabin: CabinFilter) => void
  setRegion: (region: RegionFilter) => void
  setProgram: (program: ProgramFilter) => void
}

export const useDealFilterStore = create<DealFilterState>()((set) => ({
  cabin: 'all',
  region: 'all',
  program: 'all',
  setCabin: (cabin) => set({ cabin }),
  setRegion: (region) => set({ region }),
  setProgram: (program) => set({ program }),
}))
```

```typescript
// components/filter-bar.tsx
'use client'
import { useDealFilterStore } from '@/stores/filter-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function FilterBar() {
  const { cabin, region, program, setCabin, setRegion, setProgram } = useDealFilterStore()
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <Select value={cabin} onValueChange={setCabin}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Cabin" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Cabins</SelectItem>
          <SelectItem value="economy">Economy</SelectItem>
          <SelectItem value="business">Business</SelectItem>
          <SelectItem value="first">First</SelectItem>
        </SelectContent>
      </Select>
      {/* Region and Program selects follow same pattern */}
    </div>
  )
}
```

### Pattern 3: Client-Side Deal Feed Filtering (RSC + Client Islands)
**What:** Pass the full deals array from the RSC to a Client Component wrapper. The wrapper reads Zustand state and filters the deals array in the browser. No `use server` actions needed for filter changes.

```typescript
// components/deal-feed.tsx — Client Component that owns filtering
'use client'
import { useDealFilterStore } from '@/stores/filter-store'
import { DealCard } from './deal-card'
import type { EnrichedDeal } from '@/lib/deals'

export function DealFeed({ deals }: { deals: EnrichedDeal[] }) {
  const { cabin, region, program } = useDealFilterStore()

  const filtered = deals.filter(deal => {
    if (cabin !== 'all' && deal.cabin !== cabin) return false
    if (region !== 'all' && deal.region !== region) return false
    if (program !== 'all' && !deal.transferFrom.includes(program)) return false
    return true
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {filtered.map(deal => <DealCard key={deal.id} deal={deal} />)}
    </div>
  )
}
```

### Pattern 4: DealCard with Sweet Spot Badge
**What:** Each deal card shows airline, route, cabin, points, CPP, and an optional S/A/B tier badge from `matchSweetSpots()`.

```typescript
// components/deal-card.tsx
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { matchSweetSpots } from '@/src/flights/sweet-spots'
import type { EnrichedDeal } from '@/lib/deals'

const TIER_COLORS = {
  S: 'bg-amber-500 text-black',     // Gold — "Holy Grail"
  A: 'bg-emerald-600 text-white',   // Green — "Excellent"
  B: 'bg-blue-600 text-white',      // Blue — "Great"
}

const TIER_LABELS = {
  S: 'S-Tier: Holy Grail',
  A: 'A-Tier: Excellent',
  B: 'B-Tier: Great',
}

export function DealCard({ deal }: { deal: EnrichedDeal }) {
  const sweetSpots = matchSweetSpots(deal.origin, deal.destination, deal.cabin)
  const topSpot = sweetSpots[0]
  return (
    <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-600 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">{deal.airline}</span>
          {topSpot && (
            <Badge className={TIER_COLORS[topSpot.tier]}>
              {TIER_LABELS[topSpot.tier]}
            </Badge>
          )}
        </div>
        <div className="text-xl font-bold">{deal.origin} → {deal.destination}</div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-end">
          <div>
            <div className="text-2xl font-bold text-amber-400">
              {deal.pointsRequired.toLocaleString()} pts
            </div>
            <div className="text-sm text-zinc-400 capitalize">{deal.cabin}</div>
          </div>
          {deal.cpp && (
            <div className="text-right">
              <div className="text-lg font-semibold text-emerald-400">{deal.cpp}¢/pt</div>
              <div className="text-xs text-zinc-500">CPP</div>
            </div>
          )}
        </div>
        <div className="mt-3 text-xs text-zinc-500">{deal.departureDate}</div>
      </CardContent>
    </Card>
  )
}
```

### Pattern 5: Dark Theme Setup (Root Layout + next-themes)
**What:** Root layout wraps app in `ThemeProvider` from `next-themes`. Dark mode is the default. shadcn/ui components use CSS variables that respect the `.dark` class.

```typescript
// app/layout.tsx
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flight Points — Award Deal Feed',
  description: 'Find the best award flight deals across all loyalty programs',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

```css
/* app/globals.css — Tailwind v4 */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: oklch(0.145 0 0);  /* zinc-950 */
  --color-foreground: oklch(0.985 0 0);  /* near-white */
  --color-card: oklch(0.205 0 0);        /* zinc-900 */
  --color-border: oklch(0.269 0 0);      /* zinc-800 */
  --color-primary: oklch(0.769 0.188 70.08);  /* amber-400 — warm gold */
  --color-muted: oklch(0.556 0 0);       /* zinc-500 */
}
```

### Pattern 6: Next.js + Existing Daemon Monorepo Boundary
**What:** Two separate TypeScript contexts in the same repo. The existing `tsconfig.json` covers `src/` (daemon). Next.js needs its own TS config that excludes daemon code.

```json
// tsconfig.next.json (or let create-next-app generate tsconfig.json and rename existing one)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }],
    "baseUrl": "."
  },
  "include": ["app/**/*", "components/**/*", "lib/**/*", "stores/**/*",
              "src/flights/db-drizzle.ts", "src/flights/db-schema.ts",
              "src/flights/sweet-spots.ts", "src/flights/transfer-partners.ts",
              "src/flights/airports.ts", "src/flights/types.ts"],
  "exclude": ["src/flights/flight-daemon.ts", "src/flights/scrapers/**/*",
              "src/flights/monitor.ts", "node_modules"]
}
```

**Key:** `next.config.ts` must point to `tsconfig.next.json`:
```typescript
// next.config.ts
import type { NextConfig } from 'next'
const config: NextConfig = {
  typescript: { tsconfigPath: './tsconfig.next.json' },
  experimental: { reactCompiler: false },
}
export default config
```

### Pattern 7: Vercel Deployment Config
**What:** Replace existing static `vercel.json` with Next.js framework config. The existing `vercel-build` script copies static HTML to `public/` — this conflicts with Next.js. The new Vercel deployment detects Next.js automatically.

```json
// vercel.json (new — Next.js aware)
{
  "framework": "nextjs",
  "buildCommand": "next build",
  "outputDirectory": ".next",
  "installCommand": "npm install"
}
```

**CRITICAL:** The existing `vercel-build` script (`mkdir -p public && cp web/public/* public/`) **must be removed or renamed** so Vercel doesn't run it instead of `next build`. Vercel auto-detects Next.js when `app/` dir exists — this overrides manual `buildCommand` in most cases. The existing static HTML in `web/public/` will no longer be served through Vercel (the Express daemon server at Harbor still serves it locally).

### Anti-Patterns to Avoid
- **Importing daemon modules in app/**: Never import from `flight-daemon.ts`, `scrapers/`, `web-server.ts`, or `monitor.ts` in the Next.js app. These pull in Camoufox/Playwright/Python subprocess dependencies that crash Vercel builds.
- **Using `getAllCacheEntries()` from db.ts in Next.js**: `db.ts` calls `initPool()` with a global singleton that breaks in serverless. Use `getDrizzle()` from `db-drizzle.ts` which creates its own pool with `max: 5`.
- **Keeping the old vercel.json framework config**: The existing `vercel.json` has `"framework": null` and a custom `buildCommand`. With a Next.js app at root, Vercel will auto-detect — explicitly set `"framework": "nextjs"` to avoid ambiguity.
- **Running `create-next-app` in a subdirectory**: The plan says "App Router at repo root." If you run it in a subdirectory, Vercel deployment path needs to be configured with `rootDirectory`. Simpler to keep it at root.
- **Tailwind v3 + v4 mismatch**: shadcn/ui now defaults to Tailwind v4 for new projects. `tailwindcss-animate` is deprecated in v4 — use `tw-animate-css` instead. Don't install both.
- **Forgetting `suppressHydrationWarning`**: next-themes changes the `class` attribute on `<html>` during hydration. Without `suppressHydrationWarning` on `<html>`, React will throw a hydration mismatch error in development.
- **`module: "NodeNext"` in Next.js tsconfig**: The daemon tsconfig uses `NodeNext` for ES module resolution. Next.js requires `"moduleResolution": "Bundler"` (or `"Bundler"`) — using `NodeNext` in the Next.js tsconfig will cause import resolution failures on `@/` aliases.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dark mode toggle + system pref | Custom `useTheme` hook with localStorage | `next-themes` | Handles SSR flash, system preference, class vs data-theme attribute |
| Filter UI selects | Raw `<select>` elements | shadcn/ui `Select` | Radix-based, accessible, keyboard navigable, styled to dark theme |
| Sweet spot badge rendering | Custom tier badge logic | `matchSweetSpots()` from existing `sweet-spots.ts` | Already works; has full route matching with wildcard origin support |
| Result enrichment | Rewrite from scratch | Port `enrichFlightResult()` from `web-server.ts` | Working logic — convert to pure function, no Express dep |
| DB access on Vercel | New pool setup | `getDrizzle()` from `db-drizzle.ts` | Already built in Phase 1 with correct max:5 for serverless |
| TypeScript formatting | Custom ESLint config | Biome with `npx @biomejs/biome init` | One config, one tool, much faster than ESLint + Prettier |
| Region classification | Custom airport→region map | `isTransatlantic()`, `isToAsia()`, `REGION_LABELS` from existing `airports.ts` | Already built for the daemon |
| Hydration-safe theme | Manual localStorage check | `suppressHydrationWarning` on `<html>` + `next-themes` | next-themes handles FOUC |

**Key insight:** The daemon codebase has well-tested domain logic (enrichment, sweet spot matching, region classification, transfer partner mapping). Phase 2's job is to surface this logic in a Next.js RSC, not to rewrite it. Import the pure business logic modules directly from `src/flights/` — they have no daemon-only dependencies.

---

## Common Pitfalls

### Pitfall 1: `flight_cache` JSONB column not in Drizzle schema
**What goes wrong:** `getDrizzle()` gives you a typed Drizzle client, but `flight_cache` is defined in `db.ts` with raw SQL queries — it's NOT in `db-schema.ts`. Trying to do `db.select().from(flightCache)` will fail because the table isn't in the schema.
**Why it happens:** Phase 1 added `price_history` and `alert_subscriptions` to Drizzle schema, but `flight_cache` was a pre-existing table using JSONB blobs — the wrong pattern for Drizzle typed queries.
**How to avoid:** Use `getDrizzle().execute(sql`SELECT * FROM flight_cache ORDER BY updated_at DESC`)` for raw SQL via Drizzle, OR just import the pg pool pattern. The cleanest approach: create a thin `lib/deals.ts` that uses `getDrizzle().execute()` with a raw SQL query, then enriches results.
**Warning signs:** TypeScript error "Property 'flightCache' does not exist on type..." when trying to query.

```typescript
// lib/deals.ts — correct approach for flight_cache
import { getDrizzle } from '@/src/flights/db-drizzle'
import { sql } from 'drizzle-orm'

export async function getRawCacheEntries() {
  const db = getDrizzle()
  const result = await db.execute(
    sql`SELECT origin, destination, date, cabin, award_flights, updated_at
        FROM flight_cache
        ORDER BY updated_at DESC
        LIMIT 200`
  )
  return result.rows
}
```

### Pitfall 2: `create-next-app` installs Tailwind v3 when v4 is needed
**What goes wrong:** `create-next-app@latest` may scaffold with Tailwind v3 depending on the template version. shadcn/ui v4 components expect Tailwind v4 CSS variable format (`@theme inline`, OKLCH colors, `tw-animate-css`).
**Why it happens:** The Next.js Tailwind template lags slightly behind the latest Tailwind release.
**How to avoid:** After `create-next-app`, check `package.json`. If Tailwind v3 is installed, upgrade: `npm install tailwindcss@latest @tailwindcss/postcss postcss`. Then replace `tailwind.config.ts` with a `postcss.config.mjs` using the `@tailwindcss/postcss` plugin. Update `globals.css` to use `@import "tailwindcss"` instead of the three `@tailwind` directives.
**Warning signs:** `tailwind.config.ts` at project root; `postcss.config.mjs` still using `require('tailwindcss')`.

### Pitfall 3: Zustand store initialized on every server request (Next.js RSC context)
**What goes wrong:** If `useDealFilterStore` is called in a Server Component or the store is module-level with side effects, Next.js may error or create unexpected behavior.
**Why it happens:** Zustand's `create()` is fine as a module-level call in client components, but calling hooks in RSC context throws.
**How to avoid:** Keep the Zustand store in a file with `'use client'` at the top (or import it only from client components). The `DealFeed` and `FilterBar` components must both have `'use client'`. The `page.tsx` RSC passes the initial `deals` array as a prop and doesn't touch Zustand.
**Warning signs:** "Cannot use hooks in Server Component" error; store state resetting between navigations.

### Pitfall 4: `vercel.json` conflict with old static build
**What goes wrong:** Existing `vercel.json` has `"framework": null` and `"buildCommand": "npm run vercel-build"` which copies static HTML. When Next.js `app/` dir is added, Vercel detects both and may use the wrong build command.
**Why it happens:** Vercel's framework detection is based on the presence of `next.config.*` AND the `vercel.json` settings — when they conflict, behavior is undefined.
**How to avoid:** Update `vercel.json` to `"framework": "nextjs"` and `"buildCommand": "next build"`. Remove or rename the `vercel-build` npm script (or keep it for local reference but don't have Vercel call it). Verify in Vercel dashboard that "Framework Preset" shows "Next.js" after the first deployment.
**Warning signs:** Vercel builds succeed but serve the old static HTML instead of the Next.js app.

### Pitfall 5: TSConfig conflict between daemon (NodeNext) and Next.js (Bundler)
**What goes wrong:** `tsconfig.json` at repo root uses `"module": "NodeNext"` and `"rootDir": "./src"`. `create-next-app` expects to generate a `tsconfig.json` at root with `"module": "ESNext"` and `"moduleResolution": "Bundler"`. If you let `create-next-app` overwrite the existing `tsconfig.json`, the daemon breaks.
**Why it happens:** Both the daemon and Next.js want to own `tsconfig.json` at the repo root.
**How to avoid:** Preserve the existing `tsconfig.json` for the daemon. Have `create-next-app` generate a `tsconfig.next.json`. Tell `next.config.ts` to use it via `typescript: { tsconfigPath: './tsconfig.next.json' }`. The `include` array in `tsconfig.next.json` explicitly lists which `src/flights/` files are safe to import.
**Warning signs:** `tsc` errors in daemon code after running `create-next-app`; missing `.js` extension errors in Next.js imports.

### Pitfall 6: `suppressHydrationWarning` missing on `<html>`
**What goes wrong:** `next-themes` switches the theme class on the `<html>` element during hydration. React sees a mismatch between server-rendered HTML (no class) and client-hydrated HTML (class="dark") and throws a hydration error.
**Why it happens:** This is a known and expected behavior with `next-themes` — the server can't know the user's theme preference.
**How to avoid:** Always add `suppressHydrationWarning` to the `<html>` element in `app/layout.tsx`. This is documented in the next-themes README as required.
**Warning signs:** Console error "Warning: Prop `className` did not match" in development mode.

---

## Code Examples

Verified patterns from official sources:

### Next.js RSC + Drizzle ORM data fetch
```typescript
// Source: Next.js v16 docs — https://nextjs.org/docs/app/getting-started/fetching-data
// app/deals/page.tsx
import { getTopDeals } from '@/lib/deals'
import { DealFeed } from '@/components/deal-feed'
import { FilterBar } from '@/components/filter-bar'

export default async function DealsPage() {
  const deals = await getTopDeals()
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Award Deal Feed</h1>
        <p className="text-zinc-400 mb-6">Best current award deals across all programs</p>
        <FilterBar />
        <DealFeed initialDeals={deals} />
      </div>
    </main>
  )
}
```

### Zustand store for Next.js App Router (Context Provider pattern)
```typescript
// Source: Zustand docs — https://github.com/pmndrs/zustand/blob/main/docs/guides/nextjs.md
// For simple global filter state, direct create() is sufficient (no per-request isolation needed)
// stores/filter-store.ts
'use client'
import { create } from 'zustand'

export const useDealFilterStore = create<{
  cabin: string; region: string; program: string
  setCabin: (v: string) => void
  setRegion: (v: string) => void
  setProgram: (v: string) => void
}>()((set) => ({
  cabin: 'all', region: 'all', program: 'all',
  setCabin: (cabin) => set({ cabin }),
  setRegion: (region) => set({ region }),
  setProgram: (program) => set({ program }),
}))
```

### Biome configuration for the project
```json
// biome.json — Source: Biome docs
{
  "$schema": "https://biomejs.dev/schemas/2.2.4/schema.json",
  "root": true,
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts",
                 "components/**/*.tsx", "lib/**/*.ts", "stores/**/*.ts"],
    "ignore": ["**/node_modules/**", "**/.next/**", "**/dist/**"]
  },
  "formatter": {
    "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": { "noUnusedVariables": "error", "noUnusedImports": "error" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "trailingCommas": "all", "semicolons": "always" }
  }
}
```

### shadcn/ui Badge usage for tier display
```typescript
// Source: shadcn/ui docs — badge component
import { Badge } from '@/components/ui/badge'

// Variant styling via className override (shadcn/ui allows full Tailwind override)
<Badge className="bg-amber-500 text-black font-bold">S-Tier: Holy Grail</Badge>
<Badge className="bg-emerald-600 text-white">A-Tier: Excellent</Badge>
<Badge className="bg-blue-600 text-white">B-Tier: Great</Badge>
```

### Tailwind v4 + Next.js PostCSS config
```javascript
// postcss.config.mjs — Source: Tailwind v4 Next.js docs
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
export default config
```

```css
/* app/globals.css */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --radius: 0.625rem;
  --color-background: oklch(0.145 0 0);
  --color-foreground: oklch(0.985 0 0);
  --color-card: oklch(0.205 0 0);
  --color-border: oklch(0.269 0 0);
  --color-primary: oklch(0.769 0.188 70.08);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 PostCSS (`require('tailwindcss')`) | `@tailwindcss/postcss` plugin, `@import "tailwindcss"` | Tailwind v4 (2025) | No `tailwind.config.ts` needed; CSS-first config |
| `tailwindcss-animate` | `tw-animate-css` | shadcn/ui v4 migration (2025) | Drop-in replacement; CSS-native |
| NextAuth v5 | Better Auth | Phase 1 locked decision | Phase 6 concern — tables already exist |
| ESLint + Prettier | Biome | Next.js 16 now offers Biome as first-class option | Single tool, ~10x faster |
| `pages/` directory router | App Router (`app/` dir) | Next.js 13+ | RSC, streaming, layouts, better caching |
| `getServerSideProps` | Async RSC component | Next.js 13+ | No boilerplate — just async functions |
| shadcn/ui `default` style | `new-york` style | shadcn/ui v4 migration | New projects should use `new-york`; `default` being phased out |
| `forwardRef` in components | `data-slot` attributes | shadcn/ui v4 | React 19 removed need for `forwardRef` on DOM elements |

**Deprecated/outdated:**
- `tailwind.config.ts`: In Tailwind v4, configuration moves to `globals.css` using `@theme` — no JS config file needed for most cases.
- `tailwindcss-animate`: Replaced by `tw-animate-css` in shadcn/ui v4.
- `pages/` router: All new Next.js work uses App Router.

---

## Open Questions

1. **Whether to use the existing `pg` pool or Drizzle execute for `flight_cache` reads**
   - What we know: `flight_cache` table has a JSONB `award_flights` column; it's NOT in `db-schema.ts`. Drizzle's typed API can't query it without adding it to the schema.
   - What's unclear: Should we add `flight_cache` to Drizzle schema (as a JSONB table), or use `getDrizzle().execute(rawSql)` for untyped queries?
   - Recommendation: Use `getDrizzle().execute(sql\`SELECT ...\`)` with the `sql` template tag from `drizzle-orm`. This avoids schema churn and keeps `db-schema.ts` clean. The raw SQL query is simple (SELECT + ORDER BY + LIMIT). Adding a full Drizzle table definition for a JSONB blob table would give us type safety on the outer row but not on the JSONB contents anyway.

2. **Whether to add `flight_cache` results or `price_history` rows to the deal feed**
   - What we know: `flight_cache` has current/recent award availability (JSONB). `price_history` has per-flight historical rows but may still be sparse (Phase 1 just started writing).
   - What's unclear: Is `price_history` populated enough to be the primary source for the deal feed?
   - Recommendation: Use `flight_cache` as the primary source for Phase 2 — it's the same data the existing Express server uses, and it's already populated. `price_history` becomes relevant in Phase 4 for trend charts. The deal feed in Phase 2 reads `flight_cache`, not `price_history`.

3. **Region filter implementation — what "region" means for filtering**
   - What we know: `airports.ts` has `isTransatlantic()`, `isToAsia()`, `REGION_LABELS`. Sweet spots have `destinationRegion` fields ('Europe', 'Japan', 'Middle East', etc.).
   - What's unclear: For the filter bar, should "region" filter by destination airport (using `airports.ts` sets) or by sweet spot region labels?
   - Recommendation: Filter by destination airport using the existing `airports.ts` region functions (`isTransatlantic`, `isToAsia`, etc.). This is consistent with how the daemon already classifies routes. Map the filter values to the existing functions: `transatlantic` → `isTransatlantic(dest)`, `asia` → `isToAsia(dest)`, etc.

4. **Whether to add `price_history` to `flight_cache` Drizzle schema vs raw SQL**
   - Already resolved above in question 1.

5. **Route for the deal feed — `/` or `/deals`**
   - What we know: Current `vercel.json` redirects `/` → `/flights.html`. New app needs a home page.
   - What's unclear: Should the deal feed be the home page (`/`) or a sub-route (`/deals`)?
   - Recommendation: Make `/deals` the deal feed page. Set `app/page.tsx` to redirect to `/deals`. This keeps the routing clean and aligns with the ROADMAP (Phase 3 adds search at a different route). Changing home to `/deals` also avoids URL conflicts with any legacy Vercel deployments referencing `/flights`.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` (key absent) — treating as false. Skip validation section.

No formal test framework is required per the project's testing convention (standalone `tsx` test scripts in `tests/`). Phase 2 is UI-focused — validation is manual/visual (deploy to Vercel, verify deal cards render, filters work).

The existing project convention is: `tsx tests/test-<name>.ts` for scraper regression tests. No Jest/Vitest/Playwright test framework is installed. Phase 2 should follow the same convention if any automated checks are added.

---

## Sources

### Primary (HIGH confidence)
- Next.js v16.1.6 official docs (via Context7 /vercel/next.js/v16.1.6) — App Router setup, RSC data fetching, `create-next-app` prompts including Biome option
- Next.js v16 installation docs (https://nextjs.org/docs/app/getting-started/installation) — confirmed version 16.1.6, Biome as first-class linter option, Turbopack default
- shadcn/ui official docs (via Context7 /shadcn-ui/ui) — installation, `npx shadcn@latest init`, Badge/Card/Select components, Tailwind v4 compatibility
- Tailwind v4 Next.js docs (https://tailwindcss.com/docs/installation/framework-guides/nextjs) — `@tailwindcss/postcss` plugin, `@import "tailwindcss"`, PostCSS config
- Zustand docs (via Context7 /pmndrs/zustand) — `create()` API, Next.js App Router integration pattern, TypeScript store definition
- Biome docs (via Context7 /biomejs/biome) — `biome.json` schema, `npx @biomejs/biome init`, VS Code integration
- Project codebase: `src/flights/db-drizzle.ts`, `src/flights/db.ts`, `src/flights/web-server.ts`, `src/flights/sweet-spots.ts`, `src/flights/transfer-partners.ts`, `src/flights/airports.ts` — all existing domain logic available for import

### Secondary (MEDIUM confidence)
- shadcn/ui Tailwind v4 migration docs (https://ui.shadcn.com/docs/tailwind-v4) — confirmed `tw-animate-css` replacing `tailwindcss-animate`, `new-york` style as default, `@theme inline`, OKLCH colors, `data-slot` replacing `forwardRef`
- Tailwind v4 Vite docs (https://tailwindcss.com/docs/installation/using-vite) — confirmed single `@import "tailwindcss"` pattern, class-based dark mode

### Tertiary (LOW confidence)
- Next.js TSConfig `typescript.tsconfigPath` option — verified pattern exists in Next.js docs but exact behavior with two tsconfig files in same monorepo was not confirmed via official source. Validate by running `next build` after setup.
- Vercel `framework: "nextjs"` auto-detection with existing `vercel.json` — confirm in Vercel dashboard after first deployment.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Next.js 16, Tailwind v4, shadcn/ui, Zustand, Biome all verified against current official docs and Context7. Versions confirmed.
- Architecture: HIGH — RSC + Client Component island pattern is Next.js standard. Monorepo boundary concern is based on direct reading of existing `tsconfig.json` and `db-drizzle.ts`. Flight_cache JSONB limitation verified by reading existing schema files.
- Pitfalls: MEDIUM-HIGH — Most pitfalls derived from direct code inspection (existing tsconfig conflict, JSONB table not in Drizzle schema, vercel.json conflict). shadcn/ui v4 breaking changes verified against official migration docs.

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — Next.js 16 is current stable; shadcn/ui v4 just stabilized; Tailwind v4 is GA)
