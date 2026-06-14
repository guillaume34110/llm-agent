"""Tests for bureautique tools: xlsx, docx, pptx, pdf, eml."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_office_tools_registered():
    from monkey import agent
    expected = {"xlsx_create","xlsx_read","xlsx_write_cells","xlsx_append_rows","xlsx_to_csv",
                "docx_create","docx_read","docx_replace",
                "pptx_create","pptx_read",
                "pdf_extract_text","pdf_merge","pdf_split","pdf_extract_pages",
                "pdf_rotate","pdf_metadata","pdf_add_watermark","pdf_encrypt",
                "eml_create","eml_read"}
    assert expected.issubset(agent.TOOL_NAMES)


def test_xlsx_roundtrip(tmp_path):
    from monkey.tools.office import xlsx_create, xlsx_read, xlsx_append_rows, xlsx_write_cells
    p = tmp_path / "a.xlsx"
    assert xlsx_create(str(p), {"Data": [["Nom", "Age"], ["Alice", 30]]}).startswith("OK:")
    assert xlsx_append_rows(str(p), "Data", [["Bob", 25]]).startswith("OK:")
    assert xlsx_write_cells(str(p), "Data", {"C1": "Total", "C2": "=B2*2"}).startswith("OK:")
    out = xlsx_read(str(p))
    data = json.loads(out)
    assert "Data" in data
    assert data["Data"][0][:2] == ["Nom", "Age"]
    assert data["Data"][1][0] == "Alice"


def test_xlsx_to_csv(tmp_path):
    from monkey.tools.office import xlsx_create, xlsx_to_csv
    p = tmp_path / "a.xlsx"
    xlsx_create(str(p), {"S": [["a", "b"], [1, 2]]})
    out_p = tmp_path / "a.csv"
    assert xlsx_to_csv(str(p), str(out_p)).startswith("OK:")
    assert "a,b" in out_p.read_text()


def test_docx_create_read(tmp_path):
    from monkey.tools.office import docx_create, docx_read
    p = tmp_path / "d.docx"
    assert docx_create(str(p), title="Rapport",
                       content="# Intro\nTexte\n## Section\n- bullet").startswith("OK:")
    txt = docx_read(str(p))
    assert "Rapport" in txt and "Intro" in txt and "bullet" in txt


def test_docx_replace(tmp_path):
    from monkey.tools.office import docx_create, docx_replace, docx_read
    p = tmp_path / "d.docx"
    docx_create(str(p), paragraphs=["Cher {{name}}, votre commande {{order}}."])
    assert docx_replace(str(p), {"{{name}}": "Alice", "{{order}}": "#42"}).startswith("OK:")
    txt = docx_read(str(p))
    assert "Alice" in txt and "#42" in txt and "{{" not in txt


def test_pptx_create_read(tmp_path):
    from monkey.tools.office import pptx_create, pptx_read
    p = tmp_path / "p.pptx"
    slides = [{"title": "Premier", "content": ["A", "B"]},
              {"title": "Second", "content": "Texte simple"}]
    assert pptx_create(str(p), slides).startswith("OK:")
    txt = pptx_read(str(p))
    assert "Premier" in txt and "Second" in txt and "Texte simple" in txt


def test_pdf_merge_extract_split(tmp_path):
    from monkey.tools.files import generate_pdf
    from monkey.tools.office import pdf_merge, pdf_extract_text, pdf_split, pdf_extract_pages, pdf_metadata
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    generate_pdf(str(a), content="Page A unique content", title="A")
    generate_pdf(str(b), content="Page B different content", title="B")
    merged = tmp_path / "m.pdf"
    assert pdf_merge([str(a), str(b)], str(merged)).startswith("OK:")
    txt = pdf_extract_text(str(merged))
    assert "Page A" in txt and "Page B" in txt
    meta = json.loads(pdf_metadata(str(merged)))
    assert meta["pages"] == 2
    split_dir = tmp_path / "split"
    assert pdf_split(str(merged), str(split_dir)).startswith("OK:")
    assert len(list(split_dir.glob("*.pdf"))) == 2
    page1 = tmp_path / "p1.pdf"
    assert pdf_extract_pages(str(merged), "1", str(page1)).startswith("OK:")
    assert json.loads(pdf_metadata(str(page1)))["pages"] == 1


def test_pdf_rotate_watermark_encrypt(tmp_path):
    from monkey.tools.files import generate_pdf
    from monkey.tools.office import pdf_rotate, pdf_add_watermark, pdf_encrypt
    src = tmp_path / "s.pdf"
    generate_pdf(str(src), content="contenu test")
    assert pdf_rotate(str(src), str(tmp_path / "r.pdf"), 90).startswith("OK:")
    assert pdf_add_watermark(str(src), str(tmp_path / "w.pdf"), "BROUILLON").startswith("OK:")
    enc = tmp_path / "e.pdf"
    assert pdf_encrypt(str(src), str(enc), "secret").startswith("OK:")
    from pypdf import PdfReader
    assert PdfReader(str(enc)).is_encrypted


def test_eml_roundtrip(tmp_path):
    from monkey.tools.office import eml_create, eml_read
    att = tmp_path / "att.txt"
    att.write_text("hello attachment")
    p = tmp_path / "m.eml"
    assert eml_create(str(p), to="a@b.fr", subject="Sujet", body="Bonjour",
                      from_addr="me@ex.fr", attachments=[str(att)]).startswith("OK:")
    parsed = json.loads(eml_read(str(p)))
    assert parsed["to"] == "a@b.fr"
    assert parsed["subject"] == "Sujet"
    assert "Bonjour" in parsed["body"]
    assert any(a["filename"] == "att.txt" for a in parsed["attachments"])
