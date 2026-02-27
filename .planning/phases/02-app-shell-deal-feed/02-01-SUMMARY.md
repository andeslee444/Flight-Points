---
phase: 02-app-shell-deal-feed
plan: 01
subsystem: ui
tags: [nextjs, react, tailwind, shadcn, biome, vercel, monorepo]

# Dependency graph
requires:
  - phase: 01-database-foundation
    provides: db-drizzle.ts getDrizzle() for Vercel-safe DB reads; db-schema.ts types
provides:
  - Next.js 16 App Router scaffold at repo root with dark theme
  - Tailwind v4 CSS with OKLCH variables in app/globals.css
  - shadcn/ui Badge, Card, Select, Button components in components/ui/
  - /deals placeholder page rendering on Vercel
  - Monorepo boundary: tsconfig.daemon.json (daemon), tsconfig.json (Next.js)
  - biome.json linter/formatter for Next.js files
affects: [02-02, 02-03, all future Next.js phases]

# Tech tracking
tech-stack:
  added:
    - next@16.1.6 (App Router, Turbopack, RSC)
    - react@19.x + react-dom@19.x
    - tailwindcss@4.x + @tailwindcss/postcss (CSS-first config, no tailwind.config.ts)
    - tw-animate-css (replaces tailwindcss-animate in shadcn/ui v4)
    - shadcn/ui (new-york style, radix-ui, class-variance-authority, lucide-react)
    - next-themes@0.4.x (dark mode provider, suppressHydrationWarning pattern)
    - zustand@5.x (installed for Plan 02 filter state)
    - @biomejs/biome@2.x (linter + formatter replacing ESLint)
    - clsx + tailwind-merge (cn() helper)
  patterns:
    - Next.js App Router at repo root with app/ directory
    - Tailwind v4 CSS-first config via @theme inline in globals.css (no tailwind.config.ts)
    - shadcn/ui new-york style with OKLCH colors and data-slot attributes (React 19, no forwardRef)
    - Monorepo boundary: two tsconfig files (tsconfig.json for Next.js, tsconfig.daemon.json for daemon)
    - Dark-first theme: ThemeProvider defaultTheme="dark", suppressHydrationWarning on <html>

key-files:
  created:
    - app/layout.tsx (root layout with ThemeProvider dark theme)
    - app/page.tsx (redirect to /deals)
    - app/deals/page.tsx (placeholder deal feed page)
    - app/deals/loading.tsx (Suspense skeleton)
    - app/globals.css (Tailwind v4 @theme inline with OKLCH dark variables)
    - components/ui/badge.tsx (shadcn/ui Badge)
    - components/ui/card.tsx (shadcn/ui Card)
    - components/ui/select.tsx (shadcn/ui Select)
    - components/ui/button.tsx (shadcn/ui Button)
    - lib/utils.ts (cn() helper with clsx + tailwind-merge)
    - next.config.ts (Next.js config, no tsconfigPath needed)
    - postcss.config.mjs (@tailwindcss/postcss plugin)
    - biome.json (Biome linter/formatter for app/, components/, lib/, stores/)
    - components.json (shadcn/ui config: new-york style, zinc base, CSS variables)
    - tsconfig.daemon.json (preserved original daemon TypeScript config)
  modified:
    - tsconfig.json (replaced with Next.js config: moduleResolution bundler, jsx react-jsx, explicit excludes)
    - package.json (build → tsc -p tsconfig.daemon.json; added next-dev, next-build scripts; installed 10+ new deps)
    - vercel.json (framework: nextjs, buildCommand: next build)
    - .gitignore (added .next/, next-env.d.ts)

key-decisions:
  - "tsconfig.json is now the Next.js tsconfig (moduleResolution: bundler); daemon uses tsconfig.daemon.json via -p flag"
  - "monitor.ts excluded from Next.js tsconfig — it transitively imports scrapers with pre-existing type errors"
  - "vercel.json explicitly sets buildCommand: next build to prevent Vercel from running npm run build (daemon tsc)"
  - "shadcn/ui installed with components.json pre-created (non-interactive) instead of shadcn init prompts"
  - "Pre-existing TypeScript errors in cathay.ts and korean-air.ts are deferred — they existed before this plan"

patterns-established:
  - "Pattern: Next.js tsconfig excludes all of src/flights/scrapers, flight-daemon, web-server, monitor, live-scraper"
  - "Pattern: Vercel deployment uses explicit buildCommand: next build in vercel.json"
  - "Pattern: shadcn/ui components use data-slot attributes (React 19 pattern, no forwardRef)"
  - "Pattern: Tailwind v4 dark theme via CSS @custom-variant dark (&:is(.dark *)) + ThemeProvider"

requirements-completed: [DEAL-01]

# Metrics
duration: 10min
completed: 2026-02-27
---

# Phase 2 Plan 01: App Shell and Deal Feed Scaffold Summary

**Next.js 16 App Router with Tailwind v4 OKLCH dark theme, shadcn/ui new-york components, deployed to flight-points.vercel.app**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-27T21:50:40Z
- **Completed:** 2026-02-27T22:00:40Z
- **Tasks:** 2
- **Files modified:** 22

## Accomplishments

