import base64
import json
import os
import tempfile
from pathlib import Path


def test_generate_image_local_retries_after_transient_sidecar_failure(monkeypatch, tmp_path):
    from monkey.tools import image as image_mod
    from monkey.local_models import catalog as cat

    png_b64 = base64.b64encode(b"fake-png-bytes").decode("ascii")

    class _Resp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.text = str(payload)

        def json(self):
            return self._payload

    calls = [
        _Resp(400, {"detail": "ERREUR: sd.cpp exit 1"}),
        _Resp(200, {"image_b64": png_b64}),
    ]

    def _fake_post(*_args, **_kwargs):
        return calls.pop(0)

    monkeypatch.setenv("MONKEY_SIDECAR_URL", "http://127.0.0.1:3471")
    monkeypatch.setattr(cat, "by_task", lambda _task: [])
    monkeypatch.setattr(image_mod.httpx, "post", _fake_post)
    monkeypatch.setattr(image_mod, "_write_ai_provenance", lambda *_args, **_kwargs: None)

    dest = tmp_path / "cat.png"
    result = image_mod._generate_image_local("cat on moon", "1024x1024", dest)

    assert result.startswith("OK: image generated")
    assert dest.read_bytes() == b"fake-png-bytes"


def test_generate_image_local_prefers_in_process_dispatch(monkeypatch, tmp_path):
    from monkey.tools import image as image_mod
    from monkey.local_models import catalog as cat, registry as reg, tools as lmt

    src = tmp_path / "adapter-output.png"
    src.write_bytes(b"in-process-image")

    monkeypatch.setattr(cat, "by_task", lambda task: [{"id": "flux-schnell-gguf", "tool_name": "local_image_gen"}] if task == "image_gen" else [])
    monkeypatch.setattr(reg, "is_installed", lambda _model_id: True)
    calls = iter([
        "ERREUR: sd.cpp exit 1",
        json.dumps({"image_path": str(src), "bytes": len(src.read_bytes()), "format": "png"}),
    ])
    monkeypatch.setattr(lmt, "dispatch_local", lambda _tool_name, _args: next(calls))
    monkeypatch.setattr(image_mod.httpx, "post", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("http fallback not expected")))
    monkeypatch.setattr(image_mod, "_write_ai_provenance", lambda *_args, **_kwargs: None)

    dest = tmp_path / "copied.png"
    result = image_mod._generate_image_local("cat on moon", "1024x1024", dest)

    assert result.startswith("OK: image generated")
    assert dest.read_bytes() == b"in-process-image"


def test_generate_image_local_uses_cached_flux_file_after_direct_failure(monkeypatch, tmp_path):
    from monkey.tools import image as image_mod
    from monkey.local_models import catalog as cat, registry as reg, tools as lmt

    cache_dir = tmp_path / "monkey-image"
    cache_dir.mkdir()
    cached = cache_dir / f"flux-{os.getpid()}-1780042950.png"
    cached.write_bytes(b"cached-image")

    monkeypatch.setattr(cat, "by_task", lambda task: [{"id": "flux-schnell-gguf", "tool_name": "local_image_gen"}] if task == "image_gen" else [])
    monkeypatch.setattr(reg, "is_installed", lambda _model_id: True)
    monkeypatch.setattr(lmt, "dispatch_local", lambda _tool_name, _args: "ERREUR: sd.cpp exit 1")
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(image_mod, "_write_ai_provenance", lambda *_args, **_kwargs: None)

    dest = tmp_path / "copied-from-cache.png"
    result = image_mod._generate_image_local("cat on moon", "384x384", dest, seed=1780042950)

    assert result.startswith("OK: image generated")
    assert dest.read_bytes() == b"cached-image"
