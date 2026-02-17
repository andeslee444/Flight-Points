# Airline Award Scraping — Improvement Plan

**Date**: 2026-02-16
**Status**: Active research — bot detection blocking most direct scraping

---

## 1. Findings: Anti-Bot Bypass State of the Art (2025-2026)

### The Detection Landscape

Modern airline bot protection uses **layered detection**:
1. **TLS/JA3/JA4 fingerprinting** — identifies the TLS library (Playwright/Node.js vs real Chrome/Firefox)
2. **HTTP/2 fingerprinting** — SETTINGS frame, header order, priority tree
3. **JavaScript environment probing** — `navigator.webdriver`, automation flags, CDP artifacts
4. **Behavioral analysis** — mouse movement patterns, timing, scroll behavior
5. **Canvas/WebGL/AudioContext fingerprinting** — hardware signature consistency
6. **IP reputation** — datacenter IPs vs residential, ASN scoring

### Tools That Work (ranked by effectiveness)

| Tool | Type | Best Against | Detection Score | Notes |
|------|------|-------------|----------------|-------|
| **Camoufox** | Firefox-based anti-detect | Akamai, Cloudflare | 0% on major test suites | Best stealth, Firefox engine, Python API |
| **Nodriver** | Async Chrome (no CDP) | Most protections | Low detection | Successor to undetected-chromedriver, avoids CDP entirely |
| **Patchright** | Patched Playwright | Moderate protections | Low-medium | Drop-in Playwright replacement, removes automation flags |
| **curl_cffi** | HTTP client w/ TLS impersonation | API-level protections | N/A (no browser) | Matches Chrome/Firefox TLS fingerprint exactly |
| **Playwright Stealth** | Plugin | Basic protections | Medium | Not enough for Akamai/Shape alone |

### Key Technique: Cookie Harvesting + API Replay

The most reliable pattern for Akamai bypass (per r/webscraping community, 2025):
1. Use **Camoufox** with humanized mouse movements to visit the target site
2. Solve any challenges, get the `_abck` cookie (Akamai session cookie)
3. Extract cookies and use **curl_cffi** (or `rnet` with Firefox TLS) to call the API directly
4. Reuse the session until it expires, then harvest new cookies

This decouples the expensive browser step from the high-volume API calls.

### Shape Security (F5) — The Hardest Target

Shape/F5 Distributed Cloud Bot Defense is the **most sophisticated** antibot:
- Custom VM-based JavaScript obfuscation
- Sensor data encrypted with custom encoding ("superpack")
- Script changes frequently (daily/weekly rotations)
- Behavioral biometrics (keystroke dynamics, mouse patterns)
- **Proven bypass approaches**:
  - `curl_cffi` with proper TLS fingerprint handles 60-70% of Shape endpoints
  - **Nodriver** bypasses CDP detection that catches other tools
  - Full sensor data reverse engineering possible but extremely labor-intensive (see `sonya75/starbucks-botdetection-cracked`, `g2asell2019/shape-security-decompiler-toolkit`)
  - Browser-based approach with Camoufox/Nodriver + behavioral humanization is most practical

### TLS Fingerprinting Details

- **JA3/JA4** hashes identify your TLS client implementation
- Playwright uses BoringSSL (Chromium), which matches Chrome — but other signals leak
- **curl_cffi** can perfectly impersonate Chrome/Firefox TLS signatures
- Firefox (Camoufox) has a **different** TLS fingerprint than Chrome — some sites whitelist both
- Key: your TLS fingerprint must match your User-Agent claim

---

## 2. Airline-by-Airline Attack Plan

### Tier 1: Quick Wins (1-2 weeks)

#### AA.com — Akamai Bot Manager
**Current**: Works interactively, blocks in headless daemon
**Feasibility**: ⭐⭐⭐⭐⭐ HIGH

**Plan**:
1. **Switch to Camoufox** (Firefox-based, 0% detection)
   - `pip install camoufox && python -m camoufox fetch`
   - Enable `humanize=True` for mouse movements
   - Run in virtual display (Xvfb) for daemon mode
