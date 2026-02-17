import { chromium } from 'playwright';

async function main() {
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

  // Intercept ALL API responses and log them fully
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('united.com/api/flight/')) {
      console.log(`\n[FLIGHT API] ${resp.status()} ${resp.request().method()} ${url}`);
      try {
        const body = await resp.text();
        console.log(body.substring(0, 2000));
      } catch {}
    }
  });

  // Step 1: Get anonymous token from homepage
  console.log('Loading homepage for cookies/token...');
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  
  // Get cookies
  const cookies = await ctx.cookies();
  console.log('Cookies:', cookies.map(c => c.name).join(', '));
  
  // Step 2: Try cash search (no at=1) to see if FetchFlights works
  console.log('\n--- Cash search (no at=1) ---');
  const cashUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  await page.goto(cashUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(15000);
  
  // Check page
  const text = (await page.textContent('body').catch(() => '')) || '';
  const hasResults = text.includes('Nonstop') || text.includes('stop') || text.includes('Depart') || text.includes('$');
  console.log('Has results:', hasResults);
  console.log('Text preview:', text.replace(/\s+/g, ' ').substring(0, 500));
  
  await page.screenshot({ path: 'data/united-cash-search.png', fullPage: true });
  
  // Step 3: Try calling the API directly with page's session
  console.log('\n--- Direct API call from page context ---');
  const apiResult = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/flight/FetchFlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Trips: [{ Origin: 'JFK', Destination: 'NRT', DepartDate: '2026-03-15' }],
          CabinType: 'businessFirst',
          PaxCount: 1,
          SearchTypeSelection: 1,
          AwardTravel: false,
          Columns: 7,
          MaxTrips: 500,
          NoOfTripsColumn: 7,
          SortType: 'bestmatches',
        })
      });
      const text = await resp.text();
      return { status: resp.status, body: text.substring(0, 3000) };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('Direct API result:', JSON.stringify(apiResult).substring(0, 2000));
  
  await browser.close();
}

main();
