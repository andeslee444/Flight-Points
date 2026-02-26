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
import { searchVAFast } from './va-fast.js';
import { searchJetBlue } from './jetblue.js';
import { searchJetBlueApi } from './jetblue-api.js';
import { searchSingaporeAirlines } from './singapore.js';
import { searchSQCamoufox } from './sq-camoufox.js';
import { searchDeltaViaCamoufox } from './delta-va-camoufox.js';
import { searchUnitedViaAeroplan } from './united-aeroplan-camoufox.js';
import { searchGoogleFlights } from './google-flights.js';
import { searchCathay } from './cathay.js';
import { searchCathayCurlFfi } from './cathay-curlffi.js';
import { searchAACamoufox } from './aa-camoufox.js';
import { searchBACamoufox } from './ba-camoufox.js';
import { searchANACamoufox } from './ana-camoufox.js';
import { searchDeltaViaPatchright } from './delta-va-patchright.js';
import { searchDeltaViaCurlFfi } from './delta-va-curlffi.js';
import { searchAACurlFfi } from './aa-curlffi.js';
import { searchAlaskaCurlFfi } from './alaska-curlffi.js';
import { searchAAPatchright } from './aa-patchright.js';
import { searchSQPatchright } from './sq-patchright.js';
import { searchSQCurlFfi } from './sq-curlffi.js';
import { searchUnitedViaAeroplanPatchright } from './united-aeroplan-patchright.js';
import { searchFlyingBluePatchright } from './flying-blue-patchright.js';
import { searchAlaskaPatchright } from './alaska-patchright.js';
import { searchANAPatchright } from './ana-patchright.js';
import { searchFlyingBlueCurlFfi } from './flying-blue-curlffi.js';
import { searchUnitedViaAeroplanCurlFfi } from './united-aeroplan-curlffi.js';
import { searchAACdp } from './aa-cdp.js';
import { searchUnitedCdp } from './united-cdp.js';
import { searchUnitedViaAeroplanCdp } from './united-aeroplan-cdp.js';
import { searchFlyingBlueCdp } from './flying-blue-cdp.js';
import { searchTurkishApi } from './turkish-api.js';
import type { FlightResult, SearchParams, AvailabilityType } from '../types.js';
import { getTransferPartnersForProgram, type TransferPartner } from '../transfer-partners.js';

// ============================================================
// FALLBACK CHAINS (Camoufox → Patchright → Playwright for AA)
// ============================================================

async function searchAAWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // Real Chrome CDP FIRST — bypasses Akamai (no automation flags)
  try {
    const results = await searchAACdp(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] AA CDP failed: ${err.message}`);
  }
  // curl_cffi second — fast (~5s), direct API call with Chrome 131 TLS impersonation
  try {
    const results = await searchAACurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] AA CurlFfi failed: ${err.message}`);
  }
  // Patchright third (currently often blocked by Akamai)
  try {
    const results = await searchAAPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] AA Patchright failed: ${err.message}`);
  }
  // Camoufox fourth
  try {
    const results = await searchAACamoufox(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] AA Camoufox failed: ${err.message}`);
  }
  return searchAA(params);
}

async function searchDeltaWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // curl_cffi FIRST — fastest (~2-3s), Chrome 131 TLS impersonation
  try {
    const results = await searchDeltaViaCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA CurlFfi failed: ${err.message}`);
  }
  try {
    const results = await searchDeltaViaPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA Patchright failed: ${err.message}`);
  }
  try {
    const results = await searchDeltaViaCamoufox(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA Camoufox failed: ${err.message}`);
  }
  return searchDelta(params);
}

async function searchUnitedWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // United.com direct via Chrome CDP — bypasses Akamai, no Aeroplan login needed
  try {
    const results = await searchUnitedCdp(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] United CDP failed: ${err.message}`);
  }
  // Aeroplan CDP fallback (blocked by Gigya reCAPTCHA)
  try {
    const results = await searchUnitedViaAeroplanCdp(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] UA-Aeroplan CDP failed: ${err.message}`);
  }
  // Cookie farm + curl_cffi second
  try {
    const results = await searchUnitedViaAeroplanCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] UA-Aeroplan CurlFfi failed: ${err.message}`);
  }
  try {
    const results = await searchUnitedViaAeroplanPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] UA-Aeroplan Patchright failed: ${err.message}`);
  }
  try {
    const results = await searchUnitedViaAeroplan(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] UA-Aeroplan Camoufox failed: ${err.message}`);
  }
  return searchUnited(params);
}

