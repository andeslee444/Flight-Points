#!/usr/bin/env python3
"""
Air France / KLM Flying Blue Award Search via real Chrome CDP.

Launches Chrome normally with --remote-debugging-port and connects via
Patchright CDP. This bypasses Akamai because Chrome has no automation flags.

Requires one-time login (session persists in Chrome profile at
~/.flight-points/chrome-profiles/chrome-cdp-flyingblue/, override via CHROME_CDP_PROFILE_DIR).
Login uses OTP via email — run with 'login' arg for interactive login:
  python3 flying-blue-cdp.py login

Normal search usage:
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

CABIN_MAP = {"economy": "ECONOMY", "premium": "PREMIUM", "business": "BUSINESS", "first": "FIRST"}
CABIN_LABELS = {"economy": "Economy", "premium": "Premium", "business": "Business", "first": "La Premi"}

def dismiss_cookies(page):
    """Dismiss the Air France cookie banner."""
    page.evaluate('''() => {
        const b = document.querySelector('#bw-cookie-banner');
        if (b) { const btn = b.querySelector('button'); if (btn) btn.click(); }
        document.querySelectorAll('#bw-cookie-banner, [class*="cookie-banner"],[id*="didomi"],[class*="consent"]').forEach(e => e.remove());
    }''')

def is_logged_in(page):
    """Check if user is logged in by looking for their name in the header."""
    header = page.evaluate("() => document.body?.innerText?.substring(0, 300) || ''")
    # When logged in, the header shows the user's name (e.g., "HARBOR OCTOPUS")
    # When not logged in, it shows "Log in" button text
    return 'harbor' in header.lower() or ('log in' not in header.lower() and len(header) > 50)


def do_login(page):
    """Interactive login flow with OTP. Only needed when session has expired."""
    log("Starting login flow...")

    # Open auth menu dropdown
    page.evaluate('''() => {
        const authMenu = document.querySelector('[class*="auth-menu"]');
        if (authMenu) { authMenu.click(); return; }
        for (const e of document.querySelectorAll('button, a')) {
            if (e.textContent.trim().toLowerCase() === 'log in' && e.offsetParent !== null) {
                e.click(); return;
            }
        }
    }''')
    time.sleep(2)

    # Click inner "Log in" in dropdown overlay
    page.evaluate('''() => {
        const overlay = document.querySelector('.cdk-overlay-pane');
        if (overlay) {
            for (const btn of overlay.querySelectorAll('button, a')) {
                if (btn.textContent.trim().toLowerCase() === 'log in') {
                    btn.click(); return;
                }
            }
        }
    }''')
    time.sleep(5)

    # Should be on identity.airfranceklm.com/login/otp
    # Click "Log in with your password instead?"
    page.evaluate('''() => {
        for (const a of document.querySelectorAll('a, button')) {
            if ((a.textContent || '').toLowerCase().includes('password instead')) {
                a.click(); return;
            }
        }
    }''')
    time.sleep(3)

    # Fill credentials
    email = os.environ.get('FB_LOGIN_EMAIL', 'harbortheoctopus@gmail.com')
    password = os.environ.get('FB_LOGIN_PASSWORD', 'Cheeseslice8!')

    try:
        page.fill('input[name="jloginId"]', email, timeout=5000)
        page.fill('input[name="jpassword"]', password, timeout=5000)
    except Exception as e:
        log(f"Could not fill login form: {e}")
        return False

    time.sleep(1)

    # Submit login
    page.evaluate('''() => {
        for (const b of document.querySelectorAll('button[type="submit"], button')) {
            const t = b.textContent.trim().toLowerCase();
            if (t === 'log in' && b.offsetParent !== null) { b.click(); return; }
        }
    }''')
    time.sleep(5)

    # Check if OTP is required
    body = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
    if 'pin' in body.lower() or 'one-time' in body.lower() or 'verification' in body.lower():
        log("OTP required! Sending email OTP...")

        # Select email option and click send
        page.evaluate('''() => {
            const radios = document.querySelectorAll('input[type="radio"]');
            for (const r of radios) {
                const label = r.closest('label') || r.parentElement;
                if (label && (label.textContent || '').toLowerCase().includes('email')) {
                    r.click(); break;
                }
            }
        }''')
        time.sleep(1)
        page.evaluate('''() => {
            for (const b of document.querySelectorAll('button')) {
                const t = b.textContent.trim().toLowerCase();
                if ((t.includes('continue') || t.includes('send')) && b.offsetParent !== null) {
                    b.click(); return;
                }
            }
        }''')
        time.sleep(3)

        # Wait for OTP from file
        otp_file = '/tmp/fb-otp.txt'
        log(f"Waiting for OTP... Write 6-digit code to {otp_file}")
        # Clear any old OTP
        try:
            os.remove(otp_file)
        except:
            pass

        otp = None
        for i in range(120):  # 2 minute timeout
            try:
                with open(otp_file, 'r') as f:
                    code = f.read().strip()
                    if len(code) >= 6 and code[:6].isdigit():
                        otp = code[:6]
                        break
            except FileNotFoundError:
                pass
            time.sleep(1)

        if not otp:
            log("OTP timeout — no code provided")
            return False

        log(f"Entering OTP: {otp}")
        dismiss_cookies(page)

        # Fill OTP via JS (avoids cookie banner click interception)
        filled = page.evaluate(f'''() => {{
            document.querySelectorAll('#bw-cookie-banner').forEach(e => e.remove());
            const inputs = Array.from(document.querySelectorAll('input[type="tel"]'))
                .filter(i => i.offsetParent !== null);
            const otp = '{otp}';
            if (inputs.length < 6) return 'only ' + inputs.length + ' inputs';
            for (let i = 0; i < 6; i++) {{
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                setter.call(inputs[i], otp[i]);
                inputs[i].dispatchEvent(new Event('input', {{ bubbles: true }}));
                inputs[i].dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            return inputs.map(i => i.value).join('');
        }}''')
        log(f"OTP filled: {filled}")

        if filled and len(filled) < 6:
            log("OTP fill failed")
            return False

        time.sleep(0.5)

        # Tick "Keep me logged in"
        page.evaluate('''() => {
            const c = document.querySelector('input[type="checkbox"]');
            if (c && !c.checked) c.click();
        }''')
        time.sleep(0.3)

        # Submit OTP
        dismiss_cookies(page)
        page.evaluate('''() => {
            document.querySelectorAll('#bw-cookie-banner').forEach(e => e.remove());
            for (const b of document.querySelectorAll('button')) {
                const t = b.textContent.trim().toLowerCase();
                if ((t === 'continue' || t === 'verify')
                    && b.offsetParent !== null) {
                    b.click(); return;
                }
            }
        }''')
        time.sleep(5)

        # Handle passkey setup page — click "Not now"
        body = page.evaluate("() => document.body?.innerText?.substring(0, 500) || ''")
        if 'passkey' in body.lower() or 'more secure' in body.lower() or 'faster' in body.lower():
            dismiss_cookies(page)
            page.evaluate('''() => {
                document.querySelectorAll('#bw-cookie-banner').forEach(e => e.remove());
                for (const b of document.querySelectorAll('button')) {
                    if (b.textContent.trim().toLowerCase() === 'not now') {
                        b.click(); return;
                    }
                }
            }''')
            time.sleep(3)

    # Navigate back to homepage
    page.goto("https://wwws.airfrance.us/", timeout=30000, wait_until="load")
    time.sleep(3)
    dismiss_cookies(page)

    return is_logged_in(page)


def navigate_to_month(page, target_year, target_month):
    """Navigate the calendar to the target month. target_month is 1-12."""
    month_names = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December']
    target_name = month_names[target_month]

    # Click the month label in the horizontal month strip
    clicked = page.evaluate(f'''() => {{
        const items = document.querySelectorAll('button, a, span, div, li');
        for (const m of items) {{
            const t = (m.textContent || '').trim();
            if (t === '{target_name}' && m.offsetParent !== null) {{
                m.click();
                return true;
            }}
        }}
        return false;
    }}''')

    if clicked:
        log(f"Clicked {target_name} in month strip")
        time.sleep(3)
        return True

    log(f"Could not find {target_name} in month strip")
    return False


def click_date(page, day):
    """Click a specific day number in the calendar."""
    day_str = str(day)
    result = page.evaluate(f'''() => {{
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {{
            if (b.offsetParent === null) continue;
            const text = (b.textContent || '').trim();
            if (text.substring(0, {len(day_str)}) === '{day_str}') {{
                b.click();
                return 'clicked';
            }}
        }}
        const tds = document.querySelectorAll('td');
        for (const td of tds) {{
            if (td.offsetParent === null) continue;
            const text = (td.textContent || '').trim();
            if (text.substring(0, {len(day_str)}) === '{day_str}') {{
                const clickable = td.querySelector('button') || td.querySelector('a') || td;
                clickable.click();
                return 'clicked td';
            }}
        }}
        return 'not found';
    }}''')

    log(f"Click day {day}: {result}")
    return result != 'not found'


def parse_flights_from_dom(page, origin, destination, date, cabin, booking_url):
    """Parse flight results from the DOM text after individual flights are displayed."""
    results = []

    body = page.evaluate("() => document.body?.innerText || ''")

    # Parse individual flight blocks from body text
    # Pattern: HH:MM\nORIGIN\nDirect/1 stop\nXhYY\n[+1 day ]\nHH:MM\nDEST\nDetails\nEconomy\nXX,XXX Miles\n...
    lines = body.split('\n')
    lines = [l.strip() for l in lines if l.strip()]

    flights = []
    i = 0
    while i < len(lines):
        # Look for departure time pattern (HH:MM)
        time_match = re.match(r'^(\d{1,2}:\d{2})$', lines[i])
        if time_match and i + 5 < len(lines):
            dep_time = time_match.group(1)
            # Check if next line is origin airport (must match search origin)
            if lines[i+1] == origin:
                dep_airport = lines[i+1]
                # Look for Direct or X stop(s)
                stops_line = lines[i+2].lower()
                stops = 0
                if 'direct' in stops_line or 'nonstop' in stops_line:
                    stops = 0
                elif '1 stop' in stops_line:
                    stops = 1
                elif '2 stop' in stops_line:
                    stops = 2

                # Duration (XhYY)
                duration = ''
                dur_match = re.match(r'^(\d+h\d*m?)$', lines[i+3], re.I)
                if dur_match:
                    duration = dur_match.group(1)

                # Find arrival time — may have "+1 day" prefix
                arr_idx = i + 4
                arr_time = ''
                if arr_idx < len(lines) and '+1 day' in lines[arr_idx].lower():
                    arr_idx += 1
                if arr_idx < len(lines):
                    arr_match = re.match(r'^(\d{1,2}:\d{2})$', lines[arr_idx])
                    if arr_match:
                        arr_time = arr_match.group(1)
                        arr_idx += 1

                # Destination airport
                arr_airport = ''
                if arr_idx < len(lines) and re.match(r'^[A-Z]{3}$', lines[arr_idx]):
                    arr_airport = lines[arr_idx]
                    arr_idx += 1

                # Now parse cabin/miles data
                cabins = {}
                j = arr_idx
                current_cabin = None
                while j < len(lines) and j < arr_idx + 30:
                    line = lines[j]
                    line_lower = line.lower()

                    if line_lower in ('economy', 'premium', 'business'):
                        current_cabin = line_lower
                    elif line_lower.startswith('la premi'):
                        current_cabin = 'first'
                    elif current_cabin and 'miles' in line_lower:
                        miles_match = re.match(r'^([\d,]+)\s*Miles', line, re.I)
                        if miles_match:
                            miles = int(miles_match.group(1).replace(',', ''))
                            cabins[current_cabin] = miles
                            current_cabin = None
                    # Stop at next flight block or section boundary
                    elif re.match(r'^\d{1,2}:\d{2}$', line) and j > arr_idx + 2:
                        # Only break if the next line looks like an origin airport
                        if j + 1 < len(lines) and lines[j+1] == origin:
                            break
                    elif line.startswith('Connecting') or line.startswith('Sort by'):
                        break

                    j += 1

                if cabins:
                    flights.append({
                        'dep_time': dep_time,
                        'arr_time': arr_time,
                        'dep_airport': dep_airport,
                        'arr_airport': arr_airport,
                        'stops': stops,
                        'duration': duration,
                        'cabins': cabins,
                    })
                    # Skip past the parsed block to avoid re-parsing arrival time
                    i = j
                    continue

        i += 1

    log(f"Parsed {len(flights)} flights from DOM")

    # Convert to FlightResult format
    for flight in flights:
        for cabin_name, miles in flight['cabins'].items():
            results.append({
                "source": "flying-blue",
                "airline": "Air France",  # Could also be KLM, Delta etc.
                "flightNumber": "",
                "origin": origin,
                "destination": destination,
                "departureDate": date,
                "departureTime": flight['dep_time'],
                "arrivalTime": flight['arr_time'],
                "duration": flight['duration'],
                "stops": flight['stops'],
                "cabin": cabin_name,
                "pointsRequired": miles,
                "pointsProgram": "Flying Blue",
                "taxesAndFees": 0,
                "awardType": "saver",
                "scrapedAt": datetime.datetime.utcnow().isoformat() + "Z",
                "bookingUrl": booking_url,
            })

    return results


def parse_gql_offers(data, origin, destination, date, booking_url):
    """Parse SearchResultAvailableOffersQuery GQL response."""
    results = []
    try:
        if not isinstance(data, dict) or 'data' not in data:
            return results
        inner = data['data']
        if not isinstance(inner, dict):
            return results

        # The structure varies — look for any list of offers/connections
        for key, val in inner.items():
            if isinstance(val, dict):
                for k2, v2 in val.items():
                    if isinstance(v2, list) and len(v2) > 0:
                        for item in v2:
                            if not isinstance(item, dict):
                                continue
                            # Try to extract flight data
                            segments = item.get('segments', item.get('connections', []))
                            if isinstance(segments, list):
                                for seg in segments:
                                    if not isinstance(seg, dict):
                                        continue
                                    miles = None
                                    taxes = 0
                                    cabin = 'economy'
                                    # Look for price/miles fields
                                    price = seg.get('price', seg.get('displayPrice', {}))
                                    if isinstance(price, dict):
                                        if price.get('currencyCode') == 'MILES':
                                            miles = price.get('amount')
                                    if isinstance(miles, (int, float)) and miles > 0:
                                        tax_obj = seg.get('tax', {})
                                        if isinstance(tax_obj, dict):
                                            taxes = tax_obj.get('amount', 0)
                                        results.append({
                                            "source": "flying-blue",
                                            "airline": "Air France",
                                            "flightNumber": "",
                                            "origin": origin,
                                            "destination": destination,
                                            "departureDate": date,
                                            "departureTime": "",
                                            "arrivalTime": "",
                                            "duration": "",
                                            "stops": 0,
                                            "cabin": cabin,
                                            "pointsRequired": int(miles),
                                            "pointsProgram": "Flying Blue",
                                            "taxesAndFees": float(taxes),
                                            "awardType": "saver",
                                            "scrapedAt": datetime.datetime.utcnow().isoformat() + "Z",
                                            "bookingUrl": booking_url,
                                        })
    except Exception as e:
        log(f"GQL parse error: {e}")
    return results


def search_flights(params):
    """Main search flow."""
    origin = params["origin"]
    destination = params["destination"]
    date = params["date"]
    cabin = params.get("cabin", "business")

    # Parse date for calendar navigation
    dt = datetime.datetime.strptime(date, "%Y-%m-%d")
    target_year = dt.year
    target_month = dt.month
    target_day = dt.day

    booking_url = (
        f"https://wwws.airfrance.us/?bookingFlow=REWARD"
        f"&origin={origin}&destination={destination}&outboundDate={date}"
        f"&cabinClass={CABIN_MAP.get(cabin, 'BUSINESS')}&tripType=ONE_WAY"
        f"&pax=1:0:0:0:0:0:0:0"
    )

    log(f"Search: {origin}→{destination} {date} {cabin}")

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    results = []
    gql_offers = []

    try:
        browser, context, page, cleanup = create_cdp_browser("flyingblue")
    except Exception as e:
        log(f"Failed to launch Chrome: {e}")
        return []

    try:
        # Intercept GQL responses for structured data
        def handle_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            status = response.status
            if "json" in ct and status == 200 and 'gql' in url:
                try:
                    body = response.text()
                    if len(body) > 50000:
                        data = json.loads(body)
                        op = ""
                        if "operationName=" in url:
                            op = url.split("operationName=")[1].split("&")[0]
                        if 'AvailableOffers' in op or 'ResultOffer' in op:
                            gql_offers.append(data)
                            log(f"Captured GQL: {op} ({len(body)} bytes)")
                except:
                    pass
        page.on("response", handle_response)

        # Step 1: Load homepage and check login
        log("Loading airfrance.us...")
        page.goto("https://wwws.airfrance.us/", timeout=30000, wait_until="load")
        time.sleep(4)
        dismiss_cookies(page)
        time.sleep(1)

        if not is_logged_in(page):
            log("Not logged in — session may have expired")
            log("Run: python3 flying-blue-cdp.py login")
            return []

        log("Logged in!")

        # Step 2: Click "Book with Miles" tab
        page.evaluate('''() => {
            for (const e of document.querySelectorAll('a, button, [role="tab"]')) {
                if (e.textContent.trim().toLowerCase().includes('book with miles')) {
                    e.click(); return;
                }
            }
        }''')
        time.sleep(2)

        # Step 3: Select "One-way"
        page.evaluate('''() => {
            for (const r of document.querySelectorAll('mat-radio-button')) {
                if (r.textContent.trim().toLowerCase().includes('one-way') && r.offsetParent !== null) {
                    r.click(); return;
                }
            }
        }''')
        time.sleep(1)

        # Step 4: Fill origin
        log(f"Filling {origin}...")
        page.evaluate('''() => {
            for (const i of document.querySelectorAll('input')) {
                if (i.placeholder && i.placeholder.toLowerCase().includes('departing') && i.offsetParent !== null) {
                    i.click(); i.focus(); return;
                }
            }
        }''')
        time.sleep(0.5)
        page.keyboard.type(origin, delay=80)
        time.sleep(2)
        page.evaluate(f'''() => {{
            for (const o of document.querySelectorAll('mat-option, [role="option"]')) {{
                if (o.offsetParent !== null && (o.textContent || '').includes('{origin}')) {{
                    o.click(); return;
                }}
            }}
            for (const o of document.querySelectorAll('mat-option, [role="option"]')) {{
                if (o.offsetParent !== null) {{ o.click(); return; }}
            }}
        }}''')
        time.sleep(1)

        # Step 5: Fill destination
        log(f"Filling {destination}...")
        page.evaluate('''() => {
            for (const i of document.querySelectorAll('input')) {
                if (i.placeholder && i.placeholder.toLowerCase().includes('arriving') && i.offsetParent !== null) {
                    i.click(); i.focus(); return;
                }
            }
        }''')
        time.sleep(0.5)
        page.keyboard.type(destination, delay=80)
        time.sleep(2)
        page.evaluate(f'''() => {{
            for (const o of document.querySelectorAll('mat-option, [role="option"]')) {{
                if (o.offsetParent !== null && (o.textContent || '').includes('{destination}')) {{
                    o.click(); return;
                }}
            }}
            for (const o of document.querySelectorAll('mat-option, [role="option"]')) {{
                if (o.offsetParent !== null) {{ o.click(); return; }}
            }}
        }}''')
        time.sleep(1)

        # Step 6: Click "Search flights"
        log("Searching...")
        page.evaluate('''() => {
            for (const b of document.querySelectorAll('button')) {
                if (b.textContent.trim().toLowerCase().includes('search flights') && b.offsetParent !== null) {
                    b.click(); return;
                }
            }
        }''')
        time.sleep(12)

        # Step 7: Navigate calendar to target month and click target day
        navigate_to_month(page, target_year, target_month)
        time.sleep(2)

        if not click_date(page, target_day):
            log(f"Could not click day {target_day}")
            # Try scrolling the calendar first
            time.sleep(3)
            click_date(page, target_day)

        # Step 8: Wait for flight results to load
        log("Waiting for flight results...")
        time.sleep(15)

        # Step 9: Parse results from DOM
        results = parse_flights_from_dom(page, origin, destination, date, cabin, booking_url)

        # Also try GQL if captured
        if gql_offers and not results:
            for data in gql_offers:
                parsed = parse_gql_offers(data, origin, destination, date, booking_url)
                if parsed:
                    results = parsed
                    log(f"Got {len(results)} from GQL API")
                    break

        # Filter to requested cabin if specific cabin was requested
        if cabin and cabin != 'any' and results:
            cabin_results = [r for r in results if r['cabin'] == cabin]
            if cabin_results:
                log(f"Filtered to {len(cabin_results)} {cabin} results (from {len(results)} total)")
                results = cabin_results
            else:
                log(f"No {cabin} results, returning all {len(results)} cabins")

        log(f"Found {len(results)} results")

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        cleanup()

    return results


def interactive_login():
    """Run interactive login flow (for manual OTP entry)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from chrome_cdp import create_cdp_browser

    browser, context, page, cleanup = create_cdp_browser("flyingblue")
    try:
        page.goto("https://wwws.airfrance.us/", timeout=30000, wait_until="load")
        time.sleep(4)
        dismiss_cookies(page)
        time.sleep(1)

        if is_logged_in(page):
            log("Already logged in!")
            print(json.dumps({"status": "already_logged_in"}))
            return

        success = do_login(page)
        if success:
            log("Login successful!")
            print(json.dumps({"status": "logged_in"}))
        else:
            log("Login failed")
            print(json.dumps({"status": "login_failed"}))
    finally:
        cleanup()


def main():
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)

    # Check for login mode
    if sys.argv[1] == 'login':
        interactive_login()
        return

    params = json.loads(sys.argv[1])
    try:
        validate_params(params)
    except ValueError as e:
        log(f"Validation error: {e}")
        print("[]")
        sys.exit(0)

    results = search_flights(params)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
