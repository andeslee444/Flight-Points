#!/usr/bin/env python3
"""
United Award Search via Aeroplan + Patchright (patched Chromium).

Same logic as united-aeroplan-camoufox.py but uses Patchright. Chromium renders
the Aeroplan SPA (Camoufox Firefox shows blank pages).

Env vars:
  AEROPLAN_USERNAME - Aeroplan member number or email
  AEROPLAN_PASSWORD - Aeroplan password

Usage:
  python3 united-aeroplan-patchright.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re
from urllib.parse import urlparse

def log(msg):
    print(f"[UA-Aeroplan-PR {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def validate_params(params):
    for field in ("origin", "destination", "date"):
        if field not in params or not isinstance(params[field], str):
            raise ValueError(f"Missing or invalid field: {field}")
    if not re.match(r'^[A-Z]{3}$', params["origin"]):
        raise ValueError(f"Invalid origin airport code: {params['origin']}")
    if not re.match(r'^[A-Z]{3}$', params["destination"]):
        raise ValueError(f"Invalid destination airport code: {params['destination']}")
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', params["date"]):
        raise ValueError(f"Invalid date format: {params['date']}")

def random_delay(lo=1.5, hi=3.5):
    time.sleep(random.uniform(lo, hi))

def human_type(page, selector, text, delay_range=(50, 150)):
    el = page.query_selector(selector)
    if el:
        el.click()
        time.sleep(random.uniform(0.2, 0.5))
        for char in text:
            page.keyboard.type(char, delay=random.randint(*delay_range))
            if random.random() < 0.1:
                time.sleep(random.uniform(0.1, 0.3))

def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    try:
        validate_params(params)
    except ValueError as e:
        log(f"Validation error: {e}")
        print("[]")
        sys.exit(0)
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")

    username = os.environ.get("AEROPLAN_USERNAME", "")
    password = os.environ.get("AEROPLAN_PASSWORD", "")

    if not username or not password:
        log("ERROR: AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars required")
        print("[]")
        sys.exit(0)

    cabin_map = {"economy": "ECO", "business": "BUS", "first": "FIR"}
    cabin_code = cabin_map.get(cabin, "BUS")

    log(f"Search: {origin}→{destination} {date} {cabin}")

    from patchright.sync_api import sync_playwright

    results = []
    api_responses = []

    try:
        # Use residential proxy for fresh IP. Patchright (Chromium) handles HTTP proxy SSL fine.
        import string
        proxy_url = os.environ.get("PROXY_URL", "")
        proxy_cfg = None
        if proxy_url:
            parsed = urlparse(proxy_url)
            if parsed.scheme in ("socks5", "socks4"):
                server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
                proxy_cfg = {"server": server}
                if parsed.username:
                    proxy_cfg["username"] = parsed.username
                if parsed.password:
                    proxy_cfg["password"] = parsed.password
                log(f"Using SOCKS5 proxy: {parsed.hostname}:{parsed.port}")
            elif parsed.scheme in ("http", "https"):
                server = f"http://{parsed.hostname}:{parsed.port}"
                username = parsed.username or ""
                if "brd-customer" in username and "-session-" not in username:
                    session_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
                    username = f"{username}-session-{session_id}"
                    log(f"Using Bright Data residential proxy (session={session_id})")
                else:
                    log(f"Using HTTP proxy: {parsed.hostname}:{parsed.port}")
                proxy_cfg = {"server": server, "username": username, "password": parsed.password or ""}
            else:
                log(f"Unknown proxy scheme: {parsed.scheme}")

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                channel="chrome",
                args=[
                    "--disable-http2",
                    "--no-first-run",
                ],
                **({"proxy": proxy_cfg} if proxy_cfg else {}),
            )
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                timezone_id="America/New_York",
                locale="en-US",
                ignore_https_errors=True,
            )
            page = context.new_page()

            # Intercept API responses for award data
            all_api_urls = []
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                status = response.status
                # Log non-200 responses for debugging
                if status != 200 and status != 204 and status != 304 and status != 301 and status != 302:
                    all_api_urls.append(f"[{status}] {url[:150]}")
                if "json" in ct and status == 200:
                    try:
                        body = response.text()
                        if len(body) > 200:
                            data = json.loads(body)
                            log(f"API [{status}]: {url[:100]} ({len(body)} bytes)")
                            if ('availability' in url or 'air-bounds' in url or 'search' in url or
                                any(k in data for k in ["airBoundGroups", "airBounds", "data"])):
                                api_responses.append(data)
                                log(f"  -> Captured for parsing")
                    except:
                        pass
            page.on("response", handle_response)

            # Step 1: Go to Air Canada homepage to warm cookies
            log("Warming cookies on aircanada.com...")
            try:
                page.goto("https://www.aircanada.com/", timeout=30000, wait_until="domcontentloaded")
                random_delay(3, 6)
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                random_delay(2, 4)
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Step 2: Navigate to Aeroplan and log in
            # Go to the Aeroplan page first to trigger login redirect
            log("Navigating to Aeroplan...")
            try:
                page.goto("https://www.aircanada.com/aeroplan/", timeout=30000, wait_until="domcontentloaded")
                random_delay(2, 4)
            except Exception as e:
                log(f"Aeroplan navigation issue: {e}")

            current_url = page.url
            page_content = page.content().lower()
            body_text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
            log(f"Aeroplan page: {current_url[:100]}, body: {body_text[:150]}")

            # Check if we need to log in
            needs_login = ('login' in current_url or 'signin' in current_url or 'auth' in current_url)

            if not needs_login:
                # Try to find and click the login button on the Aeroplan page
                log("Looking for Sign In button...")
                login_clicked = False
                login_btn_selectors = [
                    'a:has-text("Sign in")', 'a:has-text("Log in")',
                    'button:has-text("Sign in")', 'button:has-text("Log in")',
                    '[data-testid*="login"]', '[data-testid*="signin"]',
                    'a[href*="login"]', 'a[href*="signin"]', 'a[href*="auth"]',
                ]
                for sel in login_btn_selectors:
                    try:
                        btn = page.locator(sel).first
                        if btn.count() > 0 and btn.is_visible(timeout=2000):
                            btn.click()
                            login_clicked = True
                            log(f"Clicked login button: {sel}")
                            random_delay(3, 5)
                            break
                    except:
                        continue

                if login_clicked:
                    needs_login = True
                    current_url = page.url
                    log(f"After login click: {current_url[:100]}")
                else:
                    log("No login button found on Aeroplan page")

            if needs_login:
                log("Authenticating...")

                # Wait for login form to appear
                random_delay(2, 3)

                login_selectors = [
                    'input[name="username"]', 'input[name="email"]', 'input[type="email"]',
                    'input[name="memberNumber"]', 'input[id*="username"]', 'input[id*="email"]',
                    'input[id*="member"]', '#loginForm input[type="text"]',
                    'input[placeholder*="email" i]', 'input[placeholder*="member" i]',
                    'input[placeholder*="number" i]', 'input[name="login"]',
                    'input[type="text"]',
                ]
                password_selectors = [
                    'input[name="password"]', 'input[type="password"]',
                    'input[id*="password"]', '#loginForm input[type="password"]',
                ]
                submit_selectors = [
                    'button[type="submit"]', 'input[type="submit"]',
                    'button[id*="login" i]', 'button[id*="submit" i]',
                    'button:has-text("Sign in")', 'button:has-text("Log in")',
                    'button:has-text("sign in")', 'button:has-text("log in")',
                    'button:has-text("Continue")',
                ]

                # List all visible inputs for debugging
                visible_inputs = page.evaluate('''() => {
                    const inputs = document.querySelectorAll('input');
                    return Array.from(inputs).filter(i => i.offsetParent !== null).map(i => ({
                        type: i.type, name: i.name, id: i.id, placeholder: i.placeholder
                    })).slice(0, 10);
                }''')
                log(f"Visible inputs: {json.dumps(visible_inputs)[:300]}")

                username_filled = False
                for sel in login_selectors:
                    try:
                        el = page.query_selector(sel)
                        if el and el.is_visible():
                            human_type(page, sel, username)
                            username_filled = True
                            log(f"Filled username via {sel}")
                            break
                    except:
                        continue

                if not username_filled:
                    log("Could not find username field — skipping login")
                    # Don't exit — try search without login

                if username_filled:
                    random_delay(0.5, 1.5)

                    password_filled = False
                    for sel in password_selectors:
                        try:
                            el = page.query_selector(sel)
                            if el and el.is_visible():
                                human_type(page, sel, password)
                                password_filled = True
                                log(f"Filled password via {sel}")
                                break
                        except:
                            continue

                    if password_filled:
                        random_delay(0.5, 1)

                        submitted = False
                        for sel in submit_selectors:
                            try:
                                el = page.query_selector(sel)
                                if el and el.is_visible():
                                    el.click()
                                    submitted = True
                                    log(f"Clicked submit via {sel}")
                                    break
                            except:
                                continue

                        if not submitted:
                            page.keyboard.press("Enter")
                            log("Pressed Enter to submit")

                        log("Waiting for login to complete...")
                        random_delay(5, 8)

                        current_url = page.url
                        page_content = page.content().lower()
                        if 'error' in page_content and ('password' in page_content or 'credential' in page_content):
                            log("Login failed - invalid credentials")

                        log(f"Post-login URL: {current_url}")
                    else:
                        log("Could not find password field")

            # Add warmup delay before search to establish session
            random_delay(5, 8)

            # Step 3: Navigate to award search
            search_url = (
                f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
                f"?org0={origin}&dest0={destination}&departureDate0={date}"
                f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
                f"&cabinClass={cabin_code}"
            )
            log(f"Navigating to search...")
            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Search navigation issue: {e}")

            log("Waiting for results...")
            random_delay(5, 8)

            result_selectors = [
                '[class*="bound-row"]', '[class*="flight-row"]', '[class*="FlightResult"]',
                '[class*="availability"]', '[data-testid*="flight"]', '[data-testid*="bound"]',
                '.air-bound-card', '.flight-card', '.result-card',
                '[class*="air-bound"]', '[class*="slice"]',
            ]

            found_results = False
            for sel in result_selectors:
                try:
                    page.wait_for_selector(sel, timeout=5000)
                    found_results = True
                    log(f"Found results via selector: {sel}")
                    break
                except:
                    continue

            if not found_results:
                log("No result selectors found, waiting longer...")
                random_delay(5, 10)

                page_content = page.content().lower()
                if 'no flights' in page_content or 'no results' in page_content or 'no availability' in page_content:
                    log("No flights available (legitimate)")
                    print("[]")
                    sys.exit(0)

                if 'login' in page.url or 'signin' in page.url:
                    log("Redirected back to login — session blocked, exit for retry")
                    sys.exit(1)

                page_len = len(page.content())
                body_text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
                log(f"Page size: {page_len} bytes, body: {body_text[:200]}")
                if all_api_urls:
                    log(f"Non-200 API requests: {len(all_api_urls)}")
                    for u in all_api_urls[-10:]:
                        log(f"  {u}")
                if page_len < 5000:
                    log(f"Page too small ({page_len} bytes) — likely blocked, exit for retry")
                    sys.exit(1)

            random_delay(2, 4)

            # Step 4: Parse results
            if api_responses:
                log(f"Parsing {len(api_responses)} intercepted API responses...")
                results = parse_api_responses(api_responses, params)

            if not results:
                log("Parsing from DOM...")
                results = page.evaluate("""(sp) => {
                    const flights = [];

                    const selectors = [
                        '[class*="bound-row"]', '[class*="flight-row"]',
                        '[class*="air-bound"]', '[class*="slice"]',
                        '[class*="result-card"]', '[class*="flight-card"]',
                        'table tbody tr', '.bound-card',
                    ];

                    let rows = [];
                    for (const sel of selectors) {
                        rows = document.querySelectorAll(sel);
                        if (rows.length > 0) break;
                    }

                    if (rows.length === 0) return [];

                    rows.forEach((row) => {
                        const text = row.textContent || '';

                        const fnMatches = text.match(/([A-Z]{2})\\s*(\\d{1,4})/g) || [];
                        const flightNumbers = fnMatches.map(m => m.replace(/\\s+/g, ''));

                        const hasUA = flightNumbers.some(fn => fn.startsWith('UA'));

                        const pointsPatterns = [
                            /([\\d,]+)\\s*(?:pts|points|miles)/i,
                            /([\\d,]+)K/,
                            /([\\d,]+)\\s*Aeroplan/i,
                        ];
                        let pointsRequired = 0;
                        for (const pat of pointsPatterns) {
                            const m = text.match(pat);
                            if (m) {
                                let val = parseFloat(m[1].replace(/,/g, ''));
                                if (text.match(/([\\d,]+)K/)) val *= 1000;
                                pointsRequired = val;
                                break;
                            }
                        }

                        const timeMatches = text.match(/(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)?)/g) || [];
                        const departureTime = timeMatches[0] || '';
                        const arrivalTime = timeMatches[1] || '';

                        const durMatch = text.match(/(\\d+)h\\s*(\\d+)?m?/i);
                        const duration = durMatch ? `${durMatch[1]}h${durMatch[2] || '0'}m` : '';

                        const stopsMatch = text.match(/(\\d+)\\s*stop/i);
                        const isNonstop = /nonstop|non-stop|direct/i.test(text);
                        const stops = isNonstop ? 0 : (stopsMatch ? parseInt(stopsMatch[1]) : 0);

                        const taxMatch = text.match(/\\$\\s*([\\d,.]+)/);
                        const taxesAndFees = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : 0;

                        const primaryFn = flightNumbers[0] || '';
                        const airlineCode = primaryFn.match(/^([A-Z]{2})/)?.[1] || 'AC';
                        const airlineNames = {
                            'UA': 'United Airlines', 'AC': 'Air Canada', 'NH': 'ANA',
                            'LH': 'Lufthansa', 'LX': 'Swiss', 'OS': 'Austrian',
                            'SN': 'Brussels Airlines', 'SK': 'SAS', 'TG': 'Thai Airways',
                            'SQ': 'Singapore Airlines', 'OZ': 'Asiana', 'BR': 'EVA Air',
                            'TK': 'Turkish Airlines', 'ET': 'Ethiopian Airlines',
                            'CA': 'Air China', 'ZH': 'Shenzhen Airlines',
                            'AI': 'Air India', 'MS': 'EgyptAir', 'TP': 'TAP Portugal',
                            'CM': 'Copa Airlines', 'AV': 'Avianca',
                        };

                        let cabinResult = sp.cabin;
                        if (/business/i.test(text)) cabinResult = 'business';
                        else if (/first/i.test(text)) cabinResult = 'first';
                        else if (/economy|eco/i.test(text)) cabinResult = 'economy';

                        if (pointsRequired > 0 || flightNumbers.length > 0) {
                            flights.push({
                                source: 'aeroplan',
                                airline: airlineNames[airlineCode] || airlineCode,
                                flightNumber: flightNumbers.join(', '),
                                origin: sp.origin,
                                destination: sp.destination,
                                departureDate: sp.date,
                                departureTime,
                                arrivalTime,
                                duration,
                                stops,
                                cabin: cabinResult,
                                pointsRequired,
                                pointsProgram: 'Aeroplan',
                                taxesAndFees,
                                awardType: airlineCode === 'AC' ? 'saver' : 'partner',
                                isUnitedMetal: hasUA,
                                scrapedAt: new Date().toISOString(),
                            });
                        }
                    });

                    return flights;
                }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})

            log(f"Found {len(results)} total results")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    # Add booking URL to all results
    search_url = (
        f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
        f"?org0={origin}&dest0={destination}&departureDate0={date}"
        f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
        f"&cabinClass={cabin_code}"
    )
    for r in results:
        r["bookingUrl"] = search_url
        r.pop("isUnitedMetal", None)

    print(json.dumps(results))


