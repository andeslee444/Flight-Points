#!/usr/bin/env python3
"""Debug VA - try the booking page and check encoding."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    all_urls = []
    def on_response(resp):
        url = resp.url
        if not any(x in url for x in ['.png', '.jpg', '.css', '.woff', '.svg', '.ico', '.gif', 'analytics', 'google', 'facebook', 'onetrust']):
            log(f"  RESP: {resp.status} {resp.headers.get('content-type','')[:30]} {url[:120]}")
            all_urls.append(url)

    page.on("response", on_response)

    # Go to the booking page directly
    log("Going to /flight-search/book-a-flight ...")
    page.goto("https://www.virginatlantic.com/flight-search/book-a-flight", timeout=45000, wait_until="domcontentloaded")
    time.sleep(10)

    log(f"\nTitle: '{page.title()}'")
    log(f"URL: {page.url}")

    # Try getting text via different methods
    html = page.content()
    log(f"HTML length: {len(html)}")
    
    # Check if body has proper text  
    text_check = page.evaluate("""() => {
        const body = document.body;
        if (!body) return 'NO BODY';
        const text = body.innerText;
        // Check if text contains garbled chars
        const printable = text.replace(/[^\\x20-\\x7E\\n]/g, '');
        return {
            totalLen: text.length,
            printableLen: printable.length,
            printableRatio: printable.length / Math.max(text.length, 1),
            sample: printable.substring(0, 500)
        };
    }""")
    log(f"Text check: {json.dumps(text_check)}")

    # Try textContent instead of innerText
    text2 = page.evaluate("() => document.body?.textContent?.replace(/[^\\x20-\\x7E\\n]/g, '').substring(0, 500) || 'EMPTY'")
    log(f"textContent (printable): {text2}")

    # Check the HTML source for encoding clues
    log(f"\nHTML head (first 500): {html[:500]}")

    # Look for the booking widget in HTML source
    if 'book-a-flight' in html.lower() or 'search' in html.lower():
        log("HTML contains booking/search references")
    
    # Check if there are script tags loading a SPA
    scripts = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(s => s.includes('virgin')).slice(0, 10);
    }""")
    log(f"\nVA scripts: {len(scripts)}")
    for s in scripts:
        log(f"  {s}")

    # Try a screenshot to see what's actually rendered
    page.screenshot(path="/tmp/va-booking.png")
    log("Screenshot saved to /tmp/va-booking.png")
