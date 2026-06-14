"""Smoke tests for new graphics/docs/media tools."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_tools_registered():
    from monkey import agent
    new = {"svg_shape", "image_to_svg", "image_to_heightmap_stl", "extract_palette",
           "resize_image", "convert_image", "ocr_image", "image_to_ascii",
           "generate_spritesheet", "tilemap_render",
           "qr_code", "barcode_generate", "vcard_create", "ics_event_create",
           "markdown_to_html", "json_to_csv", "csv_to_json",
           "audio_extract", "audio_convert", "video_thumbnail", "video_to_gif",
           "compress_archive", "extract_archive", "file_hash"}
    assert new.issubset(agent.TOOL_NAMES)


def test_svg_shape_circle(tmp_path):
    from monkey.tools.graphics import svg_shape
    out = svg_shape("circle", str(tmp_path / "c.svg"), 100, 100)
    assert out.startswith("OK:")
    assert (tmp_path / "c.svg").exists()
    assert "<circle" in (tmp_path / "c.svg").read_text()


def test_qr_code_png(tmp_path):
    from monkey.tools.docs import qr_code
    p = tmp_path / "q.png"
    out = qr_code("https://example.com", str(p))
    assert out.startswith("OK:")
    assert p.exists() and p.stat().st_size > 50


def test_qr_code_svg(tmp_path):
    from monkey.tools.docs import qr_code
    p = tmp_path / "q.svg"
    out = qr_code("hello", str(p))
    assert out.startswith("OK:")
    assert p.exists()


def test_vcard(tmp_path):
    from monkey.tools.docs import vcard_create
    p = tmp_path / "c.vcf"
    out = vcard_create(str(p), "Jean Dupont", email="j@d.fr", phone="+33600000000")
    assert out.startswith("OK:")
    txt = p.read_text()
    assert "BEGIN:VCARD" in txt and "Jean Dupont" in txt and "EMAIL" in txt


def test_ics_event(tmp_path):
    from monkey.tools.docs import ics_event_create
    p = tmp_path / "e.ics"
    out = ics_event_create(str(p), "Réunion", "2026-06-01 10:00", "2026-06-01 11:00")
    assert out.startswith("OK:")
    txt = p.read_text()
    assert "BEGIN:VEVENT" in txt and "DTSTART:20260601T100000" in txt


def test_ics_invalid_date(tmp_path):
    from monkey.tools.docs import ics_event_create
    out = ics_event_create(str(tmp_path / "x.ics"), "x", "pas-une-date")
    assert out.startswith("ERREUR:")


def test_json_csv_roundtrip(tmp_path):
    from monkey.tools.docs import json_to_csv, csv_to_json
    src = tmp_path / "d.json"
    src.write_text(json.dumps([{"a": "1", "b": "x"}, {"a": "2", "b": "y"}]))
    csv_p = tmp_path / "d.csv"
    out_p = tmp_path / "d2.json"
    assert json_to_csv(str(src), str(csv_p)).startswith("OK:")
    assert csv_to_json(str(csv_p), str(out_p)).startswith("OK:")
    rows = json.loads(out_p.read_text())
    assert len(rows) == 2 and rows[0]["a"] == "1"


def test_markdown_to_html(tmp_path):
    from monkey.tools.docs import markdown_to_html
    src = tmp_path / "in.md"
    src.write_text("# Titre\n\nUn paragraphe **gras**.\n")
    out_p = tmp_path / "out.html"
    assert markdown_to_html(str(src), str(out_p)).startswith("OK:")
    html = out_p.read_text()
    assert "<h1" in html and "<title>" in html


def test_compress_extract_roundtrip(tmp_path):
    from monkey.tools.media import compress_archive, extract_archive
    a = tmp_path / "a.txt"; a.write_text("alpha")
    b = tmp_path / "b.txt"; b.write_text("beta")
    arc = tmp_path / "out.zip"
    assert compress_archive([str(a), str(b)], str(arc)).startswith("OK:")
    dest = tmp_path / "ex"
    assert extract_archive(str(arc), str(dest)).startswith("OK:")
    assert (dest / "a.txt").read_text() == "alpha"


def test_file_hash(tmp_path):
    from monkey.tools.media import file_hash
    p = tmp_path / "x.txt"
    p.write_text("abc")
    out = file_hash(str(p), "sha256")
    assert out.startswith("OK:")
    assert "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" in out


def test_barcode_ean8(tmp_path):
    from monkey.tools.docs import barcode_generate
    out = barcode_generate("12345670", str(tmp_path / "b.svg"), "ean8")
    assert out.startswith("OK:")


def test_resize_image(tmp_path):
    try:
        from PIL import Image
    except ImportError:
        return
    src = tmp_path / "a.png"
    Image.new("RGB", (200, 100), "red").save(src)
    from monkey.tools.graphics import resize_image
    out_p = tmp_path / "b.png"
    out = resize_image(str(src), str(out_p), 50, 50, "stretch")
    assert out.startswith("OK:")
    img = Image.open(out_p)
    assert img.size == (50, 50)


def test_image_to_ascii(tmp_path):
    try:
        from PIL import Image
    except ImportError:
        return
    src = tmp_path / "a.png"
    Image.new("L", (40, 20), 128).save(src)
    from monkey.tools.graphics import image_to_ascii
    out = image_to_ascii(str(src), 20)
    assert out and not out.startswith("ERREUR")


def test_audio_extract_no_ffmpeg(tmp_path, monkeypatch):
    from monkey.tools import media as m
    monkeypatch.setattr(m, "_has_ffmpeg", lambda: False)
    out = m.audio_extract("foo.mp4", str(tmp_path / "o.mp3"))
    assert out.startswith("ERREUR")
