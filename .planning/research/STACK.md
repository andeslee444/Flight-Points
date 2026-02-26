# Technology Stack

**Project:** Flight Points — Award Flight Search Platform (Frontend + Features Rebuild)
**Researched:** 2026-02-26
**Scope:** Frontend rebuild + new features only. Existing scraper infrastructure (Python, Camoufox, Patchright, curl_cffi, Chrome CDP) is preserved as-is. This document covers what to build on top of it.

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js | 16.x (current stable) | Full-stack React framework | App Router + React Server Components give clean server/client split; SSE streaming works natively via Route Handlers; Vercel deployment is zero-config; Turbopack is now the default bundler (2-5x faster builds). Next.js 16 shipped October 2025 with stable Turbopack, React Compiler, and improved caching. **Do not use Next.js 15** — 16 is the current stable. |
| React | 19.2 | UI runtime | Bundled with Next.js 16. View Transitions, `useEffectEvent`, Activity component. Required by Next.js 16. |
| TypeScript | 5.x (5.1+ required) | Type safety | Already used in existing codebase. Next.js 16 requires TS 5.1+. |

**Why Next.js over Remix/SvelteKit:**
- Remix merged into React Router v7 — ecosystem is in transition, not the right time to adopt
- SvelteKit requires a full Svelte rewrite with no shared types from existing TS codebase
- Next.js App Router has the best story for mixing Server Components (deal feed, cached data) with Client Components (search UI, maps, charts)
- Existing Vercel deployment continues to work — zero infra change

### UI Components and Styling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tailwind CSS | v4.x (current) | Utility-first styling | v4 is current stable; shadcn/ui is built on it. CSS-first config in v4 eliminates `tailwind.config.js`. |
| shadcn/ui | latest (copy-paste model) | Component primitives | Not a library — copy components into your project and own them. Built on Radix UI for accessibility. All components updated for Tailwind v4 and React 19. 65K+ GitHub stars. Used by Vercel, Supabase, and nearly every serious Next.js project in 2026. Provides: Command palette (search UX), Dialogs, Sheets, Dropdowns, Combobox, Cards, Badges. |
| Radix UI | (via shadcn/ui) | Accessible primitives | Keyboard navigation, ARIA, focus management — all handled by Radix under the hood |
| Lucide React | latest | Icons | Default icon set for shadcn/ui projects; comprehensive, consistent, tree-shakeable |

**Why not Chakra UI / Mantine / Ant Design:**
- All ship as installed libraries with opinionated styles you fight against
- shadcn/ui gives you components you own — no version upgrade friction, no theming battles
- Dark theme implementation is trivial with shadcn/ui + Tailwind CSS variables

### Data Fetching and Server State

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TanStack Query | v5.x | Client-side async state | Mutations with optimistic updates, DevTools, garbage collection, stale-time control, infinite scroll for deal feed. 3x more capable than SWR for this use case (alert management, user account mutations, pagination). SWR is adequate for simple read-only apps — Flight Points needs mutations. |
| Next.js Route Handlers | (built-in) | API layer | Replace existing Express endpoints. Route Handlers support SSE streaming natively with ReadableStream. Keeps everything in one repo. |

**Why TanStack Query over SWR:**
- SWR has no built-in DevTools, limited mutation support, no garbage collection
- Deal feed with pagination + live scrape results + alert management all need full mutation lifecycle
- TanStack Query v5 has first-class SSR support for Next.js App Router

### Charts and Data Visualization

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Recharts | v2.x | Price history charts, deal trends | shadcn/ui's chart component system is built directly on Recharts. You get pre-styled, Tailwind-integrated chart components for free. Area charts (price history over time), bar charts (program comparison), line charts (CPP trends). Correct choice for datasets under 10K points — award flight history data is well within this. Requires `"use client"` directive. |