2. **Cookie harvesting + API replay**:
   - Use Camoufox to get valid `_abck` cookie
   - Reverse-engineer the AA award search API endpoint (likely `POST /booking/api/search`)
   - Replay with `curl_cffi` impersonating Chrome TLS
3. **Direct URL approach** (current) may just need residential proxy
   - AA's URL-based approach (`/booking/search?slices=...`) already works interactively
   - The daemon failure is likely IP reputation + headless detection combined
   - Try: Camoufox headless + residential proxy = likely success

#### Singapore Airlines — Site Redesigned
**Current**: Old selectors broken
**Feasibility**: ⭐⭐⭐⭐ HIGH

**Plan**:
1. **Update selectors** — straightforward Playwright update task
2. **Someone already built it**: Reddit user (May 2025) built SQ KrisFlyer availability tool — research their approach
3. **seats.aero** cracked SQ scraping (Feb 2025) — use their API as backup
4. **KrisFlyer API**: Intercept network requests from the new SPA to find the underlying API endpoint
5. **Fallback**: ANA scraper shows SQ metal on Star Alliance routes

#### ANA — Browser Context Closing
**Current**: Login works, context dies during scans
**Feasibility**: ⭐⭐⭐⭐ HIGH

**Plan**:
1. **Fix browser lifecycle** — the context/browser is being garbage collected
   - Ensure browser reference is held in a long-lived scope
   - Add keepalive/heartbeat to prevent idle disconnection
   - Use persistent context (`launchPersistentContext`) instead of creating new contexts
2. **Switch to award calendar endpoint** (`cam.ana.co.jp`) — lighter weight, less detection risk
3. **Session persistence** — save/restore cookies between runs to avoid re-login

### Tier 2: Medium Effort (2-4 weeks)

#### United Airlines — Akamai (Impenetrable)
**Current**: Completely blocked
**Feasibility**: ⭐⭐⭐ MEDIUM (via indirect approaches)

**Plan A: seats.aero API** (already implemented ✅)
- Pro plan $10/mo, 1000 calls/day
- Cached data, not real-time — acceptable for monitoring

**Plan B: Camoufox + cookie harvesting**
1. Launch Camoufox with `humanize=True` + residential proxy
2. Navigate to United award search, complete a search manually
3. Capture `_abck` cookie + any API tokens from network
4. Use `curl_cffi` to replay the `POST /api/flight/FetchFlights` endpoint
5. Rotate residential IPs per session

**Plan C: Partner backdoors**
- **ANA scraper** → shows United metal on Star Alliance
- **Aeroplan** (Air Canada) → also Akamai-protected but possibly lighter
- **Turkish Airlines** → Star Alliance, less protected
- **AwardFares** → commercial API if budget allows

**Plan D: Amadeus GDS**
- Query award fare classes (X, I, O) directly from Amadeus
- Cost: ~$6K-9K setup + per-query fees
- Gives Star Alliance saver availability without scraping any website
- Someone on Reddit confirmed: "I have contractual access to raw Amadeus availability... cost is trivial at unit level"

#### Delta Air Lines — Shape Security
**Current**: Completely blocked
**Feasibility**: ⭐⭐ LOW-MEDIUM

**Plan A: Virgin Atlantic backdoor** ⭐ Best approach
- Virgin Atlantic's award calendar shows Delta availability
- Trick: modify airport codes in the URL to search ANY Delta nonstop route
- Source: FrequentMiler (Sep 2024) — still working
- VA site may have lighter bot protection than delta.com
- Implementation: scrape VA award calendar with Camoufox

**Plan B: seats.aero API**
- Delta source available on seats.aero
- Dynamic pricing means data is less useful (prices vary wildly)
- But availability detection still works

**Plan C: Nodriver + behavioral humanization**
- Nodriver avoids CDP detection that catches Playwright
- Combined with residential proxy + human-like behavior
- Shape's VM obfuscation makes request-based bypass extremely difficult
- Browser-based with anti-detect is the only realistic path

**Plan D: Korean Air** (SkyTeam partner)
- KE shows Delta availability — but KE is also Akamai-protected
- Flying Blue on seats.aero shows SkyTeam routes

