#!/usr/bin/env python3
"""Debug VA search - capture all network requests and page state."""
import json, sys, time, random

def log(msg):
    print(f"[DEBUG {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    from camoufox import Camoufox

all_requests = []
all_responses = []

with Camoufox(headless=True, humanize=True) as browser:
    page = browser.new_page()

    def on_request(req):
        url = req.url
        if 'virginatlantic' in url and not any(x in url for x in ['.png', '.jpg', '.css', '.woff', '.svg', '.ico']):
            all_requests.append({'method': req.method, 'url': url[:200]})

    def on_response(resp):
        url = resp.url
        status = resp.status
        if 'virginatlantic' in url and not any(x in url for x in ['.png', '.jpg', '.css', '.woff', '.svg', '.ico']):
            entry = {'url': url[:200], 'status': status, 'content_type': resp.headers.get('content-type', '')[:50]}
            all_responses.append(entry)
            if 'graphql' in url.lower() or 'search' in url.lower() or 'api' in url.lower():
                log(f"*** API: {resp.method if hasattr(resp,'method') else '?'} {status} {url[:150]}")
                try:
                    body = resp.text()
                    log(f"    Body preview: {body[:300]}")
                except:
                    pass

    page.on("request", on_request)
    page.on("response", on_response)

    # Go to homepage first
    log("Going to VA homepage...")
    page.goto("https://www.virginatlantic.com/", timeout=30000)
    time.sleep(3)

    # Accept cookies
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent:
            consent.click()
            time.sleep(1)
            log("Accepted cookies")
    except:
        pass

    # Try direct search URL
    url = "https://www.virginatlantic.com/flights/search/results?origin=JFK&destination=LAX&departure=2026-03-15&ADT=1&cabin=upper&tripType=ONE_WAY&awardSearch=true"
    log(f"Navigating to search URL...")
    try:
        page.goto(url, timeout=45000, wait_until="domcontentloaded")
    except Exception as e:
        log(f"Nav error: {e}")

    time.sleep(5)

    # Check page title and URL
    log(f"Title: {page.title()}")
    log(f"URL: {page.url}")

    # Check for cookie consent again
    try:
        consent = page.query_selector('#onetrust-accept-btn-handler')
        if consent and consent.is_visible():
            consent.click()
            time.sleep(1)
    except:
        pass

    # Wait more and check
    time.sleep(10)

    # Get page content summary
    content = page.content()
    log(f"Page length: {len(content)}")

    # Check for key indicators
    for keyword in ['error', 'captcha', 'blocked', 'denied', 'no availability', 'loading', 'spinner', 'result']:
        count = content.lower().count(keyword)
        if count > 0:
            log(f"  '{keyword}' appears {count} times")

    # Check what's visible
    try:
        visible_text = page.evaluate("() => document.body.innerText.substring(0, 2000)")
        log(f"Visible text:\n{visible_text[:1500]}")
    except Exception as e:
        log(f"Could not get visible text: {e}")

    # Try the direct GraphQL call from page context
    log("\nTrying direct GraphQL from page context...")
    try:
        result = page.evaluate("""() => {
            return fetch('/flights/search/api/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operationName: "SearchOffers",
                    variables: {
                        request: {
                            flightSearchRequest: {
                                searchOriginDestinations: [{
                                    origin: "JFK",
                                    destination: "LAX",
                                    departureDate: "2026-03-15"
                                }],
                                awardSearch: true,
                                bundleOffer: false,
                                calendarSearch: false,
                                flexiDateSearch: false,
                                nonStopOnly: false,
                                currentTripIndexId: "0",
                                checkInBaggageAllowance: false,
                                carryOnBaggageAllowance: false,
                                refundableOnly: false
                            },
                            customerDetails: [{ custId: "ADT_0", ptc: "ADT" }]
                        }
                    },
                    query: `query SearchOffers($request: FlightOfferRequestInput!) {
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
                                                duration
                                                departure
                                                arrival
                                            }
                                            duration origin { code } destination { code } departure arrival
                                        }
                                        fares {
                                            availability id
                                            price { awardPoints tax amountIncludingTax currency }
                                            fareSegments { cabinName bookingClass isSaverFare }
                                            available fareFamilyType availableSeatCount isSaverFare
                                        }
                                    }
                                }
                            }
                        }
                    }`
                })
            }).then(r => r.text()).catch(e => 'FETCH_ERROR: ' + e.message);
        }""")
        log(f"GraphQL response: {str(result)[:1000]}")
    except Exception as e:
        log(f"GraphQL call failed: {e}")

    # Summary of network activity
    log(f"\n=== Network Summary ===")
    log(f"Total requests: {len(all_requests)}")
    log(f"Total responses: {len(all_responses)}")

    api_responses = [r for r in all_responses if any(x in r['url'].lower() for x in ['graphql', 'api', 'search'])]
    log(f"API-like responses: {len(api_responses)}")
    for r in api_responses[:20]:
        log(f"  {r['status']} {r['url'][:150]}")
