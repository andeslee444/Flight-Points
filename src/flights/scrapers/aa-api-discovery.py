#!/usr/bin/env python3
"""
AA API Discovery — Intercept all XHR/fetch requests during an AA award search.

Temporary investigation script. Uses Patchright with full network interception
to discover what backend APIs the AA Angular SPA calls, enabling a future
curl_cffi scraper.

Usage:
  python3 aa-api-discovery.py '{"origin":"JFK","destination":"NRT","date":"2026-03-22","cabin":"business"}'

Outputs a report of discovered API endpoints to stderr.
Outputs captured JSON responses to stdout.
"""

import json
import sys
import time
import random
import os
import re
from urllib.parse import urlencode, urlparse

def log(msg):
    print(f"[AA-Discovery {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)

def main():
    if len(sys.argv) < 2:
        log("Usage: python3 aa-api-discovery.py '<json params>'")
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params.get("origin", "JFK")
    destination = params.get("destination", "NRT")
    date = params.get("date", "2026-03-22")
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

    log(f"Search: {origin}->{destination} {date} {cabin}")

    from patchright.sync_api import sync_playwright

    api_requests = []
    api_responses = []

    try:
        proxy_url = os.environ.get("PROXY_URL", "")
        proxy_cfg = None
        if proxy_url:
            parsed = urlparse(proxy_url)
            if parsed.scheme in ("socks5", "socks4"):
                proxy_cfg = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
                if parsed.username:
                    proxy_cfg["username"] = parsed.username
                if parsed.password:
                    proxy_cfg["password"] = parsed.password

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

            # Intercept ALL requests
            def handle_request(request):
                url = request.url
                method = request.method
                resource = request.resource_type
                # Skip static assets
                if resource in ("image", "stylesheet", "font", "media", "manifest"):
                    return
                # Log XHR/fetch and interesting URLs
                if resource in ("xhr", "fetch") or any(k in url.lower() for k in
                    ["api", "graphql", "search", "award", "flight", "booking", "availability"]):
                    post_data = request.post_data or ""
                    content_type = request.headers.get("content-type", "")
                    entry = {
                        "method": method,
                        "url": url[:300],
                        "resource_type": resource,
                        "content_type": content_type,
                        "post_data_preview": post_data[:500] if post_data else "",
                        "post_data_size": len(post_data),
                    }
                    api_requests.append(entry)
                    log(f"REQ [{method}] [{resource}] {url[:150]}")
                    if post_data:
                        log(f"  Content-Type: {content_type}")
                        log(f"  Body ({len(post_data)} bytes): {post_data[:300]}")

            def handle_response(response):
                url = response.url
                status = response.status
                ct = response.headers.get("content-type", "")
                resource = response.request.resource_type

                if resource in ("image", "stylesheet", "font", "media", "manifest"):
                    return

                # Capture JSON responses
                if "json" in ct or resource in ("xhr", "fetch"):
                    try:
                        body = response.text()
                        has_flight_keywords = any(kw in body.lower() for kw in
                            ['flight', 'award', 'miles', 'points', 'cabin', 'fare',
                             'segment', 'itinerary', 'availability', 'origin', 'destination'])
                        entry = {
                            "url": url[:300],
                            "status": status,
                            "content_type": ct,
                            "body_size": len(body),
                            "has_flight_keywords": has_flight_keywords,
                        }
                        if has_flight_keywords and len(body) > 200:
                            entry["body_preview"] = body[:1000]
                            try:
                                parsed_json = json.loads(body)
                                if isinstance(parsed_json, dict):
                                    entry["top_keys"] = list(parsed_json.keys())[:20]
                            except:
                                pass
                        api_responses.append(entry)
                        if has_flight_keywords:
                            log(f"RESP [{status}] {url[:150]} ({len(body)} bytes) ** FLIGHT DATA **")
                            if len(body) > 200:
                                log(f"  Preview: {body[:300]}")
                        elif len(body) > 500:
                            log(f"RESP [{status}] {url[:150]} ({len(body)} bytes)")
                    except Exception as e:
                        log(f"RESP [{status}] {url[:100]} (read error: {e})")

            page.on("request", handle_request)
            page.on("response", handle_response)

            # Step 1: Warm cookies
            log("Warming cookies on aa.com...")
            page.goto("https://www.aa.com/", timeout=45000, wait_until="domcontentloaded")
            time.sleep(random.uniform(3, 5))
            page.evaluate("window.scrollBy(0, Math.random() * 400)")
            time.sleep(random.uniform(2, 3))

            cookies = context.cookies()
            akamai = [c for c in cookies if c["name"].startswith(("ak_", "bm_", "_abck"))]
            log(f"Cookies: {len(cookies)} total, {len(akamai)} Akamai")

            if len(cookies) < 10:
                log("FAIL FAST: Akamai challenge not passed")
                sys.exit(1)

            # Step 2: Navigate to search
            log(f"Navigating to search URL...")
            try:
                page.goto(search_url, timeout=60000, wait_until="domcontentloaded")
            except Exception as e:
                log(f"Navigation error: {e}")

            # Wait for Angular app to make API calls
            log("Waiting for Angular app to load and make API calls...")
            for wait_round in range(6):
                time.sleep(5)
                flight_responses = [r for r in api_responses if r.get("has_flight_keywords")]
                log(f"  Wait round {wait_round+1}: {len(api_requests)} requests, {len(api_responses)} responses, {len(flight_responses)} with flight data")
                if flight_responses:
                    break

            # Check page content
            content = page.content().lower()
            if "access denied" in content or "reference #" in content:
                log("BLOCKED by Akamai on search page")
            elif "no flights" in content or "no award" in content:
                log("No flights available (legitimate)")
            elif "choose flights" in content:
                log("Results page loaded successfully!")

            context.close()
            browser.close()

    except Exception as e:
        log(f"Error: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)

    # Output report
    log("\n" + "="*80)
    log("API DISCOVERY REPORT")
    log("="*80)

    log(f"\nTotal requests intercepted: {len(api_requests)}")
    log(f"Total responses captured: {len(api_responses)}")

    flight_responses = [r for r in api_responses if r.get("has_flight_keywords")]
    log(f"\nResponses with flight keywords: {len(flight_responses)}")
    for r in flight_responses:
        log(f"  [{r['status']}] {r['url']}")
        log(f"    Size: {r['body_size']} bytes, Content-Type: {r['content_type']}")
        if "top_keys" in r:
            log(f"    Top keys: {r['top_keys']}")
        if "body_preview" in r:
            log(f"    Preview: {r['body_preview'][:500]}")

    # Unique API endpoints
    unique_urls = set()
    for r in api_requests:
        parsed = urlparse(r["url"])
        unique_urls.add(f"{r['method']} {parsed.path}")

    log(f"\nUnique API endpoints ({len(unique_urls)}):")
    for u in sorted(unique_urls):
        log(f"  {u}")

    # Output full data as JSON
    report = {
        "requests": api_requests,
        "responses": api_responses,
        "flight_responses": flight_responses,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
