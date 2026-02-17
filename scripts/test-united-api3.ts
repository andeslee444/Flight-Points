/**
 * Test 3: Headed Chromium works! Now capture the actual flight search API.
 * 
 * Strategy: 
 * 1. Launch headed Chromium → united.com homepage
 * 2. Harvest cookies/session
 * 3. Use page.evaluate to make the API call from within the page context
 * 4. Also try: cookie replay with node fetch
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';

const ORIGIN = 'JFK';
const DEST = 'NRT';
const DATE = '2026-03-15';
const CABIN = 7; // business
const DATA_DIR = '/Users/andeslee/Documents/cursor-projects/class-sniper/data';

async function main() {
  console.log('=== United API - Headed Chromium + API Intercept ===\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-http2',
      '--no-first-run',
      '--disable-infobars',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-ignore
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // Track all API traffic
  const allResponses: any[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/')) {
      try {
        const body = await resp.text();
        allResponses.push({ url, status: resp.status(), body });
        console.log(`[API] ${resp.status()} ${url.replace('https://www.united.com', '')} (${body.length}b)`);
      } catch {}
    }
  });

  // Step 1: Load homepage
  console.log('Step 1: Loading homepage...');
  await page.goto('https://www.united.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Accept cookies
  try {
    const acceptBtn = await page.$('button:has-text("Accept cookies")');
    if (acceptBtn) {
      await acceptBtn.click();
      console.log('Accepted cookies');
      await page.waitForTimeout(1000);
    }
  } catch {}

  // Step 2: Try making the FetchFlights call from within page context
  console.log('\nStep 2: Making FetchFlights call from page context...');
  
  const fetchBody = {
    Travelers: [{ TravelerIndex: 1, CabinPreferences: [] }],
    MaxTrips: 50,
    SearchTypeSelection: 1,
    Trips: [{
      DepartDate: DATE,
      Origin: ORIGIN,
      Destination: DEST,
      TripIndex: 1,
    }],
    CabinPreferenceMain: CABIN,
    AwardTravel: false, // Start with cash (no login needed)
    SortTypeVersion: 2,
    ColumnSortOption: 'Price',
    PagingOption: { StartIndex: 1, PageSize: 50 },
  };

  const result = await page.evaluate(async (body) => {
    try {
      const resp = await fetch('/api/flight/FetchFlights', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const text = await resp.text();
      return { status: resp.status, bodyLen: text.length, body: text.substring(0, 5000), ok: resp.ok };
    } catch (e: any) {
      return { error: e.message };
    }
  }, fetchBody);

  console.log('FetchFlights (cash) result:', JSON.stringify({ status: result.status, bodyLen: result.bodyLen, ok: result.ok }));
  
  if (result.status === 200 && result.body) {
    try {
      const json = JSON.parse(result.body);
      console.log('Top-level keys:', Object.keys(json));
      if (json.data) console.log('data keys:', Object.keys(json.data));
      if (json.data?.Trips) {
        console.log(`Trips: ${json.data.Trips.length}`);
        for (const trip of json.data.Trips) {
          console.log(`  Trip: ${trip.Flights?.length || 0} flights`);
          for (const f of (trip.Flights || []).slice(0, 3)) {
            const segs = f.Legs || f.Segments || [];
            const dep = segs[0]?.DepartDateTime || '';
            const carrier = segs[0]?.OperatingCarrier || '';
            const fnum = segs[0]?.FlightNumber || '';
            const products = f.Products || [];
            const price = products[0]?.Prices?.[0]?.Amount || 'N/A';
            console.log(`    ${carrier}${fnum} dep:${dep} price:${price} products:${products.length}`);
          }
        }
      }
      
      // Save full response
      fs.writeFileSync(`${DATA_DIR}/united-cash-response.json`, result.body);
      console.log('Full response saved to data/united-cash-response.json');
    } catch (e: any) {
      console.log('Parse error:', e.message);
      console.log('Body preview:', result.body?.substring(0, 500));
    }
  } else {
    console.log('Response preview:', result.body?.substring(0, 500) || result.error);
  }

  // Step 3: Try award search
  console.log('\nStep 3: Trying award search (AwardTravel: true)...');
  const awardBody = { ...fetchBody, AwardTravel: true };
  
  const awardResult = await page.evaluate(async (body) => {
    try {
      const resp = await fetch('/api/flight/FetchFlights', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const text = await resp.text();
      return { status: resp.status, bodyLen: text.length, body: text.substring(0, 5000), ok: resp.ok };
    } catch (e: any) {
      return { error: e.message };
    }
  }, awardBody);

  console.log('FetchFlights (award) result:', JSON.stringify({ status: awardResult.status, bodyLen: awardResult.bodyLen, ok: awardResult.ok }));
  
  if (awardResult.body) {
    try {
      const json = JSON.parse(awardResult.body);
      console.log('Award response keys:', Object.keys(json));
      if (json.data) console.log('Award data keys:', Object.keys(json.data));
      fs.writeFileSync(`${DATA_DIR}/united-award-response.json`, awardResult.body);
      console.log('Award response saved');
      
      // Check if it requires login
      if (json.data?.Trips) {
        console.log(`Award trips: ${json.data.Trips.length}`);
      }
      if (json.errors || json.data?.Errors) {
        console.log('Errors:', JSON.stringify(json.errors || json.data?.Errors).substring(0, 500));
      }
    } catch {
      console.log('Award body preview:', awardResult.body?.substring(0, 500));
    }
  }

  // Step 4: Also try FetchAwardCalendar
  console.log('\nStep 4: Trying FetchAwardCalendar...');
  const calendarBody = {
    Trips: [{
      DepartDate: DATE,
      Origin: ORIGIN,
      Destination: DEST,
      TripIndex: 1,
    }],
    CabinPreferenceMain: CABIN,
    AwardTravel: true,
    SearchTypeSelection: 1,
  };

  const calResult = await page.evaluate(async (body) => {
    try {
      const resp = await fetch('/api/flight/FetchAwardCalendar', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const text = await resp.text();
      return { status: resp.status, bodyLen: text.length, body: text.substring(0, 5000), ok: resp.ok };
    } catch (e: any) {
      return { error: e.message };
    }
  }, calendarBody);

  console.log('FetchAwardCalendar result:', JSON.stringify({ status: calResult.status, bodyLen: calResult.bodyLen }));
  if (calResult.body) {
    try {
      const json = JSON.parse(calResult.body);
      console.log('Calendar keys:', Object.keys(json));
      fs.writeFileSync(`${DATA_DIR}/united-calendar-response.json`, calResult.body);
    } catch {
      console.log('Calendar body:', calResult.body?.substring(0, 300));
    }
  }

  // Step 5: Cookie replay test (can we reuse cookies from node-fetch?)
  console.log('\nStep 5: Cookie replay from Node.js...');
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  try {
    const replayResp = await fetch('https://www.united.com/api/flight/FetchFlights', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'origin': 'https://www.united.com',
        'referer': 'https://www.united.com/en/us/fsr/choose-flights',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'cookie': cookieStr,
      },
      body: JSON.stringify(fetchBody),
    });
    console.log(`Node replay status: ${replayResp.status}`);
    const replayText = await replayResp.text();
    console.log(`Node replay body (${replayText.length}b): ${replayText.substring(0, 300)}`);
  } catch (e: any) {
    console.log('Node replay failed:', e.message);
  }

  await context.close();
  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
