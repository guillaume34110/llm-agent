"""Stealth browser for human-like web navigation.

Strategy
--------
- Driver preference: patchright > rebrowser-playwright > playwright (auto-detect at import).
- Channel: real Chrome > Edge > bundled Chromium (auto-fallback).
- Display: headed if DISPLAY available (Linux Xvfb welcome), else `headless="new"` Chrome.
- Single persistent profile (cookies/localStorage stick across runs).
- Per-domain BrowserContext (cookies isolated, parallelism friendly).
- Human-like mouse (Bezier paths + hover dwell), human-like typing (bigram delays + occasional typo+backspace), human-like scroll (multi-step easing).
- Block detection: Cloudflare/captcha/403 patterns → returns BLOCKED:<reason>.
- Network filtering: drops ads/trackers/analytics → faster page loads.
- Trafilatura post-extraction → clean main content (with body.innerText fallback).
- Optional proxy via MONKEY_PROXY env var (user:pass@host:port).
"""
from __future__ import annotations
import asyncio
import base64
import datetime
import json as _json
import math
import os
import random
import re
from pathlib import Path

# Vision model id for auto-captcha solver. Set by agent.chat_stream when a
# vision-capable model is selected. None disables auto-solve.
_VISION_MODEL: str | None = None


def set_vision_model(model_id: str | None) -> None:
    """Register the currently selected vision-capable model id (or None)."""
    global _VISION_MODEL
    _VISION_MODEL = (model_id or None)


def get_vision_model() -> str | None:
    return _VISION_MODEL

# --- Driver selection: patchright > rebrowser > playwright ---------------
_DRIVER_NAME = "playwright"
try:
    from patchright.async_api import async_playwright, Page, Browser, BrowserContext  # type: ignore
    _DRIVER_NAME = "patchright"
except ImportError:
    try:
        from rebrowser_playwright.async_api import async_playwright, Page, Browser, BrowserContext  # type: ignore
        _DRIVER_NAME = "rebrowser"
    except ImportError:
        from playwright.async_api import async_playwright, Page, Browser, BrowserContext  # type: ignore

# --- Paths ---------------------------------------------------------------
_BROWSERS_PATH = Path.home() / ".monkey" / "browsers"
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(_BROWSERS_PATH))

PROFILE_DIR = Path.home() / ".monkey" / "browser_profile"
SCREENSHOT_DIR = Path.home() / ".monkey" / "screenshots"

# --- Detection / blocking patterns --------------------------------------
_BLOCK_PATTERNS = re.compile(
    r"(just a moment|checking your browser|cloudflare|"
    r"captcha|are you (a )?human|access denied|forbidden|"
    r"unusual traffic|verify you are a human|"
    r"please enable javascript and cookies|"
    r"this site can.t be reached)",
    re.IGNORECASE,
)

# --- Network filter (ads/trackers) --------------------------------------
_BLOCK_RESOURCES = re.compile(
    r"(googletagmanager|google-analytics|googleadservices|googlesyndication|"
    r"doubleclick|facebook\.com/tr|fbevents|hotjar|segment\.io|"
    r"mixpanel|amplitude|optimizely|adservice|adsystem|"
    r"adnxs|criteo|taboola|outbrain|pubmatic|rubiconproject)",
    re.IGNORECASE,
)
_BLOCK_TYPES = {"image", "media", "font"}  # toggled per-context for speed mode

# --- Stealth init JS (light, complementary to driver patches) ----------
_STEALTH_INIT_JS = r"""
(() => {
  if (window.__monkey_stealth_applied) return;
  window.__monkey_stealth_applied = true;
  try {
    // navigator.* core — delete webdriver from prototype (Chrome's real shape has no own prop)
    try { delete Object.getPrototypeOf(navigator).webdriver; } catch (e) {}
    try { delete navigator.webdriver; } catch (e) {}
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch (e) {}
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    Object.defineProperty(navigator, 'doNotTrack', { get: () => null });
    // plugins / mimeTypes (non-empty, classic Chrome PDF set)
    try {
      const fakePlugin = (name, filename, desc) => ({ name, filename, description: desc, length: 1, 0: { type: 'application/pdf' } });
      const plugins = [
        fakePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
      ];
      Object.defineProperty(navigator, 'plugins', { get: () => plugins });
      Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf', suffixes: 'pdf', description: '' }] });
    } catch (e) {}
    // userAgentData (Client Hints) consistency — version must match UA
    try {
      if (navigator.userAgentData) {
        const uaMatch = (navigator.userAgent || '').match(/Chrome\/(\d+)/);
        const ver = uaMatch ? uaMatch[1] : '135';
        const brands = [
          { brand: 'Not_A Brand', version: '8' },
          { brand: 'Chromium', version: ver },
          { brand: 'Google Chrome', version: ver },
        ];
        Object.defineProperty(navigator.userAgentData, 'brands', { get: () => brands });
        Object.defineProperty(navigator.userAgentData, 'mobile', { get: () => false });
        Object.defineProperty(navigator.userAgentData, 'platform', { get: () => 'macOS' });
      }
    } catch (e) {}
    // window.chrome shim
    if (!window.chrome) window.chrome = {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.app = window.chrome.app || { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    window.chrome.csi = window.chrome.csi || function(){};
    window.chrome.loadTimes = window.chrome.loadTimes || function(){};
    // permissions
    const _q = window.navigator.permissions && window.navigator.permissions.query;
    if (_q) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : _q(p);
    }
    // WebGL vendor/renderer (Apple Silicon plausible)
    try {
      const patchGL = (ctx) => {
        if (!ctx || !ctx.prototype) return;
        const orig = ctx.prototype.getParameter;
        ctx.prototype.getParameter = function(p) {
          if (p === 37445) return 'Apple Inc.';
          if (p === 37446) return 'Apple M1';
          if (p === 7937) return 'WebKit WebGL';
          return orig.call(this, p);
        };
      };
      patchGL(WebGLRenderingContext);
      if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext);
    } catch (e) {}
    // Canvas fingerprint noise — sparse random jitter (uniform XOR is detectable)
    try {
      const seed = Math.floor(Math.random() * 1e9);
      let rng = seed;
      const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const w = this.width, h = this.height;
          if (w && h && w * h < 4_000_000) {
            try {
              const img = ctx.getImageData(0, 0, w, h);
              // Touch ~0.1% of pixels with ±1 RGB jitter — invisible, breaks hash stability
              const n = Math.max(1, Math.floor((w * h) * 0.001));
              for (let k = 0; k < n; k++) {
                const i = (Math.floor(rand() * w * h)) * 4;
                img.data[i]     = Math.max(0, Math.min(255, img.data[i]     + (rand() < 0.5 ? -1 : 1)));
                img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + (rand() < 0.5 ? -1 : 1)));
                img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + (rand() < 0.5 ? -1 : 1)));
              }
              ctx.putImageData(img, 0, 0);
            } catch (e) {}
          }
        }
        return origToDataURL.apply(this, args);
      };
    } catch (e) {}
    // AudioContext fingerprint noise — tiny gain perturbation on rendered buffers
    try {
      const audioCtxs = [window.AudioContext, window.OfflineAudioContext, window.webkitAudioContext];
      for (const C of audioCtxs) {
        if (!C || !C.prototype) continue;
        const origGetChannel = (C.prototype.getChannelData ||
                                (window.AudioBuffer && window.AudioBuffer.prototype.getChannelData));
        if (!origGetChannel) continue;
      }
      if (window.AudioBuffer && window.AudioBuffer.prototype) {
        const orig = window.AudioBuffer.prototype.getChannelData;
        window.AudioBuffer.prototype.getChannelData = function(...args) {
          const data = orig.apply(this, args);
          // Perturb 0.001% of samples by 1e-7 — inaudible, breaks AudioContext hash
          if (data && data.length) {
            const n = Math.max(1, Math.floor(data.length * 0.00001));
            for (let k = 0; k < n; k++) {
              const i = Math.floor(Math.random() * data.length);
              data[i] = data[i] + (Math.random() - 0.5) * 1e-7;
            }
          }
          return data;
        };
      }
    } catch (e) {}
    // screen dimensions consistency
    try {
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
    } catch (e) {}
    // connection (4g, plausible)
    try {
      if (!navigator.connection) {
        Object.defineProperty(navigator, 'connection', {
          get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
        });
      }
    } catch (e) {}
    // iframe contentWindow leakage of webdriver
    try {
      const origDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (origDescriptor && origDescriptor.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get() {
            const w = origDescriptor.get.call(this);
            try { Object.defineProperty(w.navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
            return w;
          },
        });
      }
    } catch (e) {}
  } catch (e) {}
})();
"""

