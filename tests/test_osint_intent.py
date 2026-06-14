"""Tests for OSINT protocol injection + tool pack selection."""
from __future__ import annotations

from monkey import agent as ag


def _proto(intent: str, msg: str) -> str:
    return ag._select_protocols(intent, msg)


def test_protocols_disabled_returns_empty():
    # Disabled 2026-05-28: protocol injection was degrading small models.
    # Tool schema descriptions now carry the guidance instead.
    assert _proto("search", "fais une enquête OSINT sur Jean Dupont") == ""
    assert _proto("search", "recette de tarte aux pommes") == ""


def test_osint_pack_triggered_by_keyword():
    packs = ag._select_packs("search", "do a whois lookup on acme.com", session_id=None)
    assert "osint" in packs


def test_osint_pack_triggered_by_at_handle():
    packs = ag._select_packs("search", "find info about @notreal_handle", session_id=None)
    assert "osint" in packs


def test_osint_pack_not_triggered_by_email():
    # @ in email must NOT light up osint
    packs = ag._select_packs("search", "send a mail to john@example.com", session_id=None)
    assert "osint" not in packs


def test_osint_notebook_tools_in_osint_category():
    assert ag._TOOL_CATEGORIES["osint_note"] == "osint"
    assert ag._TOOL_CATEGORIES["osint_dump"] == "osint"
    assert ag._TOOL_CATEGORIES["osint_list"] == "osint"
    assert ag._TOOL_CATEGORIES["osint_clear"] == "osint"
