import { chromium, Route } from 'playwright';
import * as fs from 'fs';

async function main() {
  fs.mkdirSync('data', { recursive: true });
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let interceptCount = 0;
  
  // Intercept FetchSSENestedFlights and modify payload
  await page.route('**/api/flight/FetchSSENestedFlights', async (route: Route) => {
    interceptCount++;
    const request = route.request();
    const postData = request.postData();
    console.log(`\n[INTERCEPT #${interceptCount}] Original payload:`, postData?.substring(0, 300));
    
    if (postData && interceptCount === 1) {
      // First request: let it pass as-is (cash) to establish session
      console.log('[INTERCEPT] Passing through cash search...');
      await route.continue();
    } else {
      await route.continue();
    }
  });

  // Also capture responses
  page.on('response', async resp => {
    if (resp.url().includes('FetchSSE')) {
      try {
        const body = await resp.text();
        const filename = `data/united-sse-${interceptCount}.txt`;
        fs.writeFileSync(filename, body);
        console.log(`[SSE RESP] ${resp.status()} saved to ${filename} (${body.length} bytes)`);
        
        // Count flight options
        const matches = body.match(/"type":"flightOption"/g);
        console.log(`[SSE] ${matches?.length || 0} flight options`);
        
        // Check for miles
        if (body.includes('"miles"') || body.includes('"Miles"') || body.includes('"mileage"')) {
          console.log('*** HAS MILES DATA ***');
        }
      } catch (e: any) {
        console.log('[SSE RESP] Error reading:', e.message);
      }
    }
  });

  // Load homepage
  console.log('Loading homepage...');
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Cash search — the SSE should fire automatically
  console.log('\nCash search...');
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  console.log(`\nIntercept count: ${interceptCount}`);
  
  // Now try: modify the route to inject AwardTravel=true
  await page.unroute('**/api/flight/FetchSSENestedFlights');
  await page.route('**/api/flight/FetchSSENestedFlights', async (route: Route) => {
    interceptCount++;
    const request = route.request();
    let postData = request.postData();
    
    if (postData) {
      try {
        const payload = JSON.parse(postData);
        payload.AwardTravel = true;
        // Remove fare restrictions that might not apply to awards
        if (payload.Trips?.[0]?.SearchFiltersIn) {
          delete payload.Trips[0].SearchFiltersIn.FareFamily;
        }
        postData = JSON.stringify(payload);
        console.log(`[INTERCEPT #${interceptCount}] Modified to award search`);
      } catch {}
    }
    
    await route.continue({ postData });
  });

  // Trigger a new search by navigating again or clicking update
  console.log('\nTriggering new search with award modification...');
  // Change date to trigger re-search
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-16&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  console.log(`Total intercepts: ${interceptCount}`);
  await page.screenshot({ path: 'data/united-award-intercepted.png', fullPage: true });
  
  await browser.close();
}

main();
