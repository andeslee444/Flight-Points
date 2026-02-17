/**
 * Scraper Registry
 * 
 * Maps airline programs to scrapers and determines which scrapers
 * to run for a given user's points program.
 * 
 * Key insight: A few airline search tools show PARTNER availability
 * across their entire alliance. So ~4 scrapers cover ~80% of flights:
 *   - United → all Star Alliance
 *   - AA → all oneworld  
 *   - Delta → all SkyTeam (often blocked)
 *   - Flying Blue → SkyTeam alternative
 *   - Google Flights → cash prices for CPP
 * 
 * Created: 2026-02-16
 * Rewritten: 2026-02-16 — own scrapers, no seats.aero
 */

import { searchUnited } from './united.js';
import { searchAA } from './aa.js';
import { searchDelta } from './delta.js';
import { searchBAAvios } from './ba-avios.js';
import { searchAeroplan } from './aeroplan.js';
import { searchANA } from './ana.js';
import { searchAlaska } from './alaska.js';
import { searchFlyingBlue } from './flying-blue.js';
import { searchVirginAtlantic } from './virgin-atlantic.js';
import { searchJetBlue } from './jetblue.js';
import { searchSingaporeAirlines } from './singapore.js';
import { searchSQCamoufox } from './sq-camoufox.js';
import { searchGoogleFlights } from './google-flights.js';
import { searchCathay } from './cathay.js';
import type { FlightResult, SearchParams } from '../types.js';
import { getTransferPartnersForProgram, type TransferPartner } from '../transfer-partners.js';

// ============================================================
// SCRAPER REGISTRY
// ============================================================

export interface ScraperEntry {
  name: string;
  covers: string[];  // alliances covered
  search: (params: SearchParams) => Promise<FlightResult[]>;
  status: 'active' | 'testing' | 'blocked' | 'needs-login';
  coversPrograms: string[];  // program codes this scraper can search for
}

export const SCRAPER_REGISTRY: Record<string, ScraperEntry> = {
  // --- Tier 1: Primary alliance gateways ---
  'united': {
    name: 'United MileagePlus',
    covers: ['star'],
    search: searchUnited,
    status: 'blocked',  // 2026-02-16: headless Chromium blocked by Akamai anti-bot
    coversPrograms: ['united', 'aeroplan', 'ana', 'singapore', 'turkish', 'avianca-lifemiles'],
  },
  'aa': {
    name: 'American AAdvantage',
    covers: ['oneworld'],
    search: searchAA,
    status: 'active',  // 2026-02-16: working via direct URL with slices param
    coversPrograms: ['american', 'ba-avios', 'qantas'],
  },
  'flying-blue': {
    name: 'Air France/KLM Flying Blue',
    covers: ['skyteam'],
    search: searchFlyingBlue,
    status: 'blocked',  // 2026-02-16: headless Chromium blocked
    coversPrograms: ['air-france-klm', 'delta'],
  },
  'alaska': {
    name: 'Alaska Mileage Plan',
    covers: ['oneworld', 'independent'],
    search: searchAlaska,
    status: 'blocked',  // 2026-02-16: headless Chromium blocked by Akamai
    coversPrograms: ['emirates'],
  },
  'google-flights': {
    name: 'Google Flights',
    covers: ['cash-prices'],
    search: searchGoogleFlights,
    status: 'active',
    coversPrograms: [],
  },

  // --- Tier 2: Supplementary ---
  'delta': {
    name: 'Delta SkyMiles',
    covers: ['skyteam'],
    search: searchDelta,
    status: 'testing',  // Shape Security often blocks
    coversPrograms: ['delta'],
  },
  'ba-avios': {
    name: 'British Airways Avios',
    covers: ['oneworld'],
    search: searchBAAvios,
    status: 'testing',  // Akamai blocks frequently
    coversPrograms: ['ba-avios'],
  },
  'aeroplan': {
    name: 'Air Canada Aeroplan',
    covers: ['star'],
    search: searchAeroplan,
    status: 'needs-login',
    coversPrograms: ['aeroplan'],
  },
  'ana': {
    name: 'ANA Mileage Club',
    covers: ['star'],
    search: searchANA,
    status: 'active',  // 2026-02-16: credentials configured (ANA_USERNAME/ANA_PASSWORD)
    coversPrograms: ['ana'],
  },
  'virgin-atlantic': {
    name: 'Virgin Atlantic Flying Club',
    covers: ['skyteam'],
    search: searchVirginAtlantic,
    status: 'testing',  // GraphQL API via Playwright — needs Akamai session
    coversPrograms: ['virgin-atlantic', 'delta', 'air-france-klm'],
  },
  'singapore': {
    name: 'Singapore Airlines KrisFlyer',
    covers: ['star'],
    search: searchSQCamoufox,
    status: 'active',  // 2026-02-17: Camoufox + seats.aero fallback (SQ_KRISFLYER_ID/SQ_KRISFLYER_PASSWORD)
    coversPrograms: ['singapore'],
  },
  'jetblue': {
    name: 'JetBlue TrueBlue',
    covers: [],
    search: searchJetBlue,
    status: 'active',
    coversPrograms: [],
  },
  'cathay': {
    name: 'Cathay Pacific Asia Miles',
    covers: ['oneworld'],
    search: searchCathay,
    status: 'active',  // 2026-02-16: seats.aero works (qantas/qatar sources show CX metal); website scraper needs login
    coversPrograms: ['cathay-asia-miles'],
  },
};

