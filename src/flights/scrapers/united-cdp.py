#!/usr/bin/env python3
"""
United.com Award Search via real Chrome CDP.

Launches Chrome normally with --remote-debugging-port and connects via
Patchright CDP. This bypasses Akamai because Chrome has no automation flags.

Shows Star Alliance partner availability (ANA, Lufthansa, Singapore, Turkish, EVA, etc.)
without needing Aeroplan login (which is blocked by Gigya reCAPTCHA).

Usage:
  python3 united-cdp.py '{"origin":"JFK","destination":"LHR","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import re
import os
import datetime

def log(msg):
    print(f"[United-CDP {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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

# United cabin codes for URL sc= parameter
CABIN_CODES = {"economy": 1, "business": 7, "first": 8}

# Airline name lookup for Star Alliance partners
AIRLINE_NAMES = {
    'UA': 'United Airlines', 'LH': 'Lufthansa', 'SQ': 'Singapore Airlines',
    'NH': 'ANA', 'TK': 'Turkish Airlines', 'BR': 'EVA Air',
    'OZ': 'Asiana Airlines', 'AC': 'Air Canada', 'LO': 'LOT Polish',
    'SK': 'SAS', 'ZH': 'Shenzhen Airlines', 'CA': 'Air China',
    'AI': 'Air India', 'MS': 'EgyptAir', 'ET': 'Ethiopian Airlines',
    'TP': 'TAP Portugal', 'SA': 'South African Airways', 'NZ': 'Air New Zealand',
    'OS': 'Austrian Airlines', 'SN': 'Brussels Airlines', 'JP': 'Adria Airways',
    'A3': 'Aegean Airlines', 'CM': 'Copa Airlines', 'OU': 'Croatia Airlines',
}

# Cabin description mapping from United API
CABIN_MAP = {
    'United First': 'business',       # domestic first = business
    'United Economy': 'economy',
    'United Business': 'business',
    'Economy': 'economy',
    'Business': 'business',
    'First': 'first',
    'United Polaris business': 'business',
    'United Premium Plus': 'economy',  # premium economy → economy bucket
    'Premium Economy': 'economy',
}


def build_search_url(origin, destination, date, cabin, passengers=1):
    sc = CABIN_CODES.get(cabin, 7)
    return (
        f"https://www.united.com/en/us/fsr/choose-flights?"
        f"f={origin}&t={destination}&d={date}&tt=1&at=1&sc={sc}"
        f"&px={passengers}&taxng=1&newHP=True&clm=7"
    )


def parse_api_response(data, origin, destination, date, booking_url):
    """Parse United's /api/flight/FetchFlights JSON response."""
    results = []
    if not data:
        return results

    trips = []
    if isinstance(data, dict):
        trips = data.get('data', {}).get('Trips', []) or data.get('Trips', [])

    for trip in trips:
        flights = trip.get('Flights', [])
        for flight in flights:
            carrier = flight.get('MarketingCarrier', flight.get('OperatingCarrier', 'UA'))
            flight_num = f"{carrier} {flight.get('FlightNumber', '')}".strip()
            dep_time = flight.get('DepartDateTime', '')
            arr_time = flight.get('DestinationDateTime', '')
            travel_min = flight.get('TravelMinutes')
            duration = f"{travel_min // 60}h {travel_min % 60}m" if travel_min else ''
            stops = len(flight.get('Connections', []))

            products = flight.get('Products', [])
            for product in products:
                prices = product.get('Prices', [])
                if not prices:
                    continue

                miles = prices[0].get('Amount', 0) if len(prices) > 0 else 0
                cash = prices[1].get('Amount', 0) if len(prices) > 1 else 0

                cabin_desc = product.get('Description', '')
                cabin = CABIN_MAP.get(cabin_desc, 'economy')

                award_type_str = product.get('AwardType', '')
                award_type = 'saver' if 'saver' in (award_type_str or '').lower() else 'everyday'

                if miles > 0:
                    results.append({
                        "source": "united",
                        "airline": AIRLINE_NAMES.get(carrier, carrier),
                        "flightNumber": flight_num,
                        "origin": flight.get('Origin', origin),
                        "destination": flight.get('Destination', destination),
                        "departureDate": date,
                        "departureTime": dep_time,
                        "arrivalTime": arr_time,
                        "duration": duration,
                        "stops": stops,
                        "cabin": cabin,
                        "pointsRequired": miles,
                        "pointsProgram": "United MileagePlus",
                        "taxesAndFees": cash,
                        "awardType": award_type,
                        "scrapedAt": datetime.datetime.utcnow().isoformat() + "Z",
                        "bookingUrl": booking_url,
                    })

    return results


