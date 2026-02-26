# Domain Pitfalls

**Domain:** Award flight search and deal discovery platform
**Researched:** 2026-02-26
**Milestone context:** Adding modern frontend (Next.js/React), user accounts, alert systems, and historical trend features to an existing flight scraping backend

---

## Critical Pitfalls

Mistakes that cause rewrites or major user trust failures.

---

### Pitfall 1: Displaying Phantom Award Availability Without Staleness Indicators

**What goes wrong:** Results show award seats that cannot actually be booked. This is the #1 user trust killer in the award flight search space. Phantom space occurs when airline partner systems are out of sync, when the 30-minute daemon cache is stale at moment of display, or when scrapers return calendar-level availability (e.g., Cathay AFR API) that doesn't confirm per-flight bookability.

**Why it happens:** The project's `SCRAPER_REGISTRY` mixes calendar-level scrapers (Cathay AFR returns "H/L/NA" bucket availability, not individual flight confirmations) with live booking-surface scrapers (AA CDP returns actual booking flow results). All results are returned as `FlightResult[]` with no provenance field indicating which type of data sourced the result. The frontend has no way to distinguish "confirmed bookable" from "calendar indicates availability." Competitor tools (Seats.aero, PointsYeah) are specifically criticized for phantom space on JAL and Delta routes.

**Consequences:**
- Users transfer points to a program before verifying bookability, then discover the space was phantom — catastrophic trust loss
- Social media complaints spread fast in the tight-knit award travel community
- Users who lose transferred points (non-reversible with most programs) will never return

**Prevention:**
- Add a `availabilityType` field to `FlightResult`: `'confirmed'` (scraped from booking flow) vs `'calendar'` (only bucket-level data)
- Display calendar-level results with explicit UI warning: "Availability unconfirmed — verify before transferring points"
- Show data freshness timestamp on all results ("Last updated 18 minutes ago")
- Gate the "Set Alert" CTA on route — never trigger an alert from calendar-only data

**Detection / Warning Signs:**
- Any result sourced from Cathay AFR API (calendar-level only)
- Any result from a scraper that doesn't click through to a booking step
- Cache entries older than 35 minutes in the web display

**Phase to address:** Frontend build (first phase of new frontend). This must be in the data model before the first user-facing result is rendered. Retrofitting is difficult.

---

### Pitfall 2: SSE / Live-Search Architecture Incompatible with Vercel Serverless

**What goes wrong:** The existing live scraper (`live-scraper.ts`) uses Server-Sent Events (SSE) with long-lived connections and spawns Python subprocesses (Camoufox, Chrome CDP). Vercel serverless functions have a hard 60-second timeout on the Hobby tier (300 seconds on Pro) and cannot spawn system processes or run Python. Deploying the Next.js frontend to Vercel and naively routing `/api/flights/live-search` through a Vercel function results in silent failures or timeouts for the most important user-facing feature.

**Why it happens:** The split between "Vercel frontend" and "Harbor Mac Mini daemon" is already established, but the boundary is easy to blur when building new API routes in Next.js. Developers instinctively add API routes alongside components, forgetting that live-search requires Python subprocesses that cannot run on Vercel. Flying Blue CDP alone takes ~50 seconds; AA CDP takes ~20 seconds — both exceed Hobby limits.

**Consequences:**
- Live search silently times out or returns empty on production (works fine locally)
- SSE stream cuts off mid-flight causing broken UI state (spinner that never resolves)
- HTTP/2 multiplexing on Vercel means SSE behaves differently than on the local Express server

**Prevention:**
- Keep the Express server on Harbor as the authoritative SSE endpoint for live search
- In Next.js, proxy live-search requests to `NEXT_PUBLIC_SCRAPER_API_URL` (the Harbor Express endpoint) — never implement live-search as a Vercel API route
- Add an integration test that asserts live-search endpoint is NOT a Next.js API route
- Document the deployment split explicitly in CLAUDE.md and in a visible README notice

