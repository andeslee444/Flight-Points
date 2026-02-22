#!/usr/bin/env python3
"""
American Airlines Award Search via curl_cffi.

Uses AA's Angular SPA API endpoints directly with Chrome 131 TLS impersonation.

Flow:
  1. Warm cookies on aa.com (establishes Akamai _abck + XSRF-TOKEN)
  2. POST /booking/api/search/itinerary with award search payload
  3. Parse response into FlightResult[] JSON

Usage:
  python3 aa-curlffi.py '{"origin":"JFK","destination":"LHR","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
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

LABEL = "AA-CurlFfi"

def log(msg):
    _log(LABEL, msg)


CABIN_MAP = {
    'economy': '',
    'business': 'business',
    'first': 'first',
}

CABIN_NAMES = {
    'ECONOMY': 'economy',
    'PREMIUM_ECONOMY': 'economy',
    'BUSINESS': 'business',
    'FIRST': 'first',
    'COACH': 'economy',
}


def build_payload(origin, destination, date, cabin):
    """Build the AA itinerary search JSON payload."""
    return {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": 1}],
        "requestHeader": {"clientId": "AAcom"},
        "slices": [{
            "allCarriers": True,
            "cabin": CABIN_MAP.get(cabin, ''),
            "departureDate": date,
            "destination": destination,
            "destinationNearbyAirports": False,
            "origin": origin,
            "originNearbyAirports": False,
        }],
        "tripOptions": {
            "searchType": "Award",
            "corporateBooking": False,
            "locale": "en_US",
        },
        "loyaltyInfo": None,
        "queryParams": {
            "sliceIndex": 0,
            "sessionId": "",
            "solutionSet": "",
            "solutionId": "",
        },
    }


def parse_duration_mins(mins):
    """Convert minutes to 'Xh Ym' format."""
    if not mins:
        return ''
    h = mins // 60
    m = mins % 60
    return f"{h}h {m}m"


def format_time(iso_str):
    """Format ISO time to readable time."""
    if not iso_str:
        return ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%I:%M %p').lstrip('0')
    except Exception:
        return iso_str


def parse_response(data, params):
    """Parse AA itinerary search response into FlightResult[]."""
    results = []

    slices = data.get('slices', [])
    if not slices:
        return results

    for flight_option in slices:
        segments = flight_option.get('segments', [])
        if not segments:
            continue

        duration_mins = flight_option.get('durationInMinutes', 0)
        stops = len(segments) - 1

        # Get departure/arrival from first/last segment
        first_seg = segments[0]
        last_seg = segments[-1]

        first_leg = first_seg.get('legs', [{}])[0] if first_seg.get('legs') else {}
        last_leg = last_seg.get('legs', [{}])[-1] if last_seg.get('legs') else {}

        dep_time = first_leg.get('departureDateTime', '')
        arr_time = last_leg.get('arrivalDateTime', '')

        # Get operating airline from first segment
        operating = first_seg.get('legs', [{}])[0] if first_seg.get('legs') else {}
        airline_code = operating.get('operatingCarrier', {}).get('code', 'AA')
        airline_name = operating.get('operatingCarrier', {}).get('name', 'American Airlines')

        # Build flight number string
        flight_numbers = []
        for seg in segments:
            for leg in seg.get('legs', []):
                fn = leg.get('flightNumber', '')
                carrier = leg.get('operatingCarrier', {}).get('code', 'AA')
                if fn:
                    flight_numbers.append(f"{carrier}{fn}")
        flight_number_str = '/'.join(flight_numbers)

        # Get operating airlines for metadata
        operating_airlines = []
        for seg in segments:
            for leg in seg.get('legs', []):
                name = leg.get('operatingCarrier', {}).get('name', '')
                if name and name not in operating_airlines:
                    operating_airlines.append(name)

        # Extract fares for each product (cabin class)
        products_detail = flight_option.get('productDetails', [])

        for product in products_detail:
            product_type = product.get('productType', '')
            cabin = CABIN_NAMES.get(product_type, 'economy')

            # Filter by requested cabin
            if cabin != params.get('cabin', 'business'):
                continue

            fares = product.get('fares', [])
            for fare in fares:
                if not fare.get('available', True):
                    continue

                miles = fare.get('mileage', {}).get('amount', 0)
                if not miles:
                    continue

                taxes = fare.get('tax', {}).get('amount', 0)
                seats = fare.get('seatsRemaining', 0)
                fare_basis = fare.get('fareBasisCode', '')

                # Determine saver vs non-saver
                is_saver = 'SAVER' in fare_basis.upper() or 'AWARD' in fare_basis.upper()

                results.append({
                    'source': 'american-airlines',
                    'airline': airline_name,
                    'flightNumber': flight_number_str,
                    'origin': params['origin'],
                    'destination': params['destination'],
                    'departureDate': params['date'],
                    'departureTime': format_time(dep_time),
                    'arrivalTime': format_time(arr_time),
                    'duration': parse_duration_mins(duration_mins),
                    'stops': stops,
                    'cabin': cabin,
                    'pointsRequired': miles,
                    'pointsProgram': 'AAdvantage',
                    'taxesAndFees': taxes,
                    'awardType': 'saver' if is_saver else 'standard',
                    'availableSeats': seats,
                    'scrapedAt': datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    'bookingUrl': f"https://www.aa.com/booking/search?type=award&origin={params['origin']}&destination={params['destination']}&departureDate={params['date']}&pax=1&cabin={cabin}",
                    'metadata': {
                        'operatingAirlines': operating_airlines,
                        'operatingAirlineCode': airline_code,
                        'fareBasisCode': fare_basis,
                        'productType': product_type,
                    },
                })

    # If productDetails parsing yielded nothing, try the simpler 'products' field
    if not results:
        products = data.get('products', [])
        log(f"No productDetails results, trying 'products' ({len(products)} items)")
        for product in products:
            cabin_type = product.get('cabin', '')
            cabin = CABIN_NAMES.get(cabin_type, 'economy')
            if cabin != params.get('cabin', 'business'):
                continue

            miles = product.get('perPassengerAwardPoints', 0) or product.get('totalMileageCost', 0)
            if not miles:
                continue

            taxes = product.get('perPassengerSaleTotal', {}).get('amount', 0) if isinstance(product.get('perPassengerSaleTotal'), dict) else product.get('perPassengerSaleTotal', 0)

            results.append({
                'source': 'american-airlines',
                'airline': 'American Airlines',
                'flightNumber': '',
                'origin': params['origin'],
                'destination': params['destination'],
                'departureDate': params['date'],
                'departureTime': '',
                'arrivalTime': '',
                'duration': '',
                'stops': 0,
                'cabin': cabin,
                'pointsRequired': miles,
                'pointsProgram': 'AAdvantage',
                'taxesAndFees': taxes,
                'awardType': 'standard',
                'availableSeats': 0,
                'scrapedAt': datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                'bookingUrl': f"https://www.aa.com/booking/search?type=award&origin={params['origin']}&destination={params['destination']}&departureDate={params['date']}&pax=1&cabin={cabin}",
                'metadata': {},
            })

    return results


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

    log(f"Search: {origin}->{destination} {date} {cabin}")

    results = []

    def aa_warmup(page):
        """Domain-specific browser actions for AA.com cookie farming."""
        import random as _random
        # Navigate to booking page to trigger additional Akamai challenges
        page.goto("https://www.aa.com/booking/find-flights", timeout=30000, wait_until="domcontentloaded")
        time.sleep(_random.uniform(2, 4))
        page.mouse.move(_random.randint(100, 600), _random.randint(100, 300))
        time.sleep(_random.uniform(1, 2))

    def do_search(session_obj):
        """Execute the award search with a given session. Returns (results, should_retry)."""
        # Get XSRF-TOKEN
        xsrf = dict(session_obj.cookies).get("XSRF-TOKEN", "")
        if not xsrf:
            log("Getting XSRF token from booking page...")
            try:
                session_obj.get("https://www.aa.com/booking/find-flights", timeout=30)
                time.sleep(1)
                xsrf = dict(session_obj.cookies).get("XSRF-TOKEN", "")
            except Exception as e:
                log(f"XSRF fetch error: {e}")
        log(f"XSRF token: {'found' if xsrf else 'missing'} ({len(xsrf)} chars)")

        payload = build_payload(origin, destination, date, cabin)
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://www.aa.com",
            "Referer": "https://www.aa.com/booking/search/find-flights",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        }
        if xsrf:
            headers["X-XSRF-TOKEN"] = xsrf

        import random
        delay = random.uniform(1, 3)
        log(f"Waiting {delay:.1f}s before search...")
        time.sleep(delay)

        log("Sending search request...")
        resp = session_obj.post(
            "https://www.aa.com/booking/api/search/itinerary",
            json=payload,
            headers=headers,
            timeout=90,
        )
        log(f"Response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 200:
            try:
                data = resp.json()
                if "cpr_chlge" in data:
                    log("Akamai bot challenge in response — cookies may be stale")
                    return [], True
                elif "error" in data and data.get("error"):
                    log(f"API error: {json.dumps(data['error'])[:200]}")
                    return [], False
                else:
                    r = parse_response(data, params)
                    log(f"Parsed {len(r)} results")
                    return r, False
            except json.JSONDecodeError:
                log(f"Response not JSON: {resp.text[:200]}")
                return [], False
        elif resp.status_code == 429:
            log("Rate limited (429)")
            try:
                body = resp.json()
                if "cpr_chlge" in body:
                    log("Akamai challenge in 429 — cookies stale")
                    return [], True
            except:
                pass
            return [], True
        elif resp.status_code in (403, 503):
            log(f"Blocked: HTTP {resp.status_code}")
            return [], True
        else:
            log(f"Unexpected status: {resp.status_code}")
            log(f"Body: {resp.text[:300]}")
            return [], False

    try:
        # Step 1: Get cookies from cookie farm (Patchright browser)
        session, proxy_info = create_session(LABEL)
        cookies = get_cookies("aa.com", "https://www.aa.com/", extra_actions=aa_warmup)
        if cookies:
            inject_cookies(session, cookies, "aa.com")
            log(f"Using {len(cookies)} farmed cookies")
        else:
            log("No farmed cookies — trying plain session")

        # Step 2: Search
        results, should_retry = do_search(session)

        # Step 3: If blocked, invalidate cache and retry once with fresh cookies
        if should_retry and not results:
            log("Invalidating cookie cache and retrying with fresh cookies...")
            invalidate_cache("aa.com")
            time.sleep(2)

            session2, _ = create_session(LABEL)
            fresh_cookies = get_cookies("aa.com", "https://www.aa.com/", extra_actions=aa_warmup)
            if fresh_cookies:
                inject_cookies(session2, fresh_cookies, "aa.com")
                results, should_retry2 = do_search(session2)
                if should_retry2 and not results:
                    log("Retry also failed — cookie farm may not work for AA")
                    sys.exit(1)
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
