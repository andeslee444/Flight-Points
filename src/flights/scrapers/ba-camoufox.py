#!/usr/bin/env python3
"""
BA (British Airways) Award Search via Camoufox (anti-detect Firefox browser).

Searches BA.com for Avios reward flight availability including oneworld partner airlines.
BA shows awards on AA, Cathay Pacific, JAL, Qantas, Finnair, Qatar, and other oneworld partners.

Usage:
  python3 ba-camoufox.py '{"origin":"JFK","destination":"NRT","date":"2026-03-15","cabin":"business"}'

Outputs JSON array of FlightResult objects to stdout.
All logging goes to stderr.
"""

import json
import sys
import time
import random
import re
import os
from datetime import datetime
from urllib.parse import urlparse

def log(msg):
    print(f"[BA-Camoufox {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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
    date = params["date"]  # YYYY-MM-DD
    cabin = params.get("cabin", "business")
    passengers = params.get("passengers", 1)

    # BA Executive Club credentials (free account: https://www.britishairways.com/content/the-british-airways-club)
    ba_username = os.environ.get("BA_EXEC_CLUB_NUMBER", "")
    ba_password = os.environ.get("BA_EXEC_CLUB_PASSWORD", "")

    cabin_map = {
        "economy": "M",
        "premium": "W",
        "business": "C",
        "first": "F",
    }
    cabin_code = cabin_map.get(cabin, "C")

    log(f"Search: {origin}→{destination} {date} {cabin}")
    if not ba_username:
        log("WARNING: BA_EXEC_CLUB_NUMBER not set — BA requires login for award search")
        log("Sign up free at: https://www.britishairways.com/content/the-british-airways-club")

    try:
        from camoufox.sync_api import Camoufox
    except ImportError:
        from camoufox import Camoufox

    results = []
    intercepted_responses = []

    try:
        # Only use SOCKS5 proxies for Camoufox — HTTP proxies cause SSL errors (SEC_ERROR_UNKNOWN_ISSUER)
        # and geoip=True crashes pages, so we NEVER pass it
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
            log(f"Skipping HTTP proxy for Camoufox (causes SSL errors)")
        with Camoufox(headless=True, humanize=True, os='macos', proxy=proxy_cfg) as browser:
            if proxy_cfg:
                context = browser.new_context(ignore_https_errors=True)
                page = context.new_page()
            else:
                page = browser.new_page()

            # Intercept network responses for API data
            def handle_response(response):
                url = response.url
                try:
                    if any(kw in url.lower() for kw in [
                        "availability", "flight", "redemption", "search",
                        "offer", "result", "itinerary", "fare", "avios",
                        "/api/", "flightList", "getflights"
                    ]):
                        ct = response.headers.get("content-type", "")
                        if "json" in ct or "javascript" in ct:
                            try:
                                body = response.text()
                                if len(body) > 100:  # Skip tiny responses
                                    intercepted_responses.append({
                                        "url": url,
                                        "body": body
                                    })
                                    log(f"Intercepted API: {url[:120]}")
                            except Exception:
                                pass
                except Exception:
                    pass

            page.on("response", handle_response)

            # Step 1: Warm cookies on BA homepage
            log("Warming cookies on ba.com...")
            try:
                page.goto("https://www.britishairways.com/", timeout=30000)
                time.sleep(random.uniform(2, 4))

                # Accept cookies banner
                try:
                    cookie_btn = page.query_selector('#onetrust-accept-btn-handler')
                    if cookie_btn:
                        cookie_btn.click()
                        log("Accepted cookies")
                        time.sleep(1)
                except Exception:
                    pass

                page.evaluate("window.scrollBy(0, Math.random() * 300)")
                time.sleep(random.uniform(1, 2))
            except Exception as e:
                log(f"Cookie warming issue (continuing): {e}")

            # Step 2: Login if credentials available
            if ba_username and ba_password:
                log("Logging in to BA Executive Club...")
                logged_in = ba_login(page, ba_username, ba_password)
                if logged_in:
                    log("Login successful!")
                else:
                    log("Login failed — continuing without login")

            # Step 3: Navigate to redemption search
            search_url = (
                "https://www.britishairways.com/travel/redeem/execclub/_gf/en_us"
                "?eId=106019&tab_selected=redeem&redemption_type=STD_RED"
            )

            log(f"Navigating to redemption search...")
            try:
                page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.uniform(2, 4))
            except Exception as e:
                log(f"Navigation to redeem page: {e}")

            page_content = page.content().lower()
            current_url = page.url.lower()

            # Check if we got redirected to login
            needs_login = (
                "execloginrform" in page_content
                or ("log in" in page_content[:2000] and "ba-input" in page_content)
                or "/login" in current_url
            )

            if needs_login and not ba_username:
                log("Login required but no credentials — cannot search BA award flights")
                log("Set BA_EXEC_CLUB_NUMBER and BA_EXEC_CLUB_PASSWORD env vars")
                print("[]")
                sys.exit(0)
            elif needs_login and ba_username:
                # Try login on the redirect page
                log("Redirected to login — trying inline login...")
                logged_in = ba_login(page, ba_username, ba_password)
                if not logged_in:
                    log("Inline login failed")
                    print("[]")
                    sys.exit(0)
                # Re-navigate after login
                page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.uniform(2, 4))

            # Now fill and submit the search form
            log("Filling search form...")
            results = try_classic_flow(page, origin, destination, date, cabin_code, cabin, passengers, intercepted_responses)

            # If classic didn't work, try intercepted responses
            if not results and intercepted_responses:
                log(f"Parsing {len(intercepted_responses)} intercepted API responses...")
                results = parse_intercepted_responses(intercepted_responses, origin, destination, date, cabin)

            log(f"Found {len(results)} results")

            # Add booking URL to all results
            booking_url = (
                f"https://www.britishairways.com/travel/redeem/execclub/_gf/en_us"
                f"?eId=106019&tab_selected=redeem&redemption_type=STD_RED"
            )
            for r in results:
                r["bookingUrl"] = booking_url

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    print(json.dumps(results))


