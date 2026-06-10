#!/usr/bin/env python3
"""
AA Award Search via real Chrome CDP.

Launches Chrome normally with --remote-debugging-port and connects via
Patchright CDP. This bypasses Akamai because Chrome has no automation flags.

Usage:
  python3 aa-cdp.py '{"origin":"JFK","destination":"LHR","date":"2026-04-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import re
from urllib.parse import urlencode

def log(msg):
    print(f"[AA-CDP {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def safe_content(page, attempts=4):
    """Read page.content() defensively.

    Chrome 149+ raises "Unable to retrieve content because the page is
    navigating and changing the content" when content() races an in-flight
    navigation. Settle the load state and retry on that transient error.
    """
    for i in range(attempts):
        try:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            return page.content()
        except Exception as e:
            if "navigating and changing" in str(e) and i < attempts - 1:
                time.sleep(1.0)
                continue
            raise
    return ""

def safe_evaluate(page, script, arg=None, attempts=4):
    """Run page.evaluate() defensively against Chrome 149+ nav races.

    The award results SPA re-routes internally (e.g. to /choose-flights/N),
    which can destroy the execution context mid-evaluate and raise
    "Execution context was destroyed, most likely because of a navigation".
    Settle the load state (and re-wait for a flight row) and retry on that
    transient error — same strategy as safe_content() above.
    """
    for i in range(attempts):
        try:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            return page.evaluate(script, arg) if arg is not None else page.evaluate(script)
        except Exception as e:
            msg = str(e)
            transient = ("Execution context was destroyed" in msg
                         or "navigating and changing" in msg)
            if transient and i < attempts - 1:
                log(f"evaluate hit nav race (attempt {i+1}/{attempts}), settling and retrying...")
                time.sleep(1.5)
                try:
                    page.wait_for_selector(".flight-row", timeout=8000)
                except Exception:
                    pass
                continue
            raise
    return None

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
        "orig": origin, "origNearby": True,
        "dest": destination, "destNearby": True,
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

    # Import chrome_cdp from same directory
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    results = []

    try:
        browser, context, page, cleanup = create_cdp_browser("aa")

        try:
            # Step 1: Warm cookies on aa.com homepage
            log("Warming cookies on aa.com...")
            page.goto("https://www.aa.com/", timeout=30000, wait_until="domcontentloaded")
            time.sleep(random.uniform(3, 5))
            page.evaluate("window.scrollBy(0, Math.random() * 400)")
            time.sleep(random.uniform(2, 3))
            page.mouse.move(random.randint(200, 800), random.randint(200, 500))
            time.sleep(random.uniform(1, 2))

            # Check Akamai cookies
            cookies = context.cookies()
            akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
            log(f"Cookies: {len(cookies)} total, {len(akamai)} Akamai")

            # Step 2: Navigate to award search
            log("Navigating to search...")
            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation timeout (checking page): {e}")

            # Step 3: Wait for results
            found_results = False
            for wait_round in range(4):
                try:
                    page.wait_for_selector(".results-grid-container", timeout=15000)
                    log("Results container found!")
                    found_results = True
                    break
                except Exception:
                    content = safe_content(page)
                    lower = content.lower()
                    if "access denied" in lower or "reference #" in lower:
                        log("BLOCKED by Akamai — exit for retry")
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
                    time.sleep(4)

            if not found_results:
                # One more check — page might have loaded but with different structure
                content = safe_content(page)
                if len(content) > 50000:
                    log(f"Large page ({len(content)} bytes) — attempting parse anyway")
                    found_results = True
                else:
                    log("No results found after all wait rounds — exit for retry")
                    sys.exit(1)

            time.sleep(random.uniform(1, 3))

            # Step 4: Parse results from DOM
            results = page.evaluate("""(sp) => {
                const flights = [];
                // AA migrated this page to Angular: rows are now `.flight-row`
                // inside `.results-grid-container` (was Foundation `.grid-x.grid-padding-x`).
                const rows = document.querySelectorAll('.results-grid-container .flight-row');
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
                    // Price buttons are now `.btn-flight` (was `.cell.auto.pad-left-xxs.pad-right-xxs`).
                    // Text format: "Business One way 77K + $5.60 ..." — regexes below still apply.
                    row.querySelectorAll('.btn-flight').forEach(btn => {
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
                        // Premium economy folds into the `economy` cabin bucket (house
                        // convention — cf. united-cdp.py / aa-curlffi.py), but we preserve
                        // the real label in `cabinDisplay` so the UI can distinguish it.
                        let cabin;
                        let cabinDisplay;
                        if (cp.cabin === 'main' || cp.cabin === 'economy') cabin = 'economy';
                        else if (cp.cabin === 'premium economy') { cabin = 'economy'; cabinDisplay = 'Premium Economy'; }
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
                            duration, stops, cabin, cabinDisplay,
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

        finally:
            cleanup()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    for r in results:
        r["bookingUrl"] = search_url

    print(json.dumps(results))

if __name__ == "__main__":
    main()
