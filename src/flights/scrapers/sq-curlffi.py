#!/usr/bin/env python3
"""
Singapore Airlines KrisFlyer Award Search (curl_cffi).

Uses curl_cffi to impersonate Chrome 131's TLS/JA3/HTTP2 fingerprints,
bypassing Akamai bot detection at the network level without needing a browser.

Flow:
  1. Warm cookies on singaporeair.com homepage
  2. Attempt KrisFlyer login via POST
  3. Call /home/getAvailability.form for redemption availability
  4. Fallback: /home/getHistogram.form for economy histogram data

Usage:
  python3 sq-curlffi.py '{"origin":"SIN","destination":"NRT","date":"2026-03-22","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import re
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log, validate_params, create_session, warm_cookies

LABEL = "SQ-CurlFfi"

def log(msg):
    _log(LABEL, msg)


def parse_histogram(data, origin, destination, date, cabin):
    """Parse SQ's getHistogram.form response for award availability."""
    results = []
    try:
        hist_resp = data.get("histogramResponse", data)
        fares = hist_resp.get("fares", [])
        resp_origin = hist_resp.get("origin", origin)
        resp_dest = hist_resp.get("destination", destination)

        if not fares:
            fares = (
                data.get("fares") or data.get("histogram") or
                data.get("calendarList") or data.get("availability") or []
            )

        if not fares:
            log(f"No fares in histogram. Keys: {list(hist_resp.keys())[:10]}")
            return []

        log(f"Found {len(fares)} fare entries in histogram")
        if fares:
            sample = fares[0] if isinstance(fares[0], dict) else {}
            log(f"  Sample fare keys: {list(sample.keys())[:15]}")

        for entry in fares:
            if not isinstance(entry, dict):
                continue

            entry_date = str(
                entry.get("date") or entry.get("departureDate") or
                entry.get("dateStr") or entry.get("travelDate") or
                entry.get("departDate") or ""
            )
            if date not in entry_date and entry_date not in date:
                continue

            miles = (
                entry.get("lowestMiles") or entry.get("miles") or entry.get("mileage") or
                entry.get("minMiles") or entry.get("points") or entry.get("totalMiles") or
                entry.get("saverMiles") or entry.get("advantageMiles") or
                entry.get("saver") or entry.get("advantage") or 0
            )
            if isinstance(miles, dict):
                cabin_key = {
                    "economy": ["economy", "Y", "E"],
                    "business": ["business", "J", "C", "B"],
                    "first": ["first", "F"],
                }
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

    return results


def extract_flights(data, origin, destination, date, cabin, depth=0):
    """Recursively search JSON for objects with flight-like keys."""
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