async function searchVirginAtlanticWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // curl_cffi FIRST — fastest (~2-3s), Chrome 131 TLS impersonation
  try {
    const results = await searchDeltaViaCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA CurlFfi (for VA) failed: ${err.message}`);
  }
  try {
    const results = await searchDeltaViaPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA Patchright (for VA) failed: ${err.message}`);
  }
  try {
    const results = await searchDeltaViaCamoufox(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Delta-VA Camoufox (for VA) failed: ${err.message}`);
  }
  return searchVirginAtlantic(params);
}

async function searchANAWithFallback(params: SearchParams): Promise<FlightResult[]> {
  try {
    const results = await searchANAPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] ANA Patchright failed: ${err.message}`);
  }
  try {
    const results = await searchANACamoufox(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] ANA Camoufox failed: ${err.message}`);
  }
  return searchANA(params);
}

async function searchFlyingBlueWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // Real Chrome CDP FIRST — bypasses Akamai (no automation flags)
  try {
    const results = await searchFlyingBlueCdp(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] FlyingBlue CDP failed: ${err.message}`);
  }
  // Cookie farm + curl_cffi second
  try {
    const results = await searchFlyingBlueCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] FlyingBlue CurlFfi failed: ${err.message}`);
  }
  try {
    const results = await searchFlyingBluePatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] FlyingBlue Patchright failed: ${err.message}`);
  }
  return searchFlyingBlue(params);
}

async function searchAlaskaWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // curl_cffi FIRST — fastest (~5s), SvelteKit __data.json bypasses bot check
  try {
    const results = await searchAlaskaCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Alaska CurlFfi failed: ${err.message}`);
  }
  try {
    const results = await searchAlaskaPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Alaska Patchright failed: ${err.message}`);
  }
  return searchAlaska(params);
}

async function searchCathayWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // curl_cffi FIRST — uses Cathay's public AFR API (no auth, ~2s)
  try {
    const results = await searchCathayCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] Cathay CurlFfi failed: ${err.message}`);
  }
  return searchCathay(params);
}

async function searchJetBlueWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // Fast REST API — no auth, no anti-bot (~1-2s)
  try {
    const results = await searchJetBlueApi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] JetBlue API failed: ${err.message}`);
  }
  // Playwright fallback (slow ~30s, fragile DOM parsing)
  return searchJetBlue(params);
}

