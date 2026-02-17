/**
 * Aeroplan / Air Canada Award Search Scraper
 * 
 * NOTE: As of March 2025, Aeroplan requires login to search award availability.
 * This scraper will attempt the search but may fail without credentials.
 * 
 * The Aeroplan API uses: https://www.aircanada.com/aeroplan/redeem/availability/outbound
 * with query parameters for the search.
 * 
 * Created: 2026-02-16
 */

import { chromium, Page, BrowserContext } from 'playwright';
import { getStealthManager } from '../../stealth.js';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const RATE_LIMIT_MS = 5000;

function buildUrl(params: SearchParams): string {
  // Aeroplan uses specific URL format
  // Date format: YYYY-MM-DD
  const cabinMap: Record<string, string> = {
    economy: 'ECO',
    business: 'BUS',
    first: 'FIR',
  };
  const cabin = cabinMap[params.cabin] || 'BUS';
  
  return `https://www.aircanada.com/aeroplan/redeem/availability/outbound?org0=${params.origin}&dest0=${params.destination}&departureDate0=${params.date}&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT&cabinClass=${cabin}`;
}

export async function searchAeroplan(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('aeroplan', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[Aeroplan] Cache hit for', cacheKey);
    return cached;
  }

  const stealth = getStealthManager();
  const url = buildUrl(params);
  console.log('[Aeroplan] Searching:', url);
  console.log('[Aeroplan] Note: Aeroplan now requires login. Results may be limited.');

  let context: BrowserContext | null = null;

  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--disable-infobars',
        '--no-first-run',
      ],
    });

    context = await browser.newContext(stealth.getContextOptions());
    const page = await context.newPage();
    await page.addInitScript(stealth.getStealthScript());

    // Try to intercept API responses
    const apiResults: any[] = [];
    page.on('response', async (response) => {
      const responseUrl = response.url();
      if (responseUrl.includes('/api/') && 
          (responseUrl.includes('availability') || responseUrl.includes('flight'))) {
        try {
          const json = await response.json();
          apiResults.push(json);
        } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(RATE_LIMIT_MS);

    // Check if redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('auth')) {
      console.log('[Aeroplan] Redirected to login page. Login required for award search.');
      await context.close();
      await browser.close();
      return [];
    }

    // Wait for results
    try {
      await page.waitForSelector('[class*="flight"], [class*="result"], [class*="availability"], .bound-row, .flight-row', { timeout: 20000 });
    } catch {
      console.log('[Aeroplan] Could not find flight result selectors');
    }

    await page.waitForTimeout(3000);

    // Try to parse from intercepted API responses first
    let results: FlightResult[] = [];

    if (apiResults.length > 0) {
      console.log('[Aeroplan] Parsing from intercepted API responses...');
      for (const apiData of apiResults) {
        const flights = parseAeroplanApi(apiData, params);
        results.push(...flights);
      }
    }

    // Fallback: parse from DOM
    if (results.length === 0) {
      const domResults = await page.evaluate((searchParams: { origin: string; destination: string; date: string; cabin: string }) => {
        const flights: any[] = [];
        
        const rows = document.querySelectorAll(
          '[class*="flight-row"], [class*="bound-row"], [class*="FlightResult"], [class*="availability-row"], tr[class*="flight"]'
        );

        rows.forEach((row) => {
          const text = row.textContent || '';

          // Extract points
          const pointsMatch = text.match(/([\d,]+)\s*(?:points|pts|miles)/i);
          const pointsRequired = pointsMatch ? parseInt(pointsMatch[1].replace(/,/g, '')) : 0;

          // Extract airline
          const airlineMatch = text.match(/(Air Canada|ANA|Lufthansa|Swiss|United|EVA Air|Turkish|Singapore|Thai|Asiana|LOT|TAP|Ethiopian|Copa|Avianca|EgyptAir)/i);
          const airline = airlineMatch ? airlineMatch[1] : 'Air Canada';

          // Extract flight number
          const fnMatch = text.match(/([A-Z]{2})\s*(\d{1,4})/);
          const flightNumber = fnMatch ? `${fnMatch[1]}${fnMatch[2]}` : '';

          // Extract times
          const timeMatches = text.match(/(\d{1,2}:\d{2})/g);
          const departureTime = timeMatches?.[0] || '';
          const arrivalTime = timeMatches?.[1] || '';

          // Extract taxes
          const taxMatch = text.match(/(?:CA?D?|US?D?)\s*\$?\s*(\d+(?:\.\d{2})?)/i);
          const taxesAndFees = taxMatch ? parseFloat(taxMatch[1]) : 0;

          // Stops
          const stopsMatch = text.match(/(\d+)\s*stop/i);
          const stops = text.toLowerCase().includes('direct') ? 0 : (stopsMatch ? parseInt(stopsMatch[1]) : 0);

          if (pointsRequired > 0 || flightNumber) {
            flights.push({
              source: 'aeroplan',
              airline,
              flightNumber,
              origin: searchParams.origin,
              destination: searchParams.destination,
              departureDate: searchParams.date,
              departureTime,
              arrivalTime,
              duration: '',
              stops,
              cabin: searchParams.cabin,
              pointsRequired,
              pointsProgram: 'Aeroplan',
              taxesAndFees,
              awardType: 'partner',
              scrapedAt: new Date().toISOString(),
            });
          }
        });

        return flights;
      }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

      results = domResults.map((r: any) => ({
        ...r,
        cabin: params.cabin,
        bookingUrl: url,
      }));
    }

    setCache(cacheKey, results);
    
    await context.close();
    await browser.close();
    
    console.log(`[Aeroplan] Found ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('[Aeroplan] Scraper error:', error.message);
    if (context) {
      try { await context.close(); } catch {}
    }
    return [];
  }
}

function parseAeroplanApi(data: any, params: SearchParams): FlightResult[] {
  const results: FlightResult[] = [];
  
  try {
    // Aeroplan API response structure varies — try common patterns
    const segments = data?.data?.flights || data?.flights || data?.air?.bounds || data?.results || [];
    
    for (const segment of (Array.isArray(segments) ? segments : [])) {
      results.push({
        source: 'aeroplan',
        airline: segment.airline || segment.airlineName || segment.marketingCarrier || 'Air Canada',
        flightNumber: segment.flightNumber || segment.flightNum || '',
        origin: params.origin,
        destination: params.destination,
        departureDate: params.date,
        departureTime: segment.departureTime || segment.departure?.time || '',
        arrivalTime: segment.arrivalTime || segment.arrival?.time || '',
        duration: segment.duration || segment.travelTime || '',
        stops: segment.stops || segment.numberOfStops || 0,
        cabin: params.cabin,
        pointsRequired: segment.points || segment.miles || segment.aeroplanPoints || 0,
        pointsProgram: 'Aeroplan',
        taxesAndFees: segment.taxes || segment.surcharge || 0,
        awardType: 'partner',
        scrapedAt: new Date().toISOString(),
        bookingUrl: buildUrl(params),
      });
    }
  } catch (e) {
    console.error('[Aeroplan] API parse error:', e);
  }

  return results;
}
