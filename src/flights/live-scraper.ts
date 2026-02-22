/**
 * Live Scraper — On-demand scraping triggered from the web UI
 *
 * When the daemon cache has 0 results for a route, the frontend
 * auto-connects via SSE and this module runs all relevant scrapers
 * in parallel, streaming results back as they arrive.
 */

import type { FlightResult, SearchParams } from './types.js';
import { SCRAPER_REGISTRY, getScrapersForProgram, getScrapersForLiveSearch, deduplicateResults } from './scrapers/index.js';
import { isScraperAvailable, recordSuccess, recordFailure } from './scraper-health.js';
import { SCRAPER_TIMEOUTS, DEFAULT_SCRAPER_TIMEOUT_MS, LIVE_SEARCH_PER_CALL_TIMEOUT_MS, LIVE_SEARCH_DATE_COUNT } from './scraper-config.js';

// ── Concurrency control ─────────────────────────────────────

const MAX_CONCURRENT_LIVE_SCRAPES = 2;
let activeScrapes = 0;

export function canStartLiveScrape(): boolean {
  return activeScrapes < MAX_CONCURRENT_LIVE_SCRAPES;
}

// ── Metro airport collapse ──────────────────────────────────

/**
 * Metro airport groups: award availability is identical across
 * airports in the same metro area, so we only need to search one.
 */
const METRO_GROUPS: Record<string, string> = {
  // NYC
  JFK: 'JFK', LGA: 'JFK', EWR: 'JFK',
  // Tokyo
  NRT: 'NRT', HND: 'NRT',
  // Los Angeles
  LAX: 'LAX', SNA: 'LAX', BUR: 'LAX', LGB: 'LAX',
  // Chicago
  ORD: 'ORD', MDW: 'ORD',
  // San Francisco Bay
  SFO: 'SFO', OAK: 'SFO', SJC: 'SFO',
  // Washington DC
  IAD: 'IAD', DCA: 'IAD',
  // Dallas
  DFW: 'DFW', DAL: 'DFW',
  // Houston
  IAH: 'IAH', HOU: 'IAH',
  // Miami
  MIA: 'MIA',
  // London
  LHR: 'LHR', LGW: 'LHR', LCY: 'LHR',
  // Paris
  CDG: 'CDG', ORY: 'CDG',
  // Seoul
  ICN: 'ICN', GMP: 'ICN',
  // Shanghai
  PVG: 'PVG', SHA: 'PVG',
  // Beijing
  PEK: 'PEK', PKX: 'PEK',
  // Osaka
  KIX: 'KIX', ITM: 'KIX',
};

/**
 * Collapse a list of airports to unique metro representatives.
 * E.g. [JFK, LGA, EWR] → [JFK], [NRT, HND] → [NRT]
 */
export function collapseToRepresentative(airports: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of airports) {
    const rep = METRO_GROUPS[code] || code;
    if (!seen.has(rep)) {
      seen.add(rep);
      result.push(rep);
    }
  }
  return result;
}

// ── Date generation ─────────────────────────────────────────

/**
 * Generate sample dates spread across the next 8 weeks.
 * Starts 7 days out, then every ~14 days: days 7, 21, 35, 49.
 */
export function generateSampleDates(count = 4): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7 + i * 14);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// ── Callback interface ──────────────────────────────────────

export interface LiveScrapeCallbacks {
  onScraperStarted(key: string, name: string): void;
  onScraperProgress(key: string, message: string, date?: string): void;
  onResult(flight: FlightResult, scraperKey: string): void;
  onScraperDone(key: string, name: string, count: number): void;
  onScraperError(key: string, name: string, error: string): void;
  onScraperSkipped(key: string, name: string, reason: string): void;
  onComplete(summary: LiveScrapeSummary): void;
}

export interface LiveScrapeSummary {
  totalResults: number;
  scrapersRun: number;
  scrapersSucceeded: number;
  scrapersFailed: number;
}

// ── Main function ───────────────────────────────────────────

