#!/usr/bin/env python3
"""
Cookie Farm — Patchright browser cookie farming for Akamai bypass.

Farms _abck cookies using a real browser (Patchright/Chrome), then transfers
them to curl_cffi sessions for fast API calls. The browser solves Akamai's
JS challenge (~15s), but cookies are reused for many fast (~3s) curl_cffi calls.

Public API:
  get_cookies(domain, warmup_url, ttl_seconds=600, extra_actions=None)
  inject_cookies(session, cookies, domain)
  invalidate_cache(domain)

Disk cache at $DATA_DIR/cookie-cache/{domain}.json with configurable TTL.
Thread-safe with per-domain locking.
"""

import json
import os
import sys
import time
import random
import threading
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curlffi_base import log as _log

LABEL = "CookieFarm"

def log(msg):
    _log(LABEL, msg)


# Per-domain locks to prevent concurrent farming
_domain_locks = {}
_locks_lock = threading.Lock()

def _get_domain_lock(domain):
    with _locks_lock:
        if domain not in _domain_locks:
            _domain_locks[domain] = threading.Lock()
        return _domain_locks[domain]


def _cache_dir():
    data_dir = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    cache_dir = os.path.join(data_dir, "cookie-cache")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def _cache_path(domain):
    safe_domain = domain.replace(".", "_").replace("/", "_")
    return os.path.join(_cache_dir(), f"{safe_domain}.json")


def _load_cached(domain, ttl_seconds):
    """Load cookies from disk cache if still valid."""
    path = _cache_path(domain)
    if not os.path.exists(path):
        return None

    try:
        with open(path, "r") as f:
            data = json.load(f)

        cached_at = data.get("cached_at", 0)
        age = time.time() - cached_at

        if age > ttl_seconds:
            log(f"Cache expired for {domain} (age={age:.0f}s > ttl={ttl_seconds}s)")
            return None

        cookies = data.get("cookies", {})
        raw_cookies = data.get("raw_cookies", [])
        log(f"Cache hit for {domain}: {len(cookies)} cookies (age={age:.0f}s)")
        return {"cookies": cookies, "raw_cookies": raw_cookies}

    except (json.JSONDecodeError, KeyError, OSError) as e:
        log(f"Cache read error for {domain}: {e}")
        return None


def _save_cache(domain, cookies, raw_cookies):
    """Save cookies to disk cache."""
    path = _cache_path(domain)
    data = {
        "domain": domain,
        "cached_at": time.time(),
        "cookies": cookies,
        "raw_cookies": raw_cookies,
    }
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        log(f"Cached {len(cookies)} cookies for {domain}")
    except OSError as e:
        log(f"Cache write error for {domain}: {e}")


def _farm_cookies(domain, warmup_url, extra_actions=None):
    """Farm cookies from a site using Patchright browser.

    Args:
        domain: The target domain (e.g., "aa.com")
        warmup_url: URL to navigate to first (e.g., "https://www.aa.com/")
        extra_actions: Optional callable(page) for domain-specific actions
                       (scroll to specific areas, navigate to sub-pages, etc.)

    Returns:
        (cookies_dict, raw_cookies_list) or (None, None) on failure.
    """
    from patchright.sync_api import sync_playwright

    proxy_url = os.environ.get("PROXY_URL", "")
    proxy_cfg = None
    if proxy_url:
        parsed = urlparse(proxy_url)
        if parsed.scheme in ("socks5", "socks4"):
            server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
            proxy_cfg = {"server": server}
            if parsed.username:
                proxy_cfg["username"] = parsed.username
            if parsed.password:
                proxy_cfg["password"] = parsed.password
            log(f"Proxy: {parsed.hostname}:{parsed.port}")

    cookies_dict = {}
    raw_cookies = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            channel="chrome",
            args=["--no-first-run"],
            **({"proxy": proxy_cfg} if proxy_cfg else {}),
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            timezone_id="America/New_York",
            locale="en-US",
            ignore_https_errors=True,
        )
        page = context.new_page()

        try:
            # Navigate to warmup URL
            log(f"Farming cookies for {domain}...")
            start = time.time()
            page.goto(warmup_url, timeout=30000, wait_until="domcontentloaded")

            # Wait for Akamai JS to execute
            wait_time = random.uniform(5, 8)
            time.sleep(wait_time)

            # Basic human-like actions
            page.mouse.move(random.randint(100, 800), random.randint(100, 400))
            time.sleep(random.uniform(0.3, 0.8))
            page.evaluate("window.scrollBy(0, Math.random() * 400 + 100)")
            time.sleep(random.uniform(0.5, 1.0))
            page.mouse.move(random.randint(200, 900), random.randint(200, 500))
            time.sleep(random.uniform(0.3, 0.6))

            # Try to dismiss cookie banner
            try:
                cookie_btn = page.query_selector(
                    'button:has-text("Accept"), button:has-text("agree"), '
                    '#onetrust-accept-btn-handler, button[id*="accept"]'
                )
                if cookie_btn and cookie_btn.is_visible():
                    cookie_btn.click()
                    time.sleep(random.uniform(0.5, 1.0))
            except:
                pass

            # Run extra domain-specific actions
            if extra_actions:
                try:
                    extra_actions(page)
                except Exception as e:
                    log(f"Extra actions error (non-fatal): {e}")

            elapsed = time.time() - start
            log(f"Browser session: {elapsed:.1f}s")

            # Extract cookies
            raw_cookies = context.cookies()
            for cookie in raw_cookies:
                cookies_dict[cookie["name"]] = cookie["value"]

            # Log key cookie info
            abck = cookies_dict.get("_abck", "")
            if abck:
                solved = "SOLVED" if len(abck) > 200 else "UNSOLVED"
                log(f"_abck: {len(abck)} chars ({solved})")
            else:
                log("WARNING: No _abck cookie")

            log(f"Total: {len(raw_cookies)} cookies in {elapsed:.1f}s")

        except Exception as e:
            log(f"Farming error: {e}")
            import traceback
            traceback.print_exc(file=sys.stderr)
            cookies_dict = None
            raw_cookies = None
        finally:
            context.close()
            browser.close()

    return cookies_dict, raw_cookies


