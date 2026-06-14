"""Smoke tests for monkey/store.py — atomic writes + thread safety."""
import os
import threading
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _patched_store(tmp_path: Path):
    """Re-import store with _FILE pointing to a temp location."""
    from monkey import store
    store._FILE = tmp_path / "store.json"
    return store


def test_set_get_delete(tmp_path):
    store = _patched_store(tmp_path)
    assert store.get("missing") is None
    store.set("k1", "v1")
    assert store.get("k1") == "v1"
    store.set("k1", "v2")
    assert store.get("k1") == "v2"
    store.delete("k1")
    assert store.get("k1") is None


def test_atomic_write_no_temp_leak(tmp_path):
    store = _patched_store(tmp_path)
    store.set("k", "v")
    # No leftover .tmp files in the directory
    leftovers = list(tmp_path.glob(".store_*.tmp"))
    assert leftovers == []


def test_concurrent_writes_dont_corrupt(tmp_path):
    store = _patched_store(tmp_path)

    def writer(i):
        for j in range(20):
            store.set(f"k{i}_{j}", str(j))

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()

    import json
    data = json.loads(store._FILE.read_text())
    # All 100 keys present
    assert len(data) == 100
