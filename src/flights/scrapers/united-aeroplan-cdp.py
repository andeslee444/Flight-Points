#!/usr/bin/env python3
"""
United Award Search via Aeroplan + real Chrome CDP.

Launches Chrome normally with --remote-debugging-port and connects via
Patchright CDP. This bypasses Akamai because Chrome has no automation flags.

Env vars:
  AEROPLAN_USERNAME - Aeroplan member number or email
  AEROPLAN_PASSWORD - Aeroplan password

Usage:
  python3 united-aeroplan-cdp.py '{"origin":"JFK","destination":"LHR","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re

def log(msg):
    print(f"[UA-Aeroplan-CDP {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    results = []
    api_responses = []

    try:
        browser, context, page, cleanup = create_cdp_browser("aeroplan")

        try:
            # Intercept API responses for award data
            all_api_urls = []
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                status = response.status
                if status not in (200, 204, 304, 301, 302):
                    if not any(ext in url for ext in ['.css', '.js', '.png', '.jpg', '.svg', '.woff']):
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

            # Step 1: Warm cookies on Air Canada
            log("Warming cookies on aircanada.com...")
            try:
                page.goto("https://www.aircanada.com/", timeout=30000, wait_until="domcontentloaded")
                random_delay(3, 5)
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                random_delay(2, 3)
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Step 2: Navigate to Air Canada auth page to trigger login iframe
            log("Navigating to Air Canada auth page...")
            try:
                page.goto("https://www.aircanada.com/ca/en/aco/home.html?isAuth=true", timeout=30000, wait_until="load")
                random_delay(3, 5)
            except Exception as e:
                log(f"Auth page navigation issue: {e}")

            # Find login iframe (Gigya SSO)
            login_frame = None
            for frame in page.frames:
                if 'clogin' in frame.url:
                    login_frame = frame
                    break

            if not login_frame:
                # Click sign-in button to trigger iframe
                page.evaluate('''() => {
                    const links = document.querySelectorAll('a, button');
                    for (const l of links) {
                        if ((l.textContent || '').toLowerCase().includes('sign in')) { l.click(); return; }
                    }
                }''')
                for attempt in range(15):
                    time.sleep(1)
                    for frame in page.frames:
                        if 'clogin' in frame.url:
                            login_frame = frame
                            break
                    if login_frame:
                        break

            if not login_frame:
                log("Login iframe not found — cannot authenticate")
            else:
                log(f"Found login iframe")
                time.sleep(5)

                # Show Gigya login screenset (hidden by default with display:none)
                login_frame.evaluate('''() => {
                    if (typeof gigya !== 'undefined' && gigya.accounts) {
                        gigya.accounts.showScreenSet({
                            screenSet: 'Default-RegistrationLogin',
                            startScreen: 'gigya-login-screen',
                        });
                    }
                }''')
                time.sleep(3)

                # Fill login form using frame.fill() (triggers proper Gigya events)
                try:
                    login_frame.fill('input[data-gigya-name="loginID"]', username, timeout=5000)
                    log("Filled username")
                except Exception as e:
                    log(f"Username fill failed: {e}")

                time.sleep(0.5)

                try:
                    login_frame.fill('input[data-gigya-name="password"]', password, timeout=5000)
                    log("Filled password")
                except Exception as e:
                    log(f"Password fill failed: {e}")

                time.sleep(0.5)

                # Submit login
                try:
                    login_frame.click('input[type="submit"]', timeout=5000)
                    log("Clicked submit")
                except:
                    page.keyboard.press("Enter")
                    log("Pressed Enter")

                log("Waiting for login...")
                random_delay(8, 12)

                # Check login result
                still_iframe = any('clogin' in f.url for f in page.frames)
                if still_iframe:
                    # Check for captcha error
                    error_text = login_frame.evaluate("() => document.body?.innerText || ''")
                    if 'robot' in error_text.lower() or 'captcha' in error_text.lower():
                        log("Login blocked by reCAPTCHA — cannot proceed")
                        print("[]")
                        sys.exit(0)
                    log(f"Login may have failed: {error_text[:100]}")
                else:
                    log("Login successful!")

            random_delay(2, 3)

            # Step 3: Navigate to award search
            search_url = (
                f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
                f"?org0={origin}&dest0={destination}&departureDate0={date}"
                f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
                f"&cabinClass={cabin_code}"
            )
            log("Navigating to search...")
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
                    log("Redirected back to login — session issue, exit for retry")
                    sys.exit(1)

                page_len = len(page.content())
                body_text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
                log(f"Page size: {page_len} bytes, body: {body_text[:200]}")
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
                        const duration = durMatch ? durMatch[1] + 'h' + (durMatch[2] || '0') + 'm' : '';

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
                                scrapedAt: new Date().toISOString(),
                            });
                        }
                    });

                    return flights;
                }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})

            log(f"Found {len(results)} total results")

        finally:
            cleanup()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    # Add booking URL
    search_url = (
        f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
        f"?org0={origin}&dest0={destination}&departureDate0={date}"
        f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
        f"&cabinClass={cabin_code}"
    )
    for r in results:
        r["bookingUrl"] = search_url

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
                        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    })

        except Exception as e:
            log(f"API parse error: {e}")

    return results


if __name__ == "__main__":
    main()
