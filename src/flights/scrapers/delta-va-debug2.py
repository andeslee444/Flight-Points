#!/usr/bin/env python3
"""Debug VA search - navigate to booking page, fill form, intercept API."""
import json, sys, time, random

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    graphql_responses = []

    def on_response(resp):
        url = resp.url
        if 'graphql' in url.lower():
            log(f"GraphQL response: {resp.status} {url[:150]}")
            try:
                body = resp.text()
                log(f"  Body: {body[:500]}")
                if resp.status == 200:
                    graphql_responses.append(json.loads(body))
            except Exception as e:
                log(f"  Error reading: {e}")

    page.on("response", on_response)

    # Navigate to VA booking page
    log("Going to VA booking page...")
    page.goto("https://www.virginatlantic.com/book/flights", timeout=45000)
    time.sleep(3)
    log(f"URL: {page.url}")
    log(f"Title: {page.title()}")

    # Accept cookies
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent and consent.is_visible():
            consent.click()
            time.sleep(1)
            log("Accepted cookies")
    except:
        pass

    time.sleep(2)

    # Check what's on the page - look for the search form
    try:
        visible = page.evaluate("() => document.body.innerText.substring(0, 3000)")
        log(f"Page text (first 1500 chars):\n{visible[:1500]}")
    except:
        pass

    # Look for the booking widget / form elements
    log("\nLooking for form elements...")
    selectors_to_check = [
        'input', 'button', '[role="combobox"]', '[role="listbox"]',
        '[data-testid]', '.booking', '.search', '.flight-search',
        '#fromAirport', '#toAirport', '#origin', '#destination',
        '[name="origin"]', '[name="destination"]', '[placeholder]',
        'a[href*="book"]', '[class*="book"]', '[class*="search"]',
        '[class*="airport"]', '[class*="flight"]'
    ]

    for sel in selectors_to_check:
        try:
            els = page.query_selector_all(sel)
            if els:
                info = []
                for el in els[:5]:
                    tag = el.evaluate("e => e.tagName")
                    cls = el.evaluate("e => e.className")[:60] if el.evaluate("e => e.className") else ''
                    tid = el.evaluate("e => e.getAttribute('data-testid')") or ''
                    ph = el.evaluate("e => e.getAttribute('placeholder')") or ''
                    txt = el.evaluate("e => e.innerText")[:40] if el.evaluate("e => e.innerText") else ''
                    info.append(f"{tag}.{cls[:30]} testid={tid} ph={ph} txt={txt}")
                log(f"  {sel}: {len(els)} found")
                for i in info:
                    log(f"    {i}")
        except:
            pass

    # Try to find the "Use points" toggle or "Reward seat" option
    log("\nLooking for points/reward toggle...")
    try:
        all_text = page.evaluate("""() => {
            const els = document.querySelectorAll('label, button, a, span, div');
            const matches = [];
            for (const el of els) {
                const text = el.innerText?.toLowerCase() || '';
                if (text.includes('point') || text.includes('reward') || text.includes('mile') || text.includes('award') || text.includes('one way') || text.includes('round trip')) {
                    matches.push({tag: el.tagName, text: el.innerText?.substring(0,60), class: el.className?.substring(0,40), id: el.id});
                }
            }
            return matches.slice(0, 20);
        }""")
        for item in all_text:
            log(f"  {item}")
    except Exception as e:
        log(f"  Error: {e}")

    # Also check if this is actually a SPA that loaded React/Angular
    log("\nChecking JS framework...")
    try:
        framework = page.evaluate("""() => {
            const checks = {};
            checks.react = !!document.querySelector('[data-reactroot]') || !!window.__NEXT_DATA__;
            checks.angular = !!window.ng || !!document.querySelector('[ng-app]') || !!window.getAllAngularRootElements;
            checks.vue = !!window.__VUE__;
            checks.nextjs = !!window.__NEXT_DATA__;
            checks.bodyClasses = document.body.className;
            checks.appDiv = document.querySelector('#__next, #app, #root, .app')?.tagName || 'none';
            return checks;
        }""")
        log(f"  {framework}")
    except:
        pass
