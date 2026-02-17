import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function testAF() {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  const apiCalls: { url: string; status: number; body: string; reqBody?: string }[] = [];

  page.on('response', async (resp) => {
    const ct = resp.headers()['content-type'] || '';
    const url = resp.url();
    if (ct.includes('json') && !url.includes('analytics') && !url.includes('.js') && !url.includes('tracking')) {
      try {
        const text = await resp.text();
        if (text.length > 100) {
          apiCalls.push({
            url: url.substring(0, 250),
            status: resp.status(),
            body: text.substring(0, 2000),
            reqBody: resp.request().postData()?.substring(0, 500),
          });
        }
      } catch {}
    }
  });

  // Flying Blue award search
  const url = 'https://www.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0&cabinClass=BUSINESS&activeConnection=0&connections=JFK-NRT:20260315&bookingFlow=REWARD';
  console.log('Loading Air France:', url);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav:', e.message);
  }

  await page.waitForTimeout(20000);

  console.log(`URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`Text: ${text}`);

  console.log(`\n=== ${apiCalls.length} API responses ===`);
  for (const r of apiCalls.slice(0, 15)) {
    console.log(`\n${r.status} ${r.url}`);
    if (r.reqBody) console.log(`  Req: ${r.reqBody}`);
    console.log(`  Body: ${r.body.substring(0, 400)}`);
  }

  await browser.close();
}

testAF().catch(e => console.error(e));
