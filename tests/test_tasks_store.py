from monkey.tasks_store import TaskStore


def test_task_store_crud_and_conflict_shift(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))

    first = store.create_task({
        "title": "Focus",
        "scheduledFor": "2026-05-07T10:00",
        "allDay": False,
        "status": "planned",
        "source": "agent",
    })
    second = store.create_task({
        "title": "Call",
        "scheduledFor": "2026-05-07T10:00",
        "allDay": False,
        "status": "planned",
        "source": "agent",
    })

    assert first["scheduledFor"] == "2026-05-07T10:00"
    assert second["scheduledFor"] == "2026-05-07T10:30"

    updated = store.update_task(first["id"], {"status": "done", "details": "fait"})
    assert updated["status"] == "done"
    assert updated["details"] == "fait"

    tasks = store.list_tasks()
    assert [task["title"] for task in tasks] == ["Focus", "Call"]

    store.delete_task(second["id"])
    remaining = store.list_tasks()
    assert [task["id"] for task in remaining] == [first["id"]]


def test_task_store_normalizes_all_day_dates(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))

    task = store.create_task({
        "title": "Payer le loyer",
        "scheduledFor": "2026-05-08T18:45",
        "allDay": True,
        "status": "planned",
        "source": "user",
    })

    assert task["scheduledFor"] == "2026-05-08"
    assert task["allDay"] is True


def test_task_store_update_can_clear_optional_end(tmp_path):
    store = TaskStore(str(tmp_path / "tasks.json"))

    task = store.create_task({
        "title": "Dentiste",
        "scheduledFor": "2026-05-09T14:00",
        "endsAt": "2026-05-09T15:00",
        "allDay": False,
        "status": "planned",
        "source": "user",
    })

    updated = store.update_task(task["id"], {"endsAt": None})

    assert updated["endsAt"] is None