def ba_login(page, username, password):
    """Login to BA Executive Club. Returns True on success.

    BA now uses Auth0 (accounts.britishairways.com) for login.
    Fields: #username (membership number), #password, submit via 'Continue' button.
    """
    try:
        # Try multiple login page strategies
        login_urls = [
            "https://www.britishairways.com/travel/loginr/public/en_us",
            "https://accounts.britishairways.com/u/login",
        ]

        # First check if we're already on a login page
        username_field = find_login_field(page)
        password_field = find_password_field(page)

        if not username_field or not password_field:
            # Navigate to login page
            for url in login_urls:
                try:
                    page.goto(url, timeout=20000, wait_until="domcontentloaded")
                    time.sleep(random.uniform(3, 5))

                    username_field = find_login_field(page)
                    password_field = find_password_field(page)

                    if username_field and password_field:
                        log(f"Login form found at {page.url[:60]}")
                        break
                except Exception:
                    continue

        if not username_field or not password_field:
            log("Could not find login form fields")
            # Debug: show what inputs exist
            try:
                inputs = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('input'))
                        .filter(e => e.offsetParent !== null)
                        .map(e => ({type: e.type, id: e.id || '', name: e.name || ''}));
                }""")
                log(f"Available inputs: {json.dumps(inputs[:8])}")
            except:
                pass
            return False

        # Type credentials with human-like delays
        username_field.click()
        time.sleep(random.uniform(0.2, 0.5))
        username_field.fill(username)
        time.sleep(random.uniform(0.3, 0.7))

        password_field.click()
        time.sleep(random.uniform(0.2, 0.5))
        password_field.fill(password)
        time.sleep(random.uniform(0.3, 0.7))

        # Find and click login/submit button
        submit_selectors = [
            'button[type="submit"]:not(#onetrust-accept-btn-handler)',
            'button:has-text("Continue")',
            'button:has-text("Log in")',
            'button:has-text("Sign in")',
            '#ecuserlogbutton',
        ]
        clicked = False
        for sel in submit_selectors:
            try:
                btn = page.query_selector(sel)
                if btn and btn.is_visible():
                    btn.click()
                    clicked = True
                    log(f"Clicked submit: {sel}")
                    break
            except:
                continue

        if not clicked:
            password_field.press("Enter")

        # Wait for navigation/login to complete
        time.sleep(random.uniform(6, 10))

        # Check if login succeeded
        page_text = page.evaluate("() => document.body?.innerText?.substring(0, 3000) || ''").lower()
        current_url = page.url.lower()

        # Check for CAPTCHA
        if "verify you are human" in page_text or "captcha" in page_text:
            log("CAPTCHA detected — exit for retry with new fingerprint")
            sys.exit(1)

        if "my account" in page_text or "welcome" in page_text or "member" in page_text:
            return True
        if "incorrect" in page_text or "invalid" in page_text or "not recognised" in page_text:
            log("Login credentials rejected")
            return False
        # If we're no longer on the login page, assume success
        if "/login" not in current_url and "loginr" not in current_url and "accounts." not in current_url:
            return True

        return False
    except Exception as e:
        log(f"Login error: {e}")
        return False


def find_login_field(page):
    """Find the username/membership number field across different BA login page versions."""
    selectors = [
        '#username',           # Auth0 (accounts.britishairways.com)
        '#ba-input-0',         # Legacy BA login
        '#membershipNumber',   # Legacy BA login
        'input[name="membershipNumber"]',
        'input[name="username"]',
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                return el
        except:
            continue
    return None


def find_password_field(page):
    """Find the password field across different BA login page versions."""
    selectors = [
        '#password',           # Auth0
        '#ba-input-1',         # Legacy BA
        '#input_password',     # Legacy BA
        'input[name="password"]',
        'input[type="password"]',
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                return el
        except:
            continue
    return None


def try_classic_flow(page, origin, destination, date, cabin_code, cabin, passengers, intercepted_responses):
    """Try BA's classic redemption form at /travel/redeem/execclub/"""
    results = []
    try:
        # Parse date
        dt = datetime.strptime(date, "%Y-%m-%d")
        date_formatted = dt.strftime("%m/%d/%y")  # MM/DD/YY

        # Fill the form via JavaScript
        page.evaluate(f"""() => {{
            // Set form values
            const setVal = (name, val) => {{
                const el = document.getElementsByName(name)[0];
                if (el) {{ el.value = val; el.dispatchEvent(new Event('change')); }}
            }};
            setVal('departurePoint', '{origin}');
            setVal('destinationPoint', '{destination}');
            setVal('departInputDate', '{date_formatted}');
            setVal('CabinCode', '{cabin_code}');
            setVal('NumberOfAdults', '{passengers}');
            setVal('NumberOfYoungAdults', '0');
            setVal('NumberOfChildren', '0');
            setVal('NumberOfInfants', '0');

            // Set one-way
            const oneWay = document.getElementsByName('oneWay')[0];
            if (oneWay) {{ oneWay.checked = true; oneWay.value = 'true'; }}

            // Disable return date
            const retDate = document.getElementsByName('returnInputDate')[0];
            if (retDate) retDate.disabled = true;
        }}""")

        time.sleep(random.uniform(0.5, 1))

        # Submit the form
        log("Submitting search form...")
        page.evaluate("""() => {
            const form = document.getElementById('plan_redeem_trip') ||
                         document.querySelector('form[name="plan_redeem_trip"]') ||
                         document.querySelector('form');
            if (form) form.submit();
        }""")

        # Wait for results
        try:
            page.wait_for_selector(
                '#flt_selection_form, .direct-flight-details, .connecting-flights, '
                '#noStopovers, #captcha_form, #blsErrors',
                timeout=45000
            )
        except Exception:
            log("Timeout waiting for results")
            time.sleep(5)

        # Handle stopover prompt
        if page.query_selector('#noStopovers'):
            log("Stopover prompt — selecting no stopovers")
            page.click('#noStopovers')
            time.sleep(0.5)
            try:
                page.click('#continueTopPod')
            except Exception:
                pass
            time.sleep(3)

        # Check for captcha
        if page.query_selector('#captcha_form'):
            log("CAPTCHA detected — exit for retry with new fingerprint")
            sys.exit(1)

        # Check for errors
        error_el = page.query_selector('#blsErrors li')
        if error_el:
            error_text = error_el.text_content()
            log(f"BA error: {error_text}")
            return []

        # Parse results from DOM
        if page.query_selector('#flt_selection_form'):
            results = parse_classic_results(page, origin, destination, date, cabin)

    except Exception as e:
        log(f"Classic flow error: {e}")

    return results


