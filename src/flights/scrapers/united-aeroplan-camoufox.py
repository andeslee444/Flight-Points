#!/usr/bin/env python3
"""
United Award Search via Aeroplan + Camoufox.

Aeroplan (Air Canada) shows all Star Alliance award space including United metal.
Since March 2025, Aeroplan requires login to search awards.

Env vars:
  AEROPLAN_USERNAME - Aeroplan member number or email
  AEROPLAN_PASSWORD - Aeroplan password

Usage:
  python3 united-aeroplan-camoufox.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

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
    print(f"[UA-Aeroplan {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def validate_params(params):
    """Validate search params to prevent malformed input."""
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
    """Type text with human-like delays between keystrokes."""
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
        log("ERROR: AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars required (login required since March 2025)")
        print("[]")
        sys.exit(0)

    cabin_map = {"economy": "ECO", "business": "BUS", "first": "FIR"}
    cabin_code = cabin_map.get(cabin, "BUS")

    log(f"Search: {origin}→{destination} {date} {cabin}")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []
    api_responses = []

    try:
        # Only use SOCKS5 proxies for Camoufox — HTTP proxies cause SSL errors (SEC_ERROR_UNKNOWN_ISSUER)
        # and geoip=True crashes pages, so we NEVER pass it
        proxy_url = os.environ.get("PROXY_URL", "")
        proxy_cfg = None
        if proxy_url and proxy_url.startswith("socks"):
            parsed = urlparse(proxy_url)
            server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
            proxy_cfg = {"server": server}
            if parsed.username:
                proxy_cfg["username"] = parsed.username
            if parsed.password:
                proxy_cfg["password"] = parsed.password
            log(f"Using SOCKS5 proxy: {parsed.hostname}:{parsed.port}")
        elif proxy_url:
            log(f"Skipping HTTP proxy for Camoufox (causes SSL errors)")
        with Camoufox(headless=True, humanize=True, os='macos', proxy=proxy_cfg) as browser:
            if proxy_cfg:
                context = browser.new_context(ignore_https_errors=True)
                page = context.new_page()
            else:
                page = browser.new_page()

            # Intercept API responses for award data
            def handle_response(response):
                url = response.url
                if ('availability' in url or 'air-bounds' in url or 'search' in url) and 'api' in url.lower():
                    try:
                        body = response.json()
                        api_responses.append(body)
                        log(f"Intercepted API: {url[:100]}")
                    except:
                        pass
            page.on("response", handle_response)

            # Step 1: Go to Air Canada homepage to warm cookies
            log("Warming cookies on aircanada.com...")
            try:
                page.goto("https://www.aircanada.com/", timeout=30000)
                random_delay(3, 6)
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                random_delay(2, 4)
                page.evaluate("window.scrollBy(0, Math.random() * 200)")
                random_delay(1, 3)
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Step 2: Navigate to Aeroplan login
            log("Navigating to Aeroplan login...")
            try:
                page.goto("https://www.aircanada.com/aeroplan/redeem/availability/outbound", timeout=30000)
                random_delay(2, 4)
            except Exception as e:
                log(f"Navigation issue: {e}")

            # Check if we hit a login page
            current_url = page.url
            page_content = page.content().lower()

            if 'login' in current_url or 'signin' in current_url or 'auth' in current_url or 'sign in' in page_content:
                log("Login page detected, authenticating...")

                # Try to find and fill login fields
                # Aeroplan login typically has email/member number + password
                login_selectors = [
                    # Email/username field candidates
                    'input[name="username"]', 'input[name="email"]', 'input[type="email"]',
                    'input[name="memberNumber"]', 'input[id*="username"]', 'input[id*="email"]',
                    'input[id*="member"]', '#loginForm input[type="text"]',
                    'input[placeholder*="email" i]', 'input[placeholder*="member" i]',
                    'input[placeholder*="number" i]',
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
                ]

                # Find username field
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
                    log("Could not find username field")
                    # Try screenshot for debugging
                    try:
                        page.screenshot(path="/tmp/aeroplan-login-debug.png")
                        log("Debug screenshot saved to /tmp/aeroplan-login-debug.png")
                    except:
                        pass
                    print("[]")
                    sys.exit(0)

                random_delay(0.5, 1.5)

                # Find password field
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

                if not password_filled:
                    log("Could not find password field")
                    print("[]")
                    sys.exit(0)

                random_delay(0.5, 1)

                # Submit login
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
                    # Try pressing Enter
                    page.keyboard.press("Enter")
                    log("Pressed Enter to submit")

                # Wait for login to complete
                log("Waiting for login to complete...")
                random_delay(5, 8)

                # Check if login succeeded
                current_url = page.url
                page_content = page.content().lower()
                if 'error' in page_content and ('password' in page_content or 'credential' in page_content):
                    log("Login failed - invalid credentials")
                    print("[]")
                    sys.exit(0)

                log(f"Post-login URL: {current_url}")

                # Verify login actually worked
                logged_in = page.evaluate('''() =>
                    document.body.innerText.includes('Welcome') ||
                    document.body.innerText.includes('Sign Out') ||
                    document.body.innerText.includes('Sign out') ||
                    document.body.innerText.includes('My account') ||
                    document.cookie.includes('aeroplan')
                ''')
                if not logged_in:
                    log("Login session not valid — exit for retry")
                    sys.exit(1)
                log("Login verified successfully")

            # Add warmup delay before search to establish session
            random_delay(3, 6)

            # Step 3: Navigate to award search
            search_url = (
                f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
                f"?org0={origin}&dest0={destination}&departureDate0={date}"
                f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
                f"&cabinClass={cabin_code}"
            )
            log(f"Navigating to search: {search_url}")
            try:
                page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Search navigation issue: {e}")

            # Wait for results to load
            log("Waiting for results...")
            random_delay(5, 8)

            # Try waiting for result elements
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
                # Extended wait
                log("No result selectors found, waiting longer...")
                random_delay(5, 10)

                # Check page state
                page_content = page.content().lower()
                if 'no flights' in page_content or 'no results' in page_content or 'no availability' in page_content:
                    log("No flights available (legitimate)")
                    print("[]")
                    sys.exit(0)

                if 'login' in page.url or 'signin' in page.url:
                    log("Redirected back to login — session blocked, exit for retry")
                    sys.exit(1)

                # Page didn't render — likely blocked
                page_len = len(page.content())
                if page_len < 5000:
                    log(f"Page too small ({page_len} bytes) — likely blocked, exit for retry")
                    sys.exit(1)

            random_delay(2, 4)

            # Step 4: Parse results
            # First try API responses
            if api_responses:
                log(f"Parsing {len(api_responses)} intercepted API responses...")
                results = parse_api_responses(api_responses, params)
            
            # Fallback: parse DOM
            if not results:
                log("Parsing from DOM...")
                results = page.evaluate("""(sp) => {
                    const flights = [];
                    
                    // Try multiple selector strategies
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
                    
                    if (rows.length === 0) {
                        // Try getting all text content and parsing
                        return [];
                    }
                    
                    rows.forEach((row) => {
                        const text = row.textContent || '';
                        
                        // Extract flight numbers (e.g., UA 123, AC 456)
                        const fnMatches = text.match(/([A-Z]{2})\\s*(\\d{1,4})/g) || [];
                        const flightNumbers = fnMatches.map(m => m.replace(/\\s+/g, ''));
                        
                        // Check if this has United (UA) flights
                        const hasUA = flightNumbers.some(fn => fn.startsWith('UA'));
                        
                        // Extract points/miles
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
                        
                        // Extract times
                        const timeMatches = text.match(/(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)?)/g) || [];
                        const departureTime = timeMatches[0] || '';
                        const arrivalTime = timeMatches[1] || '';
                        
                        // Extract duration
                        const durMatch = text.match(/(\\d+)h\\s*(\\d+)?m?/i);
                        const duration = durMatch ? `${durMatch[1]}h${durMatch[2] || '0'}m` : '';
                        
                        // Extract stops
                        const stopsMatch = text.match(/(\\d+)\\s*stop/i);
                        const isNonstop = /nonstop|non-stop|direct/i.test(text);
                        const stops = isNonstop ? 0 : (stopsMatch ? parseInt(stopsMatch[1]) : 0);
                        
                        // Extract taxes
                        const taxMatch = text.match(/\\$\\s*([\\d,.]+)/);
                        const taxesAndFees = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : 0;
                        
                        // Determine airline
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
                        
                        // Determine cabin from context
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

            # Filter for United metal if requested, but keep all results
            ua_results = [r for r in results if r.get("isUnitedMetal") or
                         (r.get("flightNumber", "").startswith("UA")) or
                         r.get("airline") == "United Airlines"]
            
            if ua_results:
                log(f"  {len(ua_results)} United metal flights")

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
        # Clean up internal fields
        r.pop("isUnitedMetal", None)

    print(json.dumps(results))


def parse_api_responses(api_responses, params):
    """Parse intercepted Aeroplan API responses."""
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
            # Aeroplan API uses various structures — try common patterns
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
                
                # Get pricing
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
                
                # If no fares parsed, still record the flight
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
