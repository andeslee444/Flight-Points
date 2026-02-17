#!/usr/bin/env python3
"""Find VA's actual search form and its structure."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    graphql_urls = []
    def on_response(resp):
        if 'graphql' in resp.url.lower() or 'search' in resp.url.lower():
            if not any(x in resp.url for x in ['.js', '.css', '.png']):
                log(f"API: {resp.status} {resp.url[:200]}")
                graphql_urls.append(resp.url)

    page.on("response", on_response)

    # Go to homepage - that's where the booking widget is
    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(5)

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

    # The booking widget is on the homepage. Find it.
    log("Looking for booking widget elements...")
    
    # Get all interactive elements
    result = page.evaluate("""() => {
        const info = [];
        // All inputs
        document.querySelectorAll('input, select, textarea').forEach(el => {
            info.push({
                tag: el.tagName, type: el.type, name: el.name, id: el.id,
                placeholder: el.placeholder, class: el.className?.substring(0,60),
                ariaLabel: el.getAttribute('aria-label'),
                testid: el.getAttribute('data-testid'),
                visible: el.offsetParent !== null
            });
        });
        // All buttons
        document.querySelectorAll('button').forEach(el => {
            info.push({
                tag: 'BUTTON', text: el.innerText?.substring(0,40), id: el.id,
                class: el.className?.substring(0,60),
                ariaLabel: el.getAttribute('aria-label'),
                testid: el.getAttribute('data-testid'),
                visible: el.offsetParent !== null
            });
        });
        return info;
    }""")
    
    for item in result:
        if item.get('visible'):
            log(f"  VISIBLE: {json.dumps(item)}")
    
    log(f"\nTotal form elements: {len(result)}, visible: {len([i for i in result if i.get('visible')])}")

    # Look specifically for the booking widget container
    log("\nLooking for booking widget container...")
    containers = page.evaluate("""() => {
        const matches = [];
        document.querySelectorAll('[class*="book"], [class*="search"], [class*="widget"], [class*="hero"], [id*="book"], [id*="search"]').forEach(el => {
            matches.push({
                tag: el.tagName, id: el.id, class: el.className?.substring(0,80),
                childCount: el.children.length,
                text: el.innerText?.substring(0,100)
            });
        });
        return matches.slice(0, 30);
    }""")
    for c in containers:
        log(f"  {json.dumps(c)}")

    # Check for iframes (booking widget might be in an iframe)
    iframes = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: f.src, id: f.id, name: f.name, class: f.className?.substring(0,40)
        }));
    }""")
    log(f"\nIframes: {len(iframes)}")
    for f in iframes:
        log(f"  {json.dumps(f)}")

    # Check for shadow DOMs
    shadows = page.evaluate("""() => {
        const count = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot).length;
        return count;
    }""")
    log(f"Shadow DOM elements: {shadows}")

    # Try to find the correct search page URL by looking at links
    log("\nLooking for search/booking links...")
    links = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('a')).filter(a => {
            const href = a.href?.toLowerCase() || '';
            return href.includes('search') || href.includes('book') || href.includes('flight');
        }).map(a => ({href: a.href, text: a.innerText?.substring(0,40)})).slice(0, 20);
    }""")
    for l in links:
        log(f"  {json.dumps(l)}")

    # Look for web components
    log("\nLooking for custom elements (web components)...")
    custom = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('*')).filter(el => el.tagName.includes('-')).map(el => el.tagName).filter((v,i,a) => a.indexOf(v) === i).slice(0, 30);
    }""")
    log(f"Custom elements: {custom}")
