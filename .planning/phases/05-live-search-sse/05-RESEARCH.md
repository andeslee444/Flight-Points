# Phase 5: Live Search (SSE) - Research

**Researched:** 2026-02-27
**Domain:** Server-Sent Events proxying, Next.js App Router, Zustand state accumulation, React Client Components
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-05 | User sees real-time loading progress as scrapers return results via SSE | SSE infrastructure already fully implemented in Harbor Express (web-server.ts). Phase is about wiring the Next.js frontend to it via a proxy rewrite and building the UI layer. |
</phase_requirements>

---

## Summary

The scraper-side SSE infrastructure is **already complete**. `src/flights/web-server.ts` implements a fully-working `/api/flights/live-search` SSE endpoint that streams `scraper-started`, `scraper-progress`, `result`, `scraper-done`, `scraper-error`, `scraper-skipped`, and `complete` events. `src/flights/live-scraper.ts` runs all relevant scrapers in parallel via the `LiveScrapeCallbacks` interface with abort signal support.

The old vanilla JS frontend (`web/public/flight-results.html`) also has a complete working SSE client — the `startLiveScrape()` function using native `EventSource`, per-scraper status rows, live result accumulation, and a progress panel. This is the reference implementation to port to React.

Phase 5 is therefore a **frontend migration + proxy wiring** task, not a new backend build. The three plans map cleanly:

1. **05-01**: Add a `rewrites()` entry in `next.config.ts` that proxies `/api/flights/live-search` → Harbor Express at `HARBOR_URL:3001/api/flights/live-search`. Harbor needs a second port (3001) for the live-search endpoint so Vercel rewrites can target it without conflicting with the existing Express port 3000 (used for the old vanilla HTML frontend).
2. **05-02**: Build a `useLiveSearch` React hook using native `EventSource`, accumulating results into a Zustand slice with `liveResults`, per-scraper status map, and elapsed timer state.
3. **05-03**: Build a `LiveSearchProgress` leaf Client Component (not the search page root) that reads the Zustand store and renders the scraper status panel, then integrate into `SearchResults`.

**Primary recommendation:** Proxy via `next.config.ts` rewrites (not a Route Handler), extend the existing `search-store.ts` Zustand store for live search state, and render the progress panel as a standalone `'use client'` leaf component inside `SearchResults`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `EventSource` (browser API) | Web standard | SSE client | No dependency needed; already used in flight-results.html |
| Zustand | ^5.0.11 (already installed) | Live result accumulation + scraper status state | Already used in project for filter-store and search-store |
| Next.js `rewrites()` | ^16.1.6 (already installed) | Proxy `/api/flights/live-search` to Harbor Express | No extra package; built into next.config.ts |
| React | ^19.2.4 (already installed) | `useEffect` for EventSource lifecycle management | Standard React pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AbortController` (browser API) | Web standard | Cancel in-flight SSE on unmount or re-search | Always — prevents memory leaks when user navigates away |
| `useCallback` / `useRef` (React) | Built-in | Stable EventSource ref so cleanup runs correctly | Required for EventSource in useEffect |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `next.config.ts` rewrites | Next.js Route Handler that `fetch()`-proxies SSE | Route Handler approach is fragile for SSE — Vercel serverless functions have a 10s timeout; rewrites are a transparent TCP proxy with no timeout |
| Native `EventSource` | `@microsoft/fetch-event-source` | fetch-event-source allows POST and custom headers, but this endpoint only needs GET. No reason to add a dependency. |
| Extend `search-store.ts` | Separate `live-search-store.ts` | A second store is fine; separate file keeps concerns clean and avoids a large monolithic store |

**Installation:** No new packages needed. All dependencies already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
app/
└── api/
    └── (no new route handler needed — use next.config.ts rewrite)

stores/
└── live-search-store.ts        # NEW: Zustand store for live results + scraper status

components/
├── live-search-progress.tsx    # NEW: scraper status panel ('use client' leaf)
└── search-results.tsx          # MODIFY: add live search integration
```

