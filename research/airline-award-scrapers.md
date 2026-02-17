# Airline Award Search Scraper Research

**Date:** 2026-02-16
**Test Route:** JFK → NRT, March 15 2026, Business Class

## Summary Matrix

| # | Airline | Program | Login? | Partner Avail? | Anti-Bot | Scrapeable? | Status |
|---|---------|---------|--------|---------------|----------|-------------|--------|
| 1 | United | MileagePlus | N | Y (Star Alliance) | Medium (Akamai) | Y | **active** |
| 2 | Air Canada | Aeroplan | Y | Y (Star Alliance + partners) | Medium | Partial | **needs-login** |
| 3 | British Airways | Avios | N | Y (oneworld) | High (Akamai) | Difficult | **blocked** |
| 4 | Singapore Airlines | KrisFlyer | Y | Y (Star Alliance) | High | N | **needs-login** |
| 5 | Turkish Airlines | Miles&Smiles | Y | Y (Star Alliance) | Medium | N | **needs-login** |
| 6 | EVA Air | Infinity MileageLands | Y | Y (Star Alliance) | Low | N | **needs-login** |
| 7 | Lufthansa | Miles & More | Y | Y (Star Alliance) | High (Akamai) | N | **needs-login** |
| 8 | Swiss | Miles & More | Y | Y (Star Alliance) | High (Akamai) | N | **needs-login** |
| 9 | Asiana | Asiana Club | Y | Y (Star Alliance) | Medium | N | **needs-login** |
| 10 | American Airlines | AAdvantage | N | Y (oneworld) | High (Akamai/PerimeterX) | Difficult | **active** (fragile) |
| 11 | Cathay Pacific | Asia Miles | Y | Y (oneworld partners) | High | N | **needs-login** |
| 12 | Qantas | Frequent Flyer | Y | Y (oneworld) | High (Akamai) | N | **needs-login** |
| 13 | Japan Airlines | Mileage Bank | Y | Y (oneworld) | Medium | N | **needs-login** |
| 14 | Qatar Airways | Privilege Club | Y | Y (oneworld) | High (Cloudflare) | N | **needs-login** |
| 15 | Finnair | Finnair Plus | Y | Y (oneworld) | Medium | N | **needs-login** |
| 16 | Alaska Airlines | Mileage Plan | N | Y (partners) | Medium (Akamai) | Y | **active** |
| 17 | Delta | SkyMiles | N | N (Delta only) | High (Akamai/Shape) | Difficult | **blocked** |
| 18 | Air France/KLM | Flying Blue | N | Y (SkyTeam) | Medium | Y | **active** |
| 19 | Korean Air | SKYPASS | Y | Y (SkyTeam) | High | N | **needs-login** |
| 20 | Virgin Atlantic | Flying Club | Y | Limited (phone for most) | Medium | N | **needs-login** |
| 21 | Emirates | Skywards | Y | N (Emirates only) | High (Akamai) | N | **needs-login** |
| 22 | Etihad | Etihad Guest | Y | Limited | Medium | N | **needs-login** |
| 23 | JetBlue | TrueBlue | N | N (JetBlue only) | Low | Y | **active** |
| 24 | Southwest | Rapid Rewards | N | N (SW only) | Medium (Akamai) | Difficult | **blocked** |

## Detailed Research

---

### 1. United Airlines — MileagePlus ⭐ MOST VALUABLE
- **URL:** `https://www.united.com/en/us/fsr/choose-flights`
- **Login Required:** NO — can search award flights without login
- **Shows Partners:** YES — all Star Alliance partners with `clm=7` parameter
- **Anti-Bot:** Medium — Akamai Bot Manager, but generally passable with stealth Playwright
- **URL Pattern:** `?f={ORIGIN}&t={DEST}&d={DATE}&tt=1&at=1&sc={CABIN}&px=1&taxng=1&newHP=True&clm=7`
  - `sc=1` economy, `sc=7` business, `sc=8` first
  - `tt=1` one-way, `at=1` award travel
- **Data Fields:** airline, flight number, departure/arrival times, duration, stops, miles required, taxes, saver/everyday pricing, cabin class
- **Status:** ✅ ACTIVE — scraper exists at `scrapers/united.ts`
- **Notes:** Best Star Alliance scraper. Shows ANA, Lufthansa, Singapore, EVA, Turkish partner availability.

---

