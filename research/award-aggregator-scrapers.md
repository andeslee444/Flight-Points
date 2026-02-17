# Award Aggregator Scrapers — Research Notes

**Date:** 2026-02-16  
**Test Route:** JFK → NRT, Business, March 15 2026

## Summary

| Tool | Viable? | Status | Scraper Built? | Notes |
|------|---------|--------|----------------|-------|
| seats.aero | ✅ Best option | API exists ($10/mo Pro) | ✅ Already exists | Has Partner API with cached search, bulk availability, live search |
| AwardFares | ⚠️ Possible | Cloudflare-protected SPA | ✅ Experimental | Needs session cookie extraction from browser login |
| ExpertFlyer | ⚠️ Possible | Login-walled, paid | ✅ Experimental | GDS-based. Shows raw booking class avail (I2, O1, etc.) |
| point.me | ❌ Not viable | Login wall + subscription | ❌ | SPA, requires paid membership, heavy anti-scrape |
| Cowtool | ❌ Dead | **SHUT DOWN Oct 2023** | ❌ | Creator voluntarily shut it down. Gone for good. |
| Google Flights Awards | ❌ Not native | No native award search | ❌ | "Points Path" is a 3rd-party Chrome extension, not Google. Already have Google Flights cash scraper. |

## Detailed Analysis

### 1. seats.aero ⭐ BEST SOURCE

**What it is:** The premier award availability aggregator. Covers 17+ programs (United, Aeroplan, Virgin Atlantic, Singapore, ANA, BA Avios, AA, Delta, Emirates, Turkish, Flying Blue, LifeMiles, Qantas, Smiles, Velocity, Etihad, Alaska).

**API:** Well-documented Partner API at https://developers.seats.aero/
- **Cached Search** (`GET /partnerapi/search`) — query pre-cached data, fast
- **Bulk Availability** (`GET /partnerapi/availability`) — large datasets by program
- **Live Search** (`POST /partnerapi/search`) — triggers fresh scrape, slower
- **Get Routes** (`GET /partnerapi/routes`) — discover available routes
- **Get Trips** (`GET /partnerapi/trips`) — get trip details

**Auth:** `Partner-Authorization: pro_xxxx` header. Pro subscription ($10/mo) gives 1,000 API calls/day.

**Verdict:** Already have a scraper (`src/flights/scrapers/seats-aero.ts`). This is the gold standard. The goal is to replicate what seats.aero provides WITHOUT paying for their API — which means scraping airlines directly (which is what the other scrapers in `src/flights/scrapers/` attempt).

**Key insight:** seats.aero itself scrapes airlines. Their value-add is doing it reliably at scale with anti-bot bypass. Replicating this is the core challenge of the entire class-sniper project.

---

### 2. AwardFares ⚠️ EXPERIMENTAL

**What it is:** Award flight search across 16+ programs and 150+ airlines. Freemium model.

**Pricing:**
- Free: ~5 searches/day, limited results
- Standard ($9.99/mo): Unlimited searches, timeline view, email alerts
- Gold ($19.99/mo): All features + journey builder + seat maps

**Technical:**
- React SPA behind Cloudflare WAF
- Internal API at `awardfares.com/api/search` (POST)
- Cookie-based authentication
- Search URL pattern: `awardfares.com/search?from=JFK&to=NRT&date=2026-03-15&cabin=business`

**Scraping approach:**
1. Log in via browser, extract session cookie
2. Set `AWARDFARES_SESSION` env var
3. Make API calls with that session

**Challenges:**
- Cloudflare blocks non-browser requests (403)
- Session cookies expire frequently
- Free tier is heavily rate-limited
- Would need browser automation (Playwright) to maintain sessions

**Scraper:** `src/flights/scrapers/awardfares.ts` — built but untested (needs session cookie)

---

### 3. ExpertFlyer ⚠️ EXPERIMENTAL

**What it is:** GDS-based award availability tool owned by Red Ventures (same parent as The Points Guy).

**Pricing:**
- Free: 1 alert, seat maps only
- Basic ($49.99/yr): 250 queries/mo, 4 alerts
- Premium ($99.99/yr): Unlimited queries, 200 alerts

