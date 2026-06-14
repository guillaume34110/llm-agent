"""Disk cache + UA rotation + per-host throttle for outbound HTTP.

Goal: keep OSINT runs polite (one request/host/sec), reduce hammering and
re-trace cost (6h TTL by default), rotate UA so we don't look like a bot.

Plain stdlib + httpx. Cache key = SHA1(method|url|sorted_headers|body).
On disk: ~/.monkey/cache/<sha1[:2]>/<sha1>.json with {ts, status, headers, text}.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

# curl_cffi impersonates Chrome's TLS/JA3 fingerprint — required to bypass
# Cloudflare / Akamai / DataDome bot walls that fingerprint at TLS layer.
# Falls back to httpx if unavailable.
try:
    from curl_cffi import requests as _curl_requests  # type: ignore
    _HAS_CURL_CFFI = True
except Exception:
    _curl_requests = None  # type: ignore
    _HAS_CURL_CFFI = False

CACHE_DIR = Path.home() / ".monkey" / "cache"
DEFAULT_TTL = 6 * 3600  # 6h

# Chrome impersonation profiles for curl_cffi. Sticky per-host like UA.
_IMPERSONATE_PROFILES = ["chrome131", "chrome124"]
_HOST_IMPERSONATE: dict[str, str] = {}
_HOST_IMPERSONATE_LOCK = threading.Lock()


def host_impersonate(host: str, ua: str | None = None) -> str:
    """Sticky curl_cffi impersonation profile per host. If `ua` given, picks
    a profile whose Chrome major version matches (TLS ↔ UA consistency)."""
    with _HOST_IMPERSONATE_LOCK:
        prof = _HOST_IMPERSONATE.get(host)
        if prof is None:
            if ua and "Chrome/" in ua:
                try:
                    major = ua.split("Chrome/")[1].split(".")[0]
                    cand = f"chrome{major}"
                    prof = cand if cand in _IMPERSONATE_PROFILES else _IMPERSONATE_PROFILES[0]
                except Exception:
                    prof = random.choice(_IMPERSONATE_PROFILES)
            else:
                prof = random.choice(_IMPERSONATE_PROFILES)
            _HOST_IMPERSONATE[host] = prof
        return prof

# Chrome-only UAs — TLS impersonation (curl_cffi) is Chrome JA3/JA4, so UA
# must be Chrome too. Mixing Firefox UA + Chrome TLS = obvious bot signature.
_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

_HOST_LOCKS: dict[str, threading.Lock] = {}
_HOST_LAST: dict[str, float] = {}
_HOST_LOCKS_LOCK = threading.Lock()
_HOST_UA: dict[str, str] = {}
_HOST_UA_LOCK = threading.Lock()


def pick_ua() -> str:
    return random.choice(_UAS)


def host_ua(host: str) -> str:
    """Sticky UA per host: a real browser doesn't swap UA between requests."""
    with _HOST_UA_LOCK:
        ua = _HOST_UA.get(host)
        if ua is None:
            ua = random.choice(_UAS)
            _HOST_UA[host] = ua
        return ua


def _client_hints_for(ua: str) -> dict[str, str]:
    """Return Sec-CH-UA-* hints consistent with the picked UA (Chrome only)."""
    if "Chrome/" not in ua or "Firefox" in ua:
        return {}
    try:
        major = ua.split("Chrome/")[1].split(".")[0]
    except Exception:
        major = "131"
    if "Windows" in ua:
        plat = '"Windows"'
    elif "Macintosh" in ua:
        plat = '"macOS"'
    elif "Linux" in ua:
        plat = '"Linux"'
    else:
        plat = '"Unknown"'
    return {
        "Sec-Ch-Ua": f'"Chromium";v="{major}", "Google Chrome";v="{major}", "Not?A_Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": plat,
    }


def default_browser_headers(url: str, *, ua: str | None = None, referer: str | None = None) -> dict[str, str]:
    """Headers a real Chrome/Firefox would send for a top-level navigation."""
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        host = ""
    if ua is None:
        ua = host_ua(host) if host else pick_ua()
    h: dict[str, str] = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site" if referer else "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Connection": "keep-alive",
        "DNT": "1",
    }
    h.update(_client_hints_for(ua))
    if referer:
        h["Referer"] = referer
    return h


def _host_lock(host: str) -> threading.Lock:
    with _HOST_LOCKS_LOCK:
        lock = _HOST_LOCKS.get(host)
        if lock is None:
            lock = threading.Lock()
            _HOST_LOCKS[host] = lock
        return lock


_SEARCH_HOSTS = ("google.", "bing.", "duckduckgo.", "html.duckduckgo.", "yandex.")


