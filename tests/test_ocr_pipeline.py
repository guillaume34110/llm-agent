"""OCR pipeline tests — catalog wiring, dedup, routing, adapter contracts.

These tests run without rapidocr/tesseract installed by mocking
`registry.is_installed`. A separate integration test attempts a real
PaddleOCR run when rapidocr_onnxruntime is importable (skipped otherwise).
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Catalog / registry wiring ──────────────────────────────────────────

def test_catalog_has_paddle_and_tesseract():
    from monkey.local_models import catalog
    ids = {m["id"] for m in catalog.all_models()}
    assert "paddle-ocr-v4" in ids
    assert "tesseract" in ids

    paddle = catalog.by_id("paddle-ocr-v4")
    assert paddle["task"] == "ocr"
    assert paddle["runtime"] == "system"
    assert paddle["adapter"] == "paddle_ocr"
    assert paddle["tool_name"] == "local_ocr"

    tess = catalog.by_id("tesseract")
    assert tess["tool_name"] == "local_ocr"  # intentional collision


def test_ocr_specs_share_tool_name():
    """Both OCR engines must share `local_ocr` for the router to work."""
    from monkey.local_models import catalog
    ocr_specs = [m for m in catalog.all_models() if m["task"] == "ocr"]
    assert len(ocr_specs) >= 2
    names = {s["tool_name"] for s in ocr_specs}
    assert names == {"local_ocr"}


def test_registry_dispatches_system_check_to_adapter(monkeypatch):
    """is_installed for runtime=system must call the spec's adapter, not
    hardcode tesseract."""
    from monkey.local_models import registry, catalog

    paddle = catalog.by_id("paddle-ocr-v4")
    # Force adapter.binary_available to a known value.
    from monkey.local_models.adapters import paddle_ocr
    monkeypatch.setattr(paddle_ocr, "binary_available", lambda: True)
    assert registry.is_installed("paddle-ocr-v4") is True

    monkeypatch.setattr(paddle_ocr, "binary_available", lambda: False)
    assert registry.is_installed("paddle-ocr-v4") is False


# ── dynamic_tools dedup ────────────────────────────────────────────────

def test_dynamic_tools_dedupes_ocr(monkeypatch):
    from monkey.local_models import tools, registry

    # Pretend both OCR engines installed.
    real = registry.is_installed
    def fake(mid):
        if mid in ("paddle-ocr-v4", "tesseract"):
            return True
        return False
    monkeypatch.setattr(registry, "is_installed", fake)

    defs = tools.dynamic_tools()
    ocr_defs = [d for d in defs if d["function"]["name"] == "local_ocr"]
    assert len(ocr_defs) == 1, "local_ocr must be emitted exactly once"
    schema = ocr_defs[0]["function"]["parameters"]["properties"]
    assert "image_path" in schema
    assert "hints" in schema
    assert "lang" in schema


def test_dynamic_tools_emits_ocr_when_only_paddle(monkeypatch):
    from monkey.local_models import tools, registry
    monkeypatch.setattr(registry, "is_installed",
                        lambda mid: mid == "paddle-ocr-v4")
    defs = tools.dynamic_tools()
    names = {d["function"]["name"] for d in defs}
    assert "local_ocr" in names


def test_dynamic_tools_emits_ocr_when_only_tesseract(monkeypatch):
    from monkey.local_models import tools, registry
    monkeypatch.setattr(registry, "is_installed",
                        lambda mid: mid == "tesseract")
    defs = tools.dynamic_tools()
    names = {d["function"]["name"] for d in defs}
    assert "local_ocr" in names


def test_dynamic_tools_no_ocr_when_none_installed(monkeypatch):
    from monkey.local_models import tools, registry
    monkeypatch.setattr(registry, "is_installed", lambda mid: False)
    defs = tools.dynamic_tools()
    names = {d["function"]["name"] for d in defs}
    assert "local_ocr" not in names


# ── Router behaviour ───────────────────────────────────────────────────

@pytest.fixture
def mock_run_model(monkeypatch):
    """Stub _run_model so router tests don't load real ONNX sessions."""
    from monkey.local_models import tools
    calls = []
    def fake(model_id, args):
        calls.append((model_id, args))
        return f"OK: ran {model_id}"
    monkeypatch.setattr(tools, "_run_model", fake)
    return calls


def _set_installed(monkeypatch, **flags):
    from monkey.local_models import registry
    monkeypatch.setattr(
        registry, "is_installed",
        lambda mid: bool(flags.get(mid, False)),
    )


