#!/usr/bin/env python3
"""
Delta Award Search via Virgin Atlantic (Camoufox).

Virgin Atlantic's website shows SkyTeam partner award availability including
Delta-operated flights, bookable with Flying Club points. This bypasses
Delta.com's Shape Security bot protection entirely.

Usage:
  python3 delta-va-camoufox.py '{"origin":"JFK","destination":"LAX","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os

def log(msg):
    print(f"[Delta-VA {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

AIRLINE_NAMES = {
    'DL': 'Delta', 'AF': 'Air France', 'KL': 'KLM', 'KE': 'Korean Air',
    'VS': 'Virgin Atlantic', 'CI': 'China Airlines', 'AM': 'Aeromexico',
    'GA': 'Garuda Indonesia', 'MU': 'China Eastern', 'SV': 'Saudi Arabian Airlines',
    'VN': 'Vietnam Airlines', 'OK': 'Czech Airlines', 'RO': 'TAROM',
    'ME': 'MEA', 'AR': 'Aerolineas Argentinas',
}

def build_search_url(origin, destination, date, cabin):
    cabin_map = {'economy': 'economy', 'business': 'upper', 'first': 'first'}
    va_cabin = cabin_map.get(cabin, 'upper')
    return (
        f"https://www.virginatlantic.com/flights/search/results"
        f"?origin={origin}&destination={destination}&departure={date}"
        f"&ADT=1&cabin={va_cabin}&tripType=ONE_WAY&awardSearch=true"
    )

def parse_duration(dur):
    """Parse ISO 8601 duration like PT13H25M."""
    if not dur:
        return ''
    import re
    m = re.match(r'PT(\d+)H(?:(\d+)M)?', dur)
    if m:
        return f"{m.group(1)}h {m.group(2) or '0'}m"
    return dur

def format_time(iso_str):
    """Format ISO datetime to HH:MM AM/PM."""
    if not iso_str:
        return ''
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%I:%M %p').lstrip('0')
    except:
        return iso_str

def parse_graphql_response(data, params):
    """Parse VA GraphQL SearchOffers response into FlightResult objects."""
    results = []
    try:
        flights_and_fares = (
            data.get('data', {})
            .get('searchOffers', {})
            .get('result', {})
            .get('slice', {})
            .get('flightsAndFares', [])
        )
    except (AttributeError, TypeError):
        return results

    for ff in flights_and_fares:
        flight = ff.get('flight', {})
        segments = flight.get('segments', [])
        if not segments:
            continue

        first_seg = segments[0]
        airline_code = (first_seg.get('operatingAirline') or first_seg.get('airline', {})).get('code', 'VS')
        airline_name = AIRLINE_NAMES.get(airline_code, airline_code)

        flight_numbers = '/'.join(
            f"{s.get('airline', {}).get('code', '')}{s.get('flightNumber', '')}"
            for s in segments
        )

        operating_airlines = [
            s.get('operatingAirline', {}).get('name', '')
            for s in segments if s.get('operatingAirline', {}).get('name')
        ]

        for fare in ff.get('fares', []):
            if not fare.get('available') or fare.get('availability') == 'SOLD_OUT':
                continue

            cabin_name = (fare.get('fareSegments', [{}])[0].get('cabinName', '') or '').lower()
            family = (fare.get('fareFamilyType', '') or '').upper()

            if 'upper' in cabin_name or 'business' in cabin_name or 'BUSINESS' in family:
                cabin = 'business'
            elif 'first' in cabin_name or 'FIRST' in family:
                cabin = 'first'
            else:
                cabin = 'economy'

            # Filter to requested cabin
            if cabin != params.get('cabin', 'business'):
                continue

            is_saver = fare.get('isSaverFare', False) or any(
                fs.get('isSaverFare', False) for fs in fare.get('fareSegments', [])
            )

            price = fare.get('price', {})
            results.append({
                'source': 'virgin-atlantic',
                'airline': airline_name,
                'flightNumber': flight_numbers,
                'origin': flight.get('origin', {}).get('code', params['origin']),
                'destination': flight.get('destination', {}).get('code', params['destination']),
                'departureDate': params['date'],
                'departureTime': format_time(flight.get('departure', '')),
                'arrivalTime': format_time(flight.get('arrival', '')),
                'duration': parse_duration(flight.get('duration', '')),
                'stops': len(segments) - 1,
                'cabin': cabin,
                'pointsRequired': price.get('awardPoints', 0),
                'pointsProgram': 'Virgin Atlantic Flying Club',
                'taxesAndFees': price.get('tax', 0),
                'awardType': 'saver' if is_saver else 'partner',
                'availableSeats': fare.get('availableSeatCount', 0),
                'scrapedAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
                'bookingUrl': build_search_url(params['origin'], params['destination'], params['date'], params.get('cabin', 'business')),
                'metadata': {
                    'operatingAirlines': operating_airlines,
                    'operatingAirlineCode': airline_code,
                    'isSaver': is_saver,
                    'fareFamilyType': fare.get('fareFamilyType', ''),
                },
            })

    return results


def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")

    log(f"Search: {origin}→{destination} {date} {cabin}")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []

    try:
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()

            # Warm cookies on VA homepage
            log("Warming cookies on virginatlantic.com...")
            try:
                page.goto("https://www.virginatlantic.com/", timeout=30000)
                time.sleep(random.uniform(2, 4))
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                time.sleep(random.uniform(1, 2))
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Accept cookie consent if present
            try:
                consent = page.query_selector('#onetrust-accept-btn-handler')
                if consent:
                    consent.click()
                    time.sleep(1)
                    log("Accepted cookie consent")
            except:
                pass

            cookies = page.context.cookies()
            akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
            log(f"Cookies: {len(cookies)} total, {len(akamai)} Akamai")

            # Set up response interception for GraphQL
            graphql_responses = []

            def handle_response(response):
                url = response.url
                if 'graphql' in url and 'search' in url.lower():
                    try:
                        data = response.json()
                        if data and 'data' in data and 'searchOffers' in (data.get('data') or {}):
                            graphql_responses.append(data)
                            log(f"Captured GraphQL SearchOffers response")
                    except:
                        pass

            page.on("response", handle_response)

            # Navigate to search results
            search_url = build_search_url(origin, destination, date, cabin)
            log(f"Navigating to search: {search_url}")

            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation error (checking page): {e}")

            # Wait for results to load
            time.sleep(random.uniform(3, 5))

            # Check for cookie consent again on results page
            try:
                consent = page.query_selector('#onetrust-accept-btn-handler')
                if consent and consent.is_visible():
                    consent.click()
                    time.sleep(1)
            except:
                pass

            # Wait for flight results or GraphQL response
            log("Waiting for results...")
            for i in range(12):  # Up to ~36 seconds
                if graphql_responses:
                    break
                time.sleep(3)
                # Check for error states
                content = page.content().lower()
                if 'no availability' in content or 'no flights' in content:
                    log("No availability found")
                    break
                if 'captcha' in content or 'access denied' in content:
                    log("Blocked by bot detection")
                    break

            # Parse intercepted responses
            if graphql_responses:
                log(f"Parsing {len(graphql_responses)} GraphQL responses")
                for resp in graphql_responses:
                    results.extend(parse_graphql_response(resp, params))
            else:
                # Try direct GraphQL call using page's session
                log("No intercepted responses, trying direct GraphQL call...")
                try:
                    graphql_payload = {
                        "operationName": "SearchOffers",
                        "variables": {
                            "request": {
                                "pos": None,
                                "parties": None,
                                "flightSearchRequest": {
                                    "searchOriginDestinations": [{
                                        "origin": origin,
                                        "destination": destination,
                                        "departureDate": date,
                                    }],
                                    "bundleOffer": False,
                                    "awardSearch": True,
                                    "calendarSearch": False,
                                    "flexiDateSearch": False,
                                    "nonStopOnly": False,
                                    "currentTripIndexId": "0",
                                    "checkInBaggageAllowance": False,
                                    "carryOnBaggageAllowance": False,
                                    "refundableOnly": False,
                                },
                                "customerDetails": [{"custId": "ADT_0", "ptc": "ADT"}],
                            }
                        },
                        "query": """query SearchOffers($request: FlightOfferRequestInput!) {
  searchOffers(request: $request) {
    result {
      slice {
        flightsAndFares {
          flight {
            segments {
              airline { code name }
              flightNumber
              operatingAirline { code name }
              origin { code }
              destination { code }
              duration
              departure
              arrival
              stopCount
              bookingClass
            }
            duration
            origin { code }
            destination { code }
            departure
            arrival
          }
          fares {
            availability
            id
            price { awardPoints tax amountIncludingTax currency }
            fareSegments { cabinName bookingClass isSaverFare }
            available
            fareFamilyType
            availableSeatCount
            isSaverFare
          }
        }
      }
    }
  }
}"""
                    }

                    api_result = page.evaluate("""(payload) => {
                        return fetch('/flights/search/api/graphql', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                        }).then(r => r.json());
                    }""", graphql_payload)

                    if api_result and 'data' in api_result:
                        results = parse_graphql_response(api_result, params)
                        log(f"Direct GraphQL returned {len(results)} results")
                except Exception as e:
                    log(f"Direct GraphQL call failed: {e}")

            # If still no results, check page state
            if not results:
                content = page.content()
                if 'no availability' in content.lower():
                    log("Confirmed: no award availability")
                elif len(content) < 5000:
                    log(f"Page seems empty/blocked (length={len(content)})")
                else:
                    log(f"Could not parse results (page length={len(content)})")

            log(f"Found {len(results)} results total")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))

if __name__ == "__main__":
    main()