def get_cookies(domain, warmup_url, ttl_seconds=600, extra_actions=None):
    """Get cookies for a domain, using disk cache or farming fresh ones.

    Args:
        domain: Target domain (e.g., "aa.com")
        warmup_url: URL to navigate to for farming
        ttl_seconds: Cache TTL in seconds (default 10 minutes)
        extra_actions: Optional callable(page) for domain-specific browser actions

    Returns:
        dict of {cookie_name: cookie_value}, or empty dict on failure.
    """
    lock = _get_domain_lock(domain)

    with lock:
        # Check cache first
        cached = _load_cached(domain, ttl_seconds)
        if cached:
            return cached["cookies"]

        # Farm fresh cookies
        log(f"Farming fresh cookies for {domain}...")
        cookies_dict, raw_cookies = _farm_cookies(domain, warmup_url, extra_actions)

        if cookies_dict is None:
            log(f"Cookie farming failed for {domain}")
            return {}

        if not cookies_dict.get("_abck"):
            log(f"No _abck cookie obtained for {domain} — farming may have failed")

        # Save to cache
        # Convert raw_cookies to serializable format
        serializable_raw = []
        for c in (raw_cookies or []):
            serializable_raw.append({
                "name": c["name"],
                "value": c["value"],
                "domain": c.get("domain", ""),
                "path": c.get("path", "/"),
                "secure": c.get("secure", False),
                "httpOnly": c.get("httpOnly", False),
            })
        _save_cache(domain, cookies_dict, serializable_raw)

        return cookies_dict


def inject_cookies(session, cookies, domain):
    """Inject a dict of cookies into a curl_cffi Session.

    Args:
        session: curl_cffi Session object
        cookies: dict of {name: value}
        domain: Domain to set cookies for
    """
    clean_domain = domain.lstrip(".")
    count = 0
    for name, value in cookies.items():
        session.cookies.set(name, value, domain=clean_domain, path="/")
        count += 1
    log(f"Injected {count} cookies for {clean_domain}")


def inject_raw_cookies(session, raw_cookies):
    """Inject raw cookie list (with domain/path) into a curl_cffi Session.

    Args:
        session: curl_cffi Session object
        raw_cookies: list of cookie dicts with name, value, domain, path
    """
    count = 0
    for cookie in raw_cookies:
        name = cookie["name"]
        value = cookie["value"]
        domain = cookie.get("domain", "")
        path = cookie.get("path", "/")
        if domain.startswith("."):
            domain = domain[1:]
        session.cookies.set(name, value, domain=domain, path=path)
        count += 1
    log(f"Injected {count} raw cookies")


def invalidate_cache(domain):
    """Delete cached cookies for a domain (call when scraper gets 429)."""
    path = _cache_path(domain)
    try:
        if os.path.exists(path):
            os.remove(path)
            log(f"Invalidated cache for {domain}")
    except OSError as e:
        log(f"Cache invalidation error for {domain}: {e}")


def get_cached_raw_cookies(domain, ttl_seconds=600):
    """Get raw cookies (with domain/path) from cache.

    Returns list of cookie dicts, or empty list if no cache.
    """
    cached = _load_cached(domain, ttl_seconds)
    if cached:
        return cached.get("raw_cookies", [])
    return []
