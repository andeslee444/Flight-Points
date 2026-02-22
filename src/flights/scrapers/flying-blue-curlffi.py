#!/usr/bin/env python3
"""
Air France / KLM Flying Blue Award Search via cookie farm + curl_cffi.

No login required. Uses cookie farm to solve Akamai, then curl_cffi
for fast GraphQL API calls.

Flow:
  1. Farm cookies from airfrance.us (Patchright browser solves Akamai)
  2. curl_cffi POST to Air France GraphQL endpoint with farmed cookies
  3. Parse flight response into FlightResult[]

Usage:
  python3 flying-blue-curlffi.py '{"origin":"JFK","destination":"CDG","date":"2026-04-15","cabin":"business"}'
"""

import json
import sys
import time
import re
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log, validate_params, create_session
from cookie_farm import get_cookies, inject_cookies, invalidate_cache

LABEL = "FlyingBlue-CurlFfi"

def log(msg):
    _log(LABEL, msg)


CABIN_MAP = {
    "economy": "ECONOMY",
    "business": "BUSINESS",
    "first": "FIRST",
}

AIRLINE_NAMES = {
    "AF": "Air France",
    "KL": "KLM",
    "DL": "Delta",
    "KE": "Korean Air",
    "VN": "Vietnam Airlines",
    "CI": "China Airlines",
    "MU": "China Eastern",
    "OK": "Czech Airlines",
    "RO": "TAROM",
    "ME": "MEA",
    "SV": "Saudi Arabian Airlines",
    "GA": "Garuda Indonesia",
    "SU": "Aeroflot",
}


def build_graphql_payload(origin, destination, date, cabin):
    """Build Air France GraphQL search payload."""
    cabin_code = CABIN_MAP.get(cabin, "BUSINESS")
    return {
        "operationName": "searchBestPriceOffers",
        "variables": {
            "searchCriteria": {
                "passengers": [{"type": "ADT", "count": 1}],
                "cabinClass": cabin_code,
                "connections": [{
                    "origin": origin,
                    "destination": destination,
                    "departureDate": date,
                }],
                "tripType": "ONE_WAY",
                "loyalty": {"program": "FB"},
            },
        },
        "query": """query searchBestPriceOffers($searchCriteria: SearchCriteriaInput!) {
  searchOffers(searchCriteria: $searchCriteria) {
    connections {
      segments {
        flightNumber
        marketingAirline { code name }
        operatingAirline { code name }
        origin { code }
        destination { code }
        departure
        arrival
        duration
      }
      milesPrice { amount }
      taxPrice { amount currency }
      proposedDate
      cabinClass
      status
    }
    bestPrices {
      date
      available
      milesPrice { amount }
      taxPrice { amount currency }
    }
  }
}""",
    }


def format_time(iso_str):
    if not iso_str:
        return ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%I:%M %p').lstrip('0')
    except Exception:
        return iso_str


def parse_duration(dur_str):
    if not dur_str:
        return ''
    m = re.match(r'PT(\d+)H(?:(\d+)M)?', dur_str)
    if m:
        return f"{m.group(1)}h {m.group(2) or '0'}m"
    # Try minutes-only format
    m2 = re.match(r'(\d+)', str(dur_str))
    if m2:
        mins = int(m2.group(1))
        return f"{mins // 60}h {mins % 60}m"
    return str(dur_str)


