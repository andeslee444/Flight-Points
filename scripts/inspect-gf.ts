/**
 * Diagnostic: dump Google Flights DOM to understand actual selectors
 */
import { chromium } from 'playwright';
import { getStealthManager } from '../src/stealth.js';
import * as fs from 'fs';

async function inspect() {
  const stealth = getStealthManager();
  const url = 'https://www.google.com/travel/flights?q=Flights+from+JFK+to+NRT+on+April+1,+2026+business+class+one+way';
  console.log('URL:', url);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-infobars', '--no-first-run'],
  });

  const context = await browser.newContext(stealth.getContextOptions());
  const page = await context.newPage();
  await page.addInitScript(stealth.getStealthScript());

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // Screenshot
  await page.screenshot({ path: 'data/gf-screenshot.png', fullPage: true });
  console.log('Screenshot saved to data/gf-screenshot.png');

  // Dump first few flight result list items with their HTML
  const diagnostics = await page.evaluate(() => {
    const info: any = {};
    
    // Try various selectors and report what matches
    const selectors = [
      'li.pIav2d', 'ul.Rk10dc > li', '[jsname="IWWDBc"]', 
      '.Rk10dc', '.nQGyuf', '.YMlIz', '[data-ved] li',
      'li[data-ved]', '.gws-flights-results__result-item',
      '[role="listitem"]', '.OgQvJf', 'c-wiz li',
      // Common Google Flights 2024+ selectors
      '.pIav2d', '.Rk10dc li', '.yR1fYc', '.mxvQLc',
      'ul[class] > li[class]'
    ];
    
    info.selectorCounts = {};
    for (const sel of selectors) {
      try {
        info.selectorCounts[sel] = document.querySelectorAll(sel).length;
      } catch { info.selectorCounts[sel] = 'error'; }
    }

    // Get all <li> elements that have substantial text
    const allLis = document.querySelectorAll('li');
    const flightLis: any[] = [];
    allLis.forEach((li, i) => {
      const text = li.textContent || '';
      if (text.includes('$') && text.length > 30 && text.length < 500) {
        flightLis.push({
          index: i,
          className: li.className,
          outerHTMLSnippet: li.outerHTML.slice(0, 1500),
          text: text.trim().slice(0, 300),
        });
      }
    });
    info.flightLis = flightLis.slice(0, 5);

    // Also check for non-li containers with prices
    const allElements = document.querySelectorAll('*');
    const priceEls: any[] = [];
    allElements.forEach((el) => {
      const t = el.textContent || '';
      if (el.children.length === 0 && /^\$\d/.test(t.trim()) && t.trim().length < 20) {
        priceEls.push({
          tag: el.tagName,
          className: el.className,
          text: t.trim(),
          parentClass: el.parentElement?.className || '',
          grandparentClass: el.parentElement?.parentElement?.className || '',
        });
      }
    });
    info.priceElements = priceEls.slice(0, 10);

    // Find time patterns (leaf elements containing AM/PM)
    const timeEls: any[] = [];
    allElements.forEach((el) => {
      const t = (el.textContent || '').trim();
      if (el.children.length === 0 && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t)) {
        timeEls.push({
          tag: el.tagName,
          className: el.className,
          text: t,
          parentClass: el.parentElement?.className || '',
        });
      }
    });
    info.timeElements = timeEls.slice(0, 10);

    return info;
  });

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/gf-diagnostics.json', JSON.stringify(diagnostics, null, 2));
  console.log('Diagnostics saved to data/gf-diagnostics.json');
  console.log('Selector counts:', JSON.stringify(diagnostics.selectorCounts, null, 2));
  console.log('Price elements:', diagnostics.priceElements?.length);
  console.log('Time elements:', diagnostics.timeElements?.length);
  console.log('Flight LIs:', diagnostics.flightLis?.length);
  
  if (diagnostics.flightLis?.[0]) {
    console.log('\nFirst flight LI text:', diagnostics.flightLis[0].text);
    console.log('First flight LI class:', diagnostics.flightLis[0].className);
  }
  if (diagnostics.priceElements?.[0]) {
    console.log('\nFirst price element:', JSON.stringify(diagnostics.priceElements[0]));
  }
  if (diagnostics.timeElements?.[0]) {
    console.log('\nFirst time element:', JSON.stringify(diagnostics.timeElements[0]));
  }

  await context.close();
  await browser.close();
}

inspect().catch(e => { console.error(e); process.exit(1); });
