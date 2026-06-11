#!/usr/bin/env python3
"""
TEMPLATE for a mobile-app-API scraper. Copy to <airline>-mobile.py and fill in
the contract captured per docs/mobile-api-recon.md. Mobile backends usually skip
the web Akamai/_abck sensor — clean JSON over a static app key + bearer token.

Contract: reads JSON params from sys.argv[1], logs to stderr, prints FlightResult[]
JSON to stdout (see src/flights/types.ts). Routes through PROXY_URL via curlffi_base.
"""
import json
import sys
from curlffi_base import make_session, validate_params, log

# === FILL IN from the mitmproxy capture ===
AWARD_ENDPOINT = "https://<mobile-api-host>/<award-search-path>"
APP_KEY_HEADER = {"x-app-key": "<STATIC_APP_KEY_FROM_CAPTURE>"}  # exact header name+value
# Bearer token: cache + refresh-on-401 in production (session-pool / vault); for the
# first cut read it from an env var captured during recon.
import os
BEARER = os.environ.get("<AIRLINE>_BEARER", "")


def build_body(params):
    """Map our SearchParams → the app's request body (from the captured schema)."""
    return {
        "origin": params["origin"],
        "destination": params["destination"],
        "date": params["date"],
        # ... rest of the captured body shape ...
    }


def parse_response(data, params):
    """Map the app's JSON response → FlightResult[]. Fill from the captured shape."""
    results = []
    # for offer in data.get("...", []):
    #     results.append({
    #         "source": "<airline>-mobile",
    #         "airline": "...",
    #         "origin": params["origin"], "destination": params["destination"],
    #         "departureDate": params["date"],
    #         "cabin": "...",            # economy | business | first
    #         "pointsRequired": ...,
    #         "pointsProgram": "...",
    #         "taxesAndFees": ...,
    #         "scrapedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    #     })
    return results


def main():
    params = json.loads(sys.argv[1])
    validate_params(params)
    label = "<Airline>-Mobile"
    session, proxy_info = make_session(label)
    headers = {**APP_KEY_HEADER, "authorization": f"Bearer {BEARER}"}
    try:
        resp = session.post(AWARD_ENDPOINT, json=build_body(params), headers=headers, timeout=30)
        log(label, f"HTTP {resp.status_code}")
        if resp.status_code == 401:
            log(label, "401 — bearer expired; refresh and retry (not impl in template)")
            print("[]"); return
        results = parse_response(resp.json(), params)
        log(label, f"{len(results)} results")
        print(json.dumps(results))
    except Exception as e:
        log(label, f"error: {e}")
        print("[]")


if __name__ == "__main__":
    main()
