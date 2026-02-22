#!/usr/bin/env python3
"""
Delta Award Search via Virgin Atlantic GraphQL API (curl_cffi).

Uses curl_cffi to impersonate Chrome 131's TLS/JA3/HTTP2 fingerprints,
bypassing Akamai bot detection at the network level without needing a browser.

Flow:
  1. Warm cookies on virginatlantic.com homepage
  2. POST GraphQL SearchOffers query to /flights/search/api/graphql
  3. Parse response into FlightResult[] JSON

Usage:
  python3 delta-va-curlffi.py '{"origin":"JFK","destination":"LHR","date":"2026-03-22","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import re
import os
from datetime import datetime, timezone

# Import shared utilities
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log, validate_params, create_session, warm_cookies

LABEL = "DeltaVA-CurlFfi"

def log(msg):
    _log(LABEL, msg)


AIRLINE_NAMES = {
    'DL': 'Delta', 'AF': 'Air France', 'KL': 'KLM', 'KE': 'Korean Air',
    'VS': 'Virgin Atlantic', 'CI': 'China Airlines', 'AM': 'Aeromexico',
    'GA': 'Garuda Indonesia', 'MU': 'China Eastern', 'SV': 'Saudi Arabian Airlines',
    'VN': 'Vietnam Airlines', 'OK': 'Czech Airlines', 'RO': 'TAROM',
    'ME': 'MEA', 'AR': 'Aerolineas Argentinas',
}

GRAPHQL_QUERY = """query SearchOffers($request: FlightOfferRequestInput!) {
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
              duration departure arrival
            }
            duration origin { code } destination { code } departure arrival
          }
          fares {
            availability
            price { awardPoints tax amountIncludingTax currency }
            fareSegments { cabinName bookingClass isSaverFare }
            available fareFamilyType availableSeatCount isSaverFare
          }
        }
      }
    }
  }
}"""


def build_search_url(origin, destination, date, cabin):
    cabin_map = {'economy': 'economy', 'business': 'upper', 'first': 'first'}
    va_cabin = cabin_map.get(cabin, 'upper')
    return (
        f"https://www.virginatlantic.com/flight-search/book-a-flight"
        f"?origin={origin}&destination={destination}&departure={date}"
        f"&ADT=1&cabin={va_cabin}&tripType=ONE_WAY&awardSearch=true"
    )


def build_graphql_payload(origin, destination, date):
    return {
        "operationName": "SearchOffers",
        "variables": {
            "request": {
                "pos": None,
                "parties": None,
                "flightSearchRequest": {
                    "searchOriginDestinations": [
                        {
                            "origin": origin,
                            "destination": destination,
                            "departureDate": date,
                        },
                    ],
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
                "customerDetails": [
                    {"custId": "ADT_0", "ptc": "ADT"},
                ],
            },
        },
        "query": GRAPHQL_QUERY,
    }


def parse_duration(dur):
    if not dur:
        return ''
    m = re.match(r'PT(\d+)H(?:(\d+)M)?', dur)
    if m:
        return f"{m.group(1)}h {m.group(2) or '0'}m"
    return dur


def format_time(iso_str):
    if not iso_str:
        return ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%I:%M %p').lstrip('0')
    except Exception:
        return iso_str


def parse_graphql_response(data, params):
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
            s.get('flightNumber', '') for s in segments
        )

        operating_airlines = [
            s.get('operatingAirline', {}).get('name', '')
            for s in segments if s.get('operatingAirline', {}).get('name')
        ]

        for fare in ff.get('fares', []):
            if fare.get('availability') == 'SOLD_OUT':
                continue

            cabin_name = (fare.get('fareSegments', [{}])[0].get('cabinName', '') or '').lower()
            family = (fare.get('fareFamilyType', '') or '').upper()

            if 'upper' in cabin_name or 'business' in cabin_name or 'BUSINESS' in family:
                cabin = 'business'
            elif 'first' in cabin_name or 'FIRST' in family:
                cabin = 'first'
            else:
                cabin = 'economy'

            if cabin != params.get('cabin', 'business'):
                continue

            is_saver = fare.get('isSaverFare', False) or any(
                fs.get('isSaverFare', False) for fs in fare.get('fareSegments', [])
            )

            price = fare.get('price', {})
            points = price.get('awardPoints', 0)
            if isinstance(points, str):
                points = int(points) if points.isdigit() else 0

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
                'pointsRequired': points,
                'pointsProgram': 'Virgin Atlantic Flying Club',
                'taxesAndFees': price.get('tax', 0),
                'awardType': 'saver' if is_saver else 'partner',
                'availableSeats': fare.get('availableSeatCount', 0),
                'scrapedAt': datetime.now(tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                'bookingUrl': build_search_url(params['origin'], params['destination'], params['date'], params.get('cabin', 'business')),
                'metadata': {
                    'operatingAirlines': operating_airlines,
                    'operatingAirlineCode': airline_code,
                    'isSaver': is_saver,
                    'fareFamilyType': fare.get('fareFamilyType', ''),
                },
            })

    return results


def va_login(session, email, password):
    """Login to Virgin Atlantic Flying Club via Azure AD B2C identity provider.

    Flow:
      1. GET /flying-club/account/overview — redirects to identity.virginatlantic.com
      2. Extract SETTINGS (csrf, transId, tenant path, policy) from login page
      3. POST credentials to SelfAsserted endpoint
      4. GET confirmed endpoint — returns form with id_token
      5. POST id_token + state to VA callback URL

    Returns True on success.
    """
    log("Attempting VA Flying Club login...")
    identity_base = "https://identity.virginatlantic.com"

    try:
        # Step 1: Navigate to Flying Club — redirects to Azure AD B2C login page
        resp = session.get(
            "https://www.virginatlantic.com/flying-club/account/overview",
            timeout=15,
            allow_redirects=True,
        )
        log(f"Login page: HTTP {resp.status_code}, URL: {resp.url[:100]}")

        if "identity.virginatlantic.com" not in resp.url:
            log("Not redirected to identity provider")
            return False

        # Step 2: Extract SETTINGS from the login page JavaScript
        settings_match = re.search(r'var\s+SETTINGS\s*=\s*(\{[^;]+?\});', resp.text, re.DOTALL)
        if not settings_match:
            log(f"No SETTINGS found in login page ({len(resp.text)} bytes)")
            return False

        settings = json.loads(settings_match.group(1))
        csrf = settings.get("csrf", "")
        trans_id = settings.get("transId", "")
        tenant_path = settings.get("hosts", {}).get("tenant", "")
        policy = settings.get("hosts", {}).get("policy", "")

        if not csrf or not trans_id or not tenant_path:
            log(f"Missing login params: csrf={bool(csrf)}, tx={bool(trans_id)}, tenant={bool(tenant_path)}")
            return False

        log(f"Got CSRF ({len(csrf)} chars), tenant: {tenant_path}, policy: {policy}")

        # Step 3: POST credentials to SelfAsserted
        self_assert_url = f"{identity_base}{tenant_path}/SelfAsserted?tx={trans_id}&p={policy}"
        login_resp = session.post(
            self_assert_url,
            data={
                "signInName": email,
                "password": password,
                "request_type": "RESPONSE",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-CSRF-TOKEN": csrf,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": identity_base,
                "Referer": resp.url,
            },
            timeout=15,
            allow_redirects=False,
        )
        log(f"Login POST: HTTP {login_resp.status_code}, Body: {login_resp.text[:100]}")

        if login_resp.status_code != 200:
            log(f"Login POST failed: HTTP {login_resp.status_code}")
            return False

        try:
            result = login_resp.json()
            if result.get("status") != "200":
                msg = result.get("message", str(result)[:200])
                log(f"Login rejected: {msg}")
                return False
        except json.JSONDecodeError:
            log(f"Login response not JSON: {login_resp.text[:200]}")
            return False

        log("Credentials accepted, completing OAuth flow...")

        # Step 4: GET confirmed endpoint — returns HTML form with id_token
        confirmed_url = (
            f"{identity_base}{tenant_path}/api/CombinedSigninAndSignup/confirmed"
            f"?rememberMe=false&csrf_token={csrf}&tx={trans_id}&p={policy}"
        )
        conf_resp = session.get(
            confirmed_url,
            headers={"Referer": resp.url},
            timeout=15,
            allow_redirects=False,
        )
        log(f"Confirmed: HTTP {conf_resp.status_code} ({len(conf_resp.text)} bytes)")

        if conf_resp.status_code != 200 or "<form" not in conf_resp.text:
            log("Confirmed response has no form — login flow incomplete")
            return False

        # Step 5: Extract id_token + state and POST to VA callback
        id_token_m = re.search(r"name=['\"]id_token['\"]\s+[^>]*value=['\"]([^\"']+)['\"]", conf_resp.text)
        state_m = re.search(r"name=['\"]state['\"]\s+[^>]*value=['\"]([^\"']+)['\"]", conf_resp.text)
        action_m = re.search(r"action=['\"]([^\"']+)['\"]", conf_resp.text)

        if not id_token_m or not action_m:
            log("Missing id_token or action in confirmed form")
            return False

        form_data = {"id_token": id_token_m.group(1)}
        if state_m:
            form_data["state"] = state_m.group(1)

        cb_resp = session.post(
            action_m.group(1),
            data=form_data,
            timeout=15,
            allow_redirects=True,
        )
        log(f"Callback: HTTP {cb_resp.status_code}, URL: {cb_resp.url[:100]}")

        if "virginatlantic.com" in cb_resp.url and "identity" not in cb_resp.url:
            log(f"Login successful! Cookies: {len(session.cookies)}")
            return True

        log(f"Login flow ended at unexpected URL: {cb_resp.url[:100]}")
        return False

    except Exception as e:
        log(f"Login error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

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

    va_email = os.environ.get("VA_EMAIL", "")
    va_password = os.environ.get("VA_PASSWORD", "")

    log(f"Search: {origin}->{destination} {date} {cabin}")

    results = []

    try:
        session, proxy_info = create_session(LABEL)

        # Step 1: Warm cookies on VA homepage
        cookie_count = warm_cookies(session, "https://www.virginatlantic.com/", LABEL)
        if cookie_count < 3:
            log("Few cookies — may be blocked, but continuing")

        time.sleep(1)

        # Step 2: Login to VA Flying Club (required for award search)
        logged_in = False
        if va_email and va_password:
            logged_in = va_login(session, va_email, va_password)
        else:
            log("No VA_EMAIL/VA_PASSWORD — trying without login")

        # Step 3: POST GraphQL query (with retry for rate limiting)
        search_url = build_search_url(origin, destination, date, cabin)
        payload = build_graphql_payload(origin, destination, date)

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": "https://www.virginatlantic.com",
            "Referer": search_url,
        }

        # Delay after login to avoid rate limiting
        import random
        delay = random.uniform(2, 4)
        log(f"Waiting {delay:.1f}s before GraphQL request...")
        time.sleep(delay)

        for gql_attempt in range(2):
            if gql_attempt > 0:
                retry_delay = random.uniform(3, 6)
                log(f"Retrying GraphQL in {retry_delay:.1f}s...")
                time.sleep(retry_delay)

            log(f"Sending GraphQL request (attempt {gql_attempt + 1})...")
            resp = session.post(
                "https://www.virginatlantic.com/flights/search/api/graphql",
                json=payload,
                headers=headers,
                timeout=20,
            )

            log(f"Response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

            if resp.status_code == 200:
                try:
                    data = resp.json()
                    if "errors" in data:
                        errors = data.get("errors", [])
                        err_msg = errors[0].get("message", "") if errors else ""
                        log(f"GraphQL errors: {json.dumps(errors)[:300]}")
                        if "logged in" in err_msg.lower() and not logged_in:
                            log("Award search requires login — set VA_EMAIL and VA_PASSWORD env vars")
                    else:
                        results = parse_graphql_response(data, params)
                        log(f"Parsed {len(results)} results")
                except json.JSONDecodeError:
                    log(f"Response not JSON: {resp.text[:200]}")
                break
            elif resp.status_code == 429:
                log("Rate limited (429) — will retry")
                continue
            elif resp.status_code in (403, 444):
                log(f"Blocked (HTTP {resp.status_code}) — Akamai rejected request")
                sys.exit(1)
            else:
                log(f"Unexpected status: {resp.status_code}")
                log(f"Body: {resp.text[:300]}")
                sys.exit(1)

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