**Why not Nivo or Victory:**
- Nivo: More verbose API, heavier, no native shadcn/ui integration
- Victory: Built for cross-platform (React Native) — adds unnecessary weight for web-only
- react-chartjs-2 / Apache ECharts: Better for 10K+ real-time data points; overkill here

**Note on Recharts v3 compatibility:** As of Feb 2026, shadcn/ui charts are on Recharts v2. There is an open issue to support Recharts v3. Stay on v2 until shadcn/ui officially upgrades.

### Map and Geospatial

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| MapLibre GL JS | v4.x | Base map rendering | Open-source fork of Mapbox GL JS (BSD-2-Clause license). Free, no API key needed for tiles. WebGL-based — handles vector tiles, smooth zoom, 3D. Growing faster than Leaflet since 2024. |
| react-map-gl | v8.x (MapLibre mode) | React wrapper for MapLibre | Official vis.gl wrapper, supports MapLibre natively. Handles map state sync with React lifecycle. |
| deck.gl | v9.x | Arc layer for flight routes | Used for animated great-circle arc rendering between airports. ArcLayer + GreatCircleLayer. Works as a child of react-map-gl. WebGL-powered — handles hundreds of animated arcs smoothly. Open source (MIT). |
| OpenStreetMap / MapTiler | free tier | Map tiles | MapTiler free tier works with MapLibre for tile serving. No vendor lock-in. |

**Why not Leaflet:**
- Leaflet uses SVG/HTML — cannot handle animated arcs at scale cleanly
- No WebGL, meaning flight route animations would be janky
- MapLibre GL + deck.gl is the standard stack for flight visualization as of 2025/2026

**Why not Mapbox:**
- Mapbox GL JS switched to a proprietary license in v2 (late 2020)
- MapLibre is the community-maintained open-source fork — identical API, free, no billing

### Authentication

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Better Auth | latest (v1.x) | User accounts, sessions, OAuth | Framework-agnostic, open-source, self-hosted. Plugin ecosystem covers email/password, Google OAuth, magic links, 2FA out of the box. Auth.js team is now part of Better Auth. Lucia Auth was deprecated March 2025 — do not use. Better Auth is the strongest open-source option for new projects in 2026. |

**Why not Clerk:**
- Paid service with documented reliability issues; adds vendor dependency
- 3rd-party service for a project that's meant to be self-sufficient
- Better Auth self-hosted = zero auth vendor cost, full data control

**Why not Auth.js (NextAuth v5):**
- Better Auth team now maintains Auth.js; Better Auth is the recommended path forward for new projects
- Better Auth has cleaner API, better plugin system, built-in 2FA vs Auth.js manual implementation

**Database adapter:** Better Auth works with the existing `pg` PostgreSQL client. No new database needed.

### Email Alerts

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Resend | v4.x | Transactional email delivery | Developer-first API, built by React Email creators. Native Next.js integration (Server Actions, Route Handlers). Free tier: 3,000 emails/month, 100/day. Works on Vercel Edge functions. React Email integration for template authoring. |
| React Email | v3.x | Email template authoring | Write email templates as React components, preview locally with `npx react-email dev`. Supports Gmail, Outlook, Apple Mail. Pairs directly with Resend. |

**Why not SendGrid:**
- More features but 10x more setup complexity
- React Email + Resend covers all alert use cases (deal alerts, auth emails, digests)
- At this scale, Resend free tier is sufficient

**Why not Nodemailer:**
- Cannot run on Vercel Edge functions (requires raw TCP / SMTP)
- Resend uses HTTP API — works everywhere

### State Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Zustand | v5.x (v5.0.11 current) | Client-side UI state | Search form state, filter state, map viewport, selected deal. ~3KB bundle. Simple store model — not Redux complexity. Stable v5 released; active maintenance. For a search/browse interface, this is all the client state needed. |

**Why not Redux Toolkit:**
- 15KB bundle vs Zustand's 3KB
- 18ms render time vs Zustand's 12ms
- Excessive boilerplate for this use case