def parse_classic_results(page, origin, destination, date, cabin):
    """Parse BA's classic results page DOM"""
    results = page.evaluate("""(params) => {
        const flights = [];
        const airline_names = {
            'BA': 'British Airways', 'CX': 'Cathay Pacific', 'JL': 'Japan Airlines',
            'QR': 'Qatar Airways', 'AA': 'American Airlines', 'QF': 'Qantas',
            'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
            'RJ': 'Royal Jordanian', 'UL': 'SriLankan Airlines', 'AT': 'Royal Air Maroc',
            'EI': 'Aer Lingus', 'FJ': 'Fiji Airways', 'AS': 'Alaska Airlines',
        };

        // Parse both direct and connecting flights
        const sections = document.querySelectorAll('.direct-flight-details, .connecting-flights');
        sections.forEach(section => {
            const segments = [];
            section.querySelectorAll('.travel-time-detail').forEach(seg => {
                const airports = seg.querySelectorAll('p.airport-code');
                const from = airports[0]?.textContent?.trim() || '';
                const to = airports[1]?.textContent?.trim() || '';
                const depTime = seg.querySelector('p.departtime')?.textContent?.trim() || '';
                const arrTime = seg.querySelector('p.arrivaltime')?.textContent?.trim() || '';
                const flightInfo = seg.querySelector('p.career-and-flight')?.textContent?.trim() || '';
                const parts = flightInfo.split('-');
                const flightNum = parts[parts.length - 1]?.trim() || '';
                segments.push({ from, to, depTime, arrTime, flightNum });
            });

            // Get cabin availability
            section.querySelectorAll('div[class^="flightCabin"]').forEach(cabinDiv => {
                const available = cabinDiv.querySelector('label.txtAvlSlctCls');
                if (!available) return;  // Not available

                const travelClass = cabinDiv.querySelector('.travel-class')?.textContent?.trim() || '';
                const seatsMsg = cabinDiv.querySelector('.message-number-of-seats')?.textContent?.trim() || '';
                const seatsMatch = seatsMsg.match(/(\\d+)\\s+left/i);
                const seatsLeft = seatsMatch ? parseInt(seatsMatch[1]) : null;

                // Determine cabin
                let cabinName = 'economy';
                if (travelClass.includes('First')) cabinName = 'first';
                else if (travelClass.includes('Business')) cabinName = 'business';
                else if (travelClass.includes('Premium')) cabinName = 'premium';

                const allFlightNums = segments.map(s => s.flightNum).filter(Boolean);
                const primaryFlight = allFlightNums[0] || '';
                const airlineCode = primaryFlight.substring(0, 2);
                const stops = Math.max(0, segments.length - 1);

                flights.push({
                    source: 'ba-avios',
                    airline: airline_names[airlineCode] || airlineCode,
                    flightNumber: allFlightNums.join(', '),
                    origin: segments[0]?.from || params.origin,
                    destination: segments[segments.length - 1]?.to || params.destination,
                    departureDate: params.date,
                    departureTime: segments[0]?.depTime || '',
                    arrivalTime: segments[segments.length - 1]?.arrTime || '',
                    duration: '',
                    stops: stops,
                    cabin: cabinName,
                    pointsProgram: 'Avios',
                    awardType: airlineCode === 'BA' ? 'saver' : 'partner',
                    seatsRemaining: seatsLeft,
                    scrapedAt: new Date().toISOString(),
                    metadata: {
                        allFlightNumbers: allFlightNums,
                        segments: segments,
                    },
                });
            });
        });
        return flights;
    }""", {"origin": origin, "destination": destination, "date": date, "cabin": cabin})
    return results