// Also export as SCRAPERS for backward compat
export const SCRAPERS = SCRAPER_REGISTRY;

// ============================================================
// ALLIANCE → SCRAPER MAPPING
// ============================================================

const ALLIANCE_TO_PRIMARY_SCRAPER: Record<string, string> = {
  'star': 'united',
  'oneworld': 'aa',
  'skyteam': 'flying-blue',
  'independent': 'alaska',
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Get the best scraper for a transfer partner.
 */
export function getScraperForPartner(partner: TransferPartner): string | null {
  // Check if there's a scraper that directly covers this program
  for (const [key, entry] of Object.entries(SCRAPER_REGISTRY)) {
    if (entry.coversPrograms.includes(partner.programCode) &&
        entry.status !== 'blocked') {
      return key;
    }
  }
  // Fallback: use alliance-based primary scraper
  return ALLIANCE_TO_PRIMARY_SCRAPER[partner.alliance] || null;
}

/**
 * Determine which scrapers to run for a user's points program.
 * Returns deduplicated list of scraper keys.
 */
export function getScrapersForProgram(programSlug: string): string[] {
  const partners = getTransferPartnersForProgram(programSlug);
  const scraperKeys = new Set<string>();

  for (const partner of partners) {
    const scraper = getScraperForPartner(partner);
    if (scraper) scraperKeys.add(scraper);
  }

  return Array.from(scraperKeys);
}

/**
 * Run all relevant scrapers for a search, plus Google Flights for cash prices.
 * Runs in parallel with timeout.
 */
export async function searchAll(
  params: SearchParams,
  programSlug: string,
  timeoutMs: number = 60000,
): Promise<{ awards: FlightResult[]; cashPrices: FlightResult[] }> {
  const scraperKeys = getScrapersForProgram(programSlug);
  console.log(`[Registry] Running scrapers for ${programSlug}: ${scraperKeys.join(', ')}`);

  // Run award scrapers in parallel
  const awardPromises = scraperKeys.map(key => {
    const entry = SCRAPER_REGISTRY[key];
    if (!entry || entry.status === 'blocked') return Promise.resolve([]);

    return Promise.race([
      entry.search(params).catch((err: any) => {
        console.error(`[Registry] ${key} failed: ${err.message}`);
        return [] as FlightResult[];
      }),
      new Promise<FlightResult[]>((resolve) =>
        setTimeout(() => {
          console.warn(`[Registry] ${key} timed out after ${timeoutMs}ms`);
          resolve([]);
        }, timeoutMs)
      ),
    ]);
  });

  // Run Google Flights for cash prices
  const cashPromise = Promise.race([
    searchGoogleFlights(params).catch(() => [] as FlightResult[]),
    new Promise<FlightResult[]>((resolve) =>
      setTimeout(() => resolve([]), timeoutMs)
    ),
  ]);

  const [awardResults, cashPrices] = await Promise.all([
    Promise.allSettled(awardPromises).then(results =>
      results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    ),
    cashPromise,
  ]);

  console.log(`[Registry] Total: ${awardResults.length} award results, ${cashPrices.length} cash prices`);

  return { awards: awardResults, cashPrices };
}

/**
 * Deduplicate results by flight number + date.
 */
export function deduplicateResults(results: FlightResult[]): FlightResult[] {
  const seen = new Map<string, FlightResult>();

  for (const result of results) {
    const key = result.flightNumber
      ? `${result.flightNumber}-${result.departureDate}-${result.cabin}`
      : `${result.source}-${result.origin}-${result.destination}-${result.departureDate}-${result.departureTime}-${result.cabin}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, result);
    } else {
      // Keep the one with more data
      const score = (r: FlightResult) =>
        (r.pointsRequired ? 1 : 0) + (r.departureTime ? 1 : 0) + (r.duration ? 1 : 0);
      if (score(result) > score(existing)) {
        seen.set(key, result);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Get scraper status summary.
 */
export function getScraperStatus(): Record<string, { name: string; status: string; covers: string[] }> {
  const status: Record<string, any> = {};
  for (const [key, s] of Object.entries(SCRAPER_REGISTRY)) {
    status[key] = { name: s.name, status: s.status, covers: s.covers };
  }
  return status;
}

export default { SCRAPER_REGISTRY, getScraperForPartner, getScrapersForProgram, searchAll, deduplicateResults };