**Detection / Warning Signs:**
- Any `app/api/live-search/route.ts` or `pages/api/live-search.ts` file appearing in the Next.js codebase
- SSE tests passing locally but failing in Vercel preview deployments
- Scraper timeout errors in Vercel function logs

**Phase to address:** Frontend architecture phase (must define the API boundary before any route is built). Also relevant to deployment phase.

---

### Pitfall 3: CPP Calculations Based on Static Cash Price Estimates Inflate Deal Ratings

**What goes wrong:** The existing `estimateCashPrice()` in `monitor.ts` uses static lookup tables (e.g., US-EU business = $4,000 flat). CPP is calculated as `(cashPrice - taxes) / pointCost`. When the cash price estimate is wrong, every deal rating downstream is wrong. A JFK-LHR business seat that costs $2,500 cash gets rated "incredible" at 100k points (4.0cpp) when the real CPP is 2.5. Users make transfer decisions based on inflated ratings and feel deceived.

**Why it happens:** Google Flights cash price scraping (`gf-curlffi.py`) is the real-time source, but it's a separate scraper call that can fail or time out. The static estimate is the fallback, and the frontend currently has no indicator of which source was used for the CPP displayed.

**Consequences:**
- False "S-tier" deal badges on routes where cash prices are seasonally low
- User trust erosion when users actually price the cash fare and see the discrepancy
- The problem worsens for routes with high price variance (JFK-LHR can range $1,800 to $15,000)

**Prevention:**
- Display CPP with its cash price source: "CPP: 4.2 (cash: $6,800 via Google Flights)" vs "CPP: est. 3.1 (cash price estimated)"
- Use a lower confidence deal tier for estimated-CPP results — never display "S-tier" if CPP is based on a static estimate
- Prioritize the Google Flights live cash price scraper and fail visibly (not silently) when it times out
- Add a route-specific cash price override table in the DB for the 20 highest-traffic routes

**Detection / Warning Signs:**
- `estimateCashPrice()` call path being hit in production logs (means Google Flights failed)
- Deal ratings changing dramatically on the same route across consecutive daemon cycles (cash price variance)

**Phase to address:** Frontend value assessment feature. Must be addressed before deal ratings are shown to users.

---

### Pitfall 4: Alert System Causing Point Transfer Before Availability Confirmation

**What goes wrong:** Users receive a WhatsApp or email alert, immediately transfer points to the program, and then find the seat is unavailable. Award availability can disappear in minutes. The current alert system fires when a result matches a sweet spot threshold — but there is no step that verifies the seat is still bookable at the time the alert is received. The 90-day dedup window prevents re-alerting even if the same space reappears.

**Why it happens:** The daemon scrapes on 30-minute cycles and sends alerts based on cached results. By the time a user receives the alert and checks the airline's booking page, up to 30+ minutes have passed. Business and First class award seats (the most valuable alerts) are extremely limited and often have multiple people watching the same routes via competitors like AwardFares and ExpertFlyer.

**Consequences:**
- Transferred points are stuck in a program with no usable redemption (Amex and Chase transfers are one-way and non-reversible)
- This is the most severe user harm scenario in the award travel domain

**Prevention:**
- Include explicit language in every alert: "Award space detected at [time]. Verify availability before transferring points."
- Add an "alert confidence" field: only fire high-confidence alerts for scrapers that confirmed availability from a booking surface (AA CDP, Flying Blue CDP), not calendar-level scrapers
- Add a "verify availability" link in the alert that triggers a live search for that specific route/date/cabin
- Implement a "soft alert" mode: send a daily digest of detected opportunities rather than instant alerts, reducing urgency that drives hasty transfers
- Never alert on calendar-level data (Cathay AFR bucket availability)

**Detection / Warning Signs:**
- Alert firing from `source: 'cathay-afr'` (calendar only)
- Alert firing more than 25 minutes after the daemon scrape timestamp on the result

**Phase to address:** Alert system implementation phase. Must be in the alert message template from day 1.

---

