/**
 * JetBlue TrueBlue Award Search Scraper
 * No login required. Low anti-bot. JetBlue-only routes.
 * Points are revenue-based (~1.3 cpp fixed).
 * 
 * Created: 2026-02-16
 */

import { chromium, BrowserContext } from 'playwright';
import { getStealthManager } from '../../stealth.js';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const RATE_LIMIT_MS = 5000;

function buildUrl(params: SearchParams): string {
  return `https://www.jetblue.com/booking/flights?from=${params.origin}&to=${params.destination}&depart=${params.date}&isMultiCity=false&noOfRoute=1&lang=en&adults=${params.passengers || 1}&children=0&infants=0&shared498702=true&roundTripFaresFlag=false&usePoints=true`;
}

export async function searchJetBlue(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('jetblue', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[JetBlue] Cache hit for', cacheKey);
    return cached;
  }

  const stealth = getStealthManager();
  const url = buildUrl(params);
  console.log('[JetBlue] Searching:', url);

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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(RATE_LIMIT_MS);

    // Wait for flight cards
    try {
      await page.waitForSelector('[class*="flight"], [class*="FlightCard"], [data-qaid*="flight"], .flight-card', { timeout: 30000 });
    } catch {
      console.log('[JetBlue] Could not find flight result selectors');
    }

    await page.waitForTimeout(3000);

    const results = await page.evaluate((sp: { origin: string; destination: string; date: string; cabin: string }) => {
      const flights: any[] = [];

      const cards = document.querySelectorAll(
        '[class*="FlightCard"], [class*="flight-card"], [data-qaid*="flight"], [class*="result-card"]'
      );

      cards.forEach((card) => {
        const text = card.textContent || '';

        const flightNumMatch = text.match(/(?:B6)\s*(\d{1,4})/i) || text.match(/(\d{3,4})/);
        const flightNumber = flightNumMatch ? `B6${flightNumMatch[1]}` : '';

        // Points
        const pointsMatch = text.match(/([\d,]+)\s*(?:points|pts)/i);
        const pointsRequired = pointsMatch ? parseInt(pointsMatch[1].replace(/,/g, '')) : 0;

        const taxMatch = text.match(/\$(\d+(?:\.\d{2})?)/);
        const taxesAndFees = taxMatch ? parseFloat(taxMatch[1]) : 0;

        const timeMatches = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/gi);
        const departureTime = timeMatches?.[0] || '';
        const arrivalTime = timeMatches?.[1] || '';

        const stopsText = text.toLowerCase();
        const stops = stopsText.includes('nonstop') ? 0 : stopsText.includes('1 stop') ? 1 : 0;

        const durationMatch = text.match(/(\d+h\s*\d*m)/i);
        const duration = durationMatch?.[0] || '';

        // Cabin class from fare name
        let cabin = sp.cabin;
        if (text.includes('Mint')) cabin = 'business';
        else if (text.includes('Even More')) cabin = 'economy';

        if (flightNumber || pointsRequired) {
          flights.push({
            source: 'jetblue',
            airline: 'JetBlue',
            flightNumber,
            origin: sp.origin,
            destination: sp.destination,
            departureDate: sp.date,
            departureTime,
            arrivalTime,
            duration,
            stops,
            cabin,
            pointsRequired,
            pointsProgram: 'TrueBlue',
            taxesAndFees,
            awardType: 'saver',
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      return flights;
    }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

    const typedResults: FlightResult[] = results.map((r: any) => ({
      ...r,
      bookingUrl: url,
    }));

    setCache(cacheKey, typedResults);
    await context.close();
    await browser.close();

    console.log(`[JetBlue] Found ${typedResults.length} results`);
    return typedResults;

  } catch (error: any) {
    console.error('[JetBlue] Scraper error:', error.message);
    if (context) try { await context.close(); } catch {}
    return [];
  }
}
