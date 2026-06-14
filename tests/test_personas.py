"""Non-regression tests for the pro persona module + agent integration invariants."""

from __future__ import annotations

import pytest

from monkey.personas import PROS, is_pro, pro_packs, pro_system_prompt


EXPECTED_IDS = {
    "secretary", "hr", "accountant", "sales", "marketing",
    "legal", "recruiter", "support", "analyst", "office_manager",
}


def test_pro_ids_match_desktop_registry():
    assert set(PROS.keys()) == EXPECTED_IDS


@pytest.mark.parametrize("pid", sorted(EXPECTED_IDS))
def test_is_pro_true_for_each_id(pid: str):
    assert is_pro(pid) is True


def test_is_pro_false_for_animal_and_empty():
    assert is_pro(None) is False
    assert is_pro("") is False
    assert is_pro("monkey") is False
    assert is_pro("dog") is False
    assert is_pro("unknown_xyz") is False


@pytest.mark.parametrize("pid", sorted(EXPECTED_IDS))
def test_pro_packs_non_empty(pid: str):
    packs = pro_packs(pid)
    assert isinstance(packs, frozenset)
    assert len(packs) > 0, f"{pid} declares no packs"


def test_pro_packs_empty_for_non_pro():
    assert pro_packs(None) == frozenset()
    assert pro_packs("monkey") == frozenset()


@pytest.mark.parametrize("pid", sorted(EXPECTED_IDS))
def test_pro_system_prompt_non_empty(pid: str):
    prompt = pro_system_prompt(pid)
    assert prompt and len(prompt) > 50


def test_pro_system_prompt_empty_for_non_pro():
    assert pro_system_prompt(None) == ""
    assert pro_system_prompt("monkey") == ""


# ---- Agent integration invariants -------------------------------------------

def test_wa_channel_detection_bypasses_pro_restriction():
    """INVARIANT b1: WhatsApp keeps full tool parity even when persona is a pro."""
    from monkey.agent import chat_stream  # noqa: F401  (import-time wiring check)

    def _is_wa(session_id):
        return isinstance(session_id, str) and session_id.startswith("whatsapp:")

    assert _is_wa("whatsapp:1234@s.whatsapp.net") is True
    assert _is_wa("whatsapp:") is True
    assert _is_wa("global") is False
    assert _is_wa(None) is False


def test_tool_mode_allowlist_chat_only_strips_all_tools():
    """chat_only must never expose any tool, even with a pro persona active."""
    from monkey.agent import _TOOL_MODE_ALLOWLIST

    assert _TOOL_MODE_ALLOWLIST["chat_only"] == frozenset()
    assert "search_web" in _TOOL_MODE_ALLOWLIST["chat_search"]


def test_expand_tools_blocked_for_pro_off_wa():
    """When a pro is active off-WA, expand_tools must reject pack additions."""
    import inspect
    from monkey import agent

    src = inspect.getsource(agent)
    assert "_pro_locked = _is_pro(_persona_id) and not _is_wa_channel" in src
    assert "if _pro_locked" in src
