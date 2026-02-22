#!/usr/bin/env python3
"""
Cathay Pacific Award Search via curl_cffi.

Uses Cathay's public AFR (Award Flight Redemption) API — no auth required.
Returns calendar-level availability (H=high, L=low, NA=none) with miles pricing.

API endpoints discovered from cathaypacific.com homepage source:
  - /afr/search/availability/{lang}.{origin}.{dest}.{cabin}.CX.{pax}.{start}.{end}.json
  - /afr/searchpanel/searchoptions/{lang}.{origin}.{dest}.{triptype}.std.CX.json

Coverage: Only CX-operated routes to/from HKG + intra-Asia.
"""

import sys
import os
import json
from datetime import datetime, timezone

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    import urllib.request
    # Fallback to stdlib if curl_cffi not available
    cffi_requests = None

PROXY = os.environ.get("PROXY_URL", "")
API_BASE = "https://api.cathaypacific.com"
IMPERSONATE = "chrome131"

CABIN_MAP = {
    "economy": "eco",
    "business": "bus",
    "first": "fir",
    "premium": "pey",
}

CABIN_DISPLAY = {
    "eco": "Economy",
    "bus": "Business",
    "fir": "First",
    "pey": "Premium Economy",
}

def log(msg):
    print(f"[CathayAFR] {msg}", file=sys.stderr)

def get_proxy_dict():
    if not PROXY:
        return {}
    p = PROXY
    if p.startswith("socks5://") and "socks5h://" not in p:
        p = p.replace("socks5://", "socks5h://", 1)
    return {"https": p, "http": p}

def api_get(path):
    """GET from Cathay API."""
    url = f"{API_BASE}{path}"
    proxies = get_proxy_dict()

    if cffi_requests:
        resp = cffi_requests.get(url, impersonate=IMPERSONATE,
            proxies=proxies if proxies else None, timeout=30,
            headers={
                "Accept": "application/json",
                "Origin": "https://www.cathaypacific.com",
                "Referer": "https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html",
            }, allow_redirects=True)
        return resp.status_code, resp.json() if resp.status_code == 200 else None
    else:
        # Stdlib fallback (no proxy support, no impersonation)
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                return resp.status, data
        except urllib.error.HTTPError as e:
            return e.code, None

def get_miles_required(origin, dest):
    """Get miles pricing for a route from the search options API."""
    path = f"/afr/searchpanel/searchoptions/en.{origin}.{dest}.OW.std.CX.json"
    status, data = api_get(path)
    if status == 200 and data:
        return data.get("milesRequired", {})
    return {}

def get_availability(origin, dest, cabin_code, start_date, end_date):
    """Get daily availability for a route/cabin over a date range."""
    path = f"/afr/search/availability/en.{origin}.{dest}.{cabin_code}.CX.1.{start_date}.{end_date}.json"
    status, data = api_get(path)
    if status == 200 and data:
        avail = data.get("availabilities", {})
        return avail.get("std", []), avail.get("updateTime", "")
    return [], ""

def main():
    if len(sys.argv) < 2:
        print("Usage: cathay-curlffi.py '<json params>'", file=sys.stderr)
        print("[]")
        sys.exit(0)

    params = json.loads(sys.argv[1])
    origin = params.get("origin", "").upper()
    dest = params.get("destination", "").upper()
    date_str = params.get("date", "")  # YYYY-MM-DD
    cabin = params.get("cabin", "economy").lower()

    if not origin or not dest or not date_str:
        log(f"Missing params: origin={origin} dest={dest} date={date_str}")
        print("[]")
        sys.exit(0)

    cabin_code = CABIN_MAP.get(cabin, "eco")
    log(f"Search: {origin}->{dest} {date_str} {cabin} (afr code: {cabin_code})")

    # Convert date to API format (YYYYMMDD)
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        api_date = dt.strftime("%Y%m%d")
    except ValueError:
        log(f"Invalid date format: {date_str}")
        print("[]")
        sys.exit(0)

    # 1. Get miles pricing
    miles = get_miles_required(origin, dest)
    if not miles:
        # Try reverse route in case it's directional
        miles = get_miles_required(dest, origin)
    miles_for_cabin = miles.get(cabin_code, 0)

    if not miles:
        log(f"No CX route found for {origin}->{dest}")
        print("[]")
        sys.exit(0)

    log(f"Miles required: {json.dumps(miles)}")

    # 2. Get availability for the specific date
    avail_list, update_time = get_availability(origin, dest, cabin_code, api_date, api_date)

    if not avail_list:
        log(f"No availability data for {origin}->{dest} on {date_str}")
        print("[]")
        sys.exit(0)

    results = []
    for entry in avail_list:
        avail_code = entry.get("availability", "NA")
        entry_date = entry.get("date", api_date)

        if avail_code == "NA":
            log(f"  {entry_date}: Not available")
            continue

        # Format date back to YYYY-MM-DD
        try:
            dep_date = datetime.strptime(entry_date, "%Y%m%d").strftime("%Y-%m-%d")
        except:
            dep_date = date_str

        award_type = "saver" if avail_code == "H" else "everyday"

        result = {
            "source": "cathay",
            "airline": "Cathay Pacific",
            "flightNumber": f"CX {origin}-{dest}",
            "origin": origin,
            "destination": dest,
            "departureDate": dep_date,
            "departureTime": "",  # Calendar API doesn't have flight times
            "arrivalTime": "",
            "duration": "",
            "stops": 0,  # Assume direct for CX-operated
            "cabin": cabin,
            "pointsRequired": miles_for_cabin,
            "pointsProgram": "Asia Miles",
            "awardType": award_type,
            "scrapedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "bookingUrl": f"https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html",
        }
        results.append(result)
        log(f"  {dep_date}: {avail_code} -> {miles_for_cabin} miles ({award_type})")

    log(f"Total: {len(results)} results")
    print(json.dumps(results))

if __name__ == "__main__":
    main()
