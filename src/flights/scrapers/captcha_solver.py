#!/usr/bin/env python3
"""
CapSolver / 2captcha-compatible captcha solver — Python sibling of
src/flights/net/captcha-solver.ts.

WHY a Python copy: the Aeroplan/United login is a Gigya reCAPTCHA flow that runs
*inside* the Python CDP scraper (united-aeroplan-cdp.py). The captcha appears
mid-flow and the sitekey is only known after the login iframe loads, so the
solve must happen inline in Python — the TS solver can't reach into that moment.
This mirrors the TS contract exactly (createTask -> poll getTaskResult, dormant
without the key, never raises) so behavior stays consistent across languages.

DORMANT-WITHOUT-KEY: solve_captcha() returns None (logging to stderr) when
CAPSOLVER_API_KEY is unset, makes no network call, and NEVER raises — callers
keep today's "captcha blocked" path. The HTTP call is injectable (`http=`) so the
proof test (tests/test-captcha-solver-py.py) runs fully offline with a fake.

NOTE: CapSolver is a PAID third-party service. This module only does anything
when CAPSOLVER_API_KEY is set; setting it implies accepting CapSolver's cost/ToS.
"""

import json
import os
import sys
import time
import urllib.request

# CapSolver REST API base. createTask + getTaskResult are the standard endpoints.
CAPSOLVER_BASE = "https://api.capsolver.com"

# Bound the poll loop by a plain attempt counter (no wall-clock arithmetic), one
# getTaskResult call per attempt with a short sleep between.
MAX_POLL_ATTEMPTS = 30
POLL_INTERVAL_S = 2.0


def _log(msg):
    print(f"[captcha-solver {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)


def is_captcha_solver_configured():
    """True iff CAPSOLVER_API_KEY is a non-empty string (read at call time)."""
    key = os.environ.get("CAPSOLVER_API_KEY", "")
    return bool(key and key.strip())


def _default_http(url, body):
    """POST JSON to `url`, return parsed JSON. Used unless an http impl is injected."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# Map our task types to CapSolver's *ProxyLess task type names.
_TASK_TYPE = {
    "recaptcha_v2": "ReCaptchaV2TaskProxyLess",
    "recaptcha_v3": "ReCaptchaV3TaskProxyLess",
    "turnstile": "AntiTurnstileTaskProxyLess",
}


def solve_captcha(task, http=None):
    """
    Solve a captcha and return the token string, or None on any failure/dormancy.

    task: dict with keys:
      type        - 'recaptcha_v2' | 'recaptcha_v3' | 'turnstile'
      websiteUrl  - the page URL the captcha is on
      websiteKey  - the reCAPTCHA/Turnstile site key
      action      - (optional) reCAPTCHA v3 action

    http: optional callable(url, body) -> dict, injected for offline tests.
          Defaults to a real urllib POST.

    Never raises: dormancy, createTask error, missing taskId, status 'failed',
    missing token, transport error, and poll-budget exhaustion all return None.
    """
    if not is_captcha_solver_configured():
        _log("CAPSOLVER_API_KEY not set — captcha solver dormant, returning None.")
        return None

    api_key = os.environ["CAPSOLVER_API_KEY"].strip()
    do_http = http or _default_http

    task_type = _TASK_TYPE.get(task.get("type"))
    if not task_type:
        _log(f"unsupported captcha task type: {task.get('type')!r}")
        return None

    cap_task = {
        "type": task_type,
        "websiteURL": task.get("websiteUrl"),
        "websiteKey": task.get("websiteKey"),
    }
    if task.get("type") == "recaptcha_v3" and task.get("action"):
        cap_task["pageAction"] = task["action"]

    # 1) createTask
    try:
        created = do_http(
            f"{CAPSOLVER_BASE}/createTask",
            {"clientKey": api_key, "task": cap_task},
        )
    except Exception as e:  # noqa: BLE001 - never propagate transport errors
        _log(f"createTask failed: {e}")
        return None

    if not isinstance(created, dict) or created.get("errorId"):
        _log(f"createTask error: {created.get('errorDescription') if isinstance(created, dict) else created}")
        return None
    task_id = created.get("taskId")
    if not task_id:
        _log("createTask returned no taskId")
        return None

    # 2) poll getTaskResult, bounded by a plain counter
    for attempt in range(1, MAX_POLL_ATTEMPTS + 1):
        try:
            result = do_http(
                f"{CAPSOLVER_BASE}/getTaskResult",
                {"clientKey": api_key, "taskId": task_id},
            )
        except Exception as e:  # noqa: BLE001
            _log(f"getTaskResult failed (attempt {attempt}): {e}")
            return None

        if not isinstance(result, dict) or result.get("errorId"):
            _log(f"getTaskResult error: {result.get('errorDescription') if isinstance(result, dict) else result}")
            return None

        status = result.get("status")
        if status == "ready":
            solution = result.get("solution") or {}
            token = solution.get("gRecaptchaResponse") or solution.get("token")
            if token:
                _log(f"solved {task.get('type')} after {attempt} poll(s).")
                return token
            _log("status ready but no token in solution")
            return None
        if status == "failed":
            _log("solver reported status 'failed'")
            return None
        # status == 'processing' (or unknown): wait and poll again
        time.sleep(POLL_INTERVAL_S)

    _log(f"poll budget exhausted after {MAX_POLL_ATTEMPTS} attempts")
    return None
