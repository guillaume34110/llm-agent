"""Tests for monkey.tools.osint_social — username pivot + per-platform lookups.

Network mocked via _netcache.request stub.
"""
from __future__ import annotations

import json

import pytest

from monkey.tools import osint_social as soc
from monkey.tools import _netcache


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(_netcache, "CACHE_DIR", tmp_path / "c")
    _netcache._HOST_LAST.clear()
    yield


def _stub_responses(monkeypatch, by_url: dict):
    """by_url maps URL substring → {status, text}."""
    def fake(method, url, **kw):
        for needle, resp in by_url.items():
            if needle in url:
                return {"status": resp.get("status", 200),
                        "headers": {},
                        "text": resp.get("text", ""),
                        "url": url, "from_cache": False}
        return {"status": 404, "headers": {}, "text": "", "url": url, "from_cache": False}
    monkeypatch.setattr(soc._netcache, "request", fake)


def test_norm_username():
    assert soc._norm_username("@Alice") == "Alice"
    assert soc._norm_username("  bob  ") == "bob"


def test_username_pivot_invalid():
    assert soc.username_pivot("").startswith("ERREUR")
    assert soc.username_pivot("a").startswith("ERREUR")  # too short
    assert soc.username_pivot("has space").startswith("ERREUR")


def test_username_pivot_filters_and_counts(monkeypatch):
    _stub_responses(monkeypatch, {
        "github.com/alice": {"status": 200, "text": "Alice"},
        "reddit.com/user/alice/about.json": {"status": 200, "text": "{}"},
        "gitlab.com/alice": {"status": 404, "text": ""},
    })
    out = json.loads(soc.username_pivot("alice", sites=["github", "gitlab", "reddit"]))
    assert out["username"] == "alice"
    assert out["count_checked"] == 3
    assert out["count_found"] == 2
    hit_sites = {h["site"] for h in out["hits"]}
    assert hit_sites == {"github", "reddit"}
    assert "gitlab" in out["misses"]


def test_username_pivot_status_not_rule(monkeypatch):
    # twitter rule = status_not 404; 200 → hit
    _stub_responses(monkeypatch, {"twitter.com/bob": {"status": 200, "text": "bob"}})
    out = json.loads(soc.username_pivot("bob", sites=["twitter"]))
    assert out["count_found"] == 1


def test_username_pivot_hn_absent_rule(monkeypatch):
    # HN returns "null" literal for missing user → miss
    _stub_responses(monkeypatch, {"hacker-news.firebaseio.com/v0/user/ghostuser.json": {"status": 200, "text": "null"}})
    out = json.loads(soc.username_pivot("ghostuser", sites=["hackernews"]))
    assert out["count_found"] == 0
    assert "hackernews" in out["misses"]


def test_reddit_user_not_found(monkeypatch):
    _stub_responses(monkeypatch, {"reddit.com/user/nope/about.json": {"status": 404}})
    assert soc.reddit_user("nope").startswith("OK: reddit user")


def test_reddit_user_profile(monkeypatch):
    about = json.dumps({"data": {"link_karma": 42, "comment_karma": 10, "has_verified_email": True}})
    posts = json.dumps({"data": {"children": [
        {"data": {"title": "post1", "subreddit": "python", "score": 5,
                  "created_utc": 1700000000, "permalink": "/r/python/comments/abc/post1/"}}
    ]}})
    _stub_responses(monkeypatch, {
        "reddit.com/user/alice/about.json": {"status": 200, "text": about},
        "reddit.com/user/alice/submitted.json": {"status": 200, "text": posts},
    })
    out = json.loads(soc.reddit_user("alice"))
    assert out["karma"]["link"] == 42
    assert out["submission_count"] == 1
    assert out["submissions"][0]["subreddit"] == "python"


def test_hn_user_missing(monkeypatch):
    _stub_responses(monkeypatch, {"firebaseio.com/v0/user/ghost.json": {"status": 200, "text": "null"}})
    assert soc.hn_user("ghost").startswith("OK: HN user")


def test_hn_user_found(monkeypatch):
    payload = json.dumps({"karma": 1337, "created": 1300000000, "about": "hi", "submitted": [1, 2, 3]})
    _stub_responses(monkeypatch, {"firebaseio.com/v0/user/pg.json": {"status": 200, "text": payload}})
    out = json.loads(soc.hn_user("pg"))
    assert out["karma"] == 1337
    assert out["submission_count"] == 3


def test_github_user_404(monkeypatch):
    _stub_responses(monkeypatch, {"api.github.com/users/nope": {"status": 404}})
    assert soc.github_user("nope").startswith("OK: github user")


def test_github_user_with_repos(monkeypatch):
    user = json.dumps({"html_url": "https://github.com/torvalds", "name": "Linus", "public_repos": 7, "followers": 99})
    repos = json.dumps([
        {"name": "linux", "html_url": "https://github.com/torvalds/linux", "description": "kernel",
         "language": "C", "stargazers_count": 1000, "updated_at": "2026-01-01", "fork": False},
    ])
    _stub_responses(monkeypatch, {
        "api.github.com/users/torvalds/repos": {"status": 200, "text": repos},
        "api.github.com/users/torvalds": {"status": 200, "text": user},
    })
    out = json.loads(soc.github_user("torvalds"))
    assert out["name"] == "Linus"
    assert len(out["recent_repos"]) == 1
    assert out["recent_repos"][0]["language"] == "C"


def test_github_code_search_empty():
    assert soc.github_code_search("").startswith("ERREUR")


def test_github_code_search_rate_limited(monkeypatch):
    _stub_responses(monkeypatch, {"search/code": {"status": 403}})
    assert "rate-limited" in soc.github_code_search("foo")


def test_github_code_search_results(monkeypatch):
    payload = json.dumps({"total_count": 2, "items": [
        {"name": ".env", "path": "config/.env", "html_url": "https://github.com/x/y/blob/.env",
         "repository": {"full_name": "x/y"}},
    ]})
    _stub_responses(monkeypatch, {"search/code": {"status": 200, "text": payload}})
    out = json.loads(soc.github_code_search("filename:.env DB_PASSWORD"))
    assert out["total"] == 2
    assert out["count"] == 1
    assert out["results"][0]["repo"] == "x/y"