**Why not Jotai:**
- Atom model is better for fine-grained reactivity; overkill for search UI state
- Zustand's single store is easier to reason about for form/filter/map state

### Database Access (Frontend Layer)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Drizzle ORM | v0.45.x | Database schema + queries for new tables | Lightweight (~7.4KB), edge-native, SQL-like TypeScript API. Perfect for Vercel serverless. New tables for: users, sessions, alert subscriptions, price history, user preferences. |

**Why Drizzle over Prisma:**
- Existing codebase uses raw `pg` for scraper data — Drizzle sits alongside this cleanly
- Drizzle is edge-native; Prisma requires Prisma Accelerate for edge/serverless deployment
- Minimal bundle size; faster serverless cold starts
- SQL-like query API — familiar for anyone who can read the existing raw pg queries

**Note:** Existing scraper data queries (flight cache, health metrics) can continue using raw `pg`. Drizzle is for the new frontend-owned tables only (users, alerts, price history).

### Real-Time Data Delivery

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SSE (Server-Sent Events) | (built-in Web API) | Live scrape results streaming | Already used in existing Express server. Next.js 16 Route Handlers support SSE via `ReadableStream` natively. One-directional server-to-client — exactly right for scrape result streaming. No WebSocket overhead needed. |

**Known SSE gotcha with Next.js/Vercel:** Next.js can buffer SSE responses and deliver all chunks at once. Fix: set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` headers. Use `TransformStream` pattern to ensure incremental delivery. Vercel Fluid functions (not Edge) support long-lived SSE connections.

### Build and Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Turbopack | (built into Next.js 16) | Default bundler | 2-5x faster production builds, up to 10x faster Fast Refresh vs webpack. Now the default in Next.js 16. No configuration needed. |
| React Compiler | (built into Next.js 16) | Automatic memoization | Stable in Next.js 16. Eliminates manual `useMemo`/`useCallback` calls. Enable with `reactCompiler: true` in `next.config.ts`. Not on by default — opt in when build times are acceptable. |
| Biome | v1.x | Linting + formatting | Next.js 16 removed the `next lint` command (deprecated). Biome replaces ESLint + Prettier in one tool, 10-20x faster. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | Next.js 16 | Remix / React Router v7 | Ecosystem in transition post-merger; less SSR caching control |
| Framework | Next.js 16 | SvelteKit | Different language — can't share TypeScript types with existing codebase |
| Components | shadcn/ui | Mantine / Chakra | Installed libraries with fighting styles; shadcn/ui gives owned code |
| Charts | Recharts (via shadcn) | Nivo | Heavier API, no shadcn integration |
| Charts | Recharts (via shadcn) | Victory | React Native overhead; web-only project |
| Map | MapLibre GL | Mapbox GL JS | Proprietary license since v2; free alternative exists |
| Map | MapLibre GL | Leaflet | SVG-based, no WebGL — animated arcs would be janky |
| Auth | Better Auth | Clerk | Paid service, documented reliability issues, vendor dependency |
| Auth | Better Auth | Auth.js / NextAuth | Better Auth supersedes it for new projects (teams merged) |
| Auth | Better Auth | Lucia Auth | Deprecated March 2025 — do not use |
| Email | Resend + React Email | SendGrid | 10x more complex for same use case; Resend free tier sufficient |
| Email | Resend + React Email | Nodemailer | SMTP fails on Vercel Edge; Resend uses HTTP API |
| ORM | Drizzle | Prisma | Prisma needs Accelerate for edge; larger bundle; existing raw pg works fine |
| State | Zustand | Redux Toolkit | 5x larger bundle, excessive boilerplate for search UI |
| Data fetching | TanStack Query v5 | SWR | SWR lacks mutations, DevTools, garbage collection |

---

## Installation

```bash
# Next.js 16 project (new)
npx create-next-app@latest --typescript --tailwind --app

# Core dependencies
npm install zustand@5 @tanstack/react-query@5 recharts

