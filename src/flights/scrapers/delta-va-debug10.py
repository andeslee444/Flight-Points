#!/usr/bin/env python3
"""VA search - simplified form fill, focus on API capture."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    context = browser.new_context(extra_http_headers={'Accept-Encoding': 'gzip, deflate'})
    page = context.new_page()

    graphql_responses = []
    all_api_calls = []

    def on_request(req):
        url = req.url
        if 'graphql' in url.lower() and 'virginatlantic' in url:
            log(f"API REQUEST: {req.method} {url[:200]}")
            try:
                log(f"  Post data: {req.post_data[:500] if req.post_data else 'None'}")
            except:
                pass

    def on_response(resp):
        url = resp.url
        if 'graphql' in url.lower() and 'virginatlantic' in url:
            log(f"API RESPONSE: {resp.status} {url[:200]}")
            try:
                body = resp.text()
                log(f"  Body: {body[:500]}")
                if resp.status == 200 and body.startswith('{'):
                    graphql_responses.append(json.loads(body))
            except:
                pass
        # Also capture any XHR/fetch that might be search
        elif 'search' in url.lower() and 'virginatlantic' in url and resp.status == 200:
            ct = resp.headers.get('content-type', '')
            if 'json' in ct or 'javascript' not in ct:
                if not any(x in url for x in ['.js', '.css', '.png', '.jpg', '.woff']):
                    log(f"OTHER API: {resp.status} {ct[:30]} {url[:200]}")
                    all_api_calls.append(url)

    page.on("request", on_request)
    page.on("response", on_response)

    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(8)

    # Accept cookies
    try:
        page.click('#ensAcceptAll', timeout=3000)
        time.sleep(1)
    except:
        pass

    # Enable reward search
    page.click('#switch-checkbox', force=True)
    time.sleep(1)
    reward_state = page.evaluate('() => document.querySelector("#switch-checkbox")?.checked')
    log(f"Reward: {reward_state}")

    # Fill origin
    log("Filling origin JFK...")
    page.click('#flights_from')
    time.sleep(0.5)
    page.type('#flights_from', 'JFK', delay=100)
    time.sleep(2)

    # Check for dropdown options
    opts = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('[role="option"]'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.innerText?.substring(0,80))
            .slice(0, 5);
    }""")
    log(f"Origin options: {opts}")

    # Click first matching option
    clicked = page.evaluate("""() => {
        const opts = document.querySelectorAll('[role="option"]');
        for (const o of opts) {
            if (o.offsetParent !== null && (o.innerText.includes('JFK') || o.innerText.includes('Kennedy') || o.innerText.includes('New York'))) {
                o.click();
                return o.innerText.substring(0, 60);
            }
        }
        return null;
    }""")
    log(f"Clicked origin: {clicked}")
    time.sleep(1)

    # Fill destination
    log("Filling destination LAX...")
    page.click('#flights_to')
    time.sleep(0.5)
    page.type('#flights_to', 'LAX', delay=100)
    time.sleep(2)

    opts2 = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('[role="option"]'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.innerText?.substring(0,80))
            .slice(0, 5);
    }""")
    log(f"Dest options: {opts2}")

    clicked2 = page.evaluate("""() => {
        const opts = document.querySelectorAll('[role="option"]');
        for (const o of opts) {
            if (o.offsetParent !== null && (o.innerText.includes('LAX') || o.innerText.includes('Los Angeles'))) {
                o.click();
                return o.innerText.substring(0, 60);
            }
        }
        return null;
    }""")
    log(f"Clicked dest: {clicked2}")
    time.sleep(1)

    # Handle trip type - use JS to set value directly
    log("Setting One Way via JS...")
    page.evaluate("""() => {
        const el = document.querySelector('#trip_type');
        if (el) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, 'One way');
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }""")
    time.sleep(0.5)

    # Handle date - click the date field and navigate calendar
    log("Setting date...")
    page.click('#flights_departing')
    time.sleep(1)

    # Take screenshot to see calendar
    page.screenshot(path="/tmp/va-calendar.png")
    
    # Try to navigate calendar to March 2026
    # First see what's currently shown
    cal_info = page.evaluate("""() => {
        const visible = document.body.innerText;
        // Find month/year indicators
        const months = visible.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{4}/g);
        return {months: months, hasCalendar: document.querySelector('[role="grid"]') !== null || document.querySelector('.calendar') !== null};
    }""")
    log(f"Calendar info: {json.dumps(cal_info)}")

    # Try navigating forward to March 2026
    # Look for next month button
    for i in range(20):
        cal_months = page.evaluate("""() => {
            const text = document.body.innerText;
            const m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{4}/g);
            return m;
        }""")
        log(f"  Calendar months: {cal_months}")
        if cal_months and any('March 2026' in m or 'March2026' in m for m in cal_months):
            break
        # Click next
        try:
            next_btn = page.evaluate("""() => {
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    const label = (b.getAttribute('aria-label') || b.innerText || '').toLowerCase();
                    if (label.includes('next') || label.includes('forward') || label.includes('›') || label === '>') {
                        b.click();
                        return label;
                    }
                }
                // Try SVG arrow buttons
                const arrows = document.querySelectorAll('[class*="next"], [class*="forward"], [class*="arrow-right"]');
                if (arrows.length) { arrows[0].click(); return 'arrow-class'; }
                return null;
            }""")
            if not next_btn:
                log("  No next button found")
                break
            time.sleep(0.3)
        except:
            break

    # Click day 15
    clicked_day = page.evaluate("""() => {
        // Try various selectors for day 15
        const cells = document.querySelectorAll('[role="gridcell"], td, [class*="day"]');
        for (const c of cells) {
            const text = c.innerText?.trim();
            if (text === '15') {
                c.click();
                return true;
            }
        }
        // Try button inside grid
        const btns = document.querySelectorAll('[role="grid"] button, .calendar button');
        for (const b of btns) {
            if (b.innerText?.trim() === '15') {
                b.click();
                return true;
            }
        }
        return false;
    }""")
    log(f"Clicked day 15: {clicked_day}")
    time.sleep(1)

    # Check form state
    form = page.evaluate("""() => ({
        from: document.querySelector('#flights_from')?.value,
        to: document.querySelector('#flights_to')?.value,
        trip: document.querySelector('#trip_type')?.value,
        depart: document.querySelector('#flights_departing')?.value,
        who: document.querySelector('#flights_who')?.value,
        reward: document.querySelector('#switch-checkbox')?.checked,
    })""")
    log(f"Form state: {json.dumps(form)}")

    # Click search
    log("Clicking Search...")
    search_btn = page.query_selector('button:has-text("Search flights")')
    if search_btn:
        search_btn.click()
        log("Clicked search button")
    else:
        log("Search button not found!")
        # Try alternatives
        page.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.innerText?.includes('Search')) {
                    b.click();
                    return b.innerText;
                }
            }
        }""")

    # Wait for API
    log("Waiting for API responses...")
    for i in range(15):
        if graphql_responses:
            break
        time.sleep(3)
        if i % 3 == 2:
            current_url = page.url
            log(f"  Waiting... URL: {current_url}")

    log(f"\n=== Summary ===")
    log(f"GraphQL responses: {len(graphql_responses)}")
    log(f"Other API calls: {len(all_api_calls)}")

    if graphql_responses:
        for resp in graphql_responses:
            log(f"Response: {json.dumps(resp)[:2000]}")
    
    # Final screenshot
    page.screenshot(path="/tmp/va-final.png")
    log(f"Final URL: {page.url}")
    
    # Dump page text if no API
    if not graphql_responses:
        text = page.evaluate("() => document.body?.innerText?.substring(0, 2000) || ''")
        log(f"Page text: {text[:1000]}")
