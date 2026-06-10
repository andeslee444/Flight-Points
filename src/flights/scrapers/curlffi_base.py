#!/usr/bin/env python3
"""
Shared utilities for curl_cffi-based scrapers.

Provides session creation with Chrome 131 TLS/JA3/HTTP2 impersonation,
proxy configuration (SOCKS5 for Oracle VPS, HTTP for Bright Data),
cookie warming, and parameter validation.
"""

import os
import re
import sys
import time
import random
import string
from urllib.parse import urlparse
from curl_cffi.requests import Session

# Newest impersonation target curl_cffi 0.14 ships. Shared by all curl_cffi
# scrapers so the TLS/JA3 fingerprint stays close to the real installed Chrome
# (a stale target like chrome131 against Chrome 148+ is a detection signal).
IMPERSONATE_TARGET = "chrome142"


def log(label, msg):
    """Log to stderr with timestamp."""
    print(f"[{label} {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def validate_params(params):
    """Validate standard search params (origin, destination, date)."""
    for field in ("origin", "destination", "date"):
        if field not in params or not isinstance(params[field], str):
            raise ValueError(f"Missing or invalid field: {field}")
    if not re.match(r'^[A-Z]{3}$', params["origin"]):
        raise ValueError(f"Invalid origin airport code: {params['origin']}")
    if not re.match(r'^[A-Z]{3}$', params["destination"]):
        raise ValueError(f"Invalid destination airport code: {params['destination']}")
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', params["date"]):
        raise ValueError(f"Invalid date format: {params['date']}")


def get_proxy_config():
    """Parse PROXY_URL env into curl_cffi proxy dict.

    Supports:
      - socks5://host:port      -> {"https": "socks5h://host:port", "http": "socks5h://host:port"}
      - socks5h://host:port     -> same (already DNS-over-proxy)
      - http://user:pass@host:p -> {"https": "http://user-session-xxx:pass@host:p", ...}

    Returns (proxy_dict or None, description_string).
    """
    proxy_url = os.environ.get("PROXY_URL", "")
    if not proxy_url:
        return None, "direct"

    parsed = urlparse(proxy_url)

    if parsed.scheme in ("socks5", "socks5h", "socks4"):
        # Use socks5h:// to resolve DNS through the proxy (important for VPS)
        scheme = "socks5h" if parsed.scheme in ("socks5", "socks5h") else parsed.scheme
        proxy_str = f"{scheme}://{parsed.hostname}:{parsed.port}"
        if parsed.username:
            auth = parsed.username
            if parsed.password:
                auth += f":{parsed.password}"
            proxy_str = f"{scheme}://{auth}@{parsed.hostname}:{parsed.port}"
        proxies = {"https": proxy_str, "http": proxy_str}
        return proxies, f"SOCKS5 {parsed.hostname}:{parsed.port}"

    if parsed.scheme in ("http", "https"):
        username = parsed.username or ""
        password = parsed.password or ""
        # Bright Data sticky session: append -session-<random> if not already present
        if "brd-customer" in username and "-session-" not in username:
            session_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
            username = f"{username}-session-{session_id}"
        auth = f"{username}:{password}@" if username else ""
        proxy_str = f"http://{auth}{parsed.hostname}:{parsed.port}"
        proxies = {"https": proxy_str, "http": proxy_str}
        desc = f"HTTP proxy {parsed.hostname}:{parsed.port}"
        if "brd-customer" in username:
            desc = f"Bright Data (session)"
        return proxies, desc

    return None, f"unknown scheme: {parsed.scheme}"


def create_session(label):
    """Create a curl_cffi Session with current-Chrome impersonation and proxy.

    Returns (session, proxy_info_string).

    Pin to the newest target curl_cffi 0.14 ships (chrome142). A stale fingerprint
    (chrome131) against a real Chrome that's on 148+ is itself a detection signal —
    the TLS/JA3 version skews from the User-Agent. Bump as curl_cffi adds targets.
    """
    proxies, proxy_info = get_proxy_config()
    log(label, f"Proxy: {proxy_info}")

    session = Session(impersonate=IMPERSONATE_TARGET)
    if proxies:
        session.proxies = proxies

    return session, proxy_info


def warm_cookies(session, url, label):
    """GET a homepage URL to establish session cookies (e.g. Akamai _abck).

    Returns cookie count.
    """
    log(label, f"Warming cookies on {url}...")
    try:
        resp = session.get(url, timeout=30)
        cookie_count = len(session.cookies)
        log(label, f"Cookie warming: HTTP {resp.status_code}, {cookie_count} cookies")
        return cookie_count
    except Exception as e:
        log(label, f"Cookie warming failed: {e}")
        return 0


def create_session_with_farmed_cookies(label, domain, warmup_url, extra_actions=None):
    """Create curl_cffi Session with Akamai cookies from cookie farm.

    Uses Patchright browser to solve Akamai JS challenge, then injects
    the resulting cookies (including _abck) into a curl_cffi session.

    Args:
        label: Log label (e.g. "AA-CurlFfi")
        domain: Target domain (e.g. "aa.com")
        warmup_url: URL to navigate browser to (e.g. "https://www.aa.com/")
        extra_actions: Optional callable(page) for domain-specific browser actions

    Returns:
        (session, proxy_info, has_cookies) where has_cookies indicates
        whether cookie farming succeeded.
    """
    from cookie_farm import get_cookies, inject_cookies

    cookies = get_cookies(domain, warmup_url, extra_actions=extra_actions)
    session, proxy_info = create_session(label)

    if cookies:
        inject_cookies(session, cookies, domain)
        log(label, f"Session created with {len(cookies)} farmed cookies")
    else:
        log(label, "WARNING: No farmed cookies — falling back to plain session")

    return session, proxy_info, bool(cookies)