### Pitfall 5: PostgreSQL JSONB Blob Storage Blocks Historical Trend Queries

**What goes wrong:** The current `award_flights` table stores results as a JSONB array in a single column keyed by `route_key`. The `monitor_scans.results` column stores the entire `FlightResult[]` array as a JSONB blob. Historical trend queries (e.g., "show me how this route's point costs have changed over 6 months") are essentially impossible without scanning and deserializing every JSONB blob. PostgreSQL cannot build statistics on JSONB values, so even simple aggregations are full-table scans.

**Why it happens:** JSONB blobs were a pragmatic choice for the initial MVP — fast to implement, flexible schema. But the entire value proposition of the "historical trends" feature requires querying individual data points across time, not deserializing blobs. Research confirms JSONB queries can be 2000x slower than normalized columns for aggregate queries.

**Consequences:**
- Historical trend charts require in-application deserialization of potentially thousands of JSONB blobs
- AWS RDS instance CPU spikes during trend queries, impacting scraper throughput
- No way to query "what was the lowest point cost for JFK-LHR business in February?" without application-layer processing
- The feature gets deferred indefinitely because the data is technically there but practically unqueryable

**Prevention:**
- Design a normalized `flight_price_history` table before implementing the historical trends feature: `(route_key, source, flight_number, cabin, departure_date, scraped_at, points_required, taxes_usd, availability_type)`
- Add a unique constraint on `(route_key, source, flight_number, departure_date, cabin)` so upserts work cleanly
- The existing JSONB store can remain for the live cache; write a parallel insert to `flight_price_history` in the daemon's result handler
- Delete the `results` column from `monitor_scans` — it is never queried and consumes significant storage per the CONCERNS.md analysis

**Detection / Warning Signs:**
- Any query against `award_flights.results` or `monitor_scans.results` that includes a `WHERE` clause filtering on values inside the JSONB
- Historical trend feature being scoped as "pull all rows and filter in Node.js"

**Phase to address:** Historical trends phase. Schema must be migrated before any trend data is collected — retroactive migration of JSONB blobs is painful and often lossy.

---

## Moderate Pitfalls

Mistakes that degrade the product significantly but don't require full rewrites.

---

### Pitfall 6: Alert Fatigue from Unfiltered High-Volume Notifications

**What goes wrong:** The current WhatsApp alert system fires on every qualifying result per daemon cycle. As more routes are watched and more scrapers cover more inventory, alert volume increases. Research shows attention drops 30% for every repeated alert. Users in the award travel community are sophisticated — they will immediately unsubscribe from a noisy alert system, eliminating all value.

**Why it happens:** The 90-day dedup window prevents re-alerting on the same specific flight, but new scraper results for the same route on different dates all generate independent alerts. A user watching JFK-LHR business class could receive 10+ alerts per day as different date options cycle through the daemon.

**Prevention:**
- Implement alert frequency controls at the user level: "at most 1 alert per route per day" as the default
- Group related alerts into a single digest when 3+ alerts would fire for the same route within a 4-hour window
- Add an alert preference tier: "Instant" (S-tier deals only), "Daily digest" (all matching results), "Weekly summary"
- Track alert open/click rates — if a user never clicks, downgrade them to digest mode

**Phase to address:** Alert system implementation and user account phase.

---

### Pitfall 7: Chrome CDP Port Collisions Under Concurrent Live Search

**What goes wrong:** The Chrome CDP scraper (`chrome_cdp.py`) picks a random port in range 9222–9322 with only 3 attempts. The live scraper (`live-scraper.ts`) caps at 2 concurrent scrapers, but the daemon runs independently and also launches CDP sessions. Under normal load (1 daemon CDP session + 2 live-search CDP sessions), port collision probability rises significantly with only a 100-port range and 3 attempts. A failed CDP session silently returns empty results with no error surfaced to the user.

**Why it happens:** The port allocation was designed when only the daemon used CDP. Adding live-search concurrency doubles potential collisions. No file-based locking exists — the 3-try limit means graceful degradation to an empty result, which looks identical to "no award seats available."

