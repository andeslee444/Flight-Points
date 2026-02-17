#!/usr/bin/env python3
"""
ANA Award Search via Camoufox (anti-detect Firefox browser).

Usage:
  python3 ana-camoufox.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.

Two strategies:
  1. Award booking search (aswbe-i.ana.co.jp) — detailed flight results
  2. Award calendar (cam.ana.co.jp) — availability overview with chart miles
"""

import json
import sys
import time
import random
import os

def log(msg):
    print(f"[ANA-Camoufox {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

def random_delay(lo=1.5, hi=3.5):
    time.sleep(random.uniform(lo, hi))

def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]  # YYYY-MM-DD
    cabin = params.get("cabin", "business")

    username = os.environ.get("ANA_USERNAME", "")
    password = os.environ.get("ANA_PASSWORD", "")

    if not username or not password:
        log("ERROR: ANA_USERNAME and ANA_PASSWORD env vars required")
        print("[]")
        sys.exit(0)

    log(f"Search: {origin}→{destination} {date} {cabin}")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []

    try:
        with Camoufox(headless=True, humanize=True) as browser:
            page = browser.new_page()

            # ── Step 1: Warm up on main ANA site ──
            log("Warming up on ana.co.jp...")
            try:
                page.goto("https://www.ana.co.jp/en/us/", timeout=25000, wait_until="domcontentloaded")
                random_delay(2, 4)
                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                random_delay(1, 2)
            except Exception as e:
                log(f"Warmup issue (continuing): {e}")

            # ── Step 2: Try award booking search ──
            results = try_booking_search(page, username, password, origin, destination, date, cabin)

            if not results:
                # ── Step 3: Fallback to award calendar ──
                log("Booking search returned no results, trying calendar...")
                results = try_calendar_search(page, username, password, origin, destination, date, cabin)

            log(f"Total results: {len(results)}")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))


