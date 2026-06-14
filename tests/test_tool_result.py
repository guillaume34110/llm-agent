"""Smoke tests for monkey/tools/result.py — typed tool result protocol."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monkey.tools.result import ok, err, is_ok, is_err, status_label, OK_PREFIX, ERR_PREFIX


def test_ok_format():
    r = ok("written /tmp/x")
    assert r.startswith(OK_PREFIX)
    assert is_ok(r)
    assert not is_err(r)


def test_err_format():
    r = err("file missing")
    assert r.startswith(ERR_PREFIX)
    assert is_err(r)
    assert not is_ok(r)


def test_status_label():
    assert status_label(ok("x")) == "OK"
    assert status_label(err("x")) == "ERREUR"
    assert status_label("hi there") == "hi there"
    assert len(status_label("a" * 200)) == 120