def test_router_prefers_paddle_over_tesseract(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": True, "tesseract": True})
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png"})
    assert res == "OK: ran paddle-ocr-v4"
    assert mock_run_model[0][0] == "paddle-ocr-v4"


def test_router_falls_back_to_tesseract(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": False, "tesseract": True})
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png"})
    assert res == "OK: ran tesseract"


def test_router_cjk_lang_routes_to_paddle(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": True, "tesseract": True})
    tools._dispatch_ocr({"image_path": "/tmp/x.png", "hints": {"lang": "zh"}})
    assert mock_run_model[-1][0] == "paddle-ocr-v4"
    tools._dispatch_ocr({"image_path": "/tmp/x.png", "hints": {"lang": "ja"}})
    assert mock_run_model[-1][0] == "paddle-ocr-v4"


def test_router_forced_engine(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": True, "tesseract": True})
    tools._dispatch_ocr({"image_path": "/tmp/x.png", "hints": {"engine": "tesseract"}})
    assert mock_run_model[-1][0] == "tesseract"


def test_router_forced_unknown_engine(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": True})
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png", "hints": {"engine": "trocr"}})
    assert res.startswith("ERREUR:")
    assert "unknown ocr engine" in res


def test_router_forced_engine_not_installed(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": False, "tesseract": True})
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png", "hints": {"engine": "paddle"}})
    assert res.startswith("ERREUR:")
    assert "not installed" in res


def test_router_no_engine_no_p2p(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch)
    monkeypatch.setattr(tools, "_p2p_sidecar_fallback", lambda *_a, **_kw: None)
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png"})
    assert res.startswith("ERREUR:")
    assert "no OCR engine installed" in res


def test_router_no_engine_uses_p2p_fallback(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch)
    monkeypatch.setattr(tools, "_p2p_sidecar_fallback",
                        lambda name, args: "OK: via friend")
    res = tools._dispatch_ocr({"image_path": "/tmp/x.png"})
    assert res == "OK: via friend"


def test_dispatch_local_routes_local_ocr(monkeypatch, mock_run_model):
    from monkey.local_models import tools
    _set_installed(monkeypatch, **{"paddle-ocr-v4": True})
    res = tools.dispatch_local("local_ocr", {"image_path": "/tmp/x.png"})
    assert res == "OK: ran paddle-ocr-v4"


# ── Paddle adapter ─────────────────────────────────────────────────────

def test_paddle_adapter_missing_path():
    from monkey.local_models.adapters import paddle_ocr
    res = paddle_ocr.run({"engine": object()}, {})
    assert res == "ERREUR: image_path required"


def test_paddle_adapter_missing_file(tmp_path):
    from monkey.local_models.adapters import paddle_ocr
    res = paddle_ocr.run({"engine": object()}, {"image_path": str(tmp_path / "nope.png")})
    assert res.startswith("ERREUR: file not found")


def test_paddle_adapter_no_engine():
    from monkey.local_models.adapters import paddle_ocr
    res = paddle_ocr.run({}, {"image_path": "/tmp/x.png"})
    # Path check runs first; supply a real one.
    import tempfile
    from PIL import Image
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        Image.new("RGB", (10, 10), "white").save(f.name)
        res = paddle_ocr.run({}, {"image_path": f.name})
    assert res == "ERREUR: paddle-ocr engine not loaded"


def test_paddle_adapter_extract_lines_handles_shapes():
    from monkey.local_models.adapters import paddle_ocr
    # legacy list[[bbox, text, score]]
    res = paddle_ocr._extract_lines([
        [[[0, 0], [10, 0], [10, 10], [0, 10]], "Hello", 0.99],
        [[[0, 0], [10, 0], [10, 10], [0, 10]], "World", 0.95],
    ])
    assert res == ["Hello", "World"]

    # None / empty
    assert paddle_ocr._extract_lines(None) == []
    assert paddle_ocr._extract_lines([]) == []

    # dict shape
    res = paddle_ocr._extract_lines([{"text": "Hi"}, {"txt": "There"}, {"text": ""}])
    assert res == ["Hi", "There"]

    # dataclass-like with .txts
    class FakeOut:
        txts = ["Alpha", "Beta", ""]
    res = paddle_ocr._extract_lines(FakeOut())
    assert res == ["Alpha", "Beta"]


def test_paddle_adapter_run_aggregates_lines(monkeypatch, tmp_path):
    from PIL import Image
    from monkey.local_models.adapters import paddle_ocr

    img = tmp_path / "img.png"
    Image.new("RGB", (50, 20), "white").save(img)

    class FakeEngine:
        def __call__(self, path):
            return ([
                [[[0, 0], [10, 0], [10, 10], [0, 10]], "Bonjour", 0.99],
                [[[0, 0], [10, 0], [10, 10], [0, 10]], "Monde", 0.97],
            ], 0.05)

    res = paddle_ocr.run({"engine": FakeEngine()}, {"image_path": str(img)})
    assert res == "Bonjour\nMonde"


def test_paddle_adapter_run_empty_result(tmp_path):
    from PIL import Image
    from monkey.local_models.adapters import paddle_ocr

    img = tmp_path / "blank.png"
    Image.new("RGB", (50, 20), "white").save(img)

    class FakeEngine:
        def __call__(self, path):
            return (None, 0.01)

    res = paddle_ocr.run({"engine": FakeEngine()}, {"image_path": str(img)})
    assert res == "OK: (empty)"


def test_paddle_adapter_run_engine_throws(tmp_path):
    from PIL import Image
    from monkey.local_models.adapters import paddle_ocr

    img = tmp_path / "img.png"
    Image.new("RGB", (50, 20), "white").save(img)

    class BadEngine:
        def __call__(self, path):
            raise RuntimeError("boom")

    res = paddle_ocr.run({"engine": BadEngine()}, {"image_path": str(img)})
    assert res.startswith("ERREUR: paddle-ocr failed")


# ── Tesseract adapter (smoke) ──────────────────────────────────────────

def test_tesseract_adapter_missing_path():
    from monkey.local_models.adapters import ocr
    res = ocr.run({"available": True}, {})
    assert res == "ERREUR: image_path required"


def test_tesseract_adapter_missing_file(tmp_path):
    from monkey.local_models.adapters import ocr
    res = ocr.run({"available": True}, {"image_path": str(tmp_path / "nope.png")})
    assert res.startswith("ERREUR: file not found")


# ── Integration (real backend) ─────────────────────────────────────────

def _has_rapidocr() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _has_rapidocr(), reason="rapidocr_onnxruntime not installed")
def test_paddle_real_inference(tmp_path):
    """End-to-end: load rapidocr, OCR a synthetic image, expect non-empty output."""
    from PIL import Image, ImageDraw, ImageFont
    from monkey.local_models.adapters import paddle_ocr

    img = tmp_path / "hello.png"
    pil = Image.new("RGB", (320, 80), "white")
    draw = ImageDraw.Draw(pil)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
    except Exception:
        font = ImageFont.load_default()
    draw.text((10, 20), "HELLO 2026", fill="black", font=font)
    pil.save(img)

    session = paddle_ocr.load({"id": "paddle-ocr-v4"}, tmp_path)
    out = paddle_ocr.run(session, {"image_path": str(img)})
    assert not out.startswith("ERREUR:")
    # Recogniser may not be perfect on synthetic fonts — just assert some output.
    assert out and out != "OK: (empty)"


# ── P2P provider surface (paddle parity with tesseract) ────────────────

def test_p2p_payload_forwards_hints(tmp_path):
    """_build_p2p_payload must include hints in OCR payload so the remote
    sidecar can route to the right engine (paddle/tesseract)."""
    from monkey.local_models import tools
    img = tmp_path / "x.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)
    payload = tools._build_p2p_payload(
        "ocr", "paddle-ocr-v4",
        {"image_path": str(img), "lang": "fr", "hints": {"engine": "paddle"}},
    )
    assert isinstance(payload, dict)
    assert payload["model"] == "paddle-ocr-v4"
    assert payload["lang"] == "fr"
    assert payload["hints"] == {"engine": "paddle"}
    assert "image_b64" in payload


def test_p2p_payload_omits_empty_hints(tmp_path):
    from monkey.local_models import tools
    img = tmp_path / "x.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)
    payload = tools._build_p2p_payload(
        "ocr", "tesseract",
        {"image_path": str(img), "hints": {}},
    )
    assert isinstance(payload, dict)
    assert "hints" not in payload


def test_p2p_sidecar_fallback_ocr_uses_task_listing(monkeypatch, tmp_path):
    """For OCR specifically, the client fallback must discover friends by
    task=ocr (any engine) rather than hardcoded modelId=tesseract."""
    from monkey.local_models import tools
    from monkey import llm as _llm

    img = tmp_path / "x.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)

    seen = {}

    def fake_by_task(task):
        seen["task"] = task
        return [{
            "networkAddr": "https://friend.example/p2p",
            "noisePubkey": "AAAA",
            "attested": True,
            "modelId": "paddle-ocr-v4",  # friend serves paddle
        }]

    def fake_by_model(model_id):
        seen["model_id"] = model_id
        return []

    def fake_noise(endpoint, pubkey, body):
        seen["endpoint"] = endpoint
        seen["body"] = body
        return b'{"text": "remote ok"}'

    monkeypatch.setattr(_llm, "_list_friend_providers_by_task", fake_by_task)
    monkeypatch.setattr(_llm, "_list_friend_providers", fake_by_model)
    monkeypatch.setattr(_llm, "p2p_noise_call", fake_noise)

    res = tools._p2p_sidecar_fallback(
        "local_ocr",
        {"image_path": str(img), "hints": {"engine": "paddle"}},
    )
    assert res == "remote ok"
    assert seen["task"] == "ocr"
    assert "model_id" not in seen  # must not fall back to model-id listing
    # hints survived the wire encoding
    body = json.loads(seen["body"].decode("utf-8"))
    assert body["hints"] == {"engine": "paddle"}


def test_p2p_sidecar_fallback_sentiment_still_uses_model_id(monkeypatch):
    """Non-OCR sidecar tools keep the modelId-based discovery."""
    from monkey.local_models import tools
    from monkey import llm as _llm

    seen = {}

    def fake_by_model(model_id):
        seen["model_id"] = model_id
        return []

    def fake_by_task(task):
        seen["task"] = task
        return []

    monkeypatch.setattr(_llm, "_list_friend_providers", fake_by_model)
    monkeypatch.setattr(_llm, "_list_friend_providers_by_task", fake_by_task)

    tools._p2p_sidecar_fallback("local_sentiment", {"text": "hi"})
    assert seen.get("model_id") == "xlm-sentiment"
    assert "task" not in seen


def test_provider_runtime_task_mapping_includes_paddle():
    """Cross-language invariant: provider-runtime/src/tasks.rs must map
    paddle-ocr-v4 to the 'ocr' task so the Rust runtime announces it
    correctly and routes incoming Noise calls to the OCR sidecar."""
    root = Path(__file__).resolve().parent.parent
    tasks_rs = (root / "provider-runtime" / "src" / "tasks.rs").read_text()
    assert "paddle-ocr-v4" in tasks_rs
    # And on the OCR branch specifically (same match arm as tesseract).
    assert '"tesseract" | "paddle-ocr-v4" => "ocr"' in tasks_rs


def test_sidecar_p2p_ocr_accepts_paddle_only(monkeypatch, tmp_path):
    """The FastAPI /p2p/ocr handler must accept a provider that only has
    paddle-ocr-v4 (no tesseract). Previously it gated on tesseract only."""
    from monkey import main as monkey_main
    from monkey.local_models import registry, tools as _lmt

    monkeypatch.setattr(
        registry, "is_installed",
        lambda mid: mid == "paddle-ocr-v4",
    )
    captured = {}
    def fake_dispatch(name, args):
        captured["name"] = name
        captured["args"] = args
        return "remote text"
    monkeypatch.setattr(_lmt, "dispatch_local", fake_dispatch)

    img_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    import base64
    body = {
        "image_b64": base64.b64encode(img_bytes).decode("ascii"),
        "lang": "fr",
        "hints": {"engine": "paddle"},
    }
    res = monkey_main.p2p_ocr(body)
    assert res == {"text": "remote text"}
    assert captured["name"] == "local_ocr"
    # hints forwarded into the dispatch
    assert captured["args"]["hints"] == {"engine": "paddle"}
    assert captured["args"]["lang"] == "fr"
    assert "image_path" in captured["args"]


def test_sidecar_p2p_ocr_rejects_when_no_engine(monkeypatch):
    from fastapi import HTTPException
    from monkey import main as monkey_main
    from monkey.local_models import registry

    monkeypatch.setattr(registry, "is_installed", lambda mid: False)
    import base64
    body = {"image_b64": base64.b64encode(b"\x89PNG").decode("ascii")}
    with pytest.raises(HTTPException) as exc:
        monkey_main.p2p_ocr(body)
    assert exc.value.status_code == 409
    assert "no OCR engine" in str(exc.value.detail)
