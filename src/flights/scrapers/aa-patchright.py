#!/usr/bin/env python3
"""
AA Award Search via Patchright (patched Chromium).

Same logic as aa-camoufox.py but uses Patchright instead of Camoufox.
Patchright's Chromium can render AA's Angular SPA (Camoufox Firefox cannot).

Usage:
  python3 aa-patchright.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os
import re
from urllib.parse import urlparse, urlencode

def log(msg):
    print(f"[AA-Patchright {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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

    slices = json.dumps([{
        "orig": origin, "origNearby": False,
        "dest": destination, "destNearby": False,
        "date": date,
    }])

    search_params = {
        "locale": "en_US",
        "pax": str(passengers),
        "adult": str(passengers),
        "type": "OneWay",
        "searchType": "Award",
        "cabin": "",
        "carriers": "ALL",
        "slices": slices,
        "maxAwardSegmentAllowed": "2",
    }
    search_url = f"https://www.aa.com/booking/search?{urlencode(search_params)}"

    log(f"Search: {origin}→{destination} {date} {cabin}")

    from patchright.sync_api import sync_playwright

    results = []

    try:
        # Use residential proxy (Bright Data) to avoid IP-level Akamai blocks.
        # Patchright (Chromium) handles HTTP proxy SSL interception fine with ignore_https_errors=True.
        # Add sticky session so the same IP handles the entire search flow.
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
                # Add sticky session ID to Bright Data username for consistent IP per search
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

            # Warm cookies — aggressive approach to pass Akamai challenge
            log("Warming cookies on aa.com...")
            try:
                page.goto("https://www.aa.com/", timeout=45000, wait_until="domcontentloaded")
                time.sleep(random.uniform(3, 5))
                page.evaluate("window.scrollBy(0, Math.random() * 400)")
                time.sleep(random.uniform(2, 3))
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                time.sleep(random.uniform(1, 2))
                page.mouse.move(random.randint(200, 800), random.randint(200, 500))
                time.sleep(random.uniform(1, 2))
                page.evaluate("window.scrollBy(0, -Math.random() * 200)")
                time.sleep(random.uniform(1, 2))
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Wait for Akamai challenge to resolve
            cookie_ok = False
            for attempt in range(3):
                cookies = context.cookies()
                akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
                log(f"Cookies (check {attempt+1}): {len(cookies)} total, {len(akamai)} Akamai")
                if len(cookies) >= 15:
                    cookie_ok = True
                    break
                time.sleep(3)
                page.evaluate("window.scrollBy(0, Math.random() * 100)")
                time.sleep(2)

            if not cookie_ok:
                log("FAIL FAST: Akamai challenge not passed (cookies < 15) — exit for retry")
                sys.exit(1)

            # Navigate to search
            log(f"Navigating to search URL...")
            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation error (checking page): {e}")

            # Wait for results — AA's Angular app can take time to render
            found_results = False
            for wait_round in range(3):
                try:
                    page.wait_for_selector(".results-grid-container", timeout=20000)
                    log("Results container found!")
                    found_results = True
                    break
                except Exception:
                    content = page.content()
                    lower = content.lower()
                    if "access denied" in lower or "reference #" in lower:
                        log(f"BLOCKED by Akamai on search page — exit for retry")
                        sys.exit(1)
                    if "no flights" in lower or "no award" in lower or "no results" in lower:
                        log("No flights available (legitimate)")
                        print("[]")
                        sys.exit(0)
                    if "choose flights" in lower or "choose-flights" in page.url.lower():
                        log("Page loaded (choose-flights), scanning for results...")
                        found_results = True
                        break
                    log(f"No results container yet (round {wait_round+1}, page len={len(content)})...")
                    time.sleep(5)

            if not found_results:
                log("No results found after all wait rounds — exit for retry")
                sys.exit(1)

            time.sleep(random.uniform(2, 4))

            # Parse results from DOM
            results = page.evaluate("""(sp) => {
                const flights = [];
                const rows = document.querySelectorAll('.results-grid-container > .grid-x.grid-padding-x');
                rows.forEach((row) => {
                    const originCode = row.querySelector('.origin .city-code')?.textContent?.trim() || sp.origin;
                    const destCode = row.querySelector('.destination .city-code')?.textContent?.trim() || sp.destination;
                    const depTime = row.querySelector('.origin .flt-times')?.textContent?.trim() || '';
                    const arrTime = (row.querySelector('.destination .flt-times')?.textContent?.trim() || '').replace(/\\+\\d.*$/, '').trim();
                    const duration = row.querySelector('.duration')?.textContent?.trim() || '';
                    const stopsText = row.querySelector('.stops')?.textContent?.trim() || '';
                    const stopsMatch = stopsText.match(/^(\\d+)\\s*stop/i);
                    const stops = stopsText.toLowerCase().includes('nonstop') ? 0 : stopsMatch ? parseInt(stopsMatch[1]) : 0;

                    const flightNums = Array.from(row.querySelectorAll('.flight-number'))
                        .map(el => el.textContent?.trim().replace(/\\s+/g, '') || '').filter(Boolean);

                    const operatingAirlines = Array.from(row.querySelectorAll('.leg-info')).map(leg => {
                        const m = (leg.textContent || '').match(/Operated by\\s+(.+?)(?:\\s*$|\\s*\\n)/i);
                        return m?.[1]?.trim() || '';
                    }).filter(Boolean);

                    const aircraftNames = Array.from(row.querySelectorAll('.aircraft-name'))
                        .map(el => el.textContent?.trim() || '').filter(Boolean);

                    const cabinPrices = [];
                    row.querySelectorAll('.cell.auto.pad-left-xxs.pad-right-xxs').forEach(btn => {
                        const text = btn.textContent?.replace(/\\s+/g, ' ').trim() || '';
                        const cabinMatch = text.match(/^(Main|Economy|Premium Economy|Business|First)/i);
                        const milesMatch = text.match(/([\\d,.]+)K/);
                        const taxMatch = text.match(/\\$\\s*([\\d,.]+)/);
                        if (cabinMatch && milesMatch) {
                            cabinPrices.push({
                                cabin: cabinMatch[1].toLowerCase(),
                                miles: parseFloat(milesMatch[1].replace(/,/g, '')) * 1000,
                                taxes: taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : 0,
                            });
                        }
                    });

                    const primaryAirline = flightNums[0]?.match(/^([A-Z]{2})/)?.[1] || 'AA';
                    const airlineNames = {
                        'AA': 'American Airlines', 'JL': 'Japan Airlines', 'BA': 'British Airways',
                        'CX': 'Cathay Pacific', 'QR': 'Qatar Airways', 'QF': 'Qantas',
                        'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
                        'RJ': 'Royal Jordanian', 'AS': 'Alaska Airlines', 'HA': 'Hawaiian Airlines',
                    };

                    for (const cp of cabinPrices) {
                        let cabin;
                        if (cp.cabin === 'main' || cp.cabin === 'economy') cabin = 'economy';
                        else if (cp.cabin === 'business') cabin = 'business';
                        else if (cp.cabin === 'first') cabin = 'first';
                        else cabin = 'economy';

                        flights.push({
                            source: 'aa',
                            airline: airlineNames[primaryAirline] || primaryAirline,
                            flightNumber: flightNums.join(', '),
                            origin: originCode, destination: destCode,
                            departureDate: sp.date,
                            departureTime: depTime, arrivalTime: arrTime,
                            duration, stops, cabin,
                            pointsRequired: cp.miles,
                            pointsProgram: 'AAdvantage',
                            taxesAndFees: cp.taxes,
                            awardType: primaryAirline === 'AA' ? 'saver' : 'partner',
                            scrapedAt: new Date().toISOString(),
                            metadata: { operatingAirlines, aircraftTypes: aircraftNames, allFlightNumbers: flightNums },
                        });
                    }
                });
                return flights;
            }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})

            log(f"Found {len(results)} results")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    for r in results:
        r["bookingUrl"] = search_url

    print(json.dumps(results))

if __name__ == "__main__":
    main()