def parse_response(data, params):
    """Parse Air France GraphQL response into FlightResult[]."""
    results = []

    search_offers = data.get("data", {}).get("searchOffers", data.get("searchOffers", {}))
    if not search_offers:
        return results

    connections = search_offers.get("connections", [])

    for conn in connections:
        if not isinstance(conn, dict):
            continue

        status = conn.get("status", "")
        if status and status.upper() in ("SOLD_OUT", "UNAVAILABLE"):
            continue

        segments = conn.get("segments", [])
        if not segments:
            continue

        # Flight info from segments
        first_seg = segments[0]
        last_seg = segments[-1]

        airline_code = (first_seg.get("operatingAirline") or first_seg.get("marketingAirline", {})).get("code", "AF")
        airline_name = AIRLINE_NAMES.get(airline_code, airline_code)

        flight_numbers = []
        operating_airlines = []
        total_duration = ""

        for seg in segments:
            fn = seg.get("flightNumber", "")
            carrier = (seg.get("marketingAirline") or {}).get("code", "")
            if fn:
                flight_numbers.append(f"{carrier}{fn}" if carrier else fn)
            op_name = (seg.get("operatingAirline") or {}).get("name", "")
            if op_name and op_name not in operating_airlines:
                operating_airlines.append(op_name)

        dep_time = first_seg.get("departure", "")
        arr_time = last_seg.get("arrival", "")

        # Duration: sum segment durations or use connection-level
        if len(segments) == 1:
            total_duration = parse_duration(segments[0].get("duration", ""))

        stops = len(segments) - 1

        # Pricing
        miles_price = conn.get("milesPrice", {})
        tax_price = conn.get("taxPrice", {})
        miles = miles_price.get("amount", 0) if isinstance(miles_price, dict) else 0
        taxes = tax_price.get("amount", 0) if isinstance(tax_price, dict) else 0

        cabin = conn.get("cabinClass", params.get("cabin", "business"))
        if isinstance(cabin, str):
            cabin = cabin.lower()
            if cabin in ("j", "business"):
                cabin = "business"
            elif cabin in ("f", "first"):
                cabin = "first"
            elif cabin in ("y", "economy"):
                cabin = "economy"
            else:
                cabin = params.get("cabin", "business")

        if miles and miles > 0:
            booking_url = (
                f"https://www.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0"
                f"&cabinClass={CABIN_MAP.get(cabin, 'BUSINESS')}&activeConnection=0"
                f"&origin={params['origin']}&destination={params['destination']}"
                f"&outboundDate={params['date']}&tripType=ONE_WAY"
            )

            results.append({
                "source": "flying-blue",
                "airline": airline_name,
                "flightNumber": "/".join(flight_numbers),
                "origin": params["origin"],
                "destination": params["destination"],
                "departureDate": params["date"],
                "departureTime": format_time(dep_time),
                "arrivalTime": format_time(arr_time),
                "duration": total_duration,
                "stops": stops,
                "cabin": cabin,
                "pointsRequired": int(miles),
                "pointsProgram": "Flying Blue",
                "taxesAndFees": float(taxes),
                "awardType": "saver",
                "availableSeats": 0,
                "scrapedAt": datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                "bookingUrl": booking_url,
                "metadata": {
                    "operatingAirlines": operating_airlines,
                    "operatingAirlineCode": airline_code,
                },
            })

    # If connections didn't yield results, try bestPrices (calendar-level)
    if not results:
        best_prices = search_offers.get("bestPrices", [])
        for bp in best_prices:
            if not bp.get("available"):
                continue
            miles_price = bp.get("milesPrice", {})
            miles = miles_price.get("amount", 0) if isinstance(miles_price, dict) else 0
            tax_price = bp.get("taxPrice", {})
            taxes = tax_price.get("amount", 0) if isinstance(tax_price, dict) else 0
            bp_date = bp.get("date", params["date"])

            if miles > 0:
                results.append({
                    "source": "flying-blue",
                    "airline": "Air France",
                    "flightNumber": "",
                    "origin": params["origin"],
                    "destination": params["destination"],
                    "departureDate": bp_date,
                    "departureTime": "",
                    "arrivalTime": "",
                    "duration": "",
                    "stops": 0,
                    "cabin": params.get("cabin", "business"),
                    "pointsRequired": int(miles),
                    "pointsProgram": "Flying Blue",
                    "taxesAndFees": float(taxes),
                    "awardType": "saver",
                    "availableSeats": 0,
                    "scrapedAt": datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    "bookingUrl": f"https://www.airfrance.us/search/offers?origin={params['origin']}&destination={params['destination']}&outboundDate={bp_date}&tripType=ONE_WAY",
                    "metadata": {},
                })

    return results


def do_search(session, params, cookies_present):
    """Execute GraphQL search. Returns (results, should_retry)."""
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")

    payload = build_graphql_payload(origin, destination, date, cabin)

    # Air France GraphQL endpoint
    gql_url = "https://www.airfrance.us/search/api/offers"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://www.airfrance.us",
        "Referer": f"https://www.airfrance.us/search/offers?origin={origin}&destination={destination}&outboundDate={date}&tripType=ONE_WAY",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }

    import random
    delay = random.uniform(1, 3)
    log(f"Waiting {delay:.1f}s before search...")
    time.sleep(delay)

    log("Sending GraphQL request...")
    resp = session.post(gql_url, json=payload, headers=headers, timeout=60)
    log(f"Response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

    if resp.status_code == 200:
        try:
            data = resp.json()
            if "cpr_chlge" in data or "cpr_chlge" in resp.text[:500]:
                log("Akamai challenge in response — cookies stale")
                return [], True
            if "errors" in data:
                errors = data.get("errors", [])
                log(f"GraphQL errors: {json.dumps(errors[:2])[:300]}")
                return [], False
            results = parse_response(data, params)
            log(f"Parsed {len(results)} results")
            return results, False
        except json.JSONDecodeError:
            log(f"Response not JSON: {resp.text[:200]}")
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

    log(f"Search: {params['origin']}->{params['destination']} {params['date']} {params.get('cabin', 'business')}")

    results = []

    def af_warmup(page):
        """Air France-specific browser warmup."""
        import random as _r
        time.sleep(_r.uniform(1, 2))
        page.evaluate("window.scrollBy(0, Math.random() * 300)")
        time.sleep(_r.uniform(1, 2))

    try:
        # Step 1: Get farmed cookies
        session, proxy_info = create_session(LABEL)
        cookies = get_cookies("airfrance.us", "https://www.airfrance.us/", extra_actions=af_warmup)
        if cookies:
            inject_cookies(session, cookies, "airfrance.us")
            log(f"Using {len(cookies)} farmed cookies")
        else:
            log("No farmed cookies — trying plain session")

        # Step 2: Search
        results, should_retry = do_search(session, params, bool(cookies))

        # Step 3: Retry with fresh cookies if blocked
        if should_retry and not results:
            log("Invalidating cache and retrying...")
            invalidate_cache("airfrance.us")
            time.sleep(2)

            session2, _ = create_session(LABEL)
            fresh_cookies = get_cookies("airfrance.us", "https://www.airfrance.us/", extra_actions=af_warmup)
            if fresh_cookies:
                inject_cookies(session2, fresh_cookies, "airfrance.us")
                results, _ = do_search(session2, params, True)
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