# shadcn/ui CLI (add components individually)
npx shadcn@latest init
npx shadcn@latest add card button input badge command dialog sheet

# Authentication
npm install better-auth

# ORM
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit

# Map / geospatial
npm install react-map-gl maplibre-gl deck.gl

# Email
npm install resend react-email

# Dev tooling
npm install -D @biomejs/biome
```

---

## What NOT to Use (and Why)

| Library | Do Not Use Because |
|---------|--------------------|
| `seats.aero` API | Competitor service — project constraint |
| `point.me` API | Competitor service — project constraint |
| Mapbox GL JS v2+ | Proprietary license; MapLibre is the free fork |
| Lucia Auth | Deprecated March 2025 |
| Nodemailer | SMTP cannot run on Vercel Edge |
| Redux / Redux Toolkit | Massive overkill; 5x bundle size vs Zustand |
| Recharts v3 | Not yet supported by shadcn/ui charts (open issue as of Feb 2026) |
| `next lint` command | Removed in Next.js 16; use Biome directly |
| Prisma (for new tables) | Edge-runtime issues; Drizzle is lighter and edge-native |
| Victory charts | Built for React Native cross-compat; web-only project |
| Nivo | Heavy API, no shadcn/ui integration |

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Next.js 16 as framework | HIGH | Official Next.js blog (Oct 2025), verified current stable |
| shadcn/ui + Tailwind v4 | HIGH | Official shadcn/ui docs confirm Tailwind v4 support |
| Recharts via shadcn/ui | HIGH | Official shadcn/ui charts page; Recharts npm page |
| MapLibre + deck.gl for maps | HIGH | Official deck.gl docs confirm MapLibre integration |
| Better Auth for auth | MEDIUM | WebSearch verified; active project; Auth.js team merger confirmed |
| Resend for email | HIGH | Official Resend docs; wide adoption in Next.js community |
| TanStack Query v5 | HIGH | Official TanStack docs; widespread adoption |
| Drizzle ORM | HIGH | Multiple authoritative comparisons; Drizzle docs confirm edge support |
| Zustand v5 | HIGH | npm shows v5.0.11 released and stable |
| SSE in Next.js 16 | MEDIUM | Known buffering issue; workarounds documented but require careful implementation |

---

## Sources

- [Next.js 16 Release Blog](https://nextjs.org/blog/next-16) — Oct 2025, official
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — official docs
- [shadcn/ui Tailwind v4 Docs](https://ui.shadcn.com/docs/tailwind-v4) — official
- [shadcn/ui Charts](https://ui.shadcn.com/charts/area) — official
- [Better Auth Home](https://www.better-auth.com/) — official
- [Better Auth Next.js Integration](https://www.better-auth.com/docs/integrations/next) — official
- [Auth.js joins Better Auth announcement](https://www.better-auth.com/blog/authjs-joins-better-auth) — official
- [TanStack Query v5 Comparison](https://tanstack.com/query/v5/docs/framework/react/comparison) — official
- [deck.gl with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre) — official
- [react-map-gl Introduction](https://visgl.github.io/react-map-gl/docs) — official
- [Resend Next.js Integration](https://resend.com/docs/send-with-nextjs) — official
- [Drizzle vs Prisma — Bytebase](https://www.bytebase.com/blog/drizzle-vs-prisma/) — MEDIUM confidence (editorial)
- [Zustand npm](https://www.npmjs.com/package/zustand) — v5.0.11 confirmed
- [Fixing Slow SSE in Next.js and Vercel — Medium, Jan 2026](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996) — LOW confidence (single source, community)
- [MapLibre vs Leaflet — jawg.io](https://blog.jawg.io/maplibre-gl-vs-leaflet-choosing-the-right-tool-for-your-interactive-map/) — MEDIUM confidence
- [Resend vs SendGrid 2026](https://forwardemail.net/en/blog/resend-vs-sendgrid-email-service-comparison) — MEDIUM confidence
