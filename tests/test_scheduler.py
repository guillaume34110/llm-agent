import datetime as dt
import json

from monkey.scheduler import humanize_agent_output, tick
from monkey.tasks_store import TaskStore


def _iso(when: dt.datetime) -> str:
    return when.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def test_tick_runs_due_task_and_records_result(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    task = store.create_task({
        "title": "brief", "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "hello",
        "modelId": "test/model",
    })

    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        return f"ran:{prompt}"

    processed = tick(store, fake_agent, now=now)
    assert len(processed) == 1
    assert processed[0]["id"] == task["id"]
    assert processed[0]["status"] == "done"
    assert processed[0]["runResult"] == "ran:hello"
    assert calls == ["hello"]


def test_run_scheduled_agent_forces_full_tool_mode(monkeypatch, tmp_path):
    from monkey import main

    captured: dict[str, str | bool | None] = {"tool_mode": None, "scheduled_run": None}

    def fake_stream(*_args, **kwargs):
        captured["tool_mode"] = kwargs.get("tool_mode")
        captured["scheduled_run"] = kwargs.get("scheduled_run")
        yield {"event": "done", "data": "ok"}

    monkeypatch.setattr(main, "agent_chat_stream", fake_stream)
    monkeypatch.setattr(main, "TASK_STORE", TaskStore(str(tmp_path / "tasks.json")))

    out = main._run_scheduled_agent("prompt", {
        "id": "task-1",
        "modelId": "test/model",
        "toolMode": "chat_only",
    })

    assert out == "ok"
    assert captured["tool_mode"] == "full"
    assert captured["scheduled_run"] is True


def test_tick_skips_future_task(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "later", "scheduledFor": _iso(now + dt.timedelta(hours=1)),
        "agentPrompt": "wait",
        "modelId": "test/model",
    })

    def fake_agent(prompt: str, _task) -> str:
        raise AssertionError("should not run")

    processed = tick(store, fake_agent, now=now)
    assert processed == []


def test_tick_records_exception_as_cancelled(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    task = store.create_task({
        "title": "boom", "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "fail me",
        "modelId": "test/model",
    })

    def fake_agent(_p, _t) -> str:
        raise RuntimeError("kaboom")

    processed = tick(store, fake_agent, now=now)
    assert len(processed) == 1
    assert processed[0]["status"] == "cancelled"
    assert processed[0]["runResult"].startswith("ERREUR:")
    assert "kaboom" in processed[0]["runResult"]

    # second tick: nothing left to run
    again = tick(store, fake_agent, now=now)
    assert again == []
    final = store.get_task(task["id"])
    assert final["status"] == "cancelled"


def test_tick_is_atomic_between_passes(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    store.create_task({
        "title": "once", "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "p",
        "modelId": "test/model",
    })
    calls: list[str] = []

    def fake_agent(prompt: str, _task) -> str:
        calls.append(prompt)
        return "ok"

    tick(store, fake_agent, now=now)
    tick(store, fake_agent, now=now)
    assert calls == ["p"]


# ── humanize_agent_output regression lockdown ───────────────────────────────
# A scheduled task leaked a tool-shaped JSON payload to WhatsApp:
#   {"ok": true, "notified": ["MSFT -0.19%", "NVDA -1.64%"],
#    "btc_status": "API/browser access failed", "threshold_triggered": true}
# The agent's final message must be human text, never raw JSON.

_BAD_PAYLOAD = (
    '{"ok": true, "notified": ["MSFT -0.19%", "NVDA -1.64%"], '
    '"btc_status": "API/browser access failed", "threshold_triggered": true}'
)


def test_humanize_rewrites_raw_json_dict():
    out = humanize_agent_output(_BAD_PAYLOAD)
    # No longer parses as JSON dict
    try:
        parsed = json.loads(out)
        assert not isinstance(parsed, dict), "output still a JSON dict"
    except (ValueError, TypeError):
        pass
    # Meaningful values preserved
    assert "MSFT -0.19%" in out
    assert "NVDA -1.64%" in out
    assert "API/browser access failed" in out
    # No raw braces leaking
    assert not out.strip().startswith("{")


def test_humanize_passthrough_plain_text():
    msg = "Update sent. MSFT -0.19%, NVDA -1.64%."
    assert humanize_agent_output(msg) == msg


def test_humanize_passthrough_malformed_json():
    msg = "{not valid json, just a sentence"
    assert humanize_agent_output(msg) == msg


def test_humanize_flattens_json_list():
    out = humanize_agent_output('["MSFT -0.19%", "NVDA -1.64%"]')
    assert "MSFT -0.19%" in out
    assert "NVDA -1.64%" in out
    assert not out.strip().startswith("[")


def test_humanize_empty_or_non_string():
    assert humanize_agent_output("") == ""
    assert humanize_agent_output("   ") == "   "
