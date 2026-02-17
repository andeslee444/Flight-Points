/**
 * United: Try clicking through the page to trigger flight search
 */
import { chromium } from 'playwright';

async function main() {
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data', { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Intercept ALL requests to find what's being sent
  const allRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('united.com') && (url.includes('flight') || url.includes('Flight') || url.includes('Fetch') || url.includes('search') || url.includes('Shop'))) {
      const postData = req.postData();
      allRequests.push(`${req.method()} ${url.substring(0, 120)} ${postData ? `BODY: ${postData.substring(0, 200)}` : ''}`);
      console.log(`📤 REQ: ${req.method()} ${url.substring(0, 120)}`);
      if (postData) console.log(`   BODY: ${postData.substring(0, 300)}`);
    }
  });

  const flightResponses: any[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('united.com') && (url.includes('flight') || url.includes('Flight') || url.includes('Fetch'))) {
      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const text = await resp.text();
          flightResponses.push({ url, status: resp.status(), body: text });
          console.log(`📥 RESP: [${resp.status()}] ${url.substring(0, 120)} (${text.length}b)`);
          if (text.length > 500) console.log(`   PREVIEW: ${text.substring(0, 300)}`);
        }
      } catch {}
    }
  });

  console.log('Loading United...');
  await page.goto('https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7', { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Accept cookies
  try {
    const cookieBtn = await page.$('button:has-text("Accept cookies")');
    if (cookieBtn) await cookieBtn.click();
  } catch {}
  
  console.log('Waiting 15s for page to settle...');
  await page.waitForTimeout(15000);
  
  // Check for loading state
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  console.log(`\nPage has "Loading": ${bodyText.includes('Loading')}`);
  console.log(`Page has flight results: ${bodyText.includes('nonstop') || bodyText.includes('Nonstop')}`);
  
  // Try scrolling to trigger lazy load
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(3000);
  
  // Check console errors
  const consoleMessages: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleMessages.push(msg.text());
  });
  
  // Try clicking "Update" button if it exists
  const updateBtn = await page.$('button:has-text("Update")');
  if (updateBtn) {
    console.log('\nClicking "Update" button...');
    await updateBtn.click();
    await page.waitForTimeout(15000);
  }
  
  // Final check
  const finalBody = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
  const hasFlights = finalBody.includes('Nonstop') || finalBody.includes('nonstop') || finalBody.includes('stop') || finalBody.includes('hrs');
  console.log(`\nFinal - has flights: ${hasFlights}`);
  console.log(finalBody.substring(0, 1000));
  
  await page.screenshot({ path: '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-click.png', fullPage: true });
  
  // Save flight API responses
  if (flightResponses.length > 0) {
    writeFileSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-flight-responses.json', JSON.stringify(flightResponses, null, 2));
    console.log(`Saved ${flightResponses.length} flight API responses`);
  }
  
  console.log(`\nAll flight requests: ${allRequests.length}`);
  allRequests.forEach(r => console.log(`  ${r}`));

  await context.close();
  await browser.close();
}

main().catch(console.error);
