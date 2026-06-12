#!/usr/bin/env python3
"""
Proof test for src/flights/scrapers/captcha_solver.py (the Python sibling of
captcha-solver.ts that the Aeroplan/United Gigya login uses inline).

Runs fully OFFLINE via an injected fake http. Proves the same outcomes as the TS
proof: dormant-without-key makes ZERO network calls, a key + ready result yields
the token, a processing→ready sequence polls then succeeds, and any transport
error returns None without raising.

  python3 tests/test-captcha-solver-py.py
"""

import os
import sys

# Import the solver from the scrapers dir.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "flights", "scrapers"))
import captcha_solver  # noqa: E402

# Make the processing→ready case instant (no real 2s sleep between polls).
captcha_solver.POLL_INTERVAL_S = 0

TASK = {"type": "recaptcha_v2", "websiteUrl": "https://example.com", "websiteKey": "6Lc_SITEKEY"}

failures = 0


def check(cond, msg):
    global failures
    if not cond:
        failures += 1
        print(f"FAIL {msg}")
    else:
        print(f"PASS {msg}")


def make_http(script):
    """A fake http(url, body) that returns scripted responses by endpoint, and
    records every call so we can assert dormancy made none."""
    calls = []

    def http(url, body):
        calls.append((url, body))
        if url.endswith("/createTask"):
            return script["createTask"]
        if url.endswith("/getTaskResult"):
            # Pop the next scripted poll result.
            return script["getTaskResult"].pop(0)
        raise AssertionError(f"unexpected url {url}")

    http.calls = calls
    return http


# (1) Dormant without key → None, and the fake http is NEVER called.
os.environ.pop("CAPSOLVER_API_KEY", None)
http = make_http({"createTask": {}, "getTaskResult": []})
token = captcha_solver.solve_captcha(TASK, http=http)
check(token is None, "dormant without key returns None")
check(len(http.calls) == 0, "dormant makes zero http calls")

# (2) Key + createTask then ready → token threads back.
os.environ["CAPSOLVER_API_KEY"] = "test-key"
http = make_http({
    "createTask": {"errorId": 0, "taskId": "t-123"},
    "getTaskResult": [{"errorId": 0, "status": "ready", "solution": {"gRecaptchaResponse": "TOKEN123"}}],
})
token = captcha_solver.solve_captcha(TASK, http=http)
check(token == "TOKEN123", "key + ready → returns TOKEN123")

# (3) processing → ready: poller waits then succeeds.
http = make_http({
    "createTask": {"errorId": 0, "taskId": "t-456"},
    "getTaskResult": [
        {"errorId": 0, "status": "processing"},
        {"errorId": 0, "status": "ready", "solution": {"gRecaptchaResponse": "TOKEN456"}},
    ],
})
token = captcha_solver.solve_captcha(TASK, http=http)
check(token == "TOKEN456", "processing→ready polls then succeeds")

# (4) Transport error → None, never raises.
def throwing_http(url, body):
    raise RuntimeError("simulated network failure")

raised = False
try:
    token = captcha_solver.solve_captcha(TASK, http=throwing_http)
except Exception:
    raised = True
check(not raised, "throwing http does not raise")
check(token is None, "throwing http returns None")

# (5) createTask error → None.
http = make_http({"createTask": {"errorId": 1, "errorDescription": "bad key"}, "getTaskResult": []})
token = captcha_solver.solve_captcha(TASK, http=http)
check(token is None, "createTask errorId → None")

os.environ.pop("CAPSOLVER_API_KEY", None)

print(
    "OUTCOME: dormant w/o key returns None with 0 http calls; "
    'key+ready → "TOKEN123" threads into login; processing→ready succeeds; '
    "throwing http → None (no raise); createTask error → None"
)
print(f"({'all passed' if failures == 0 else str(failures) + ' FAILED'})")
sys.exit(1 if failures else 0)
