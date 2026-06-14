"""Tests for monkey.tools.osint_notebook."""
from __future__ import annotations

from pathlib import Path

import pytest

from monkey.tools import osint_notebook as nb


@pytest.fixture(autouse=True)
def _isolated_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(nb, "NOTEBOOK_DIR", tmp_path / "osint")
    yield


def test_slug_normalizes():
    assert nb._slug("John Doe!") == "john-doe"
    assert nb._slug("  --x.y_z--  ") == "x.y_z"
    assert nb._slug("") == "untitled"


def test_note_creates_file_with_header():
    out = nb.osint_note("Jane Doe", "email", "jane@example.com")
    assert out.startswith("OK")
    p = nb._path("Jane Doe")
    assert p.exists()
    content = p.read_text()
    assert content.startswith("# OSINT — Jane Doe")
    assert "**email**: jane@example.com" in content


def test_note_appends_multiple():
    nb.osint_note("t", "a", "1")
    nb.osint_note("t", "b", "2")
    dumped = nb.osint_dump("t")
    assert "**a**: 1" in dumped and "**b**: 2" in dumped


def test_dump_empty():
    assert "empty notebook" in nb.osint_dump("nope")


def test_note_rejects_blank():
    assert nb.osint_note("", "k", "v").startswith("ERREUR")
    assert nb.osint_note("t", "", "v").startswith("ERREUR")


def test_list_counts_notes():
    nb.osint_note("alpha", "k1", "v1")
    nb.osint_note("alpha", "k2", "v2")
    nb.osint_note("beta", "k1", "v1")
    listing = nb.osint_list()
    assert "alpha (2 notes)" in listing
    assert "beta (1 notes)" in listing


def test_clear_one_topic():
    nb.osint_note("a", "k", "v")
    nb.osint_note("b", "k", "v")
    nb.osint_clear("a")
    assert not nb._path("a").exists()
    assert nb._path("b").exists()


def test_clear_all():
    nb.osint_note("a", "k", "v")
    nb.osint_note("b", "k", "v")
    out = nb.osint_clear()
    assert "2 cleared" in out
    assert not nb._path("a").exists() and not nb._path("b").exists()


def test_clear_missing_topic():
    out = nb.osint_clear("nope")
    assert "nothing to clear" in out
