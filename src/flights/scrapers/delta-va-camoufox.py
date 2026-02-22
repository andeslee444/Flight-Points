#!/usr/bin/env python3
"""
Delta Award Search via Virgin Atlantic (Playwright).

Virgin Atlantic's website shows SkyTeam partner award availability including
Delta-operated flights, bookable with Flying Club points. This bypasses
Delta.com's Shape Security bot protection entirely.

Uses Playwright (not Camoufox) because VA's React SPA requires Chromium to render.
Logs into Flying Club first (required for award search), then calls the GraphQL API.

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
import re
from datetime import datetime
from urllib.parse import urlparse

def log(msg):
    print(f"[Delta-VA {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def validate_params(params):
    """Validate search params to prevent malformed input."""
    for field in ("origin", "destination", "date"):
        if field not in params or not isinstance(params[field], str):
            raise ValueError(f"Missing or invalid field: {field}")
    if not re.match(r'^[A-Z]{3}$', params["origin"]):
        raise ValueError(f"Invalid origin airport code: {params['origin']}")
    if not re.match(r'^[A-Z]{3}$', params["destination"]):
        raise ValueError(f"Invalid destination airport code: {params['destination']}")
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', params["date"]):
        raise ValueError(f"Invalid date format: {params['date']}")

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
    # VA moved search from /flights/search/results to /flight-search/book-a-flight (2026-02-20)
    return (
        f"https://www.virginatlantic.com/flight-search/book-a-flight"
        f"?origin={origin}&destination={destination}&departure={date}"
        f"&ADT=1&cabin={va_cabin}&tripType=ONE_WAY&awardSearch=true"
    )

def parse_duration(dur):
    """Parse ISO 8601 duration like PT13H25M."""
    if not dur:
        return ''
    m = re.match(r'PT(\d+)H(?:(\d+)M)?', dur)
    if m:
        return f"{m.group(1)}h {m.group(2) or '0'}m"
    return dur

def format_time(iso_str):
    """Format ISO datetime to HH:MM AM/PM."""
    if not iso_str:
        return ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.strftime('%I:%M %p').lstrip('0')
    except Exception:
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
            s.get('flightNumber', '') for s in segments
        )

        operating_airlines = [
            s.get('operatingAirline', {}).get('name', '')
            for s in segments if s.get('operatingAirline', {}).get('name')
        ]

        for fare in ff.get('fares', []):
            # VA returns available=null for available fares (not false)
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

            # Filter to requested cabin
            if cabin != params.get('cabin', 'business'):
                continue

            is_saver = fare.get('isSaverFare', False) or any(
                fs.get('isSaverFare', False) for fs in fare.get('fareSegments', [])
            )

            price = fare.get('price', {})
            points = price.get('awardPoints', 0)
            # awardPoints can be a string like "130000"
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
                'scrapedAt': datetime.utcnow().isoformat() + 'Z',
                'bookingUrl': build_search_url(params['origin'], params['destination'], params['date'], params.get('cabin', 'business')),
                'metadata': {
                    'operatingAirlines': operating_airlines,
                    'operatingAirlineCode': airline_code,
                    'isSaver': is_saver,
                    'fareFamilyType': fare.get('fareFamilyType', ''),
                },
            })

    return results


def va_login(page, email, password):
    """Login to VA Flying Club via identity.virginatlantic.com. Returns True on success."""
    try:
        # Strategy: Extract the login URL directly from the DOM and navigate to it.
        # This bypasses the blanket overlay that intercepts pointer events on the dropdown menu.
        log("Extracting login URL from page...")
        login_url = page.evaluate("""() => {
            const links = document.querySelectorAll('a[href*="identity.virginatlantic.com"]');
            for (const a of links) {
                if (a.href && a.href.includes('oauth2')) return a.href;
            }
            // Fallback: look in the dropdown menu items
            const menuLinks = document.querySelectorAll('a[role="link"]');
            for (const a of menuLinks) {
                if (a.href && a.href.includes('identity')) return a.href;
            }
            return null;
        }""")

        if login_url:
            log(f"Found login URL, navigating directly...")
            try:
                page.goto(login_url, timeout=30000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Login URL navigation: {e}")
        else:
            # Fallback: click through the menu (may hit blanket overlay)
            log("No login URL found, trying click approach...")
            page.locator('button:has-text("Log in")').first.click(timeout=10000)
            time.sleep(2)

            # Remove any blanket overlay that intercepts pointer events
            page.evaluate("""() => {
                document.querySelectorAll('[class*="blanket"]').forEach(b => b.remove());
            }""")
            time.sleep(0.5)

            try:
                page.locator('a:has-text("Log in")').first.click(timeout=30000)
            except Exception as e:
                log(f"Login link click/navigation: {e}")

        time.sleep(5)

        if "identity" not in page.url.lower():
            time.sleep(5)
            if "identity" not in page.url.lower():
                log(f"Not on login page: {page.url[:100]}")
                return False

        log(f"On login page: {page.url[:80]}")

        try:
            page.wait_for_selector("#signInName", state="visible", timeout=15000)
        except:
            log("signInName input not visible")
            return False

        log("Filling credentials...")
        email_input = page.locator("#signInName")
        email_input.click()
        time.sleep(0.3)
        email_input.fill("")
        time.sleep(0.2)
        email_input.type(email, delay=random.randint(30, 80))
        time.sleep(random.uniform(0.5, 1.0))

        pwd_input = page.locator("#password")
        pwd_input.click()
        time.sleep(0.3)
        pwd_input.fill("")
        time.sleep(0.2)
        pwd_input.type(password, delay=random.randint(30, 80))
        time.sleep(random.uniform(0.5, 1.0))

        typed_email = page.evaluate('() => document.getElementById("signInName")?.value || ""')
        typed_pwd_len = page.evaluate('() => (document.getElementById("password")?.value || "").length')
        log(f"Filled email: {typed_email}, pwd len: {typed_pwd_len}")

        submitted = False
        try:
            submit_btn = page.locator('#next')
            if submit_btn.count() > 0 and submit_btn.is_visible(timeout=2000):
                submit_btn.click()
                submitted = True
                log("Clicked #next submit button")
        except:
            pass

        if not submitted:
            try:
                page.locator('button:has-text("Continue")').first.click(timeout=3000)
                submitted = True
                log("Clicked Continue button")
            except:
                pass

        if not submitted:
            pwd_input.press("Enter")
            log("Pressed Enter on password field")

        time.sleep(12)

        current_url = page.url.lower()
        body = page.evaluate("() => document.body ? document.body.innerText.substring(0, 500) : ''")

        if "Hello" in body or "hello" in body.lower()[:50]:
            log(f"Login successful! URL: {page.url[:100]}")
            return True
        elif "virginatlantic.com" in current_url and "identity" not in current_url:
            log(f"Redirected to VA site (login likely succeeded): {page.url[:100]}")
            return True
        else:
            if "can't seem to find" in body.lower() or "incorrect" in body.lower():
                log(f"Login credentials rejected: {body[:150]}")
            else:
                log(f"Login may have failed. URL: {page.url[:80]}, Body: {body[:150]}")
            return False
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

    va_email = os.environ.get("VA_EMAIL", "")
    va_password = os.environ.get("VA_PASSWORD", "")
    if not va_email or not va_password:
        log("Missing VA_EMAIL or VA_PASSWORD — required for VA award search")
        print("[]")
        sys.exit(0)

    log(f"Search: {origin}->{destination} {date} {cabin}")

    from playwright.sync_api import sync_playwright

    results = []

    try:
        # Skip HTTP proxy — Bright Data blocks POST (needed for login + GraphQL)
        proxy_url = os.environ.get("PROXY_URL", "")
        proxy_cfg = None
        if proxy_url and proxy_url.startswith("socks"):
            parsed = urlparse(proxy_url)
            server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
            proxy_cfg = {"server": server}
            if parsed.username:
                proxy_cfg["username"] = parsed.username
            if parsed.password:
                proxy_cfg["password"] = parsed.password
            log(f"Using SOCKS5 proxy: {parsed.hostname}:{parsed.port}")
        elif proxy_url:
            log(f"Skipping HTTP proxy (POST requests blocked without KYC)")

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
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

            # Step 1: Load homepage and accept cookies
            log("Loading virginatlantic.com...")
            page.goto("https://www.virginatlantic.com/", timeout=60000, wait_until="domcontentloaded")
            time.sleep(random.uniform(4, 6))

            try:
                btn = page.query_selector("#onetrust-accept-btn-handler")
                if btn and btn.is_visible():
                    btn.click()
                    time.sleep(1)
            except Exception:
                pass

            cookies = context.cookies()
            log(f"Cookies: {len(cookies)}")

            if len(cookies) < 10:
                log("FAIL FAST: Cookie warming failed — exit for retry")
                sys.exit(1)

            # Step 2: Login to Flying Club
            if not va_login(page, va_email, va_password):
                log("Login failed — exit for retry")
                sys.exit(1)

            # Step 3: Navigate to search page and intercept GraphQL response passively.
            # Direct fetch() calls get 429→444 escalation from Akamai.
            search_url = build_search_url(origin, destination, date, cabin)

            graphql_responses = []
            all_api_urls = []

            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                status = response.status
                if status != 200 and status != 204 and status != 304:
                    all_api_urls.append(f"[{status}] {url[:150]}")
                if "json" in ct or "graphql" in url.lower() or "api" in url.lower():
                    all_api_urls.append(f"[{status}] {url[:150]}")
                if "json" in ct and status == 200:
                    try:
                        body = response.text()
                        if len(body) > 500 and any(kw in body.lower() for kw in
                            ['flightsandfares', 'searchoffers', 'awardpoints', 'flight', 'award']):
                            log(f"Intercepted GraphQL: {url[:120]} ({len(body)} bytes)")
                            graphql_responses.append(body)
                    except Exception:
                        pass

            page.on("response", handle_response)

            # Wait after login to appear human
            wait_secs = random.randint(8, 12)
            log(f"Waiting {wait_secs}s after login before searching...")
            time.sleep(wait_secs)

            # Navigate to search URL — the SPA will make its own GraphQL call
            log(f"Navigating to search: {search_url[:120]}")
            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Search page navigation: {str(e)[:100]}")

            time.sleep(3)
            page_url = page.url
            page_text = page.evaluate("() => document.body ? document.body.innerText.substring(0, 500) : ''")
            log(f"Search page: {page_url[:120]}")

            if "access denied" in page_text.lower() or "not have permission" in page_text.lower():
                log("Access Denied on search page — trying direct GraphQL as fallback")
                time.sleep(random.randint(5, 10))

                cabin_map_gql = {'economy': 'ECONOMY', 'business': 'UPPER', 'first': 'FIRST'}
                gql_cabin = cabin_map_gql.get(cabin, 'UPPER')
                gql_payload = json.dumps({
                    "query": GRAPHQL_QUERY,
                    "variables": {
                        "request": {
                            "tripType": "ONE_WAY",
                            "passengers": [{"type": "ADT", "count": 1}],
                            "slices": [{"origin": origin, "destination": destination, "departureDate": date}],
                            "cabin": gql_cabin,
                            "awardSearch": True,
                        }
                    }
                })

                # Navigate back to homepage first (fresh page context for Akamai)
                page.goto("https://www.virginatlantic.com/", timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.randint(3, 6))

                result = page.evaluate("""({payload, referer}) => {
                    return fetch('/flights/search/api/graphql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Accept-Encoding': 'identity',
                            'Referer': referer,
                        },
                        body: payload,
                        credentials: 'include',
                    }).then(r => {
                        if (!r.ok) return { error: r.status + ' ' + r.statusText, status: r.status };
                        return r.text().then(t => ({ ok: true, body: t, status: r.status }));
                    }).catch(e => ({ error: e.message }));
                }""", {"payload": gql_payload, "referer": search_url})

                if result and result.get('ok'):
                    body_text = result.get('body', '')
                    log(f"GraphQL response: {len(body_text)} bytes")
                    try:
                        data = json.loads(body_text)
                        if "errors" not in data:
                            results = parse_graphql_response(data, params)
                            if results:
                                log(f"Found {len(results)} results from direct GraphQL")
                        else:
                            log(f"GraphQL error: {data.get('errors', [{}])[0].get('message', 'unknown')}")
                    except json.JSONDecodeError:
                        log(f"Not JSON: {body_text[:200]}")
                else:
                    err = result.get('error', 'unknown') if result else 'null'
                    log(f"GraphQL call failed: {err}")
            else:
                log(f"Page loaded OK, waiting for SPA GraphQL call...")

            # Wait for the SPA to make GraphQL calls
            if not results:
                for wait_round in range(12):
                    time.sleep(5)
                    if graphql_responses:
                        log(f"Got {len(graphql_responses)} intercepted response(s) after {(wait_round+1)*5}s")
                        break
                    if wait_round == 5:
                        log("Still waiting for GraphQL response...")

                for resp_text in reversed(graphql_responses):
                    try:
                        data = json.loads(resp_text)
                    except json.JSONDecodeError:
                        continue
                    if "errors" not in data:
                        results = parse_graphql_response(data, params)
                        if results:
                            log(f"Found {len(results)} results from intercepted response")
                            break

                if not results:
                    log(f"No results after waiting. API requests seen: {len(all_api_urls)}")
                    for u in all_api_urls[-15:]:
                        log(f"  {u}")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))

if __name__ == "__main__":
    main()