**Prevention:**
- Implement `/tmp/chrome-cdp-*.lock` file-based port reservation using `fcntl` exclusive locks in `chrome_cdp.py`
- Expand the port range to 9222–9422 (200 ports)
- Emit a distinctive log entry when port collision causes fallback: `CDP_PORT_COLLISION` — enables monitoring
- If all CDP attempts fail, return a structured error rather than `[]` so the caller can distinguish "blocked" from "no seats"

**Phase to address:** Should be addressed before live-search CDP concurrency increases above 2.

---

### Pitfall 8: Flying Blue Session Expiry Causes Silent Empty Results in Production

**What goes wrong:** The Flying Blue CDP scraper relies on a Chrome profile session that expires approximately every hour. When the session expires, the scraper returns `[]` (no results) instead of raising a login-required error. The daemon falls through to other scrapers, all of which are Akamai-blocked for Flying Blue, ultimately returning no SkyTeam partner availability. This is invisible in production — the daemon health metrics show "scraper ran" but the SkyTeam coverage gap is not surfaced.

**Why it happens:** `is_logged_in()` in `flying-blue-cdp.py` uses a heuristic text scan for the account name "harbor" rather than a reliable DOM selector. When session expires, the function may incorrectly conclude the user is still logged in (especially if Air France redesigns the header), then fail at the search step and return `[]`.

**Prevention:**
- Add a `login_required` error type to the scraper's return contract — a JSON object `{"error": "LOGIN_REQUIRED", "scraper": "flying-blue"}` instead of `[]`
- In the TypeScript wrapper, treat `LOGIN_REQUIRED` as a circuit-breaker event that triggers a health alert (daemon status / webhook notification to the operator)
- Replace the `'harbor' in header.lower()` login check with a selector-based check for the account menu element
- Implement automated re-login: the Python scraper should detect session expiry and re-run the full login flow (OTP notwithstanding — for now, emit an alert and return an error)

**Phase to address:** Before Flying Blue results are included in any user-facing alert or trend data.

---

### Pitfall 9: "use client" Boundary Placed Too High in the Component Tree

**What goes wrong:** The live-search SSE streaming and real-time result rendering require client-side state. Developers new to Next.js App Router tend to mark entire page components as `"use client"` to resolve hydration errors, which eliminates Server Component benefits (initial HTML delivery, zero-JS for static parts) and increases client bundle size significantly. A flight results page that adds `"use client"` at the top level ships the entire data-fetching and enrichment logic to the browser.

**Why it happens:** App Router's React Server Components have a learning curve. The SSE stream for live search requires a client component. Mixing server-fetched cached results (fast, SEO-friendly) with SSE-streamed live results (slow, dynamic) in the same view without careful component boundary design leads to "the simplest fix" of making the whole page client-side.

**Prevention:**
- Design the results page as: Server Component (renders cached results from DB immediately) wrapping a Client Component (attaches SSE stream and appends new results as they arrive)
- The SSE listener component should be a leaf, not a root
- Add a lint rule or architecture note: pages in `app/` must not have `"use client"` at the top level unless they are purely interactive (e.g., a search input form)

**Phase to address:** Frontend architecture. Must be established in the first component template before the pattern is replicated.

---

### Pitfall 10: Multi-Airline Point Program Coverage Gaps Displayed Without Disclosure

**What goes wrong:** The platform covers oneworld (AA), SkyTeam (Flying Blue, Delta/VA), and selected partners (Alaska, Cathay). Star Alliance — covering ANA, Singapore Airlines, Lufthansa, Turkish, EVA, and United — is currently blocked by reCAPTCHA (Aeroplan/Gigya). If the frontend shows "Search all programs" or presents Amex MR results without disclosing that ANA (a top Star Alliance redemption) is not covered, users receive an incomplete picture and may miss better options.

