"""
Shared Chrome CDP module.

Launches a real Chrome browser via subprocess with --remote-debugging-port
and connects via Patchright's connect_over_cdp(). This bypasses Akamai's
automation detection because Chrome is launched normally (no --enable-automation
flags that p.chromium.launch() adds).

Usage:
    from chrome_cdp import create_cdp_browser
    browser, context, page, cleanup = create_cdp_browser("my-scraper")
    page.goto("https://www.aa.com/booking/find-flights")
    # ... do scraping ...
    cleanup()
"""

import subprocess
import sys
import time
import random
import os
import platform
import signal


def log(msg):
    print(f"[ChromeCDP {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr)


def find_chrome_path():
    """Find Chrome binary on macOS/Linux."""
    system = platform.system()
    if system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
    else:
        # Linux
        candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/snap/bin/chromium",
        ]

    for path in candidates:
        if os.path.exists(path):
            return path

    # Try which
    import shutil
    for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
        found = shutil.which(name)
        if found:
            return found

    raise FileNotFoundError("Chrome not found. Install Google Chrome.")


def create_cdp_browser(profile_name="default"):
    """
    Launch Chrome with --remote-debugging-port, connect via Patchright CDP.

    Returns (browser, context, page, cleanup_fn).
    Caller MUST call cleanup_fn() when done.
    """
    from patchright.sync_api import sync_playwright

    chrome_path = find_chrome_path()
    log(f"Chrome: {chrome_path}")

    user_data_dir = f"/tmp/chrome-cdp-{profile_name}"
    os.makedirs(user_data_dir, exist_ok=True)

    # Try up to 3 random ports
    chrome_proc = None
    port = None
    for attempt in range(3):
        port = random.randint(9222, 9322)
        args = [
            chrome_path,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={user_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-client-side-phishing-detection",
            "--disable-default-apps",
            "--disable-hang-monitor",
            "--disable-popup-blocking",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-service-autorun",
            "--password-store=basic",
            "--window-size=1440,900",
            "about:blank",
        ]

        try:
            chrome_proc = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid if platform.system() != "Darwin" else None,
            )
            log(f"Chrome launched (pid={chrome_proc.pid}, port={port})")
            break
        except Exception as e:
            log(f"Port {port} failed: {e}")
            chrome_proc = None

    if not chrome_proc:
        raise RuntimeError("Failed to launch Chrome after 3 attempts")

    # Wait for Chrome to start and open debugging port
    time.sleep(2.5)

    # Check Chrome is still running
    if chrome_proc.poll() is not None:
        raise RuntimeError(f"Chrome exited immediately (code={chrome_proc.returncode})")

    # Connect via Patchright CDP
    pw = sync_playwright().start()
    browser = None
    for connect_attempt in range(3):
        try:
            browser = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            log(f"Connected to Chrome CDP on port {port}")
            break
        except Exception as e:
            if connect_attempt < 2:
                log(f"CDP connect attempt {connect_attempt + 1} failed, retrying... ({e})")
                time.sleep(1.5)
            else:
                raise RuntimeError(f"Failed to connect to Chrome CDP: {e}")

    # Get default context and page
    context = browser.contexts[0] if browser.contexts else browser.new_context()
    page = context.pages[0] if context.pages else context.new_page()

    def cleanup():
        """Terminate Chrome and clean up Patchright."""
        try:
            browser.close()
        except:
            pass
        try:
            pw.stop()
        except:
            pass
        try:
            chrome_proc.terminate()
            chrome_proc.wait(timeout=5)
        except:
            try:
                chrome_proc.kill()
            except:
                pass
        log("Chrome terminated")

    return browser, context, page, cleanup