def try_modern_flow(page, origin, destination, date, cabin_code, passengers, intercepted_responses):
    """Try BA's modern booking flow with reward toggle"""
    results = []
    try:
        # Navigate to modern booking page
        url = (
            f"https://www.britishairways.com/travel/book/public/en_us"
            f"?from={origin}&to={destination}&depDate={date}"
            f"&cabin={cabin_code}&adult={passengers}&child=0&infant=0"
            f"&type=AVIOS&directFlights=false"
        )
        log(f"Trying modern URL: {url[:100]}...")
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        time.sleep(random.uniform(3, 5))

        # Accept cookies again if needed
        try:
            cookie_btn = page.query_selector(
                '#onetrust-accept-btn-handler, button:has-text("Accept")'
            )
            if cookie_btn and cookie_btn.is_visible():
                cookie_btn.click()
                time.sleep(1)
        except Exception:
            pass

        # Check if we landed on a search form or results
        page_text = page.evaluate("() => document.body?.innerText?.substring(0, 3000) || ''")

        if "log in" in page_text.lower() or "sign in" in page_text.lower():
            log("Modern flow also requires login")
            return []

        # Look for reward/avios toggle if on booking form
        try:
            avios_toggle = page.query_selector(
                '[data-testid="avios-toggle"], '
                'button:has-text("Pay with Avios"), '
                'label:has-text("Pay with Avios"), '
                'input[value="AVIOS"], '
                '#bookingType-avios, '
                '.avios-toggle'
            )
            if avios_toggle:
                avios_toggle.click()
                log("Clicked Avios toggle")
                time.sleep(1)
        except Exception:
            pass

        # Wait for results
        time.sleep(random.uniform(3, 6))

        # Try to find flight results in the modern UI
        page_content = page.content()

        # Check for blocked/error states
        lower_content = page_content.lower()
        if "access denied" in lower_content or "blocked" in lower_content:
            log("Blocked by bot detection — exit for retry")
            sys.exit(1)
        if "no flights" in lower_content or "no availability" in lower_content:
            log("No availability (legitimate)")
            return []

        # Try parsing modern results
        results = parse_modern_results(page, origin, destination, date)

    except Exception as e:
        log(f"Modern flow error: {e}")

    return results


