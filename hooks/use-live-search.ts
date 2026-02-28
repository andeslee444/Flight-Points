'use client';

import { useEffect, useRef } from 'react';
import { useLiveSearchStore } from '@/stores/live-search-store';
import type { LiveFlightResult } from '@/stores/live-search-store';

/**
 * Hook that manages an EventSource connection to Harbor's live search SSE endpoint.
 *
 * Opens a connection when enabled and search params are present. Dispatches all
 * SSE events to the useLiveSearchStore. Cleans up on unmount or param change.
 *
 * @param from    - Origin airport code(s), e.g. "JFK" or "JFK,EWR,LGA"
 * @param to      - Destination airport code(s)
 * @param cabin   - Cabin class: "economy" | "business" | "first"
 * @param program - Credit card program slug, e.g. "amex-mr"
 * @param date    - Optional specific date (YYYY-MM-DD)
 * @param enabled - Whether to start the connection (default true)
 */
export function useLiveSearch(
  from: string,
  to: string,
  cabin: string,
  program: string,
  date?: string,
  enabled = true,
) {
  const store = useLiveSearchStore();
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !from || !to) return;

    // Reset store and start live mode
    store.startLive();

    // Elapsed time timer (updates every 1s)
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      store.setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);

    // Build query string
    const params = new URLSearchParams({
      from,
      to,
      class: cabin,
      program,
    });
    if (date) params.set('date', date);

    const es = new EventSource(`/api/flights/live-search?${params.toString()}`);
    esRef.current = es;

    // ── Named event listeners (MUST use addEventListener, NOT onmessage) ──

    es.addEventListener('scraper-started', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.updateScraper(d.scraper, {
        name: d.name,
        status: 'running',
        message: 'Starting...',
      });
    });

    es.addEventListener('scraper-progress', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.updateScraper(d.scraper, {
        status: 'running',
        message: d.message,
      });
    });

    es.addEventListener('result', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.addResult(d.flight as LiveFlightResult);
    });

    es.addEventListener('scraper-done', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.updateScraper(d.scraper, {
        status: 'done',
        message: `${d.resultCount} found`,
        resultCount: d.resultCount,
      });
    });

    es.addEventListener('scraper-error', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.updateScraper(d.scraper, {
        status: 'error',
        message: d.error || 'Unknown error',
      });
    });

    es.addEventListener('scraper-skipped', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      store.updateScraper(d.scraper, {
        status: 'skipped',
        message: d.reason || 'Skipped',
      });
    });

    es.addEventListener('complete', () => {
      store.finishLive();
      if (timerRef.current) clearInterval(timerRef.current);
    });

    es.addEventListener('search-error', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      // Store the error as a pseudo-scraper entry so the UI can display it
      store.updateScraper('__search-error', {
        name: 'Search',
        status: 'error',
        message: d.message || 'Live search failed',
      });
      store.finishLive();
      if (timerRef.current) clearInterval(timerRef.current);
    });

    // Fallback error handler: detect connection death
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        store.finishLive();
        if (timerRef.current) clearInterval(timerRef.current);
      }
      // If readyState is CONNECTING, EventSource is auto-reconnecting — let it retry
    };

    // ── Cleanup ──
    return () => {
      es.close();
      esRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      store.resetLive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, cabin, program, date, enabled]);
}
