#!/usr/bin/env python3
"""
United Award Search via Aeroplan + cookie farm + curl_cffi.

Hybrid approach: Patchright browser farms Akamai cookies AND performs login,
then curl_cffi uses those authenticated cookies for fast API searches.

Covers all Star Alliance award space including United metal.

Env vars:
  AEROPLAN_USERNAME - Aeroplan email or member number
  AEROPLAN_PASSWORD - Aeroplan password

Usage:
  python3 united-aeroplan-curlffi.py '{"origin":"JFK","destination":"NRT","date":"2026-04-15","cabin":"business"}'
"""

import json
import sys
import time
import re
import os
import random
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log, validate_params, create_session
from cookie_farm import get_cookies, inject_cookies, invalidate_cache, _farm_cookies, _save_cache, _load_cached, _get_domain_lock

LABEL = "UA-Aeroplan-CurlFfi"

def log(msg):
    _log(LABEL, msg)


AIRLINE_NAMES = {
    'UA': 'United Airlines', 'AC': 'Air Canada', 'NH': 'ANA',
    'LH': 'Lufthansa', 'LX': 'Swiss', 'OS': 'Austrian',
    'SN': 'Brussels Airlines', 'SK': 'SAS', 'TG': 'Thai Airways',
    'SQ': 'Singapore Airlines', 'OZ': 'Asiana', 'BR': 'EVA Air',
    'TK': 'Turkish Airlines', 'ET': 'Ethiopian Airlines',
    'CA': 'Air China', 'ZH': 'Shenzhen Airlines',
    'AI': 'Air India', 'MS': 'EgyptAir', 'TP': 'TAP Portugal',
    'CM': 'Copa Airlines', 'AV': 'Avianca',
}

CABIN_MAP = {"economy": "ECO", "business": "BUS", "first": "FIR"}


