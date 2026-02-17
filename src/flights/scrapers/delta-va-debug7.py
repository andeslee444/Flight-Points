#!/usr/bin/env python3
"""Debug VA - find booking widget on homepage."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    # Fix brotli encoding
    def handle_route(route):
        headers = route.request.headers.copy()
        ae = headers.get('accept-encoding', '')
        if 'br' in ae:
            headers['accept-encoding'] = 'gzip, deflate'
        route.continue_(headers=headers)
    page.route("**/*", handle_route)

    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(8)

    # Accept cookies
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent and consent.is_visible():
            consent.click()
            time.sleep(1)
            log("Accepted cookies")
    except:
        pass

    log(f"Title: '{page.title()}'")
    
    # Find all inputs/buttons on the page
    inputs = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('input, button, select, [role="combobox"], [role="tab"], [role="radio"], [role="switch"]')).map(el => ({
            tag: el.tagName, role: el.getAttribute('role'), type: el.type, 
            id: (el.id || '').substring(0,50),
            name: (el.name || '').substring(0,50),
            text: (el.innerText || '').substring(0,50),
            ariaLabel: (el.getAttribute('aria-label') || '').substring(0,50),
            placeholder: (el.placeholder || '').substring(0,50),
            class: (el.className || '').substring(0,80),
            visible: el.offsetParent !== null,
            rect: el.getBoundingClientRect ? {x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height} : null
        })).filter(el => el.visible);
    }""")
    
    log(f"Visible interactive elements: {len(inputs)}")
    for inp in inputs:
        log(f"  {json.dumps(inp)}")

    # Look for text matching booking keywords
    booking_text = page.evaluate("""() => {
        const matches = [];
        document.querySelectorAll('*').forEach(el => {
            const text = el.innerText?.toLowerCase() || '';
            if (el.children.length === 0 && (
                text.includes('book') || text.includes('search') || text.includes('from') || 
                text.includes('to') || text.includes('depart') || text.includes('return') ||
                text.includes('passenger') || text.includes('cabin') || text.includes('one way') ||
                text.includes('points') || text.includes('reward')
            )) {
                matches.push({
                    tag: el.tagName, text: text.substring(0,60), 
                    class: (el.className || '').substring(0,40),
                    parent: el.parentElement?.tagName + '.' + (el.parentElement?.className || '').substring(0,30)
                });
            }
        });
        return matches.slice(0, 40);
    }""")
    log(f"\nBooking-related text elements: {len(booking_text)}")
    for bt in booking_text:
        log(f"  {json.dumps(bt)}")

    # Screenshot the top portion
    page.screenshot(path="/tmp/va-homepage.png", full_page=False)
    log("\nScreenshot saved to /tmp/va-homepage.png")
