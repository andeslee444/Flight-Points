#!/usr/bin/env python3
"""
Cookie Farm Proof of Concept — AA.com

Binary test: does a Patchright-farmed _abck cookie work with curl_cffi?

Flow:
  1. Verify VPS IP isn't burned (curl_cffi GET homepage — expect 200)
  2. Launch Patchright browser (headless Chrome, SOCKS5 proxy)
  3. Navigate to aa.com, wait for Akamai JS to solve
  4. Human-like actions: scroll, mouse move, accept cookies
  5. Extract all cookies from browser context
  6. Close browser
  7. Create curl_cffi session (chrome131, same proxy)
  8. Inject farmed cookies
  9. GET /booking/find-flights (get XSRF-TOKEN)
  10. POST /booking/api/search/itinerary with award search payload
  11. PASS: HTTP 200, no cpr_chlge, flight data JSON
  12. FAIL: HTTP 429 + cpr_chlge

Usage:
  ssh -D 1081 -N -f ubuntu@150.136.249.186
  PROXY_URL=socks5://127.0.0.1:1081 python3 src/flights/scrapers/test-cookie-farm.py
"""

import json
import sys
import time
import random
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log, create_session, get_proxy_config

LABEL = "CookieFarm-Test"

def log(msg):
    _log(LABEL, msg)


