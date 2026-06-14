"""Test the agent's list/update/cancel/history task tools."""
import datetime as dt
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monkey.tasks_store import TaskStore


def _future_iso(minutes: int = 60) -> str:
    return (dt.datetime.now() + dt.timedelta(minutes=minutes)).replace(second=0, microsecond=0).isoformat(timespec="minutes")


def _seed(store: TaskStore, **overrides):
    payload = {
        "title": "Daily brief",
        "scheduledFor": _future_iso(60),
        "agentPrompt": "Summarize my emails",
        "modelId": "test/model",
        "source": "agent-scheduled",
    }
    payload.update(overrides)
    return store.create_task(payload)


def test_tools_registered():
    from monkey import agent
    for n in ("list_agent_tasks", "update_agent_task", "cancel_agent_task", "get_task_history"):
        assert n in agent.TOOL_NAMES


def test_list_agent_tasks_active(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    t = _seed(store, title="oneoff")
    rec_t = _seed(store, title="loop", recurrence="FREQ=WEEKLY;BYDAY=MO")
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("list_agent_tasks", {})
        rec = agent._dispatch_tool("list_agent_tasks", {"filter": "recurring"})
    assert out.startswith("OK:")
    assert "oneoff" in out and "loop" in out
    assert t["id"][:8] in out
    assert "loop" in rec and "oneoff" not in rec
    assert rec_t["id"][:8] in rec
    assert "rrule=FREQ=WEEKLY" in rec


def test_update_agent_task_changes_fields(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    t = _seed(store)
    new_when = _future_iso(120)
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("update_agent_task", {
            "id": t["id"][:8],
            "title": "Renamed",
            "scheduled_for": new_when,
            "prompt": "New prompt",
            "mode": "alert",
        })
    assert out.startswith("OK:")
    refreshed = store.get_task(t["id"])
    assert refreshed["title"] == "Renamed"
    assert refreshed["agentPrompt"] == "New prompt"
    assert refreshed["mode"] == "alert"
    assert refreshed["scheduledFor"].startswith(new_when[:10])


def test_update_agent_task_clear_recurrence(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    t = _seed(store, recurrence="FREQ=DAILY")
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("update_agent_task", {"id": t["id"], "recurrence": ""})
    assert out.startswith("OK:")
    assert not store.get_task(t["id"]).get("recurrence")


def test_update_agent_task_unknown_id(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("update_agent_task", {"id": "deadbeef", "title": "x"})
    assert out.startswith("ERREUR:")


def test_cancel_agent_task_deletes(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    t = _seed(store)
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("cancel_agent_task", {"id": t["id"][:8]})
    assert out.startswith("OK:")
    assert store.list_tasks() == []


def test_get_task_history_empty_and_with_runs(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    t = _seed(store)
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        empty = agent._dispatch_tool("get_task_history", {"id": t["id"]})
    assert empty.startswith("OK:") and "no history" in empty

    store.update_task(t["id"], {"runHistory": [
        {"ok": True, "finishedAt": "2025-01-01T09:00:00", "result": "all good"},
        {"ok": False, "finishedAt": "2025-01-02T09:00:00", "result": "boom"},
    ]})
    with patch.object(main_mod, "TASK_STORE", store):
        out = agent._dispatch_tool("get_task_history", {"id": t["id"], "limit": 5})
    assert "OK" in out and "FAIL" in out and "boom" in out and "all good" in out