def try_booking_search(page, username, password, origin, destination, date, cabin):
    """Try the full award booking search on aswbe-i.ana.co.jp."""
    results = []

    try:
        booking_url = (
            "https://aswbe-i.ana.co.jp/international_asw/pages/award/search/"
            "roundtrip/award_search_roundtrip_input.xhtml"
            "?CONNECTION_KIND=LAX&LANG=en"
        )
        log("Navigating to award booking...")
        page.goto(booking_url, timeout=40000, wait_until="domcontentloaded")
        random_delay(2, 4)

        current_url = page.url

        # ── Login if needed ──
        acct_field = page.query_selector("#accountNumber")
        if acct_field:
            log("Login required, filling credentials...")
            random_delay(0.5, 1)
            acct_field.click()
            random_delay(0.3, 0.6)
            acct_field.type(username, delay=random.randint(60, 120))
            random_delay(0.5, 1)

            pw_field = page.query_selector("#password")
            if pw_field:
                pw_field.click()
                random_delay(0.3, 0.6)
                pw_field.type(password, delay=random.randint(50, 100))
                random_delay(0.5, 1)

            page.click("#amcMemberLogin")

            try:
                page.wait_for_load_state("domcontentloaded", timeout=20000)
            except:
                pass
            random_delay(3, 5)

            current_url = page.url
            body_text = page.evaluate("() => document.body?.innerText?.substring(0, 2000) || ''")

            if "heavy traffic" in body_text.lower() or "混み合っている" in body_text:
                log("Blocked: heavy traffic / anti-bot response")
                return results

            if "error" in body_text.lower() and "password" in body_text.lower():
                log("Login failed: invalid credentials")
                return results

            log(f"Post-login URL: {current_url}")

        # ── Check if we're on the search form ──
        body_text = page.evaluate("() => document.body?.innerText?.substring(0, 3000) || ''")

        if "award" not in body_text.lower() and "search" not in body_text.lower():
            log("Not on search form page")
            return results

        # ── Select One-Way ──
        try:
            oneway_selectors = [
                'input[value="2"]',
                'label:has-text("One-way")',
                'input[id*="oneWay"]',
                '#oneWay',
            ]
            for sel in oneway_selectors:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.click()
                    random_delay(0.5, 1)
                    log("Selected one-way")
                    break
        except:
            pass

        # ── Fill origin ──
        fill_airport_field(page, [
            'input[name*="depAirport"]', 'input[name*="origin"]',
            'input[id*="depApo"]', 'input[placeholder*="From"]',
            'input[placeholder*="Departure"]', '#departureAirport',
        ], origin, "origin")

        # ── Fill destination ──
        fill_airport_field(page, [
            'input[name*="arrAirport"]', 'input[name*="dest"]',
            'input[id*="arrApo"]', 'input[placeholder*="To"]',
            'input[placeholder*="Arrival"]', '#arrivalAirport',
        ], destination, "destination")

        # ── Fill date ──
        y, m, d = date.split("-")
        for sel in ['input[name*="depDate"]', 'input[name*="date"]',
                     'input[id*="depDate"]', 'input[type="date"]']:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.click()
                    random_delay(0.3, 0.5)
                    el.fill("")
                    for fmt in [f"{y}/{m}/{d}", f"{m}/{d}/{y}", date]:
                        el.fill(fmt)
                        if el.input_value():
                            log(f"Filled date: {fmt}")
                            break
                    random_delay(0.5, 1)
                    break
            except:
                continue

        # ── Select cabin ──
        cabin_map = {"economy": "Y", "business": "C", "first": "F"}
        cabin_labels = {"economy": "Economy", "business": "Business", "first": "First"}
        for sel in ['select[name*="class"]', 'select[name*="cabin"]',
                     'select[id*="class"]', 'select[id*="cabin"]']:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    try:
                        el.select_option(value=cabin_map.get(cabin, "C"))
                    except:
                        el.select_option(label=cabin_labels.get(cabin, "Business"))
                    log(f"Selected cabin: {cabin}")
                    random_delay(0.5, 1)
                    break
            except:
                continue

        # ── Hide header search toggle to avoid click interception ──
        page.evaluate("""() => {
            // Hide the header search box toggle that intercepts clicks
            const headerBtn = document.querySelector('.asw-header-search-box__toggle-btn, input.asw-header-search-box__toggle-btn');
            if (headerBtn) { headerBtn.style.display = 'none'; headerBtn.style.visibility = 'hidden'; }
            // Hide any fixed/sticky headers that might overlap
            const headers = document.querySelectorAll('header, .header, [class*="header-fixed"], [class*="sticky"]');
            headers.forEach(h => { if (h.style) h.style.position = 'relative'; });
            // Hide modal overlays
            document.querySelectorAll('.modal-overlay, .popup-overlay').forEach(o => { o.style.display = 'none'; });
        }""")

        # ── Click Search ──
        search_selectors = [
            'form input[type="submit"][value*="Search"]',
            'form button[type="submit"]',
            'form input[type="submit"]',
            'button:has-text("Search")',
            'input[value="Search"]',
        ]
        clicked = False
        for sel in search_selectors:
            try:
                btn = page.query_selector(sel)
                if btn and btn.is_visible():
                    btn.scroll_into_view_if_needed()
                    random_delay(0.3, 0.5)
                    btn.click(force=True)
                    log(f"Clicked search: {sel}")
                    clicked = True
                    break
            except:
                continue

        if not clicked:
            log("Could not find search button")
            return results

        # ── Wait for results ──
        log("Waiting for results...")
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
        except:
            pass
        random_delay(3, 5)

        # ── Parse results ──
        results = parse_booking_results(page, origin, destination, date, cabin)

    except Exception as e:
        log(f"Booking search error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    return results


def try_calendar_search(page, username, password, origin, destination, date, cabin):
    """Use the award calendar (cam.ana.co.jp) to check availability."""
    results = []

    try:
        cal_url = "https://cam.ana.co.jp/psz/tokutencal/form_e.jsp?CONNECTION_KIND=LAX&LANG=en"
        log("Navigating to award calendar...")
        page.goto(cal_url, timeout=30000, wait_until="domcontentloaded")
        random_delay(2, 3)

        # Login if needed
        cusnum = page.query_selector("#w2cusnum")
        if cusnum:
            log("Calendar login...")
            cusnum.click()
            random_delay(0.3, 0.6)
            cusnum.type(username, delay=random.randint(60, 120))
            random_delay(0.5, 1)

            logpass = page.query_selector("#w2logpass")
            if logpass:
                logpass.click()
                random_delay(0.3, 0.6)
                logpass.type(password, delay=random.randint(50, 100))
                random_delay(0.5, 1)

            page.click('input[name="login"]')

            try:
                page.wait_for_load_state("domcontentloaded", timeout=20000)
            except:
                pass
            random_delay(3, 5)

            body_text = page.evaluate("() => document.body?.innerText?.substring(0, 2000) || ''")
            if "heavy traffic" in body_text.lower() or "混み合っている" in body_text:
                log("Calendar blocked: heavy traffic")
                return results

        # Check if we're on the calendar form
        body_text = page.evaluate("() => document.body?.innerText?.substring(0, 3000) || ''")
        log(f"Calendar page text preview: {body_text[:200]}")

        # Fill calendar search form
        # Origin/destination fields
        for sel_name, code in [("depCode", origin), ("arrCode", destination)]:
            try:
                el = page.query_selector(f'input[name="{sel_name}"]') or page.query_selector(f'input[name*="dep" i]' if "dep" in sel_name else f'input[name*="arr" i]')
                if el:
                    el.fill(code)
                    random_delay(0.3, 0.5)
            except:
                pass

        # Select month
        y, m, d = date.split("-")
        try:
            month_sel = page.query_selector('select[name*="month"], select[name*="Month"]')
            if month_sel:
                month_sel.select_option(value=f"{y}{m}")
                random_delay(0.3, 0.5)
        except:
            pass

        # Select cabin
        cabin_map = {"economy": "Y", "business": "C", "first": "F"}
        try:
            cabin_sel = page.query_selector('select[name*="class"], select[name*="cabin"]')
            if cabin_sel:
                cabin_sel.select_option(value=cabin_map.get(cabin, "C"))
                random_delay(0.3, 0.5)
        except:
            pass

        # Submit
        try:
            submit = page.query_selector('input[type="submit"], input[type="image"]')
            if submit:
                submit.click()
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=20000)
                except:
                    pass
                random_delay(3, 5)
        except:
            pass

        # Parse calendar results
        html = page.content()
        body_text = page.evaluate("() => document.body?.innerText || ''")

        # Check for availability symbols: ◎ (wide open), ○ (available), △ (limited)
        avail_symbols = {"◎": "wide-open", "○": "available", "△": "limited"}
        target_day = int(d)

        # Try to find the specific date in a table
        has_availability = False
        for symbol, status in avail_symbols.items():
            if symbol in html:
                has_availability = True
                miles = get_chart_miles(origin, destination, date, cabin)
                results.append({
                    "source": "ana",
                    "airline": "ANA",
                    "flightNumber": "NH---",
                    "origin": origin,
                    "destination": destination,
                    "departureDate": date,
                    "departureTime": "",
                    "arrivalTime": "",
                    "duration": "",
                    "stops": 0,
                    "cabin": cabin,
                    "pointsRequired": miles,
                    "pointsProgram": "ANA Mileage Club",
                    "taxesAndFees": 0,
                    "awardType": status,
                    "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "bookingUrl": "https://www.ana.co.jp/en/us/amc/",
                    "metadata": {"calendarStatus": status, "note": "From award calendar"},
                })
                break

        if not has_availability:
            log("No availability symbols found in calendar")

    except Exception as e:
        log(f"Calendar search error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    return results


def fill_airport_field(page, selectors, code, label):
    """Fill an airport input field with autocomplete."""
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click()
                random_delay(0.3, 0.5)
                el.fill("")
                el.type(code, delay=random.randint(80, 150))
                random_delay(1, 2)
                # Click autocomplete suggestion
                try:
                    suggestion = page.query_selector(
                        f'li:has-text("{code}"), .suggest-item:has-text("{code}"), '
                        f'div[class*="suggest"]:has-text("{code}")'
                    )
                    if suggestion and suggestion.is_visible():
                        suggestion.click()
                        random_delay(0.5, 1)
                except:
                    pass
                log(f"Filled {label}: {code}")
                return True
        except:
            continue
    log(f"Could not fill {label}")
    return False


def parse_booking_results(page, origin, destination, date, cabin):
    """Parse flight results from the ANA booking results page."""
    results = []

    try:
        body_text = page.evaluate("() => document.body?.innerText || ''")
        current_url = page.url

        log(f"Results page URL: {current_url}")

        # Check for no availability
        no_avail = ["no seats available", "no flights", "no available",
                     "空席なし", "not available", "no award seats",
                     "could not find", "no results"]
        body_lower = body_text.lower()
        for phrase in no_avail:
            if phrase in body_lower:
                log(f"No availability: '{phrase}'")
                return results

        # Parse structured results
        results = page.evaluate("""(sp) => {
            const flights = [];
            const selectors = [
                'tr[class*="flight"]', 'div[class*="flight-result"]',
                'div[class*="result-item"]', '.award-result',
                'table.result tbody tr', '.flight-info',
                '[class*="flightCard"]', '[class*="search-result"]',
            ];

            let cards = [];
            for (const sel of selectors) {
                cards = document.querySelectorAll(sel);
                if (cards.length > 0) break;
            }

            cards.forEach(card => {
                const text = card.textContent || '';
                const fnMatch = text.match(/\\b(NH|UA|LH|SQ|TK|OS|LX|SK|TP|BR|OZ|TG|SA|ET|CA|AI|AC|NZ)\\s*(\\d{1,4})\\b/);
                const flightNum = fnMatch ? fnMatch[1] + fnMatch[2] : '';
                const timeMatch = text.match(/(\\d{1,2}:\\d{2})\\s*(?:—|–|-|→|~|\\s)\\s*(\\d{1,2}:\\d{2})/);
                const milesMatch = text.match(/([\\d,]+)\\s*(?:miles|マイル|Mile)/i);
                const durMatch = text.match(/(\\d{1,2})\\s*[hH時]\\s*(\\d{1,2})?\\s*[mM分]?/);
                const stopsMatch = text.match(/(\\d+)\\s*stop/i);
                const nonstop = /nonstop|non-stop|直行/i.test(text);

                if (flightNum || timeMatch || milesMatch) {
                    const carrier = fnMatch ? fnMatch[1] : 'NH';
                    const names = {
                        'NH': 'ANA', 'UA': 'United', 'LH': 'Lufthansa',
                        'SQ': 'Singapore Airlines', 'TK': 'Turkish Airlines',
                        'AC': 'Air Canada', 'NZ': 'Air New Zealand',
                        'BR': 'EVA Air', 'OZ': 'Asiana', 'TG': 'Thai Airways',
                    };

                    flights.push({
                        source: 'ana',
                        airline: names[carrier] || carrier,
                        flightNumber: flightNum || 'NH---',
                        origin: sp.origin, destination: sp.destination,
                        departureDate: sp.date,
                        departureTime: timeMatch ? timeMatch[1] : '',
                        arrivalTime: timeMatch ? timeMatch[2] : '',
                        duration: durMatch ? durMatch[1] + 'h' + (durMatch[2] || '00') + 'm' : '',
                        stops: nonstop ? 0 : stopsMatch ? parseInt(stopsMatch[1]) : 0,
                        cabin: sp.cabin,
                        pointsRequired: milesMatch ? parseInt(milesMatch[1].replace(/,/g, '')) : 0,
                        pointsProgram: 'ANA Mileage Club',
                        taxesAndFees: 0,
                        awardType: carrier === 'NH' ? 'saver' : 'partner',
                        scrapedAt: new Date().toISOString(),
                        bookingUrl: window.location.href,
                    });
                }
            });
            return flights;
        }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})

    except Exception as e:
        log(f"Parse error: {e}")

    return results


def get_chart_miles(origin, destination, date, cabin):
    """ANA award chart miles (approximate, pre-June 2025 chart)."""
    # Simplified US-Japan chart
    chart = {
        "economy":  {"low": 30000, "regular": 35000, "high": 38000},
        "business": {"low": 43000, "regular": 50000, "high": 55000},
        "first":    {"low": 55000, "regular": 75000, "high": 75000},
    }

    month = int(date.split("-")[1])
    if month in [1, 4, 11]:
        season = "low"
    elif month in [3, 7, 8, 12]:
        season = "high"
    else:
        season = "regular"

    cabin_chart = chart.get(cabin, chart["business"])
    return cabin_chart.get(season, cabin_chart["regular"])


if __name__ == "__main__":
    main()
