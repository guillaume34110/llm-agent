"""Conditional report: the task always runs, but the WA notify only fires
when the post-run YES/NO check returns YES.

Result is always persisted in runHistory — only the auto_notify is gated.
"""
import datetime as dt

import pytest

from monkey import scheduler as scheduler_mod
from monkey.scheduler import tick
from monkey.tasks_store import TaskStore


def _iso(when: dt.datetime) -> str:
    return when.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def test_normalize_defaults_report_always(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    task = store.create_task({
        "title": "plain",
        "scheduledFor": "2026-05-25T10:00",
        "agentPrompt": "do stuff",
        "modelId": "test/model",
    })
    assert task["reportMode"] == "always"
    assert task["reportCondition"] is None


def test_normalize_conditional_requires_report_condition(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    with pytest.raises(ValueError, match="reportCondition required"):
        store.create_task({
            "title": "x",
            "scheduledFor": "2026-05-25T10:00",
            "agentPrompt": "p",
            "modelId": "test/model",
            "reportMode": "conditional",
        })


def test_normalize_rejects_invalid_report_mode(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    with pytest.raises(ValueError, match="reportMode invalide"):
        store.create_task({
            "title": "x",
            "scheduledFor": "2026-05-25T10:00",
            "agentPrompt": "p",
            "modelId": "test/model",
            "reportMode": "garbage",
        })


def test_normalize_conditional_carries_report_condition(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    task = store.create_task({
        "title": "btc",
        "scheduledFor": "2026-05-25T10:00",
        "agentPrompt": "fetch btc situation",
        "modelId": "test/model",
        "reportMode": "conditional",
        "reportCondition": "BTC dropped more than 5% in 24h",
    })
    assert task["reportMode"] == "conditional"
    assert task["reportCondition"] == "BTC dropped more than 5% in 24h"
    updated = store.update_task(task["id"], {"details": "more"})
    assert updated["reportMode"] == "conditional"
    assert updated["reportCondition"] == "BTC dropped more than 5% in 24h"


def test_tick_conditional_NO_runs_task_but_suppresses_notify(monkeypatch, tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "watch",
        "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "MAIN_PROMPT",
        "modelId": "test/model",
        "reportMode": "conditional",
        "reportCondition": "BTC dropped 5%",
    })
    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        if prompt == "MAIN_PROMPT":
            return "btc is flat today, nothing weird"
        return "NO"  # check prompt verdict

    notify_calls: list[tuple] = []
    monkeypatch.setattr(scheduler_mod, "_auto_notify", lambda t, r: notify_calls.append((t["id"], r)))

    processed = tick(store, fake_agent, now=now)
    # main prompt ran AND check prompt ran (2 calls)
    assert len(calls) == 2
    assert calls[0] == "MAIN_PROMPT"
    assert "BTC dropped 5%" in calls[1]
    assert "btc is flat today" in calls[1]  # check sees the result
    # no notify
    assert notify_calls == []
    # result still stored, annotated
    assert processed[0]["status"] == "done"
    assert "[report suppressed" in processed[0]["runResult"]
    assert "btc is flat today" in processed[0]["runResult"]


def test_tick_conditional_YES_notifies_normally(monkeypatch, tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "alert",
        "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "MAIN_PROMPT",
        "modelId": "test/model",
        "reportMode": "conditional",
        "reportCondition": "BTC dropped 5%",
    })
    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        if prompt == "MAIN_PROMPT":
            return "BTC at 50k, down 12% from yesterday"
        return "YES"

    notify_calls: list[str] = []
    monkeypatch.setattr(scheduler_mod, "_auto_notify", lambda t, r: notify_calls.append(r))

    processed = tick(store, fake_agent, now=now)
    assert len(calls) == 2
    assert notify_calls == ["BTC at 50k, down 12% from yesterday"]
    # runResult not annotated when condition met
    assert processed[0]["runResult"] == "BTC at 50k, down 12% from yesterday"
    assert "[report suppressed" not in processed[0]["runResult"]


def test_tick_conditional_check_exception_suppresses_notify(monkeypatch, tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "safe",
        "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "MAIN_PROMPT",
        "modelId": "test/model",
        "reportMode": "conditional",
        "reportCondition": "checker broken",
    })

    def fake_agent(prompt: str, _task) -> str:
        if prompt == "MAIN_PROMPT":
            return "result"
        raise RuntimeError("kaboom in check")

    notify_calls: list[str] = []
    monkeypatch.setattr(scheduler_mod, "_auto_notify", lambda t, r: notify_calls.append(r))

    processed = tick(store, fake_agent, now=now)
    # Check failure → treat as NO → no notify, result still stored.
    assert notify_calls == []
    assert processed[0]["status"] == "done"
    assert "[report suppressed" in processed[0]["runResult"]


def test_tick_always_mode_notifies_without_check(monkeypatch, tmp_path):
    """reportMode=always → no check prompt, single run + notify."""
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "plain",
        "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "MAIN_PROMPT",
        "modelId": "test/model",
    })
    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        return "ok"

    notify_calls: list[str] = []
    monkeypatch.setattr(scheduler_mod, "_auto_notify", lambda t, r: notify_calls.append(r))

    processed = tick(store, fake_agent, now=now)
    assert calls == ["MAIN_PROMPT"]
    assert notify_calls == ["ok"]
    assert processed[0]["runResult"] == "ok"


def test_tick_main_failure_skips_condition_check(monkeypatch, tmp_path):
    """If the main run errors, no condition check runs and no notify fires."""
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "boom",
        "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "MAIN_PROMPT",
        "modelId": "test/model",
        "reportMode": "conditional",
        "reportCondition": "whatever",
    })
    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        raise RuntimeError("main kaboom")

    notify_calls: list = []
    monkeypatch.setattr(scheduler_mod, "_auto_notify", lambda t, r: notify_calls.append(r))

    processed = tick(store, fake_agent, now=now)
    # only main prompt was attempted, no check
    assert calls == ["MAIN_PROMPT"]
    assert notify_calls == []
    assert processed[0]["status"] == "cancelled"
    assert processed[0]["runResult"].startswith("ERREUR:")