- Scaffolded Next.js 16 App Router at repo root with dark theme (OKLCH CSS variables via Tailwind v4 @theme inline)
- Installed shadcn/ui Badge, Card, Select, Button components in new-york style with React 19 data-slot pattern
- Established monorepo boundary: tsconfig.daemon.json for daemon (NodeNext), tsconfig.json for Next.js (bundler moduleResolution)
- Deployed to Vercel production (https://flight-points.vercel.app) — /deals serves "Award Deal Feed" (HTTP 200)
- Added Biome v2 linter/formatter replacing ESLint for the Next.js app layer

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next.js 16 app** - `28f6469` (feat)
2. **Task 2: vercel.json build command fix** - `d979376` (fix) — part of Vercel deploy verification
3. **Task 2: tsconfig daemon excludes** - `131ebd9` (fix) — suppress pre-existing errors in Vercel TS check

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `app/layout.tsx` - Root layout with ThemeProvider defaultTheme="dark", suppressHydrationWarning
- `app/page.tsx` - Redirect to /deals
- `app/deals/page.tsx` - Placeholder "Award Deal Feed" page (to be populated in Plan 02)
- `app/deals/loading.tsx` - Suspense skeleton with animate-pulse grid
- `app/globals.css` - Tailwind v4 @import with @theme inline OKLCH dark variables
- `components/ui/badge.tsx` - shadcn/ui Badge (data-slot, class-variance-authority)
- `components/ui/card.tsx` - shadcn/ui Card with CardContent/CardHeader
- `components/ui/select.tsx` - shadcn/ui Select (Radix-based, accessible)
- `components/ui/button.tsx` - shadcn/ui Button
- `lib/utils.ts` - cn() helper (clsx + tailwind-merge)
- `next.config.ts` - Minimal Next.js config (no tsconfigPath needed)
- `postcss.config.mjs` - @tailwindcss/postcss plugin (Tailwind v4)
- `biome.json` - Biome v2 linter config scoped to app/, components/, lib/, stores/
- `components.json` - shadcn/ui config (new-york, zinc, CSS variables)
- `tsconfig.daemon.json` - Preserved daemon TypeScript config (NodeNext, rootDir: src)
- `tsconfig.json` - New Next.js TypeScript config (bundler, jsx react-jsx, explicit excludes)
- `package.json` - Updated build script; added 10+ new dependencies
- `vercel.json` - Updated to framework: nextjs, buildCommand: next build
- `.gitignore` - Added .next/ and next-env.d.ts

## Decisions Made

- **tsconfig split**: tsconfig.json is now the Next.js config; daemon uses tsconfig.daemon.json via `-p` flag. This was the cleanest approach to avoiding moduleResolution conflicts (NodeNext vs bundler).
- **monitor.ts excluded**: monitor.ts transitively imports scrapers with pre-existing type errors. Removing it from the Next.js tsconfig include prevents build failures without any functionality loss (monitor.ts is daemon-only code, not needed in Next.js app).
- **Explicit buildCommand in vercel.json**: Without this, Vercel ran `npm run build` (which calls `tsc -p tsconfig.daemon.json` — fails on pre-existing errors). Explicitly setting `next build` fixes this.
- **components.json pre-created**: shadcn init prompts are interactive; creating components.json manually and running `shadcn@latest add` directly was more reliable in non-interactive execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed monitor.ts from Next.js tsconfig include**
- **Found during:** Task 1 (Step 17 — Next.js build verification)
- **Issue:** monitor.ts imports from scrapers/index.ts which transitively includes cathay.ts and korean-air.ts — both have pre-existing type errors. Next.js build failed: "Type error: Type 'number' is not assignable to type 'string'"
- **Fix:** Removed `src/flights/monitor.ts` from tsconfig.json include array; added `src/flights/scrapers`, `monitor.ts`, `flight-daemon.ts`, `web-server.ts`, `live-scraper.ts` to exclude array
- **Files modified:** tsconfig.json
- **Verification:** `npx next build` succeeds cleanly after fix
- **Committed in:** 28f6469 (Task 1 commit) + 131ebd9 (fix commit)

**2. [Rule 3 - Blocking] Added explicit buildCommand to vercel.json**
- **Found during:** Task 2 (Vercel deployment)
- **Issue:** Vercel ran `npm run build` which executes `tsc -p tsconfig.daemon.json` — failed with exit code 2 due to pre-existing daemon type errors
- **Fix:** Updated vercel.json to include `"buildCommand": "next build"` alongside `"framework": "nextjs"`
- **Files modified:** vercel.json
- **Verification:** Vercel deployment completes, https://flight-points.vercel.app/deals returns HTTP 200 with "Award Deal Feed" content
- **Committed in:** d979376 (fix commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both auto-fixes essential for Next.js build and Vercel deployment. No scope creep.

## Issues Encountered

- Pre-existing TypeScript errors in `src/flights/scrapers/cathay.ts` and `src/flights/scrapers/korean-air.ts` still appear as warnings in Vercel's TypeScript check output. The build succeeds despite these warnings (Next.js TypeScript check logs but does not fail the build for non-Next.js files). These are logged as deferred items for cleanup in a future plan.

## User Setup Required

None — Vercel is already connected to GitHub (andeslee444/Flight-Points) and deploys automatically on push. No additional env vars needed for the static /deals scaffold (DATABASE_URL will be needed when Plan 02 adds Drizzle data fetch).

## Next Phase Readiness

- Next.js app shell is complete — Plan 02 can import shadcn/ui components and add the DealCard/DealFeed/FilterBar components
- Tailwind v4 dark theme and shadcn/ui components ready for Plan 02 deal card UI
- Zustand is installed and ready for the filter store in Plan 02
- Vercel production deployment active at https://flight-points.vercel.app

## Self-Check: PASSED

All key files verified present:
- app/layout.tsx, app/deals/page.tsx, app/globals.css — FOUND
- next.config.ts, postcss.config.mjs, biome.json, tsconfig.daemon.json — FOUND
- components/ui/badge.tsx, lib/utils.ts — FOUND

All commits verified:
- 28f6469 (feat scaffold), d979376 (fix vercel), 131ebd9 (fix tsconfig) — all FOUND

---
*Phase: 02-app-shell-deal-feed*
*Completed: 2026-02-27*
