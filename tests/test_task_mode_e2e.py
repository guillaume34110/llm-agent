"""End-to-end audit for the task `mode` field.

Walks the same path the desktop UI uses:
1. Pydantic TaskCreateRequest accepts `mode`
2. Pydantic TaskUpdateRequest accepts `mode`
3. POST /tasks persists `mode`
4. PUT /tasks/{id} can flip `mode`
5. Roundtrip through TaskStore preserves `mode`

If any step drops `mode`, the UI save silently no-ops — exactly the bug
reported.
"""
from __future__ import annotations

import datetime as dt

import pytest

from monkey.tasks_store import TaskStore


def _iso_future(minutes: int = 60) -> str:
    return (dt.datetime.now() + dt.timedelta(minutes=minutes)).replace(
        second=0, microsecond=0
    ).isoformat(timespec="minutes")


class _FakeClient:
    """Drives the real route handlers against an isolated TaskStore.
    Mirrors what TestClient would do — without the httpx version mismatch."""
    def __init__(self, store: TaskStore):
        from monkey import main as m
        # Swap the module-level singleton route handlers read.
        self._orig_store = m.TASK_STORE
        m.TASK_STORE = store
        self._m = m

    def close(self):
        self._m.TASK_STORE = self._orig_store

    def post_task(self, payload: dict):
        from monkey.main import TaskCreateRequest, create_task
        req = TaskCreateRequest(**payload)
        try:
            return 200, create_task(req)
        except Exception as e:
            return getattr(e, "status_code", 400), {"detail": str(e)}

    def put_task(self, task_id: str, payload: dict):
        from monkey.main import TaskUpdateRequest, update_task
        req = TaskUpdateRequest(**payload)
        try:
            return 200, update_task(task_id, req)
        except Exception as e:
            return getattr(e, "status_code", 400), {"detail": str(e)}

    def list_tasks(self):
        from monkey.main import list_tasks
        return list_tasks()


@pytest.fixture
def client(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))
    c = _FakeClient(store)
    yield c
    c.close()


def test_create_request_model_accepts_mode():
    from monkey.main import TaskCreateRequest
    req = TaskCreateRequest(
        title="x", scheduledFor=_iso_future(),
        agentPrompt="check btc", mode="alert",
        modelId="test/model",
    )
    assert req.mode == "alert"


def test_update_request_model_accepts_mode():
    from monkey.main import TaskUpdateRequest
    req = TaskUpdateRequest(mode="alert")
    assert req.mode == "alert"
    # exclude_unset must keep mode in the dump
    assert "mode" in req.model_dump(exclude_unset=True)


def test_post_tasks_persists_alert_mode(client):
    code, res = client.post_task({
        "title": "BTC watcher",
        "scheduledFor": _iso_future(),
        "agentPrompt": "check btc",
        "modelId": "test/model",
        "mode": "alert",
    })
    assert code == 200, res
    task = res["task"]
    assert task.get("mode") == "alert", f"server dropped mode field: {task}"


def test_put_tasks_can_flip_mode(client):
    code, create = client.post_task({
        "title": "X",
        "scheduledFor": _iso_future(),
        "agentPrompt": "p",
        "modelId": "test/model",
        "mode": "report",
    })
    assert code == 200, create
    task = create["task"]
    assert task["mode"] == "report"

    code, upd = client.put_task(task["id"], {"mode": "alert"})
    assert code == 200, upd
    assert upd["task"]["mode"] == "alert", f"PUT did not persist mode: {upd}"

    listing = client.list_tasks()
    found = next(t for t in listing if t["id"] == task["id"])
    assert found["mode"] == "alert", f"mode lost after reload: {found}"


def test_invalid_mode_rejected(client):
    from fastapi import HTTPException
    from monkey.main import TaskCreateRequest, create_task
    req = TaskCreateRequest(
        title="X", scheduledFor=_iso_future(), agentPrompt="p", mode="bogus",
    )
    with pytest.raises(HTTPException) as exc:
        create_task(req)
    assert exc.value.status_code == 400
    assert "mode" in str(exc.value.detail).lower()


def test_full_ui_payload_shape_persists(client):
    """Mirror the exact payload InlineTaskEdit.save() sends."""
    code, create = client.post_task({
        "title": "X",
        "scheduledFor": _iso_future(),
        "agentPrompt": "p",
        "modelId": "test/model",
    })
    assert code == 200
    task_id = create["task"]["id"]

    ui_payload = {
        "title": "X",
        "scheduledFor": _iso_future(),
        "endsAt": None,
        "allDay": False,
        "agentPrompt": "p",
        "modelId": "test/model",
        "recurrence": None,
        "recurrenceUntil": None,
        "recurrenceCount": None,
        "mode": "alert",
    }
    code, upd = client.put_task(task_id, ui_payload)
    assert code == 200, upd
    assert upd["task"]["mode"] == "alert"
