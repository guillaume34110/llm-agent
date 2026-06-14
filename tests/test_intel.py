"""Tests for monkey.tools.intel — network/email/phone OSINT primitives.

Uses mocks for HTTP via _netcache; real libs for parsing.
"""
from __future__ import annotations

import hashlib
import json

import pytest

from monkey.tools import intel
from monkey.tools import _netcache


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(_netcache, "CACHE_DIR", tmp_path / "c")
    _netcache._HOST_LAST.clear()
    yield


def _mock_request(monkeypatch, payload: dict):
    def fake(method, url, **kw):
        return {"status": payload.get("status", 200),
                "headers": payload.get("headers", {}),
                "text": payload.get("text", ""),
                "url": url, "from_cache": False}
    monkeypatch.setattr(intel._netcache, "request", fake)


def test_clean_domain_strips_scheme_path():
    assert intel._clean_domain("https://Example.com/foo/bar") == "example.com"
    assert intel._clean_domain("EXAMPLE.com:443") == "example.com"


def test_whois_invalid_domain():
    assert intel.whois_lookup("not a domain").startswith("ERREUR: invalid")


def test_dns_invalid_domain():
    assert intel.dns_records("...").startswith("ERREUR: invalid")


def test_subdomain_enum_parses_crtsh(monkeypatch):
    crtsh_payload = json.dumps([
        {"name_value": "*.example.com\napi.example.com"},
        {"name_value": "www.example.com"},
        {"name_value": "example.com"},        # equals base, excluded
        {"name_value": "other.test"},          # different domain, excluded
    ])
    _mock_request(monkeypatch, {"text": crtsh_payload})
    out = json.loads(intel.subdomain_enum("example.com"))
    assert out["domain"] == "example.com"
    assert set(out["subdomains"]) == {"api.example.com", "www.example.com"}
    assert out["count"] == 2


def test_subdomain_enum_bad_status(monkeypatch):
    _mock_request(monkeypatch, {"status": 503, "text": ""})
    assert "ERREUR" in intel.subdomain_enum("example.com")


def test_wayback_snapshots_parses_cdx(monkeypatch):
    payload = json.dumps([
        ["timestamp", "original", "mimetype", "statuscode"],
        ["20200101000000", "http://example.com/", "text/html", "200"],
        ["20210605120000", "http://example.com/", "text/html", "200"],
    ])
    _mock_request(monkeypatch, {"text": payload})
    out = json.loads(intel.wayback_snapshots("http://example.com/"))
    assert out["count"] == 2
    assert out["snapshots"][0]["timestamp"] == "20200101000000"
    assert "web.archive.org/web/20200101000000/" in out["snapshots"][0]["snapshot_url"]


def test_wayback_empty(monkeypatch):
    _mock_request(monkeypatch, {"text": "[]"})
    out = intel.wayback_snapshots("http://nothing.test/")
    assert out.startswith("OK: no snapshots")


def test_gravatar_invalid_email():
    assert intel.gravatar_lookup("nope").startswith("ERREUR: invalid")


def test_gravatar_404(monkeypatch):
    _mock_request(monkeypatch, {"status": 404})
    out = json.loads(intel.gravatar_lookup("test@example.com"))
    expected_hash = hashlib.md5(b"test@example.com").hexdigest()
    assert out["found"] is False
    assert out["hash"] == expected_hash
    assert expected_hash in out["avatar_url"]


def test_gravatar_profile(monkeypatch):
    payload = json.dumps({
        "entry": [{
            "displayName": "Alice",
            "preferredUsername": "alice",
            "currentLocation": "Paris",
            "urls": [{"value": "https://alice.example"}],
        }]
    })
    _mock_request(monkeypatch, {"status": 200, "text": payload})
    out = json.loads(intel.gravatar_lookup("alice@example.com"))
    assert out["found"] is True
    assert out["display_name"] == "Alice"
    assert out["location"] == "Paris"


def test_hibp_password_pwned(monkeypatch):
    # SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    sha1 = hashlib.sha1(b"password").hexdigest().upper()
    suffix = sha1[5:]
    body = f"DEADBEEF:1\n{suffix}:42\nCAFEBABE:7\n"
    _mock_request(monkeypatch, {"text": body})
    out = json.loads(intel.hibp_password_check("password"))
    assert out == {"pwned": True, "count": 42}


def test_hibp_password_clean(monkeypatch):
    _mock_request(monkeypatch, {"text": "DEADBEEF:1\n"})
    out = json.loads(intel.hibp_password_check("unique-not-in-list-xyz"))
    assert out == {"pwned": False, "count": 0}


def test_hibp_empty_password():
    assert intel.hibp_password_check("").startswith("ERREUR")


def test_phone_parse_valid_french():
    out = json.loads(intel.phone_parse("+33612345678", "FR"))
    assert out["country_code"] == 33
    assert out["region"] == "FR"
    assert out["e164"] == "+33612345678"
    assert out["valid"] is True


def test_phone_parse_invalid():
    out = intel.phone_parse("garbage", "FR")
    assert out.startswith("ERREUR")


def test_phone_parse_empty():
    assert intel.phone_parse("").startswith("ERREUR")


def test_http_headers_returns_status_and_headers(monkeypatch):
    _mock_request(monkeypatch, {"status": 200, "headers": {"Server": "nginx", "X-Powered-By": "Express"}})
    out = json.loads(intel.http_headers("example.com"))
    assert out["status"] == 200
    assert out["headers"]["Server"] == "nginx"