### 2. Air Canada — Aeroplan ⭐ VERY VALUABLE
- **URL:** `https://www.aircanada.com/aeroplan/redeem/availability/outbound`
- **Login Required:** YES (as of ~March 2025)
- **Shows Partners:** YES — Star Alliance + Etihad, GOL, and others. Shows the MOST partner availability of any program.
- **Anti-Bot:** Medium — standard bot detection
- **URL Pattern:** `?org0={ORIGIN}&dest0={DEST}&departureDate0={DATE}&ADT=1&tripType=O&cabinClass={ECO|BUS|FIR}`
- **Data Fields:** airline, flight number, times, points required, taxes, cabin, mixed cabin options
- **Status:** ⚠️ NEEDS-LOGIN — scraper exists at `scrapers/aeroplan.ts` but requires authentication
- **Notes:** Previously the best scraper for everything. Now requires login. Consider credential-based scraping.

---

### 3. British Airways — Avios ⭐ VALUABLE
- **URL:** `https://www.britishairways.com/travel/redeem/execclub/`
- **Login Required:** NO for search (login required to book)
- **Shows Partners:** YES — all oneworld: AA, Cathay, JAL, Qatar, Qantas, Finnair, etc.
- **Anti-Bot:** HIGH — Akamai Bot Manager, aggressive detection
- **URL Pattern:** Complex multi-step form, not direct URL
- **Data Fields:** airline, flight, cabin, Avios required, taxes/surcharges
- **Status:** ⚠️ BLOCKED — Akamai usually blocks Playwright. Scraper exists but unreliable.
- **Notes:** Very high fuel surcharges on BA metal. Best used to check partner availability, then book through other programs.

---

### 4. Singapore Airlines — KrisFlyer
- **URL:** `https://www.singaporeair.com/en_UK/plan-and-book/redeem/flights/`
- **Login Required:** YES
- **Shows Partners:** YES — Star Alliance partners
- **Anti-Bot:** HIGH — Distil Networks / Akamai
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** seats.aero scrapes this and recently had issues. KrisFlyer search has been broken for third-party tools.

---

### 5. Turkish Airlines — Miles&Smiles
- **URL:** `https://www.turkishairlines.com` → Award Ticket checkbox on search
- **Login Required:** YES — must be logged in to search award tickets
- **Shows Partners:** YES — Star Alliance partners
- **Anti-Bot:** Medium
- **Scrapeable:** NO (login wall)
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** Has sweet spots for business class to Asia/Europe. Award search is behind login.

---

### 6. EVA Air — Infinity MileageLands
- **URL:** `https://www.evaair.com/en-us/manage-your-trip/redeem-award/`
- **Login Required:** YES
- **Shows Partners:** YES — Star Alliance
- **Anti-Bot:** Low
- **Scrapeable:** NO (login wall)
- **Status:** ❌ NEEDS-LOGIN

---

### 7. Lufthansa — Miles & More
- **URL:** `https://www.miles-and-more.com/`
- **Login Required:** YES
- **Shows Partners:** YES — Star Alliance
- **Anti-Bot:** HIGH — Akamai
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN

---

### 8. Swiss — Miles & More
- **URL:** Same as Lufthansa Miles & More (shared program)
- **Login Required:** YES
- **Shows Partners:** YES — Star Alliance
- **Anti-Bot:** HIGH — Akamai
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN

---

### 9. Asiana — Asiana Club
- **URL:** `https://flyasiana.com/` → Mileage Award Ticket
- **Login Required:** YES
- **Shows Partners:** YES — Star Alliance
- **Anti-Bot:** Medium
- **Scrapeable:** NO (login wall)
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** Asiana merging with Korean Air, program may change.

---

### 10. American Airlines — AAdvantage ⭐ VALUABLE
- **URL:** `https://www.aa.com/booking/search`
- **Login Required:** NO — can search award flights without login by selecting "Redeem miles"
- **Shows Partners:** YES — oneworld partners (BA, Cathay, JAL, Qatar, Qantas, etc.)
- **Anti-Bot:** HIGH — Akamai Bot Manager + PerimeterX, very aggressive
- **URL Pattern:** `https://www.aa.com/booking/search?locale=en_US&pax=1&adult=1&type=OneWay&searchType=Award&origin={ORIGIN}&destination={DEST}&departureDate={YYYY-MM-DD}&cabin=BUSINESS`
- **Data Fields:** airline, flight number, times, miles required, taxes, cabin, award type
- **Status:** ⚠️ ACTIVE but fragile — frequently blocked by anti-bot
- **Notes:** AwardWiz project has an AA scraper. Very valuable for oneworld availability but hard to maintain.