The existing Harbor Express server at port 3000 will be split: the SSE endpoint moves to a dedicated minimal Express app on **port 3001** so Vercel rewrites target a stable, long-lived endpoint separate from the static file server. Alternatively, both can stay on port 3000 since the rewrite targets the full `HARBOR_URL` which can include the port.

### Pattern 1: next.config.ts Rewrites for SSE Proxy

**What:** Add a `rewrites()` function to `next.config.ts` that transparently proxies `/api/flights/live-search` to the Harbor Express server. The browser's `EventSource` connects to the Vercel URL; Vercel's edge network forwards the connection to Harbor.

**When to use:** Any time a Next.js app on Vercel needs to reach a long-lived backend process (like Python scrapers) that cannot run on Vercel serverless.

**Example:**
```typescript
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
// next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  async rewrites() {
    const harborUrl = process.env.HARBOR_URL || 'http://localhost:3000';
    return [
      {
        source: '/api/flights/live-search',
        destination: `${harborUrl}/api/flights/live-search`,
      },
    ];
  },
};

export default config;
```

**Environment variables needed:**
- `HARBOR_URL` — e.g. `http://harbor.local:3000` or `http://150.136.249.186:3001`
- Must be set in both local `.env` AND Vercel dashboard

### Pattern 2: Zustand Store for Live Search State

**What:** A dedicated store slice holding the array of live results as they arrive, plus a per-scraper status map updated by each SSE event.

**When to use:** When multiple React components need to observe the same streaming state (progress panel + results list are siblings, not parent/child).

**Example:**
```typescript
// Source: https://github.com/pmndrs/zustand/blob/main/docs/apis/create.md
// stores/live-search-store.ts
'use client';

import { create } from 'zustand';
import type { EnrichedDeal } from '@/lib/enrichment';

export type ScraperStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface ScraperState {
  key: string;
  name: string;
  status: ScraperStatus;
  message: string;
  resultCount?: number;
}

interface LiveSearchState {
  // Connection state
  isLive: boolean;
  elapsedSeconds: number;
  // Results accumulation
  liveResults: EnrichedDeal[];
  seenKeys: Set<string>;
  // Per-scraper status
  scrapers: Record<string, ScraperState>;
  // Actions
  startLive: () => void;
  resetLive: () => void;
  addResult: (deal: EnrichedDeal) => void;
  updateScraper: (key: string, patch: Partial<ScraperState>) => void;
  setElapsed: (s: number) => void;
  finishLive: () => void;
}

export const useLiveSearchStore = create<LiveSearchState>()((set) => ({
  isLive: false,
  elapsedSeconds: 0,
  liveResults: [],
  seenKeys: new Set(),
  scrapers: {},
  startLive: () => set({ isLive: true, liveResults: [], seenKeys: new Set(), scrapers: {}, elapsedSeconds: 0 }),
  resetLive: () => set({ isLive: false, liveResults: [], seenKeys: new Set(), scrapers: {}, elapsedSeconds: 0 }),
  addResult: (deal) => set((state) => {
    const key = `${deal.airline}-${deal.flightNumber}-${deal.departureDate}-${deal.cabin}`;
    if (state.seenKeys.has(key)) return {};
    const newSeen = new Set(state.seenKeys);
    newSeen.add(key);
    return { liveResults: [...state.liveResults, deal], seenKeys: newSeen };
  }),
  updateScraper: (key, patch) => set((state) => ({
    scrapers: { ...state.scrapers, [key]: { ...state.scrapers[key], key, ...patch } },
  })),
  setElapsed: (s) => set({ elapsedSeconds: s }),
  finishLive: () => set({ isLive: false }),
}));
```

### Pattern 3: useLiveSearch Hook with EventSource Lifecycle