def throttle(url: str, min_interval: float = 4.0) -> None:
    """Sleep enough so two consecutive requests to the same host respect
    min_interval, with jitter. Search-engine hosts get a much longer floor
    (8s) — they fingerprint inter-request timing aggressively."""
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return
    if not host:
        return
    if any(s in host for s in _SEARCH_HOSTS):
        min_interval = max(min_interval, 8.0)
    jitter = random.uniform(0.5, 2.0)
    target = min_interval + jitter
    lock = _host_lock(host)
    with lock:
        last = _HOST_LAST.get(host, 0.0)
        now = time.time()
        wait = (last + target) - now
        if wait > 0:
            time.sleep(min(wait, target))
        _HOST_LAST[host] = time.time()


def _key(method: str, url: str, body: str | bytes | None) -> str:
    h = hashlib.sha1()
    h.update(method.upper().encode())
    h.update(b"|")
    h.update(url.encode())
    h.update(b"|")
    if body is None:
        pass
    elif isinstance(body, bytes):
        h.update(body)
    else:
        h.update(body.encode("utf-8", errors="replace"))
    return h.hexdigest()


def _path_for(key: str) -> Path:
    return CACHE_DIR / key[:2] / f"{key}.json"


def cache_get(method: str, url: str, body: str | bytes | None = None, ttl: int = DEFAULT_TTL) -> dict | None:
    if ttl <= 0:
        return None
    p = _path_for(_key(method, url, body))
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
    except Exception:
        return None
    if time.time() - float(data.get("ts", 0)) > ttl:
        return None
    return data


def cache_put(method: str, url: str, body: str | bytes | None, status: int, headers: dict, text: str) -> None:
    try:
        p = _path_for(_key(method, url, body))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "ts": time.time(),
            "status": int(status),
            "headers": {k: str(v) for k, v in (headers or {}).items()},
            "text": text,
            "url": url,
            "method": method.upper(),
        }))
    except Exception:
        pass


def cache_clear() -> int:
    """Wipe all cache entries. Returns number deleted."""
    if not CACHE_DIR.exists():
        return 0
    n = 0
    for p in CACHE_DIR.rglob("*.json"):
        try:
            p.unlink()
            n += 1
        except Exception:
            pass
    return n


def request(method: str, url: str, *, headers: dict | None = None, body: Any = None,
            timeout: float = 15.0, ttl: int = DEFAULT_TTL, throttle_s: float = 4.0) -> dict:
    """Cache-then-network HTTP. Returns {status, headers, text, from_cache, url}.

    `body` may be str, bytes, dict (sent as JSON) or None.
    """
    if isinstance(body, (dict, list)):
        body_bytes = json.dumps(body).encode()
        headers = {**(headers or {}), "Content-Type": "application/json"}
    elif isinstance(body, str):
        body_bytes = body.encode()
    elif isinstance(body, bytes):
        body_bytes = body
    else:
        body_bytes = None

    cached = cache_get(method, url, body_bytes, ttl=ttl)
    if cached is not None:
        cached["from_cache"] = True
        return cached

    throttle(url, min_interval=throttle_s)
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        host = ""
    ua = host_ua(host) if host else pick_ua()
    final_headers = {**default_browser_headers(url, ua=ua), **(headers or {})}

    # Prefer curl_cffi: real Chrome JA3/JA4 TLS fingerprint defeats Cloudflare /
    # Akamai / DataDome TLS-layer bot detection that vanilla httpx cannot.
    if _HAS_CURL_CFFI:
        try:
            impersonate = host_impersonate(host, ua=ua) if host else random.choice(_IMPERSONATE_PROFILES)
            resp = _curl_requests.request(  # type: ignore[union-attr]
                method.upper(),
                url,
                headers=final_headers,
                data=body_bytes,
                timeout=timeout,
                impersonate=impersonate,
                allow_redirects=True,
            )
            text = resp.text
            out = {
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "text": text,
                "url": str(resp.url),
                "from_cache": False,
                "ts": time.time(),
            }
            if 200 <= resp.status_code < 400:
                cache_put(method, url, body_bytes, resp.status_code, dict(resp.headers), text)
            return out
        except Exception as e:
            # Fall through to httpx fallback
            curl_err = str(e)
    else:
        curl_err = ""

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as c:
            resp = c.request(method.upper(), url, headers=final_headers, content=body_bytes)
        text = resp.text
        out = {
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "text": text,
            "url": str(resp.url),
            "from_cache": False,
            "ts": time.time(),
        }
        if 200 <= resp.status_code < 400:
            cache_put(method, url, body_bytes, resp.status_code, dict(resp.headers), text)
        return out
    except Exception as e:
        return {"status": 0, "headers": {}, "text": "", "url": url, "from_cache": False,
                "error": f"{e}" + (f" (curl_cffi: {curl_err})" if curl_err else ""),
                "ts": time.time()}
