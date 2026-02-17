/**
 * Alaska Airlines Mileage Plan Award Search Scraper
 * Shows partner availability without login.
 * Partners: AA, BA, Cathay, JAL, Qatar, Qantas, Emirates, Singapore, Korean Air, etc.
 * 
 * Anti-bot: Medium (Akamai) — generally passable with stealth.
 * 
 * Created: 2026-02-16
 */

import { chromium, BrowserContext } from 'playwright';
import { getStealthManager } from '../../stealth.js';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const RATE_LIMIT_MS = 5000;

const CABIN_MAP: Record<string, string> = {
  economy: 'Coach',
  business: 'Business',
  first: 'First',
};

function buildUrl(params: SearchParams): string {
  // Format date as MM/DD/YYYY
  const [y, m, d] = params.date.split('-');
  const dateStr = `${m}/${d}/${y}`;
  return `https://www.alaskaair.com/shopping/flights?prior=award&tripType=oneway&prior=award&orig=${params.origin}&dest=${params.destination}&departDate=${encodeURIComponent(dateStr)}&adults=${params.passengers || 1}&cabinType=${CABIN_MAP[params.cabin] || 'Business'}`;
}

export async function searchAlaska(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('alaska', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[Alaska] Cache hit for', cacheKey);
    return cached;
  }

  const stealth = getStealthManager();
  const url = buildUrl(params);
  console.log('[Alaska] Searching:', url);

  let context: BrowserContext | null = null;

  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--no-first-run',
      ],
    });

    context = await browser.newContext(stealth.getContextOptions());
    const page = await context.newPage();
    await page.addInitScript(stealth.getStealthScript());

    // Intercept API responses
    const apiFlights: any[] = [];
    page.on('response', async (response) => {
      const respUrl = response.url();
      if (respUrl.includes('/shopping/') || respUrl.includes('/api/flightshopping') || respUrl.includes('availability')) {
        try {
          const json = await response.json();
          if (json?.flights || json?.slices || json?.results) {
            apiFlights.push(json);
          }
        } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(RATE_LIMIT_MS);

    // Wait for results
    try {
      await page.waitForSelector('[class*="flight-result"], [class*="FlightOption"], .option-row, [data-qa*="flight"], .matrix-cell, [class*="result"]', { timeout: 30000 });
    } catch {
      console.log('[Alaska] Could not find flight result selectors');
    }

    await page.waitForTimeout(3000);

    // Parse results from DOM
    const results = await page.evaluate((sp: { origin: string; destination: string; date: string; cabin: string }) => {
      const flights: any[] = [];

      const cards = document.querySelectorAll(
        '[class*="flight-result"], [class*="FlightOption"], .option-row, [class*="result-row"], [class*="flight-option"]'
      );

      cards.forEach((card) => {
        const text = card.textContent || '';

        const flightNumMatch = text.match(/([A-Z]{2})\s*(\d{1,4})/);
        const flightNumber = flightNumMatch ? `${flightNumMatch[1]}${flightNumMatch[2]}` : '';

        const milesMatch = text.match(/([\d,]+)\s*(?:miles|mi)/i);
        const pointsRequired = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

        const taxMatch = text.match(/\$(\d+(?:\.\d{2})?)/);
        const taxesAndFees = taxMatch ? parseFloat(taxMatch[1]) : 0;

        const timeMatches = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/gi);
        const departureTime = timeMatches?.[0] || '';
        const arrivalTime = timeMatches?.[1] || '';

        const stopsText = text.toLowerCase();
        const stops = stopsText.includes('nonstop') ? 0 : stopsText.includes('1 stop') ? 1 : stopsText.includes('2 stop') ? 2 : 0;

        const durationMatch = text.match(/(\d+h\s*\d*m?|\d+\s*hr\s*\d*\s*min)/i);
        const duration = durationMatch?.[0] || '';

        // Detect airline
        const airlineNames = ['American', 'British Airways', 'Cathay Pacific', 'Japan Airlines', 'JAL', 'Qatar', 'Qantas', 'Emirates', 'Singapore Airlines', 'Korean Air', 'Finnair', 'Icelandair', 'Condor', 'Alaska'];
        let airline = 'Alaska Airlines';
        for (const name of airlineNames) {
          if (text.includes(name)) {
            airline = name;
            break;
          }
        }

        if (flightNumber || pointsRequired) {
          flights.push({
            source: 'alaska',
            airline,
            flightNumber,
            origin: sp.origin,
            destination: sp.destination,
            departureDate: sp.date,
            departureTime,
            arrivalTime,
            duration,
            stops,
            cabin: sp.cabin,
            pointsRequired,
            pointsProgram: 'Alaska Mileage Plan',
            taxesAndFees,
            awardType: 'partner',
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      return flights;
    }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

    const typedResults: FlightResult[] = results.map((r: any) => ({
      ...r,
      cabin: params.cabin,
      bookingUrl: url,
    }));

    if (typedResults.length === 0) {
      const content = await page.content();
      if (content.includes('captcha') || content.includes('challenge') || content.includes('blocked')) {
        console.log('[Alaska] Blocked by anti-bot protection');
      } else {
        console.log('[Alaska] No results found. Page length:', content.length);
      }
    }

    setCache(cacheKey, typedResults);
    await context.close();
    await browser.close();

    console.log(`[Alaska] Found ${typedResults.length} results`);
    return typedResults;

  } catch (error: any) {
    console.error('[Alaska] Scraper error:', error.message);
    if (context) try { await context.close(); } catch {}
    return [];
  }
}
