import importlib.util
from pathlib import Path


def _load_battery():
    root = Path(__file__).parent.parent
    path = root / "scripts" / "test_agent_battery.py"
    spec = importlib.util.spec_from_file_location("agent_battery_script", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_battery_declares_skills_category():
    battery = _load_battery()

    assert "skills" in battery.CATEGORIES
    assert battery.CATEGORIES["skills"]


def test_battery_enforces_ninety_percent_threshold(monkeypatch):
    battery = _load_battery()

    fake_categories = {
        "skills": [
            ("p1", lambda _events: (True, "")),
            ("p2", lambda _events: (True, "")),
            ("p3", lambda _events: (True, "")),
            ("p4", lambda _events: (True, "")),
            ("p5", lambda _events: (True, "")),
            ("p6", lambda _events: (True, "")),
            ("p7", lambda _events: (True, "")),
            ("p8", lambda _events: (True, "")),
            ("p9", lambda _events: (True, "")),
            ("p10", lambda _events: (False, "boom")),
        ],
    }

    monkeypatch.setattr(battery, "CATEGORIES", fake_categories)
    monkeypatch.setattr(battery, "pick", lambda variants: variants)
    monkeypatch.setattr(battery, "stream_chat", lambda _prompt: [{"event": "done", "data": "ok"}])

    assert battery.run_battery("skills", verbose=False, min_success_rate=0.90) == 0
    assert battery.run_battery("skills", verbose=False, min_success_rate=0.91) == 1
