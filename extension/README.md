# Flight-Points Contributor (browser extension)

A **strictly opt-in** Chrome MV3 extension that harvests airline **award availability**
from the user's **own, already-logged-in tabs** and contributes it (HMAC-signed) to
the Flight-Points relay. This is the M3.3 crowdsource skeleton.

## Why this exists

The daemon scrapes from a single VPS IP and a handful of server-side sessions, so the
hardest walls stay dark:

- **reCAPTCHA logins** (e.g. Aeroplan's Gigya `errorCode 401020`) the server can't pass.
- **IP-reputation / Akamai** sites that distrust datacenter IPs.

A volunteer running this extension in their real browser sees that award space the
daemon never can — over a genuine **residential IP** and an **authenticated session**
the user already established themselves. The page is already open; we just read what's
on screen.

## What it does and does NOT do

- **Reads** the rendered award-search **results** in the active tab (miles, cabin, taxes)
  via `parseAvailability()` in `content-script.js`.
- **Signs** each contribution with HMAC-SHA256 (`background.js`, WebCrypto) using a
  shared *contribution token* the user configures.
- **POSTs** to `POST /api/flights/contribute` with the signature in the `x-signature`
  header — verified server-side by `src/flights/contribute/relay.ts`.
- **NEVER** reads or transmits credentials, cookies, tokens, or login form fields.
- **NEVER** runs until the user opts in *and* configures `relayBaseUrl` +
  `contributeSecret` in extension storage. An unconfigured install is completely inert.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest. **Placeholder** `<all_urls>` host/match — narrow to specific airline award-portal origins before publishing (least privilege). |
| `content-script.js` | Reads availability rows from the DOM. Exports `parseAvailability(documentLike)` for offline unit testing. |
| `background.js` | Signs + POSTs the payload to the relay. Inert until configured. |

## Server side

The relay is **dormant + flag-gated**: with `CONTRIBUTE_SECRET` unset the endpoint
returns `503` and writes nothing, so the running daemon/server is unaffected. See
`src/flights/contribute/relay.ts` and the proof test
`tests/frontier/contribute-relay.test.ts`.

## Status

Skeleton only. Before shipping: fill per-airline selector maps + origin/dest/date
extraction, narrow manifest host permissions, add an opt-in/config UI, and wire a
real DB writer into `registerContributeRoute(app, { writeRows })`.
