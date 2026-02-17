import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ 
    headless: false,  // headed mode
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-http2',
      '--no-sandbox',
    ] 
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  
  // Stealth patches
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-ignore
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // @ts-ignore  
    window.chrome = { runtime: {} };
  });
  
  page.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') && (url.includes('/api/') || url.includes('flight') || url.includes('Flight'))) {
      console.log(`[API] ${resp.status()} ${resp.request().method()} ${url}`);
      try {
        const body = await resp.text();
        console.log(`  => ${body.substring(0, 800)}`);
      } catch {}
    }
  });

  // Try 1: Direct homepage first to get cookies, then search
  console.log('Step 1: Loading united.com homepage...');
  try {
    await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('Homepage loaded');
    await page.waitForTimeout(5000);
  } catch (e: any) {
    console.log('Homepage error:', e.message);
  }

  // Now try the search URL
  console.log('Step 2: Navigating to search...');
  const searchUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Search loaded, URL:', page.url());
    await page.waitForTimeout(10000);
    
    const text = (await page.textContent('body').catch(() => '')) || '';
    console.log('Body (first 1000):', text.substring(0, 1000));
    
    // Look for modals
    for (const sel of ['button:has-text("Show flights with money")', 'button:has-text("Continue")', 'button:has-text("Close")']) {
      const btn = await page.$(sel);
      if (btn) {
        console.log('Clicking:', sel);
        await btn.click();
        await page.waitForTimeout(5000);
      }
    }
    
    await page.waitForTimeout(10000);
    await page.screenshot({ path: 'data/united-headed-test.png', fullPage: true });
    console.log('Screenshot saved');
    
  } catch (e: any) {
    console.log('Search error:', e.message);
  }
  
  await browser.close();
}

main();
