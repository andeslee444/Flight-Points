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

  // Capture SSE responses
  const sseData: string[] = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('FetchSSE') || url.includes('fetchsse') || url.includes('SSE')) {
      console.log(`[SSE] ${resp.status()} ${resp.request().method()} ${url}`);
      try {
        const body = await resp.text();
        sseData.push(body);
        // Save full response
        const fs = await import('fs');
        fs.writeFileSync('data/united-sse-response.txt', body);
        console.log(`[SSE] Response length: ${body.length}`);
        // Show first flight data
        const lines = body.split('\n').filter(l => l.startsWith('data:'));
        for (const line of lines.slice(0, 5)) {
          const json = line.replace('data: ', '');
          try {
            const d = JSON.parse(json);
            if (d.type === 'flight' || d.Flights || d.Products) {
              console.log(`[FLIGHT] ${JSON.stringify(d).substring(0, 500)}`);
            }
          } catch {}
        }
      } catch (e: any) {
        console.log('[SSE] Read error:', e.message);
      }
    }
    // Also catch MapPricing
    if (url.includes('MapPricing')) {
      console.log(`[MAP] ${resp.status()} ${resp.request().method()} ${url}`);
      try {
        const body = await resp.text();
        console.log(`[MAP] ${body.substring(0, 1000)}`);
      } catch {}
    }
  });

  // Step 1: Homepage for cookies
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Step 2: Award search
  console.log('\n--- Award search (at=1) ---');
  const awardUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  await page.goto(awardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Check for "Continue shopping?" modal and click "Show flights with money"
  const bodyText = (await page.textContent('body').catch(() => '')) || '';
  console.log('Modal check:', bodyText.includes('Continue shopping') ? 'YES' : 'NO');
  console.log('Sign in check:', bodyText.includes('Sign in') ? 'YES' : 'NO');
  
  // Try "Show flights with money" button
  const moneyBtn = await page.$('button:has-text("Show flights with money"), a:has-text("Show flights with money")');
  if (moneyBtn) {
    console.log('Clicking "Show flights with money"...');
    await moneyBtn.click();
    await page.waitForTimeout(15000);
  } else {
    console.log('No "Show flights with money" button found');
    // Try other buttons
    const allButtons = await page.$$eval('button', btns => btns.map(b => b.textContent?.trim()).filter(Boolean));
    console.log('Available buttons:', allButtons.slice(0, 20));
  }
  
  await page.screenshot({ path: 'data/united-award-test.png', fullPage: true });
  
  // Step 3: Try cash search with FetchSSENestedFlights payload from page context
  console.log('\n--- Direct SSE API call ---');
  const sseResult = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/flight/FetchSSENestedFlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Trips: [{ Origin: 'JFK', Destination: 'NRT', DepartDate: '2026-03-15', Cabin: 'businessFirst' }],
          CabinType: 'businessFirst',
          PaxCount: 1,
          SearchTypeSelection: 1,
          AwardTravel: true,
          Columns: 7,
          MaxTrips: 500,
          NoOfTripsColumn: 7,
          SortType: 'bestmatches',
        })
      });
      const text = await resp.text();
      return { status: resp.status, body: text.substring(0, 5000) };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('SSE API result:', JSON.stringify(sseResult).substring(0, 3000));

  console.log(`\nTotal SSE responses captured: ${sseData.length}`);
  
  await browser.close();
}

main();
