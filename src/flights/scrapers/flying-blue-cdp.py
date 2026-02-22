#!/usr/bin/env python3
"""
Air France / KLM Flying Blue Award Search via real Chrome CDP.

Launches Chrome normally with --remote-debugging-port and connects via
Patchright CDP. This bypasses Akamai because Chrome has no automation flags.

No login required. Shows SkyTeam partner availability.

Usage:
  python3 flying-blue-cdp.py '{"origin":"JFK","destination":"CDG","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re
import datetime

def log(msg):
    print(f"[FlyingBlue-CDP {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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

CABIN_MAP = {"economy": "ECONOMY", "business": "BUSINESS", "first": "FIRST"}

def build_url(origin, destination, date, cabin):
    cabin_code = CABIN_MAP.get(cabin, "BUSINESS")
    return (
        f"https://www.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0"
        f"&cabinClass={cabin_code}&activeConnection=0"
        f"&origin={origin}&destination={destination}&outboundDate={date}"
        f"&tripType=ONE_WAY&activeOutboundSubConnection=0"
    )

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

    search_url = build_url(origin, destination, date, cabin)
    log(f"Search: {origin}→{destination} {date} {cabin}")

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    results = []
    api_flights = []

    try:
        browser, context, page, cleanup = create_cdp_browser("flyingblue")

        try:
            # Intercept API responses for structured data
            all_api_urls = []
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                status = response.status
                if status not in (200, 204, 304, 301, 302):
                    if not any(ext in url for ext in ['.css', '.js', '.png', '.jpg', '.svg', '.woff']):
                        all_api_urls.append(f"[{status}] {url[:150]}")
                if "json" in ct and status == 200:
                    try:
                        body = response.text()
                        if len(body) > 100:
                            data = json.loads(body)
                            keys = list(data.keys()) if isinstance(data, dict) else []
                            log(f"API [{status}]: {url[:120]} ({len(body)} bytes, keys={keys[:5]})")
                            if any(k in str(keys) for k in ["connections", "offers", "flights", "data", "itineraries", "results", "boundGroups"]):
                                api_flights.append(data)
                                log(f"  -> Captured for parsing")
                    except:
                        pass

            page.on("response", handle_response)

            # Step 1: Load homepage to establish session and dismiss cookies
            log("Loading airfrance.us homepage...")
            try:
                page.goto("https://wwws.airfrance.us/", timeout=30000, wait_until="load")
                time.sleep(random.uniform(4, 6))
            except Exception as e:
                log(f"Homepage load issue (continuing): {e}")

            # Dismiss cookie banner (blocks all interactions)
            page.evaluate('''() => {
                const banner = document.querySelector('#bw-cookie-banner');
                if (banner) {
                    const btn = banner.querySelector('button');
                    if (btn) btn.click();
                }
                document.querySelectorAll('[class*="cookie-banner"], [id*="didomi"], [class*="consent"]').forEach(el => el.remove());
            }''')
            time.sleep(2)

            # Step 2: Navigate to search page
            # Note: Direct search URL redirects to /search/advanced (form page)
            # "Book with Miles" tab requires Flying Blue login
            log(f"Navigating to search...")
            try:
                page.goto(search_url, timeout=90000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation timeout (checking intercepted data): {e}")

            time.sleep(random.uniform(5, 8))

            # Dismiss cookies again on search page
            page.evaluate('''() => {
                document.querySelectorAll('#bw-cookie-banner, [class*="cookie"], [id*="didomi"]').forEach(el => el.remove());
            }''')

            # Wait for results
            try:
                page.wait_for_selector('[class*="flight"], [class*="offer"], [class*="connection"], [data-testid*="flight"], .result-card', timeout=30000)
            except:
                log("Could not find flight result selectors")

            time.sleep(3)

            # Check intercepted API data first
            if api_flights and not results:
                log(f"Parsing {len(api_flights)} intercepted API responses...")
                for api_data in api_flights:
                    try:
                        parsed = parse_api_flights(api_data, origin, destination, date, cabin, search_url)
                        if parsed:
                            results = parsed
                            log(f"Got {len(results)} results from intercepted API")
                            break
                        else:
                            keys = list(api_data.keys()) if isinstance(api_data, dict) else type(api_data).__name__
                            log(f"  API data keys: {keys}")
                    except Exception as e:
                        log(f"API parse error: {e}")

            # Parse from DOM if API didn't yield results
            if not results:
                try:
                    results = page.evaluate("""(sp) => {
                const flights = [];

                const cards = document.querySelectorAll(
                    '[class*="offer-card"], [class*="flight-card"], [class*="connection-card"], [class*="result-card"], [class*="journey"]'
                );

                cards.forEach((card) => {
                    const text = card.textContent || '';

                    const flightNumMatch = text.match(/([A-Z]{2})\\s*(\\d{1,4})/);
                    const flightNumber = flightNumMatch ? flightNumMatch[1] + flightNumMatch[2] : '';

                    const milesMatch = text.match(/([\\d,]+)\\s*(?:miles|Miles)/i);
                    const pointsRequired = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

                    const taxMatch = text.match(/[€$£](\\d+(?:[.,]\\d{2})?)/);
                    const taxesAndFees = taxMatch ? parseFloat(taxMatch[1].replace(',', '.')) : 0;

                    const timeMatches = text.match(/(\\d{1,2}[:.]\\d{2})/g);
                    const departureTime = timeMatches?.[0] || '';
                    const arrivalTime = timeMatches?.[1] || '';

                    const stopsText = text.toLowerCase();
                    const stops = stopsText.includes('direct') || stopsText.includes('nonstop') ? 0 :
                        stopsText.includes('1 stop') ? 1 : stopsText.includes('2 stop') ? 2 : 0;

                    const durationMatch = text.match(/(\\d+h\\s*\\d*m?)/i);
                    const duration = durationMatch?.[0] || '';

                    const isPromo = text.toLowerCase().includes('promo') || text.toLowerCase().includes('promotion');
                    const awardType = isPromo ? 'saver' : 'partner';

                    let airline = 'Air France';
                    if (text.includes('KLM')) airline = 'KLM';
                    else if (text.includes('Delta')) airline = 'Delta';
                    else if (text.includes('Korean')) airline = 'Korean Air';
                    else if (text.includes('Vietnam')) airline = 'Vietnam Airlines';

                    if (flightNumber || pointsRequired) {
                        flights.push({
                            source: 'flying-blue',
                            airline,
                            flightNumber,
                            origin: sp.origin,
                            destination: sp.destination,
                            departureDate: sp.date,
                            departureTime,
                            arrivalTime,
                            duration,
                            stops,
                            cabin: sp.cabin,
                            pointsRequired,
                            pointsProgram: 'Flying Blue',
                            taxesAndFees,
                            awardType,
                            scrapedAt: new Date().toISOString(),
                            bookingUrl: sp.url,
                        });
                    }
                });

                return flights;
            }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin, "url": search_url})
                except Exception as e:
                    log(f"DOM evaluation error: {str(e)[:100]}")
                    results = []

            if not results:
                content = page.content()
                if "captcha" in content.lower() or "challenge" in content.lower():
                    log("Blocked by anti-bot protection")
                    # Try KLM as fallback
                    log("Trying KLM fallback...")
                    cabin_code = CABIN_MAP.get(cabin, "BUSINESS")
                    klm_url = (
                        f"https://www.klm.com/search/offers?pax=1:0:0:0:0:0:0:0"
                        f"&cabinClass={cabin_code}&activeConnection=0"
                        f"&origin={origin}&destination={destination}&outboundDate={date}"
                        f"&tripType=ONE_WAY&activeOutboundSubConnection=0"
                    )
                    try:
                        page.goto(klm_url, timeout=90000, wait_until="domcontentloaded")
                        time.sleep(random.uniform(5, 8))
                        try:
                            page.wait_for_selector('[class*="flight"], [class*="offer"], [class*="connection"]', timeout=30000)
                        except:
                            pass
                        time.sleep(3)

                        if api_flights:
                            for api_data in api_flights:
                                try:
                                    results = parse_api_flights(api_data, origin, destination, date, cabin, klm_url)
                                    if results:
                                        log(f"Got {len(results)} results from KLM API")
                                        break
                                except:
                                    pass
                    except Exception as e:
                        log(f"KLM fallback also failed: {e}")

                    if not results:
                        log("Both airfrance.us and klm.com blocked")
                        if all_api_urls:
                            log(f"Non-200 requests: {len(all_api_urls)}")
                            for u in all_api_urls[-10:]:
                                log(f"  {u}")
                        sys.exit(1)
                else:
                    log(f"No results found. Page length: {len(content)}")
                    if all_api_urls:
                        log(f"Non-200 requests: {len(all_api_urls)}")
                        for u in all_api_urls[-10:]:
                            log(f"  {u}")

            log(f"Found {len(results)} results")

        finally:
            cleanup()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))


