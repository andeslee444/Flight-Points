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

  // Intercept and modify SSE request to award search from the start
  await page.route('**/api/flight/FetchSSENestedFlights', async (route: Route) => {
    const request = route.request();
    let postData = request.postData();
    
    if (postData) {
      try {
        const payload = JSON.parse(postData);
        console.log(`[INTERCEPT] Original AwardTravel=${payload.AwardTravel}`);
        payload.AwardTravel = true;
        delete payload.Trips?.[0]?.SearchFiltersIn?.FareFamily;
        postData = JSON.stringify(payload);
        console.log('[INTERCEPT] Modified to AwardTravel=true');
      } catch {}
    }
    
    await route.continue({ postData });
  });

  page.on('response', async resp => {
    if (resp.url().includes('FetchSSE')) {
      try {
        const body = await resp.text();
        fs.writeFileSync('data/united-sse-award-intercept.txt', body);
        console.log(`[SSE] ${resp.status()} ${body.length} bytes`);
        
        const optCount = (body.match(/"type":"flightOption"/g) || []).length;
        console.log(`[SSE] ${optCount} flight options`);
        
        // Check for award/miles data
        if (body.includes('Award') || body.includes('award') || body.includes('"miles"')) {
          console.log('*** AWARD DATA FOUND ***');
        }
        
        // Show first flight option
        const lines = body.split('\n');
        for (const line of lines) {
          if (line.includes('"type":"flightOption"')) {
            const data = JSON.parse(line.replace('data: ', ''));
            const flight = data.flight;
            const product = flight?.products?.[0];
            console.log(`First flight: ${flight?.marketingCarrier}${flight?.flightNumber} ${flight?.origin}-${flight?.destination}`);
            console.log(`  Product: ${product?.productType} price: ${JSON.stringify(product?.prices?.[0])}`);
            break;
          }
        }
      } catch (e: any) {
        console.log('[SSE] Error:', e.message);
      }
    }
  });

  // Load homepage first
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Go to cash search URL (but our interceptor will change it to award)
  console.log('Loading search (will be intercepted to award)...');
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  await page.screenshot({ path: 'data/united-award3.png', fullPage: true });
  await browser.close();
}

main();
