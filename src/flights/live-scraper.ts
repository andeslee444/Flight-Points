/**
 * Live Scraper — On-demand scraping triggered from the web UI
 *
 * When the daemon cache has 0 results for a route, the frontend
 * auto-connects via SSE and this module runs all relevant scrapers
 * in parallel, streaming results back as they arrive.
 */

import type { FlightResult, SearchParams } from './types.js';
import { SCRAPER_REGISTRY, getScrapersForProgram, deduplicateResults } from './scrapers/index.js';
import { isScraperAvailable, recordSuccess, recordFailure } from './scraper-health.js';
import { SCRAPER_TIMEOUTS, DEFAULT_SCRAPER_TIMEOUT_MS } from './scraper-config.js';

// ── Concurrency control ─────────────────────────────────────

const MAX_CONCURRENT_LIVE_SCRAPES = 2;
let activeScrapes = 0;

export function canStartLiveScrape(): boolean {
  return activeScrapes < MAX_CONCURRENT_LIVE_SCRAPES;
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
  onResult(flight: FlightResult): void;
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
  callbacks: LiveScrapeCallbacks,
): Promise<FlightResult[]> {
  activeScrapes++;
  const allResults: FlightResult[] = [];
  let scrapersRun = 0;
  let scrapersSucceeded = 0;
  let scrapersFailed = 0;

  try {
    const scraperKeys = getScrapersForProgram(programSlug);
    const dates = generateSampleDates();

    console.log(`[LiveScrape] Starting for ${programSlug}: scrapers=${scraperKeys.join(',')}, origins=${origins}, dests=${dests}, dates=${dates.join(',')}`);

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

      const timeoutMs = SCRAPER_TIMEOUTS[key] || DEFAULT_SCRAPER_TIMEOUT_MS;
      let scraperResults: FlightResult[] = [];

      try {
        // Run each origin x dest x date sequentially within this scraper
        for (const origin of origins) {
          for (const dest of dests) {
            for (const date of dates) {
              callbacks.onScraperProgress(key, `Searching ${origin}-${dest} ${date}...`, date);

              const params: SearchParams = { origin, destination: dest, date, cabin };

              const result = await Promise.race([
                entry.search(params),
                new Promise<FlightResult[]>((_, reject) =>
                  setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
                ),
              ]);

              if (result.length > 0) {
                scraperResults.push(...result);
                for (const flight of result) {
                  callbacks.onResult(flight);
                }
              }
            }
          }
        }

        recordSuccess(key);
        scrapersSucceeded++;
        callbacks.onScraperDone(key, entry.name, scraperResults.length);
      } catch (err: any) {
        recordFailure(key);
        scrapersFailed++;
        callbacks.onScraperError(key, entry.name, err.message || 'Unknown error');
      }

      allResults.push(...scraperResults);
    });

    await Promise.allSettled(scraperPromises);

    const deduplicated = deduplicateResults(allResults);

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