---

### 11. Cathay Pacific — Asia Miles
- **URL:** `https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flights/`
- **Login Required:** YES
- **Shows Partners:** YES — oneworld + others (Alaska, etc.)
- **Anti-Bot:** HIGH
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN

---

### 12. Qantas — Frequent Flyer
- **URL:** `https://www.qantas.com/au/en/book-a-trip/redeem-points/flights.html`
- **Login Required:** YES
- **Shows Partners:** YES — oneworld partners
- **Anti-Bot:** HIGH — Akamai, very aggressive. Qantas has gone after scrapers legally.
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN + BLOCKED
- **Notes:** Qantas actively pursues legal action against scrapers.

---

### 13. Japan Airlines — Mileage Bank
- **URL:** `https://www.jal.co.jp/en/jalmile/use/jal/inter/`
- **Login Required:** YES
- **Shows Partners:** YES — oneworld
- **Anti-Bot:** Medium
- **Scrapeable:** NO (login wall)
- **Status:** ❌ NEEDS-LOGIN

---

### 14. Qatar Airways — Privilege Club
- **URL:** `https://www.qatarairways.com/en/Privilege-Club/use-qmiles.html`
- **Login Required:** YES
- **Shows Partners:** YES — oneworld
- **Anti-Bot:** HIGH — Cloudflare
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN

---

### 15. Finnair — Finnair Plus
- **URL:** `https://www.finnair.com/en/finnair-plus`
- **Login Required:** YES
- **Shows Partners:** YES — oneworld
- **Anti-Bot:** Medium
- **Scrapeable:** NO (login wall)
- **Status:** ❌ NEEDS-LOGIN

---

### 16. Alaska Airlines — Mileage Plan ⭐ VALUABLE
- **URL:** `https://www.alaskaair.com/shopping/flights`
- **Login Required:** NO — can search award flights without login by toggling "Use miles"
- **Shows Partners:** YES — oneworld partners (AA, BA, Cathay, JAL, Qatar, Qantas, Finnair) + others (Emirates, Singapore, Korean Air, Icelandair, etc.)
- **Anti-Bot:** Medium — Akamai, generally passable
- **URL Pattern:** `https://www.alaskaair.com/shopping/flights?tripType=oneway&prior=award&orig={ORIGIN}&dest={DEST}&departDate={MM/DD/YYYY}&adults=1&cabinType=Business`
- **Data Fields:** airline, flight number, times, miles required, taxes, cabin, partner airline
- **Status:** ✅ ACTIVE — new scraper needed
- **Notes:** Unique partner network. Shows Emirates, Singapore, Korean Air availability that others don't.

---

### 17. Delta — SkyMiles
- **URL:** `https://www.delta.com/flight-search/search`
- **Login Required:** NO — can search with "Shop with Miles" toggle
- **Shows Partners:** NO — only Delta metal (SkyTeam partner awards must be searched by calling or through partner sites)
- **Anti-Bot:** HIGH — Akamai Bot Manager + Shape Security, extremely aggressive
- **URL Pattern:** `https://www.delta.com/shop/ow/search?cacheKeySuffix=...` (complex)
- **Data Fields:** flight number, times, miles, taxes, cabin
- **Status:** ❌ BLOCKED — Shape Security nearly impossible to bypass
- **Notes:** Delta doesn't show partner awards online. Only useful for Delta-metal flights. AwardWiz also lists Delta as "temp broken."

---

### 18. Air France/KLM — Flying Blue ⭐ VALUABLE
- **URL:** `https://www.airfrance.us/search/offers`
- **Login Required:** NO — can search award prices without login
- **Shows Partners:** YES — SkyTeam partners (KLM, Delta, Korean Air, etc.)
- **Anti-Bot:** Medium — standard protections, generally passable
- **URL Pattern:** `https://www.airfrance.us/search/offers?pax=1:0:0:0:0:0:0:0&cabinClass=BUSINESS&activeConnection=0&origin={ORIGIN}&destination={DEST}&outboundDate={YYYY-MM-DD}&tripType=ONE_WAY&activeOutboundSubConnection=0`
- **Data Fields:** airline, flight, times, miles required, taxes, cabin, promo awards
- **Status:** ✅ ACTIVE — new scraper needed
- **Notes:** Has a useful award calendar feature. Flying Blue often has promo awards at 25-50% discount. Best SkyTeam scraper.

