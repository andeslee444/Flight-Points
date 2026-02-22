#!/usr/bin/env python3
"""
Delta Award Search via Virgin Atlantic (Patchright).

Same logic as delta-va-camoufox.py but uses Patchright (patched Chromium)
instead of stock Playwright to bypass Akamai/Shape bot detection.

Usage:
  python3 delta-va-patchright.py '{"origin":"JFK","destination":"LAX","date":"2026-03-15","cabin":"business"}'

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
    print(f"[Delta-VA-PR {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

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
    try:
        # Strategy: Extract the login URL directly from the DOM and navigate to it.
        # This bypasses the blanket overlay that intercepts pointer events on the dropdown menu.
        log("Extracting login URL from page...")
        login_url = page.evaluate("""() => {
            const links = document.querySelectorAll('a[href*="identity.virginatlantic.com"]');
            for (const a of links) {
                if (a.href && a.href.includes('oauth2')) return a.href;
            }
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
            log("No login URL found, trying click approach...")
            page.locator('button:has-text("Log in")').first.click(timeout=10000)
            time.sleep(2)

            # Remove blanket overlay that intercepts pointer events
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

        # Wait for the form to be fully rendered
        try:
            page.wait_for_selector("#signInName", state="visible", timeout=15000)
        except:
            log("signInName input not visible")
            return False

        # Clear and type credentials with human-like delays
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

        # Verify fields are filled
        typed_email = page.evaluate('() => document.getElementById("signInName")?.value || ""')
        typed_pwd_len = page.evaluate('() => (document.getElementById("password")?.value || "").length')
        log(f"Filled email: {typed_email}, pwd len: {typed_pwd_len}")

        # Submit - try multiple approaches
        submitted = False
        try:
            # Try clicking the actual submit button by ID first
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
            # Press Enter as fallback
            pwd_input.press("Enter")
            log("Pressed Enter on password field")

        # Wait for redirect (login can take 10-15s)
        time.sleep(12)

        # Check login success - look for redirect to VA homepage
        current_url = page.url.lower()
        body = page.evaluate("() => document.body ? document.body.innerText.substring(0, 500) : ''")

        if "Hello" in body or "hello" in body.lower()[:50]:
            log(f"Login successful! URL: {page.url[:100]}")
            return True
        elif "virginatlantic.com" in current_url and "identity" not in current_url:
            log(f"Redirected to VA site (login likely succeeded): {page.url[:100]}")
            return True
        else:
            # Check if still on login page with error
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

    from patchright.sync_api import sync_playwright

    results = []

    try:
        # Use residential proxy for fresh IP. Patchright (Chromium) handles HTTP proxy SSL fine.
        # Note: Bright Data may block POST without KYC — login/GraphQL may fail through proxy.
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

            # Step 3: Set up passive GraphQL response interception.
            # Both direct URL navigation and fetch() calls get blocked by Akamai (444/Access Denied).
            # Instead, fill the booking form through the SPA UI so the SPA makes the GraphQL call
            # naturally from a legitimate user session.
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

            # Wait after login to appear human before searching
            wait_secs = random.randint(5, 8)
            log(f"Waiting {wait_secs}s after login before searching...")
            time.sleep(wait_secs)

            # APPROACH 1: Fill the booking form through the SPA UI.
            # After login, we're on the VA homepage. The booking widget is there.
            # We toggle to "reward flight" mode, fill the form, and let the SPA
            # make the GraphQL call naturally.
            log("Approach 1: Filling booking form via SPA UI...")

            # Make sure we're on the VA homepage
            current_url = page.url.lower()
            if "virginatlantic.com" not in current_url or "identity" in current_url:
                log("Not on VA homepage, navigating...")
                page.goto("https://www.virginatlantic.com/", timeout=30000, wait_until="domcontentloaded")
                time.sleep(random.uniform(3, 5))

            # Debug: log what's on the page
            page_info = page.evaluate("""() => {
                const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                    text: (b.textContent || '').trim().substring(0, 60),
                    id: b.id, class: b.className.substring(0, 80),
                    visible: b.offsetParent !== null
                })).filter(b => b.visible);
                const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
                    type: i.type, name: i.name, id: i.id,
                    placeholder: (i.placeholder || '').substring(0, 40),
                    ariaLabel: (i.getAttribute('aria-label') || '').substring(0, 40),
                    visible: i.offsetParent !== null
                })).filter(i => i.visible);
                const links = Array.from(document.querySelectorAll('a')).map(a => ({
                    text: (a.textContent || '').trim().substring(0, 40),
                    href: (a.href || '').substring(0, 80)
                })).filter(a => a.text.toLowerCase().includes('book') || a.text.toLowerCase().includes('reward')
                    || a.text.toLowerCase().includes('mile') || a.text.toLowerCase().includes('point'));
                return { buttons: buttons.slice(0, 20), inputs: inputs.slice(0, 15), links: links.slice(0, 10) };
            }""")
            log(f"Page buttons: {json.dumps(page_info.get('buttons', []))[:500]}")
            log(f"Page inputs: {json.dumps(page_info.get('inputs', []))[:500]}")
            log(f"Page links: {json.dumps(page_info.get('links', []))[:300]}")

            form_filled = False
            try:
                # Step 3a: Toggle to "Reward Flight" / "Use Miles" mode
                reward_toggled = False
                for sel in [
                    'button:has-text("Book with points")',
                    'button:has-text("Reward Flight")',
                    'button:has-text("Use Miles")',
                    'button:has-text("Use Points")',
                    'a:has-text("Book with points")',
                    'a:has-text("Reward")',
                    '[data-testid*="reward"]',
                    '[data-testid*="miles"]',
                    'label:has-text("reward")',
                    'label:has-text("miles")',
                    'input[type="checkbox"][id*="miles"]',
                    'input[type="checkbox"][id*="reward"]',
                    'input[type="radio"][value*="reward"]',
                    # VA sometimes uses a toggle switch
                    '[class*="toggle"]:has-text("points")',
                    '[class*="toggle"]:has-text("miles")',
                ]:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            reward_toggled = True
                            log(f"Toggled reward mode via: {sel}")
                            time.sleep(1)
                            break
                    except:
                        continue

                if not reward_toggled:
                    log("Could not find reward toggle — trying tab navigation")
                    # Try clicking a "Book" tab first, then look for reward toggle
                    for sel in ['a:has-text("Book")', 'button:has-text("Book")',
                                '[role="tab"]:has-text("Book")', 'nav a:has-text("Book")']:
                        try:
                            el = page.locator(sel).first
                            if el.is_visible(timeout=1500):
                                el.click()
                                time.sleep(2)
                                break
                        except:
                            continue

                # Step 3b: Set trip to One Way
                for sel in ['button:has-text("One way")', 'label:has-text("One way")',
                            'input[value="ONE_WAY"]', '[data-testid*="oneway"]',
                            'a:has-text("One way")']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            log("Set to One Way")
                            time.sleep(0.5)
                            break
                    except:
                        continue

                # Step 3c: Fill Origin
                origin_filled = False
                for sel in ['input[aria-label*="From"]', 'input[aria-label*="from"]',
                            'input[placeholder*="From"]', 'input[placeholder*="from"]',
                            'input[name*="origin"]', 'input[id*="origin"]',
                            'input[data-testid*="origin"]', 'input[aria-label*="Departing"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            time.sleep(0.5)
                            el.fill("")
                            time.sleep(0.3)
                            el.type(origin, delay=random.randint(50, 120))
                            time.sleep(1.5)
                            # Select from autocomplete dropdown
                            for ac_sel in [
                                f'li:has-text("{origin}")',
                                f'[role="option"]:has-text("{origin}")',
                                f'[class*="suggestion"]:has-text("{origin}")',
                                f'[class*="result"]:has-text("{origin}")',
                            ]:
                                try:
                                    page.locator(ac_sel).first.click(timeout=3000)
                                    origin_filled = True
                                    log(f"Filled origin: {origin}")
                                    break
                                except:
                                    continue
                            if not origin_filled:
                                page.keyboard.press("Enter")
                                origin_filled = True
                                log(f"Filled origin via Enter: {origin}")
                            time.sleep(0.5)
                            break
                    except:
                        continue

                # Step 3d: Fill Destination
                dest_filled = False
                for sel in ['input[aria-label*="To"]', 'input[aria-label*="to"]',
                            'input[placeholder*="To"]', 'input[placeholder*="to"]',
                            'input[name*="dest"]', 'input[id*="dest"]',
                            'input[data-testid*="dest"]', 'input[aria-label*="Arriving"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            time.sleep(0.5)
                            el.fill("")
                            time.sleep(0.3)
                            el.type(destination, delay=random.randint(50, 120))
                            time.sleep(1.5)
                            for ac_sel in [
                                f'li:has-text("{destination}")',
                                f'[role="option"]:has-text("{destination}")',
                                f'[class*="suggestion"]:has-text("{destination}")',
                                f'[class*="result"]:has-text("{destination}")',
                            ]:
                                try:
                                    page.locator(ac_sel).first.click(timeout=3000)
                                    dest_filled = True
                                    log(f"Filled destination: {destination}")
                                    break
                                except:
                                    continue
                            if not dest_filled:
                                page.keyboard.press("Enter")
                                dest_filled = True
                                log(f"Filled destination via Enter: {destination}")
                            time.sleep(0.5)
                            break
                    except:
                        continue

                # Step 3e: Set Date — click date field, navigate calendar, click day
                dt = datetime.strptime(date, "%Y-%m-%d")
                date_filled = False
                for sel in ['input[aria-label*="Depart"]', 'input[aria-label*="depart"]',
                            'input[placeholder*="Depart"]', 'input[name*="date"]',
                            'input[data-testid*="date"]', 'button:has-text("Departure")']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            time.sleep(1)
                            # Navigate calendar to target month
                            target_month = dt.strftime("%B %Y")
                            for _ in range(18):
                                try:
                                    headers = page.evaluate("""() => {
                                        const els = document.querySelectorAll(
                                            '[class*="month"], [class*="calendar"] h2, [class*="calendar"] h3, ' +
                                            '[class*="title"], [aria-label*="month"]'
                                        );
                                        return Array.from(els).map(e => e.textContent.trim()).filter(t => t.length > 3);
                                    }""")
                                    if any(target_month.lower() in h.lower() for h in headers):
                                        log(f"Found target month: {target_month}")
                                        break
                                except:
                                    pass
                                try:
                                    page.locator('[aria-label*="next"], [class*="next"], button:has-text(">")').first.click()
                                    time.sleep(0.4)
                                except:
                                    break
                            # Click the target day
                            day = dt.day
                            try:
                                page.locator(f'button:has-text("{day}")').first.click()
                                date_filled = True
                                log(f"Selected date: {date}")
                                time.sleep(0.5)
                            except:
                                log(f"Could not click day {day}")
                            break
                    except:
                        continue

                # Step 3f: Select cabin class
                cabin_map_form = {'economy': 'Economy', 'business': 'Upper Class', 'first': 'First'}
                cabin_label = cabin_map_form.get(cabin, 'Upper Class')
                for sel in [f'button:has-text("{cabin_label}")', f'option:has-text("{cabin_label}")',
                            f'[role="option"]:has-text("{cabin_label}")',
                            'select[name*="cabin"]', 'select[id*="cabin"]']:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=1500):
                            el.click()
                            time.sleep(0.5)
                            break
                    except:
                        continue

                # Step 3g: Click Search
                for sel in ['button:has-text("Search")', 'button:has-text("SEARCH")',
                            'button:has-text("Find flights")', 'button:has-text("Search flights")',
                            'button[type="submit"]', 'a:has-text("Search")']:
                    try:
                        btn = page.locator(sel).first
                        if btn.is_visible(timeout=2000):
                            btn.click()
                            form_filled = True
                            log("Clicked Search — waiting for SPA to make GraphQL call")
                            break
                    except:
                        continue

                if origin_filled and dest_filled:
                    log(f"Form fill status: origin={origin_filled} dest={dest_filled} date={date_filled} search={form_filled}")
                else:
                    log(f"Form fill incomplete: origin={origin_filled} dest={dest_filled}")

            except Exception as e:
                log(f"Form fill error: {e}")

            # Wait for the SPA to make GraphQL calls after form submission
            if form_filled:
                for wait_round in range(10):
                    time.sleep(5)
                    if graphql_responses:
                        log(f"Got {len(graphql_responses)} intercepted response(s) after {(wait_round+1)*5}s")
                        break
                    if wait_round == 4:
                        log("Still waiting for GraphQL response from form submission...")

                for resp_text in reversed(graphql_responses):
                    try:
                        data = json.loads(resp_text)
                    except json.JSONDecodeError:
                        continue
                    if "errors" not in data:
                        results = parse_graphql_response(data, params)
                        if results:
                            log(f"Found {len(results)} results from SPA form submission")
                            break

            # APPROACH 2: If form fill didn't work, try direct URL navigation
            if not results:
                log(f"Approach 2: Direct URL navigation to {search_url[:100]}...")
                graphql_responses.clear()
                try:
                    page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
                except Exception as e:
                    log(f"Search page navigation: {str(e)[:100]}")

                time.sleep(3)
                page_text = page.evaluate("() => document.body ? document.body.innerText.substring(0, 500) : ''")

                if "access denied" in page_text.lower() or "not have permission" in page_text.lower():
                    log("Access Denied on search page — trying direct GraphQL fetch")
                    time.sleep(random.randint(3, 6))

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

                    page.goto("https://www.virginatlantic.com/", timeout=30000, wait_until="load")
                    time.sleep(random.randint(2, 4))

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
                    log("Page loaded OK, waiting for SPA GraphQL call...")

                # Wait for passive interception from direct navigation
                if not results:
                    for wait_round in range(8):
                        time.sleep(5)
                        if graphql_responses:
                            log(f"Got {len(graphql_responses)} intercepted response(s) after {(wait_round+1)*5}s")
                            break
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
                log(f"No results from any approach. API requests seen: {len(all_api_urls)}")
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