**Why it happens:** The product vision states "all major credit card programs from day 1" but Star Alliance coverage is technically blocked. The gap is known but may not be reflected in the UI during early development. Competitor tools (point.me) are specifically criticized for missing ANA Mileage Club and Air Canada Aeroplan results on Seattle-Tokyo searches.

**Prevention:**
- Every program selector must show a coverage indicator: which airline alliances and carriers are actually searched
- Display "Star Alliance: Limited coverage" with a tooltip explaining the current gap
- Never promise "best available" or "all programs" in copy when coverage is incomplete
- Track search coverage as a metric: X% of routes have Star Alliance coverage (currently ~0%)

**Phase to address:** Frontend program selection and search results UI. Must be in the first public release of the search feature.

---

### Pitfall 11: Auth Implementation That Stores Airline Credentials or Loyalty Numbers

**What goes wrong:** As the platform gains user accounts, the temptation is to let users add their own loyalty program numbers and credentials so the system can check their personal mileage balances or search availability using their accounts. This introduces massive legal and security risk — storing unencrypted airline credentials is a ToS violation with every airline, a significant security liability, and a GDPR/CCPA concern.

**Why it happens:** It's a natural UX extension: "show me MY available miles." Competitors like AwardWallet offer this. But AwardWallet has faced legal challenges and scrapes with user consent. Building this without a legal framework first is a rewrite waiting to happen.

**Prevention:**
- Scope user accounts to: email, notification preferences, watched routes, alert history — nothing related to airline credentials
- Never build "connect your loyalty account" in early phases
- If this feature is ever considered, it requires legal review, a security audit, and explicit consent flows before any code is written

**Phase to address:** User account design phase. Must be a deliberate out-of-scope decision documented in PROJECT.md.

---

## Minor Pitfalls

Mistakes that create maintenance burden or minor UX issues but are recoverable.

---

### Pitfall 12: Deduplication Key Collisions from Inconsistent Departure Time Formats

**What goes wrong:** The fallback deduplication key in `scrapers/index.ts` uses `departureTime` when `flightNumber` is missing. Different scrapers format time differently (`"14:30"` vs `"14:30:00"` vs `"2:30 PM"`). The same flight from two sources creates duplicate rows in the results, inflating apparent availability.

**Prevention:** Normalize all time values to `HH:MM` (24-hour) in each scraper's TypeScript wrapper before they enter the registry. Add a unit test asserting dedup correctness across the known scraper time formats.

**Phase to address:** Scraper integration cleanup.

---

### Pitfall 13: Circuit Breaker State Lost on Daemon Restart

**What goes wrong:** The circuit breaker in `scraper-health.ts` is in-memory only. Restarting the daemon resets all circuit breakers, causing known-broken scrapers to retry immediately and potentially triggering rate limits or bans. The health state is written to the DB but never read back on startup.

**Prevention:** Add `readScraperHealth()` to `db.ts` and call it during daemon initialization to restore circuit breaker state. This is a one-file fix.

**Phase to address:** Daemon stability hardening, before adding more scrapers that could get into bad states.

---

### Pitfall 14: Requirements.txt Without Pinned Versions Breaks Scraper Deployments

**What goes wrong:** `requirements.txt` uses minimum version constraints (`patchright>=1.58.0`). Anti-detect libraries (curl_cffi, Patchright, Camoufox) introduce breaking API changes frequently as they chase browser fingerprint updates. An `apt-get update` or `pip install -r requirements.txt` in a new environment can install a newer breaking version.

**Prevention:** Pin exact versions (`patchright==1.58.0`) and generate a `requirements-lock.txt` from `pip freeze` on the known-working environment. Test any version upgrade explicitly before deploying.

**Phase to address:** Infrastructure setup for any new deployment environment.

---

### Pitfall 15: Hardcoded Credentials in Python Scrapers Committed to Git

**What goes wrong:** `flying-blue-cdp.py` has hardcoded email/password as default fallback values and is committed to the repository. If this file is ever pushed to a public fork or repository, credentials are exposed. The git history may already contain the credentials.