def farm_aeroplan_cookies(username, password):
    """Farm cookies from aircanada.com with login using Patchright.

    This is a custom farming flow that includes authentication, since
    Aeroplan requires login for award searches since March 2025.

    Returns dict of cookies or empty dict on failure.
    """
    from patchright.sync_api import sync_playwright
    from urllib.parse import urlparse

    domain = "aircanada.com"
    ttl = 600  # 10 minutes

    lock = _get_domain_lock(domain)
    with lock:
        # Check cache
        cached = _load_cached(domain, ttl)
        if cached:
            return cached["cookies"]

        log("Farming authenticated cookies for aircanada.com...")

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
                log(f"Proxy: {parsed.hostname}:{parsed.port}")

        cookies_dict = {}
        raw_cookies = []

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    channel="chrome",
                    args=["--no-first-run"],
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

                # Step 1: Warm cookies
                log("Warming cookies on aircanada.com...")
                page.goto("https://www.aircanada.com/", timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.uniform(3, 6))
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                time.sleep(random.uniform(2, 4))
                page.mouse.move(random.randint(100, 800), random.randint(100, 400))
                time.sleep(random.uniform(1, 2))

                # Step 2: Navigate to Aeroplan (triggers login redirect)
                log("Navigating to Aeroplan...")
                page.goto("https://www.aircanada.com/aeroplan/redeem/availability/outbound", timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.uniform(2, 4))

                current_url = page.url
                page_text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
                log(f"Current: {current_url[:100]}, body: {page_text[:100]}")

                # Step 3: Login
                needs_login = ('login' in current_url.lower() or 'signin' in current_url.lower() or 'auth' in current_url.lower())

                if not needs_login:
                    # Try to find sign-in button
                    for sel in ['a:has-text("Sign in")', 'button:has-text("Sign in")', 'a[href*="login"]', 'a[href*="signin"]']:
                        try:
                            btn = page.locator(sel).first
                            if btn.count() > 0 and btn.is_visible(timeout=2000):
                                btn.click()
                                needs_login = True
                                log(f"Clicked login button: {sel}")
                                time.sleep(random.uniform(3, 5))
                                break
                        except:
                            continue

                if needs_login:
                    log("Authenticating...")
                    time.sleep(random.uniform(2, 3))

                    # Fill username
                    username_filled = False
                    for sel in ['input[name="username"]', 'input[name="email"]', 'input[type="email"]',
                                'input[name="memberNumber"]', 'input[id*="username"]', 'input[id*="email"]',
                                'input[placeholder*="email" i]', 'input[placeholder*="member" i]',
                                'input[type="text"]']:
                        try:
                            el = page.query_selector(sel)
                            if el and el.is_visible():
                                el.click()
                                time.sleep(random.uniform(0.2, 0.5))
                                for char in username:
                                    page.keyboard.type(char, delay=random.randint(50, 150))
                                username_filled = True
                                log(f"Filled username via {sel}")
                                break
                        except:
                            continue

                    if username_filled:
                        time.sleep(random.uniform(0.5, 1.5))

                        # Fill password
                        for sel in ['input[name="password"]', 'input[type="password"]']:
                            try:
                                el = page.query_selector(sel)
                                if el and el.is_visible():
                                    el.click()
                                    time.sleep(random.uniform(0.2, 0.5))
                                    for char in password:
                                        page.keyboard.type(char, delay=random.randint(50, 150))
                                    log(f"Filled password via {sel}")
                                    break
                            except:
                                continue

                        time.sleep(random.uniform(0.5, 1))

                        # Submit
                        submitted = False
                        for sel in ['button[type="submit"]', 'button:has-text("Sign in")', 'button:has-text("Log in")', 'button:has-text("Continue")']:
                            try:
                                el = page.query_selector(sel)
                                if el and el.is_visible():
                                    el.click()
                                    submitted = True
                                    log(f"Submitted via {sel}")
                                    break
                            except:
                                continue
                        if not submitted:
                            page.keyboard.press("Enter")

                        log("Waiting for login to complete...")
                        time.sleep(random.uniform(5, 8))

                        current_url = page.url
                        log(f"Post-login URL: {current_url[:100]}")
                    else:
                        log("Could not find username field — continuing without login")

                # Let session settle
                time.sleep(random.uniform(2, 4))

                # Extract cookies
                raw_cookies = context.cookies()
                for cookie in raw_cookies:
                    cookies_dict[cookie["name"]] = cookie["value"]

                abck = cookies_dict.get("_abck", "")
                log(f"Farmed {len(raw_cookies)} cookies (_abck: {len(abck)} chars)")

                context.close()
                browser.close()

        except Exception as e:
            log(f"Cookie farming error: {e}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {}

        if cookies_dict:
            serializable_raw = [{
                "name": c["name"], "value": c["value"],
                "domain": c.get("domain", ""), "path": c.get("path", "/"),
                "secure": c.get("secure", False), "httpOnly": c.get("httpOnly", False),
            } for c in raw_cookies]
            _save_cache(domain, cookies_dict, serializable_raw)

        return cookies_dict


def parse_api_response(data, params):
    """Parse Aeroplan API response into FlightResult[]."""
    results = []

    # Try various response structures
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

            cabin_code = CABIN_MAP.get(params.get("cabin", "business"), "BUS")
            booking_url = (
                f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
                f"?org0={params['origin']}&dest0={params['destination']}&departureDate0={params['date']}"
                f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
                f"&cabinClass={cabin_code}"
            )

            results.append({
                "source": "aeroplan",
                "airline": AIRLINE_NAMES.get(primary_carrier, primary_carrier),
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
                "availableSeats": 0,
                "scrapedAt": datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                "bookingUrl": booking_url,
                "metadata": {
                    "operatingAirlines": [AIRLINE_NAMES.get(a, a) for a in airlines],
                    "operatingAirlineCode": primary_carrier,
                    "isUnitedMetal": "UA" in airlines,
                },
            })

        # If no fares but have flight info
        if not fares and flight_numbers:
            primary_carrier = airlines[0] if airlines else "AC"
            points = bound.get("points", bound.get("miles", 0))
            taxes = bound.get("taxes", 0)

            cabin_code = CABIN_MAP.get(params.get("cabin", "business"), "BUS")
            booking_url = (
                f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
                f"?org0={params['origin']}&dest0={params['destination']}&departureDate0={params['date']}"
                f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
                f"&cabinClass={cabin_code}"
            )

            results.append({
                "source": "aeroplan",
                "airline": AIRLINE_NAMES.get(primary_carrier, primary_carrier),
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
                "availableSeats": 0,
                "scrapedAt": datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                "bookingUrl": booking_url,
                "metadata": {
                    "operatingAirlines": [AIRLINE_NAMES.get(a, a) for a in airlines],
                    "operatingAirlineCode": primary_carrier,
                    "isUnitedMetal": "UA" in airlines,
                },
            })

    return results


def do_search(session, params):
    """Execute Aeroplan search API. Returns (results, should_retry)."""
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")
    cabin_code = CABIN_MAP.get(cabin, "BUS")

    # Aeroplan uses REST API for availability
    search_url = (
        f"https://www.aircanada.com/aeroplan/redeem/availability/outbound"
        f"?org0={origin}&dest0={destination}&departureDate0={date}"
        f"&ADT=1&YTH=0&CHD=0&INF=0&INS=0&tripType=O&marketCode=INT"
        f"&cabinClass={cabin_code}"
    )

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.aircanada.com",
        "Referer": search_url,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-Requested-With": "XMLHttpRequest",
    }

    delay = random.uniform(1, 3)
    log(f"Waiting {delay:.1f}s before search...")
    time.sleep(delay)

    # Try the Aeroplan API endpoint
    api_url = f"https://www.aircanada.com/aeroplan/redeem/api/v2/air-bounds?org0={origin}&dest0={destination}&departureDate0={date}&ADT=1&tripType=O&cabinClass={cabin_code}"

    log(f"Searching Aeroplan API...")
    try:
        resp = session.get(api_url, headers=headers, timeout=60)
        log(f"API response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 200:
            try:
                data = resp.json()
                if "cpr_chlge" in resp.text[:500]:
                    log("Akamai challenge in response")
                    return [], True
                results = parse_api_response(data, params)
                log(f"Parsed {len(results)} results from API")
                return results, False
            except json.JSONDecodeError:
                log(f"Not JSON: {resp.text[:200]}")
                if "<html" in resp.text.lower():
                    log("Got HTML — likely Akamai block")
                    return [], True
                return [], False
        elif resp.status_code == 429:
            log("Rate limited (429)")
            return [], True
        elif resp.status_code in (403, 503):
            log(f"Blocked: HTTP {resp.status_code}")
            return [], True
        else:
            log(f"Unexpected: HTTP {resp.status_code}")
            log(f"Body: {resp.text[:300]}")
            return [], False
    except Exception as e:
        log(f"API error: {e}")
        return [], False

    # Fallback: try loading the SPA page (the page itself may return embedded JSON)
    log("Trying SPA page load...")
    try:
        resp = session.get(search_url, headers=headers, timeout=60)
        log(f"SPA response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 200 and "application/json" in resp.headers.get("content-type", ""):
            data = resp.json()
            results = parse_api_response(data, params)
            if results:
                return results, False
    except Exception as e:
        log(f"SPA load error: {e}")

    return [], False


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

    username = os.environ.get("AEROPLAN_USERNAME", "")
    password = os.environ.get("AEROPLAN_PASSWORD", "")

    if not username or not password:
        log("ERROR: AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars required")
        print("[]")
        sys.exit(0)

    log(f"Search: {params['origin']}->{params['destination']} {params['date']} {params.get('cabin', 'business')}")

    results = []

    try:
        # Step 1: Farm authenticated cookies via Patchright
        cookies = farm_aeroplan_cookies(username, password)

        if not cookies:
            log("Cookie farming failed — cannot search without login")
            sys.exit(1)

        # Step 2: Create curl_cffi session with farmed cookies
        session, proxy_info = create_session(LABEL)
        inject_cookies(session, cookies, "aircanada.com")
        log(f"Using {len(cookies)} farmed cookies")

        # Step 3: Search
        results, should_retry = do_search(session, params)

        # Step 4: Retry with fresh cookies if blocked
        if should_retry and not results:
            log("Invalidating cache and retrying...")
            invalidate_cache("aircanada.com")
            time.sleep(2)

            fresh_cookies = farm_aeroplan_cookies(username, password)
            if fresh_cookies:
                session2, _ = create_session(LABEL)
                inject_cookies(session2, fresh_cookies, "aircanada.com")
                results, _ = do_search(session2, params)
            else:
                log("Fresh cookie farming failed")
                sys.exit(1)

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
