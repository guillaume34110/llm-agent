"""S9 — OSINT pack wiring + citation guard.

Asserts every new OSINT tool is in the registry under the 'osint' category,
the protocol surfaces them by name, and citation_check flags unsourced drafts.
"""
from __future__ import annotations

import json

from monkey import agent as ag
from monkey.tools import osint_notebook as nb


# --- Citation guard -----------------------------------------------------------

def test_citation_check_empty():
    out = json.loads(nb.osint_citation_check(""))
    assert out["ok"] is False
    assert "empty draft" in out["warnings"]


def test_citation_check_no_urls():
    draft = "Alice Dupont, born 1985, lives in Paris. Works at ACME. Brother Bob."
    out = json.loads(nb.osint_citation_check(draft))
    assert out["ok"] is False
    assert out["url_count"] == 0


def test_citation_check_many_lines_no_urls():
    draft = "\n".join(f"- claim {i}" for i in range(10))
    out = json.loads(nb.osint_citation_check(draft))
    assert out["ok"] is False
    assert any("unsourced" in w for w in out["warnings"])


def test_citation_check_ok_with_url():
    draft = "Alice lives in Paris. Source: https://example.com/alice"
    out = json.loads(nb.osint_citation_check(draft))
    assert out["ok"] is True
    assert out["url_count"] == 1
    assert "https://example.com/alice" in out["urls"]


def test_citation_check_dedups_urls():
    draft = "see https://a.com/x and https://a.com/x and https://b.com"
    out = json.loads(nb.osint_citation_check(draft))
    assert out["url_count"] == 2


def test_citation_check_min_urls_threshold():
    draft = "Source: https://example.com"
    out = json.loads(nb.osint_citation_check(draft, min_urls=3))
    assert out["ok"] is False
    assert "expected at least 3" in out["warnings"][0]


# --- Wiring registry ----------------------------------------------------------

OSINT_TOOLS = {
    # notebook + guard
    "osint_note", "osint_dump", "osint_list", "osint_clear", "osint_citation_check",
    # intel
    "whois_lookup", "dns_records", "subdomain_enum", "wayback_snapshots",
    "gravatar_lookup", "hibp_password_check", "phone_parse", "http_headers",
    # search
    "osint_dorks", "multi_engine_search",
    # social
    "username_pivot", "reddit_user", "hn_user", "github_user", "github_code_search",
    # image
    "exif_extract", "image_phash", "reverse_image_urls",
    # geo / entities
    "nominatim_geocode", "nominatim_reverse", "gdelt_search",
    "recherche_entreprises", "wikidata_search",
}


def test_all_osint_tools_in_category_map():
    missing = [t for t in OSINT_TOOLS if ag._TOOL_CATEGORIES.get(t) != "osint"]
    assert not missing, f"not in osint category: {missing}"


def test_all_osint_tools_have_tool_def():
    defined = {t["function"]["name"] for t in ag.TOOLS}
    missing = sorted(OSINT_TOOLS - defined)
    assert not missing, f"missing tool defs: {missing}"


# --- OSINT pack triggers ------------------------------------------------------

def test_osint_pack_triggered_by_wayback():
    packs = ag._select_packs("search", "look at the wayback for example.com", session_id=None)
    assert "osint" in packs


def test_osint_pack_triggered_by_subdomain():
    packs = ag._select_packs("search", "find subdomain of acme.com", session_id=None)
    assert "osint" in packs
