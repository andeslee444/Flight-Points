# Mobile-app API impersonation — recon runbook

The captcha walls that block Aeroplan / ANA / Singapore / BA / United live in the
**web** stack (Akamai `_abck`, Gigya/reCAPTCHA, 428 JS challenge). Airline **mobile
apps** usually talk to clean JSON backends over a static app key + bearer token,
skipping that sensor entirely. Capture the contract **once**, then re-implement as
a `curl_cffi` scraper — the exact pattern that already won Cathay and JetBlue.

This step is inherently interactive (needs a rooted Android emulator + a device on
the same proxy), so it can't run headless in CI. This runbook makes it turnkey.

## One-time toolchain
1. **Rooted Android emulator**: Android Studio AVD (Google APIs image, not Play),
   rooted via `rootAVD` + Magisk. (Or a physical rooted device.)
2. **mitmproxy**: `pip install mitmproxy`; run `mitmweb`. Install its CA cert on the
   device as a **system** cert (user certs are ignored by apps).
3. **Frida**: `pip install frida-tools`; push the matching `frida-server` to the
   device. Defeat certificate pinning with
   `github.com/httptoolkit/frida-interception-and-unpinning`
   (`android-certificate-unpinning.js` + `android-proxy-config.js`).
4. Point the device's proxy at mitmproxy (`config.json` in the unpinning scripts).

## Capture
1. Launch the airline app through Frida:
   `frida -U -l android-certificate-unpinning.js -l android-proxy-config.js -f <app.package>`
2. Log in once (the bearer token is what you're after) and run one award search for
   a route known to have space (e.g. United JFK→NRT business, ~45 days out).
3. In mitmweb, find the award-search request. Record:
   - URL + method, the **static app API key** header (ocp-apim / x-app-key / etc.),
     the auth/bearer flow, request body schema, and the response JSON shape.

## Re-implement
1. Copy `src/flights/scrapers/_mobile-api-template.py` → `<airline>-mobile.py`.
2. Fill in the endpoint, headers, body, and a parser → `FlightResult[]`
   (see `src/flights/types.ts`). Use `curlffi_base.py` (`IMPERSONATE_TARGET`)
   so it routes through the proxy and the shared session.
3. Add a `.ts` wrapper via `runCurlFfiSearch`, register in `SCRAPER_REGISTRY`.
4. Add a fixture parser test (capture one real response JSON → `tests/fixtures/`).
5. Token handling: cache the bearer (the session-pool / a credential vault) and
   refresh only on 401 — do not log in per run.

## Fragility / fallback
- App-key rotation or **Play Integrity / App Attest** attestation breaks replay for
  that one carrier → fall back to its Chrome-CDP tier (already in the registry).
- This is recon-only tooling; nothing here is a runtime dependency.

Spawned recon task for United is tracked separately; ANA/SQ/BA follow the same steps.
