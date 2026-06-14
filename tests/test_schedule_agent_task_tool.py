"""Test the agent's `schedule_agent_task` tool dispatcher."""
import datetime as dt
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monkey.tasks_store import TaskStore


def _future_iso(minutes: int = 30) -> str:
    return (dt.datetime.now() + dt.timedelta(minutes=minutes)).replace(second=0, microsecond=0).isoformat(timespec="minutes")


def test_schedule_agent_task_creates_row(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store), \
         patch.object(agent, "_CURRENT_MODEL_ID", "test/model"):
        out = agent._dispatch_tool("schedule_agent_task", {
            "title": "Daily brief",
            "scheduled_for": _future_iso(60),
            "prompt": "Summarize my emails",
            "details": "auto",
        })
    assert out.startswith("OK:")
    tasks = store.list_tasks()
    assert len(tasks) == 1
    t = tasks[0]
    assert t["title"] == "Daily brief"
    assert t["agentPrompt"] == "Summarize my emails"
    assert t["source"] == "agent-scheduled"
    assert t["modelId"] == "test/model"


def test_schedule_agent_task_does_not_persist_chat_tool_restriction(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store), \
         patch.object(agent, "_CURRENT_MODEL_ID", "test/model"), \
         patch.object(agent, "_CURRENT_TOOL_MODE", "chat_only"):
        out = agent._dispatch_tool("schedule_agent_task", {
            "title": "Send image later",
            "scheduled_for": _future_iso(60),
            "prompt": "Generate and send an image update",
        })
    assert out.startswith("OK:")
    tasks = store.list_tasks()
    assert len(tasks) == 1
    assert tasks[0].get("toolMode") is None


def test_schedule_agent_task_validates_inputs(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store):
        missing = agent._dispatch_tool("schedule_agent_task", {
            "title": "x", "scheduled_for": "", "prompt": "p",
        })
        bad_date = agent._dispatch_tool("schedule_agent_task", {
            "title": "x", "scheduled_for": "not-a-date", "prompt": "p",
        })
    assert missing.startswith("ERREUR:")
    assert bad_date.startswith("ERREUR:")
    assert store.list_tasks() == []


def test_schedule_agent_task_rejects_when_no_current_model(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    from monkey import agent, main as main_mod
    with patch.object(main_mod, "TASK_STORE", store), \
         patch.object(agent, "_CURRENT_MODEL_ID", None):
        out = agent._dispatch_tool("schedule_agent_task", {
            "title": "x", "scheduled_for": _future_iso(60), "prompt": "p",
        })
    assert out.startswith("ERREUR:") and "modelId" in out
    assert store.list_tasks() == []


def test_create_task_with_agent_prompt_requires_model(tmp_path):
    import pytest
    store = TaskStore(str(tmp_path / "tasks.json"))
    with pytest.raises(ValueError, match="modelId"):
        store.create_task({
            "title": "x", "scheduledFor": _future_iso(60),
            "agentPrompt": "do it", "source": "user",
        })


def test_schedule_agent_task_registered_in_tool_registry():
    from monkey import agent
    assert "schedule_agent_task" in agent.TOOL_NAMES
    names = [t["function"]["name"] for t in agent.TOOLS]
    assert names.count("schedule_agent_task") == 1