def do_login(page):
    """Attempt to log in to united.com using env var credentials."""
    username = os.environ.get('UNITED_USERNAME', '')
    password = os.environ.get('UNITED_PASSWORD', '')

    if not username or not password:
        log("No UNITED_USERNAME/UNITED_PASSWORD set — cannot login")
        return False

    log(f"Attempting login with {username[:4]}...")

    # Click "Sign in" on the homepage
    page.evaluate('''() => {
        for (const e of document.querySelectorAll('a, button')) {
            const t = (e.textContent || '').trim().toLowerCase();
            if (t.includes('sign in') || t.includes('log in')) {
                e.click(); return true;
            }
        }
        return false;
    }''')
    time.sleep(3)

    # Fill credentials
    try:
        # Try to find MileagePlus number / email field
        page.evaluate(f'''() => {{
            const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[id*="ileagePlus"], input[id*="mpNumber"], input[name*="user"]');
            for (const inp of inputs) {{
                if (inp.offsetParent !== null) {{
                    inp.focus();
                    inp.value = '';
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, '{username}');
                    inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return true;
                }}
            }}
            return false;
        }}''')
        time.sleep(0.5)

        page.evaluate(f'''() => {{
            const inputs = document.querySelectorAll('input[type="password"]');
            for (const inp of inputs) {{
                if (inp.offsetParent !== null) {{
                    inp.focus();
                    inp.value = '';
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, '{password}');
                    inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return true;
                }}
            }}
            return false;
        }}''')
        time.sleep(0.5)

    except Exception as e:
        log(f"Could not fill login form: {e}")
        return False

    # Submit
    page.evaluate('''() => {
        for (const b of document.querySelectorAll('button[type="submit"], button')) {
            const t = (b.textContent || '').trim().toLowerCase();
            if ((t.includes('sign in') || t.includes('log in')) && b.offsetParent !== null) {
                b.click(); return true;
            }
        }
        return false;
    }''')
    time.sleep(5)

    # Check if login succeeded
    body = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
    if 'sign in' not in body.lower() or 'welcome' in body.lower() or 'mileageplus' in body.lower():
        log("Login appears successful")
        return True

    log("Login may have failed")
    return False


