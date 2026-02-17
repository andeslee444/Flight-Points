/**
 * Debug test: screenshot what AA shows us when blocked, and test form-based approach
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';

chromium.use(StealthPlugin());

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2', '--no-first-run'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();

  // Step 1: Visit homepage
  console.log('1. Visiting aa.com...');
  await page.goto('https://www.aa.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  const cookies = await context.cookies();
  console.log(`   Cookies: ${cookies.length} (Akamai: ${cookies.filter(c => c.name.startsWith('ak_') || c.name.startsWith('bm_') || c.name === '_abck').length})`);
  
  await page.screenshot({ path: '/tmp/aa-1-homepage.png', fullPage: false });
  console.log('   Screenshot saved: /tmp/aa-1-homepage.png');

  // Step 2: Try direct URL
  console.log('\n2. Navigating to booking/search...');
  const slices = JSON.stringify([{ orig: 'JFK', origNearby: false, dest: 'NRT', destNearby: false, date: '2026-03-15' }]);
  const url = `https://www.aa.com/booking/search?locale=en_US&pax=1&adult=1&type=OneWay&searchType=Award&cabin=&carriers=ALL&slices=${encodeURIComponent(slices)}`;
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  
  await page.screenshot({ path: '/tmp/aa-2-search.png', fullPage: false });
  const html = await page.content();
  fs.writeFileSync('/tmp/aa-2-search.html', html);
  console.log(`   Screenshot: /tmp/aa-2-search.png`);
  console.log(`   HTML saved: /tmp/aa-2-search.html (${html.length} bytes)`);
  console.log(`   URL: ${page.url()}`);
  
  const blocked = html.toLowerCase().includes('access denied') || html.toLowerCase().includes('captcha') || html.toLowerCase().includes('challenge');
  console.log(`   Blocked: ${blocked}`);
  
  if (blocked) {
    // Extract block details
    const title = await page.title();
    console.log(`   Page title: "${title}"`);
  }

  // Step 3: Try navigating WITHIN the same tab from homepage  
  console.log('\n3. Going back to homepage and trying form...');
  await page.goto('https://www.aa.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Look at what's on the homepage
  const homeHtml = await page.content();
  fs.writeFileSync('/tmp/aa-3-home2.html', homeHtml);
  
  // Check for booking form elements
  const formElements = await page.evaluate(() => {
    const interesting = [
      'input', 'select', 'button', 'a[href*="booking"]', '[class*="booking"]', '[id*="booking"]',
      '[class*="award"]', '[id*="award"]', 'label',
    ];
    const found: string[] = [];
    for (const sel of interesting) {
      document.querySelectorAll(sel).forEach(el => {
        const tag = el.tagName;
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ').slice(0,2).join('.')}` : '';
        const name = (el as any).name ? `[name="${(el as any).name}"]` : '';
        const type = (el as any).type ? `[type="${(el as any).type}"]` : '';
        const text = el.textContent?.trim().slice(0, 50) || '';
        found.push(`${tag}${id}${cls}${name}${type} → "${text}"`);
      });
    }
    return found.slice(0, 50);
  });
  console.log('   Form elements found:');
  formElements.forEach(e => console.log(`     ${e}`));

  await browser.close();
  console.log('\nDone. Check /tmp/aa-*.png and /tmp/aa-*.html');
}

main().catch(e => { console.error(e); process.exit(1); });
