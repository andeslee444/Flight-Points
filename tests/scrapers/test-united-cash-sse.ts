import { chromium } from 'playwright';
import * as fs from 'fs';

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

  // Capture ALL flight API responses
  page.on('request', req => {
    if (req.url().includes('FetchSSE')) {
      console.log(`[REQ] ${req.method()} ${req.url()}`);
      console.log(`[REQ BODY] ${req.postData()?.substring(0, 1000)}`);
    }
  });

  let sseBody = '';
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('FetchSSE')) {
      try {
        const body = await resp.text();
        sseBody = body;
        fs.writeFileSync('data/united-sse-full.txt', body);
        console.log(`[SSE] ${resp.status()} len=${body.length}`);
        
        // Parse SSE data
        const lines = body.split('\n');
        let flightCount = 0;
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const d = JSON.parse(line.substring(5).trim());
            if (d.type === 'flightgroup' || d.type === 'flight') {
              flightCount++;
              if (flightCount <= 3) {
                console.log(`\n[FLIGHT ${flightCount}]`, JSON.stringify(d).substring(0, 1000));
              }
            }
          } catch {}
        }
        console.log(`\nTotal flight groups: ${flightCount}`);
      } catch {}
    }
  });

  // Load homepage for cookies
  await page.goto('https://www.united.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Cash search (this works)
  const cashUrl = 'https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&sc=7&px=1&taxng=1&newHP=True&clm=7';
  console.log('Loading cash search...');
  await page.goto(cashUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(20000);
  
  console.log('\nSSE body length:', sseBody.length);
  
  await browser.close();
}

main();
