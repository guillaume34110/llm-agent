"""Audit test: PDF reading flow end-to-end."""
import os
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from monkey.tools.files import read_file
from monkey.tools.office import pdf_extract_text, pdf_metadata


def _make_text_pdf(path: Path, pages: int = 3, content_per_page: str | None = None) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    for i in range(pages):
        text = content_per_page or f"Page {i+1} body. Quick brown fox jumps over the lazy dog."
        c.setFont("Helvetica-Bold", 18)
        c.drawString(72, 720, f"Document title - section {i+1}")
        c.setFont("Helvetica", 12)
        y = 680
        for j, line in enumerate(text.split(". ")):
            c.drawString(72, y - j * 18, line.strip())
        c.showPage()
    c.save()


def _make_large_pdf(path: Path, pages: int = 20) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    long_para = "Lorem ipsum dolor sit amet consectetur adipiscing elit. " * 30
    for i in range(pages):
        c.setFont("Helvetica", 10)
        y = 750
        for line_idx, chunk in enumerate(_chunks(long_para, 90)):
            if y < 50:
                break
            c.drawString(50, y, chunk)
            y -= 12
        c.drawString(50, 30, f"-- Page {i+1}/{pages} --")
        c.showPage()
    c.save()


def _chunks(s: str, n: int):
    for i in range(0, len(s), n):
        yield s[i:i + n]


def test_read_file_rejects_pdf(tmp_path: Path):
    pdf = tmp_path / "doc.pdf"
    _make_text_pdf(pdf, pages=1)
    out = read_file(str(pdf))
    assert out.startswith("ERREUR:"), f"Expected ERREUR: prefix, got: {out[:200]}"
    assert "pdf_extract_text" in out, f"Should suggest pdf_extract_text. Got: {out}"


def test_pdf_extract_text_basic(tmp_path: Path):
    pdf = tmp_path / "basic.pdf"
    _make_text_pdf(pdf, pages=3)
    out = pdf_extract_text(str(pdf))
    assert "Page 1/3" in out
    assert "Page 2/3" in out
    assert "Page 3/3" in out
    assert "Quick brown fox" in out
    assert "section 1" in out
    assert not out.startswith("ERREUR")


def test_pdf_extract_text_page_range(tmp_path: Path):
    pdf = tmp_path / "range.pdf"
    _make_text_pdf(pdf, pages=5)
    out = pdf_extract_text(str(pdf), pages="2-3")
    assert "Page 2/5" in out
    assert "Page 3/5" in out
    assert "Page 1/5" not in out
    assert "Page 4/5" not in out


def test_pdf_extract_text_truncation_signal(tmp_path: Path):
    pdf = tmp_path / "big.pdf"
    _make_large_pdf(pdf, pages=20)
    out = pdf_extract_text(str(pdf))
    # Should fit some pages, then truncate explicitly
    assert "Page 1/20" in out
    if "TRUNCATED" in out:
        assert "pages='" in out, "Truncation message must suggest a continuation page range"
    # Total size kept reasonable
    assert len(out) < 25000, f"output too big: {len(out)}"


def test_pdf_metadata(tmp_path: Path):
    pdf = tmp_path / "meta.pdf"
    _make_text_pdf(pdf, pages=2)
    out = pdf_metadata(str(pdf))
    # pdf_metadata uses pypdf and returns a stringified dict / JSON-ish
    assert not out.startswith("ERREUR"), f"got: {out}"
    assert "2" in out  # page count somewhere


def test_pdf_extract_missing_file(tmp_path: Path):
    out = pdf_extract_text(str(tmp_path / "nope.pdf"))
    assert out.startswith("ERREUR:")
    assert "introuvable" in out


def test_read_file_rejects_image(tmp_path: Path):
    img = tmp_path / "pic.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    out = read_file(str(img))
    assert out.startswith("ERREUR:")
    assert "ocr_image" in out


def test_read_file_still_reads_text(tmp_path: Path):
    txt = tmp_path / "note.txt"
    txt.write_text("hello world")
    out = read_file(str(txt))
    assert "hello world" in out
    assert not out.startswith("ERREUR:")
