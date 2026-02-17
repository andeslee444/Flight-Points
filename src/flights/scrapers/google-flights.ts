/**
 * Google Flights Cash Price Scraper
 * Gets cash prices for CPP (cents per point) calculation.
 * 
 * Google Flights is client-rendered — requires Playwright to wait for results.
 * URL: https://www.google.com/travel/flights/search?tfs=...
 * 
 * Created: 2026-02-16
 */

import { chromium, Page, BrowserContext } from 'playwright';
import { getStealthManager } from '../../stealth.js';
import { FlightResult, SearchParams, getCacheKey } from '../types.js';
import { getCached, setCache } from './cache.js';

const RATE_LIMIT_MS = 5000;

function buildUrl(params: SearchParams): string {
  // Google Flights natural language URL
  const cabinStr = params.cabin === 'first' ? 'first+class' : 
                   params.cabin === 'business' ? 'business+class' : 'economy';
  
  // Format date for Google: "March 15, 2026" or just use the q parameter
  const d = new Date(params.date + 'T12:00:00');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                   'July', 'August', 'September', 'October', 'November', 'December'];
  const dateStr = `${months[d.getMonth()]}+${d.getDate()},+${d.getFullYear()}`;
  
  return `https://www.google.com/travel/flights?q=Flights+from+${params.origin}+to+${params.destination}+on+${dateStr}+${cabinStr}+one+way`;
}