---

### 19. Korean Air — SKYPASS
- **URL:** `https://www.koreanair.com/` → Booking → Award Booking
- **Login Required:** YES
- **Shows Partners:** YES — SkyTeam partners
- **Anti-Bot:** HIGH
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** AwardFares doesn't even support SKYPASS yet.

---

### 20. Virgin Atlantic — Flying Club
- **URL:** `https://www.virginatlantic.com/`
- **Login Required:** YES for award search
- **Shows Partners:** LIMITED — most partner awards require phone call (800-862-8621)
- **Anti-Bot:** Medium
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** Main value is booking ANA flights with Virgin points. Partner search mostly phone-only.

---

### 21. Emirates — Skywards
- **URL:** `https://www.emirates.com/us/english/manage-booking/redeem-miles/`
- **Login Required:** YES
- **Shows Partners:** NO — Emirates only (no alliance)
- **Anti-Bot:** HIGH — Akamai
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN
- **Notes:** Can search cash fares without login. Award search requires Skywards login. First class awards now restricted to elite members.

---

### 22. Etihad — Etihad Guest
- **URL:** `https://www.etihad.com/en-us/manage/etihad-guest`
- **Login Required:** YES
- **Shows Partners:** LIMITED
- **Anti-Bot:** Medium
- **Scrapeable:** NO
- **Status:** ❌ NEEDS-LOGIN

---

### 23. JetBlue — TrueBlue
- **URL:** `https://www.jetblue.com/booking/flights`
- **Login Required:** NO — can search with points toggle
- **Shows Partners:** NO — JetBlue only (no alliance)
- **Anti-Bot:** LOW — minimal protection
- **URL Pattern:** `https://www.jetblue.com/booking/flights?from={ORIGIN}&to={DEST}&depart={YYYY-MM-DD}&is498MultiCity=false&nonstop=false&passengers=1&ptype=award&roundTripFaresFlag=false`
- **Data Fields:** flight number, times, points required, taxes, cabin
- **Status:** ✅ ACTIVE — easy to scrape
- **Notes:** Points are revenue-based (fixed cpp). Only JetBlue routes. Low value but easy.

---

### 24. Southwest — Rapid Rewards
- **URL:** `https://www.southwest.com/air/booking/`
- **Login Required:** NO — can toggle "Points" search
- **Shows Partners:** NO — Southwest only
- **Anti-Bot:** Medium — Akamai, bot challenges
- **URL Pattern:** Not direct-linkable (requires form submission)
- **Scrapeable:** Difficult
- **Status:** ❌ BLOCKED
- **Notes:** Southwest doesn't participate in any alliance. Points are revenue-based. Bot detection is moderately aggressive.

---

## Recommended Scraper Priority

### Tier 1 — Build/Maintain (No login, shows partners)
1. **United** — Star Alliance ✅ EXISTS
2. **American Airlines** — oneworld (fragile but valuable)
3. **Alaska Airlines** — unique partner network
4. **Air France/Flying Blue** — SkyTeam
5. **JetBlue** — easy, JetBlue-only

### Tier 2 — API Alternative
6. **seats.aero** ✅ EXISTS — aggregates many airlines via API ($)

### Tier 3 — Need Credentials
7. **Aeroplan** — best overall but needs login
8. **BA Avios** — exists but blocked by Akamai

### Not Worth Building (login + high anti-bot)
- Singapore, Turkish, Lufthansa/Swiss, EVA, Asiana
- Cathay, Qantas, JAL, Qatar, Finnair
- Korean Air, Virgin Atlantic, Emirates, Etihad
- Delta (blocked), Southwest (blocked)

## API Alternatives

- **seats.aero** — $10/mo API, covers: United, AA, Delta, Alaska, JetBlue, Southwest, Air France/KLM, BA, Qantas, Singapore, Emirates, Etihad, Virgin Atlantic, and more
- **point.me** — commercial tool, no API
- **AwardFares** — commercial tool, limited API
- **AwardWiz** (open source) — supports AA, Aeroplan, Alaska, Delta, JetBlue, Southwest, United
