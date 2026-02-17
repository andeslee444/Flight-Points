#!/usr/bin/env python3
"""Debug VA - fix encoding by stripping brotli from accept-encoding."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    # Intercept requests to remove brotli from Accept-Encoding
    def handle_route(route):
        headers = route.request.headers.copy()
        ae = headers.get('accept-encoding', '')
        # Remove br (brotli) encoding, keep gzip and deflate
        if 'br' in ae:
            new_ae = ', '.join(p.strip() for p in ae.split(',') if 'br' not in p.strip())
            headers['accept-encoding'] = new_ae or 'gzip, deflate'
        route.continue_(headers=headers)

    page.route("**/*", handle_route)

    log("Going to VA homepage (no brotli)...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(5)

    log(f"Title: '{page.title()}'")
    log(f"URL: {page.url}")

    # Check text
    text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || 'EMPTY'")
    log(f"Body text: {text[:300]}")
    
    el_count = page.evaluate("() => document.querySelectorAll('*').length")
    log(f"DOM elements: {el_count}")

    # Accept cookies
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent and consent.is_visible():
            consent.click()
            time.sleep(1)
            log("Accepted cookies")
    except:
        pass

    # Now go to the booking page
    log("\nGoing to /flight-search/book-a-flight ...")
    page.goto("https://www.virginatlantic.com/flight-search/book-a-flight", timeout=45000, wait_until="domcontentloaded")
    time.sleep(8)

    log(f"Title: '{page.title()}'")
    log(f"URL: {page.url}")

    text2 = page.evaluate("() => document.body?.innerText?.substring(0, 1000) || 'EMPTY'")
    log(f"Body text: {text2[:500]}")

    el_count2 = page.evaluate("() => document.querySelectorAll('*').length")
    log(f"DOM elements: {el_count2}")

    # Screenshot
    page.screenshot(path="/tmp/va-booking2.png")
    log("Screenshot saved to /tmp/va-booking2.png")

    # Find interactive elements
    inputs = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('input, button, select, [role="combobox"], [role="button"], [role="tab"], [role="option"]')).map(el => ({
            tag: el.tagName, role: el.getAttribute('role'), type: el.type, id: el.id?.substring(0,40),
            name: el.name, text: el.innerText?.substring(0,40),
            ariaLabel: el.getAttribute('aria-label')?.substring(0,40),
            placeholder: el.placeholder?.substring(0,40),
            class: el.className?.substring(0,60),
            visible: el.offsetParent !== null
        })).slice(0, 50);
    }""")
    log(f"\nInteractive elements: {len(inputs)}")
    for inp in inputs:
        log(f"  {json.dumps(inp)}")
