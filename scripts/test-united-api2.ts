/**
 * Test 2: Multiple approaches to bypass United's Akamai
 */

import { chromium, firefox, Browser } from 'playwright';

const ORIGIN = 'JFK';
const DEST = 'NRT';
const DATE = '2026-03-15';

async function approach1_firefox() {
  console.log('\n=== Approach: Firefox (different TLS fingerprint) ===');
  let browser: Browser | null = null;
  try {
    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    
    console.log('Loading united.com with Firefox...');
    const resp = await page.goto('https://www.united.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`Status: ${resp?.status()}`);
    await page.waitForTimeout(3000);
    
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
    console.log(`Title: ${title}`);
    console.log(`Body: ${bodyText.substring(0, 200)}`);
    
    const cookies = await context.cookies();
    console.log(`Cookies: ${cookies.length}`);
    const abck = cookies.find(c => c.name === '_abck');
    console.log(`_abck: ${abck ? 'YES (' + abck.value.substring(0, 30) + '...)' : 'NO'}`);
    
    await page.screenshot({ path: '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-firefox.png' });
    await context.close();
  } catch (e: any) {
    console.log('Firefox failed:', e.message);
  } finally {
    if (browser) await browser.close();
  }
}

async function approach2_chromium_headed() {
  console.log('\n=== Approach: Chromium headed (non-headless) ===');
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--no-first-run',
        '--disable-infobars',
        '--disable-extensions',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Hide automation indicators
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as PermissionStatus) :
          originalQuery(parameters)
      );
      // Chrome runtime
      // @ts-ignore
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
      // Languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    // Track API calls
    const apiCalls: any[] = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/api/flight/') || url.includes('/api/award/')) {
        try {
          const body = await resp.text();
          apiCalls.push({ url, status: resp.status(), bodyLen: body.length, body: body.substring(0, 1000) });
          console.log(`[API] ${resp.status()} ${url.split('?')[0]} (${body.length} bytes)`);
        } catch {}
      }
    });
    
    console.log('Loading united.com (headed, HTTP/1.1)...');
    const resp = await page.goto('https://www.united.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`Homepage status: ${resp?.status()}`);
    await page.waitForTimeout(5000);
    
    const cookies = await context.cookies();
    console.log(`Cookies: ${cookies.length}`);
    
    // Navigate to search
    const searchUrl = `https://www.united.com/en/us/fsr/choose-flights?f=${ORIGIN}&t=${DEST}&d=${DATE}&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7`;
    console.log('Navigating to search...');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(15000);
    
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
    console.log(`Title: ${title}`);
    console.log(`Body: ${bodyText.substring(0, 300)}`);
    console.log(`API calls intercepted: ${apiCalls.length}`);
    
    for (const call of apiCalls) {
      console.log(`\n  ${call.url.split('?')[0]}: ${call.status}`);
      console.log(`  Body preview: ${call.body.substring(0, 200)}`);
    }
    
    await page.screenshot({ path: '/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-headed.png', fullPage: true });
    
    // If we got API responses, dump cookies for replay
    if (apiCalls.some(c => c.status === 200)) {
      console.log('\n=== SUCCESS! Dumping cookies for replay ===');
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const fs = await import('fs');
      fs.writeFileSync('/Users/andeslee/Documents/cursor-projects/class-sniper/data/united-cookies.txt', cookieStr);
      console.log('Cookies saved to data/united-cookies.txt');
    }
    
    await context.close();
  } catch (e: any) {
    console.log('Headed Chromium failed:', e.message);
  } finally {
    if (browser) await browser.close();
  }
}

async function approach3_curl_with_fresh_session() {
  console.log('\n=== Approach: curl-style fetch with session rotation ===');
  
  // Try hitting the homepage first to get cookies, then the API
  try {
    const homepageResp = await fetch('https://www.united.com/en/us', {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
      },
      redirect: 'follow',
    });
    console.log(`Homepage: ${homepageResp.status}`);
    const setCookies = homepageResp.headers.getSetCookie?.() || [];
    console.log(`Set-Cookie headers: ${setCookies.length}`);
    for (const sc of setCookies) {
      console.log(`  ${sc.substring(0, 80)}...`);
    }
  } catch (e: any) {
    console.log('Curl approach failed:', e.message);
  }
}

async function main() {
  // Try curl first (fastest)
  await approach3_curl_with_fresh_session();
  
  // Try Firefox (different TLS fingerprint)
  await approach1_firefox();
  
  // Try headed Chromium
  await approach2_chromium_headed();
}

main().catch(console.error);
