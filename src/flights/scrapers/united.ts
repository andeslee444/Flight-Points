/**
 * United.com Award Search Scraper
 *
 * Strategy:
 * - **Playwright + API interception** — navigate to united.com and intercept /api/flight/FetchFlights
 *   (frequently blocked by Akamai Bot Manager)
 *
 * The ANA scraper already covers Star Alliance partner availability.
 * This scraper is specifically for United MileagePlus pricing.
 *
 * Created: 2026-02-16
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page, Browser } from 'playwright';
import { FlightResult, SearchParams, UNITED_CABIN_CODES, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

chromium.use(StealthPlugin());

const SEARCH_TIMEOUT = 45000;

// ─── Playwright + API interception ─────────────────────────────────────────────

function buildSearchUrl(params: SearchParams): string {
  const sc = UNITED_CABIN_CODES[params.cabin] || 7;
  return `https://www.united.com/en/us/fsr/choose-flights?f=${params.origin}&t=${params.destination}&d=${params.date}&tt=1&at=1&sc=${sc}&px=${params.passengers || 1}&taxng=1&newHP=True&clm=7`;
}

function parseApiResponse(data: any, params: SearchParams, bookingUrl: string): FlightResult[] {
  const results: FlightResult[] = [];
  if (!data) return results;

  const trips = data?.data?.Trips || data?.Trips || [];
  for (const trip of trips) {
    const flights = trip?.Flights || [];
    for (const flight of flights) {
      const segments = flight?.Legs || flight?.Connections || [];
      const carrier = flight?.MarketingCarrier || flight?.OperatingCarrier || 'UA';
      const flightNum = `${carrier} ${flight?.FlightNumber || ''}`;
      const depTime = flight?.DepartDateTime || '';
      const arrTime = flight?.DestinationDateTime || '';
      const duration = flight?.TravelMinutes ? `${Math.floor(flight.TravelMinutes / 60)}h ${flight.TravelMinutes % 60}m` : '';
      const stops = flight?.Connections?.length || 0;

      const products = flight?.Products || [];
      for (const product of products) {
        if (product.Prices?.length === 0) continue;

        const miles = product?.Prices?.[0]?.Amount || 0;
        const cash = product?.Prices?.length >= 2 ? product.Prices[1]?.Amount : 0;
        const bookingClass = product?.BookingCode || '';

        const cabinMap: Record<string, 'economy' | 'business' | 'first'> = {
          'United First': 'business',
          'United Economy': 'economy',
          'United Business': 'business',
          'Economy': 'economy',
          'Business': 'business',
          'First': 'first',
          'United Polaris business': 'business',
          'United Premium Plus': 'economy',
        };
        const cabin = cabinMap[product.Description || ''] || params.cabin;

        if (miles > 0) {
          results.push({
            source: 'united',
            airline: carrier,
            flightNumber: flightNum,
            origin: flight.Origin || params.origin,
            destination: flight.Destination || params.destination,
            departureDate: params.date,
            departureTime: depTime,
            arrivalTime: arrTime,
            duration,
            stops,
            cabin,
            pointsRequired: miles,
            pointsProgram: 'United MileagePlus',
            taxesAndFees: cash || undefined,
            awardType: product.AwardType?.toLowerCase?.().includes('saver') ? 'saver' : 'everyday',
            scrapedAt: new Date().toISOString(),
            bookingUrl,
          });
        }
      }
    }
  }
  return results;
}

async function searchPlaywright(params: SearchParams): Promise<FlightResult[]> {
  console.log(`[United/Playwright] Searching ${params.origin} → ${params.destination} on ${params.date} (${params.cabin})`);

  const bookingUrl = buildSearchUrl(params);
  let browser: Browser | null = null;

  try {
    const rawProxy = process.env.PROXY_URL || '';
    const proxyServer = rawProxy.startsWith('socks') ? rawProxy : '';
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--window-size=1440,900',
      ],
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    const page = await context.newPage();

    // Cookie warming: visit homepage first to establish session
    console.log('[United/Playwright] Warming cookies on united.com...');
    try {
      await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);
      await page.evaluate(() => window.scrollBy(0, Math.random() * 300));
      await page.waitForTimeout(1000 + Math.random() * 1000);
    } catch (e: any) {
      console.log(`[United/Playwright] Cookie warming issue (continuing): ${e.message}`);
    }

    // Intercept flight API responses
    const apiResponses: any[] = [];
    page.on('response', async (resp) => {
      try {
        const url = resp.url();
        if (url.includes('united.com/api/flight/Fetch') && resp.status() === 200) {
          const json = await resp.json();
          apiResponses.push(json);
          console.log(`[United/Playwright] Intercepted API response`);
        }
      } catch {}
    });

    await page.goto(bookingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Handle modals
    try {
      const moneyBtn = await page.$('button:has-text("Show flights with money")');
      if (moneyBtn) {
        await moneyBtn.click();
        await page.waitForTimeout(2000);
      }
    } catch {}

    // Wait for API response
    const startWait = Date.now();
    while (apiResponses.length === 0 && Date.now() - startWait < SEARCH_TIMEOUT) {
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);

    let results: FlightResult[] = [];
    for (const resp of apiResponses) {
      results = results.concat(parseApiResponse(resp, params, bookingUrl));
    }

    // Debug on failure
    if (results.length === 0) {
      const content = await page.content();
      if (content.includes('Access Denied') || content.includes('unable to complete')) {
        console.log('[United/Playwright] Blocked by Akamai anti-bot');
      }
      try {
        const { mkdirSync } = await import('fs');
        mkdirSync('/Users/andeslee/Documents/cursor-projects/Fitness-Sniper/data', { recursive: true });
        await page.screenshot({ path: '/Users/andeslee/Documents/cursor-projects/Fitness-Sniper/data/united-debug.png', fullPage: true });
      } catch {}
    }

    await context.close();
    await browser.close();
    console.log(`[United/Playwright] Found ${results.length} results`);
    return results;

  } catch (error: any) {
    console.error('[United/Playwright] Error:', error.message);
    if (browser) try { await browser.close(); } catch {}
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function searchUnited(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('united', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[United] Cache hit');
    return cached;
  }

  // Playwright scraping (slower, frequently blocked)
  console.log('[United] Scraping via Playwright...');
  const playwrightResults = await searchPlaywright(params);
  if (playwrightResults.length > 0) {
    setCache(cacheKey, playwrightResults);
  }
  return playwrightResults;
}
