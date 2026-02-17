import { chromium } from 'playwright';

async function interceptDelta() {
  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2'] 
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  
  // Patch webdriver detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-ignore
    delete navigator.__proto__.webdriver;
  });

  // Capture ALL network requests
  const allRequests: string[] = [];
  const jsonResponses: { url: string; status: number; body: string; reqBody?: string }[] = [];

  page.on('request', (req) => {
    allRequests.push(`${req.method()} ${req.url().substring(0, 120)}`);
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    // Capture JSON responses and anything that looks like flight data
    if (ct.includes('json') && !url.includes('analytics') && !url.includes('tracking') && !url.includes('.js')) {
      try {
        const text = await resp.text();
        if (text.length > 50) {
          const reqBody = resp.request().postData()?.substring(0, 500) || '';
          jsonResponses.push({
            url: url.substring(0, 200),
            status: resp.status(),
            body: text.substring(0, 2000),
            reqBody,
          });
        }
      } catch {}
    }
  });

  // Try the direct URL approach
  const url = 'https://www.delta.com/flight-search/book-a-flight?tripType=ONE_WAY&awardTravel=true&originCity=JFK&destinationCity=NRT&departureDate=2026-03-15&paxCount=1&cabinType=BUSINESS';
  console.log('Loading Delta:', url);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav error:', e.message);
  }
  
  await page.waitForTimeout(15000);
  
  // Check what happened
  console.log(`\nFinal URL: ${page.url()}`);
  console.log(`Page title: ${await page.title()}`);
  
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`\nPage text: ${bodyText}`);
  
  console.log(`\n=== ${jsonResponses.length} JSON responses ===`);
  for (const r of jsonResponses) {
    console.log(`\n${r.status} ${r.url}`);
    if (r.reqBody) console.log(`  ReqBody: ${r.reqBody}`);
    console.log(`  Body: ${r.body.substring(0, 500)}`);
  }

  // Show unique request domains
  const domains = new Set(allRequests.map(r => {
    try { return new URL(r.split(' ')[1]).hostname; } catch { return '?'; }
  }));
  console.log(`\n=== Request domains (${domains.size}) ===`);
  for (const d of domains) console.log(`  ${d}`);

  await browser.close();
}

interceptDelta().catch(e => console.error(e));