def step1_verify_ip():
    """Verify VPS IP isn't burned for AA.com."""
    log("=== Step 1: Verify VPS IP health ===")
    session, proxy_info = create_session(LABEL)

    try:
        resp = session.get("https://www.aa.com/homePage.do", timeout=30)
        log(f"Homepage: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 403:
            log("FAIL: IP is burned (403 Forbidden)")
            return False
        if resp.status_code == 429:
            log("FAIL: IP is rate-limited (429)")
            return False
        if resp.status_code != 200:
            log(f"WARNING: Unexpected status {resp.status_code}")

        # Check for Akamai block page indicators
        if "Access Denied" in resp.text or "Reference #" in resp.text:
            log("FAIL: Akamai block page detected in response body")
            return False

        log("PASS: IP looks healthy")
        return True
    except Exception as e:
        log(f"ERROR: {e}")
        return False


def step2_farm_cookies():
    """Farm cookies from AA.com using Patchright browser."""
    log("=== Step 2: Farm cookies via Patchright ===")

    from patchright.sync_api import sync_playwright
    from urllib.parse import urlparse

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

    cookies_dict = {}
    raw_cookies = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--no-first-run"],
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

        # Navigate to AA.com
        log("Navigating to aa.com...")
        start = time.time()
        try:
            page.goto("https://www.aa.com/", timeout=30000, wait_until="domcontentloaded")
        except Exception as e:
            log(f"Navigation timeout (continuing): {e}")

        # Wait for Akamai JS to execute
        wait_time = random.uniform(5, 8)
        log(f"Waiting {wait_time:.1f}s for Akamai JS...")
        time.sleep(wait_time)

        # Human-like actions
        log("Performing human-like actions...")
        try:
            page.mouse.move(random.randint(100, 800), random.randint(100, 400))
            time.sleep(random.uniform(0.3, 0.8))
            page.evaluate("window.scrollBy(0, Math.random() * 400 + 100)")
            time.sleep(random.uniform(0.5, 1.0))
            page.mouse.move(random.randint(200, 900), random.randint(200, 500))
            time.sleep(random.uniform(0.3, 0.6))
            page.evaluate("window.scrollBy(0, Math.random() * 200)")
            time.sleep(random.uniform(0.5, 1.0))
        except Exception as e:
            log(f"Human actions error (non-fatal): {e}")

        # Try to dismiss cookie banner
        try:
            cookie_btn = page.query_selector('button:has-text("Accept"), button:has-text("agree"), #onetrust-accept-btn-handler')
            if cookie_btn and cookie_btn.is_visible():
                cookie_btn.click()
                log("Dismissed cookie banner")
                time.sleep(random.uniform(0.5, 1.0))
        except:
            pass

        # Navigate to booking page to trigger more Akamai challenges
        log("Navigating to /booking/find-flights...")
        try:
            page.goto("https://www.aa.com/booking/find-flights", timeout=30000, wait_until="domcontentloaded")
            time.sleep(random.uniform(3, 5))
            page.mouse.move(random.randint(100, 600), random.randint(100, 300))
            time.sleep(random.uniform(1, 2))
        except Exception as e:
            log(f"Booking page navigation: {e}")

        elapsed = time.time() - start
        log(f"Browser session took {elapsed:.1f}s")

        # Extract ALL cookies
        raw_cookies = context.cookies()
        for cookie in raw_cookies:
            cookies_dict[cookie["name"]] = cookie["value"]

        log(f"Extracted {len(raw_cookies)} cookies")

        # Analyze _abck cookie
        abck = cookies_dict.get("_abck", "")
        if abck:
            log(f"_abck cookie: {len(abck)} chars")
            log(f"_abck prefix: {abck[:80]}...")
            # Solved _abck is typically 300-500+ chars and contains specific patterns
            if len(abck) > 200:
                log("_abck appears SOLVED (long cookie)")
            else:
                log("_abck appears UNSOLVED (short cookie)")
        else:
            log("WARNING: No _abck cookie found!")

        # Log other important cookies
        for name in ["bm_sv", "bm_sz", "ak_bmsc", "XSRF-TOKEN", "JSESSIONID", "AMCV_C", "s_ecid"]:
            val = cookies_dict.get(name, "")
            if val:
                log(f"  {name}: {len(val)} chars")

        context.close()
        browser.close()

    return cookies_dict, raw_cookies


def step3_test_curlffi(cookies_dict, raw_cookies):
    """Test if farmed cookies work with curl_cffi."""
    log("=== Step 3: Test cookies with curl_cffi ===")

    session, proxy_info = create_session(LABEL)

    # Inject cookies into curl_cffi session
    for cookie in raw_cookies:
        name = cookie["name"]
        value = cookie["value"]
        domain = cookie.get("domain", ".aa.com")
        path = cookie.get("path", "/")
        # Clean domain (remove leading dot for curl_cffi)
        if domain.startswith("."):
            domain_clean = domain[1:]
        else:
            domain_clean = domain
        session.cookies.set(name, value, domain=domain_clean, path=path)

    log(f"Injected {len(raw_cookies)} cookies into curl_cffi session")

    # Step 3a: GET /booking/find-flights to get XSRF-TOKEN
    log("Getting XSRF token from booking page...")
    try:
        resp = session.get("https://www.aa.com/booking/find-flights", timeout=30)
        log(f"Booking page: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        xsrf = dict(session.cookies).get("XSRF-TOKEN", "")
        if not xsrf:
            xsrf = cookies_dict.get("XSRF-TOKEN", "")
        log(f"XSRF token: {'found' if xsrf else 'missing'} ({len(xsrf)} chars)")

        if resp.status_code == 403:
            log("FAIL: Booking page returned 403 — cookies didn't transfer")
            return False
        if resp.status_code == 429:
            log("FAIL: Booking page returned 429 — rate limited")
            return False
    except Exception as e:
        log(f"Booking page error: {e}")
        return False

    # Step 3b: POST award search
    log("Sending award search POST...")
    time.sleep(random.uniform(1, 3))

    payload = {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": 1}],
        "requestHeader": {"clientId": "AAcom"},
        "slices": [{
            "allCarriers": True,
            "cabin": "business",
            "departureDate": "2026-04-15",
            "destination": "LHR",
            "destinationNearbyAirports": False,
            "origin": "JFK",
            "originNearbyAirports": False,
        }],
        "tripOptions": {
            "searchType": "Award",
            "corporateBooking": False,
            "locale": "en_US",
        },
        "loyaltyInfo": None,
        "queryParams": {
            "sliceIndex": 0,
            "sessionId": "",
            "solutionSet": "",
            "solutionId": "",
        },
    }

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://www.aa.com",
        "Referer": "https://www.aa.com/booking/search/find-flights",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf

    try:
        resp = session.post(
            "https://www.aa.com/booking/api/search/itinerary",
            json=payload,
            headers=headers,
            timeout=90,
        )

        log(f"Search response: HTTP {resp.status_code} ({len(resp.text)} bytes)")

        if resp.status_code == 200:
            try:
                data = resp.json()
                if "cpr_chlge" in data:
                    log("FAIL: HTTP 200 but cpr_chlge detected — Akamai challenge in response body")
                    log(f"Response keys: {list(data.keys())[:10]}")
                    return False
                elif "error" in data and data.get("error"):
                    err = json.dumps(data["error"])[:300]
                    log(f"API error (not necessarily cookie failure): {err}")
                    # Still counts as cookies working if we got a JSON response
                    log("PARTIAL PASS: Cookies accepted, but API returned an error")
                    return True
                else:
                    slices = data.get("slices", [])
                    log(f"PASS: HTTP 200, {len(slices)} flight slices returned!")
                    if slices:
                        first = slices[0]
                        segs = first.get("segments", [])
                        if segs:
                            leg = segs[0].get("legs", [{}])[0] if segs[0].get("legs") else {}
                            carrier = leg.get("operatingCarrier", {}).get("name", "?")
                            fn = leg.get("flightNumber", "?")
                            log(f"  First flight: {carrier} {fn}")
                    return True
            except json.JSONDecodeError:
                log(f"Response not JSON: {resp.text[:300]}")
                if "<html" in resp.text.lower():
                    log("FAIL: Got HTML instead of JSON — likely Akamai block page")
                    return False
                return False

        elif resp.status_code == 429:
            log("FAIL: HTTP 429 — rate limited")
            try:
                body = resp.json()
                if "cpr_chlge" in body:
                    log("  Akamai challenge detected in 429 response")
                    log(f"  Response keys: {list(body.keys())[:10]}")
            except:
                log(f"  Response body: {resp.text[:300]}")
            return False

        elif resp.status_code == 403:
            log("FAIL: HTTP 403 — cookies rejected")
            log(f"  Response: {resp.text[:300]}")
            return False

        else:
            log(f"FAIL: Unexpected HTTP {resp.status_code}")
            log(f"  Response: {resp.text[:300]}")
            return False

    except Exception as e:
        log(f"Search error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False


def main():
    log("=" * 60)
    log("Cookie Farm Proof of Concept — AA.com")
    log("=" * 60)
    log("")

    # Step 1: Verify IP
    if not step1_verify_ip():
        log("")
        log("ABORT: VPS IP is burned for AA.com")
        log("Try waiting 24h or use a different proxy")
        sys.exit(1)

    log("")

    # Step 2: Farm cookies
    try:
        cookies_dict, raw_cookies = step2_farm_cookies()
    except Exception as e:
        log(f"Cookie farming failed: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    if not cookies_dict.get("_abck"):
        log("")
        log("ABORT: No _abck cookie obtained — Patchright may not have solved Akamai")
        sys.exit(1)

    log("")

    # Step 3: Test with curl_cffi
    success = step3_test_curlffi(cookies_dict, raw_cookies)

    log("")
    log("=" * 60)
    if success:
        log("RESULT: PASS — Cookie farm approach works!")
        log("Proceed with Phase 2: cookie_farm.py module")
    else:
        log("RESULT: FAIL — Cookies did not transfer successfully")
        log("Fallback options:")
        log("  4A: Run full Patchright browser through VPS proxy (~30s per search)")
        log("  4B: Try matching TLS version (impersonate=chrome133)")
        log("  4C: Run scripts directly on VPS")
        log("  4D: Bright Data residential proxy with KYC")
    log("=" * 60)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
