#!/usr/bin/env python3
"""
Alaska Airlines Award Search via curl_cffi.

Uses Alaska's hybrid ASP.NET + SvelteKit architecture directly.

Flow:
  1. Warm cookies on alaskaair.com
  2. POST /Shopping/Flights/Shop (form data) — returns 302 redirect
  3. GET /search/results/__data.json — SvelteKit streamed data endpoint
  4. Parse SvelteKit deferred response into FlightResult[] JSON

The key insight: the __data.json endpoint returns full flight data even when
the HTML page shows a "Client Challenge" bot check.

Usage:
  python3 alaska-curlffi.py '{"origin":"SEA","destination":"LAX","date":"2026-03-22","cabin":"economy"}'

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
from curlffi_base import log as _log, validate_params, create_session, warm_cookies

LABEL = "Alaska-CurlFfi"

def log(msg):
    _log(LABEL, msg)


CABIN_MAP = {
    'economy': 'coach',
    'business': 'first',   # Alaska calls business/first "First Class"
    'first': 'first',
}


def format_date_mmddyyyy(date_str):
    """Convert 2026-03-22 to 03/22/2026."""
    parts = date_str.split('-')
    return f"{parts[1]}/{parts[2]}/{parts[0]}"


def deref(idx, data):
    """Dereference a single SvelteKit index. Returns the raw value at data[idx]."""
    if isinstance(idx, int) and 0 <= idx < len(data):
        return data[idx]
    return idx


def deref_dict(d, data):
    """Dereference one level of a dict — resolve int values to data[int]."""
    if not isinstance(d, dict):
        return d
    return {k: deref(v, data) if isinstance(v, int) else v for k, v in d.items()}


def parse_sveltekit_response(text, params):
    """Parse SvelteKit streamed/deferred response into FlightResult[].

    SvelteKit uses a compact indexed format where values reference positions
    in a flat data array. The structure is:
      - data[0] = keymap (column names -> indices)
      - data[N] = actual values, which may be ints referencing other indices
      - solutions is a dict like {REFUNDABLE_FIRST: <fare>, REFUNDABLE_MAIN: <fare>}
      - segments is a list of segment indices
      - carrier uses 'carrierCode' and 'flightNumber' (not 'code')
    """
    results = []
    lines = text.strip().split('\n')

    for line_text in lines:
        try:
            chunk = json.loads(line_text)
        except (json.JSONDecodeError, ValueError):
            continue

        if chunk.get("type") != "chunk":
            continue

        data = chunk.get("data", [])
        if not isinstance(data, list) or len(data) == 0:
            continue

        keymap = data[0] if isinstance(data[0], dict) else {}

        # Look for the flight results chunk (has 'rows' key)
        if "rows" not in keymap:
            continue

        rows_idx = keymap.get("rows")
        if not isinstance(rows_idx, int) or rows_idx >= len(data):
            continue

        rows_list = data[rows_idx]
        if not isinstance(rows_list, list):
            continue

        log(f"Found {len(rows_list)} flight rows in SvelteKit data")

        for row_ref in rows_list:
            try:
                # row_ref is an int pointing to data[row_ref] which is a dict of field->index
                if not isinstance(row_ref, int) or row_ref >= len(data):
                    continue
                row_raw = data[row_ref]
                if not isinstance(row_raw, dict):
                    continue

                # Surgically dereference only the fields we need
                origin_val = deref(row_raw.get('origin', 0), data)
                dest_val = deref(row_raw.get('destination', 0), data)
                duration_mins = deref(row_raw.get('duration', 0), data)
                if not isinstance(duration_mins, (int, float)):
                    duration_mins = 0

                # Segments: data[row.segments] is a list of int indices
                seg_list_ref = row_raw.get('segments')
                seg_indices = deref(seg_list_ref, data)
                if not isinstance(seg_indices, list) or not seg_indices:
                    continue

                # Resolve each segment: deref index, then deref its carrier dict
                segments = []
                for seg_idx in seg_indices:
                    seg_raw = deref(seg_idx, data)
                    if isinstance(seg_raw, dict):
                        seg = deref_dict(seg_raw, data)
                        # Also deref the carrier sub-dicts
                        for key in ('publishingCarrier', 'displayCarrier'):
                            if isinstance(seg.get(key), dict):
                                seg[key] = deref_dict(seg[key], data)
                        segments.append(seg)

                stops = len(segments) - 1
                first_seg = segments[0] if segments else {}
                last_seg = segments[-1] if segments else {}

                dep_time = first_seg.get('departureTime', '')
                arr_time = last_seg.get('arrivalTime', '')

                # Format ISO times
                def fmt_time(iso):
                    if not iso or not isinstance(iso, str):
                        return ''
                    try:
                        dt = datetime.fromisoformat(iso)
                        return dt.strftime('%I:%M %p').lstrip('0')
                    except Exception:
                        return iso

                # Get carrier info
                carrier = first_seg.get('publishingCarrier', {})
                if not isinstance(carrier, dict):
                    carrier = {}
                airline_code = carrier.get('carrierCode', 'AS')
                carrier_name = carrier.get('carrierFullName', 'Alaska Airlines')

                # Build flight numbers
                flight_numbers = []
                operating_airlines = []
                for seg in segments:
                    pc = seg.get('publishingCarrier', {})
                    if isinstance(pc, dict):
                        code = pc.get('carrierCode', 'AS')
                        fn = pc.get('flightNumber', '')
                        if isinstance(fn, (int, float)):
                            flight_numbers.append(f"{code}{int(fn)}")
                        elif isinstance(fn, str) and fn:
                            flight_numbers.append(f"{code}{fn}")
                    op_disc = seg.get('operationalDisclosure', '')
                    if isinstance(op_disc, str) and op_disc and op_disc not in operating_airlines:
                        operating_airlines.append(op_disc)

                flight_number_str = '/'.join(flight_numbers)

                # Solutions: data[row.solutions] is a dict like {REFUNDABLE_FIRST: idx, ...}
                sol_ref = row_raw.get('solutions')
                solutions_raw = deref(sol_ref, data)
                if not isinstance(solutions_raw, dict):
                    continue

                for fare_type, fare_ref in solutions_raw.items():
                    fare_raw = deref(fare_ref, data)
                    if not isinstance(fare_raw, dict):
                        continue
                    # Deref fare fields one level
                    fare = deref_dict(fare_raw, data)

                    miles = fare.get('atmosPoints', 0)
                    if not isinstance(miles, (int, float)) or not miles:
                        continue

                    cash = fare.get('grandTotal', 0)
                    if not isinstance(cash, (int, float)):
                        cash = 0
                    seats = fare.get('seatsRemaining', 0)
                    if not isinstance(seats, (int, float)):
                        seats = 0
                    is_discounted = fare.get('isDiscounted', False)

                    # Cabins: may be a list of strings or indices
                    cabins_raw = fare.get('cabins', [])
                    if isinstance(cabins_raw, list) and cabins_raw:
                        cabin_str = cabins_raw[0] if isinstance(cabins_raw[0], str) else deref(cabins_raw[0], data)
                    else:
                        cabin_str = 'COACH'

                    if not isinstance(cabin_str, str):
                        cabin_str = 'COACH'

                    # Map Alaska cabin names to our schema from the ACTUAL fare
                    # cabin, independent of the requested cabin. The daemon passes
                    # a single cabin per search but wants all cabins back (it
                    # filters by signup downstream) — filtering here silently
                    # dropped economy/first the user was watching.
                    # CabinCode is economy|business|first; premium economy folds
                    # into the economy bucket (house convention) but keeps its real
                    # label in cabin_display.
                    cabin_upper = cabin_str.upper()
                    cabin_display = None
                    if 'FIRST' in cabin_upper:
                        cabin = 'first'
                    elif 'BUSINESS' in cabin_upper:
                        cabin = 'business'
                    elif 'PREMIUM' in cabin_upper:
                        cabin = 'economy'
                        cabin_display = 'Premium Economy'
                    else:
                        cabin = 'economy'

                    results.append({
                        'source': 'alaska-airlines',
                        'airline': carrier_name if isinstance(carrier_name, str) else 'Alaska Airlines',
                        'flightNumber': flight_number_str,
                        'origin': origin_val if isinstance(origin_val, str) else params['origin'],
                        'destination': dest_val if isinstance(dest_val, str) else params['destination'],
                        'departureDate': params['date'],
                        'departureTime': fmt_time(dep_time),
                        'arrivalTime': fmt_time(arr_time),
                        'duration': f"{int(duration_mins) // 60}h {int(duration_mins) % 60}m" if duration_mins else '',
                        'stops': stops,
                        'cabin': cabin,
                        'cabinDisplay': cabin_display,
                        'pointsRequired': int(miles),
                        'pointsProgram': 'Alaska Mileage Plan',
                        'taxesAndFees': cash,
                        'awardType': 'saver' if is_discounted else 'standard',
                        'availableSeats': int(seats),
                        'scrapedAt': datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                        'bookingUrl': f"https://www.alaskaair.com/shopping/flights?type=award&origin={params['origin']}&destination={params['destination']}&departureDate={params['date']}&pax=1",
                        'metadata': {
                            'operatingAirlines': operating_airlines,
                            'operatingAirlineCode': airline_code if isinstance(airline_code, str) else 'AS',
                            'isDiscounted': is_discounted,
                            'fareType': fare_type,
                            'cabinRaw': cabin_str,
                        },
                    })
            except Exception as e:
                log(f"Error parsing flight row: {e}")
                continue

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
    cabin = params.get("cabin", "economy")

    log(f"Search: {origin}->{destination} {date} {cabin}")

    results = []

    try:
        session, proxy_info = create_session(LABEL)

        # Step 1: Warm cookies
        warm_cookies(session, "https://www.alaskaair.com/", LABEL)
        time.sleep(1)

        # Step 2: Submit search via Shop endpoint
        form_date = format_date_mmddyyyy(date)
        alaska_cabin = CABIN_MAP.get(cabin, 'coach')

        shop_data = {
            "DepartureCity1": origin,
            "ArrivalCity1": destination,
            "DepartureDate1": form_date,
            "IsAward": "true",
            "IsOneWay": "true",
            "IsRoundTrip": "false",
            "AdultCount": "1",
            "ChildCount": "0",
            "LapChildCount": "0",
            "Cabin": alaska_cabin,
            "ShopAllAwards": "true",
            "FareType": "Award",
            "IsAwardReservation": "true",
            "awardOption": "MilesOnly",
        }

        log("Submitting search...")
        shop_resp = session.post(
            "https://www.alaskaair.com/Shopping/Flights/Shop",
            data=shop_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.alaskaair.com",
                "Referer": "https://www.alaskaair.com/planbook/shoppingstart",
            },
            timeout=45,
            allow_redirects=False,
        )

        redirect_url = shop_resp.headers.get("location", "")
        log(f"Shop: HTTP {shop_resp.status_code}, redirect: {redirect_url[:80]}")

        if not redirect_url or shop_resp.status_code != 302:
            log("No redirect from Shop — search may have failed")
            # Try direct __data.json approach
            redirect_url = f"/search/results?A=1&C=0&L=0&O={origin}&D={destination}&OD={date}&RT=false&ShopAllAwards=true&ShoppingMethod=onlineaward"
            log(f"Trying direct: {redirect_url}")

        # Step 3: Fetch results via SvelteKit __data.json
        if "?" in redirect_url:
            base_path = redirect_url.split('?')[0]
            query = redirect_url.split('?')[1]
            data_url = f"https://www.alaskaair.com{base_path}/__data.json?{query}"
        else:
            data_url = f"https://www.alaskaair.com{redirect_url}/__data.json"

        import random
        delay = random.uniform(1, 2)
        log(f"Waiting {delay:.1f}s before fetching results...")
        time.sleep(delay)

        log(f"Fetching __data.json...")
        data_resp = session.get(
            data_url,
            headers={
                "Accept": "*/*",
                "Referer": f"https://www.alaskaair.com{redirect_url}",
            },
            timeout=60,
        )

        log(f"Results: HTTP {data_resp.status_code} ({len(data_resp.text)} bytes)")

        if data_resp.status_code == 200:
            results = parse_sveltekit_response(data_resp.text, params)
            log(f"Parsed {len(results)} results")
        elif data_resp.status_code in (403, 429):
            log(f"Blocked: HTTP {data_resp.status_code}")
            sys.exit(1)
        else:
            log(f"Unexpected: HTTP {data_resp.status_code}")
            log(f"Body: {data_resp.text[:300]}")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
