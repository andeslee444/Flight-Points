/**
 * Job producer: turns a flat list of (scraperKey, route, date, cabin) searches
 * into deduplicated, prioritized jobs ready to enqueue.
 *
 * One job per unique (scraperKey, origin, destination, date). Cabin is carried
 * on the job but does NOT participate in identity — a single scraper run for a
 * route/date typically returns all cabins, so two searches differing only in
 * cabin collapse to one job (with the first-seen cabin retained).
 */

import type { CabinCode } from '../types.js';

export interface SearchSpec {
  scraperKey: string;
  params: {
    origin: string;
    destination: string;
    date: string;
    cabin: CabinCode;
  };
}

export interface ScrapeJob {
  scraperKey: string;
  origin: string;
  destination: string;
  date: string;
  cabin: CabinCode;
  /** Priority assigned by the producer (higher dequeues first). */
  priority: number;
  /** Stable identity key — also usable as a queue dedupeKey. */
  dedupeKey: string;
}

/** Identity of a job ignores cabin (one scrape covers all cabins for a route/date). */
function identityKey(scraperKey: string, origin: string, destination: string, date: string): string {
  return `${scraperKey}|${origin}|${destination}|${date}`;
}

/**
 * Build deduplicated jobs from searches.
 *
 * @param searches  flat list of searches (may contain duplicates / cabin variants)
 * @param priorityFn optional priority assignment per search; defaults to 0
 * @returns one job per unique (scraperKey, origin, destination, date), order-stable
 */
export function buildJobs(
  searches: SearchSpec[],
  priorityFn?: (s: SearchSpec) => number,
): ScrapeJob[] {
  const byKey = new Map<string, ScrapeJob>();

  for (const s of searches) {
    const { scraperKey } = s;
    const { origin, destination, date, cabin } = s.params;
    const key = identityKey(scraperKey, origin, destination, date);

    if (byKey.has(key)) {
      // Already produced a job for this identity — keep the higher priority if
      // a later duplicate scores higher, but never create a second job.
      const existing = byKey.get(key)!;
      const p = priorityFn ? priorityFn(s) : 0;
      if (p > existing.priority) existing.priority = p;
      continue;
    }

    byKey.set(key, {
      scraperKey,
      origin,
      destination,
      date,
      cabin,
      priority: priorityFn ? priorityFn(s) : 0,
      dedupeKey: key,
    });
  }

  return Array.from(byKey.values());
}
