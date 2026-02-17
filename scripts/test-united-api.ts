/**
 * Test script: United Airlines API interception via Playwright
 * 
 * Strategy: Use headed Playwright to load united.com, harvest cookies + headers,
 * then call their internal API directly.
 * 
 * Endpoints discovered:
 * - POST /api/flight/FetchFlights - main flight search
 * - POST /api/flight/FetchAwardCalendar - award calendar view
 */

import { chromium, Browser, Page } from 'playwright';

const ORIGIN = 'JFK';
const DEST = 'NRT';
const DATE = '2026-03-15';
const CABIN = 7; // business

async function main() {
  console.log('=== United API Interception Test ===\n');

  // Approach 1: Try direct API call first (no browser)
  console.log('--- Approach 1: Direct API call (no cookies) ---');
  await tryDirectApi();

  // Approach 2: Browser cookie harvesting + API replay
  console.log('\n--- Approach 2: Browser cookie harvest + API interception ---');
  await tryBrowserIntercept();
}

async function tryDirectApi() {
  const body = {
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
    AwardTravel: true,
    SortTypeVersion: 2,
  };

  try {
    const resp = await fetch('https://www.united.com/api/flight/FetchFlights', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'origin': 'https://www.united.com',
        'referer': 'https://www.united.com/en/us/fsr/choose-flights',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
    });
    console.log(`Status: ${resp.status}`);
    const text = await resp.text();
    console.log(`Response length: ${text.length}`);
    console.log(`First 500 chars: ${text.substring(0, 500)}`);
    if (resp.status === 200) {
      try {
        const json = JSON.parse(text);
        console.log('Keys:', Object.keys(json));
      } catch {}
    }
  } catch (e: any) {
    console.log('Direct API failed:', e.message);
  }
}

async function tryBrowserIntercept() {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-infobars',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    // Remove webdriver detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // @ts-ignore
      delete navigator.__proto__.webdriver;
    });

    // Track all API requests
    const apiRequests: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const apiResponses: { url: string; status: number; body: string }[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('united.com/api/')) {
        apiRequests.push({
          url,
          method: req.method(),
          headers: req.headers(),
          body: req.postData() || '',
        });
        console.log(`[REQ] ${req.method()} ${url.split('?')[0]}`);
      }
    });

    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('united.com/api/')) {
        try {
          const body = await resp.text();
          apiResponses.push({ url, status: resp.status(), body });
          console.log(`[RESP] ${resp.status()} ${url.split('?')[0]} (${body.length} bytes)`);
        } catch {}
      }
    });

    // Step 1: Load homepage to get initial cookies
    console.log('Loading united.com homepage...');
    await page.goto('https://www.united.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const cookies = await context.cookies();
    console.log(`Got ${cookies.length} cookies`);
    const cookieNames = cookies.map(c => c.name);
    console.log('Cookie names:', cookieNames.join(', '));

    // Check if we got Akamai cookies
    const abck = cookies.find(c => c.name === '_abck');
    const bmsz = cookies.find(c => c.name === 'bm_sz');
    console.log(`_abck: ${abck ? 'YES' : 'NO'}, bm_sz: ${bmsz ? 'YES' : 'NO'}`);

    // Step 2: Navigate to search URL
    const searchUrl = `https://www.united.com/en/us/fsr/choose-flights?f=${ORIGIN}&t=${DEST}&d=${DATE}&tt=1&at=1&sc=${CABIN}&px=1&taxng=1&newHP=True&clm=7`;
    console.log('\nNavigating to search URL...');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(10000);

    // Check page state
    const pageUrl = page.url();
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || '');
    console.log(`\nPage URL: ${pageUrl}`);
    console.log(`Page title: ${pageTitle}`);
    console.log(`Body preview: ${bodyText.substring(0, 300)}`);

    // Check for access denied / captcha
    const content = await page.content();
    if (content.includes('Access Denied') || content.includes('akam') || content.includes('captcha')) {
      console.log('\n*** BLOCKED by Akamai! ***');
    }

    // Save screenshot
    await page.screenshot({ 
      path: '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-test-1.png',
      fullPage: true 
    });
    console.log('Screenshot saved to data/united-test-1.png');

    // Wait more for API calls
    await page.waitForTimeout(10000);

    // Report findings
    console.log(`\n=== Summary ===`);
    console.log(`API requests captured: ${apiRequests.length}`);
    console.log(`API responses captured: ${apiResponses.length}`);

    for (const req of apiRequests) {
      console.log(`\n--- Request: ${req.url.split('?')[0]} ---`);
      console.log(`Method: ${req.method}`);
      console.log(`Body (first 500): ${req.body.substring(0, 500)}`);
    }

    for (const resp of apiResponses) {
      console.log(`\n--- Response: ${resp.url.split('?')[0]} ---`);
      console.log(`Status: ${resp.status}`);
      console.log(`Body (first 500): ${resp.body.substring(0, 500)}`);
    }

    // If we got API responses, try replaying with captured cookies
    if (apiRequests.length > 0) {
      console.log('\n--- Attempting API replay with captured cookies ---');
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const fetchReq = apiRequests.find(r => r.url.includes('FetchFlights') || r.url.includes('FetchAward'));
      if (fetchReq) {
        const replayResp = await fetch(fetchReq.url, {
          method: 'POST',
          headers: {
            ...fetchReq.headers,
            'cookie': cookieStr,
          },
          body: fetchReq.body,
        });
        console.log(`Replay status: ${replayResp.status}`);
        const replayBody = await replayResp.text();
        console.log(`Replay body (first 500): ${replayBody.substring(0, 500)}`);
      }
    }

    await context.close();
  } catch (e: any) {
    console.error('Browser intercept failed:', e.message);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(console.error);