def parse_api_flights(data, origin, destination, date, cabin, booking_url):
    """Parse intercepted API response data into FlightResult objects."""
    results = []
    try:
        connections = (
            data.get("connections", []) or
            data.get("offers", []) or
            data.get("flights", []) or
            data.get("itineraries", []) or
            (data.get("data", {}).get("connections", []) if isinstance(data.get("data"), dict) else []) or
            (data.get("data", {}).get("offers", []) if isinstance(data.get("data"), dict) else []) or
            []
        )
        if isinstance(connections, dict):
            connections = connections.get("data", connections.get("results", connections.get("connections", [])))
        if not isinstance(connections, list):
            return results

        for conn in connections:
            if not isinstance(conn, dict):
                continue
            segments = conn.get("segments", conn.get("flights", conn.get("legs", [])))
            miles = conn.get("milesPrice", conn.get("miles", conn.get("points", 0)))
            if isinstance(miles, dict):
                miles = miles.get("miles", miles.get("value", 0))
            taxes = conn.get("taxPrice", conn.get("taxes", 0))
            if isinstance(taxes, dict):
                taxes = taxes.get("value", taxes.get("amount", 0))

            fn_parts = []
            dep_time = ""
            arr_time = ""
            airline = "Air France"
            stops = 0

            if isinstance(segments, list):
                stops = max(0, len(segments) - 1)
                for i, seg in enumerate(segments):
                    if isinstance(seg, dict):
                        fn = seg.get("flightNumber", seg.get("flight", ""))
                        if fn:
                            fn_parts.append(str(fn))
                        carrier = seg.get("airline", seg.get("carrier", seg.get("marketingCarrier", "")))
                        if carrier and i == 0:
                            names = {"AF": "Air France", "KL": "KLM", "DL": "Delta",
                                     "KE": "Korean Air", "VN": "Vietnam Airlines"}
                            airline = names.get(carrier, carrier)
                        if i == 0:
                            dep_time = str(seg.get("departureTime", seg.get("departure", "")))
                        if i == len(segments) - 1:
                            arr_time = str(seg.get("arrivalTime", seg.get("arrival", "")))

            if miles and miles > 0:
                results.append({
                    "source": "flying-blue",
                    "airline": airline,
                    "flightNumber": "/".join(fn_parts) if fn_parts else "",
                    "origin": origin,
                    "destination": destination,
                    "departureDate": date,
                    "departureTime": dep_time,
                    "arrivalTime": arr_time,
                    "duration": "",
                    "stops": stops,
                    "cabin": cabin,
                    "pointsRequired": int(miles),
                    "pointsProgram": "Flying Blue",
                    "taxesAndFees": float(taxes) if taxes else 0,
                    "awardType": "saver",
                    "scrapedAt": datetime.datetime.utcnow().isoformat() + "Z",
                    "bookingUrl": booking_url,
                })
    except Exception as e:
        pass
    return results


if __name__ == "__main__":
    main()
