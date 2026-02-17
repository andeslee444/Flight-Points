#!/usr/bin/env python3
"""VA search - fill form, submit, intercept GraphQL."""
import json, sys, time

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

with Camoufox(headless=True, humanize=True) as browser:
    context = browser.new_context(extra_http_headers={
        'Accept-Encoding': 'gzip, deflate'
    })
    page = context.new_page()

    graphql_responses = []
    all_api_calls = []

    def on_response(resp):
        url = resp.url
        if any(x in url.lower() for x in ['graphql', '/api/', 'search']) and 'virginatlantic' in url:
            if not any(x in url for x in ['.js', '.css', '.png', '.jpg']):
                log(f"API: {resp.status} {url[:200]}")
                all_api_calls.append({'status': resp.status, 'url': url})
                try:
                    body = resp.text()
                    log(f"  Body preview: {body[:500]}")
                    if resp.status == 200 and body.startswith('{'):
                        data = json.loads(body)
                        if 'data' in data:
                            graphql_responses.append(data)
                            log(f"  *** CAPTURED GraphQL response with data!")
                except:
                    pass
    page.on("response", on_response)

    # Navigate to homepage
    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=45000, wait_until="domcontentloaded")
    time.sleep(8)

    # Accept cookies
    try:
        page.click('#ensAcceptAll', timeout=3000)
        time.sleep(1)
        log("Accepted cookies")
    except:
        try:
            page.click('#onetrust-accept-btn-handler', timeout=3000)
            time.sleep(1)
        except:
            pass

    # Check if reward toggle is already on
    switch_state = page.evaluate("() => document.querySelector('#switch-checkbox')?.checked")
    log(f"Reward toggle checked: {switch_state}")

    # Enable reward search if not already
    if not switch_state:
        log("Clicking reward toggle...")
        page.click('#switch-checkbox', force=True)
        time.sleep(1)
        switch_state2 = page.evaluate("() => document.querySelector('#switch-checkbox')?.checked")
        log(f"Reward toggle now: {switch_state2}")

    # Check what the form looks like now after toggling reward
    form_state = page.evaluate("""() => {
        const from = document.querySelector('#flights_from');
        const to = document.querySelector('#flights_to');
        const trip = document.querySelector('#trip_type');
        const depart = document.querySelector('#flights_departing');
        const who = document.querySelector('#flights_who');
        return {
            from: {val: from?.value, visible: from?.offsetParent !== null},
            to: {val: to?.value, visible: to?.offsetParent !== null},
            trip: {val: trip?.value, visible: trip?.offsetParent !== null},
            depart: {val: depart?.value, visible: depart?.offsetParent !== null},
            who: {val: who?.value, visible: who?.offsetParent !== null},
        };
    }""")
    log(f"Form state: {json.dumps(form_state)}")

    # Set trip type to One way
    log("Setting trip type to One Way...")
    page.click('#trip_type')
    time.sleep(0.5)
    # Look for one-way option
    options = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, .dropdown-menu li, [class*="dropdown"] li, [class*="option"]')).map(el => ({
            text: el.innerText?.substring(0,40),
            tag: el.tagName,
            class: el.className?.substring(0,40),
            role: el.getAttribute('role')
        })).slice(0, 20);
    }""")
    log(f"Trip type options: {json.dumps(options)}")

    # Try clicking "One way" option
    try:
        page.click('text="One way"', timeout=3000)
        log("Selected One way")
    except:
        try:
            page.click('text="one way"', timeout=2000)
        except:
            log("Could not find One way option")

    time.sleep(0.5)

    # Fill origin - JFK
    log("Filling origin: JFK...")
    page.click('#flights_from')
    time.sleep(0.5)
    page.fill('#flights_from', 'JFK')
    time.sleep(2)  # Wait for autocomplete

    # Find and click JFK option
    options_from = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('[role="option"]')).map(el => ({
            text: el.innerText?.substring(0,80),
            id: el.id?.substring(0,30),
            visible: el.offsetParent !== null
        })).filter(el => el.visible).slice(0, 10);
    }""")
    log(f"Origin options: {json.dumps(options_from)}")

    # Click JFK option
    try:
        page.click('[role="option"]:has-text("JFK")', timeout=3000)
        log("Selected JFK")
    except Exception as e:
        log(f"Could not click JFK: {e}")
        # Try alternative
        try:
            page.evaluate("""() => {
                const opts = document.querySelectorAll('[role="option"]');
                for (const o of opts) {
                    if (o.innerText.includes('JFK') || o.innerText.includes('Kennedy')) {
                        o.click();
                        return true;
                    }
                }
                return false;
            }""")
        except:
            pass

    time.sleep(1)

    # Fill destination - LAX
    log("Filling destination: LAX...")
    page.click('#flights_to')
    time.sleep(0.5)
    page.fill('#flights_to', 'LAX')
    time.sleep(2)

    options_to = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('[role="option"]')).filter(el => el.offsetParent !== null).map(el => ({
            text: el.innerText?.substring(0,80)
        })).slice(0, 10);
    }""")
    log(f"Dest options: {json.dumps(options_to)}")

    try:
        page.click('[role="option"]:has-text("LAX")', timeout=3000)
        log("Selected LAX")
    except:
        try:
            page.evaluate("""() => {
                const opts = document.querySelectorAll('[role="option"]');
                for (const o of opts) {
                    if (o.innerText.includes('LAX') || o.innerText.includes('Los Angeles')) {
                        o.click();
                        return true;
                    }
                }
                return false;
            }""")
        except:
            pass

    time.sleep(1)

    # Set date
    log("Setting departure date: 2026-03-15...")
    page.click('#flights_departing')
    time.sleep(1)

    # Check what calendar/date picker appears
    date_ui = page.evaluate("""() => {
        const cals = document.querySelectorAll('[class*="calendar"], [class*="date"], [class*="picker"], [role="dialog"], [role="grid"]');
        return Array.from(cals).map(el => ({
            tag: el.tagName, class: el.className?.substring(0,60), role: el.getAttribute('role'),
            visible: el.offsetParent !== null,
            text: el.innerText?.substring(0,200)
        })).filter(el => el.visible).slice(0, 10);
    }""")
    log(f"Date UI: {json.dumps(date_ui)}")

    # Try to navigate to March 2026 and click 15
    # First check what month is showing
    time.sleep(1)
    page.screenshot(path="/tmp/va-form.png")
    log("Form screenshot saved to /tmp/va-form.png")

    # Try to set date via JS 
    log("Trying to set date via value...")
    page.evaluate("""() => {
        const el = document.querySelector('#flights_departing');
        if (el) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, '15 Mar 2026');
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }""")
    time.sleep(1)

    # Check form state before submit
    form_state2 = page.evaluate("""() => {
        return {
            from: document.querySelector('#flights_from')?.value,
            to: document.querySelector('#flights_to')?.value,
            trip: document.querySelector('#trip_type')?.value,
            depart: document.querySelector('#flights_departing')?.value,
            who: document.querySelector('#flights_who')?.value,
            reward: document.querySelector('#switch-checkbox')?.checked,
        };
    }""")
    log(f"Form state before submit: {json.dumps(form_state2)}")

    # Click search
    log("Clicking Search flights...")
    try:
        page.click('button:has-text("Search flights")', timeout=5000)
    except Exception as e:
        log(f"Click search failed: {e}")

    # Wait for API response
    log("Waiting for API responses...")
    for i in range(20):
        if graphql_responses:
            break
        time.sleep(2)
        if i % 5 == 4:
            log(f"  Still waiting... ({i+1})")

    log(f"\n=== Results ===")
    log(f"GraphQL responses captured: {len(graphql_responses)}")
    log(f"All API calls: {len(all_api_calls)}")
    for call in all_api_calls:
        log(f"  {call['status']} {call['url'][:150]}")

    if graphql_responses:
        log(f"\nFirst response keys: {list(graphql_responses[0].keys())}")
        log(f"Data preview: {json.dumps(graphql_responses[0])[:1000]}")

    # Check current URL
    log(f"Current URL: {page.url}")
    page.screenshot(path="/tmp/va-results.png")
    log("Results screenshot saved")
