import datetime as dt

from monkey.tasks_store import TaskStore


def _iso(when: dt.datetime) -> str:
    return when.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def test_create_with_agent_prompt_persists(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    future = dt.datetime.now() + dt.timedelta(hours=1)
    task = store.create_task({
        "title": "Daily brief",
        "scheduledFor": _iso(future),
        "agentPrompt": "Summarize today's news",
        "modelId": "test/model",
        "source": "agent-scheduled",
    })
    assert task["agentPrompt"] == "Summarize today's news"
    assert task["runResult"] is None
    assert task["runStartedAt"] is None
    # reload to verify persistence
    again = TaskStore(str(tmp_path / "tasks.json"))
    fresh = again.get_task(task["id"])
    assert fresh["agentPrompt"] == "Summarize today's news"


def test_list_upcoming_returns_planned_sorted_capped(tmp_path):
    # Contract: planned tasks (incl. overdue) sorted chronologically. Overdue
    # planned tasks stay visible so recurring loops / stuck runs surface in UI.
    # Non-planned tasks (done/cancelled) are excluded.
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    past = store.create_task({
        "title": "past", "scheduledFor": _iso(now - dt.timedelta(hours=2)),
    })
    soon = store.create_task({
        "title": "soon", "scheduledFor": _iso(now + dt.timedelta(hours=1)),
    })
    later = store.create_task({
        "title": "later", "scheduledFor": _iso(now + dt.timedelta(hours=3)),
    })
    done_future = store.create_task({
        "title": "done", "scheduledFor": _iso(now + dt.timedelta(hours=2)),
        "status": "done",
    })

    upcoming = store.list_upcoming(limit=20)
    titles = [t["title"] for t in upcoming]
    assert titles == ["past", "soon", "later"]
    assert done_future["id"] not in {t["id"] for t in upcoming}

    # limit
    capped = store.list_upcoming(limit=1)
    assert [t["title"] for t in capped] == ["past"]


def test_claim_due_atomic_and_idempotent(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    due = store.create_task({
        "title": "due now", "scheduledFor": _iso(now - dt.timedelta(minutes=2)),
        "agentPrompt": "do it",
        "modelId": "test/model",
    })
    future = store.create_task({
        "title": "future", "scheduledFor": _iso(now + dt.timedelta(hours=1)),
        "agentPrompt": "later",
        "modelId": "test/model",
    })
    no_prompt = store.create_task({
        "title": "plain", "scheduledFor": _iso(now - dt.timedelta(minutes=2)),
    })

    first = store.claim_due(now=now)
    ids = {t["id"] for t in first}
    assert due["id"] in ids
    assert future["id"] not in ids
    assert no_prompt["id"] not in ids

    # second call must NOT re-claim
    second = store.claim_due(now=now)
    assert second == []

    # the claimed task carries runStartedAt
    state = store.get_task(due["id"])
    assert state["runStartedAt"] is not None
    assert state["status"] == "planned"


def test_claim_due_expires_old_tasks(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    old = store.create_task({
        "title": "stale", "scheduledFor": _iso(now - dt.timedelta(hours=48)),
        "agentPrompt": "expired",
        "modelId": "test/model",
    })
    claimed = store.claim_due(now=now, max_age_hours=24)
    assert claimed == []
    state = store.get_task(old["id"])
    assert state["status"] == "cancelled"
    assert "expired" in (state["runResult"] or "").lower()


def test_finish_run_marks_done_with_result(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "p",
        "modelId": "test/model",
    })
    store.claim_due(now=now)
    finished = store.finish_run(task["id"], "all good")
    assert finished["status"] == "done"
    assert finished["runResult"] == "all good"
    assert finished["runFinishedAt"] is not None


def test_finish_run_failure_sets_cancelled(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    now = dt.datetime.now()
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(now - dt.timedelta(minutes=1)),
        "agentPrompt": "p",
        "modelId": "test/model",
    })
    store.claim_due(now=now)
    finished = store.finish_run(task["id"], "ERREUR: kaboom", ok=False)
    assert finished["status"] == "cancelled"
    assert finished["runResult"].startswith("ERREUR:")


def test_recurrence_min_interval_enforced(tmp_path):
    import pytest
    store = TaskStore(str(tmp_path / "tasks.json"))
    future = dt.datetime.now() + dt.timedelta(hours=1)
    with pytest.raises(ValueError, match="10 minutes"):
        store.create_task({
            "title": "Too frequent",
            "scheduledFor": _iso(future),
            "agentPrompt": "x",
            "modelId": "test/model",
            "recurrence": "FREQ=MINUTELY;INTERVAL=5",
        })


def test_recurrence_creates_next_run_at(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    future = dt.datetime.now() + dt.timedelta(hours=1)
    task = store.create_task({
        "title": "Hourly",
        "scheduledFor": _iso(future),
        "agentPrompt": "x",
        "modelId": "test/model",
        "recurrence": "FREQ=HOURLY",
    })
    assert task["recurrence"] == "FREQ=HOURLY"
    assert task["nextRunAt"] is not None


def test_finish_run_recurring_appends_history_and_reschedules(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    past = dt.datetime.now() - dt.timedelta(minutes=5)
    task = store.create_task({
        "title": "R",
        "scheduledFor": _iso(past),
        "agentPrompt": "x",
        "modelId": "test/model",
        "recurrence": "FREQ=HOURLY",
    })
    claimed = store.claim_due()
    assert any(t["id"] == task["id"] for t in claimed)
    finished = store.finish_run(task["id"], "ok")
    assert finished["status"] == "planned"
    assert finished["nextRunAt"] is not None
    assert len(finished["runHistory"]) == 1
    assert finished["runHistory"][0]["result"] == "ok"
    assert finished["runStartedAt"] is None  # reset for next run


def test_recurrence_count_terminates(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    past = dt.datetime.now() - dt.timedelta(minutes=5)
    task = store.create_task({
        "title": "Twice",
        "scheduledFor": _iso(past),
        "agentPrompt": "x",
        "modelId": "test/model",
        "recurrence": "FREQ=HOURLY",
        "recurrenceCount": 1,
    })
    store.claim_due()
    finished = store.finish_run(task["id"], "ok")
    assert finished["status"] == "done"
    assert finished["nextRunAt"] is None