**What:** A `'use client'` hook that opens an `EventSource`, dispatches events to the Zustand store, and cleans up on unmount or when search params change.

**When to use:** When the SSE lifecycle (open, message, error, close) needs to be tied to React component mount/unmount.

**Example:**
```typescript
// hooks/use-live-search.ts
'use client';

import { useEffect, useRef } from 'react';
import { useLiveSearchStore } from '@/stores/live-search-store';
import type { EnrichedDeal } from '@/lib/enrichment';

export function useLiveSearch(
  from: string,
  to: string,
  cabin: string,
  program: string,
  date?: string,
  enabled = true,
) {
  const { startLive, resetLive, addResult, updateScraper, setElapsed, finishLive } = useLiveSearchStore();
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !from || !to) return;

    startLive();
    const startTime = Date.now();

    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);

    let qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&class=${encodeURIComponent(cabin)}&program=${encodeURIComponent(program)}`;
    if (date) qs += `&date=${encodeURIComponent(date)}`;

    const es = new EventSource(`/api/flights/live-search?${qs}`);
    esRef.current = es;

    es.addEventListener('scraper-started', (e) => {
      const d = JSON.parse(e.data);
      updateScraper(d.scraper, { name: d.name, status: 'running', message: 'Starting...' });
    });
    es.addEventListener('scraper-progress', (e) => {
      const d = JSON.parse(e.data);
      updateScraper(d.scraper, { status: 'running', message: d.message });
    });
    es.addEventListener('result', (e) => {
      const d = JSON.parse(e.data);
      addResult(d.flight as EnrichedDeal);
    });
    es.addEventListener('scraper-done', (e) => {
      const d = JSON.parse(e.data);
      updateScraper(d.scraper, { status: 'done', message: `${d.resultCount} found`, resultCount: d.resultCount });
    });
    es.addEventListener('scraper-error', (e) => {
      const d = JSON.parse(e.data);
      updateScraper(d.scraper, { status: 'error', message: d.error });
    });
    es.addEventListener('complete', () => {
      finishLive();
      if (timerRef.current) clearInterval(timerRef.current);
    });
    es.addEventListener('search-error', () => {
      finishLive();
      if (timerRef.current) clearInterval(timerRef.current);
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) finishLive();
      if (timerRef.current) clearInterval(timerRef.current);
    };

    return () => {
      es.close();
      esRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      resetLive();
    };
  }, [from, to, cabin, program, date, enabled]);
}
```

### Pattern 4: LiveSearchProgress as Leaf Client Component

**What:** A standalone `'use client'` component that reads `useLiveSearchStore` and renders the scraper status panel. It is a leaf — it renders no Server Components and has no children that need RSC data. It lives inside `SearchResults` (already `'use client'`).

**When to use:** When you want to isolate the "streaming UI" from the static RSC results grid so server data doesn't have to re-render when live events arrive.

**Example:**
```typescript
// components/live-search-progress.tsx
'use client';

import { useLiveSearchStore } from '@/stores/live-search-store';

