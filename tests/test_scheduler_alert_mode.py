"""Regression tests for scheduled-task alert mode.

Bug captured: scheduler unconditionally pushes the agent's final text to
WhatsApp via `_wa_notify`. For alert-style tasks ("ping me if X"), the user
gets spammed even when the condition is not met.

Desired contract (option B — explicit `notify_user` tool):
- task.mode == "report" (default): keep current behavior, auto-notify final.
- task.mode == "alert": auto-notify is disabled. Agent pushes only via the
  `notify_user` tool. Silent run = no message.

These tests fail today; they pass once option B lands.
"""
from __future__ import annotations

import datetime as dt
from unittest.mock import patch

from monkey import scheduler
from monkey.tasks_store import TaskStore


def _iso(when: dt.datetime) -> str:
    return when.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def _make_due_alert_task(store: TaskStore, prompt: str) -> dict:
    past = dt.datetime.now() - dt.timedelta(minutes=2)
    return store.create_task({
        "title": "BTC alert",
        "scheduledFor": _iso(past),
        "agentPrompt": prompt,
        "modelId": "test/model",
        "source": "agent-scheduled",
        "mode": "alert",
    })


def test_alert_mode_silent_run_does_not_notify(tmp_path):
    """Agent decides condition false -> no WA message sent."""
    store = TaskStore(str(tmp_path / "tasks.json"))
    _make_due_alert_task(store, "Check BTC, ping if > 100k USD")

    sent: list[tuple[str, str]] = []

    def fake_agent(prompt: str, task: dict) -> str:
        # Agent ran, condition not met, no notify_user tool call, returns text.
        # In option B, this text MUST NOT be pushed to WA when mode == "alert".
        return "BTC at 95k, condition not met."

    # Patch the WA send used by main._wa_notify; the scheduler must not invoke it.
    with patch("monkey.main._wa_send_text", lambda target, text: sent.append((target, text))):
        scheduler.tick(store, fake_agent)

    assert sent == [], f"alert task with unmet condition leaked WA message: {sent}"


def test_alert_mode_explicit_notify_tool_call_sends(tmp_path):
    """Agent calls notify_user tool -> WA message goes out exactly once."""
    store = TaskStore(str(tmp_path / "tasks.json"))
    _make_due_alert_task(store, "Check BTC, ping if > 100k USD")

    sent: list[tuple[str, str]] = []

    def fake_agent(prompt: str, task: dict) -> str:
        # Simulate agent invoking notify_user("BTC hit 105k!").
        # The tool's side effect is the actual WA send, not the final text.
        from monkey.tools import notify  # tool module to be added by option B
        notify.notify_user("BTC hit 105k!")
        return "Notified."

    with patch("monkey.main._wa_send_text", lambda target, text: sent.append((target, text))):
        scheduler.tick(store, fake_agent)

    assert len(sent) == 1
    assert "105k" in sent[0][1]


def test_report_mode_still_auto_notifies(tmp_path):
    """Backwards-compat: mode == 'report' (or unset) keeps current auto-notify."""
    store = TaskStore(str(tmp_path / "tasks.json"))
    past = dt.datetime.now() - dt.timedelta(minutes=2)
    store.create_task({
        "title": "Daily summary",
        "scheduledFor": _iso(past),
        "agentPrompt": "Summarize today",
        "modelId": "test/model",
        "source": "agent-scheduled",
        # mode unset -> defaults to 'report'
    })

    sent: list[tuple[str, str]] = []

    def fake_agent(prompt: str, task: dict) -> str:
        return "Today: 3 PRs merged, 12 commits."

    with patch("monkey.main._wa_send_text", lambda target, text: sent.append((target, text))):
        scheduler.tick(store, fake_agent)

    assert len(sent) == 1
    assert "3 PRs merged" in sent[0][1]