### Tier 3: Long-term / Alternative Data Sources

#### Amadeus GDS Direct Access
**Feasibility**: ⭐⭐⭐ MEDIUM (cost barrier)
- Can query award fare classes (X, I, O for United; I for AA, etc.)
- Does NOT show dynamic pricing (only saver availability)
- Does NOT show all award inventory (airlines can hide from GDS)
- Cost: Enterprise contract needed, ~$6-9K setup
- Best for: Star Alliance saver award monitoring at scale

#### seats.aero as Primary Data Source
**Feasibility**: ⭐⭐⭐⭐⭐ HIGH
- Already partially implemented
- Pro: $10/mo for 1000 API calls/day
- Commercial: Written agreement needed, higher volume
- Covers 24+ programs including AA, UA, DL, SQ, CX
- Data is cached (not real-time) but refreshed regularly
- **Recommendation**: Use seats.aero as the backbone, supplement with direct scrapers

#### AwardFares
- Commercial service, paid plans
- Has SQ KrisFlyer and KE SKYPASS data
- No public API — would need to scrape their site (ironic)
- Or negotiate commercial data access

---

## 3. Infrastructure Recommendations

### Must-Have (implement immediately)

#### A. Camoufox (replaces Playwright for anti-detect)
- **Cost**: Free (open source)
- **Install**: `pip install camoufox && python -m camoufox fetch`
- **Why**: 0% detection on major test suites, Firefox-based fingerprint injection
- **Integration**: Python API, works with Playwright protocol (via `playwright.firefox`)
- **Usage**: Cookie harvesting sessions, interactive scraping

#### B. curl_cffi (for API replay)
- **Cost**: Free (open source)
- **Install**: `pip install curl_cffi`
- **Why**: Perfect Chrome/Firefox TLS fingerprint impersonation
- **Usage**: High-volume API calls after cookie harvesting

#### C. Residential Proxies
- **Recommended**: Evomi ($0.49/GB) or DataImpulse ($1/GB) for budget; Bright Data for reliability
- **Budget**: ~$20-50/month for our scale (estimate 10-20GB/month)
- **Why**: Datacenter IPs are auto-flagged by Akamai; residential IPs needed for cookie harvesting
- **Usage**: Rotate per session, sticky sessions for multi-page flows

#### D. Virtual Display (Xvfb)
- **Cost**: Free
- **Why**: Run "headed" browsers in daemon mode without a real display
- **Setup**: Already on Mac Mini — `Xvfb :99 &` + `DISPLAY=:99`

### Nice-to-Have (implement in Phase 2)

#### E. Patchright (for existing Playwright scrapers)
- Drop-in replacement for Playwright with stealth patches
- `npm install patchright` or `pip install patchright`
- Easier migration path than full Camoufox rewrite
- May be sufficient for lighter protections (AA, SQ, ANA)

#### F. Browser Profile Persistence
- Maintain real Chrome/Firefox profiles with browsing history
- Cookie jar persistence across sessions
- Reduces "fresh browser" detection signal

#### G. Nodriver (for Shape Security targets)
- Python async Chrome automation without CDP
- Best option for Delta/Shape bypass
- `pip install nodriver`

---

## 4. Implementation Roadmap

### Phase 1: Quick Fixes (Week 1-2)
1. **Fix ANA browser lifecycle** — persistent context + keepalive
2. **Update Singapore Airlines selectors** — inspect new SPA, update Playwright selectors
3. **Fix AA daemon mode** — try Patchright as drop-in replacement, add residential proxy
4. **Expand seats.aero coverage** — ensure all supported airlines are queried via API

### Phase 2: Anti-Detect Upgrade (Week 3-4)
1. **Install Camoufox** — set up Python environment, test against AA.com
2. **Build cookie harvester** — Camoufox session → extract cookies → store
3. **Build API replay layer** — curl_cffi with harvested cookies for AA and United
4. **Set up residential proxies** — Evomi or DataImpulse account, integrate into scraper rotation
5. **Test against United** — Camoufox + residential proxy + cookie harvest → API replay

