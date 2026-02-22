/**
 * Air France / KLM Flying Blue Award Search Scraper
 * Shows SkyTeam partner availability without login.
 * Partners: KLM, Delta, Korean Air, Vietnam Airlines, etc.
 * 
 * Anti-bot: Medium — generally passable with stealth.
 * Has a useful award calendar feature with promo pricing.
 * 
 * Created: 2026-02-16
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { BrowserContext } from 'playwright';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

chromium.use(StealthPlugin());

const RATE_LIMIT_MS = 5000;

const CABIN_MAP: Record<string, string> = {
  economy: 'ECONOMY',
  business: 'BUSINESS',
  first: 'FIRST',
};

function buildUrl(params: SearchParams): string {
  return `https://www.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0&cabinClass=${CABIN_MAP[params.cabin] || 'BUSINESS'}&activeConnection=0&origin=${params.origin}&destination=${params.destination}&outboundDate=${params.date}&tripType=ONE_WAY&activeOutboundSubConnection=0`;
}

export async function searchFlyingBlue(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('flying-blue', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[FlyingBlue] Cache hit for', cacheKey);
    return cached;
  }

  const url = buildUrl(params);
  console.log('[FlyingBlue] Searching:', url);

  let context: BrowserContext | null = null;

  try {
    const rawProxy = process.env.PROXY_URL || '';
    const proxyServer = rawProxy.startsWith('socks') ? rawProxy : '';
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--no-first-run',
      ],
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    const page = await context.newPage();

    // Cookie warming: visit homepage first
    console.log('[FlyingBlue] Warming cookies on airfrance.us...');
    try {
      await page.goto('https://www.airfrance.us/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);
      await page.evaluate(() => window.scrollBy(0, Math.random() * 300));
      await page.waitForTimeout(1000 + Math.random() * 1000);
    } catch (e: any) {
      console.log(`[FlyingBlue] Cookie warming issue (continuing): ${e.message}`);
    }

    // Intercept API responses for structured data
    const apiFlights: any[] = [];
    page.on('response', async (response) => {
      const respUrl = response.url();
      if (respUrl.includes('/api/') && (respUrl.includes('offer') || respUrl.includes('search') || respUrl.includes('availability'))) {
        try {
          const json = await response.json();
          if (json?.connections || json?.offers || json?.flights || json?.data) {
            apiFlights.push(json);
          }
        } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(RATE_LIMIT_MS);

    // Wait for results
    try {
      await page.waitForSelector('[class*="flight"], [class*="offer"], [class*="connection"], [data-testid*="flight"], .result-card', { timeout: 30000 });
    } catch {
      console.log('[FlyingBlue] Could not find flight result selectors');
    }

    await page.waitForTimeout(3000);

    // Parse from DOM
    const results = await page.evaluate((sp: { origin: string; destination: string; date: string; cabin: string }) => {
      const flights: any[] = [];

      const cards = document.querySelectorAll(
        '[class*="offer-card"], [class*="flight-card"], [class*="connection-card"], [class*="result-card"], [class*="journey"]'
      );

      cards.forEach((card) => {
        const text = card.textContent || '';

        const flightNumMatch = text.match(/([A-Z]{2})\s*(\d{1,4})/);
        const flightNumber = flightNumMatch ? `${flightNumMatch[1]}${flightNumMatch[2]}` : '';

        // Flying Blue shows miles
        const milesMatch = text.match(/([\d,]+)\s*(?:miles|Miles)/i);
        const pointsRequired = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

        const taxMatch = text.match(/[€$£](\d+(?:[.,]\d{2})?)/);
        const taxesAndFees = taxMatch ? parseFloat(taxMatch[1].replace(',', '.')) : 0;

        const timeMatches = text.match(/(\d{1,2}[:.]\d{2})/g);
        const departureTime = timeMatches?.[0] || '';
        const arrivalTime = timeMatches?.[1] || '';

        const stopsText = text.toLowerCase();
        const stops = stopsText.includes('direct') || stopsText.includes('nonstop') ? 0 :
          stopsText.includes('1 stop') ? 1 : stopsText.includes('2 stop') ? 2 : 0;

        const durationMatch = text.match(/(\d+h\s*\d*m?)/i);
        const duration = durationMatch?.[0] || '';

        // Check if promo
        const isPromo = text.toLowerCase().includes('promo') || text.toLowerCase().includes('promotion');
        const awardType = isPromo ? 'saver' as const : 'partner' as const;

        // Detect airline
        let airline = 'Air France';
        if (text.includes('KLM')) airline = 'KLM';
        else if (text.includes('Delta')) airline = 'Delta';
        else if (text.includes('Korean')) airline = 'Korean Air';
        else if (text.includes('Vietnam')) airline = 'Vietnam Airlines';

        if (flightNumber || pointsRequired) {
          flights.push({
            source: 'flying-blue',
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
            pointsProgram: 'Flying Blue',
            taxesAndFees,
            awardType,
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
      if (content.includes('captcha') || content.includes('challenge')) {
        console.log('[FlyingBlue] Blocked by anti-bot protection');
      } else {
        console.log('[FlyingBlue] No results found. Page length:', content.length);
      }
    }

    setCache(cacheKey, typedResults);
    await context.close();
    await browser.close();

    console.log(`[FlyingBlue] Found ${typedResults.length} results`);
    return typedResults;

  } catch (error: any) {
    console.error('[FlyingBlue] Scraper error:', error.message);
    if (context) try { await context.close(); } catch {}
    return [];
  }
}
