#!/usr/bin/env python3
"""
AA Award Search via Camoufox (anti-detect Firefox browser).

Usage:
  python3 aa-camoufox.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import os

def log(msg):
    print(f"[AA-Camoufox {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")
    passengers = params.get("passengers", 1)

    cabin_map = {"economy": "COACH", "business": "BUSINESS", "first": "FIRST"}

    slices = json.dumps([{
        "orig": origin, "origNearby": False,
        "dest": destination, "destNearby": False,
        "date": date,
    }])

    from urllib.parse import urlencode
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

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []

    try:
        # Route through Cloudflare WARP SOCKS5 proxy for fresh IP
        proxy_cfg = {"server": "socks5://127.0.0.1:1080"} if os.path.exists("/tmp/wireproxy.pid") else None
        if proxy_cfg:
            log("Using WARP proxy (SOCKS5 127.0.0.1:1080)")
        with Camoufox(headless=True, humanize=True, proxy=proxy_cfg, geoip=True) as browser:
            page = browser.new_page()

            # Warm cookies
            log("Warming cookies on aa.com...")
            try:
                page.goto("https://www.aa.com/", timeout=25000)
                time.sleep(random.uniform(2, 4))
                page.evaluate("window.scrollBy(0, Math.random() * 500)")
                time.sleep(random.uniform(1.5, 3))
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            cookies = page.context.cookies()
            akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
            log(f"Cookies: {len(cookies)} total, {len(akamai)} Akamai")

            # Navigate to search
            log(f"Navigating to search URL...")
            try:
                page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation error (checking page): {e}")

            # Wait for results
            try:
                page.wait_for_selector(".results-grid-container", timeout=30000)
                log("Results container found!")
            except Exception:
                content = page.content().lower()
                if "access denied" in content or "reference #" in content:
                    log("BLOCKED by Akamai")
                    print("[]")
                    sys.exit(0)
                if "no flights" in content or "no award" in content or "no results" in content:
                    log("No flights available")
                    print("[]")
                    sys.exit(0)
                # Try extended wait
                log("No results container yet, waiting longer...")
                time.sleep(8)
                try:
                    page.wait_for_selector(".results-grid-container", timeout=15000)
                except Exception:
                    content2 = page.content().lower()
                    if "access denied" in content2 or "reference #" in content2:
                        log("BLOCKED by Akamai (after retry)")
                    else:
                        log("No results found after extended wait")
                    print("[]")
                    sys.exit(0)

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

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    # Add booking URL
    for r in results:
        r["bookingUrl"] = search_url

    print(json.dumps(results))

if __name__ == "__main__":
    main()
