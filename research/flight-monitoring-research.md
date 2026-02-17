# Award Flight Monitoring — Research Findings
*Date: 2026-02-16*

## Executive Summary

**Best approach: seats.aero Pro API as primary data source, with United.com Playwright scraping as fallback.**

seats.aero aggregates award availability across all major programs and offers a Pro API for $9.99/month with 1,000 calls/day — more than enough for monitoring.

---

## Data Sources Evaluated

### 1. seats.aero API ⭐ PRIMARY
- **Status:** HAS PUBLIC API (Pro tier, $9.99/month)
- **Endpoint:** `GET https://seats.aero/partnerapi/search` (Cached Search)
- **Bulk:** `GET https://seats.aero/partnerapi/availability` (Bulk Availability by program)
- **Trips:** `GET https://seats.aero/partnerapi/trips/{id}` (flight-level detail)
- **Routes:** `GET https://seats.aero/partnerapi/routes` (available routes)
- **Auth:** `Partner-Authorization: pro_xxxxxxxxxxxxxxxxxxxxx` header
- **Limits:** 1,000 API calls/day, resets at midnight UTC
- **Coverage:** All major programs — ANA, United, Aeroplan, Virgin Atlantic, Singapore, BA, AA, Delta, etc.
- **Data:** Cached availability (may be hours old, but good enough for monitoring)
- **Commercial use:** Requires separate approval, but personal Pro use is fine for MVP
- **Verdict:** ✅ BEST OPTION. Single API covers everything. $9.99/mo is negligible.

### 2. United.com Award Search
- **Status:** NOW REQUIRES LOGIN (as of Dec 2025)
- **URL pattern:** `https://www.united.com/en/us/fsr/choose-flights?f=JFK&t=NRT&d=2026-03-15&tt=1&at=1&sc=7&px=1&taxng=1`
- **Coverage:** All Star Alliance partners
- **Problem:** Login requirement makes scraping much harder. Need account credentials, CAPTCHA, anti-bot.
- **Verdict:** ⚠️ FALLBACK ONLY. Use Playwright with stealth if seats.aero unavailable.

### 3. Aeroplan (Air Canada)
- **Status:** Requires login
- **Coverage:** Huge partner network (Star Alliance + others)
- **Problem:** Heavy anti-bot, requires account
- **Verdict:** ❌ Too fragile for automated monitoring

### 4. American Airlines AAdvantage
- **Status:** Requires login, heavy anti-bot
- **Coverage:** oneworld alliance
- **Verdict:** ❌ Not practical for scraping

### 5. British Airways / Avios
- **Status:** Requires login, multi-step search
- **Coverage:** oneworld alliance
- **Verdict:** ❌ Not practical for scraping

### 6. point.me
- **Status:** No public API. Paid service ($99/yr for users)
- **Verdict:** ❌ No integration path

### 7. ExpertFlyer
- **Status:** Has API but expensive ($199/mo+), mainly for fare class availability
- **Verdict:** ❌ Too expensive for MVP

### 8. Google Flights / ITA Matrix
- **Status:** No official API. Can scrape for cash prices (useful for CPP calculation)
- **Verdict:** 🔄 USEFUL FOR CASH PRICE COMPARISON ONLY

### 9. Award Flight Aggregator APIs
- **Status:** seats.aero IS the aggregator. No other viable public APIs found.
- **Verdict:** seats.aero is the answer

---

## Recommended Architecture

```
                    ┌─────────────────┐
                    │  User Signup     │
                    │  (flight-signups)│
                    └───────┬─────────┘
                            │
                    ┌───────▼─────────┐
                    │ Background       │
                    │ Monitor (30min)  │
                    └───────┬─────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────▼──┐  ┌──────▼───┐  ┌──────▼───┐
     │seats.aero │  │United.com│  │Google    │
     │API        │  │(fallback)│  │Flights   │
     │(primary)  │  │Playwright│  │(cash $)  │
     └────────┬──┘  └──────┬───┘  └──────┬───┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                    ┌───────▼─────────┐
                    │ Results Cache    │
                    │ + CPP Calc       │
                    └───────┬─────────┘
                            │
                    ┌───────▼─────────┐
                    │ Alert if match   │
                    │ (WhatsApp/Log)   │
                    └─────────────────┘
```

## Transfer Partner Mapping

See `src/flights/transfer-partners.ts` for complete mapping.

## Next Steps
1. ✅ Get seats.aero Pro subscription ($9.99/mo)
2. ✅ Generate API key from Settings → API
3. ✅ Set `SEATS_AERO_API_KEY` in `.env`
4. ✅ Build monitoring engine
5. 🔄 Add United.com fallback scraper
6. 🔄 Add Google Flights cash price lookup