def parse_modern_results(page, origin, destination, date):
    """Try to parse BA's modern React/Angular-based results page"""
    results = page.evaluate("""(params) => {
        const flights = [];
        const airline_names = {
            'BA': 'British Airways', 'CX': 'Cathay Pacific', 'JL': 'Japan Airlines',
            'QR': 'Qatar Airways', 'AA': 'American Airlines', 'QF': 'Qantas',
            'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
            'RJ': 'Royal Jordanian', 'AS': 'Alaska Airlines',
        };

        // Try various selectors for modern BA UI
        const cards = document.querySelectorAll(
            '[class*="flight-card"], [class*="FlightCard"], [class*="flight-result"], ' +
            '[class*="journey-option"], [class*="flight-option"], [data-testid*="flight"], ' +
            '[class*="flightList"] > div, .flight-list-item'
        );

        cards.forEach(card => {
            const text = card.textContent || '';

            // Extract flight numbers
            const flightMatches = text.match(/\\b([A-Z]{2})\\s*(\\d{1,4})\\b/g) || [];
            const flightNums = flightMatches.map(m => m.replace(/\\s+/g, ''));
            if (flightNums.length === 0) return;

            // Extract times (HH:MM patterns)
            const times = text.match(/\\b(\\d{1,2}:\\d{2})\\b/g) || [];
            const depTime = times[0] || '';
            const arrTime = times[1] || '';

            // Extract Avios
            const aviosMatch = text.match(/([\\d,]+)\\s*(?:Avios|avios)/i);
            const points = aviosMatch ? parseInt(aviosMatch[1].replace(/,/g, '')) : null;

            // Extract price/tax
            const priceMatch = text.match(/[£$€]\\s*([\\d,.]+)/);
            const taxes = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

            // Duration
            const durMatch = text.match(/(\\d+)\\s*h\\s*(\\d+)?\\s*m?/);
            const duration = durMatch ? `${durMatch[1]}h ${durMatch[2] || '0'}m` : '';

            // Stops
            const stopsMatch = text.match(/(non-?stop|direct|(\\d+)\\s*stop)/i);
            let stops = 0;
            if (stopsMatch) {
                if (stopsMatch[2]) stops = parseInt(stopsMatch[2]);
                else if (stopsMatch[1].toLowerCase().includes('non') || stopsMatch[1].toLowerCase() === 'direct') stops = 0;
            }

            // Cabin
            let cabin = 'economy';
            if (/first/i.test(text)) cabin = 'first';
            else if (/business|club world/i.test(text)) cabin = 'business';
            else if (/premium/i.test(text)) cabin = 'premium';

            const primaryCode = flightNums[0]?.substring(0, 2) || 'BA';

            flights.push({
                source: 'ba-avios',
                airline: airline_names[primaryCode] || primaryCode,
                flightNumber: flightNums.join(', '),
                origin: params.origin,
                destination: params.destination,
                departureDate: params.date,
                departureTime: depTime,
                arrivalTime: arrTime,
                duration: duration,
                stops: stops,
                cabin: cabin,
                pointsRequired: points,
                pointsProgram: 'Avios',
                taxesAndFees: taxes,
                awardType: primaryCode === 'BA' ? 'saver' : 'partner',
                scrapedAt: new Date().toISOString(),
                metadata: { allFlightNumbers: flightNums },
            });
        });

        return flights;
    }""", {"origin": origin, "destination": destination, "date": date})
    return results