export async function searchGoogleFlights(params: SearchParams): Promise<FlightResult[]> {
  const cacheKey = getCacheKey('google', params);
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('[GoogleFlights] Cache hit for', cacheKey);
    return cached;
  }

  const stealth = getStealthManager();
  const url = buildUrl(params);
  console.log('[GoogleFlights] Searching:', url);

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

    // Wait for flight results to render
    try {
      // Google Flights uses li elements with role="listitem" or specific classes
      await page.waitForSelector('li.pIav2d, [class*="flight-result"], [jsname="IWWDBc"], .Rk10dc, ul.Rk10dc li', { timeout: 20000 });
    } catch {
      console.log('[GoogleFlights] Waiting for alternative selectors...');
      try {
        await page.waitForSelector('[data-ved] .YMlIz, .nQGyuf', { timeout: 10000 });
      } catch {
        console.log('[GoogleFlights] Could not find flight result selectors');
      }
    }

    await page.waitForTimeout(3000);

    const results = await page.evaluate((searchParams: { origin: string; destination: string; date: string; cabin: string }) => {
      const flights: any[] = [];

      // Google Flights 2024+ structure: each flight card is li.pIav2d
      // The .JMc5Xc child has an aria-label with all structured info
      const resultItems = document.querySelectorAll('li.pIav2d');

      resultItems.forEach((item) => {
        // Primary: parse from aria-label (most reliable)
        const ariaEl = item.querySelector('.JMc5Xc');
        const ariaLabel = ariaEl?.getAttribute('aria-label') || '';
        const text = item.textContent || '';
        
        if (text.length < 20) return;

        // --- Price ---
        // aria-label starts with "From XXXX US dollars" or price element has class FpEdX
        let cashPrice = 0;
        const ariaPriceMatch = ariaLabel.match(/From\s+([\d,]+)\s+US dollars/i);
        if (ariaPriceMatch) {
          cashPrice = parseFloat(ariaPriceMatch[1].replace(/,/g, ''));
        } else {
          // Fallback: first $ price in text
          const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*)/);
          if (priceMatch) cashPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
        }

        // --- Airline ---
        // aria-label: "... flight with AIRLINE_NAME. Leaves ..."
        let airline = '';
        const ariaAirlineMatch = ariaLabel.match(/flight with\s+(.+?)\.\s*Leaves/i);
        if (ariaAirlineMatch) {
          airline = ariaAirlineMatch[1].trim();
          // Clean up "Operated by X" suffix
          airline = airline.replace(/\.\s*Operated by.*$/i, '').trim();
        }
        if (!airline) {
          // Fallback: .Ir0Voe contains airline name spans
          const airlineEl = item.querySelector('.Ir0Voe .sSHqwe');
          airline = airlineEl?.textContent?.trim() || '';
        }
        if (!airline) {
          // Text-based fallback
          const airlineMatch = text.match(/(United|Delta|American|ANA|JAL|Japan Airlines|Lufthansa|Swiss|Air Canada|Singapore Airlines|Cathay Pacific|Emirates|Qatar Airways|Korean Air|Asiana Airlines|EVA Air|Turkish Airlines|British Airways|Air France|KLM|Philippine Airlines|All Nippon Airways)/i);
          airline = airlineMatch ? airlineMatch[1] : 'Unknown';
        }

        // --- Times ---
        // aria-label: "Leaves X Airport at HH:MM AM/PM on DAY ... arrives at Y Airport at HH:MM AM/PM"
        let departureTime = '';
        let arrivalTime = '';
        // Use narrow no-break space (\u202f) aware regex
        const ariaDepMatch = ariaLabel.match(/Leaves\s+.+?\s+at\s+(\d{1,2}:\d{2}\s*(?:\u202f)?(?:AM|PM))/i);
        const ariaArrMatch = ariaLabel.match(/arrives\s+at\s+.+?\s+at\s+(\d{1,2}:\d{2}\s*(?:\u202f)?(?:AM|PM))/i);
        if (ariaDepMatch) departureTime = ariaDepMatch[1].replace(/\u202f/g, ' ').trim();
        if (ariaArrMatch) arrivalTime = ariaArrMatch[1].replace(/\u202f/g, ' ').trim();
        
        if (!departureTime) {
          // Fallback: parse from text (times use narrow no-break space \u202f before AM/PM)
          const timeMatches = text.match(/(\d{1,2}:\d{2}[\s\u202f]*(?:AM|PM))/gi);
          if (timeMatches) {
            departureTime = timeMatches[0]?.replace(/\u202f/g, ' ').trim() || '';
            arrivalTime = timeMatches[1]?.replace(/\u202f/g, ' ').trim() || '';
          }
        }

        // --- Duration ---
        // aria-label: "Total duration XX hr YY min"
        let duration = '';
        const ariaDurMatch = ariaLabel.match(/Total duration\s+(\d+)\s*hr\s*(?:(\d+)\s*min)?/i);
        if (ariaDurMatch) {
          duration = `${ariaDurMatch[1]}h ${ariaDurMatch[2] || '0'}m`;
        } else {
          const durMatch = text.match(/(\d+)\s*hr\s*(?:(\d+)\s*min)?/i);
          if (durMatch) duration = `${durMatch[1]}h ${durMatch[2] || '0'}m`;
        }

        // --- Stops ---
        // aria-label: "X stop" or "Nonstop"
        let stops = 0;
        if (/nonstop/i.test(ariaLabel) || /nonstop/i.test(text)) {
          stops = 0;
        } else {
          const stopsMatch = (ariaLabel || text).match(/(\d+)\s*stop/i);
          stops = stopsMatch ? parseInt(stopsMatch[1]) : 0;
        }

        if (cashPrice > 0) {
          flights.push({
            source: 'google',
            airline,
            flightNumber: '',
            origin: searchParams.origin,
            destination: searchParams.destination,
            departureDate: searchParams.date,
            departureTime,
            arrivalTime,
            duration,
            stops,
            cabin: searchParams.cabin,
            cashPrice,
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      return flights;
    }, { origin: params.origin, destination: params.destination, date: params.date, cabin: params.cabin });

    // Deduplicate by airline+departure+price
    const seen = new Set<string>();
    const deduped = results.filter((r: any) => {
      const key = `${r.airline}|${r.departureTime}|${r.cashPrice}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const typedResults: FlightResult[] = deduped.map((r: any) => ({
      ...r,
      cabin: params.cabin,
      bookingUrl: url,
    }));

    setCache(cacheKey, typedResults);
    
    await context.close();
    await browser.close();
    
    console.log(`[GoogleFlights] Found ${typedResults.length} results`);
    return typedResults;

  } catch (error: any) {
    console.error('[GoogleFlights] Scraper error:', error.message);
    if (context) {
      try { await context.close(); } catch {}
    }
    return [];
  }
}