export async function runLiveScrape(
  origins: string[],
  dests: string[],
  cabin: 'economy' | 'business' | 'first',
  programSlug: string,
  date: string | undefined,
  callbacks: LiveScrapeCallbacks,
  signal?: AbortSignal,
): Promise<FlightResult[]> {
  activeScrapes++;
  const allResults: FlightResult[] = [];
  let scrapersRun = 0;
  let scrapersSucceeded = 0;
  let scrapersFailed = 0;

  try {
    // Collapse metro airports: JFK,LGA,EWR → JFK; NRT,HND → NRT
    const collapsedOrigins = collapseToRepresentative(origins);
    let collapsedDests = collapseToRepresentative(dests);
    if (collapsedOrigins.length < origins.length || collapsedDests.length < dests.length) {
      console.log(`[LiveScrape] Collapsed: [${origins}]→[${collapsedOrigins}], [${dests}]→[${collapsedDests}]`);
    }

    // Cap destinations to avoid very long searches (e.g. "Italy" = 14 airports)
    const MAX_LIVE_DESTS = 3;
    if (collapsedDests.length > MAX_LIVE_DESTS) {
      console.log(`[LiveScrape] Capping destinations from ${collapsedDests.length} to ${MAX_LIVE_DESTS}: [${collapsedDests.slice(0, MAX_LIVE_DESTS)}] (dropped: [${collapsedDests.slice(MAX_LIVE_DESTS)}])`);
      collapsedDests = collapsedDests.slice(0, MAX_LIVE_DESTS);
    }

    // Use deduplicated scrapers (1 per alliance) and fewer dates for live search
    const scraperKeys = getScrapersForLiveSearch(programSlug);
    const dates = date ? [date] : generateSampleDates(LIVE_SEARCH_DATE_COUNT);

    console.log(`[LiveScrape] Starting for ${programSlug}: scrapers=${scraperKeys.join(',')}, origins=${collapsedOrigins}, dests=${collapsedDests}, dates=${dates.join(',')}`);

    const scraperPromises = scraperKeys.map(async (key) => {
      const entry = SCRAPER_REGISTRY[key];
      if (!entry) return;

      // Skip blocked scrapers
      if (entry.status === 'blocked') {
        callbacks.onScraperSkipped(key, entry.name, 'Scraper is blocked');
        return;
      }

      // Skip circuit-broken scrapers
      if (!isScraperAvailable(key)) {
        callbacks.onScraperSkipped(key, entry.name, 'Temporarily disabled (circuit breaker)');
        return;
      }

      scrapersRun++;
      callbacks.onScraperStarted(key, entry.name);

      const perCallTimeout = LIVE_SEARCH_PER_CALL_TIMEOUT_MS;
      let scraperResults: FlightResult[] = [];

      try {
        // Run each origin x dest x date sequentially within this scraper
        for (const origin of collapsedOrigins) {
          if (signal?.aborted) break;
          for (const dest of collapsedDests) {
            if (signal?.aborted) break;
            for (const date of dates) {
              if (signal?.aborted) break;
              callbacks.onScraperProgress(key, `Searching ${origin}-${dest} ${date}...`, date);

              const params: SearchParams = { origin, destination: dest, date, cabin };

              try {
                const result = await Promise.race([
                  entry.search(params),
                  new Promise<FlightResult[]>((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout after ${perCallTimeout}ms`)), perCallTimeout)
                  ),
                ]);

                if (signal?.aborted) break;

                if (result.length > 0) {
                  scraperResults.push(...result);
                  for (const flight of result) {
                    callbacks.onResult(flight, key);
                  }
                }
              } catch (searchErr: any) {
                // Per-search timeout: log and continue to next date
                console.warn(`[LiveScrape] ${key} ${origin}-${dest} ${date}: ${searchErr.message}`);
                callbacks.onScraperProgress(key, `${origin}-${dest} ${date} timed out, moving on...`, date);
              }
            }
          }
        }

        if (signal?.aborted) {
          console.log(`[LiveScrape] ${key} aborted (client disconnected)`);
          return;
        }

        recordSuccess(key);
        scrapersSucceeded++;
        callbacks.onScraperDone(key, entry.name, scraperResults.length);
      } catch (err: any) {
        if (signal?.aborted) return;
        recordFailure(key);
        scrapersFailed++;
        callbacks.onScraperError(key, entry.name, err.message || 'Unknown error');
      }

      allResults.push(...scraperResults);
    });

    await Promise.allSettled(scraperPromises);

    const deduplicated = deduplicateResults(allResults);

    if (signal?.aborted) {
      console.log(`[LiveScrape] Aborted — client disconnected. ${deduplicated.length} results collected before abort.`);
      return deduplicated;
    }

    callbacks.onComplete({
      totalResults: deduplicated.length,
      scrapersRun,
      scrapersSucceeded,
      scrapersFailed,
    });

    return deduplicated;
  } finally {
    activeScrapes--;
  }
}
