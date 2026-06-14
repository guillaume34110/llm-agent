"""runLog: streaming activity buffer for scheduled tasks.

The UI (LibraryView/InlineTaskEdit) and WA bridge poll tasks and expect a
runLog list with the agent's step-by-step events (intent, tool_start,
tool_done, model_route, error). Without this, recurring jobs look frozen
mid-run.
"""
import datetime as dt

from monkey.tasks_store import TaskStore, RUN_LOG_CAP


def _iso(when):
    return when.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def test_run_log_empty_by_default(tmp_path):
    store = TaskStore(str(tmp_path / "t.json"))
    now = dt.datetime.now()
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(now + dt.timedelta(hours=1)),
    })
    assert task["runLog"] == []


def test_append_run_log_normalizes_entry(tmp_path):
    store = TaskStore(str(tmp_path / "t.json"))
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(dt.datetime.now() + dt.timedelta(hours=1)),
    })
    store.append_run_log(task["id"], {"kind": "tool_start", "label": "kb_search", "detail": "{\"q\": \"hi\"}"})
    fresh = store.get_task(task["id"])
    assert len(fresh["runLog"]) == 1
    entry = fresh["runLog"][0]
    assert entry["kind"] == "tool_start"
    assert entry["label"] == "kb_search"
    assert entry["detail"] == '{"q": "hi"}'
    assert entry["ts"]  # auto-filled


def test_append_run_log_caps_at_limit(tmp_path):
    store = TaskStore(str(tmp_path / "t.json"))
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(dt.datetime.now() + dt.timedelta(hours=1)),
    })
    for i in range(RUN_LOG_CAP + 10):
        store.append_run_log(task["id"], {"kind": "info", "label": f"step{i}"})
    fresh = store.get_task(task["id"])
    assert len(fresh["runLog"]) == RUN_LOG_CAP
    # Oldest dropped, newest kept
    assert fresh["runLog"][0]["label"] == f"step{10}"
    assert fresh["runLog"][-1]["label"] == f"step{RUN_LOG_CAP + 9}"


def test_reset_run_log_clears_entries(tmp_path):
    store = TaskStore(str(tmp_path / "t.json"))
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(dt.datetime.now() + dt.timedelta(hours=1)),
    })
    store.append_run_log(task["id"], {"kind": "tool_done", "label": "a"})
    store.append_run_log(task["id"], {"kind": "tool_done", "label": "b"})
    assert len(store.get_task(task["id"])["runLog"]) == 2
    store.reset_run_log(task["id"])
    assert store.get_task(task["id"])["runLog"] == []


def test_run_log_survives_update_task(tmp_path):
    """Editing title via update_task must NOT wipe an in-flight runLog."""
    store = TaskStore(str(tmp_path / "t.json"))
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(dt.datetime.now() + dt.timedelta(hours=1)),
    })
    store.append_run_log(task["id"], {"kind": "tool_start", "label": "web"})
    store.update_task(task["id"], {"title": "renamed"})
    fresh = store.get_task(task["id"])
    assert fresh["title"] == "renamed"
    assert len(fresh["runLog"]) == 1
    assert fresh["runLog"][0]["label"] == "web"


def test_append_run_log_truncates_long_detail(tmp_path):
    store = TaskStore(str(tmp_path / "t.json"))
    task = store.create_task({
        "title": "x", "scheduledFor": _iso(dt.datetime.now() + dt.timedelta(hours=1)),
    })
    store.append_run_log(task["id"], {"kind": "tool_done", "label": "big", "detail": "x" * 1000})
    entry = store.get_task(task["id"])["runLog"][0]
    assert len(entry["detail"]) <= 400