def is_logged_in(page):
    """Check if already logged in by looking for account indicators."""
    return page.evaluate('''() => {
        const body = (document.body?.innerText || '').substring(0, 500).toLowerCase();
        // Logged in: shows "Hi, [name]" or "My trips" or account number
        if (body.includes('my trips') || body.includes('my account')) return true;
        // Not logged in: shows "Sign in" prominently
        return false;
    }''')


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
    passengers = params.get("passengers", 1)

    search_url = build_search_url(origin, destination, date, cabin, passengers)
    log(f"Search: {origin}→{destination} {date} {cabin}")

    # Import chrome_cdp from same directory
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    results = []
    api_responses = []

    try:
        browser, context, page, cleanup = create_cdp_browser("united")
    except Exception as e:
        log(f"Failed to launch Chrome: {e}")
        print("[]")
        sys.exit(1)

    try:
        # Set up API response interception
        def handle_response(response):
            url = response.url
            status = response.status
            ct = response.headers.get("content-type", "")
            if 'united.com/api/flight/Fetch' in url and status == 200 and 'json' in ct:
                try:
                    body = response.text()
                    data = json.loads(body)
                    api_responses.append(data)
                    log(f"Intercepted API response ({len(body)} bytes)")
                except Exception as e:
                    log(f"Failed to parse API response: {e}")

        page.on("response", handle_response)

        # Step 1: Warm cookies on united.com homepage
        log("Warming cookies on united.com...")
        page.goto("https://www.united.com/", timeout=30000, wait_until="domcontentloaded")
        time.sleep(random.uniform(3, 5))
        page.evaluate("window.scrollBy(0, Math.random() * 400)")
        time.sleep(random.uniform(2, 3))
        page.mouse.move(random.randint(200, 800), random.randint(200, 500))
        time.sleep(random.uniform(1, 2))

        # Check Akamai cookies
        cookies = context.cookies()
        akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
        log(f"Cookies: {len(cookies)} total, {len(akamai)} Akamai")

        # Step 2: Navigate to award search
        log("Navigating to award search...")
        try:
            page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
        except Exception as e:
            log(f"Navigation timeout (checking page): {e}")

        # Step 3: Wait for results — check API interception first, then DOM
        found_results = False
        login_attempted = False

        for wait_round in range(6):
            # Check if we got API responses
            if api_responses:
                log(f"Got {len(api_responses)} API response(s)")
                for resp in api_responses:
                    parsed = parse_api_response(resp, origin, destination, date, search_url)
                    results.extend(parsed)
                if results:
                    log(f"Parsed {len(results)} results from API")
                    found_results = True
                    break

            content = page.content()
            lower = content.lower()
            current_url = page.url.lower()

            # Check for Akamai block
            if "access denied" in lower or "reference #" in lower:
                log("BLOCKED by Akamai — exit for retry")
                sys.exit(1)

            # Check for login redirect
            if ('signin' in current_url or 'login' in current_url or
                'oidc' in current_url or 'identity' in current_url):
                if not login_attempted:
                    login_attempted = True
                    log("Redirected to login page")
                    success = do_login(page)
                    if success:
                        log("Re-navigating to search after login...")
                        page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
                        time.sleep(5)
                        continue
                    else:
                        log("Login failed — united.com may require authentication for award search")
                        break

            # Check for "no flights" messages
            if "no flights" in lower or "no award" in lower or "no results" in lower:
                log("No flights available (legitimate)")
                print("[]")
                sys.exit(0)

            # Check if we're on the results page
            if 'choose-flights' in current_url or 'fsr' in current_url:
                # Check for flight cards in the DOM
                has_flights = page.evaluate('''() => {
                    const cards = document.querySelectorAll('[class*="flight-result"], [class*="FlightResult"], [data-test*="flight"]');
                    return cards.length;
                }''')
                if has_flights > 0:
                    log(f"Found {has_flights} flight cards in DOM")
                    found_results = True
                    break

                # Also check for large page content (results loaded)
                if len(content) > 100000:
                    log(f"Large page ({len(content)} bytes) — attempting parse")
                    found_results = True
                    break

            log(f"Waiting for results (round {wait_round + 1}, page={len(content)} bytes, url={'...' + current_url[-40:]})...")
            time.sleep(5)

        # Step 4: If API interception didn't work, try DOM parsing
        if not results and found_results:
            log("No API results — trying DOM parse...")
            results = page.evaluate("""(sp) => {
                const flights = [];
                const body = document.body?.innerText || '';

                // Try to find structured flight data in the page
                // United's results page has flight cards with miles pricing
                const cards = document.querySelectorAll(
                    '[class*="flight-result"], [class*="FlightResult"], ' +
                    '[class*="flight-card"], [class*="FlightCard"], ' +
                    '[data-test*="flight"], .app-results-tile'
                );

                for (const card of cards) {
                    const text = card.textContent?.replace(/\\s+/g, ' ').trim() || '';
                    if (!text) continue;

                    // Extract carrier code and flight number
                    const flightMatch = text.match(/([A-Z]{2})\\s*(\\d{1,4})/);
                    const carrier = flightMatch ? flightMatch[1] : 'UA';
                    const flightNum = flightMatch ? `${flightMatch[1]} ${flightMatch[2]}` : '';

                    // Extract times (HH:MM pattern)
                    const times = text.match(/\\b(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)?)\\b/g) || [];
                    const depTime = times[0] || '';
                    const arrTime = times[1] || '';

                    // Extract duration
                    const durMatch = text.match(/(\\d+)h\\s*(\\d+)m/);
                    const duration = durMatch ? `${durMatch[1]}h ${durMatch[2]}m` : '';

                    // Extract stops
                    const stopsMatch = text.match(/(\\d+)\\s*stop/i);
                    const isNonstop = /nonstop|non-stop|direct/i.test(text);
                    const stops = isNonstop ? 0 : stopsMatch ? parseInt(stopsMatch[1]) : 0;

                    // Extract miles (XX,XXX or XXXK)
                    const milesPatterns = text.match(/([\\d,]+)\\s*(?:miles|mi\\.)/gi) || [];
                    const kMilesPatterns = text.match(/([\\d.]+)K\\s*(?:miles)?/gi) || [];

                    let cabinPrices = [];

                    for (const mp of milesPatterns) {
                        const m = mp.match(/([\\d,]+)/);
                        if (m) {
                            const miles = parseInt(m[1].replace(/,/g, ''));
                            if (miles > 1000 && miles < 500000) {
                                cabinPrices.push({ miles, cabin: sp.cabin });
                            }
                        }
                    }
                    for (const kp of kMilesPatterns) {
                        const m = kp.match(/([\\d.]+)/);
                        if (m) {
                            const miles = parseFloat(m[1]) * 1000;
                            if (miles > 1000 && miles < 500000) {
                                cabinPrices.push({ miles, cabin: sp.cabin });
                            }
                        }
                    }

                    // Try to detect cabin from text
                    const hasEconomy = /economy/i.test(text);
                    const hasBusiness = /business|polaris/i.test(text);
                    const hasFirst = /first(?!\\s*class.*economy)/i.test(text);

                    for (const cp of cabinPrices) {
                        let cabin = sp.cabin;
                        if (hasBusiness && !hasEconomy) cabin = 'business';
                        else if (hasFirst) cabin = 'first';
                        else if (hasEconomy && !hasBusiness) cabin = 'economy';

                        const airlineNames = {
                            'UA': 'United Airlines', 'LH': 'Lufthansa', 'SQ': 'Singapore Airlines',
                            'NH': 'ANA', 'TK': 'Turkish Airlines', 'BR': 'EVA Air',
                            'OZ': 'Asiana Airlines', 'AC': 'Air Canada', 'NZ': 'Air New Zealand',
                        };

                        flights.push({
                            source: 'united',
                            airline: airlineNames[carrier] || carrier,
                            flightNumber: flightNum,
                            origin: sp.origin,
                            destination: sp.destination,
                            departureDate: sp.date,
                            departureTime: depTime,
                            arrivalTime: arrTime,
                            duration: duration,
                            stops: stops,
                            cabin: cabin,
                            pointsRequired: cp.miles,
                            pointsProgram: 'United MileagePlus',
                            taxesAndFees: 0,
                            awardType: 'saver',
                            scrapedAt: new Date().toISOString(),
                        });
                    }
                }
                return flights;
            }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})

            log(f"DOM parse: {len(results)} results")

        if not results and not found_results:
            # Debug: log what we see
            body_preview = page.evaluate("() => (document.body?.innerText || '').substring(0, 500)")
            log(f"No results found. URL: {page.url}")
            log(f"Page preview: {body_preview[:200]}")

        # Anomaly: returned nothing. Capture a screenshot so vision-verify can
        # later classify why (blocked / login-wall / DOM-drift / genuinely-empty).
        if not results:
            try:
                from chrome_cdp import save_diagnostic_screenshot
                save_diagnostic_screenshot(page, "united")
            except Exception:
                pass

        log(f"Total: {len(results)} results")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        cleanup()

    for r in results:
        if not r.get("bookingUrl"):
            r["bookingUrl"] = search_url

    print(json.dumps(results))


if __name__ == "__main__":
    main()
