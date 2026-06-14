"""Document/data tools: QR, barcode, vCard, ICS, markdown→HTML, JSON/CSV utils."""
from __future__ import annotations
import csv
import io
import json
from datetime import datetime
from pathlib import Path

from monkey.tools.files import _resolve


def _ok(m: str) -> str: return f"OK: {m}"
def _err(m: str) -> str: return f"ERREUR: {m}"


def qr_code(data: str, path: str, box_size: int = 10, border: int = 4,
            fill: str = "#000000", back: str = "#ffffff") -> str:
    """Generate a QR code PNG or SVG (auto-detected from extension)."""
    try:
        import qrcode
    except ImportError:
        return _err("qrcode manquant (pip install 'qrcode[pil]')")
    if not data:
        return _err("data vide")
    p = _resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    qr = qrcode.QRCode(box_size=box_size, border=border)
    qr.add_data(data)
    qr.make(fit=True)
    ext = p.suffix.lower()
    if ext == ".svg":
        try:
            import qrcode.image.svg as qsvg
            img = qr.make_image(image_factory=qsvg.SvgImage)
        except Exception as e:
            return _err(f"svg backend: {e}")
        img.save(str(p))
    else:
        img = qr.make_image(fill_color=fill, back_color=back)
        img.save(str(p))
    return _ok(f"QR → {p} ({len(data)} chars)")


def barcode_generate(data: str, path: str, kind: str = "code128") -> str:
    """Generate a barcode (code128, ean13, ean8, upc, isbn13). SVG by default; PNG if path ends in .png."""
    try:
        import barcode
        from barcode.writer import ImageWriter, SVGWriter
    except ImportError:
        return _err("python-barcode manquant")
    if not data:
        return _err("data vide")
    p = _resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    kind = kind.lower().strip()
    try:
        cls = barcode.get_barcode_class(kind)
    except Exception as e:
        return _err(f"type inconnu: {kind} ({e})")
    is_png = p.suffix.lower() in (".png", ".jpg", ".jpeg")
    writer = ImageWriter() if is_png else SVGWriter()
    try:
        bc = cls(data, writer=writer)
    except Exception as e:
        return _err(f"data invalide pour {kind}: {e}")
    full = bc.save(str(p.with_suffix("")))  # adds extension itself
    return _ok(f"barcode {kind} → {full}")


def vcard_create(path: str, full_name: str, email: str = "", phone: str = "",
                 organization: str = "", title: str = "", url: str = "",
                 address: str = "", note: str = "") -> str:
    """Generate a .vcf vCard 3.0 file."""
    if not full_name:
        return _err("full_name requis")
    parts = full_name.split(" ", 1)
    last = parts[1] if len(parts) > 1 else ""
    first = parts[0]
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"N:{last};{first};;;", f"FN:{full_name}"]
    if organization: lines.append(f"ORG:{organization}")
    if title: lines.append(f"TITLE:{title}")
    if email: lines.append(f"EMAIL;TYPE=INTERNET:{email}")
    if phone: lines.append(f"TEL;TYPE=CELL:{phone}")
    if url: lines.append(f"URL:{url}")
    if address: lines.append(f"ADR;TYPE=HOME:;;{address};;;;")
    if note: lines.append(f"NOTE:{note}")
    lines.append("END:VCARD")
    p = _resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return _ok(f"vCard → {p}")


def ics_event_create(path: str, title: str, start: str, end: str = "",
                     location: str = "", description: str = "") -> str:
    """Generate an .ics calendar file. start/end format: 'YYYY-MM-DD HH:MM' (local)."""
    if not title or not start:
        return _err("title et start requis")
    def _fmt(s: str) -> str:
        try:
            dt = datetime.strptime(s.strip(), "%Y-%m-%d %H:%M")
        except ValueError:
            try:
                dt = datetime.strptime(s.strip(), "%Y-%m-%d")
            except ValueError as e:
                raise ValueError(f"date invalide: {s} ({e})")
        return dt.strftime("%Y%m%dT%H%M%S")
    try:
        dtstart = _fmt(start)
        dtend = _fmt(end) if end else dtstart
    except ValueError as e:
        return _err(str(e))
    uid = f"{datetime.now().strftime('%Y%m%dT%H%M%S')}-{abs(hash(title)) % 10**8}@monkey"
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Monkey//Agent//EN",
        "BEGIN:VEVENT", f"UID:{uid}",
        f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART:{dtstart}", f"DTEND:{dtend}", f"SUMMARY:{title}",
    ]
    if location: lines.append(f"LOCATION:{location}")
    if description: lines.append(f"DESCRIPTION:{description}")
    lines += ["END:VEVENT", "END:VCALENDAR"]
    p = _resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return _ok(f"ICS → {p}")


def markdown_to_html(input_path: str, output_path: str, title: str = "") -> str:
    """Convert a markdown file to a styled standalone HTML page."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier introuvable: {src}")
    md_text = src.read_text(encoding="utf-8", errors="ignore")
    try:
        import markdown as _md
        body = _md.markdown(md_text, extensions=["extra", "tables", "fenced_code", "toc"])
    except ImportError:
        # Minimal fallback: paragraphs + headers + code fences only
        import re
        body = md_text
        body = re.sub(r"^### (.+)$", r"<h3>\1</h3>", body, flags=re.M)
        body = re.sub(r"^## (.+)$", r"<h2>\1</h2>", body, flags=re.M)
        body = re.sub(r"^# (.+)$", r"<h1>\1</h1>", body, flags=re.M)
        body = re.sub(r"```(\w*)\n(.*?)```", r"<pre><code>\2</code></pre>", body, flags=re.S)
        body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", body)
        body = re.sub(r"\*(.+?)\*", r"<em>\1</em>", body)
        body = "\n".join(f"<p>{l}</p>" if l.strip() and not l.startswith("<") else l
                         for l in body.split("\n"))
    title = title or src.stem
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>{title}</title>
<style>body{{font-family:-apple-system,system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1f2937}}
h1,h2,h3{{color:#0f172a}} pre{{background:#f3f4f6;padding:1rem;border-radius:8px;overflow:auto}}
code{{font-family:ui-monospace,monospace;background:#f3f4f6;padding:0.1em 0.3em;border-radius:3px}}
pre code{{background:none;padding:0}} table{{border-collapse:collapse}} th,td{{border:1px solid #e5e7eb;padding:.4rem .8rem}}
a{{color:#2563eb}}</style></head><body>{body}</body></html>"""
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return _ok(f"HTML → {out}")


def json_to_csv(input_path: str, output_path: str) -> str:
    """Convert a JSON array of objects to CSV."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier introuvable: {src}")
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except Exception as e:
        return _err(f"JSON invalide: {e}")
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return _err("attendu: array d'objets")
    keys = list({k for row in data for k in row.keys()})
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for row in data:
            w.writerow(row)
    return _ok(f"CSV → {out} ({len(data)} lignes, {len(keys)} colonnes)")


def csv_to_json(input_path: str, output_path: str) -> str:
    """Convert a CSV file to a JSON array of objects."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier introuvable: {src}")
    rows = []
    with open(src, "r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return _ok(f"JSON → {out} ({len(rows)} lignes)")
