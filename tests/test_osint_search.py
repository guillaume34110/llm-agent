"""Tests for monkey.tools.osint_search — dork builder + RRF fusion."""
from __future__ import annotations

import json

from monkey.tools import osint_search as os_


def test_dorks_empty_target():
    assert os_.osint_dorks("").startswith("ERREUR")


def test_dorks_detects_email():
    out = json.loads(os_.osint_dorks("alice@example.com"))
    assert out["detected"] == ["email"]
    assert "email" in out["dorks"]
    assert any('"alice@example.com"' in d for d in out["dorks"]["email"])


def test_dorks_detects_domain():
    out = json.loads(os_.osint_dorks("example.com"))
    assert out["detected"] == ["domain"]
    assert "domain" in out["dorks"]
    assert any("site:example.com" in d for d in out["dorks"]["domain"])


def test_dorks_detects_person_with_space():
    out = json.loads(os_.osint_dorks("Jean Dupont"))
    assert out["detected"] == ["person"]
    assert "person" in out["dorks"]
    # quoted because contains space
    assert any('"Jean Dupont"' in d for d in out["dorks"]["person"])


def test_dorks_detects_handle():
    out = json.loads(os_.osint_dorks("@alice_dev"))
    assert out["detected"] == ["handle"]
    assert "handle" in out["dorks"]
    # token stripped of leading @
    assert any("site:twitter.com/alice_dev" in d for d in out["dorks"]["handle"])


def test_dorks_explicit_kinds_override():
    out = json.loads(os_.osint_dorks("example.com", kinds=["person", "domain"]))
    assert set(out["dorks"].keys()) == {"person", "domain"}


def test_dorks_count_matches():
    out = json.loads(os_.osint_dorks("example.com"))
    assert out["count"] == sum(len(v) for v in out["dorks"].values())


def test_normalize_url_strips_www_and_trailing_slash():
    assert os_._normalize_url("https://WWW.Example.com/foo/") == "https://example.com/foo"
    assert os_._normalize_url("http://example.com/") == "http://example.com"


def test_rrf_merge_single_engine():
    rankings = {"google": [
        {"url": "https://a.com/", "title": "A"},
        {"url": "https://b.com/", "title": "B"},
    ]}
    out = os_.rrf_merge(rankings)
    assert len(out) == 2
    # First result has higher score than second
    assert out[0]["score"] > out[1]["score"]
    assert out[0]["url"] == "https://a.com/"
    assert out[0]["engines"] == ["google"]


def test_rrf_merge_dedup_across_engines():
    rankings = {
        "google": [{"url": "https://a.com/x", "title": "A"}, {"url": "https://b.com/", "title": "B"}],
        "bing": [{"url": "https://a.com/x/", "title": "A bing"}],  # trailing slash → dedup
    }
    out = os_.rrf_merge(rankings)
    assert len(out) == 2
    top = out[0]
    assert sorted(top["engines"]) == ["bing", "google"]
    # Fused score = 1/(60+1) + 1/(60+1) = 2/61
    assert abs(top["score"] - (2 / 61)) < 1e-6


def test_rrf_merge_top_n_cap():
    rankings = {"g": [{"url": f"https://x{i}.com"} for i in range(30)]}
    out = os_.rrf_merge(rankings, top_n=5)
    assert len(out) == 5


def test_rrf_merge_skips_no_url():
    rankings = {"g": [{"title": "no url"}, {"url": "https://a.com"}]}
    out = os_.rrf_merge(rankings)
    assert len(out) == 1
    assert out[0]["url"] == "https://a.com"


def test_multi_engine_search_empty_query():
    assert os_.multi_engine_search("").startswith("ERREUR")
