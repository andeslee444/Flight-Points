#!/usr/bin/env python3
"""
Alaska Airlines Mileage Plan Award Search via Patchright (patched Chromium).

No login required. Shows partner availability (AA, BA, Cathay, JAL, Qatar, etc.).
Uses Patchright to bypass Akamai that blocks stock Playwright.

Usage:
  python3 alaska-patchright.py '{"origin":"JFK","destination":"NRT","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re
from urllib.parse import urlparse

def log(msg):
    print(f"[Alaska-PR {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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

CABIN_MAP = {"economy": "Coach", "business": "Business", "first": "First"}

def build_url(origin, destination, date, cabin, passengers=1):
    y, m, d = date.split("-")
    date_str = f"{m}/{d}/{y}"
    cabin_code = CABIN_MAP.get(cabin, "Business")
    from urllib.parse import quote
    return (
        f"https://www.alaskaair.com/shopping/flights"
        f"?prior=award&tripType=oneway&prior=award"
        f"&orig={origin}&dest={destination}&departDate={quote(date_str)}"
        f"&adults={passengers}&cabinType={cabin_code}"
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
    passengers = params.get("passengers", 1)

    search_url = build_url(origin, destination, date, cabin, passengers)
    log(f"Search: {origin}→{destination} {date} {cabin}")

    from patchright.sync_api import sync_playwright

    results = []
    api_flights = []

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

            # Intercept API responses
            def handle_response(response):
                url = response.url
                ct = response.headers.get("content-type", "")
                if "json" in ct and ("/shopping/" in url or "/api/" in url or "flightshopping" in url or "availability" in url):
                    try:
                        body = response.text()
                        if len(body) > 100:
                            data = json.loads(body)
                            if any(k in data for k in ["flights", "slices", "results"]):
                                log(f"API [{response.status}]: {url[:120]} ({len(body)} bytes)")
                                api_flights.append(data)
                    except:
                        pass

            page.on("response", handle_response)

            # Cookie warming
            log("Warming cookies on alaskaair.com...")
            try:
                page.goto("https://www.alaskaair.com/", timeout=20000, wait_until="domcontentloaded")
                time.sleep(random.uniform(2, 4))
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                time.sleep(random.uniform(1, 2))
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Navigate to search
            log(f"Navigating to search: {search_url[:120]}")
            page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            time.sleep(random.uniform(3, 5))

            # Early block detection — fail fast instead of waiting 30s on selectors
            body_text = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
            body_lower = body_text.lower()
            if any(kw in body_lower for kw in ["blocked", "captcha", "challenge", "access denied", "please verify"]):
                log(f"Blocked by anti-bot protection — exit for retry. Body: {body_text[:200]}")
                sys.exit(1)

            page_len = len(page.content())
            if page_len < 2000:
                log(f"Page too small ({page_len} bytes) — likely blocked, exit for retry")
                sys.exit(1)

            time.sleep(random.uniform(2, 4))

            # Wait for results
            try:
                page.wait_for_selector('[class*="flight-result"], [class*="FlightOption"], .option-row, [data-qa*="flight"], .matrix-cell, [class*="result"]', timeout=20000)
            except:
                log("Could not find flight result selectors")

            time.sleep(3)

            # Parse from DOM
            results = page.evaluate("""(sp) => {
                const flights = [];

                const cards = document.querySelectorAll(
                    '[class*="flight-result"], [class*="FlightOption"], .option-row, [class*="result-row"], [class*="flight-option"]'
                );

                cards.forEach((card) => {
                    const text = card.textContent || '';

                    const flightNumMatch = text.match(/([A-Z]{2})\\s*(\\d{1,4})/);
                    const flightNumber = flightNumMatch ? flightNumMatch[1] + flightNumMatch[2] : '';

                    const milesMatch = text.match(/([\\d,]+)\\s*(?:miles|mi)/i);
                    const pointsRequired = milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0;

                    const taxMatch = text.match(/\\$(\\d+(?:\\.\\d{2})?)/);
                    const taxesAndFees = taxMatch ? parseFloat(taxMatch[1]) : 0;

                    const timeMatches = text.match(/(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm))/gi);
                    const departureTime = timeMatches?.[0] || '';
                    const arrivalTime = timeMatches?.[1] || '';

                    const stopsText = text.toLowerCase();
                    const stops = stopsText.includes('nonstop') ? 0 : stopsText.includes('1 stop') ? 1 : stopsText.includes('2 stop') ? 2 : 0;

                    const durationMatch = text.match(/(\\d+h\\s*\\d*m?|\\d+\\s*hr\\s*\\d*\\s*min)/i);
                    const duration = durationMatch?.[0] || '';

                    const airlineNames = ['American', 'British Airways', 'Cathay Pacific', 'Japan Airlines', 'JAL', 'Qatar', 'Qantas', 'Emirates', 'Singapore Airlines', 'Korean Air', 'Finnair', 'Icelandair', 'Condor', 'Alaska'];
                    let airline = 'Alaska Airlines';
                    for (const name of airlineNames) {
                        if (text.includes(name)) {
                            airline = name;
                            break;
                        }
                    }

                    if (flightNumber || pointsRequired) {
                        flights.push({
                            source: 'alaska',
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
                            pointsProgram: 'Alaska Mileage Plan',
                            taxesAndFees,
                            awardType: 'partner',
                            scrapedAt: new Date().toISOString(),
                            bookingUrl: sp.url,
                        });
                    }
                });

                return flights;
            }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin, "url": search_url})

            if not results:
                content = page.content()
                if "captcha" in content.lower() or "challenge" in content.lower() or "blocked" in content.lower():
                    log("Blocked by anti-bot protection — exit for retry")
                    sys.exit(1)
                else:
                    log(f"No results found. Page length: {len(content)}")

            log(f"Found {len(results)} results")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))

if __name__ == "__main__":
    main()
