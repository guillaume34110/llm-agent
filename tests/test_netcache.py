"""Tests for monkey.tools._netcache: disk cache, UA pool, per-host throttle."""
from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from monkey.tools import _netcache as nc


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(nc, "CACHE_DIR", tmp_path / "cache")
    nc._HOST_LAST.clear()
    nc._HOST_LOCKS.clear()
    yield


def test_pick_ua_in_pool():
    for _ in range(20):
        assert nc.pick_ua() in nc._UAS


def test_key_stable_and_body_sensitive():
    k1 = nc._key("GET", "https://x/", None)
    k2 = nc._key("GET", "https://x/", None)
    k3 = nc._key("POST", "https://x/", b"a")
    k4 = nc._key("POST", "https://x/", b"b")
    assert k1 == k2
    assert k3 != k4
    assert k1 != k3


def test_cache_put_get_roundtrip():
    nc.cache_put("GET", "https://x/", None, 200, {"a": "b"}, "hello")
    got = nc.cache_get("GET", "https://x/", None)
    assert got is not None
    assert got["status"] == 200
    assert got["text"] == "hello"
    assert got["headers"]["a"] == "b"


def test_cache_get_ttl_expired():
    nc.cache_put("GET", "https://x/", None, 200, {}, "hi")
    # Force ts in the past
    p = nc._path_for(nc._key("GET", "https://x/", None))
    data = json.loads(p.read_text())
    data["ts"] = time.time() - 10_000
    p.write_text(json.dumps(data))
    assert nc.cache_get("GET", "https://x/", None, ttl=3600) is None


def test_cache_get_ttl_zero_disables():
    nc.cache_put("GET", "https://x/", None, 200, {}, "hi")
    assert nc.cache_get("GET", "https://x/", None, ttl=0) is None


def test_cache_clear_counts():
    nc.cache_put("GET", "https://x/", None, 200, {}, "1")
    nc.cache_put("GET", "https://y/", None, 200, {}, "2")
    n = nc.cache_clear()
    assert n == 2


def test_throttle_blocks_same_host(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(nc.time, "sleep", lambda s: slept.append(s))
    nc.throttle("https://example.com/a", min_interval=1.0)
    nc.throttle("https://example.com/b", min_interval=1.0)
    assert slept and slept[-1] > 0


def test_throttle_independent_hosts(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr(nc.time, "sleep", lambda s: slept.append(s))
    nc.throttle("https://a.com/", min_interval=1.0)
    nc.throttle("https://b.com/", min_interval=1.0)
    assert not slept


def test_request_uses_cache_on_second_call(monkeypatch):
    calls = {"n": 0}

    class FakeResp:
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html>ok</html>"
        url = "https://x.test/"

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def request(self, *a, **k):
            calls["n"] += 1
            return FakeResp()

    monkeypatch.setattr(nc.httpx, "Client", FakeClient)
    monkeypatch.setattr(nc.time, "sleep", lambda s: None)

    r1 = nc.request("GET", "https://x.test/")
    r2 = nc.request("GET", "https://x.test/")
    assert r1["from_cache"] is False
    assert r2["from_cache"] is True
    assert r2["text"] == "<html>ok</html>"
    assert calls["n"] == 1


def test_request_does_not_cache_errors(monkeypatch):
    class FakeResp:
        status_code = 500
        headers = {}
        text = "boom"
        url = "https://x.test/"

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def request(self, *a, **k): return FakeResp()

    monkeypatch.setattr(nc.httpx, "Client", FakeClient)
    monkeypatch.setattr(nc.time, "sleep", lambda s: None)

    r1 = nc.request("GET", "https://x.test/err")
    assert r1["status"] == 500
    cached = nc.cache_get("GET", "https://x.test/err", None)
    assert cached is None


def test_request_dict_body_serializes_to_json(monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 200
        headers = {}
        text = "ok"
        url = "https://x.test/"

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def request(self, method, url, headers=None, content=None):
            captured["headers"] = headers
            captured["content"] = content
            return FakeResp()

    monkeypatch.setattr(nc.httpx, "Client", FakeClient)
    monkeypatch.setattr(nc.time, "sleep", lambda s: None)

    nc.request("POST", "https://x.test/p", body={"k": "v"})
    assert captured["content"] == b'{"k": "v"}'
    assert captured["headers"]["Content-Type"] == "application/json"
    assert "User-Agent" in captured["headers"]


def test_request_network_error_returns_status_zero(monkeypatch):
    class FakeClient:
        def __init__(self, *a, **k): raise ConnectionError("nope")

    monkeypatch.setattr(nc.httpx, "Client", FakeClient)
    monkeypatch.setattr(nc.time, "sleep", lambda s: None)

    r = nc.request("GET", "https://nowhere.invalid/")
    assert r["status"] == 0
    assert "nope" in r.get("error", "")
    assert r["from_cache"] is False
