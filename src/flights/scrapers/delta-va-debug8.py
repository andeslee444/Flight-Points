#!/usr/bin/env python3
"""Debug VA - use extra_http_headers to disable brotli."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

# Try with extra headers to disable brotli
with Camoufox(headless=True, humanize=True) as browser:
    context = browser.new_context(extra_http_headers={
        'Accept-Encoding': 'gzip, deflate'
    }) if hasattr(browser, 'new_context') else None
    
    if context:
        page = context.new_page()
        log("Using new context with Accept-Encoding header")
    else:
        page = browser.new_page()
        log("Using default page (no context override)")
        # Try setting via route but only for document requests
        def handle_route(route):
            if route.request.resource_type in ('document', 'xhr', 'fetch'):
                headers = route.request.headers.copy()
                headers['accept-encoding'] = 'gzip, deflate'
                route.continue_(headers=headers)
            else:
                route.continue_()
        page.route("**/*", handle_route)

    graphql_responses = []
    def on_response(resp):
        url = resp.url
        if 'graphql' in url.lower() or ('api' in url.lower() and 'virgin' in url.lower()):
            log(f"API: {resp.status} {url[:150]}")
            try:
                body = resp.text()
                log(f"  Body: {body[:300]}")
                if resp.status == 200:
                    graphql_responses.append(json.loads(body))
            except Exception as e:
                log(f"  Read error: {e}")
    page.on("response", on_response)

    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(8)

    title = page.title()
    log(f"Title: '{title}'")

    # Check if page rendered
    text = page.evaluate("() => document.body?.innerText?.substring(0, 200) || 'EMPTY'")
    log(f"Body: {text[:200]}")

    el_count = page.evaluate("() => document.querySelectorAll('*').length")
    log(f"DOM elements: {el_count}")

    if el_count < 100:
        log("Page didn't render properly, trying screenshot...")
        page.screenshot(path="/tmp/va-debug8.png")
        # Also try just checking HTML
        html = page.content()
        log(f"HTML length: {len(html)}")
        log(f"HTML preview: {html[:300]}")
        sys.exit(1)

    # Accept cookies
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent and consent.is_visible():
            consent.click()
            time.sleep(1)
            log("Accepted cookies")
    except:
        pass

    # Look for booking widget
    inputs = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('input, button, [role="combobox"], [role="tab"], [role="radio"], [role="switch"], [role="option"]')).filter(el => el.offsetParent !== null).map(el => ({
            tag: el.tagName, role: el.getAttribute('role'), type: el.type, 
            id: (el.id || '').substring(0,50),
            text: (el.innerText || '').substring(0,50),
            ariaLabel: (el.getAttribute('aria-label') || '').substring(0,50),
            placeholder: (el.placeholder || '').substring(0,50),
        })).slice(0, 50);
    }""")
    log(f"\nVisible interactive elements: {len(inputs)}")
    for inp in inputs:
        log(f"  {json.dumps(inp)}")

    page.screenshot(path="/tmp/va-debug8.png")
    log("Screenshot saved")
