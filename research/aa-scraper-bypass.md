# AA Award Search Scraper — Research & Bypass Notes

**Date:** 2026-02-16  
**Status:** ✅ Working (direct URL approach)  
**Test Route:** JFK → NRT, Business, March 15 2026

---

## TL;DR

AA.com **does work** with a direct URL approach using the `slices` JSON parameter. The Akamai/PerimeterX protection primarily guards the form submission flow, not direct URL navigation to the results page. Headless Chrome with basic stealth flags is sufficient.

---

## 1. AA.com Direct URL (✅ WORKING)

### Key Discovery
AA's booking URL accepts a `slices` parameter with JSON-encoded search criteria. Navigating directly to this URL skips the form and loads the Angular results page:

```
https://www.aa.com/booking/search?locale=en_US&pax=1&adult=1&type=OneWay&searchType=Award&cabin=&carriers=ALL&slices=[{"orig":"JFK","origNearby":false,"dest":"NRT","destNearby":false,"date":"2026-03-15"}]&maxAwardSegmentAllowed=2
```

### URL Parameters
| Param | Value | Notes |
|-------|-------|-------|
| `locale` | `en_US` | Language |
| `pax` | `1` | Total passengers |
| `adult` | `1` | Adult count |
| `type` | `OneWay` | OneWay or RoundTrip |
| `searchType` | `Award` | Award search (vs revenue) |
| `cabin` | `` | Empty = show all cabins |
| `carriers` | `ALL` | All airlines |
| `slices` | JSON array | Search legs |
| `maxAwardSegmentAllowed` | `2` | Max connections |

### DOM Selectors (Angular, as of Feb 2026)
```
.results-grid-container > .grid-x.grid-padding-x  → each flight row
  .origin .city-code                               → "JFK"
  .origin .flt-times                               → "10:12 PM"
  .destination .city-code                          → "NRT"
  .destination .flt-times                          → "3:30 PM +2"
  .duration                                        → "28h 18m"
  .stops button                                    → "2 stops, BNA, DFW"
  .flight-number                                   → "AA 4485" (multiple per itinerary)
  .aircraft-name                                   → "E75-Embraer 175"
  .per-pax-amount                                  → "121.5K"
  .cell.auto.pad-left-xxs.pad-right-xxs           → cabin price buttons
```

### Cabin Price Button Text Pattern
```
"{CabinName}One way{Miles}K+ ${Taxes}One way {CabinName} {Miles}K + ${Taxes} for {Origin} to {Dest}..."
```
Example: `"BusinessOne way450K+ $11.20One way Business 450K + $11.20 for JFK to NRT, departing at 10:12 PM 2 stops"`

### Results (JFK→NRT, 2026-03-15)
- 19+ flight options shown
- Economy: 96.5K–127.5K miles
- Premium Economy: 127K–168K miles
- Business: 450K miles (dynamic pricing, high on this route)
- Taxes: ~$11.20 on all options
- All connecting via DFW on AA metal

### Anti-Bot Status
- **Akamai**: Present but does NOT block direct URL navigation
- **PerimeterX**: Present but passive in this flow
- **Headless detection**: Basic stealth flags (`--disable-blink-features=AutomationControlled`) sufficient
- **No login required** for award search

### Failure Modes
1. "Our system is having trouble" → Usually transient, retry
2. Redirect to home form → URL format may have changed
3. Captcha/challenge → Need to rotate IP or add more stealth

---

## 2. British Airways (ba.com) — Oneworld Partner Search

### Status: 🟡 Partially Investigated

BA shows all oneworld partner availability including AA-metal flights.

**URL:** `https://www.britishairways.com/travel/book/public/en_us`
- BA has heavy Akamai protection
- The `ba_rewards` Ruby gem (github.com/timrogers/ba_rewards) used the Avios Flight Finder iOS app API — **likely deprecated**
- IAG Developer Portal (developer.iairgroup.com) has NDC APIs but requires registration

**BA's Internal API** (speculative):
- May be discoverable via network inspection
- BA uses Next.js, so `__NEXT_DATA__` may contain flight data

### Recommendation
BA is a **backup** approach. Use seats.aero for BA Avios data instead of scraping ba.com directly.

---

## 3. Qantas.com — Classic Reward Search

### Status: 🟡 Requires Login

Qantas shows oneworld partner Classic Flight Rewards but **requires Qantas Frequent Flyer login** to see actual results.

**Search Flow:**
1. Navigate to `qantas.com/au/en/book-a-trip/flights.html`
2. Toggle "Rewards" mode
3. Fill origin/destination/date
4. Click "Search flights"

**Limitations:**
- Login wall for reward searches
- QFF membership required
- Bot detection present
- Results in Qantas Points (different pricing than AAdvantage)

### Recommendation
Qantas is useful as a **confirmation source** (to verify AA availability exists) but not as primary.

---

## 4. seats.aero API (✅ BEST FALLBACK)

The project already has `seats-aero.ts` integrated. This is the **best fallback** for AA availability:
- Covers AA AAdvantage program directly
- $10/month for Pro API (1000 calls/day)
- Pre-cached data (fast)
- Live search available
- Covers 17+ airline programs

**Set env:** `SEATS_AERO_API_KEY=pro_xxxxxxxxxxxxxxxxxxxxx`

---

## 5. AA Mobile App API

### Status: ❌ Not Investigated

AA's mobile app likely uses a separate API with OAuth tokens. Would require:
- Proxying the mobile app (mitmproxy)
- Reverse-engineering the auth flow
- Likely has certificate pinning

**Not worth pursuing** given the direct URL approach works.

---

## Strategy Ranking

| Approach | Reliability | Speed | Maintenance | Recommended |
|----------|------------|-------|-------------|-------------|
| AA.com direct URL | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ✅ Primary |
| seats.aero API | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Fallback |
| BA.com scrape | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⚠️ Last resort |
| Qantas.com | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⚠️ Confirmation only |
| AA mobile API | ⭐ | ⭐⭐⭐⭐ | ⭐ | ❌ Too complex |

---

## Files Modified/Created

- `src/flights/scrapers/aa.ts` — Rewritten with working DOM selectors
- `src/flights/scrapers/qantas.ts` — New Qantas oneworld backdoor scraper
- `src/flights/scrapers/ba-avios.ts` — Already existed, left as-is
- `research/aa-scraper-bypass.md` — This file