def try_direct_url(page, origin, destination, date, cabin_code, cabin, passengers, intercepted_responses):
    """Try BA's direct search URL patterns"""
    results = []

    # Try multiple URL patterns
    urls_to_try = [
        # Pattern 1: Modern flights page
        f"https://www.britishairways.com/flights/{origin.lower()}-to-{destination.lower()}",
        # Pattern 2: Calendar/availability view
        f"https://www.britishairways.com/travel/fx/public/en_us?"
        f"from={origin}&to={destination}&depDate={date}&cabin={cabin_code}"
        f"&paxMix=ADT{passengers}&type=reward",
    ]

    for url in urls_to_try:
        try:
            log(f"Trying URL: {url[:100]}...")
            page.goto(url, timeout=20000, wait_until="domcontentloaded")
            time.sleep(random.uniform(3, 5))

            content = page.content().lower()
            if "access denied" in content or "blocked" in content:
                log("Blocked")
                continue

            results = parse_modern_results(page, origin, destination, date)
            if results:
                break

        except Exception as e:
            log(f"URL attempt failed: {e}")
            continue

    return results


def parse_intercepted_responses(intercepted_responses, origin, destination, date, cabin):
    """Parse flight data from intercepted API responses"""
    results = []
    airline_names = {
        'BA': 'British Airways', 'CX': 'Cathay Pacific', 'JL': 'Japan Airlines',
        'QR': 'Qatar Airways', 'AA': 'American Airlines', 'QF': 'Qantas',
        'IB': 'Iberia', 'AY': 'Finnair', 'MH': 'Malaysia Airlines',
        'RJ': 'Royal Jordanian', 'AS': 'Alaska Airlines',
    }

    for resp in intercepted_responses:
        try:
            data = json.loads(resp["body"])
        except (json.JSONDecodeError, KeyError):
            continue

        # Try to find flight arrays in the response
        flight_arrays = find_flight_arrays(data)

        for flights in flight_arrays:
            for flight in flights:
                if not isinstance(flight, dict):
                    continue
                try:
                    # Try to extract standard flight fields
                    airline_code = (
                        flight.get("carrier") or
                        flight.get("airlineCode") or
                        flight.get("marketingCarrier") or
                        flight.get("operatingCarrier") or
                        "BA"
                    )
                    flight_num = (
                        flight.get("flightNumber") or
                        flight.get("flight") or
                        f"{airline_code}{flight.get('number', '')}"
                    )
                    dep_time = (
                        flight.get("departureTime") or
                        flight.get("departure") or
                        flight.get("depTime") or
                        ""
                    )
                    arr_time = (
                        flight.get("arrivalTime") or
                        flight.get("arrival") or
                        flight.get("arrTime") or
                        ""
                    )
                    points = (
                        flight.get("avios") or
                        flight.get("points") or
                        flight.get("miles") or
                        flight.get("cost") or
                        None
                    )
                    taxes = (
                        flight.get("tax") or
                        flight.get("taxes") or
                        flight.get("cashAmount") or
                        flight.get("surcharge") or
                        None
                    )
                    stops = flight.get("stops", flight.get("numberOfStops", 0))
                    duration = flight.get("duration", flight.get("journeyTime", ""))

                    results.append({
                        "source": "ba-avios",
                        "airline": airline_names.get(airline_code, airline_code),
                        "flightNumber": flight_num,
                        "origin": flight.get("origin", origin),
                        "destination": flight.get("destination", destination),
                        "departureDate": date,
                        "departureTime": dep_time,
                        "arrivalTime": arr_time,
                        "duration": str(duration),
                        "stops": stops,
                        "cabin": cabin,
                        "pointsRequired": points,
                        "pointsProgram": "Avios",
                        "taxesAndFees": taxes,
                        "awardType": "partner" if airline_code != "BA" else "saver",
                        "scrapedAt": datetime.utcnow().isoformat() + "Z",
                        "metadata": {"interceptedFrom": resp["url"][:200]},
                    })
                except Exception:
                    continue

    return results


def find_flight_arrays(data, depth=0):
    """Recursively search for arrays of flight-like objects in JSON data"""
    if depth > 5:
        return []

    arrays = []

    if isinstance(data, list) and len(data) > 0:
        # Check if this looks like a flight array
        if isinstance(data[0], dict):
            flight_keys = {"carrier", "airlineCode", "flightNumber", "flight",
                          "departureTime", "departure", "origin", "dest",
                          "avios", "cabin", "marketingCarrier"}
            sample_keys = set(data[0].keys())
            if sample_keys & flight_keys:
                arrays.append(data)

    if isinstance(data, dict):
        for key, value in data.items():
            arrays.extend(find_flight_arrays(value, depth + 1))
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, (dict, list)):
                arrays.extend(find_flight_arrays(item, depth + 1))

    return arrays


if __name__ == "__main__":
    main()