**Prevention:**
- Remove hardcoded defaults immediately; fail loudly if env vars are not set
- Run `git log --all --full-history -- src/flights/scrapers/flying-blue-cdp.py` to check history
- If credentials are in history, rotate them and consider a `git filter-repo` rewrite
- Add a pre-commit hook checking for `@gmail.com` and password strings in Python files

**Phase to address:** Immediate security cleanup, independent of any milestone.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Frontend architecture (Next.js) | `"use client"` boundary too high, eliminating Server Component benefits | Design component hierarchy before writing any routes |
| Live search UI | SSE endpoint deployed to Vercel (will timeout/fail) | Proxy to Harbor Express; document boundary explicitly |
| Deal rating display | CPP based on static estimate shown as authoritative | Always show CPP source; use lower tier for estimated CPP |
| Historical trends | JSONB blobs unqueryable for time series aggregation | Design normalized `flight_price_history` table first |
| Alert system | Alert fires on phantom/calendar-only availability | Flag `availabilityType`; never alert on calendar data |
| Alert system | Alert fatigue from high-volume unfiltered notifications | Per-user frequency caps from day 1 |
| User accounts | Scope creep toward storing airline credentials | Explicit out-of-scope in requirements; document rationale |
| Star Alliance coverage | UI implies complete coverage when Star Alliance is blocked | Coverage indicators required in program selector |
| Deployment | Split architecture confusion (Vercel vs Harbor) | Single source of truth doc for which endpoints live where |
| Scraper reliability | Chrome CDP port collisions under concurrent load | File-based port locking before increasing concurrency |
| Scraper reliability | Flying Blue session expiry returns `[]` not error | Structured error contract; operator health alert |

---

## Sources

- [The Truth About Award Search Tools: Seats.Aero, PointsYeah, Roame, & Point.Me](https://nursemichaeltravels.com/award-search-tools-problems/) — MEDIUM confidence; community analysis of competitor tool accuracy issues
- [7 Best Ways To Troubleshoot Phantom Award Space](https://upgradedpoints.com/travel/airlines/phantom-award-space/) — HIGH confidence; authoritative domain explanation from major travel publication
- [Dealing With Phantom/Ghost Award Availability - Roame](https://roame.travel/guides/phantom-space) — MEDIUM confidence; industry practitioner
- [Which award search tool is best? - FrequentMiler](https://frequentmiler.com/which-award-search-tool-is-best/) — HIGH confidence; long-running independent reviewer
- [When To Avoid JSONB In A PostgreSQL Schema - Heap](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) — HIGH confidence; technical deep-dive backed by benchmarks
- [Designing high-performance time series data tables on Amazon RDS - AWS](https://aws.amazon.com/blogs/database/designing-high-performance-time-series-data-tables-on-amazon-rds-for-postgresql/) — HIGH confidence; official AWS documentation
- [Vercel Backend Limitations - Northflank](https://northflank.com/blog/vercel-backend-limitations) — MEDIUM confidence; platform comparison article, matches known Vercel constraints
- [Next.js App Router Migration Pitfalls - eastondev.com](https://eastondev.com/blog/en/posts/dev/20251218-nextjs-pages-to-app-router-migration/) — MEDIUM confidence; practical migration guide
- [Bypass Akamai: The 3 Best Methods - ZenRows](https://www.zenrows.com/blog/bypass-akamai) — MEDIUM confidence; practitioners documenting detection vectors
- [Alert Fatigue: Impact on Users & Solutions - MagicBell](https://www.magicbell.com/blog/alert-fatigue) — MEDIUM confidence; notification platform research
- [How We Calculate Cents Per Point - Roame](https://roame.travel/guides/cents-per-point-calculations) — HIGH confidence; domain-specific CPP methodology from a market participant
- .planning/codebase/CONCERNS.md — HIGH confidence; direct codebase analysis identifying specific bugs and fragile areas
- .planning/PROJECT.md — HIGH confidence; authoritative project requirements and constraints
