import { chromium } from 'playwright';

async function interceptKE() {
  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--disable-blink-features=AutomationControlled'] 
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const jsonResponses: { url: string; status: number; body: string; reqBody?: string }[] = [];

  page.on('response', async (resp) => {
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        const text = await resp.text();
        if (text.length > 100 && !resp.url().includes('analytics')) {
          jsonResponses.push({
            url: resp.url().substring(0, 200),
            status: resp.status(),
            body: text.substring(0, 1500),
            reqBody: resp.request().postData()?.substring(0, 500),
          });
        }
      } catch {}
    }
  });

  // Korean Air award search URL - try to find the right format
  // KE requires login for award search, but let's see what endpoints they expose
  const url = 'https://www.koreanair.com/booking/search?tripType=OW&origin=JFK&destination=NRT&departureDate=20260315&adult=1&child=0&infant=0&cabin=prestige&awardBooking=Y';
  console.log('Loading KE:', url);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav error:', e.message);
  }
  
  await page.waitForTimeout(15000);
  
  console.log(`Final URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`Text: ${text}`);
  
  console.log(`\n=== ${jsonResponses.length} JSON responses ===`);
  for (const r of jsonResponses.slice(0, 10)) {
    console.log(`\n${r.status} ${r.url}`);
    if (r.reqBody) console.log(`  Req: ${r.reqBody}`);
    console.log(`  Body: ${r.body.substring(0, 300)}`);
  }

  await browser.close();
}

interceptKE().catch(e => console.error(e));