def parse_api_responses(api_responses, params):
    results = []

    airline_names = {
        'UA': 'United Airlines', 'AC': 'Air Canada', 'NH': 'ANA',
        'LH': 'Lufthansa', 'LX': 'Swiss', 'OS': 'Austrian',
        'SN': 'Brussels Airlines', 'SK': 'SAS', 'TG': 'Thai Airways',
        'SQ': 'Singapore Airlines', 'OZ': 'Asiana', 'BR': 'EVA Air',
        'TK': 'Turkish Airlines', 'ET': 'Ethiopian Airlines',
    }

    for data in api_responses:
        try:
            bounds = (
                data.get("data", {}).get("airBoundGroups", []) or
                data.get("data", {}).get("airBounds", []) or
                data.get("airBoundGroups", []) or
                data.get("airBounds", []) or
                []
            )

            for bound in bounds:
                segments = bound.get("segments", []) or bound.get("flights", []) or []

                flight_numbers = []
                airlines = []
                dep_time = ""
                arr_time = ""
                total_duration = bound.get("duration", "") or ""
                stops = max(0, len(segments) - 1)

                for i, seg in enumerate(segments):
                    carrier = seg.get("marketingCarrier", seg.get("airlineCode", ""))
                    fn = seg.get("flightNumber", seg.get("flightNum", ""))
                    flight_numbers.append(f"{carrier}{fn}")
                    airlines.append(carrier)

                    if i == 0:
                        dep_time = seg.get("departureTime", seg.get("departure", {}).get("time", ""))
                    if i == len(segments) - 1:
                        arr_time = seg.get("arrivalTime", seg.get("arrival", {}).get("time", ""))

                fares = bound.get("airFares", []) or bound.get("fares", []) or bound.get("prices", []) or []
                for fare in fares:
                    points = fare.get("points", fare.get("miles", fare.get("aeroplanPoints", 0)))
                    taxes = fare.get("taxes", fare.get("surcharge", fare.get("totalTax", 0)))
                    fare_cabin = fare.get("cabin", fare.get("cabinClass", params.get("cabin", "business")))

                    if isinstance(fare_cabin, str):
                        fare_cabin = fare_cabin.lower()
                        if fare_cabin in ("j", "bus", "business"):
                            fare_cabin = "business"
                        elif fare_cabin in ("f", "fir", "first"):
                            fare_cabin = "first"
                        else:
                            fare_cabin = "economy"

                    primary_carrier = airlines[0] if airlines else "AC"

                    results.append({
                        "source": "aeroplan",
                        "airline": airline_names.get(primary_carrier, primary_carrier),
                        "flightNumber": ", ".join(flight_numbers),
                        "origin": params["origin"],
                        "destination": params["destination"],
                        "departureDate": params["date"],
                        "departureTime": dep_time,
                        "arrivalTime": arr_time,
                        "duration": total_duration,
                        "stops": stops,
                        "cabin": fare_cabin,
                        "pointsRequired": points,
                        "pointsProgram": "Aeroplan",
                        "taxesAndFees": taxes,
                        "awardType": "partner" if primary_carrier != "AC" else "saver",
                        "isUnitedMetal": "UA" in airlines,
                        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    })

                if not fares and flight_numbers:
                    primary_carrier = airlines[0] if airlines else "AC"
                    points = bound.get("points", bound.get("miles", 0))
                    taxes = bound.get("taxes", 0)

                    results.append({
                        "source": "aeroplan",
                        "airline": airline_names.get(primary_carrier, primary_carrier),
                        "flightNumber": ", ".join(flight_numbers),
                        "origin": params["origin"],
                        "destination": params["destination"],
                        "departureDate": params["date"],
                        "departureTime": dep_time,
                        "arrivalTime": arr_time,
                        "duration": total_duration,
                        "stops": stops,
                        "cabin": params.get("cabin", "business"),
                        "pointsRequired": points,
                        "pointsProgram": "Aeroplan",
                        "taxesAndFees": taxes,
                        "awardType": "partner" if primary_carrier != "AC" else "saver",
                        "isUnitedMetal": "UA" in airlines,
                        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    })

        except Exception as e:
            log(f"API parse error: {e}")

    return results


if __name__ == "__main__":
    main()
