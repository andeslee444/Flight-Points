import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function testAF() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  // Intercept all GQL calls
  page.on('request', (req) => {
    if (req.url().includes('gql') || req.url().includes('graphql') || req.url().includes('search')) {
      if (req.method() === 'POST' || req.url().includes('operationName')) {
        console.log(`>> ${req.method()} ${req.url().substring(0, 200)}`);
      }
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('gql') && (url.includes('Search') || url.includes('Offer') || url.includes('Flight') || url.includes('Award') || url.includes('Reward'))) {
      try {
        const text = await resp.text();
        console.log(`<< ${resp.status()} ${url.substring(0, 200)}`);
        console.log(`   Resp: ${text.substring(0, 1000)}`);
      } catch {}
    }
  });

  // Try the direct Air France award search URL
  // AF uses wwws.airfrance.us/search/offers for search results
  const url = 'https://wwws.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0&cabinClass=BUSINESS&activeConnection=0&connections=JFK-NRT:20260315&bookingFlow=REWARD';
  console.log('Loading:', url);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav:', e.message);
  }

  await page.waitForTimeout(25000);

  console.log(`\nFinal URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  console.log(`Body: ${text}`);

  await browser.close();
}

testAF().catch(e => console.error(e));