# --- Noise stripping (token-eco, no hard truncate) ----------------------
_NOISE_TAGS = ("script", "style", "noscript", "svg", "iframe", "link", "meta",
               "template", "head", "nav", "footer", "aside", "form")
_NOISE_SELECTORS = (
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]', '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '[aria-label*="advertis" i]', '[aria-label*="cookie" i]', '[aria-label*="newsletter" i]',
    '[class*="cookie" i]', '[class*="banner" i]', '[id*="gdpr" i]', '[id*="cookie" i]',
    '[class*="newsletter" i]', '[class*="popup" i]', '[class*="modal" i]', '[class*="overlay" i]',
    '[class*="ad-" i]', '[class*="-ad" i]', '[id*="ads-" i]', '[class*="advert" i]', '[class*="promo" i]',
    '[class*="sidebar" i]', '[class*="related" i]', '[class*="share-" i]', '[class*="social-" i]',
    '[class*="comment" i]', '[class*="breadcrumb" i]', '[class*="subscribe" i]',
)


def _strip_noise_html(html: str) -> str:
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return html
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return html
    for tag in soup(list(_NOISE_TAGS)):
        tag.decompose()
    for sel in _NOISE_SELECTORS:
        try:
            for el in soup.select(sel):
                el.decompose()
        except Exception:
            pass
    # Drop attributes that bloat without informational value when serialized
    for el in soup.find_all(True):
        for attr in ("style", "onclick", "onload", "onerror", "data-testid",
                     "data-tracking", "data-analytics", "data-gtm"):
            if attr in el.attrs:
                del el.attrs[attr]
        # Drop class/id if extremely long (autogenerated hashes)
        for attr in ("class", "id"):
            v = el.attrs.get(attr)
            if isinstance(v, list) and sum(len(c) for c in v) > 200:
                del el.attrs[attr]
            elif isinstance(v, str) and len(v) > 200:
                del el.attrs[attr]
    return str(soup)


def _strip_noise_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    out = []
    prev = None
    for line in text.split("\n"):
        s = line.strip()
        if s and s == prev:
            continue
        out.append(line)
        prev = s
    return "\n".join(out).strip()


def _text_from_cleaned_html(html: str) -> str:
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        return _strip_noise_text(soup.get_text(separator="\n"))
    except Exception:
        return ""