**Unique value:** Shows **raw booking class availability** — e.g., "I2" means 2 award business class seats available. This is the GDS-level data that award programs use to determine availability.

**Award booking classes (key ones):**
- United: X/XN (econ), I/IN (biz), O/ON (first) — saver award classes
- ANA: X (econ), I (biz), O (first)
- Singapore: X (econ), I (biz), O (first)
- Cathay Pacific: X (econ), I (biz), O (first)

**Technical:**
- Server-rendered pages with AJAX
- Login required (form-based auth)
- Multi-step search: POST form → get search ID → poll results page
- Results in HTML tables

**Scraping approach:**
1. Log in, extract session cookie
2. Set `EXPERTFLYER_SESSION` env var
3. Submit search form, parse HTML results

**Challenges:**
- Requires paid subscription for useful queries
- HTML parsing is fragile
- Rate limited (250/mo on basic)
- ExpertFlyer recently lost Star Alliance award data (Oct 2023) — may have regained some

**Scraper:** `src/flights/scrapers/expertflyer.ts` — built but untested (needs account + session cookie)

---

### 4. point.me ❌ NOT VIABLE

**What it is:** Award flight search engine covering 100+ airlines and 30+ programs. Subscription only.

**Pricing:** Paid membership required (pricing not publicly listed, ~$100+/yr)

**Why not viable:**
- Hard login wall — no free tier for searching
- SPA with heavy client-side rendering
- Anti-scraping measures
- Would need to maintain a paid account AND bypass their protections
- Not worth the effort vs. seats.aero

---

### 5. Cowtool ❌ DEAD

**What it is:** Was an unofficial Aeroplan/AC reward search tool.

**Status:** **Voluntarily shut down by its creator in October 2023.** The AC Reward Searcher page (acrewardsearcher.cowtool.com) now shows a shutdown message.

**Context:** Air Canada's VP publicly discussed cracking down on scraping tools. The creator shut it down preemptively — "no request, instruction, or legal order from any other party."

**Not usable.** Don't bother.

---

### 6. Google Flights Award Integration ❌ NOT NATIVE

**What it is:** Google Flights itself does NOT show award/miles pricing. However:

- **Points Path** is a 3rd-party Chrome extension that overlays award pricing on Google Flights
- Points Path scrapes airline award sites and shows "Use Cash" vs "Use Miles" recommendations
- It covers: AA, Alaska, Delta, United, JetBlue

**Why not useful for us:**
- Points Path is a browser extension, not an API
- We already have a Google Flights cash price scraper
- The extension itself is doing the same scraping work we're trying to do
- No extractable API from Google for award data

---

## Recommendations

### Priority Order for Data Sources:

1. **seats.aero API** (already built) — Use as fallback/validation. $10/mo is cheap insurance.
2. **Direct airline scrapers** (already built, mostly blocked) — The real goal. Need anti-bot bypass.
3. **AwardFares** (experimental) — Could supplement if we get session management working.
4. **ExpertFlyer** (experimental) — Niche use: confirming GDS-level availability for specific flights.

### Next Steps:

1. **Fix direct airline scrapers** — The blocked scrapers (United, AA, Flying Blue, Alaska) are the real prize. Focus on anti-bot bypass (residential proxies, browser fingerprinting, etc.)
2. **Test AwardFares scraper** — Log into awardfares.com, extract session cookie, test the scraper
3. **Consider Amadeus API** — Reddit threads mention contractual access to raw Amadeus GDS data for award classes. This is what ExpertFlyer uses. Could be a legitimate data source with API access.
4. **Keep seats.aero as safety net** — The $10/mo Pro API is extremely good value. Use it for validation and as a fallback when direct scrapers fail.

### Amadeus API (Future Research):

Per Reddit discussions, Amadeus offers paid API access that can query award fare classes:
- https://developers.amadeus.com/
- Can query X, I, O classes directly
- "Pay per call" plan available
- This is the same data ExpertFlyer uses
- Could be the most reliable programmatic approach