async function searchSQWithFallback(params: SearchParams): Promise<FlightResult[]> {
  // curl_cffi FIRST — fastest (~2-3s), Chrome 131 TLS impersonation
  try {
    const results = await searchSQCurlFfi(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] SQ CurlFfi failed: ${err.message}`);
  }
  try {
    const results = await searchSQPatchright(params);
    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn(`[Registry] SQ Patchright failed: ${err.message}`);
  }
  return searchSQCamoufox(params);
}

// ============================================================
// SCRAPER REGISTRY
// ============================================================

export interface ScraperEntry {
  name: string;
  covers: string[];  // alliances covered
  search: (params: SearchParams) => Promise<FlightResult[]>;
  status: 'active' | 'testing' | 'blocked' | 'needs-login';
  coversPrograms: string[];  // program codes this scraper can search for
  supportsNearbyAirports?: boolean;  // true = scraper includes nearby airports in results (e.g. AA origNearby=True)
  availabilityType: AvailabilityType;  // 'confirmed' | 'calendar' | 'estimated' — controls price_history write gate
}

export const SCRAPER_REGISTRY: Record<string, ScraperEntry> = {
  // --- Tier 1: Primary alliance gateways ---
  'united': {
    name: 'United MileagePlus',
    covers: ['star'],
    search: searchUnitedWithFallback,
    status: 'blocked',  // 2026-02-24: United.com direct CDP works but requires SMS OTP every login; Aeroplan blocked by Gigya reCAPTCHA
    coversPrograms: ['united', 'aeroplan', 'ana', 'singapore', 'avianca-lifemiles'],
    availabilityType: 'confirmed',  // returns real bookable seats with point prices
  },
  'aa': {
    name: 'American AAdvantage',
    covers: ['oneworld'],
    search: searchAAWithFallback,
    status: 'active',  // 2026-02-22: Real Chrome CDP WORKING — 124 results JFK→LHR, ~20s, full Akamai bypass
    coversPrograms: ['american', 'ba-avios', 'qantas'],
    supportsNearbyAirports: true,  // origNearby=True / originNearbyAirports=True in search params
    availabilityType: 'confirmed',  // real prices from AA award search results page / API
  },
  'flying-blue': {
    name: 'Air France/KLM Flying Blue',
    covers: ['skyteam'],
    search: searchFlyingBlueWithFallback,
    status: 'active',  // 2026-02-22: Real Chrome CDP WORKING — 22 business results JFK→CDG, ~50s, form-fill + calendar + DOM parse. Requires one-time login (OTP)
    coversPrograms: ['air-france-klm', 'delta'],
    availabilityType: 'confirmed',  // individual flight prices parsed from DOM/GQL — real bookable fares
  },
  'alaska': {
    name: 'Alaska Mileage Plan',
    covers: ['oneworld', 'independent'],
    search: searchAlaskaWithFallback,
    status: 'active',  // 2026-02-21: curl_cffi WORKING (34 results SEA->LAX via SvelteKit __data.json, bypasses bot check)
    coversPrograms: ['emirates'],
    availabilityType: 'confirmed',  // real prices from Alaska SvelteKit __data.json
  },
  'google-flights': {
    name: 'Google Flights',
    covers: ['cash-prices'],
    search: searchGoogleFlights,
    status: 'active',
    coversPrograms: [],
    availabilityType: 'confirmed',  // cash prices — confirmed fares, used for CPP calculation
  },

  // --- Tier 1b: Fast API scrapers (for live search) ---
  'va-fast': {
    name: 'Virgin Atlantic (Fast API)',
    covers: ['skyteam'],
    search: searchVAFast,
    status: 'blocked',  // 2026-02-19: session cookies expire (HTTP 444), fallback killed by timeout
    coversPrograms: ['virgin-atlantic', 'delta', 'air-france-klm'],
    availabilityType: 'confirmed',  // real prices from VA fast API
  },

  'turkish': {
    name: 'Turkish Miles&Smiles',
    covers: ['star'],
    search: searchTurkishApi,
    status: 'active',  // 2026-02-26: Official API — no browser, no anti-bot, ~2-5s. TK-operated flights only.
    coversPrograms: ['turkish'],
    availabilityType: 'confirmed',  // official TK API — pending credential test, confirmed for now
  },

  // --- Tier 2: Supplementary ---
  'delta': {
    name: 'Delta SkyMiles',
    covers: ['skyteam'],
    search: searchDeltaWithFallback,
    status: 'active',  // 2026-02-21: curl_cffi WORKING (5 results JFK->LHR via VA GraphQL, ~12s with login)
    coversPrograms: ['delta'],
    availabilityType: 'confirmed',  // real prices from VA GraphQL (delta-va-curlffi)
  },
  'ba-avios': {
    name: 'British Airways Avios',
    covers: ['oneworld'],
    search: searchBAAvios,
    status: 'blocked',  // 2026-02-19: Auth0 CAPTCHA blocks login (both Camoufox and Playwright)
    coversPrograms: ['ba-avios'],
    availabilityType: 'confirmed',  // returns real bookable award prices (when unblocked)
  },
  'aeroplan': {
    name: 'Air Canada Aeroplan',
    covers: ['star'],
    search: searchAeroplan,
    status: 'blocked',  // 2026-02-19: Akamai 403 on award search URL
    coversPrograms: ['aeroplan'],
    availabilityType: 'confirmed',  // returns real bookable award prices (when unblocked)
  },
  'ana': {
    name: 'ANA Mileage Club',
    covers: ['star'],
    search: searchANAWithFallback,
    status: 'blocked',  // 2026-02-20: Cookie consent fix works, but "heavy traffic" anti-bot blocks after login; needs residential proxy or time
    coversPrograms: ['ana'],
    availabilityType: 'confirmed',  // returns real bookable award prices (when unblocked)
  },
  'virgin-atlantic': {
    name: 'Virgin Atlantic Flying Club',
    covers: ['skyteam'],
    search: searchVirginAtlanticWithFallback,
    status: 'active',  // 2026-02-21: curl_cffi WORKING (5 results JFK->LHR via VA GraphQL, ~12s with login)
    coversPrograms: ['virgin-atlantic', 'delta', 'air-france-klm'],
    availabilityType: 'confirmed',  // real prices from VA GraphQL (delta-va-curlffi reused)
  },
  'singapore': {
    name: 'Singapore Airlines KrisFlyer',
    covers: ['star'],
    search: searchSQWithFallback,
    status: 'blocked',  // 2026-02-21: Login blocked by 428 JS challenge (not IP-based); histogram returns cash prices only, not award miles
    coversPrograms: ['singapore'],
    availabilityType: 'confirmed',  // returns real bookable award prices (when unblocked)
  },
  'jetblue': {
    name: 'JetBlue TrueBlue',
    covers: ['independent'],
    search: searchJetBlueWithFallback,
    status: 'active',  // 2026-02-26: Fast REST API working — no auth, no anti-bot, ~1-2s
    coversPrograms: ['jetblue'],
    availabilityType: 'confirmed',  // direct JetBlue REST API returns real bookable point prices
  },
  'cathay': {
    name: 'Cathay Pacific Asia Miles',
    covers: ['oneworld'],
    search: searchCathayWithFallback,
    status: 'active',  // 2026-02-21: AFR API working — calendar-level availability for CX routes to/from HKG, no auth needed
    coversPrograms: ['cathay-asia-miles'],
    availabilityType: 'calendar',  // AFR API returns H/L/NA availability codes only — no real point prices per flight
  },
};

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
 * Returns ALL scrapers that cover any of the user's transfer partners
 * (including blocked ones so the UI can show their status).
 */
export function getScrapersForProgram(programSlug: string): string[] {
  const partners = getTransferPartnersForProgram(programSlug);
  const programCodes = new Set(partners.map(p => p.programCode));
  const alliances = new Set(partners.map(p => p.alliance));
  const scraperKeys = new Set<string>();

  for (const [key, entry] of Object.entries(SCRAPER_REGISTRY)) {
    // Include if this scraper covers any of the user's program codes
    if (entry.coversPrograms.some(pc => programCodes.has(pc))) {
      scraperKeys.add(key);
      continue;
    }
    // Include if this scraper covers an alliance the user has partners in
    if (entry.covers.some(a => alliances.has(a))) {
      scraperKeys.add(key);
    }
  }

  return Array.from(scraperKeys);
}

// ============================================================
// LIVE SEARCH OPTIMIZATION
// ============================================================

/**
 * Get all relevant scrapers for live search — includes every active scraper
 * for the program. They run in parallel and deduplicateResults() handles overlap.
 * Blocked scrapers are still included so the UI can show their status.
 */
export function getScrapersForLiveSearch(programSlug: string): string[] {
  const allKeys = getScrapersForProgram(programSlug);
  return [...new Set(allKeys)];
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

export default { SCRAPER_REGISTRY, getScraperForPartner, getScrapersForProgram, getScrapersForLiveSearch, searchAll, deduplicateResults, getScraperStatus };