export function LiveSearchProgress() {
  const { isLive, scrapers, elapsedSeconds } = useLiveSearchStore();

  if (!isLive && Object.keys(scrapers).length === 0) return null;

  const scraperList = Object.values(scrapers);

  return (
    <div className="border border-border rounded-sm p-4 mb-5 bg-card">
      <div className="flex items-center gap-2 mb-3">
        {isLive && <span className="w-3.5 h-3.5 rounded-full border-2 border-border border-t-accent animate-spin" />}
        <span className="font-semibold text-sm text-foreground">
          {isLive ? 'Live search' : 'Search complete'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{elapsedSeconds}s</span>
      </div>
      <div className="space-y-1">
        {scraperList.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs py-1 border-t border-border/20 first:border-0">
            <ScraperDot status={s.status} />
            <span className="font-medium w-36 shrink-0">{s.name || s.key}</span>
            <span className="text-muted-foreground">{s.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pattern 5: SearchResults Integration

**What:** `SearchResults` (already `'use client'`) calls `useLiveSearch()` and merges `liveResults` from the store with the SSR `results` prop, deduplicating by flight ID. `LiveSearchProgress` is rendered above the results list.

**Key integration points:**
- `useLiveSearch` is called inside `SearchResults` with the `from`, `to`, `cabin`, `program`, `date` props it already receives
- The merged display array is `[...results, ...liveResults]` deduped by `deal.id`
- The search page RSC passes `from`, `to`, `cabin`, `program`, `date` down as props (already done)

### Anti-Patterns to Avoid

- **Running SSE inside a Server Component:** `EventSource` is a browser API; it can only be called in a `'use client'` component or hook. Never attempt SSE in RSC.
- **Putting useLiveSearch in search/page.tsx (RSC root):** The page is a Server Component. Move SSE logic into `SearchResults` which is already `'use client'`.
- **Proxying SSE through a Next.js Route Handler:** Route Handlers on Vercel serverless have a hard timeout (~10s for hobby, 60s for pro). The scrape takes 20-60s. Use `rewrites()` for transparent TCP proxying instead.
- **Forgetting `es.close()` in cleanup:** If the component unmounts (user navigates away), the EventSource stays open on the server, blocking a concurrency slot. Always close in the `useEffect` cleanup.
- **Using `es.onmessage` instead of named event listeners:** The Harbor SSE endpoint emits named events (`event: scraper-started`). These do NOT fire on `onmessage` — they require `addEventListener('scraper-started', ...)`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE client with auto-reconnect | Custom fetch-based retry loop | Native `EventSource` | EventSource auto-reconnects by spec; custom retry loops are buggy |
| Result deduplication | Ad hoc Set logic in component | Dedup in Zustand `addResult` action | Keeps dedup logic in one place; components re-render cleanly |
| Proxy for SSE to external server | Route Handler that fetch()-pipes SSE | `next.config.ts` rewrites | rewrites are transparent at network level; Route Handlers have serverless timeout |
| Per-scraper state management | Array of React state variables | Zustand `scrapers: Record<string, ScraperState>` | Keyed dict avoids O(n) array scans on every SSE event |

**Key insight:** The proxy and scraper backend are already done. The only new code is the Zustand store, the hook, and two component modifications (LiveSearchProgress new, SearchResults modified).

---

## Common Pitfalls

### Pitfall 1: Vercel SSE Response Buffering

**What goes wrong:** Vercel's edge network may buffer SSE responses before forwarding to the browser, causing events to appear in bursts rather than individually.

**Why it happens:** Some proxy layers buffer until a certain byte count or time interval. X-Accel-Buffering controls nginx buffering behavior.

**How to avoid:** The Harbor Express endpoint must send `X-Accel-Buffering: no` response header. In `next.config.ts`, add a `headers()` config entry for the live-search path. Also, Harbor should send `: keepalive` SSE comments every 15s (already implemented in web-server.ts).

**Warning signs:** In production, progress events arrive all at once after the scraper finishes instead of streaming incrementally. Test in Vercel preview, not just local dev, early in the phase.

**Code:**
```typescript
// Source: https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/self-hosting.mdx
// next.config.ts headers() addition
async headers() {
  return [
    {
      source: '/api/flights/live-search',
      headers: [{ key: 'X-Accel-Buffering', value: 'no' }],
    },
  ];
},
```

**Confidence:** LOW for whether this is sufficient on Vercel's specific CDN. STATE.md explicitly flags this as needing validation in a Vercel preview deployment. The header is the standard fix; whether Vercel honors it for rewrites specifically is unverified.

### Pitfall 2: EventSource Named Events vs onmessage

**What goes wrong:** Developer uses `es.onmessage` to listen for events. Gets nothing because all events from Harbor are named (`event: scraper-started`, `event: result`, etc.), which only fire on `addEventListener`.

**Why it happens:** The EventSource spec distinguishes unnamed events (fire on `onmessage`) from named events (only fire on `addEventListener('name', ...)`). Harbor emits exclusively named events.

**How to avoid:** Always use `es.addEventListener('event-name', handler)` for each event type. Never rely on `onmessage` for this endpoint.

### Pitfall 3: HARBOR_URL Not Set in Vercel

**What goes wrong:** The `rewrites()` destination falls back to `http://localhost:3000` in Vercel production. Live search silently fails (connection refused).

**Why it happens:** `HARBOR_URL` env var missing from Vercel dashboard.

**How to avoid:** Add `HARBOR_URL` to `.env.example`. Document that this must be set in Vercel dashboard. In `next.config.ts`, make the fallback obviously broken (`http://HARBOR_URL_NOT_SET`) rather than `localhost` so the failure is loud.

### Pitfall 4: Stale Results from SSR + Live Mixed State

**What goes wrong:** User searches JFK→LHR, gets 5 SSR results, live scrape adds 20 more, user changes program — the live results from the old program are still visible.

**Why it happens:** Zustand `liveResults` persists across navigations if not reset on search param change.

**How to avoid:** The `useLiveSearch` hook's `useEffect` dependency array includes `[from, to, cabin, program, date]`. When any param changes, the effect cleanup runs `resetLive()`, clearing the store and closing the old EventSource. Verify this covers the program-switcher case.

### Pitfall 5: Concurrency Limit Hit

**What goes wrong:** Harbor has `MAX_CONCURRENT_LIVE_SCRAPES = 2`. A third user hits live search and gets a `search-error` event immediately.

**Why it happens:** Server-side concurrency protection is correct, but the UI shows an error state rather than a helpful "server busy" message.

**How to avoid:** `SearchResults` should handle the `search-error` SSE event by showing a user-friendly inline message ("Too many concurrent searches — try again in a minute") rather than an error state. This is a UX consideration for 05-03.

---

## Code Examples

Verified patterns from official sources:

### next.config.ts Rewrites (HIGH confidence)

```typescript
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  async rewrites() {
    const harborUrl = process.env.HARBOR_URL || 'http://HARBOR_URL_NOT_SET';
    return [
      {
        source: '/api/flights/live-search',
        destination: `${harborUrl}/api/flights/live-search`,
      },
      // Forward query string automatically — Next.js rewrites pass through all query params
    ];
  },
  async headers() {
    return [
      {
        source: '/api/flights/live-search',
        headers: [{ key: 'X-Accel-Buffering', value: 'no' }],
      },
    ];
  },
};

export default config;
```

### Zustand Store with Array Accumulation (HIGH confidence)

```typescript
// Source: https://github.com/pmndrs/zustand/blob/main/docs/apis/create.md
// Immutable append to array in Zustand
addResult: (deal) => set((state) => {
  const key = `${deal.airline}-${deal.flightNumber}-${deal.departureDate}-${deal.cabin}`;
  if (state.seenKeys.has(key)) return {};  // No update needed — Set is checked before spread
  const newSeen = new Set(state.seenKeys);
  newSeen.add(key);
  return { liveResults: [...state.liveResults, deal], seenKeys: newSeen };
}),
```

Note: Zustand does not serialize `Set` by default. The `seenKeys: Set<string>` field is fine for runtime use (never persisted), but do not add `persist` middleware to this store.

### EventSource Named Event Listener Pattern (HIGH confidence — from existing flight-results.html)

```typescript
// Verified pattern from src/flights/web-server.ts + web/public/flight-results.html
const es = new EventSource(`/api/flights/live-search?${qs}`);

// Named events ONLY fire on addEventListener, NOT onmessage
es.addEventListener('scraper-started', (e) => { /* ... */ });
es.addEventListener('result', (e) => { /* ... */ });
es.addEventListener('complete', (e) => { /* ... */ });

// Cleanup
return () => { es.close(); };
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| polling `/api/flights/search` every N seconds | Native `EventSource` SSE | Already in flight-results.html | Real-time per-result streaming vs batch refresh |
| All results in one API response | Streaming per-scraper via SSE callbacks | Implemented in web-server.ts | Users see results as each scraper completes |

**Deprecated/outdated:**
- The vanilla HTML frontend (`web/public/flight-results.html`): This is the reference to port from, not extend. Phase 5 moves the behavior to the Next.js app. The old HTML frontend remains for now but is superseded.

---

## Open Questions

1. **Will Vercel honor X-Accel-Buffering for rewrites?**
   - What we know: The header is the standard nginx buffering disable flag; Next.js docs show it for self-hosted nginx. Vercel uses its own edge network.
   - What's unclear: Whether Vercel's edge layer respects this header for responses flowing through a `rewrites()` proxy.
   - Recommendation: Set the header and validate with a Vercel preview deployment at the start of 05-01. If buffering still occurs, alternative is to route SSE directly to Harbor (user configures Harbor URL in the browser, bypassing Vercel entirely — less clean but functional).

2. **Should Harbor run a separate port (3001) for the live-search SSE endpoint?**
   - What we know: The roadmap plans say "port 3001 for live scraper SSE". The current Express server uses port 3000 and serves both the vanilla HTML frontend and the SSE endpoint. The Next.js rewrite can target any `HARBOR_URL:PORT`.
   - What's unclear: Whether splitting ports actually helps anything, or whether keeping everything on port 3000 (single Express process) is simpler.
   - Recommendation: Keep everything on one Express port (3000). Set `HARBOR_URL=http://harbor.local:3000` and let the rewrite proxy to `/api/flights/live-search` on that port. No reason to split.

3. **How should the search page handle the transition: SSR results exist + live scrape running?**
   - What we know: Currently the old HTML frontend skips the cache entirely and goes straight to live scraping. The new Next.js search page fetches from DB first (SSR), then could trigger a live scrape in addition.
   - What's unclear: Whether SRCH-05 means "always live scrape" (like the HTML frontend) or "live scrape only when cache is empty" or "live scrape always in addition to cache".
   - Recommendation: Based on the MEMORY.md note ("Every search triggers a live scrape (not just when cache is empty)"), live scrape should always run. The SSR results from the DB serve as an initial set; live results merge in as they arrive. This matches the success criteria ("fresh live data streaming in").

---

## Sources

### Primary (HIGH confidence)
- `/vercel/next.js` (Context7) — rewrites, headers, SSE streaming, App Router Route Handlers
- `src/flights/web-server.ts` — Existing SSE endpoint implementation (live ground truth)
- `src/flights/live-scraper.ts` — Existing scraper orchestration with callbacks
- `web/public/flight-results.html` — Existing SSE client reference implementation
- `/pmndrs/zustand` (Context7) — Array state updates, store creation patterns

### Secondary (MEDIUM confidence)
- `components/search-results.tsx` + `stores/search-store.ts` — Established project patterns for `'use client'` components + Zustand
- Next.js docs on `X-Accel-Buffering` for streaming responses (self-hosted nginx) — applicable but Vercel-specific behavior unconfirmed

### Tertiary (LOW confidence)
- Vercel-to-Harbor SSE rewrite buffering behavior — no official Vercel documentation found confirming rewrites pass through SSE without buffering. Must validate in preview deployment.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, patterns verified in existing code
- Architecture: HIGH — proxy via rewrites is documented; Zustand + EventSource patterns verified
- Pitfalls: MEDIUM — most pitfalls are verified from existing code analysis; Vercel buffering is LOW confidence and flagged
- Vercel buffering fix: LOW — needs production validation early in 05-01

**Research date:** 2026-02-27
**Valid until:** 2026-03-30 (stable domain — Next.js rewrites and EventSource are stable APIs)