### Phase 3: Hard Targets (Week 5-8)
1. **Virgin Atlantic backdoor for Delta** — build scraper for VA award calendar
2. **Nodriver integration** — test against Delta direct as backup
3. **United direct scraping** — if Camoufox cookie harvesting works, build full pipeline
4. **Evaluate Amadeus GDS** — get pricing quotes, assess ROI for Star Alliance coverage

### Phase 4: Scale & Reliability (Week 9-12)
1. **Session pool management** — maintain pool of valid sessions per airline
2. **Automatic cookie refresh** — detect expiry, trigger new Camoufox harvest
3. **Monitoring & alerts** — detect when scrapers break, auto-fallback to seats.aero
4. **Rate limiting** — respect airline rate limits to avoid permanent bans
5. **Data quality layer** — cross-reference direct scraper data with seats.aero for validation

---

## 5. Cost Analysis

### Monthly Operating Costs

| Item | Cost | Notes |
|------|------|-------|
| seats.aero Pro | $10/mo | 1000 API calls/day, backbone data source |
| Residential proxies | $20-50/mo | ~10-20GB at $1-2.50/GB |
| Mac Mini electricity | ~$10/mo | Already running |
| **Total** | **~$40-70/mo** | |

### One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| Camoufox | Free | Open source |
| curl_cffi | Free | Open source |
| Patchright | Free | Open source |
| Development time | ~40-60 hours | Phases 1-3 |

### Optional: Amadeus GDS

| Item | Cost | Notes |
|------|------|-------|
| Setup/integration | $6,000-9,000 | One-time |
| Per-query fees | ~$0.01-0.05/query | Varies by contract |
| Monthly volume | ~$50-200/mo | Depends on query frequency |
| **ROI**: Only worth it if scraping fails completely and we need guaranteed Star Alliance data |

### Expected ROI

- **Current state**: AA works (partial), ANA partial, everything else blocked → ~30% coverage
- **After Phase 2**: AA reliable, ANA fixed, SQ fixed, United via seats.aero → ~70% coverage
- **After Phase 3**: Delta via VA backdoor, United direct attempts → ~85% coverage
- **With seats.aero backbone**: Fills gaps for all 24 programs → ~95% coverage for cached data

---

## 6. Open Source References

| Project | URL | Status | Notes |
|---------|-----|--------|-------|
| AwardWiz | github.com/lg/awardwiz | Partially working | Has AA, UA (broken), Delta (broken) scrapers + "Arkalis" anti-detect engine |
| Flightplan | github.com/flightplan-tool/flightplan | Abandoned | JS library for airline scraping, CX/UA/AA engines |
| AA Flight Search | github.com/tszumowski/aa_flight_search_tool | Old | AA-specific, likely outdated |
| AA Scraper (Docker) | github.com/Sekinal/aa_contest | Recent | Docker-based AA scraper with cookie support |
| Camoufox | github.com/daijro/camoufox | Active | Best anti-detect browser |
| curl_cffi | github.com/lexiforest/curl_cffi | Active | TLS fingerprint impersonation |
| Patchright | github.com/Kaliiiiiiiiii-Vinyzu/patchright | Active | Undetected Playwright fork |
| Shape Cracker | github.com/sonya75/starbucks-botdetection-cracked | Reference | Shape Security sensor data generation |
| Shape Decompiler | github.com/g2asell2019/shape-security-decompiler-toolkit | Reference | Shape VM deobfuscation toolkit |

---

## 7. Key Insights

1. **Don't fight the hardest battles first** — seats.aero API covers most airlines for $10/mo. Use it as backbone.
2. **Camoufox is the breakthrough** — 0% detection on major test suites, works against Akamai.
3. **Cookie harvesting + API replay** is the winning pattern — expensive browser for auth, cheap HTTP for data.
4. **Partner backdoors are underrated** — Virgin Atlantic for Delta, ANA for Star Alliance, BA for oneworld.
5. **Residential proxies are mandatory** — datacenter IPs are instant flags for Akamai/Shape.
6. **GDS is the nuclear option** — expensive but guaranteed data for saver award classes.
7. **Shape Security (Delta) is the hardest target** — don't invest here first; use VA backdoor instead.
