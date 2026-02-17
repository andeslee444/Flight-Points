#!/usr/bin/env python3
"""
Singapore Airlines KrisFlyer Award Search via Camoufox (anti-detect Firefox).

Strategy: Login to KrisFlyer, navigate to award search, intercept API responses.

The SQ website is a heavy SPA that sometimes doesn't render in headless mode.
This scraper handles that by:
1. Loading the non-hash page first (server-rendered)
2. Waiting for JS to hydrate
3. Using explicit waits for form elements
4. Intercepting all API responses during search

Usage:
  python3 sq-camoufox.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re
from datetime import datetime

def log(msg):
    print(f"[SQ-Camoufox {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

api_responses = []

def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")

    kf_id = os.environ.get("SQ_KRISFLYER_ID", "")
    kf_pass = os.environ.get("SQ_KRISFLYER_PASSWORD", "")

    if not kf_id or not kf_pass:
        log("Missing SQ_KRISFLYER_ID or SQ_KRISFLYER_PASSWORD")
        print("[]")
        sys.exit(0)

    cabin_map = {"economy": "Y", "business": "C", "first": "F"}
    cabin_code = cabin_map.get(cabin, "C")

    log(f"Search: {origin}→{destination} {date} {cabin}")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []

    try:
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()

            # Intercept ALL network responses
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                if "json" in ct:
                    keywords = ["availability", "flight", "search", "award", "redemption",
                                "itinerary", "offer", "calendar", "book", "fare",
                                "segment", "journey", "login", "auth", "token",
                                "apigw", "graphql"]
                    if any(kw in url.lower() for kw in keywords):
                        try:
                            body = response.text()
                            if len(body) > 50:
                                log(f"API [{response.status}]: {url[:150]}")
                                api_responses.append({
                                    "url": url,
                                    "status": response.status,
                                    "body": body
                                })
                        except:
                            pass

            page.on("response", handle_response)

            # Step 1: Load SQ homepage and wait for full render
            log("Loading singaporeair.com...")
            page.goto("https://www.singaporeair.com/en_UK/us/home", timeout=30000, wait_until="load")
            
            # Wait for the SPA to hydrate — check for interactive elements
            rendered = False
            for attempt in range(10):
                time.sleep(2)
                btn_count = page.evaluate("document.querySelectorAll('button').length")
                input_count = page.evaluate("document.querySelectorAll('input').length")
                if btn_count > 2:
                    log(f"Page rendered: {btn_count} buttons, {input_count} inputs")
                    rendered = True
                    break
                log(f"Waiting for SPA render (attempt {attempt+1})... buttons={btn_count}")
            
            if not rendered:
                # Try reloading
                log("SPA not rendered, reloading...")
                page.reload(timeout=30000, wait_until="load")
                time.sleep(8)
                btn_count = page.evaluate("document.querySelectorAll('button').length")
                if btn_count < 2:
                    log("Page still not rendering, aborting")
                    print("[]")
                    sys.exit(0)

            # Step 2: Login
            log("Clicking Log in...")
            try:
                page.locator('button:has-text("Log in")').first.click(timeout=5000)
                time.sleep(3)
            except Exception as e:
                log(f"Login button click failed: {e}")
                # Try alternative selectors
                try:
                    page.locator('text="LOG-IN"').first.click(timeout=3000)
                    time.sleep(3)
                except:
                    log("No login button found")

            # Fill credentials
            log("Filling credentials...")
            try:
                # Find the membership/ID field
                id_field = None
                for sel in ['input[type="text"]:visible', 'input[type="email"]:visible',
                            'input[placeholder*="KrisFlyer"]', 'input[placeholder*="membership"]',
                            'input[name*="membership"]', 'input[name*="loginId"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=2000):
                            id_field = el
                            break
                    except:
                        continue

                if id_field:
                    id_field.fill(kf_id)
                    time.sleep(0.5)
                    
                    pw_field = page.locator('input[type="password"]').first
                    pw_field.fill(kf_pass)
                    time.sleep(0.5)
                    
                    # Submit
                    for sel in ['button:has-text("Log in")', 'button:has-text("LOG IN")',
                                'button[type="submit"]']:
                        try:
                            page.locator(sel).first.click(timeout=3000)
                            break
                        except:
                            continue
                    
                    time.sleep(5)
                    log("Login submitted")
                else:
                    log("Could not find login fields")
                    
            except Exception as e:
                log(f"Login error: {e}")

            # Step 3: Navigate to redeem flights
            log("Navigating to redeem flights...")
            page.evaluate("window.location.hash = '#/book/redeemflights'")
            time.sleep(5)

            # Step 4: Fill search form
            log("Filling search form...")

            # Debug: list all visible inputs
            visible_inputs = page.evaluate('''() => Array.from(document.querySelectorAll('input'))
                .filter(e => e.offsetParent !== null)
                .map(e => ({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,
                           ariaLabel:e.getAttribute('aria-label')}))''')
            log(f"Visible inputs: {json.dumps(visible_inputs)}")

            form_ok = False
            try:
                # Origin
                for sel in ['input[aria-label*="From"]', 'input[placeholder*="From"]',
                            'input[name*="origin"]', 'input[id*="origin"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=2000):
                            el.click()
                            el.fill(origin)
                            time.sleep(1.5)
                            # Select from autocomplete
                            try:
                                page.locator(f'li:has-text("{origin}")').first.click(timeout=3000)
                            except:
                                page.keyboard.press("Enter")
                            time.sleep(1)
                            break
                    except:
                        continue

                # Destination
                for sel in ['input[aria-label*="To"]', 'input[placeholder*="To"]',
                            'input[name*="dest"]', 'input[id*="dest"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=2000):
                            el.click()
                            el.fill(destination)
                            time.sleep(1.5)
                            try:
                                page.locator(f'li:has-text("{destination}")').first.click(timeout=3000)
                            except:
                                page.keyboard.press("Enter")
                            time.sleep(1)
                            break
                    except:
                        continue

                # Date
                for sel in ['input[aria-label*="Depart"]', 'input[placeholder*="Depart"]',
                            'input[name*="date"]', 'input[id*="date"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=2000):
                            el.click()
                            time.sleep(1)
                            # Navigate calendar
                            dt = datetime.strptime(date, "%Y-%m-%d")
                            target_month = dt.strftime("%B %Y")
                            for _ in range(24):
                                try:
                                    header = page.locator('[class*="month"], [class*="calendar"] h2').first.text_content()
                                    if target_month.lower() in header.lower():
                                        break
                                except:
                                    pass
                                try:
                                    page.locator('[class*="next"], button[aria-label*="next"]').first.click()
                                    time.sleep(0.3)
                                except:
                                    break
                            # Click day
                            try:
                                page.locator(f'button:has-text("{dt.day}")').first.click()
                                time.sleep(1)
                            except:
                                pass
                            break
                    except:
                        continue

                # Search
                for sel in ['button:has-text("Search")', 'button:has-text("SEARCH")',
                            'button[type="submit"]']:
                    try:
                        btn = page.locator(sel).first
                        if btn.is_visible(timeout=2000):
                            btn.click()
                            form_ok = True
                            log("Search clicked!")
                            break
                    except:
                        continue

            except Exception as e:
                log(f"Form fill error: {e}")

            # Step 5: Wait for results
            if form_ok:
                log("Waiting for results...")
                time.sleep(15)
                if not api_responses:
                    time.sleep(10)

            # Step 6: Parse
            log(f"Captured {len(api_responses)} API responses")
            for resp in api_responses:
                log(f"  {resp['url'][:120]}")
                try:
                    data = json.loads(resp["body"])
                    # Log structure for debugging
                    if isinstance(data, dict):
                        log(f"    Keys: {list(data.keys())[:10]}")
                except:
                    pass

            results = parse_all_responses(api_responses, origin, destination, date, cabin)

            # Debug screenshot
            try:
                page.screenshot(path="/tmp/sq-camoufox-final.png")
                log("Screenshot: /tmp/sq-camoufox-final.png")
            except:
                pass

            log(f"Final: {len(results)} results")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))


def parse_all_responses(responses, origin, destination, date, cabin):
    all_flights = []
    for resp in responses:
        try:
            data = json.loads(resp["body"]) if isinstance(resp["body"], str) else resp["body"]
            flights = extract_flights(data, origin, destination, date, cabin)
            all_flights.extend(flights)
        except:
            pass
    return all_flights


def extract_flights(data, origin, destination, date, cabin, depth=0):
    flights = []
    if depth > 6:
        return flights
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and has_flight_keys(item):
                f = map_flight(item, origin, destination, date, cabin)
                if f:
                    flights.append(f)
            elif isinstance(item, (dict, list)):
                flights.extend(extract_flights(item, origin, destination, date, cabin, depth + 1))
    elif isinstance(data, dict):
        if has_flight_keys(data):
            f = map_flight(data, origin, destination, date, cabin)
            if f:
                flights.append(f)
        for val in data.values():
            if isinstance(val, (dict, list)):
                flights.extend(extract_flights(val, origin, destination, date, cabin, depth + 1))
    return flights


def has_flight_keys(d):
    if not isinstance(d, dict):
        return False
    keys = {"flightNumber", "flight", "segments", "mileage", "miles",
            "milesRequired", "departure", "points", "flightNo", "legs", "itinerary"}
    return len(keys.intersection(d.keys())) >= 2


def map_flight(raw, origin, destination, date, cabin):
    try:
        miles = (raw.get("miles") or raw.get("mileage") or raw.get("milesRequired") or
                 raw.get("points") or raw.get("totalMiles") or 0)
        if not miles:
            return None
        fn = raw.get("flightNumber") or raw.get("flight") or raw.get("flightNo") or "SQ???"
        dep_time = raw.get("departureTime") or ""
        arr_time = raw.get("arrivalTime") or ""
        orig = raw.get("origin") or origin
        dest = raw.get("destination") or destination
        stops = raw.get("stops") or raw.get("numberOfStops") or 0
        airline_code = raw.get("airline") or raw.get("carrier") or "SQ"
        names = {"SQ": "Singapore Airlines", "NH": "ANA", "LH": "Lufthansa",
                 "TG": "Thai Airways", "AC": "Air Canada", "UA": "United"}
        return {
            "source": "singapore",
            "airline": names.get(airline_code, airline_code),
            "flightNumber": fn,
            "origin": orig, "destination": dest,
            "departureDate": date,
            "departureTime": str(dep_time), "arrivalTime": str(arr_time),
            "duration": str(raw.get("duration", "")),
            "stops": int(stops) if stops else 0,
            "cabin": cabin,
            "pointsRequired": float(miles),
            "pointsProgram": "KrisFlyer",
            "taxesAndFees": float(raw.get("taxes", 0) or 0),
            "awardType": "saver",
            "scrapedAt": datetime.utcnow().isoformat() + "Z",
            "bookingUrl": "https://www.singaporeair.com/en_UK/us/home#/book/redeemflights",
        }
    except:
        return None


if __name__ == "__main__":
    main()
