"""Phase-1 anti-parasite filters for search_web.

Goal: drop off-context spam pages ("how to fix your mac", "réparer android", etc.)
when the user's query is unrelated.

Three orthogonal filters compose:
  1. SERP-feature blocks already stripped at scrape time (tested elsewhere).
  2. Domain blocklist — known SEO/repair farms hard-dropped.
  3. Relevance gate — token overlap between query and (title + snippet).
"""

from __future__ import annotations

import pytest

from monkey.tools.web import (
    _is_spam_domain,
    _query_tokens,
    _result_tokens,
    _has_min_overlap,
    _filter_results,
)


# ---- domain blocklist -------------------------------------------------------

SPAM_URLS = [
    "https://www.commentcamarche.net/applis-sites/macos/123-reparer-mac/",
    "https://malekal.com/comment-reparer-windows-10/",
    "https://www.softonic.com/articles/best-mac-cleaners",
    "https://fr.softonic.com/articles/reparer-android",
    "https://www.wikihow.com/Fix-a-Slow-Mac",
    "https://fr.wikihow.com/r%C3%A9parer-android",
    "https://iboysoft.com/wiki/repair-mac.html",
    "https://macpaw.com/how-to/fix-mac-running-slow",
    "https://www.easeus.com/computer-instruction/fix-android.html",
    "https://www.minitool.com/data-recovery/android-repair.html",
    "https://www.iolo.com/resources/articles/how-to-fix-windows-errors/",
    "https://www.auslogics.com/en/articles/fix-slow-pc/",
    "https://appletoolbox.com/fix-mac-wont-turn-on/",
    "https://www.fonepaw.com/tutorials/android-system-repair.html",
    "https://www.wondershare.com/repair/android-system-repair.html",
    "https://www.pcrisk.com/removal-guides/12345-mac-fix",
    "https://www.astuces-pratiques.fr/informatique/comment-reparer-mac",
    "https://www.01net.com/astuces/comment-reparer-windows-10",
    "https://m.malekal.com/reparer-mac",
    "https://www.MACPAW.com/how-to/fix-mac",
]


@pytest.mark.parametrize("url", SPAM_URLS)
def test_spam_domains_blocked(url: str):
    assert _is_spam_domain(url) is True, f"should be flagged spam: {url}"


CLEAN_URLS = [
    "https://www.apple.com/macbook-pro/",
    "https://developer.apple.com/documentation/swift",
    "https://docs.python.org/3/library/asyncio.html",
    "https://github.com/anthropic/anthropic-sdk-python",
    "https://stackoverflow.com/questions/12345/how-to-use-asyncio",
    "https://www.lemonde.fr/economie/article/2026/01/01/abc.html",
    "https://en.wikipedia.org/wiki/Apple_silicon",
    "https://www.anandtech.com/show/12345/apple-m4-review",
]


@pytest.mark.parametrize("url", CLEAN_URLS)
def test_clean_domains_not_blocked(url: str):
    assert _is_spam_domain(url) is False, f"should NOT be flagged: {url}"


def test_spam_domain_handles_malformed_url():
    assert _is_spam_domain("") is False
    assert _is_spam_domain("not-a-url") is False
    assert _is_spam_domain("https://") is False


# ---- token overlap ----------------------------------------------------------

def test_query_tokens_drops_stopwords_and_lowercases():
    tok = _query_tokens("Comment optimiser mon Mac M2 Pro")
    assert "comment" not in tok
    assert "mon" not in tok
    assert "optimiser" in tok
    assert "mac" in tok
    assert "m2" in tok
    assert "pro" in tok


def test_result_tokens_combines_title_and_snippet():
    r = {"title": "Apple Silicon Performance", "snippet": "Benchmark M2 results"}
    tok = _result_tokens(r)
    assert "apple" in tok
    assert "silicon" in tok
    assert "benchmark" in tok
    assert "m2" in tok


def test_has_min_overlap_relevant():
    q = _query_tokens("apple silicon m2 benchmark")
    r = _result_tokens({"title": "Apple M2 benchmark roundup", "snippet": "Silicon performance"})
    assert _has_min_overlap(q, r) is True


def test_has_min_overlap_off_context_dropped():
    """Query about silicon benchmark, result about repair → drop."""
    q = _query_tokens("apple silicon m2 benchmark")
    r = _result_tokens({"title": "How to fix your Mac when it's slow", "snippet": "Repair tips for macOS"})
    assert _has_min_overlap(q, r) is False


def test_has_min_overlap_single_platform_token_not_enough():
    """Only 'mac' in common is not enough to keep an off-context result."""
    q = _query_tokens("comment optimiser mon mac pour la photo lightroom")
    r = _result_tokens({"title": "Reparer un Mac lent", "snippet": "Astuces depannage Mac"})
    # Both share 'mac' but nothing else relevant — drop.
    assert _has_min_overlap(q, r) is False


# ---- end-to-end filter ------------------------------------------------------

def test_filter_results_drops_spam_and_off_context():
    query = "apple silicon m2 benchmark"
    raw = [
        {"title": "Apple M2 benchmark vs M1", "url": "https://www.anandtech.com/m2", "snippet": "Silicon perf"},
        {"title": "How to fix your slow Mac", "url": "https://macpaw.com/fix-mac", "snippet": "Repair Mac"},
        {"title": "Reparer android lent", "url": "https://malekal.com/android", "snippet": "Comment depanner"},
        {"title": "M2 benchmark details", "url": "https://github.com/foo/m2-bench", "snippet": "Apple silicon scores"},
        {"title": "", "url": "", "snippet": ""},  # malformed
        {"error": "boom"},
    ]
    out = _filter_results(query, raw)
    urls = [r["url"] for r in out]
    assert "https://www.anandtech.com/m2" in urls
    assert "https://github.com/foo/m2-bench" in urls
    assert "https://macpaw.com/fix-mac" not in urls  # spam domain
    assert "https://malekal.com/android" not in urls  # spam domain + off context
    assert "" not in urls
    assert all(not r.get("error") for r in out)


def test_filter_results_preserves_order_of_kept():
    query = "rust async tokio runtime"
    raw = [
        {"title": "Tokio runtime guide", "url": "https://tokio.rs/guide", "snippet": "Rust async runtime"},
        {"title": "How to fix windows", "url": "https://iboysoft.com/fix", "snippet": "Repair PC"},
        {"title": "Async Rust book", "url": "https://rust-lang.github.io/async-book/", "snippet": "Tokio async"},
    ]
    out = _filter_results(query, raw)
    assert [r["url"] for r in out] == [
        "https://tokio.rs/guide",
        "https://rust-lang.github.io/async-book/",
    ]


def test_filter_results_empty_query_keeps_non_spam():
    """Empty/garbage query → overlap gate disabled, only domain blocklist applies."""
    raw = [
        {"title": "Apple M2", "url": "https://apple.com", "snippet": ""},
        {"title": "Fix mac", "url": "https://macpaw.com/fix", "snippet": ""},
    ]
    out = _filter_results("", raw)
    urls = [r["url"] for r in out]
    assert "https://apple.com" in urls
    assert "https://macpaw.com/fix" not in urls
