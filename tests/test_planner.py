"""Unit tests for monkey.planner (decomposition gate + execute + reduce)."""

from __future__ import annotations

import os
import time

import pytest

from monkey import planner


@pytest.fixture(autouse=True)
def _enable_flag(monkeypatch):
    monkeypatch.setenv("MONKEY_DECOMPOSE", "1")


def _llm_returning(text: str):
    def _call(_msgs, _model, _tools):
        return {"text": text}
    return _call


# ── is_enabled / should_attempt ──────────────────────────────────────────


def test_is_enabled_respects_flag(monkeypatch):
    monkeypatch.setenv("MONKEY_DECOMPOSE", "0")
    assert planner.is_enabled() is False
    monkeypatch.setenv("MONKEY_DECOMPOSE", "1")
    assert planner.is_enabled() is True


def test_should_attempt_excludes_chat():
    assert planner.should_attempt("chat") is False
    assert planner.should_attempt("code") is True
    assert planner.should_attempt("orchestrate") is True
    assert planner.should_attempt("search") is True


def test_should_attempt_off_when_flag_off(monkeypatch):
    monkeypatch.setenv("MONKEY_DECOMPOSE", "0")
    assert planner.should_attempt("code") is False


# ── plan() ────────────────────────────────────────────────────────────────


def test_plan_parses_strict_json():
    llm = _llm_returning(
        '{"subtasks":["Fetch A","Summarize B"],"reducer":"merge"}'
    )
    out = planner.plan("compare A and B", llm, None)
    assert out == {"subtasks": ["Fetch A", "Summarize B"], "reducer": "merge"}


def test_plan_extracts_json_from_prose():
    llm = _llm_returning(
        'sure here:\n{"subtasks":["Do X","Do Y"],"reducer":"combine"}\nhope this helps'
    )
    out = planner.plan("x and y", llm, None)
    assert out is not None
    assert out["subtasks"] == ["Do X", "Do Y"]


def test_plan_returns_none_for_single_subtask():
    llm = _llm_returning('{"subtasks":["Do one thing"],"reducer":"x"}')
    assert planner.plan("hi", llm, None) is None


def test_plan_returns_none_for_empty_subtasks():
    llm = _llm_returning('{"subtasks":[],"reducer":""}')
    assert planner.plan("hi", llm, None) is None


def test_plan_caps_subtasks_at_max():
    subs = [f"task {i}" for i in range(20)]
    import json as _json
    payload = _json.dumps({"subtasks": subs, "reducer": "r"})
    out = planner.plan("x", _llm_returning(payload), None)
    assert out is not None
    assert len(out["subtasks"]) == planner.MAX_SUBTASKS


def test_plan_rejects_oversized_budget():
    big = "x" * (planner.MAX_TOTAL_SUBTASK_CHARS + 100)
    import json as _json
    payload = _json.dumps({"subtasks": [big, "ok"], "reducer": "r"})
    assert planner.plan("x", _llm_returning(payload), None) is None


def test_plan_returns_none_on_llm_exception():
    def _boom(_m, _md, _t):
        raise RuntimeError("upstream dead")
    assert planner.plan("x", _boom, None) is None


def test_plan_returns_none_on_garbage_text():
    assert planner.plan("x", _llm_returning("totally not json"), None) is None


# ── execute() ─────────────────────────────────────────────────────────────


def test_execute_runs_subtasks_in_parallel():
    seen_contexts: list[str] = []
    seen_lock = __import__("threading").Lock()

    def _agent(task: str, ctx: str) -> str:
        with seen_lock:
            seen_contexts.append(ctx)
        time.sleep(0.05)
        return f"done:{task}"

    t0 = time.time()
    results = planner.execute(["a", "b", "c", "d"], _agent, context="ctx-shared")
    elapsed = time.time() - t0
    # If serial, would be >= 0.2s; parallel comfortably under 0.15s.
    assert elapsed < 0.15
    assert all(r["ok"] for r in results)
    assert [r["result"] for r in results] == ["done:a", "done:b", "done:c", "done:d"]
    assert seen_contexts == ["ctx-shared"] * 4


def test_execute_captures_worker_exception():
    def _agent(task: str, _ctx: str) -> str:
        if task == "boom":
            raise ValueError("nope")
        return "ok"

    results = planner.execute(["ok-task", "boom"], _agent)
    assert results[0]["ok"] is True
    assert results[1]["ok"] is False
    assert "nope" in results[1]["result"]


def test_ok_ratio_math():
    assert planner.ok_ratio([]) == 0.0
    assert planner.ok_ratio([{"ok": True}, {"ok": True}]) == 1.0
    assert planner.ok_ratio([{"ok": True}, {"ok": False}]) == 0.5


# ── reduce() ──────────────────────────────────────────────────────────────


def test_reduce_passes_results_to_llm():
    captured: dict = {}

    def _llm(messages, _model, _tools):
        captured["msgs"] = messages
        return {"text": "final answer"}

    out = planner.reduce(
        "what is the weather?",
        "combine forecasts",
        [
            {"task": "fetch paris", "ok": True, "result": "sunny"},
            {"task": "fetch lyon", "ok": False, "result": "timeout"},
        ],
        _llm,
        None,
    )
    assert out == "final answer"
    user_content = captured["msgs"][1]["content"]
    assert "what is the weather?" in user_content
    assert "combine forecasts" in user_content
    assert "sunny" in user_content
    assert "(OK)" in user_content and "(FAIL)" in user_content


def test_reduce_swallows_llm_exception():
    def _boom(_m, _md, _t):
        raise RuntimeError("upstream dead")
    out = planner.reduce("q", "r", [{"task": "t", "ok": True, "result": "x"}], _boom, None)
    assert out.startswith("reduce failed")
