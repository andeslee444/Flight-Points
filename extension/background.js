/**
 * Flight-Points Contributor — background service worker (MV3).
 *
 * Receives harvested award rows from the content script, HMAC-SHA256 signs the
 * exact serialized body with the user's shared CONTRIBUTE secret, and POSTs it to
 * the Flight-Points relay (`POST /api/flights/contribute`) with the signature in
 * the `x-signature` header — the same contract verified server-side by
 * src/flights/contribute/relay.ts.
 *
 * SKELETON: the relay URL and the shared secret are placeholders sourced from
 * chrome.storage. Nothing is sent until the user has opted in and configured both
 * — so an unconfigured install is inert. The secret is a contribution token only;
 * it is NOT an airline credential.
 */

const RELAY_PATH = '/api/flights/contribute';
const SIGNATURE_HEADER = 'x-signature';

/** Read opt-in config { relayBaseUrl, contributeSecret } from extension storage. */
async function getConfig() {
  try {
    const cfg = await chrome.storage.local.get(['relayBaseUrl', 'contributeSecret']);
    return {
      relayBaseUrl: cfg.relayBaseUrl || '',
      contributeSecret: cfg.contributeSecret || '',
    };
  } catch {
    return { relayBaseUrl: '', contributeSecret: '' };
  }
}

/** HMAC-SHA256(rawBody, secret) → hex, using WebCrypto (no deps). */
async function signPayload(rawBody, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Sign and POST one contribution payload. No-op (inert) until configured. */
async function sendContribution(payload) {
  const { relayBaseUrl, contributeSecret } = await getConfig();
  if (!relayBaseUrl || !contributeSecret) {
    // Not opted in / not configured — stay inert.
    return;
  }
  // Sign the EXACT bytes we send; the relay re-serializes req.body the same way.
  const rawBody = JSON.stringify(payload);
  const signature = await signPayload(rawBody, contributeSecret);

  try {
    await fetch(relayBaseUrl.replace(/\/$/, '') + RELAY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: signature },
      body: rawBody,
    });
  } catch (e) {
    console.error('[fp-contributor] relay POST failed:', e);
  }
}

// Listen for harvested payloads from the content script.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'fp-contribute' && msg.payload) {
      sendContribution(msg.payload);
    }
    // No async response needed.
    return false;
  });
}
