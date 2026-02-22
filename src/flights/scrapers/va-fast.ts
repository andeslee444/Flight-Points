/**
 * VA Fast Scraper — Direct GraphQL API calls using session cookies
 *
 * Uses the session pool to get Akamai cookies, then calls VA's
 * GraphQL SearchOffers API directly. ~2-3s per search vs 30-60s
 * for full browser scrape.
 *
 * Covers all SkyTeam partners: Delta, Air France, KLM, Korean Air, etc.
 *
 * Falls back to full browser scraper if cookies are invalid.
 *
 * Created: 2026-02-19
 */

import type { FlightResult, SearchParams } from '../types.js';
import { getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';
import { searchVirginAtlanticAPI, searchVirginAtlantic } from './virgin-atlantic.js';
import { getSessionCookies, invalidateSession } from './session-pool.js';

const VA_DOMAIN = 'virginatlantic.com';

export async function searchVAFast(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('va-fast', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[VA-Fast] Cache hit');
    return cached;
  }

  // Try direct API with session cookies
  const cookies = await getSessionCookies(VA_DOMAIN);
  if (cookies) {
    console.log(`[VA-Fast] Trying direct API: ${params.origin}→${params.destination} ${params.date}`);
    const results = await searchVirginAtlanticAPI(params, cookies);

    if (results.length > 0) {
      // Tag results as coming from va-fast
      for (const r of results) r.source = 'va-fast';
      setCache(cacheKey, results);
      console.log(`[VA-Fast] API returned ${results.length} results`);
      return results;
    }

    // Empty results could mean cookies expired or genuinely no availability.
    // Invalidate cookies so next search gets fresh ones.
    console.log('[VA-Fast] API returned 0 results — invalidating cookies, falling back to browser');
    invalidateSession(VA_DOMAIN);
  }

  // Fallback to full browser scraper
  console.log('[VA-Fast] Falling back to full browser scraper');
  const fallbackResults = await searchVirginAtlantic(params);
  if (fallbackResults.length > 0) {
    setCache(cacheKey, fallbackResults);
  }
  return fallbackResults;
}

export default { searchVAFast };
