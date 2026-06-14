"""OSINT-grade search helpers: dork query builder + multi-engine RRF merge.

`osint_dorks` returns a curated list of Google dork queries tailored to the
investigation target (person, handle, domain, email). The agent then runs
each query via `search_web`. Saves the LLM from re-inventing dorks every run.

`multi_engine_search` runs the same query against Google, DDG, and Bing
through the stealth browser and fuses the results with Reciprocal Rank
Fusion (k=60). Cross-engine fusion surfaces consensus and catches sources
one engine missed.
"""
from __future__ import annotations

import json
import re
from typing import Iterable
from urllib.parse import quote_plus, urlparse


def _is_email(s: str) -> bool:
    return bool(re.match(r"^[\w.+-]+@[\w-]+\.[\w.-]+$", s))


def _is_domain(s: str) -> bool:
    return bool(re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$", s))


def _is_handle(s: str) -> bool:
    return bool(re.match(r"^@?[A-Za-z0-9_.\-]{2,40}$", s)) and "@" not in s.replace("@", "", 1) and "." not in s.lstrip("@")


def _quoted(s: str) -> str:
    s = s.strip()
    return f'"{s}"' if " " in s else s


# Curated dorks — top-signal only. Agent ran 12-15 dorks back-to-back which
# trips search engines into bot-block. Keep the 5-6 highest-yield per kind;
# agent can extend on a second pass if the first round is thin.
_PERSON_DORKS = [
    'site:linkedin.com/in {q}',
    'site:github.com {q}',
    'site:twitter.com {q} OR site:x.com {q}',
    '{q} filetype:pdf',
    '{q} cv OR resume OR "curriculum vitae"',
    '{q} email OR contact',
]

_HANDLE_DORKS = [
    'site:twitter.com/{t}',
    'site:github.com/{t}',
    'site:reddit.com/user/{t}',
    'site:instagram.com/{t}',
    'site:keybase.io/{t}',
    'intext:"@{t}"',
]

_DOMAIN_DORKS = [
    'site:{t}',
    'site:{t} filetype:pdf',
    'site:{t} (login OR admin OR portal OR dashboard)',
    'site:{t} intitle:"index of"',
    '"{t}" -site:{t}',
    'site:web.archive.org {t}',
]

_EMAIL_DORKS = [
    '"{t}"',
    '"{t}" site:github.com',
    '"{t}" site:linkedin.com',
    '"{t}" filetype:pdf',
    '"{t}" leak OR breach OR dump',
]


def osint_dorks(target: str, kinds: list[str] | None = None) -> str:
    """Build a curated list of search dorks for an OSINT target.

    Auto-detects target kind (person / handle / domain / email) unless `kinds`
    explicitly lists which dork sets to include. Returns JSON with grouped queries.
    """
    t = (target or "").strip()
    if not t:
        return "ERREUR: target required"
    auto: list[str] = []
    if _is_email(t):
        auto.append("email")
    elif _is_domain(t):
        auto.append("domain")
    elif " " in t:
        auto.append("person")
    elif _is_handle(t):
        auto.append("handle")
    else:
        auto.append("person")
    selected = [k.lower() for k in kinds] if kinds else auto

    q = _quoted(t)
    handle_tok = t.lstrip("@")
    out: dict[str, list[str]] = {}
    if "person" in selected:
        out["person"] = [d.format(t=t, q=q) for d in _PERSON_DORKS]
    if "handle" in selected:
        out["handle"] = [d.format(t=handle_tok, q=q) for d in _HANDLE_DORKS]
    if "domain" in selected:
        out["domain"] = [d.format(t=t, q=q) for d in _DOMAIN_DORKS]
    if "email" in selected:
        out["email"] = [d.format(t=t, q=q) for d in _EMAIL_DORKS]

    total = sum(len(v) for v in out.values())
    return json.dumps({"target": t, "detected": auto, "count": total, "dorks": out},
                      ensure_ascii=False, indent=2)


def _normalize_url(u: str) -> str:
    try:
        p = urlparse(u)
        host = (p.netloc or "").lower().lstrip("www.")
        path = re.sub(r"/+$", "", p.path or "")
        return f"{p.scheme or 'https'}://{host}{path}"
    except Exception:
        return u.strip().rstrip("/").lower()


def rrf_merge(rankings: dict[str, list[dict]], k: int = 60, top_n: int = 20) -> list[dict]:
    """Reciprocal Rank Fusion. `rankings` = {engine: [results]} where each
    result has a `url`. Score = sum_e 1/(k + rank_e). Returns dedupe results
    sorted by fused score (descending), with `engines` and `score` fields added.
    """
    scores: dict[str, float] = {}
    best: dict[str, dict] = {}
    seen_engines: dict[str, set[str]] = {}
    for engine, results in rankings.items():
        for rank, r in enumerate(results, start=1):
            url = r.get("url")
            if not url:
                continue
            key = _normalize_url(url)
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
            seen_engines.setdefault(key, set()).add(engine)
            if key not in best:
                best[key] = dict(r)
    fused = []
    for key, score in sorted(scores.items(), key=lambda x: -x[1])[:top_n]:
        item = dict(best[key])
        item["score"] = round(score, 6)
        item["engines"] = sorted(seen_engines[key])
        fused.append(item)
    return fused


def multi_engine_search(query: str, max_results: int = 5) -> str:
    """Run the query against Google, DuckDuckGo and Bing via the stealth browser
    in sequence, then RRF-merge. Returns JSON {query, engines_used, results}.
    Each result carries the engines that returned it and the fused score.
    """
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"

    from monkey._browser_loop import run as _run
    from monkey.tools.web import _parse_ddg_html, _rewrite_query  # reuse parsers
    from bs4 import BeautifulSoup

    rewritten = _rewrite_query(q)
    q_enc = quote_plus(rewritten)

    try:
        from monkey.browser import get_browser
        browser = get_browser()

        async def _go(url: str) -> str:
            await browser._ensure_started()
            await browser._page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await browser._page.wait_for_timeout(700)
            return await browser._page.content()
    except Exception as e:
        return f"ERREUR: browser unavailable: {e}"

    rankings: dict[str, list[dict]] = {}

    import random as _rand
    import time as _time

    # Google
    try:
        html = _run(_go(f"https://www.google.com/search?q={q_enc}&num={max_results + 5}"), timeout=30)
        soup = BeautifulSoup(html, "html.parser")
        rows: list[dict] = []
        for block in soup.select("div.g, div.tF2Cxc, div.MjjYud")[:max_results * 2]:
            a = block.select_one("a[href]")
            if not a: continue
            href = a.get("href", "")
            if href.startswith("/url?"):
                from urllib.parse import parse_qs
                href = parse_qs(urlparse(href).query).get("q", [""])[0]
            if not href.startswith("http") or "google.com" in href:
                continue
            h3 = block.select_one("h3")
            snip = block.select_one("div.VwiC3b, span.aCOpRe, div.IsZvec")
            rows.append({"title": (h3.get_text(strip=True) if h3 else "")[:200],
                         "url": href,
                         "snippet": snip.get_text(" ", strip=True) if snip else ""})
            if len(rows) >= max_results: break
        if rows: rankings["google"] = rows
    except Exception:
        pass

    # DuckDuckGo
    _time.sleep(_rand.uniform(3.0, 6.0))
    try:
        html = _run(_go(f"https://html.duckduckgo.com/html/?q={q_enc}"), timeout=30)
        rows = _parse_ddg_html(html, max_results)
        if rows: rankings["duckduckgo"] = rows
    except Exception:
        pass

    # Bing
    _time.sleep(_rand.uniform(3.0, 6.0))
    try:
        html = _run(_go(f"https://www.bing.com/search?q={q_enc}"), timeout=30)
        soup = BeautifulSoup(html, "html.parser")
        rows = []
        for li in soup.select("li.b_algo")[:max_results]:
            a = li.select_one("h2 a")
            sn = li.select_one(".b_caption p")
            if a and a.get("href"):
                rows.append({"title": a.get_text(strip=True),
                             "url": a["href"],
                             "snippet": sn.get_text(strip=True) if sn else ""})
        if rows: rankings["bing"] = rows
    except Exception:
        pass

    fused = rrf_merge(rankings, top_n=max_results)
    return json.dumps({"query": rewritten,
                       "engines_used": sorted(rankings.keys()),
                       "count": len(fused),
                       "results": fused}, ensure_ascii=False, indent=2)
