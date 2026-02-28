'use client';

import { create } from 'zustand';

// ── Types ──────────────────────────────────────────────────

export type ScraperStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface ScraperState {
  key: string;
  name: string;
  status: ScraperStatus;
  message: string;
  resultCount: number;
}

/**
 * Shape of a live result as received from the Harbor SSE endpoint.
 *
 * Harbor's enrichFlightResult() produces a superset of these fields.
 * We store them as-is (not as EnrichedDeal) because the Harbor enrichment
 * does not include all EnrichedDeal fields (missing transferFrom, sweetSpot,
 * region, transferBonuses, scrapedAt). The component layer maps these to
 * EnrichedDeal-compatible objects for rendering via FlightResultCard.
 */
export interface LiveFlightResult {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  cabin: string;
  pointsRequired: number;
  pointsProgram: string;
  points: number;
  taxes: number;
  cpp: number | undefined;
  dealRating: 'hot' | 'good' | 'fair' | 'unknown';
  cabinDisplay: string;
  route: string;
  direct: boolean;
  program: string;
  programDisplay: string;
  transferPath: string;
  bookingUrl: string;
  source: string;
  awardType?: string;
  cashPrice?: number;
}

// ── Store ──────────────────────────────────────────────────

interface LiveSearchState {
  // Connection state
  isLive: boolean;
  elapsedSeconds: number;
  // Results accumulation
  liveResults: LiveFlightResult[];
  seenKeys: Set<string>;
  // Per-scraper status
  scrapers: Record<string, ScraperState>;
  // Actions
  startLive: () => void;
  resetLive: () => void;
  addResult: (flight: LiveFlightResult) => void;
  updateScraper: (key: string, patch: Partial<ScraperState>) => void;
  setElapsed: (s: number) => void;
  finishLive: () => void;
}

export const useLiveSearchStore = create<LiveSearchState>()((set) => ({
  isLive: false,
  elapsedSeconds: 0,
  liveResults: [],
  seenKeys: new Set<string>(),
  scrapers: {},

  startLive: () =>
    set({
      isLive: true,
      liveResults: [],
      seenKeys: new Set<string>(),
      scrapers: {},
      elapsedSeconds: 0,
    }),

  resetLive: () =>
    set({
      isLive: false,
      liveResults: [],
      seenKeys: new Set<string>(),
      scrapers: {},
      elapsedSeconds: 0,
    }),

  addResult: (flight) =>
    set((state) => {
      const key = `${flight.airline}-${flight.flightNumber}-${flight.departureDate}-${flight.cabin}`;
      if (state.seenKeys.has(key)) return {};
      const newSeen = new Set(state.seenKeys);
      newSeen.add(key);
      return {
        liveResults: [...state.liveResults, flight],
        seenKeys: newSeen,
      };
    }),

  updateScraper: (scraperKey, patch) =>
    set((state) => {
      const existing = state.scrapers[scraperKey];
      const defaults: ScraperState = {
        key: scraperKey,
        name: '',
        status: 'pending',
        message: '',
        resultCount: 0,
      };
      return {
        scrapers: {
          ...state.scrapers,
          [scraperKey]: {
            ...defaults,
            ...existing,
            ...patch,
          },
        },
      };
    }),

  setElapsed: (s) => set({ elapsedSeconds: s }),

  finishLive: () => set({ isLive: false }),
}));
