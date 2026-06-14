"""Smoke test for monkey/tools/music.py — music generation tool."""
import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_generate_music_success():
    """Test successful music generation with mocked HTTP response."""
    from monkey.tools.music import generate_music

    # Minimal WAV header (100 bytes) for fake response
    wav_header = base64.b64encode(
        b"RIFF\x24\x00\x00\x00WAVE"  # RIFF header + size placeholder
        b"fmt \x10\x00\x00\x00"       # fmt chunk
        b"\x01\x00\x02\x00\x44\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00"
        + b"\x00" * 50  # Pad to ~100 bytes
    ).decode("ascii")

    fake_response = {
        "audioBase64": wav_header,
        "format": "wav",
        "provenance": {
            "model": "google/lyria-3-clip-preview",
            "generated_at": "2026-05-18T12:00:00Z"
        }
    }

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        out_path = tmp_path / "test_music.wav"

        with patch("httpx.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = fake_response
            mock_resp.raise_for_status.return_value = None
            mock_post.return_value = mock_resp

            result = generate_music(
                "test prompt",
                path=str(out_path),
                model_id="google/lyria-3-clip-preview",
                duration="15"
            )

        # Assertions
        assert result.startswith("OK:"), f"Expected OK: prefix, got {result}"
        assert out_path.exists(), f"Music file not created at {out_path}"
        assert out_path.stat().st_size > 0, "Music file is empty"

        # Check sidecar manifest exists
        manifest_path = out_path.with_suffix(out_path.suffix + ".ai.json")
        assert manifest_path.exists(), f"Manifest not found at {manifest_path}"

        # Verify manifest content
        manifest = json.loads(manifest_path.read_text())
        assert manifest["ai_generated"] is True
        assert manifest["model"] == "google/lyria-3-clip-preview"
        assert "AI Act Article 50(2)" in manifest["regulatory_note"]


def test_generate_music_http_error():
    """Test error handling when HTTP request fails."""
    from monkey.tools.music import generate_music

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        out_path = tmp_path / "test_music.wav"

        with patch("httpx.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.raise_for_status.side_effect = Exception("Connection error")
            mock_post.return_value = mock_resp

            result = generate_music(
                "test prompt",
                path=str(out_path),
                model_id="google/lyria-3-clip-preview"
            )

        assert result.startswith("ERREUR"), f"Expected ERREUR prefix, got {result}"
        assert not out_path.exists(), "Music file should not be created on error"


def test_generate_music_invalid_response():
    """Test error handling for missing audioBase64 in response."""
    from monkey.tools.music import generate_music

    fake_response = {"format": "wav"}  # Missing audioBase64

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        out_path = tmp_path / "test_music.wav"

        with patch("httpx.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = fake_response
            mock_resp.raise_for_status.return_value = None
            mock_post.return_value = mock_resp

            result = generate_music(
                "test prompt",
                path=str(out_path),
                model_id="google/lyria-3-clip-preview"
            )

        assert result.startswith("ERREUR"), f"Expected ERREUR prefix, got {result}"


def test_generate_music_auto_path():
    """Test music generation with auto-generated path (no path provided)."""
    from monkey.tools.music import generate_music

    wav_header = base64.b64encode(
        b"RIFF\x24\x00\x00\x00WAVE"
        b"fmt \x10\x00\x00\x00"
        b"\x01\x00\x02\x00\x44\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00"
        + b"\x00" * 50
    ).decode("ascii")

    fake_response = {
        "audioBase64": wav_header,
        "format": "wav",
        "provenance": {"model": "google/lyria-3-clip-preview"}
    }

    with patch("httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        # Mock workspace resolution
        with patch("monkey.tools.files._get_workspace") as mock_ws:
            with tempfile.TemporaryDirectory() as tmp:
                mock_ws.return_value = tmp

                result = generate_music(
                    "test prompt",
                    model_id="google/lyria-3-clip-preview"
                )

        assert result.startswith("OK:"), f"Expected OK: prefix, got {result}"
        # Should have created a file with timestamp in workspace
        assert "music_" in result
        assert ".wav" in result or "KB" in result
