"""OSINT social / username pivot tools.

`username_pivot`: Sherlock-style probe of a username across N popular platforms
via cheap HEAD-ish GETs. Returns per-site {found, url, status}.

`reddit_user`, `hn_user`, `github_user`: profile + recent activity pulled from
the public JSON APIs of each platform. No auth required.

`github_code_search`: search GitHub code/issues/users via the public REST API
(unauthenticated; rate-limited to ~10/min — `_netcache` cushions repeat calls).

All HTTP routes through `_netcache.request` so it's cached + UA-rotated +
politely throttled.
"""
from __future__ import annotations

import json
import re
from typing import Iterable
from urllib.parse import quote, quote_plus

from monkey.tools import _netcache


_USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{1,38}$")


def _norm_username(u: str) -> str:
    return (u or "").strip().lstrip("@")


# (site_name, url_template, found_if). found_if is a tuple:
#   ("status", 200)            → match if HTTP status equals N
#   ("status_not", 404)        → match if status is anything but N
#   ("absent", "needle")       → match if `needle` is NOT in body (and status 2xx)
#   ("present", "needle")      → match if `needle` IS in body (and status 2xx)
_SITES: list[tuple[str, str, tuple]] = [
    ("github", "https://github.com/{u}", ("status", 200)),
    ("gitlab", "https://gitlab.com/{u}", ("status", 200)),
    ("twitter", "https://twitter.com/{u}", ("status_not", 404)),
    ("x", "https://x.com/{u}", ("status_not", 404)),
    ("reddit", "https://www.reddit.com/user/{u}/about.json", ("status", 200)),
    ("medium", "https://medium.com/@{u}", ("status", 200)),
    ("hackernews", "https://hacker-news.firebaseio.com/v0/user/{u}.json", ("absent", "null")),
    ("instagram", "https://www.instagram.com/{u}/", ("status_not", 404)),
    ("tiktok", "https://www.tiktok.com/@{u}", ("status_not", 404)),
    ("keybase", "https://keybase.io/{u}", ("status", 200)),
    ("about_me", "https://about.me/{u}", ("status", 200)),
    ("pinterest", "https://www.pinterest.com/{u}/", ("status", 200)),
    ("soundcloud", "https://soundcloud.com/{u}", ("status", 200)),
    ("youtube", "https://www.youtube.com/@{u}", ("status", 200)),
    ("twitch", "https://www.twitch.tv/{u}", ("status_not", 404)),
    ("bitbucket", "https://bitbucket.org/{u}/", ("status", 200)),
    ("dev_to", "https://dev.to/{u}", ("status", 200)),
    ("steam", "https://steamcommunity.com/id/{u}", ("present", "profile_header")),
    ("mastodon_social", "https://mastodon.social/@{u}", ("status", 200)),
    ("bluesky", "https://bsky.app/profile/{u}.bsky.social", ("status", 200)),
    ("producthunt", "https://www.producthunt.com/@{u}", ("status", 200)),
    ("npm", "https://www.npmjs.com/~{u}", ("status", 200)),
    ("pypi", "https://pypi.org/user/{u}/", ("status", 200)),
    ("dockerhub", "https://hub.docker.com/u/{u}", ("status", 200)),
    ("stackoverflow", "https://stackoverflow.com/users/{u}", ("status_not", 404)),
]


def _match(rule: tuple, status: int, text: str) -> bool:
    kind, val = rule
    if kind == "status":
        return status == val
    if kind == "status_not":
        return status != val and 200 <= status < 400
    if kind == "absent":
        return 200 <= status < 300 and val not in (text or "")
    if kind == "present":
        return 200 <= status < 300 and val in (text or "")
    return False


def username_pivot(username: str, sites: list[str] | None = None) -> str:
    """Probe a username across 25+ popular platforms. Returns JSON {username, count_found, hits:[{site,url}], misses:[site]}.

    `sites` (optional) filters by site name (e.g. ["github","reddit"]).
    """
    u = _norm_username(username)
    if not u or not _USERNAME_RE.match(u):
        return f"ERREUR: invalid username '{username}'"
    selected = [s for s in _SITES if not sites or s[0] in sites]
    hits: list[dict] = []
    misses: list[str] = []
    errors: list[dict] = []
    for name, tmpl, rule in selected:
        url = tmpl.format(u=u)
        try:
            resp = _netcache.request("GET", url, timeout=10)
        except Exception as e:
            errors.append({"site": name, "error": str(e)[:80]})
            continue
        status = resp.get("status", 0)
        text = resp.get("text", "") or ""
        if _match(rule, status, text):
            hits.append({"site": name, "url": url, "status": status})
        else:
            misses.append(name)
    out = {
        "username": u,
        "count_checked": len(selected),
        "count_found": len(hits),
        "hits": hits,
        "misses": misses,
    }
    if errors:
        out["errors"] = errors
    return json.dumps(out, ensure_ascii=False, indent=2)


