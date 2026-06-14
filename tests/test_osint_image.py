"""Tests for monkey.tools.osint_image — EXIF, perceptual hash, reverse-image URLs."""
from __future__ import annotations

import json

import pytest
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from monkey.tools import osint_image as oi


def test_exif_missing_file():
    assert oi.exif_extract("/nonexistent/xyz.jpg").startswith("ERREUR")


def test_exif_no_exif(tmp_path):
    # Plain PNG without EXIF
    p = tmp_path / "plain.png"
    Image.new("RGB", (16, 16), "red").save(p)
    out = json.loads(oi.exif_extract(str(p)))
    assert out["has_exif"] is False


def test_exif_with_camera_and_gps(tmp_path):
    # Build a JPEG with EXIF including GPS via PIL's exif dict
    p = tmp_path / "tagged.jpg"
    img = Image.new("RGB", (32, 32), "blue")
    exif = img.getexif()
    exif[271] = "TestCam"        # Make
    exif[272] = "Model-X"        # Model
    exif[306] = "2026:01:15 10:30:00"  # DateTime
    exif[305] = "AgentSoft 1.0"  # Software
    # GPS sub-IFD
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (IFDRational(48, 1), IFDRational(51, 1), IFDRational(0, 1))
    gps[3] = "E"
    gps[4] = (IFDRational(2, 1), IFDRational(21, 1), IFDRational(0, 1))
    img.save(p, exif=exif)

    out = json.loads(oi.exif_extract(str(p)))
    assert out["has_exif"] is True
    assert out["camera_make"] == "TestCam"
    assert out["camera_model"] == "Model-X"
    assert out["software"] == "AgentSoft 1.0"
    # Paris ≈ 48.85, 2.35
    assert abs(out["gps_lat"] - 48.85) < 0.01
    assert abs(out["gps_lon"] - 2.35) < 0.01
    assert "google.com/maps" in out["gps_maps_url"]


def test_phash_missing_file():
    assert oi.image_phash("/nonexistent/xyz.jpg").startswith("ERREUR")


def test_phash_deterministic(tmp_path):
    p = tmp_path / "a.png"
    Image.new("RGB", (64, 64), "red").save(p)
    out1 = json.loads(oi.image_phash(str(p)))
    out2 = json.loads(oi.image_phash(str(p)))
    assert out1["ahash_hex"] == out2["ahash_hex"]
    assert len(out1["ahash_hex"]) == 16  # 64 bits → 16 hex chars
    assert isinstance(out1["ahash_int"], int)


def test_phash_uniform_image(tmp_path):
    # Uniform image: every pixel >= avg → all bits set
    p = tmp_path / "white.png"
    Image.new("RGB", (16, 16), "white").save(p)
    out = json.loads(oi.image_phash(str(p)))
    assert out["ahash_hex"] == "f" * 16


def test_phash_differs_for_different_images(tmp_path):
    p1 = tmp_path / "grad1.png"
    p2 = tmp_path / "grad2.png"
    img1 = Image.new("L", (64, 64))
    img1.putdata([i % 256 for i in range(64 * 64)])
    img1.save(p1)
    img2 = Image.new("L", (64, 64))
    img2.putdata([(255 - (i % 256)) for i in range(64 * 64)])
    img2.save(p2)
    h1 = json.loads(oi.image_phash(str(p1)))["ahash_hex"]
    h2 = json.loads(oi.image_phash(str(p2)))["ahash_hex"]
    assert h1 != h2


def test_reverse_image_urls_invalid():
    assert oi.reverse_image_urls("").startswith("ERREUR")
    assert oi.reverse_image_urls("not-a-url").startswith("ERREUR")


def test_reverse_image_urls_builds_all():
    out = json.loads(oi.reverse_image_urls("https://example.com/cat.jpg?id=1"))
    assert "lens.google.com/uploadbyurl" in out["google_lens"]
    assert "yandex.com/images/search" in out["yandex"]
    assert "tineye.com/search" in out["tineye"]
    assert "bing.com/images/search" in out["bing_visual"]
    # URL should be percent-encoded (no raw ? in the encoded payload)
    assert "%3Fid%3D1" in out["google_lens"]