# --- Human-like helpers --------------------------------------------------
def _bezier_points(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


# --- StealthBrowser ------------------------------------------------------
class StealthBrowser:
    def __init__(self):
        self._playwright = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._mouse_pos = (random.randint(50, 400), random.randint(50, 400))
        self._lock = asyncio.Lock()

    @property
    def driver_name(self) -> str:
        return _DRIVER_NAME

    # ----- Launch / install --------------------------------------------
    def _install_browser_if_needed(self):
        import subprocess, sys
        found = list(_BROWSERS_PATH.glob("chromium*")) + list(_BROWSERS_PATH.glob("chrome-*"))
        if found:
            return
        # Try in order: patchright (handles its own binary), rebrowser, playwright
        for mod in ("patchright", "rebrowser_playwright", "playwright"):
            try:
                subprocess.run(
                    [sys.executable, "-m", mod, "install", "chromium"],
                    env={**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(_BROWSERS_PATH)},
                    timeout=180,
                    check=True,
                )
                return
            except Exception:
                continue
        raise RuntimeError("Impossible d'installer chromium (patchright/rebrowser/playwright)")

    def _build_launch_kwargs(self) -> dict:
        # User-Agent: real Chrome, recent stable. Slight randomization avoids cache fingerprints.
        ua_versions = ["135.0.0.0", "134.0.0.0", "133.0.0.0"]
        ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{random.choice(ua_versions)} Safari/537.36"
        )
        args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
            "--disable-site-isolation-trials",
            "--no-default-browser-check",
            "--no-first-run",
            "--password-store=basic",
            "--use-mock-keychain",
            "--disable-dev-shm-usage",
            "--no-sandbox",
        ]
        # Headed if a display is available (macOS always has one ; Linux needs DISPLAY)
        has_display = (
            os.uname().sysname == "Darwin"
            or os.environ.get("DISPLAY")
            or os.environ.get("WAYLAND_DISPLAY")
        )
        force_headless = os.environ.get("MONKEY_BROWSER_HEADLESS") == "1"
        force_headed = os.environ.get("MONKEY_BROWSER_HEADED") == "1"
        if force_headed:
            headless = False
        elif force_headless or not has_display:
            # Chromium "new" headless is much harder to detect than legacy headless
            headless = "new"
        else:
            headless = False
        kwargs = dict(
            headless=headless,
            args=args,
            user_agent=ua,
            viewport={"width": 1920, "height": 1080},
            locale="fr-FR",
            timezone_id="Europe/Paris",
            ignore_https_errors=True,
            color_scheme="light",
            device_scale_factor=2,
        )
        # Optional proxy via env: MONKEY_PROXY=user:pass@host:port  or http://host:port
        proxy_env = os.environ.get("MONKEY_PROXY") or os.environ.get("HTTPS_PROXY")
        if proxy_env:
            url = proxy_env if proxy_env.startswith("http") else f"http://{proxy_env}"
            try:
                from urllib.parse import urlparse
                u = urlparse(url)
                proxy_cfg: dict = {"server": f"{u.scheme}://{u.hostname}:{u.port}"}
                if u.username:
                    proxy_cfg["username"] = u.username
                if u.password:
                    proxy_cfg["password"] = u.password
                kwargs["proxy"] = proxy_cfg
            except Exception:
                pass
        return kwargs

    def _clean_stale_profile_lock(self) -> None:
        """Remove SingletonLock/Socket/Cookie if the owner chromium is dead or
        is an orphaned chromium previously spawned by us against PROFILE_DIR.

        Chromium refuses to start when SingletonLock is present, even if the
        owner crashed. On macOS the target looks like `<host>-<pid>`.
        """
        import signal as _sig
        import subprocess as _sp
        lock = PROFILE_DIR / "SingletonLock"
        if not lock.is_symlink() and not lock.exists():
            return
        target = ""
        try:
            target = os.readlink(lock)
        except OSError:
            try:
                lock.unlink(missing_ok=True)
            except Exception:
                pass
        pid: int | None = None
        m = re.search(r"-(\d+)$", target)
        if m:
            try:
                pid = int(m.group(1))
            except ValueError:
                pid = None
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except OSError:
                alive = False
        if alive and pid:
            # Only kill if it's a chromium tied to our profile dir
            try:
                out = _sp.run(["ps", "-p", str(pid), "-o", "command="],
                              capture_output=True, text=True, timeout=2).stdout
            except Exception:
                out = ""
            if str(PROFILE_DIR) in out and ("Chrome" in out or "chromium" in out.lower() or "Chromium" in out):
                # Orphan from previous monkey run — kill tree
                try:
                    pgrep = _sp.run(["pgrep", "-af", str(PROFILE_DIR)],
                                    capture_output=True, text=True, timeout=2).stdout
                    pids = [int(line.split()[0]) for line in pgrep.splitlines() if line.split()]
                except Exception:
                    pids = [pid]
                for p in pids:
                    try:
                        os.kill(p, _sig.SIGTERM)
                    except OSError:
                        pass
                # Brief settle, then SIGKILL stragglers
                import time as _t
                _t.sleep(0.4)
                for p in pids:
                    try:
                        os.kill(p, 0)
                        os.kill(p, _sig.SIGKILL)
                    except OSError:
                        pass
            else:
                # A different live process owns the lock — don't touch
                return
        # Unlink stale lock files
        for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
            p = PROFILE_DIR / name
            try:
                if p.is_symlink() or p.exists():
                    p.unlink()
            except Exception:
                pass

    async def _try_launch(self, kwargs: dict) -> BrowserContext:
        """Try real Chrome > Edge > bundled chromium."""
        self._playwright = await async_playwright().start()
        last_err: Exception | None = None
        for channel in ("chrome", "msedge", None):
            attempt = dict(kwargs)
            if channel:
                attempt["channel"] = channel
            try:
                ctx = await self._playwright.chromium.launch_persistent_context(
                    str(PROFILE_DIR), **attempt
                )
                return ctx
            except Exception as e:
                last_err = e
                msg = str(e)
                if "SingletonLock" in msg or "ProcessSingleton" in msg or "user data directory is already in use" in msg.lower():
                    try:
                        self._clean_stale_profile_lock()
                    except Exception:
                        pass
                continue
        raise last_err or RuntimeError("Aucun browser n'a pu être lancé")

    async def _ensure_started(self):
        async with self._lock:
            if self._context and self._page:
                try:
                    # Cheap probe: ensure page still alive
                    _ = self._page.url
                    return
                except Exception:
                    await self._close_internal()
            self._install_browser_if_needed()
            PROFILE_DIR.mkdir(parents=True, exist_ok=True)
            try:
                self._clean_stale_profile_lock()
            except Exception:
                pass
            kwargs = self._build_launch_kwargs()
            self._context = await self._try_launch(kwargs)
            await self._context.add_init_script(_STEALTH_INIT_JS)
            # Network filter to drop ads/trackers
            async def _route(route, request):
                url = request.url
                rtype = request.resource_type
                if rtype in {"beacon", "csp_report"} or _BLOCK_RESOURCES.search(url):
                    try:
                        await route.abort()
                        return
                    except Exception:
                        pass
                try:
                    await route.continue_()
                except Exception:
                    pass
            try:
                await self._context.route("**/*", _route)
            except Exception:
                pass
            pages = self._context.pages
            self._page = pages[0] if pages else await self._context.new_page()
            # Optional playwright-stealth (top-up patches)
            try:
                from playwright_stealth import stealth_async  # type: ignore
                try:
                    await stealth_async(self._page)
                except Exception:
                    pass
            except ImportError:
                pass

    async def _close_internal(self):
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        try:
            if self._playwright:
                await self._playwright.stop()
        except Exception:
            pass
        self._context = None
        self._page = None
        self._playwright = None

    # ----- Helpers ------------------------------------------------------
    async def _delay(self, min_ms=450, max_ms=1400):
        await asyncio.sleep(random.uniform(min_ms, max_ms) / 1000)

    async def _human_think_pause(self, min_s: float = 0.9, max_s: float = 2.6):
        """Pause as if reading/thinking before the next action."""
        await asyncio.sleep(random.uniform(min_s, max_s))

    async def _reading_dwell(self):
        """Post-navigate dwell: small scroll + idle, like a human scanning the page."""
        try:
            jitter = random.randint(120, 380)
            await self._page.mouse.wheel(0, jitter)
            await asyncio.sleep(random.uniform(0.6, 1.4))
            await self._page.mouse.wheel(0, random.randint(80, 240))
            await asyncio.sleep(random.uniform(0.5, 1.2))
            # Sometimes scroll back up a bit
            if random.random() < 0.4:
                await self._page.mouse.wheel(0, -random.randint(60, 180))
                await asyncio.sleep(random.uniform(0.3, 0.8))
        except Exception:
            pass

    async def _idle_mouse_drift(self):
        """Tiny mouse jitter between actions — like a human's hand not perfectly still."""
        try:
            x, y = self._mouse_pos
            tx = x + random.uniform(-30, 30)
            ty = y + random.uniform(-30, 30)
            await self._page.mouse.move(tx, ty, steps=random.randint(3, 8))
            self._mouse_pos = (tx, ty)
        except Exception:
            pass

    async def _human_mouse_move(self, target: tuple[float, float], steps: int = 24):
        x0, y0 = self._mouse_pos
        x3, y3 = target
        dx, dy = x3 - x0, y3 - y0
        # Two control points with light random perpendicular offset
        perp = (-dy, dx)
        norm = math.hypot(*perp) or 1.0
        perp = (perp[0] / norm, perp[1] / norm)
        off1 = random.uniform(-40, 40)
        off2 = random.uniform(-40, 40)
        p1 = (x0 + dx * 0.33 + perp[0] * off1, y0 + dy * 0.33 + perp[1] * off1)
        p2 = (x0 + dx * 0.66 + perp[0] * off2, y0 + dy * 0.66 + perp[1] * off2)
        for x, y in _bezier_points((x0, y0), p1, p2, (x3, y3), n=steps):
            try:
                await self._page.mouse.move(x, y)
            except Exception:
                pass
            await asyncio.sleep(random.uniform(0.005, 0.018))
        self._mouse_pos = (x3, y3)

    async def _resolve_locator_box(self, selector: str):
        loc = self._page.locator(selector).first
        try:
            await loc.scroll_into_view_if_needed(timeout=4000)
        except Exception:
            pass
        box = await loc.bounding_box()
        if not box:
            return None, None
        cx = box["x"] + box["width"] / 2 + random.uniform(-box["width"] / 4, box["width"] / 4)
        cy = box["y"] + box["height"] / 2 + random.uniform(-box["height"] / 4, box["height"] / 4)
        return loc, (cx, cy)

    def _detect_block(self, title: str, text: str) -> str | None:
        sample = (title or "") + "\n" + (text or "")[:2000]
        m = _BLOCK_PATTERNS.search(sample)
        return m.group(1).lower() if m else None

    async def _handle_walls(self) -> bool:
        """Clear cookie banners, consent walls, reCAPTCHA, newsletter modals, age gates.

        Idempotent. Runs on every navigate. Sequence: Google-specific → generic CMPs
        → reCAPTCHA → modal close → age gate. Click-through is the human path.
        """
        try:
            url = (self._page.url or "").lower()
        except Exception:
            return False
        acted = False

        # 1) Generic CMP / consent walls (Didomi, OneTrust, Quantcast, TrustArc, Sourcepoint, Cookiebot, in-house FR/EN)
        consent_selectors = [
            # Google
            'button#L2AGLb',
            'form[action*="consent"] button[type="submit"]',
            # Didomi
            '#didomi-notice-agree-button',
            'button.didomi-button-highlight',
            # OneTrust
            '#onetrust-accept-btn-handler',
            '#accept-recommended-btn-handler',
            # Quantcast
            '.qc-cmp2-summary-buttons button.css-1litn2v',
            '.qc-cmp2-summary-buttons button[mode="primary"]',
            # TrustArc / Sourcepoint
            '#truste-consent-button',
            'button[title="Accept All"]',
            # Cookiebot
            '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
            '#CybotCookiebotDialogBodyButtonAccept',
            # ARIA / text fallbacks (English + French + Spanish + German + Italian)
            'button[aria-label*="Accept all" i]',
            'button[aria-label*="Accept" i]',
            'button[aria-label*="Tout accepter" i]',
            'button[aria-label*="Accepter tout" i]',
            'button[aria-label*="Accepter" i]',
            'button[aria-label*="Aceptar todo" i]',
            'button[aria-label*="Alle akzeptieren" i]',
            'button[aria-label*="Accetta tutti" i]',
            'button:has-text("Accept all")',
            'button:has-text("Accept All Cookies")',
            'button:has-text("Tout accepter")',
            'button:has-text("J\'accepte tout")',
            'button:has-text("I agree")',
            'button:has-text("J\'accepte")',
            'button:has-text("Aceptar todo")',
            'button:has-text("Alle akzeptieren")',
            'button:has-text("Accetta tutti")',
            'button:has-text("Got it")',
            'button:has-text("OK, got it")',
        ]
        for sel in consent_selectors:
            try:
                btn = self._page.locator(sel).first
                if await btn.count() and await btn.is_visible():
                    await self._human_think_pause(0.4, 1.1)
                    await btn.click(timeout=3500)
                    acted = True
                    try:
                        await self._page.wait_for_load_state("domcontentloaded", timeout=5000)
                    except Exception:
                        pass
                    break
            except Exception:
                continue

        # 2) reCAPTCHA "I'm not a robot" checkbox (nested iframe)
        try:
            for frame in self._page.frames:
                fu = (frame.url or "").lower()
                if "recaptcha/api2/anchor" not in fu and "recaptcha/enterprise/anchor" not in fu:
                    continue
                try:
                    box = frame.locator("#recaptcha-anchor, .recaptcha-checkbox").first
                    if await box.count():
                        await self._human_think_pause(0.9, 2.0)
                        await box.click(timeout=5000)
                        acted = True
                        await self._page.wait_for_timeout(2500)
                        break
                except Exception:
                    continue
        except Exception:
            pass

        # 2b) reCAPTCHA image challenge → auto-solve with vision model if set
        try:
            if _VISION_MODEL and await self._has_image_challenge():
                await self.solve_recaptcha(_VISION_MODEL)
                acted = True
        except Exception:
            pass

        # 3) Google /sorry/ interstitial
        try:
            if "/sorry/" in url:
                btn = self._page.locator('input[type="submit"], button[type="submit"]').first
                if await btn.count():
                    await self._human_think_pause(0.6, 1.4)
                    await btn.click(timeout=4000)
                    acted = True
                    try:
                        await self._page.wait_for_load_state("domcontentloaded", timeout=8000)
                    except Exception:
                        pass
        except Exception:
            pass

        # 4) Newsletter / subscribe / close-overlay modals (generic X buttons)
        modal_close_selectors = [
            'button[aria-label*="close" i]:visible',
            'button[aria-label*="Fermer" i]:visible',
            'button[aria-label*="Cerrar" i]:visible',
            'button[aria-label*="Schließen" i]:visible',
            'button[aria-label*="Dismiss" i]:visible',
            'button[data-testid*="close" i]:visible',
            'button.modal-close:visible',
            '[role="dialog"] button[aria-label*="close" i]',
        ]
        for sel in modal_close_selectors:
            try:
                btn = self._page.locator(sel).first
                if await btn.count() and await btn.is_visible():
                    await self._human_think_pause(0.3, 0.9)
                    await btn.click(timeout=2500)
                    acted = True
                    break
            except Exception:
                continue

        # 5) Age gate ("Yes I'm over 18", "Enter site")
        age_selectors = [
            'button:has-text("Yes")',
            'button:has-text("I am 18")',
            'button:has-text("Enter site")',
            'button:has-text("Oui")',
            'button:has-text("J\'ai 18")',
        ]
        try:
            text_lower = (await self._page.evaluate("document.body && document.body.innerText || ''")).lower()
        except Exception:
            text_lower = ""
        if any(k in text_lower for k in ("18 or older", "are you 18", "âge", "verify your age", "age gate", "über 18")):
            for sel in age_selectors:
                try:
                    btn = self._page.locator(sel).first
                    if await btn.count() and await btn.is_visible():
                        await self._human_think_pause(0.4, 1.0)
                        await btn.click(timeout=3000)
                        acted = True
                        break
                except Exception:
                    continue

        if acted:
            await self._delay(600, 1500)
        return acted

    # Backwards-compat alias
    async def _handle_google_challenge(self) -> bool:
        return await self._handle_walls()

    def _find_bframe(self):
        """Return the reCAPTCHA challenge iframe Frame (bframe), or None."""
        try:
            for fr in self._page.frames:
                u = (fr.url or "").lower()
                if "recaptcha/api2/bframe" in u or "recaptcha/enterprise/bframe" in u:
                    return fr
        except Exception:
            pass
        return None

    async def _has_image_challenge(self) -> bool:
        bf = self._find_bframe()
        if bf is None:
            return False
        try:
            tbl = bf.locator("table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42")
            return await tbl.count() > 0
        except Exception:
            return False

    async def solve_recaptcha(self, model_id: str | None = None) -> str:
        """Solve a Google reCAPTCHA image challenge using a vision LLM.

        Loops over multi-step challenges. Returns "OK: ..." on success,
        "captcha_unsolved" / "no_challenge" / "error: ..." otherwise.
        """
        await self._ensure_started()
        model_id = model_id or _VISION_MODEL
        if not model_id:
            return "error: no vision model selected"
        bf = self._find_bframe()
        if bf is None:
            return "no_challenge"
        try:
            SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        loop = asyncio.get_event_loop()
        from monkey import llm as _llm
        last_status = "captcha_unsolved"
        for attempt in range(6):
            # Read instruction
            instr = ""
            for sel in (".rc-imageselect-desc-wrapper", ".rc-imageselect-desc",
                        ".rc-imageselect-desc-no-canonical"):
                try:
                    loc = bf.locator(sel).first
                    if await loc.count():
                        instr = (await loc.inner_text(timeout=2500)).strip()
                        if instr:
                            break
                except Exception:
                    continue
            if not instr:
                # Maybe gone → done
                if not await self._has_image_challenge():
                    return "OK: captcha cleared"
                break

            # Screenshot the challenge iframe element
            try:
                handle = await bf.frame_element()
                ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                shot = SCREENSHOT_DIR / f"captcha_{ts}.png"
                await handle.screenshot(path=str(shot))
            except Exception as e:
                return f"error: screenshot failed: {e}"

            try:
                b64 = base64.b64encode(shot.read_bytes()).decode()
            except Exception as e:
                return f"error: read shot failed: {e}"

            # Detect grid size from DOM
            grid = 3
            try:
                if await bf.locator("table.rc-imageselect-table-44").count():
                    grid = 4
            except Exception:
                pass

            prompt = (
                "You are looking at a Google reCAPTCHA image challenge.\n"
                f"Instruction (verbatim): \"{instr}\"\n"
                f"The image grid is {grid}x{grid}. Tiles are numbered 0-indexed, "
                "left-to-right, top-to-bottom (top-left = 0).\n"
                "Identify ALL tiles that match the instruction. Be generous: include "
                "any tile that contains even part of the target object. If a 4x4 grid "
                "and the instruction asks to keep clicking until none remain, list all "
                "currently visible matches.\n"
                "Reply STRICT JSON only, no prose, no code fences:\n"
                f'{{"grid": {grid}, "tiles": [..0-indexed ints..]}}'
            )
            messages = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }]
            try:
                resp = await loop.run_in_executor(
                    None, lambda: _llm.chat(messages, model_id=model_id)
                )
            except Exception as e:
                return f"error: vision call failed: {e}"

            text = (resp or {}).get("text") or ""
            data = {}
            try:
                m = re.search(r"\{[\s\S]*\}", text)
                if m:
                    data = _json.loads(m.group(0))
            except Exception:
                data = {}
            tiles = data.get("tiles") or []
            tiles = [int(i) for i in tiles if isinstance(i, (int, float, str)) and str(i).lstrip("-").isdigit()]

            # Click tiles inside the bframe
            cells = bf.locator("table.rc-imageselect-table-33 td, table.rc-imageselect-table-44 td, table.rc-imageselect-table-42 td")
            try:
                n = await cells.count()
            except Exception:
                n = 0
            clicked = 0
            for idx in tiles:
                if 0 <= idx < n:
                    try:
                        await cells.nth(idx).click(timeout=2500)
                        clicked += 1
                        await self._page.wait_for_timeout(random.randint(180, 420))
                    except Exception:
                        continue

            # Verify
            try:
                await bf.locator("#recaptcha-verify-button").first.click(timeout=4000)
                await self._page.wait_for_timeout(2800)
            except Exception:
                pass

            # Solved if challenge iframe is gone or anchor is checked
            if not await self._has_image_challenge():
                last_status = f"OK: captcha solved (attempt {attempt + 1}, clicked {clicked})"
                return last_status
            # Otherwise loop (Google chains rounds or shows new tiles)
            last_status = f"captcha_unsolved (attempt {attempt + 1}, clicked {clicked})"

        return last_status

    def _extract_clean(self, html: str, fallback_text: str) -> str:
        cleaned_html = _strip_noise_html(html) if html else ""
        try:
            import trafilatura  # type: ignore
            extracted = trafilatura.extract(
                cleaned_html or html,
                include_comments=False,
                include_tables=True,
                include_formatting=False,
                favor_recall=True,
            )
            if extracted and len(extracted) > 200:
                return _strip_noise_text(extracted)
        except Exception:
            pass
        # Fallback: text extracted from stripped HTML beats raw innerText.
        from_html = _text_from_cleaned_html(cleaned_html)
        if from_html and len(from_html) > 80:
            return from_html
        return _strip_noise_text(fallback_text)

    # ----- Public API ---------------------------------------------------
    async def navigate(self, url: str, max_chars: int = 0) -> dict:
        await self._ensure_started()
        err: str | None = None
        # Pre-navigation think pause (like a user typing/considering URL)
        await self._human_think_pause(0.4, 1.2)
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=25000)
            try:
                await self._page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:
                pass
        except Exception as e:
            err = str(e)
        # Clear all walls (CMP, reCAPTCHA, sorry, modals, age gates) before reading
        try:
            await self._handle_walls()
        except Exception:
            pass
        # Post-load reading dwell — humans scan before doing anything
        await self._reading_dwell()
        await self._delay(600, 1600)
        try:
            html = await self._page.content()
        except Exception:
            html = ""
        try:
            text_raw = await self._page.evaluate("document.body && document.body.innerText || ''")
        except Exception:
            text_raw = ""
        try:
            title = await self._page.title()
        except Exception:
            title = ""
        block = self._detect_block(title, text_raw)
        clean = self._extract_clean(html, text_raw)
        body = clean or _strip_noise_text(text_raw)
        if max_chars and max_chars > 0:
            body = body[:max_chars]
        return {
            "url": self._page.url if self._page else url,
            "title": title,
            "text": body,
            "blocked": block,
            "error": err,
        }

    async def get_text(self, selector: str = "body", max_chars: int = 0) -> str:
        await self._ensure_started()
        try:
            html = await self._page.evaluate(
                "(sel) => { const el = document.querySelector(sel); return el ? el.outerHTML : ''; }",
                selector or "body",
            )
            if html:
                cleaned = _strip_noise_html(html)
                txt = _text_from_cleaned_html(cleaned)
                if txt:
                    return txt[:max_chars] if max_chars and max_chars > 0 else txt
            # Fallback: live innerText
            text = await self._page.inner_text(selector or "body", timeout=8000)
            cleaned_txt = _strip_noise_text(text)
            return cleaned_txt[:max_chars] if max_chars and max_chars > 0 else cleaned_txt
        except Exception as e:
            return f"Error: {e}"

    async def get_clean_text(self, max_chars: int = 0) -> str:
        """Main content of current page: trafilatura + noise-stripped HTML fallback."""
        await self._ensure_started()
        try:
            html = await self._page.content()
            try:
                text_raw = await self._page.evaluate("document.body && document.body.innerText || ''")
            except Exception:
                text_raw = ""
            out = self._extract_clean(html, text_raw)
            return out[:max_chars] if max_chars and max_chars > 0 else out
        except Exception as e:
            return f"Error: {e}"

    async def get_links(self, limit: int = 30) -> str:
        await self._ensure_started()
        try:
            raw = await self._page.evaluate("""
                Array.from(document.querySelectorAll('a[href]'))
                  .filter(a => a.offsetParent !== null && a.href
                               && !a.href.startsWith('javascript:')
                               && !a.href.startsWith('mailto:')
                               && !a.href.startsWith('tel:'))
                  .map(a => ({ text: (a.textContent || '').trim().slice(0, 80), href: a.href }))
            """)
            from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
            cur_url = self._page.url
            try:
                cur_norm = urlparse(cur_url)
                cur_key = (cur_norm.netloc, cur_norm.path)
            except Exception:
                cur_key = None
            seen = set()
            out = []
            for item in raw or []:
                href = (item or {}).get("href") or ""
                text = ((item or {}).get("text") or "").strip()
                if not text or len(text) < 2 or not href:
                    continue
                try:
                    u = urlparse(href)
                    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
                         if not k.lower().startswith(("utm_", "fbclid", "gclid", "mc_"))]
                    norm = urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), ""))
                    key = (u.netloc, u.path, urlencode(q))
                    if cur_key and (u.netloc, u.path) == cur_key and not q:
                        continue
                except Exception:
                    norm = href
                    key = href
                if key in seen:
                    continue
                seen.add(key)
                out.append(f"{text} → {norm}")
                if len(out) >= limit:
                    break
            return "\n".join(out) if out else "Aucun lien trouvé."
        except Exception as e:
            return f"Error: {e}"

    async def click(self, selector: str) -> str:
        await self._ensure_started()
        try:
            # Think before acting
            await self._human_think_pause(0.8, 2.2)
            await self._idle_mouse_drift()
            loc, target = await self._resolve_locator_box(selector)
            if not target:
                # Fallback: standard click
                await self._page.click(selector, timeout=8000)
                return f"OK: cliqué (fallback) sur '{selector}'"
            await self._human_mouse_move(target)
            await self._delay(280, 720)  # hover dwell
            await self._page.mouse.down()
            await asyncio.sleep(random.uniform(0.05, 0.14))
            await self._page.mouse.up()
            await self._delay(500, 1300)
            return f"OK: cliqué sur '{selector}'"
        except Exception as e:
            return f"Error clicking '{selector}': {e}"

    async def fill(self, selector: str, value: str) -> str:
        await self._ensure_started()
        try:
            await self._human_think_pause(0.7, 2.0)
            await self._idle_mouse_drift()
            loc, target = await self._resolve_locator_box(selector)
            if target:
                await self._human_mouse_move(target)
                await self._delay(180, 480)
                await self._page.mouse.click(*target)
            else:
                await self._page.click(selector, timeout=8000)
            await self._delay(220, 560)
            # Clear existing
            await self._page.keyboard.press("Control+A" if os.uname().sysname != "Darwin" else "Meta+A")
            await self._page.keyboard.press("Backspace")
            # Bigram-aware typing with 1% typo+correction
            prev = ""
            for ch in value:
                if random.random() < 0.012 and ch.isalpha():
                    wrong = chr(ord(ch) + random.choice([-1, 1])) if ch.isalpha() else ch
                    await self._page.keyboard.type(wrong)
                    await asyncio.sleep(random.uniform(0.08, 0.16))
                    await self._page.keyboard.press("Backspace")
                    await asyncio.sleep(random.uniform(0.04, 0.10))
                await self._page.keyboard.type(ch)
                # Bigram-ish delay
                base = 0.05 if ch.isalpha() else 0.09
                if prev and prev.lower() == ch.lower():
                    base += 0.04  # double letters slower
                await asyncio.sleep(base + random.uniform(0, 0.08))
                prev = ch
            return f"OK: rempli '{selector}'"
        except Exception as e:
            return f"Error filling '{selector}': {e}"

    async def scroll(self, direction: str = "down", amount: int = 500) -> str:
        await self._ensure_started()
        try:
            await self._human_think_pause(0.5, 1.6)
            if direction == "top":
                await self._page.evaluate("window.scrollTo({top:0,behavior:'smooth'})")
                await self._delay(600, 1300)
                return "OK: scrollé top"
            if direction == "bottom":
                await self._page.evaluate("window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})")
                await self._delay(800, 1700)
                return "OK: scrollé bottom"
            sign = -1 if direction == "up" else 1
            # Multi-step easing scroll with reading pauses
            steps = random.randint(5, 10)
            remaining = amount
            for i in range(steps):
                step = remaining // (steps - i) if i < steps - 1 else remaining
                await self._page.mouse.wheel(0, sign * step)
                await asyncio.sleep(random.uniform(0.12, 0.32))
                remaining -= step
            # Reading pause after scroll
            await asyncio.sleep(random.uniform(0.6, 1.8))
            return f"OK: scrollé {direction}"
        except Exception as e:
            return f"Error: {e}"

    async def scroll_to_bottom(self, max_rounds: int = 20, stable_rounds: int = 3, step_ratio: float = 0.9) -> str:
        """Scroll progressively to trigger lazy-load / infinite scroll.

        Stops when scrollHeight stays stable `stable_rounds` consecutive rounds
        OR after `max_rounds`. Step = viewport height * step_ratio.
        Returns summary string with rounds done + final height.
        """
        await self._ensure_started()
        try:
            await self._human_think_pause(0.4, 1.0)
            last_height = await self._page.evaluate("document.body ? document.body.scrollHeight : 0")
            stable = 0
            rounds = 0
            for i in range(max_rounds):
                rounds += 1
                vh = await self._page.evaluate("window.innerHeight || 800")
                step = int(vh * step_ratio)
                await self._page.evaluate(f"window.scrollBy({{top:{step},left:0,behavior:'smooth'}})")
                # Reading pause + network settle
                await asyncio.sleep(random.uniform(0.5, 1.3))
                try:
                    await self._page.wait_for_load_state("networkidle", timeout=2500)
                except Exception:
                    pass
                # Try late wall handler (lazy-loaded CMPs)
                try:
                    await self._handle_walls()
                except Exception:
                    pass
                new_height = await self._page.evaluate("document.body ? document.body.scrollHeight : 0")
                if new_height <= last_height + 10:
                    stable += 1
                    if stable >= stable_rounds:
                        break
                else:
                    stable = 0
                    last_height = new_height
            return f"OK: scrolled to bottom — rounds={rounds}, height={last_height}px, stable={stable}"
        except Exception as e:
            return f"Error: {e}"

    async def paginate(self, direction: str = "next") -> str:
        """Go to next/previous page using site-native pagination.

        Tries (in order): rel=next link, aria-label, common text ("Next", "Suivant", ">"),
        URL ?page=N±1 / ?start=N±10 mutation as last resort.
        """
        await self._ensure_started()
        direction = (direction or "next").lower()
        is_next = direction not in ("prev", "previous", "back")
        try:
            await self._human_think_pause(0.4, 1.1)
            # 1) rel=next/prev
            sel_rel = 'a[rel="next"]' if is_next else 'a[rel="prev"]'
            try:
                a = self._page.locator(sel_rel).first
                if await a.count() and await a.is_visible():
                    await a.click(timeout=4000)
                    try:
                        await self._page.wait_for_load_state("domcontentloaded", timeout=8000)
                    except Exception:
                        pass
                    await self._handle_walls()
                    return f"OK: paginated {direction} (rel)"
            except Exception:
                pass
            # 2) aria-label + text selectors (multi-lang)
            if is_next:
                selectors = [
                    'a[aria-label*="Next" i]', 'button[aria-label*="Next" i]',
                    'a[aria-label*="Suivant" i]', 'button[aria-label*="Suivant" i]',
                    'a[aria-label*="Siguiente" i]', 'a[aria-label*="Weiter" i]',
                    'a:has-text("Next")', 'a:has-text("Suivant")',
                    'a:has-text("Siguiente")', 'a:has-text("Weiter")',
                    'a:has-text("Successivo")', 'a:has-text(">")',
                    'a#pnnext',  # Google
                    'a.morelink',
                ]
            else:
                selectors = [
                    'a[aria-label*="Previous" i]', 'a[aria-label*="Précédent" i]',
                    'a:has-text("Previous")', 'a:has-text("Précédent")',
                    'a:has-text("<")',
                ]
            for sel in selectors:
                try:
                    el = self._page.locator(sel).first
                    if await el.count() and await el.is_visible():
                        await el.click(timeout=4000)
                        try:
                            await self._page.wait_for_load_state("domcontentloaded", timeout=8000)
                        except Exception:
                            pass
                        await self._handle_walls()
                        return f"OK: paginated {direction} ({sel})"
                except Exception:
                    continue
            # 3) URL param mutation fallback
            try:
                from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
                cur = self._page.url
                u = urlparse(cur)
                qs = dict(parse_qsl(u.query, keep_blank_values=True))
                mutated = False
                if "page" in qs and qs["page"].isdigit():
                    qs["page"] = str(int(qs["page"]) + (1 if is_next else -1))
                    mutated = True
                elif "p" in qs and qs["p"].isdigit():
                    qs["p"] = str(int(qs["p"]) + (1 if is_next else -1))
                    mutated = True
                elif "start" in qs and qs["start"].isdigit():
                    qs["start"] = str(max(0, int(qs["start"]) + (10 if is_next else -10)))
                    mutated = True
                else:
                    qs["page"] = "2" if is_next else "1"
                    mutated = True
                if mutated:
                    new_url = urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(qs), u.fragment))
                    await self._page.goto(new_url, wait_until="domcontentloaded", timeout=15000)
                    await self._handle_walls()
                    return f"OK: paginated {direction} (URL mutation → {new_url})"
            except Exception as e:
                return f"Error: pagination URL fallback failed: {e}"
            return "ERREUR: no pagination control found"
        except Exception as e:
            return f"Error: {e}"

    async def run_js(self, code: str) -> str:
        await self._ensure_started()
        try:
            result = await self._page.evaluate(code)
            return str(result)[:2000]
        except Exception as e:
            return f"Error: {e}"

    async def screenshot(self) -> str:
        await self._ensure_started()
        try:
            SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            path = SCREENSHOT_DIR / f"screenshot_{ts}.png"
            await self._page.screenshot(path=str(path), full_page=False)
            return f"OK: screenshot → {path}"
        except Exception as e:
            return f"Error: {e}"

    async def wait_for(self, selector: str = "", timeout_ms: int = 10000) -> str:
        await self._ensure_started()
        try:
            if selector.startswith("http"):
                await self._page.wait_for_url(selector, timeout=timeout_ms)
                return f"OK: URL atteinte → {self._page.url}"
            elif selector:
                await self._page.wait_for_selector(selector, timeout=timeout_ms)
                return f"OK: élément '{selector}' visible"
            else:
                await self._page.wait_for_load_state("networkidle", timeout=timeout_ms)
                return "OK: page chargée (networkidle)"
        except Exception as e:
            return f"Error: {e}"

    async def navigate_back(self) -> str:
        await self._ensure_started()
        try:
            await self._page.go_back(wait_until="domcontentloaded", timeout=10000)
            return f"OK: retour → {self._page.url}"
        except Exception as e:
            return f"Error: {e}"

    async def current_url(self) -> str:
        await self._ensure_started()
        return self._page.url

    async def safe_navigate(self, url: str, max_chars: int = 8000, retries: int = 2) -> dict:
        """Navigate with block-detection + retry. Returns same shape as navigate()."""
        last: dict = {}
        for attempt in range(retries + 1):
            res = await self.navigate(url, max_chars=max_chars)
            last = res
            if not res.get("blocked") and not res.get("error"):
                return res
            # Hard error (Protocol error, page closed, etc.) — recycle the browser before retry
            if res.get("error"):
                try:
                    await self._close_internal()
                except Exception:
                    pass
            # Wait then retry — give the challenge JS a chance, OR reopen on hard error
            await asyncio.sleep(2.5 + attempt * 1.5)
            # CRITICAL: retry on the original `url`, NOT `self._page.url`
            # (a prior redirect could have parked the page elsewhere, e.g. coinbase.com)
            res2 = await self.navigate(url, max_chars=max_chars)
            if not res2.get("blocked") and not res2.get("error"):
                return res2
            last = res2
        return last

    async def close(self):
        await self._close_internal()


# --- Singleton ---------------------------------------------------------
_browser_instance: StealthBrowser | None = None


def get_browser() -> StealthBrowser:
    global _browser_instance
    if not _browser_instance:
        _browser_instance = StealthBrowser()
    return _browser_instance
