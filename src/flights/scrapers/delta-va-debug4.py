#!/usr/bin/env python3
"""Debug VA - check if page actually renders."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    log("Going to VA homepage with networkidle...")
    try:
        page.goto("https://www.virginatlantic.com/", timeout=60000, wait_until="networkidle")
    except Exception as e:
        log(f"Timeout on networkidle: {e}")

    log(f"URL: {page.url}")
    log(f"Title: '{page.title()}'")

    content = page.content()
    log(f"HTML length: {len(content)}")
    
    # Check if body has content
    body_text = page.evaluate("() => document.body?.innerText?.length || 0")
    log(f"Body text length: {body_text}")

    # Get first 500 chars of body text
    body_preview = page.evaluate("() => document.body?.innerText?.substring(0, 500) || 'EMPTY'")
    log(f"Body preview: {body_preview}")

    # Check console errors
    errors = []
    page.on("console", lambda msg: errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)

    # Check if there's a booking search widget
    # Try the "book with points" or reward flights URL
    urls_to_try = [
        "https://www.virginatlantic.com/flights",
        "https://www.virginatlantic.com/flights/search",
        "https://www.virginatlantic.com/reward-flights",
    ]

    for url in urls_to_try:
        log(f"\nTrying: {url}")
        try:
            resp = page.goto(url, timeout=20000, wait_until="domcontentloaded")
            log(f"  Status: {resp.status if resp else 'None'}")
            log(f"  Title: '{page.title()}'")
            log(f"  URL: {page.url}")
            body_len = page.evaluate("() => document.body?.innerText?.length || 0")
            log(f"  Body text length: {body_len}")
            if body_len > 0:
                preview = page.evaluate("() => document.body?.innerText?.substring(0, 300) || ''")
                log(f"  Preview: {preview[:200]}")
        except Exception as e:
            log(f"  Error: {e}")

    # Try the actual booking form page  
    log("\nTrying booking form page...")
    page.goto("https://www.virginatlantic.com/", timeout=30000)
    time.sleep(8)  # wait for SPA to load
    
    body_text2 = page.evaluate("() => document.body?.innerText?.substring(0, 2000) || 'EMPTY'")
    log(f"Homepage after 8s wait:\n{body_text2[:1000]}")
    
    # Count all elements
    el_count = page.evaluate("() => document.querySelectorAll('*').length")
    log(f"Total DOM elements: {el_count}")
    
    # Check for React/Next.js
    nextdata = page.evaluate("() => !!window.__NEXT_DATA__")
    log(f"Next.js: {nextdata}")
    
    # Find any inputs at all
    inputs = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('input, button, [role="combobox"], [role="button"], [role="tab"]')).map(el => ({
            tag: el.tagName, role: el.role, type: el.type, id: el.id?.substring(0,30),
            text: el.innerText?.substring(0,30), ariaLabel: el.getAttribute('aria-label')?.substring(0,30)
        })).slice(0, 30);
    }""")
    log(f"Interactive elements: {len(inputs)}")
    for inp in inputs:
        log(f"  {json.dumps(inp)}")