def try_login(session, kf_id, kf_pass):
    """Attempt KrisFlyer login. Returns True on success."""
    log("Attempting KrisFlyer login...")
    try:
        login_payload = {
            "loginUserId": kf_id,
            "loginPassword": kf_pass,
            "rememberMe": False,
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://www.singaporeair.com",
            "Referer": "https://www.singaporeair.com/en_UK/us/home",
        }
        resp = session.post(
            "https://www.singaporeair.com/kfLogin.form",
            json=login_payload,
            headers=headers,
            timeout=15,
        )
        log(f"Login response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 200:
            try:
                data = resp.json()
                if data.get("success") or data.get("status") == "success":
                    log("Login successful!")
                    return True
                log(f"Login response: {json.dumps(data)[:300]}")
            except:
                log(f"Login response body: {resp.text[:200]}")
        elif resp.status_code == 403:
            log("Login blocked by Akamai (403)")
        else:
            log(f"Login failed: HTTP {resp.status_code}")

    except Exception as e:
        log(f"Login error: {e}")

    return False


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

    cabin_map = {"economy": "Y", "business": "C", "first": "F"}
    cabin_code = cabin_map.get(cabin, "C")

    log(f"Search: {origin}->{destination} {date} {cabin}")

    results = []

    try:
        session, proxy_info = create_session(LABEL)

        # Step 1: Warm cookies
        cookie_count = warm_cookies(session, "https://www.singaporeair.com/en_UK/us/home", LABEL)
        if cookie_count < 3:
            log("Few cookies — may be blocked")

        time.sleep(1)

        # Step 2: Try login (curl_cffi may pass Akamai challenge)
        logged_in = False
        if kf_id and kf_pass:
            logged_in = try_login(session, kf_id, kf_pass)
        else:
            log("No KrisFlyer credentials — skipping login")

        # Step 3: Try getAvailability.form (redemption search — requires login)
        if logged_in:
            log("Trying getAvailability.form (redemption search)...")
            avail_bodies = [
                {"request": {
                    "itineraryDetails": [{"originAirportCode": origin, "destinationAirportCode": destination,
                        "departureDate": date}],
                    "cabinClass": cabin_code, "numOfAdults": 1, "redeemMiles": True, "tripType": "O"}},
            ]
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://www.singaporeair.com",
                "Referer": "https://www.singaporeair.com/en_UK/us/home",
            }
            for body in avail_bodies:
                try:
                    resp = session.post(
                        "https://www.singaporeair.com/home/getAvailability.form",
                        json=body,
                        headers=headers,
                        timeout=20,
                    )
                    log(f"Availability: HTTP {resp.status_code} ({len(resp.text)} bytes)")
                    if resp.status_code == 200 and len(resp.text) > 50:
                        try:
                            data = resp.json()
                            log(f"  Keys: {list(data.keys())[:15]}")
                            flights = extract_flights(data, origin, destination, date, cabin)
                            if flights:
                                results = flights
                                log(f"Got {len(results)} flights from availability API!")
                                break
                            hist_results = parse_histogram(data, origin, destination, date, cabin)
                            if hist_results:
                                results = hist_results
                                log(f"Got {len(results)} results from histogram in availability response!")
                                break
                        except json.JSONDecodeError:
                            log(f"  Not JSON: {resp.text[:200]}")
                except Exception as e:
                    log(f"Availability error: {e}")

        # Step 4: Fallback — getHistogram.form (works without login for economy)
        if not results:
            log("Trying getHistogram.form (economy histogram)...")
            dt_dep = datetime.strptime(date, "%Y-%m-%d")
            dt_ret = dt_dep + timedelta(days=15)
            ret_date = dt_ret.strftime("%Y-%m-%d")

            hist_body = {"request": {
                "itineraryDetails": {
                    "originAirportCode": origin,
                    "destinationAirportCode": destination,
                    "departureDate": date,
                    "returnDate": ret_date,
                },
                "cabinClass": "Y",
            }}
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://www.singaporeair.com",
                "Referer": "https://www.singaporeair.com/en_UK/us/home",
            }
            try:
                resp = session.post(
                    "https://www.singaporeair.com/home/getHistogram.form",
                    json=hist_body,
                    headers=headers,
                    timeout=20,
                )
                log(f"Histogram: HTTP {resp.status_code} ({len(resp.text)} bytes)")
                if resp.status_code == 200 and len(resp.text) > 50:
                    try:
                        data = resp.json()
                        hist_results = parse_histogram(data, origin, destination, date, cabin)
                        if hist_results:
                            results = hist_results
                            log(f"Got {len(results)} results from histogram!")
                        else:
                            # Log structure for debugging
                            hist_resp = data.get("histogramResponse", data)
                            fares = hist_resp.get("fares", [])
                            if fares and isinstance(fares[0], dict):
                                log(f"  Histogram has {len(fares)} fares, keys: {list(fares[0].keys())[:10]}")
                                log(f"  Sample: {json.dumps(fares[0])[:200]}")
                            else:
                                log(f"  Histogram keys: {list(hist_resp.keys())[:10]}")
                    except json.JSONDecodeError:
                        log(f"  Not JSON: {resp.text[:200]}")
                elif resp.status_code == 403:
                    log("Histogram blocked by Akamai")
                    sys.exit(1)
            except Exception as e:
                log(f"Histogram error: {e}")

        log(f"Final: {len(results)} results")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
