/**
 * Delta SkyMiles Award Search Scraper
 * 
 * Delta.com shows SkyTeam partner award availability:
 * Air France/KLM, Korean Air, Virgin Atlantic, China Airlines, etc.
 * 
 * URL: https://www.delta.com/flight-search/search?tripType=ONE_WAY&awardTravel=true
 *   &originCity={FROM}&destinationCity={TO}&departureDate={YYYY-MM-DD}&cabinType={CABIN}
 * 
 * NOTE: Delta uses heavy bot protection (Shape Security / PerimeterX).
 * This scraper may get blocked. Consider it best-effort.
 * 
 * Created: 2026-02-16
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { FlightResult, SearchParams, CabinCode } from '../types.js';
import { getStealthManager } from '../../stealth.js';
import { getCached, setCache } from './cache.js';

const DELTA_CABIN_MAP: Record<CabinCode, string> = {
  economy: 'MAIN',
  business: 'BUSINESS', // Delta One
  first: 'FIRST',
};

const AIRLINE_NAMES: Record<string, string> = {
  'DL': 'Delta',
  'AF': 'Air France',
  'KL': 'KLM',
  'KE': 'Korean Air',
  'VS': 'Virgin Atlantic',
  'CI': 'China Airlines',
  'AM': 'Aeromexico',
  'GA': 'Garuda Indonesia',
  'MU': 'China Eastern',
  'SV': 'Saudi Arabian Airlines',
  'VN': 'Vietnam Airlines',
};

const stealth = getStealthManager();

function buildUrl(params: SearchParams): string {
  const cabin = DELTA_CABIN_MAP[params.cabin] || 'BUSINESS';
  return `https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=${params.origin}&destinationCity=${params.destination}&departureDate=${params.date}&paxCount=${params.passengers || 1}&cabinType=${cabin}`;
}

export async function searchDelta(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = `delta:${params.origin}-${params.destination}:${params.date}:${params.cabin}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    await stealth.stealthDelay();

    browser = await chromium.launch({
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
    const apiResults: any[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/shop/flights') || url.includes('search') && url.includes('delta.com')) {
        try {
          const ct = response.headers()['content-type'] || '';
          if (ct.includes('json')) {
            const json = await response.json();
            apiResults.push(json);
          }
        } catch {}
      }
    });

    const url = buildUrl(params);
    console.log(`[Delta] Searching: ${params.origin} → ${params.destination} on ${params.date} (${params.cabin})`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Accept cookies
    try {
      const cookieBtn = page.locator('button:has-text("Accept"), #onetrust-accept-btn-handler, button:has-text("I Accept")');
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Wait for results
    try {
      await page.waitForSelector(
        '[class*="flight-card"], [class*="FlightCard"], [data-testid*="flight"], .flight-results, [class*="trip-card"]',
        { timeout: 25000 }
      );
    } catch {
      console.log('[Delta] Could not find flight result selectors');
    }

    await page.waitForTimeout(3000);

    // Try API intercept first
    let results: FlightResult[] = [];
    if (apiResults.length > 0) {
      for (const data of apiResults) {
        results.push(...parseDeltaApiResponse(data, params));
      }
    }

    // Fallback: DOM parsing
    if (results.length === 0) {
      results = await page.evaluate((searchParams: { origin: string; destination: string; date: string; cabin: string }) => {
        const flights: any[] = [];
        const cards = document.querySelectorAll(
          '[class*="flight-card"], [class*="FlightCard"], [class*="trip-card"], [data-testid*="flight"], li[class*="result"]'
        );

        cards.forEach((card) => {
          const text = card.textContent || '';

          const flightMatch = text.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
          const airlineCode = flightMatch?.[1] || 'DL';
          const flightNumber = flightMatch ? `${flightMatch[1]}${flightMatch[2]}` : '';

          const timeMatches = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/g);
          const departureTime = timeMatches?.[0] || '';
          const arrivalTime = timeMatches?.[1] || '';

          const milesMatch = text.match(/([\d,]+)\s*(?:miles|mi)/i);
          const pointsRequired = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

          const taxMatch = text.match(/\$(\d+(?:\.\d{2})?)/);
          const taxesAndFees = taxMatch ? parseFloat(taxMatch[1]) : 0;

          const durationMatch = text.match(/(\d+)h\s*(\d+)?m?/);
          const duration = durationMatch ? `${durationMatch[1]}h ${durationMatch[2] || '0'}m` : '';

          const stopsMatch = text.match(/(nonstop|non-stop|\d+)\s*stop/i);
          const stops = stopsMatch
            ? (stopsMatch[1].toLowerCase().includes('non') ? 0 : parseInt(stopsMatch[1]) || 0)
            : (text.toLowerCase().includes('nonstop') ? 0 : -1);

          if (pointsRequired > 0 || flightNumber) {
            flights.push({
              source: 'delta',
              airline: airlineCode,
              flightNumber,
              origin: searchParams.origin,
              destination: searchParams.destination,
              departureDate: searchParams.date,
              departureTime,
              arrivalTime,
              duration,
              stops,
              cabin: searchParams.cabin,
              pointsRequired,
              pointsProgram: 'Delta SkyMiles',
              taxesAndFees,
              awardType: 'partner',
              scrapedAt: new Date().toISOString(),
            });
          }
        });

        return flights;
      }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

      results = results.map((r: any) => ({
        ...r,
        airline: AIRLINE_NAMES[r.airline] || r.airline,
        bookingUrl: url,
      }));
    }

    // Check if blocked
    if (results.length === 0) {
      const pageText = await page.evaluate(() => document.body?.innerText || '');
      if (pageText.includes('captcha') || pageText.includes('blocked') || pageText.includes('denied')) {
        console.warn('[Delta] Likely blocked by bot detection (Shape Security)');
      } else if (pageText.includes('no flights') || pageText.includes('No results')) {
        console.log('[Delta] No availability found');
      } else {
        console.log('[Delta] Could not parse results. Page length:', pageText.length);
      }
    }

    if (results.length > 0) {
      setCache(cacheKey, results);
    }

    console.log(`[Delta] Found ${results.length} results`);
    return results;
  } catch (error: any) {
    console.error('[Delta] Scraper error:', error.message);
    return [];
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

function parseDeltaApiResponse(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];
  try {
    const trips = data?.itinerary || data?.trips || data?.slices || data?.data?.itinerary || [];
    for (const trip of (Array.isArray(trips) ? trips : [])) {
      const segments = trip.segments || trip.legs || trip.flights || [trip];
      const firstSeg = segments[0] || trip;

      const airlineCode = firstSeg.airline?.code || firstSeg.carrierCode || firstSeg.operatingCarrier || 'DL';
      results.push({
        source: 'delta',
        airline: AIRLINE_NAMES[airlineCode] || airlineCode,
        flightNumber: firstSeg.flightNumber || `${airlineCode}${firstSeg.number || ''}`,
        origin: params.origin,
        destination: params.destination,
        departureDate: params.date,
        departureTime: firstSeg.departureTime || firstSeg.departure?.time || '',
        arrivalTime: firstSeg.arrivalTime || firstSeg.arrival?.time || '',
        duration: trip.duration || firstSeg.duration || '',
        stops: (segments.length || 1) - 1,
        cabin: params.cabin,
        pointsRequired: trip.miles || trip.price?.miles || trip.awardPrice || 0,
        pointsProgram: 'Delta SkyMiles',
        taxesAndFees: trip.taxes || trip.price?.taxes || 0,
        awardType: 'partner',
        scrapedAt: new Date().toISOString(),
        bookingUrl: buildUrl(params),
      });
    }
  } catch {}
  return results;
}

export default { searchDelta };
