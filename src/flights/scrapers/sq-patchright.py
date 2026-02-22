#!/usr/bin/env python3
"""
Singapore Airlines KrisFlyer Award Search via Patchright (patched Chromium).

Same logic as sq-camoufox.py but uses Patchright. Chromium renders the SQ SPA
properly (Camoufox Firefox shows blank pages with 0 buttons).

Usage:
  python3 sq-patchright.py '{"origin":"JFK","destination":"SIN","date":"2026-03-15","cabin":"business"}'

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
from urllib.parse import urlparse

def log(msg):
    print(f"[SQ-Patchright {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

# SQ's Vue autocomplete in redeem mode needs city names, not IATA codes
IATA_TO_CITY = {
    "SIN": "Singapore", "NRT": "Tokyo", "HND": "Tokyo", "JFK": "New York",
    "LAX": "Los Angeles", "SFO": "San Francisco", "ORD": "Chicago",
    "LHR": "London", "CDG": "Paris", "FRA": "Frankfurt", "HKG": "Hong Kong",
    "ICN": "Seoul", "BKK": "Bangkok", "SYD": "Sydney", "MEL": "Melbourne",
    "PEK": "Beijing", "PVG": "Shanghai", "DEL": "Delhi", "BOM": "Mumbai",
    "DXB": "Dubai", "DOH": "Doha", "KUL": "Kuala Lumpur", "CGK": "Jakarta",
    "MNL": "Manila", "TPE": "Taipei", "KIX": "Osaka", "FCO": "Rome",
    "AMS": "Amsterdam", "ZRH": "Zurich", "MUC": "Munich", "MAD": "Madrid",
    "BCN": "Barcelona", "IST": "Istanbul", "JNB": "Johannesburg",
    "CPT": "Cape Town", "AKL": "Auckland", "SEA": "Seattle", "IAD": "Washington",
    "EWR": "Newark", "BOS": "Boston", "ATL": "Atlanta", "DFW": "Dallas",
    "IAH": "Houston", "MIA": "Miami", "YVR": "Vancouver", "YYZ": "Toronto",
}

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

api_responses = []

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

    kf_id = os.environ.get("SQ_KRISFLYER_ID", "")
    kf_pass = os.environ.get("SQ_KRISFLYER_PASSWORD", "")

    if not kf_id or not kf_pass:
        log("Missing SQ_KRISFLYER_ID or SQ_KRISFLYER_PASSWORD")
        print("[]")
        sys.exit(0)

    cabin_map = {"economy": "Y", "business": "C", "first": "F"}
    cabin_code = cabin_map.get(cabin, "C")

    log(f"Search: {origin}→{destination} {date} {cabin}")

    from patchright.sync_api import sync_playwright

    results = []

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

            # Track request bodies (to understand API parameters)
            request_bodies = {}
            def handle_request(request):
                url = request.url
                if any(k in url for k in ["getHistogram", "getAvailability", "searchFlights", "search"]):
                    body = request.post_data or ""
                    request_bodies[url] = body
                    if body:
                        log(f"REQ [{request.method}]: {url[:120]}")
                        log(f"  Body: {body[:500]}")
            page.on("request", handle_request)

            # Intercept ALL JSON network responses (broad capture for debugging)
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                if "json" in ct and response.status == 200:
                    try:
                        body = response.text()
                        if len(body) > 500:
                            log(f"API [{response.status}]: {url[:150]} ({len(body)} bytes)")
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
            page.goto("https://www.singaporeair.com/en_UK/us/home", timeout=60000, wait_until="domcontentloaded")

            rendered = False
            for attempt in range(10):
                time.sleep(2)
                try:
                    btn_count = page.evaluate("document.querySelectorAll('button').length")
                    input_count = page.evaluate("document.querySelectorAll('input').length")
                    if btn_count > 2:
                        log(f"Page rendered: {btn_count} buttons, {input_count} inputs")
                        rendered = True
                        break
                    log(f"Waiting for SPA render (attempt {attempt+1})... buttons={btn_count}")
                except Exception as e:
                    log(f"Render check error (attempt {attempt+1}): {e}")
                    time.sleep(2)  # Extra wait on navigation

            if not rendered:
                log("SPA not rendered, reloading...")
                page.reload(timeout=30000, wait_until="load")
                time.sleep(8)
                btn_count = page.evaluate("document.querySelectorAll('button').length")
                if btn_count < 2:
                    log("Page still not rendering — exit for retry")
                    sys.exit(1)

            # SQ redemption search requires KrisFlyer login, but Akamai Bot Manager
            # blocks the login POST with a JavaScript "Challenge Validation" page.
            # Cash fare histograms work without login but don't contain miles data.
            # Skip login entirely — it's not possible via headless automation.
            dt = datetime.strptime(date, "%Y-%m-%d")
            form_ok = False
            logged_in = False
            log("Skipping login (Akamai Bot Manager blocks login POST)")
            log("SQ redemption search requires login — will try API discovery only")

            # Step 3: Direct API approach — call getHistogram.form for miles data
            log("Trying direct API calls for redemption data...")

            # Try calling getHistogram.form with JSON body (matching SPA's format)
            # The SPA sends: {"request":{"itineraryDetails":{...},"cabinClass":"Y"}}
            # Our direct calls used URL-encoded form data which returned 415 (wrong Content-Type)
            dep_date = date  # e.g. "2026-03-22"
            # Calculate a return date 15 days later for the histogram range
            dt_dep = datetime.strptime(date, "%Y-%m-%d")
            from datetime import timedelta
            dt_ret = dt_dep + timedelta(days=15)
            ret_date = dt_ret.strftime("%Y-%m-%d")

            # Only try Economy histogram (confirmed working) — Business returns "Unable to process"
            # and no redemption flags have any effect without login
            histogram_combos = [
                ("Economy", {"request": {"itineraryDetails": {"originAirportCode": origin, "destinationAirportCode": destination,
                    "departureDate": dep_date, "returnDate": ret_date}, "cabinClass": "Y"}}),
            ]

            for label, body in histogram_combos:
                try:
                    result = page.evaluate("""([url, bodyJson]) => {
                        return fetch(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest',
                                'Accept': 'application/json, text/plain, */*',
                            },
                            credentials: 'include',
                            body: JSON.stringify(bodyJson),
                        }).then(r => r.text().then(t => ({ ok: r.ok, status: r.status, body: t, len: t.length })))
                          .catch(e => ({ error: e.message }));
                    }""", ["/home/getHistogram.form", body])

                    status = result.get("status", "?") if result else "null"
                    length = result.get("len", 0) if result else 0
                    resp_body = result.get("body", "") if result else ""

                    if result and result.get("ok") and length > 50:
                        log(f"Histogram [{label}]: {status} ({length} bytes)")
                        try:
                            data = json.loads(resp_body)
                            hist_resp = data.get("histogramResponse", data)
                            fares = hist_resp.get("fares", [])
                            if fares:
                                sample = fares[0] if isinstance(fares[0], dict) else {}
                                keys = list(sample.keys())
                                log(f"  {len(fares)} fares, keys: {keys}")
                                log(f"  Sample: {json.dumps(sample)[:200]}")
                                has_miles = any(k in keys for k in ["miles", "mileage", "lowestMiles", "milesRequired", "totalMiles"])
                                has_cash = any(k in keys for k in ["fare", "totalAmount"])
                                log(f"  Has miles: {has_miles}, Has cash: {has_cash}")
                                if has_miles:
                                    hist_results = parse_histogram(data, origin, destination, date, cabin)
                                    if hist_results:
                                        results = hist_results
                                        log(f"Got {len(results)} redemption results!")
                                        break
                            else:
                                log(f"  No fares. Response: {json.dumps(data)[:300]}")
                        except json.JSONDecodeError:
                            log(f"  Non-JSON: {resp_body[:200]}")
                    else:
                        log(f"Histogram [{label}]: {status} ({length}b) body={resp_body[:100]}")
                except Exception as e:
                    log(f"Histogram [{label}] error: {e}")

            # Step 5b: Try search/availability API with JSON body
            if not results:
                log("Trying searchAvailability API with JSON body...")
                search_combos = [
                    ("/home/getAvailability.form", {"request": {
                        "itineraryDetails": [{"originAirportCode": origin, "destinationAirportCode": destination,
                            "departureDate": dep_date}],
                        "cabinClass": cabin_code, "numOfAdults": 1, "redeemMiles": True, "tripType": "O"}}),
                    ("/plan_and_book/getAvailability.form", {"request": {
                        "itineraryDetails": [{"originAirportCode": origin, "destinationAirportCode": destination,
                            "departureDate": dep_date}],
                        "cabinClass": cabin_code, "numOfAdults": 1, "redeemMiles": True}}),
                    # Try the same URL but simpler body
                    ("/home/getAvailability.form", {"originAirportCode": origin, "destinationAirportCode": destination,
                        "departureDate": dep_date, "cabinClass": cabin_code, "tripType": "O",
                        "numOfAdults": 1, "redeemMiles": True}),
                ]
                for ep, body in search_combos:
                    try:
                        result = page.evaluate("""([url, bodyJson]) => {
                            return fetch(url, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Requested-With': 'XMLHttpRequest',
                                    'Accept': 'application/json, text/plain, */*',
                                },
                                credentials: 'include',
                                body: JSON.stringify(bodyJson),
                            }).then(r => r.text().then(t => ({ ok: r.ok, status: r.status, body: t, len: t.length })))
                              .catch(e => ({ error: e.message }));
                        }""", [ep, body])

                        status = result.get("status", "?") if result else "null"
                        length = result.get("len", 0) if result else 0
                        log(f"Search API [{ep}]: {status} ({length} bytes)")
                        if result and result.get("ok"):
                            try:
                                data = json.loads(result["body"])
                                if isinstance(data, dict):
                                    log(f"  Keys: {list(data.keys())[:15]}")
                                    log(f"  Sample: {json.dumps(data)[:500]}")
                                flights = extract_flights(data, origin, destination, date, cabin)
                                if flights:
                                    results = flights
                                    log(f"Got {len(results)} flights from search API!")
                                    break
                            except:
                                log(f"  Non-JSON: {result['body'][:200]}")
                    except Exception as e:
                        log(f"Search API [{ep}] error: {e}")

            # Step 5c: Parse any captured histogram responses for cash fare data as fallback
            if not results:
                log("Checking captured histogram responses...")
                for resp in api_responses:
                    if "getHistogram" in resp["url"]:
                        try:
                            hist_data = json.loads(resp["body"])
                            hist_resp = hist_data.get("histogramResponse", hist_data)
                            fares = hist_resp.get("fares", [])
                            if fares:
                                sample = fares[0] if isinstance(fares[0], dict) else {}
                                log(f"  Captured histogram ({len(fares)} fares): keys={list(sample.keys())}")
                                # Even cash fare histograms are useful — extract the date match
                                for fare in fares:
                                    if not isinstance(fare, dict):
                                        continue
                                    dep_date = str(fare.get("departureDate", ""))
                                    if date in dep_date:
                                        log(f"  Date match: {json.dumps(fare)}")
                                        break
                                break  # Only log one histogram
                        except:
                            pass

            log(f"Final: {len(results)} results")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))


def parse_histogram(data, origin, destination, date, cabin):
    """Parse SQ's getHistogram.form response for award availability.

    Structure: {histogramResponse: {fares: [...], origin, destination, currency, avgTripDuration}}
    """
    results = []
    try:
        # Navigate to histogramResponse.fares
        hist_resp = data.get("histogramResponse", data)
        fares = hist_resp.get("fares", [])
        resp_origin = hist_resp.get("origin", origin)
        resp_dest = hist_resp.get("destination", destination)

        if not fares:
            # Try alternate paths
            fares = (
                data.get("fares") or data.get("histogram") or data.get("calendarList") or
                data.get("availability") or []
            )

        if not fares:
            log(f"No fares in histogram. histogramResponse keys: {list(hist_resp.keys())[:10]}")
            # Debug: log fares structure
            for key in list(hist_resp.keys())[:8]:
                val = hist_resp[key]
                if isinstance(val, list):
                    log(f"  {key}: list[{len(val)}]")
                    if val:
                        sample = val[0]
                        if isinstance(sample, dict):
                            log(f"    sample keys: {list(sample.keys())[:10]}")
                            log(f"    sample: {json.dumps(sample)[:200]}")
                elif isinstance(val, dict):
                    log(f"  {key}: dict keys={list(val.keys())[:8]}")
                else:
                    log(f"  {key}: {str(val)[:80]}")
            return []

        log(f"Found {len(fares)} fare entries in histogram")
        if fares:
            sample = fares[0] if isinstance(fares[0], dict) else {}
            log(f"  Sample fare keys: {list(sample.keys())[:15]}")
            log(f"  Sample fare: {json.dumps(sample)[:300]}")

        for entry in fares:
            if not isinstance(entry, dict):
                continue

            # Try various date key names
            entry_date = str(
                entry.get("date") or entry.get("departureDate") or
                entry.get("dateStr") or entry.get("travelDate") or
                entry.get("departDate") or ""
            )
            # Only match our target date
            if date not in entry_date and entry_date not in date:
                continue

            # Extract miles — try multiple key names
            miles = (
                entry.get("lowestMiles") or entry.get("miles") or entry.get("mileage") or
                entry.get("minMiles") or entry.get("points") or entry.get("totalMiles") or
                entry.get("saverMiles") or entry.get("advantageMiles") or
                entry.get("saver") or entry.get("advantage") or 0
            )
            if isinstance(miles, dict):
                cabin_key = {"economy": ["economy", "Y", "E"], "business": ["business", "J", "C", "B"], "first": ["first", "F"]}
                for k in cabin_key.get(cabin, [cabin]):
                    if k in miles:
                        miles = miles[k]
                        break
                if isinstance(miles, dict):
                    miles = list(miles.values())[0] if miles else 0

            if not miles or miles == 0:
                continue

            available = entry.get("available", entry.get("isAvailable", True))
            if available is False or str(available).lower() == "false":
                continue

            results.append({
                "source": "singapore",
                "airline": "Singapore Airlines",
                "flightNumber": "",
                "origin": resp_origin if len(resp_origin) == 3 else origin,
                "destination": resp_dest if len(resp_dest) == 3 else destination,
                "departureDate": date,
                "departureTime": "",
                "arrivalTime": "",
                "duration": str(hist_resp.get("avgTripDuration", "")),
                "stops": -1,
                "cabin": cabin,
                "pointsRequired": int(float(str(miles).replace(",", ""))),
                "pointsProgram": "KrisFlyer",
                "taxesAndFees": 0,
                "awardType": "saver",
                "scrapedAt": datetime.utcnow().isoformat() + "Z",
                "bookingUrl": "https://www.singaporeair.com/en_UK/us/home#/book/redeemflights",
            })

    except Exception as e:
        log(f"Histogram parse error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    return results


def try_direct_api(page, origin, destination, date, cabin):
    """Try calling SQ's search APIs directly using session cookies."""
    cabin_map = {"economy": "Y", "business": "C", "first": "F"}
    cabin_code = cabin_map.get(cabin, "C")

    # Try multiple endpoints and methods
    endpoints = [
        {"url": "/plan_and_book/getAvailability.form", "method": "POST"},
        {"url": "/home/searchFlights.form", "method": "POST"},
        {"url": "/home/getAvailability.form", "method": "GET"},
    ]

    for ep in endpoints:
        try:
            result = page.evaluate("""([url, method, origin, destination, date, cabinCode]) => {
                const params = new URLSearchParams();
                params.append('originAirportCode', origin);
                params.append('destinationAirportCode', destination);
                params.append('departureMonth', date.substring(0, 7));
                params.append('departureDay', date.substring(8, 10));
                params.append('returnMonth', '');
                params.append('returnDay', '');
                params.append('cabinClass', cabinCode);
                params.append('numOfAdults', '1');
                params.append('numOfChildren', '0');
                params.append('numOfInfants', '0');
                params.append('tripType', 'O');
                params.append('redeemType', 'F');

                const opts = {
                    method: method,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    credentials: 'include',
                };
                if (method === 'POST') {
                    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    opts.body = params.toString();
                } else {
                    url = url + '?' + params.toString();
                }

                return fetch(url, opts).then(r => {
                    if (!r.ok) return { error: r.status + ' ' + r.statusText, url: url };
                    return r.text().then(t => ({ ok: true, body: t, status: r.status, len: t.length, url: url }));
                }).catch(e => ({ error: e.message, url: url }));
            }""", [ep["url"], ep["method"], origin, destination, date, cabin_code])

            if result and result.get("ok"):
                log(f"Direct API [{ep['method']} {ep['url']}]: {result.get('len', 0)} bytes")
                try:
                    data = json.loads(result["body"])
                    flights = extract_flights(data, origin, destination, date, cabin)
                    if flights:
                        log(f"Direct API: {len(flights)} flights found")
                        return flights
                    # Try histogram parse
                    hist_results = parse_histogram(data, origin, destination, date, cabin)
                    if hist_results:
                        return hist_results
                    if isinstance(data, dict):
                        log(f"Direct API keys: {list(data.keys())[:15]}")
                except json.JSONDecodeError:
                    log(f"Direct API: non-JSON: {result['body'][:200]}")
            else:
                err = result.get("error", "unknown") if result else "null"
                log(f"Direct API [{ep['method']} {ep['url']}]: {err}")
        except Exception as e:
            log(f"Direct API error [{ep['url']}]: {e}")

    return []


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