def reddit_user(username: str, limit: int = 10) -> str:
    """Reddit user profile + recent submissions via public JSON API."""
    u = _norm_username(username)
    if not u or not _USERNAME_RE.match(u):
        return f"ERREUR: invalid username '{username}'"
    about = _netcache.request("GET", f"https://www.reddit.com/user/{u}/about.json", timeout=15)
    if about.get("status") == 404:
        return f"OK: reddit user '{u}' not found"
    if about.get("status") != 200:
        return f"ERREUR: reddit about status={about.get('status')}"
    try:
        a = json.loads(about.get("text") or "{}").get("data", {})
    except Exception:
        a = {}
    posts = _netcache.request("GET", f"https://www.reddit.com/user/{u}/submitted.json?limit={limit}", timeout=15)
    submissions: list[dict] = []
    try:
        for c in json.loads(posts.get("text") or "{}").get("data", {}).get("children", []):
            d = c.get("data", {})
            submissions.append({
                "title": d.get("title"),
                "subreddit": d.get("subreddit"),
                "score": d.get("score"),
                "created_utc": d.get("created_utc"),
                "url": f"https://www.reddit.com{d.get('permalink', '')}",
            })
    except Exception:
        pass
    return json.dumps({
        "username": u,
        "profile_url": f"https://www.reddit.com/user/{u}",
        "karma": {"link": a.get("link_karma"), "comment": a.get("comment_karma")},
        "created_utc": a.get("created_utc"),
        "verified_email": a.get("has_verified_email"),
        "is_employee": a.get("is_employee"),
        "is_mod": a.get("is_mod"),
        "icon_img": a.get("icon_img"),
        "submission_count": len(submissions),
        "submissions": submissions,
    }, ensure_ascii=False, indent=2)


def hn_user(username: str) -> str:
    """Hacker News user profile via Firebase API (karma, about, created, submitted count)."""
    u = _norm_username(username)
    if not u or not _USERNAME_RE.match(u):
        return f"ERREUR: invalid username '{username}'"
    resp = _netcache.request("GET", f"https://hacker-news.firebaseio.com/v0/user/{u}.json", timeout=15)
    if resp.get("status") != 200:
        return f"ERREUR: HN status={resp.get('status')}"
    txt = (resp.get("text") or "").strip()
    if txt in ("", "null"):
        return f"OK: HN user '{u}' not found"
    try:
        d = json.loads(txt)
    except Exception as e:
        return f"ERREUR: HN parse failed: {e}"
    return json.dumps({
        "username": u,
        "profile_url": f"https://news.ycombinator.com/user?id={u}",
        "karma": d.get("karma"),
        "created": d.get("created"),
        "about": d.get("about"),
        "submission_count": len(d.get("submitted") or []),
    }, ensure_ascii=False, indent=2)


def github_user(username: str) -> str:
    """GitHub user profile + recent public repos via REST API (no auth)."""
    u = _norm_username(username)
    if not u or not _USERNAME_RE.match(u):
        return f"ERREUR: invalid username '{username}'"
    resp = _netcache.request("GET", f"https://api.github.com/users/{u}", timeout=15,
                             headers={"Accept": "application/vnd.github+json"})
    if resp.get("status") == 404:
        return f"OK: github user '{u}' not found"
    if resp.get("status") != 200:
        return f"ERREUR: github status={resp.get('status')}"
    try:
        d = json.loads(resp.get("text") or "{}")
    except Exception as e:
        return f"ERREUR: github parse failed: {e}"
    repos_resp = _netcache.request("GET", f"https://api.github.com/users/{u}/repos?sort=updated&per_page=10",
                                   timeout=15, headers={"Accept": "application/vnd.github+json"})
    repos: list[dict] = []
    try:
        for r in json.loads(repos_resp.get("text") or "[]"):
            repos.append({
                "name": r.get("name"),
                "url": r.get("html_url"),
                "description": r.get("description"),
                "language": r.get("language"),
                "stars": r.get("stargazers_count"),
                "updated_at": r.get("updated_at"),
                "fork": r.get("fork"),
            })
    except Exception:
        pass
    return json.dumps({
        "username": u,
        "profile_url": d.get("html_url"),
        "name": d.get("name"),
        "company": d.get("company"),
        "blog": d.get("blog"),
        "location": d.get("location"),
        "email": d.get("email"),
        "bio": d.get("bio"),
        "twitter": d.get("twitter_username"),
        "public_repos": d.get("public_repos"),
        "followers": d.get("followers"),
        "following": d.get("following"),
        "created_at": d.get("created_at"),
        "recent_repos": repos,
    }, ensure_ascii=False, indent=2)


def github_code_search(query: str, max_results: int = 10) -> str:
    """Search GitHub code via REST API. Unauthenticated → strict rate limit; results cached.

    Useful to find leaked emails, tokens, internal hostnames mentioned in public repos.
    """
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"
    url = f"https://api.github.com/search/code?q={quote_plus(q)}&per_page={min(max_results, 30)}"
    resp = _netcache.request("GET", url, timeout=20,
                             headers={"Accept": "application/vnd.github+json"})
    if resp.get("status") == 403:
        return "ERREUR: github rate-limited (unauthenticated). Try again later or narrow the query."
    if resp.get("status") == 422:
        return f"ERREUR: github 422 (invalid query). Note: code search requires at least one qualifier (e.g. 'extension:env')."
    if resp.get("status") != 200:
        return f"ERREUR: github status={resp.get('status')}"
    try:
        d = json.loads(resp.get("text") or "{}")
    except Exception as e:
        return f"ERREUR: github parse failed: {e}"
    items = []
    for it in (d.get("items") or [])[:max_results]:
        repo = (it.get("repository") or {}).get("full_name")
        items.append({
            "name": it.get("name"),
            "path": it.get("path"),
            "url": it.get("html_url"),
            "repo": repo,
        })
    return json.dumps({"query": q, "total": d.get("total_count", 0),
                       "count": len(items), "results": items},
                      ensure_ascii=False, indent=2)
