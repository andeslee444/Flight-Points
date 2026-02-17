# ANA Mileage Club Award Scraper — Research

**Date:** 2026-02-16  
**Status:** Implemented (login-gated, with chart fallback)

## Key Findings

### 1. ANA Award Search Requires Login
- **All** award search/booking on ana.co.jp requires an ANA Mileage Club (AMC) account
- Free signup: https://www.ana.co.jp/en/us/amc/
- Login uses 10-digit AMC number + web password
- No guest/anonymous award search exists

### 2. Award Calendar (Best Discovery)
- **URL:** `https://cam.ana.co.jp/psz/tokutencal/form_e.jsp`
- Shows 6 months of availability at a glance
- Uses shape/color coding: ◎ (wide open), ○ (available), △ (limited), × (unavailable)
- Only shows ANA-operated flights (not partner airlines)
- Updated nightly ("based on availability last night")
- Can filter by route region + cabin class
- Reference: [Thrifty Traveler article](https://thriftytraveler.com/news/points/ana-business-first-class-availability-tool/)

### 3. Full Award Booking Search
- **URL:** `https://aswbe-i.ana.co.jp/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml`
- Alternate: `https://www.ana.co.jp/en/jp/guide/reservation/flight-awards/`
- ANA added one-way awards in the 2025-2026 program
- Search requires being logged in first
- Results show flight details, miles required, seat availability

### 4. 2025-2026 Award Chart Changes
- New chart effective June 24, 2025: https://www.ana.co.jp/en/us/amc/international-flight-awards/2025-2026/
- One-way awards now available (previously round-trip only)
- Partner award system resumed January 27, 2026

### 5. Anti-Bot Detection
- ANA uses moderate bot protection (less aggressive than US carriers)
- `cam.ana.co.jp` (award calendar) appears to have lighter protection
- Headed browser recommended over headless
- Stealth measures: human-like delays, realistic fingerprints

## ANA Award Chart (One-Way, ANA Miles)

### US ↔ Japan (Zone 1)
| Cabin | Low Season | Regular | High Season |
|-------|-----------|---------|-------------|
| Economy | 30,000 | 35,000 | 38,000 |
| Premium Eco | 40,000 | 46,000 | 49,000 |
| Business | 43,000 | 50,000 | 55,000 |
| First | 55,000 | 75,000 | 75,000 |

### US ↔ Europe
| Cabin | Low Season | Regular | High Season |
|-------|-----------|---------|-------------|
| Economy | 30,000 | 35,000 | 40,000 |
| Business | 48,000 | 58,000 | 63,000 |
| First | 62,000 | 80,000 | 88,000 |

### Sweet Spots
- **JFK → NRT Business (low):** 43,000 ANA miles = incredible value
- **JFK → NRT First (low):** 55,000 ANA miles = best F redemption in the world
- **Round-the-world First:** 180,000 ANA miles
- Via Virgin Atlantic: 90K VS miles for ANA Business, 110K for First

## Architecture

### Scraper Flow
```
searchANA(params)
├── Check cache
├── If credentials set:
│   ├── Login via cam.ana.co.jp (award calendar login page)
│   ├── Try Award Calendar scrape (fast, 6-month view)
│   ├── If no results → Full award search (Playwright)
│   └── Cache results
└── If no credentials:
    └── Return award chart estimates (pricing only, not availability)
```

### Environment Variables
```
ANA_USERNAME=1234567890   # 10-digit AMC number
ANA_PASSWORD=your_web_password
```

### Data Sources
1. **ana-calendar** — From Award Calendar scrape (availability confirmed)
2. **ana** — From full award search (detailed flight info)
3. **ana-calendar-api** — From intercepted API during calendar
4. **ana-estimated** — From award chart (no availability check)
5. **ana-chart** — Season variant pricing for reference

## Alternative Data Sources

### seats.aero
- Aggregates ANA award availability
- Has specific ANA First finder: https://seats.aero/anaf
- May be more reliable than direct scraping for availability alerts

### AwardFares
- Commercial tool, monitors ANA availability
- https://awardfares.com/programs/ana-mileage-club

### United.com
- As Star Alliance partner, United shows some ANA award space
- Often shows saver-level ANA availability that ANA's own site also shows

## Known Limitations
1. Award Calendar only shows ANA-operated flights (not Star Alliance partners)
2. Calendar data is ~24h old
3. No passenger count filtering on calendar
4. Calendar only shows ~6 months out (ANA books 355 days out)
5. ANA availability in Business/First is notoriously scarce except last-minute
6. Amex → ANA transfer takes 48+ hours (space may disappear)

## Test Route
- **Route:** JFK → NRT (Tokyo Narita)
- **Cabin:** Business
- **Date:** March 15, 2026
- **Expected miles:** 55,000 (high season March)
- **Actual availability:** Likely very limited for business; economy more probable

## Files
- `src/flights/scrapers/ana.ts` — Main scraper
- `research/ana-scraper.md` — This file
