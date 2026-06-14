"""Safe file operations."""
import os
import re
import json
from pathlib import Path

CHUNK_SIZE = 6000
CSS_EXTS = {'.css', '.scss', '.less', '.sass'}
BINARY_EXTS = {
    '.pdf': 'pdf_extract_text(path)',
    '.docx': 'docx_read(path)', '.doc': 'docx_read(path)',
    '.xlsx': 'xlsx_read(path)', '.xls': 'xlsx_read(path)',
    '.pptx': 'pptx_read(path)', '.ppt': 'pptx_read(path)',
    '.png': 'ocr_image(path) or analyze_image(path)',
    '.jpg': 'ocr_image(path) or analyze_image(path)',
    '.jpeg': 'ocr_image(path) or analyze_image(path)',
    '.gif': 'ocr_image(path) or analyze_image(path)',
    '.webp': 'ocr_image(path) or analyze_image(path)',
    '.bmp': 'ocr_image(path) or analyze_image(path)',
    '.tiff': 'ocr_image(path) or analyze_image(path)',
    '.mp3': 'audio_extract(path)', '.wav': 'audio_extract(path)',
    '.mp4': 'video_thumbnail(path)', '.mov': 'video_thumbnail(path)',
    '.zip': 'extract_archive(path)', '.tar': 'extract_archive(path)', '.gz': 'extract_archive(path)',
}
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.svg'}


def _get_workspace() -> Path:
    config_file = Path.home() / ".monkey" / "config.json"
    default_ws = Path.home() / "Documents" / "Agent"
    try:
        ws = Path(json.loads(config_file.read_text()).get("workspace", str(default_ws)))
    except Exception:
        ws = default_ws
    ws.mkdir(parents=True, exist_ok=True)
    return ws


def _resolve(path: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = _get_workspace() / p
    return p


def read_file(path: str, max_chars: int = 8000) -> str:
    try:
        p = _resolve(path)
        ext = p.suffix.lower()
        if ext in BINARY_EXTS:
            hint = BINARY_EXTS[ext]
            return (
                f"ERREUR: read_file ne lit pas les binaires ({ext}). "
                f"Use {hint}. If the tool is missing, call expand_tools(['media']) first."
            )
        content = p.read_text(errors="ignore")
        size = len(content)
        ext = p.suffix.lower()
        if ext in CSS_EXTS and size > 2000:
            return f"[Stylesheet truncated to 2000 chars]\n\n{content[:2000]}"
        if size <= CHUNK_SIZE:
            return content
        n = (size + CHUNK_SIZE - 1) // CHUNK_SIZE
        return f"File of {size} chars ({n} chunks). Chunk 1/{n}. Use read_file_chunk for the rest.\n\n{content[:CHUNK_SIZE]}"
    except Exception as e:
        return f"Error: {e}"


def read_file_chunk(path: str, chunk: int = 1) -> str:
    try:
        p = _resolve(path)
        content = p.read_text(errors="ignore")
        size = len(content)
        n = max(1, (size + CHUNK_SIZE - 1) // CHUNK_SIZE)
        idx = max(1, min(chunk, n))
        start = (idx - 1) * CHUNK_SIZE
        return f"Chunk {idx}/{n} de '{p}'\n\n{content[start:start + CHUNK_SIZE]}"
    except Exception as e:
        return f"Error: {e}"


def edit_file(path: str, old_str: str, new_str: str) -> str:
    try:
        p = _resolve(path)
        content = p.read_text()
        count = content.count(old_str)
        if count == 0:
            return f"Erreur: chaîne introuvable dans {p}"
        if count > 1:
            return f"Erreur: {count} occurrences trouvées — fournis plus de contexte"
        p.write_text(content.replace(old_str, new_str, 1))
        return f"OK: {p} modifié"
    except Exception as e:
        return f"Error: {e}"


def append_to_file(path: str, content: str) -> str:
    try:
        p = _resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'a') as f:
            f.write(content)
        return f"OK: ajouté à {p}"
    except Exception as e:
        return f"Error: {e}"


_NEST_RE = re.compile(r"(?:^|/)(games|projects|apps)/[^/]+/\1/", re.IGNORECASE)


def _detect_path_nesting(path: str) -> str | None:
    """Reject obvious context-bleed paths like 'games/foo/games/bar/...'.

    Returns an error message if nested, None if clean.
    """
    norm = path.replace("\\", "/")
    m = _NEST_RE.search(norm)
    if m:
        seg = m.group(1)
        return (
            f"chemin imbriqué détecté ({seg}/X/{seg}/Y…). "
            f"Tu confonds avec un projet précédent. "
            f"Utilise un chemin propre type '{seg}/<nom-projet>/...' sans répéter '{seg}/'."
        )
    parts = [p for p in norm.split("/") if p]
    for i in range(len(parts) - 2):
        if parts[i] == parts[i + 2] and parts[i] not in {"src", "test", "tests", "lib", "components", "pages", "utils", "types", "hooks", "api", "packages", "node_modules", "vendor", "dist", "build", "public", "assets", "static"}:
            return (
                f"chemin imbriqué détecté (segment '{parts[i]}' répété aux positions {i} et {i+2}). "
                f"Vérifie le path — probable contamination depuis un projet précédent."
            )
    return None


def write_file(path: str, content: str) -> str:
    try:
        nest_err = _detect_path_nesting(path)
        if nest_err:
            return f"ERREUR: {nest_err}"
        p = _resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return f"OK: fichier écrit → {p} ({len(content)} caractères)"
    except Exception as e:
        return f"ERREUR écriture fichier: {e}"


def list_dir(path: str = "", depth: int = 1) -> str:
    try:
        target = Path(path).expanduser() if path else _get_workspace()
        if not target.is_absolute():
            target = _get_workspace() / target
        if depth <= 1:
            items = sorted(os.listdir(target))
            return "\n".join(items) if items else "(dossier vide)"
        results = []
        skip = {'node_modules', 'dist', 'build', '__pycache__', '.git'}
        def walk(d: Path, current_depth: int, prefix: str = ""):
            if current_depth >= depth:
                return
            try:
                entries = sorted(d.iterdir(), key=lambda x: x.name)
            except PermissionError:
                return
            for e in entries:
                if e.name.startswith('.') or e.name in skip:
                    continue
                rel = prefix + e.name
                if e.is_dir():
                    results.append(rel + "/")
                    walk(e, current_depth + 1, rel + "/")
                else:
                    results.append(rel)
        walk(target, 0)
        return "\n".join(results) if results else "(dossier vide)"
    except Exception as e:
        return f"Error: {e}"


_SIMILAR_SKIP_DIRS = {
    "node_modules", "dist", "build", "__pycache__", ".git", "vendor",
    ".cache", "site-packages", ".venv", "venv", "target", ".next", "coverage",
}


def _find_similar_directory(target: Path) -> Path | None:
    """Best-effort fuzzy match for a missing directory name. Conservative on
    purpose: a loose `cand in name` test used to match single-letter dirs
    (e.g. 'grenouilles' -> node_modules/.../categories/S because 's' is in
    'grenouilles'), so we now require a real similarity ratio and skip junk."""
    try:
        import difflib
        workspace = _get_workspace().resolve()
        name = target.name.lower().strip()
        if len(name) < 3:
            return None
        scored: list[tuple[float, int, Path]] = []
        for candidate in workspace.rglob("*"):
            if not candidate.is_dir():
                continue
            if any(part.startswith(".") for part in candidate.parts):
                continue
            if any(part in _SIMILAR_SKIP_DIRS for part in candidate.parts):
                continue
            cand_name = candidate.name.lower()
            if len(cand_name) < 3:
                continue
            if name == cand_name:
                ratio = 1.0
            elif name in cand_name or cand_name in name:
                shorter, longer = sorted((name, cand_name), key=len)
                # substring only counts if it covers most of the longer name
                ratio = 0.9 if len(shorter) / len(longer) >= 0.6 else 0.0
            else:
                ratio = difflib.SequenceMatcher(None, name, cand_name).ratio()
            if ratio >= 0.75:
                scored.append((ratio, len(str(candidate)), candidate.resolve()))
                if len(scored) >= 50:
                    break
        if not scored:
            return None
        scored.sort(key=lambda t: (-t[0], t[1], str(t[2])))
        return scored[0][2]
    except Exception:
        return None


def list_dir_images(path: str = "", recursive: bool = True, limit: int = 12) -> str:
    """List image files in a directory and return structured JSON for inline rendering."""
    try:
        target = Path(path).expanduser() if path else _get_workspace()
        if not target.is_absolute():
            target = _get_workspace() / target
        target = target.resolve()
        if not target.exists():
            similar = _find_similar_directory(target)
            if similar is not None:
                target = similar
            else:
                return f"ERREUR: directory not found: {target}"
        if not target.is_dir():
            return f"ERREUR: not a directory: {target}"

        workspace = _get_workspace().resolve()
        walker = target.rglob("*") if recursive else target.glob("*")
        matches: list[Path] = []
        for candidate in walker:
            if not candidate.is_file():
                continue
            if candidate.suffix.lower() not in IMAGE_EXTS:
                continue
            if any(part.startswith(".") for part in candidate.parts):
                continue
            matches.append(candidate.resolve())
        matches.sort()
        items = []
        for img in matches[: max(1, min(int(limit or 12), 24))]:
            try:
                relative = img.relative_to(workspace).as_posix()
            except Exception:
                relative = img.as_posix()
            items.append({
                "name": img.name,
                "path": str(img),
                "relativePath": relative,
                "sizeBytes": int(img.stat().st_size),
            })
        return json.dumps({
            "directory": str(target),
            "count": len(matches),
            "truncated": len(matches) > len(items),
            "images": items,
        }, ensure_ascii=False)
    except Exception as e:
        return f"Error: {e}"


def grep_files(pattern: str, path: str, file_pattern: str = "*", context_lines: int = 2) -> str:
    try:
        import subprocess
        p = Path(path).expanduser()
        if not p.is_absolute():
            p = _get_workspace() / p
        cmd = ["grep", "-rn", f"--include={file_pattern}", "-E", pattern, str(p)]
        if context_lines > 0:
            cmd += [f"-A{context_lines}", f"-B{context_lines}"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        # Hard cap raw output to 100KB before slicing (prevents OOM on huge stdouts)
        raw = (result.stdout or "")[:100_000]
        raw = raw.strip()
        if not raw:
            return f"Aucun résultat pour '{pattern}' dans {p}"
        return raw[:8000]
    except Exception as e:
        return f"Error: {e}"


def _md_inline(text: str) -> str:
    """Convert inline markdown to HTML."""
    import html as _html
    text = _html.escape(text)
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*(.*?)\*', r'<em>\1</em>', text)
    text = re.sub(r'__(.*?)__', r'<strong>\1</strong>', text)
    text = re.sub(r'_(.*?)_', r'<em>\1</em>', text)
    text = re.sub(r'`(.*?)`', r'<code>\1</code>', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)  # strip links, keep text
    return text


def _content_to_html(content: str, title: str) -> str:
    """Convert markdown to a professional PDF-ready HTML document."""
    import datetime
    lines = content.split('\n')
    parts: list[str] = []
    i = 0
    in_blockquote = False

    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        # Close blockquote if we leave it
        if in_blockquote and not s.startswith('> '):
            parts.append('</blockquote>')
            in_blockquote = False

        if not s:
            parts.append('<div class="vspace"></div>')
        elif s.startswith('#### '):
            parts.append(f'<h4>{_md_inline(s[5:])}</h4>')
        elif s.startswith('### '):
            parts.append(f'<h3><span class="h3-marker">◆</span>{_md_inline(s[4:])}</h3>')
        elif s.startswith('## '):
            parts.append(f'<h2>{_md_inline(s[3:])}</h2>')
        elif s.startswith('# '):
            parts.append(f'<h1>{_md_inline(s[2:])}</h1>')
        elif s.startswith('> '):
            if not in_blockquote:
                parts.append('<blockquote>')
                in_blockquote = True
            parts.append(f'<p>{_md_inline(s[2:])}</p>')
        elif s.startswith(('- ', '* ', '+ ', '• ')):
            items = []
            while i < len(lines):
                ls = lines[i].strip()
                if not ls or ls[0] not in '-*+•':
                    break
                item = ls[2:] if len(ls) > 1 and ls[1] == ' ' else ls[1:]
                items.append(f'<li>{_md_inline(item.strip())}</li>')
                i += 1
            parts.append('<ul>' + ''.join(items) + '</ul>')
            continue
        elif re.match(r'^\d+\.\s', s):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i].strip()):
                item = re.sub(r'^\d+\.\s', '', lines[i].strip())
                items.append(f'<li>{_md_inline(item)}</li>')
                i += 1
            parts.append('<ol>' + ''.join(items) + '</ol>')
            continue
        elif s.startswith('```'):
            # Code block
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                import html as _h; code_lines.append(_h.escape(lines[i]))
                i += 1
            parts.append('<pre><code>' + '\n'.join(code_lines) + '</code></pre>')
        elif s.startswith('|') and '|' in s[1:]:
            # Markdown table
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = lines[i].strip()
                if re.match(r'^\|[\s\-\|:]+\|$', row):
                    i += 1; continue  # separator row
                cells = [c.strip() for c in row.strip('|').split('|')]
                rows.append(cells)
                i += 1
            if rows:
                thead = '<tr>' + ''.join(f'<th>{_md_inline(c)}</th>' for c in rows[0]) + '</tr>'
                tbody = ''.join('<tr>' + ''.join(f'<td>{_md_inline(c)}</td>' for c in r) + '</tr>' for r in rows[1:])
                parts.append(f'<table><thead>{thead}</thead><tbody>{tbody}</tbody></table>')
            continue
        elif re.match(r'^[-=]{3,}$', s):
            parts.append('<hr>')
        else:
            parts.append(f'<p>{_md_inline(s)}</p>')
        i += 1

    if in_blockquote:
        parts.append('</blockquote>')

    date_str = datetime.datetime.now().strftime('%d/%m/%Y')
    header_html = ''
    if title:
        header_html = f'''<div class="doc-header">
  <div class="doc-title">{_md_inline(title)}</div>
  <div class="doc-meta">Document généré le {date_str}</div>
</div>'''

    css = """
@page {
  size: A4;
  margin: 20mm 22mm 22mm 22mm;
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-family: Arial, sans-serif;
    font-size: 8pt;
    color: #999;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif;
  font-size: 10.5pt;
  line-height: 1.7;
  color: #1c1c2e;
  background: #fff;
}
.doc-header {
  background: #0d1b2a;
  color: #fff;
  padding: 24px 28px 20px;
  margin-bottom: 26px;
  page-break-inside: avoid;
  border-left: 6px solid #4fc3f7;
}
.doc-title {
  font-size: 22pt;
  font-weight: 700;
  letter-spacing: -0.2px;
  line-height: 1.25;
  color: #fff;
}
.doc-meta {
  font-size: 8.5pt;
  color: #90caf9;
  margin-top: 6px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
h1 {
  font-size: 15pt;
  font-weight: 700;
  color: #0d1b2a;
  margin: 22px 0 10px;
  padding-bottom: 6px;
  border-bottom: 2px solid #0d1b2a;
  page-break-after: avoid;
}
h2 {
  font-size: 12.5pt;
  font-weight: 700;
  color: #0d1b2a;
  background: #e8f4fd;
  padding: 7px 14px 7px 16px;
  margin: 20px 0 9px;
  border-left: 4px solid #1565c0;
  page-break-after: avoid;
}
h3 {
  font-size: 11pt;
  font-weight: 600;
  color: #1565c0;
  margin: 14px 0 5px;
  page-break-after: avoid;
}
.h3-marker {
  color: #e53935;
  margin-right: 6px;
  font-size: 7pt;
}
h4 {
  font-size: 10.5pt;
  font-weight: 600;
  color: #333;
  margin: 10px 0 4px;
  page-break-after: avoid;
}
p {
  margin: 0 0 7px;
  text-align: justify;
  orphans: 3;
  widows: 3;
}
ul {
  margin: 4px 0 9px 0;
  padding-left: 0;
  list-style: none;
}
ul li {
  padding-left: 18px;
  margin: 4px 0;
  line-height: 1.6;
  position: relative;
}
ul li::before {
  content: "▸";
  color: #e53935;
  position: absolute;
  left: 0;
  font-size: 8pt;
  top: 2px;
}
ol {
  margin: 4px 0 9px 22px;
  padding: 0;
}
ol li {
  margin: 4px 0;
  line-height: 1.6;
}
ol li::marker { color: #1565c0; font-weight: 700; }
blockquote {
  border-left: 4px solid #1565c0;
  margin: 10px 0;
  padding: 8px 14px;
  background: #f5f9ff;
  color: #444;
  font-style: italic;
}
blockquote p { margin: 3px 0; }
hr {
  border: none;
  border-top: 1px solid #dde;
  margin: 16px 0;
}
code {
  background: #f4f4f8;
  padding: 1px 5px;
  font-size: 9pt;
  font-family: 'Courier New', 'Liberation Mono', monospace;
  color: #c0392b;
}
pre {
  background: #f4f4f8;
  border: 1px solid #e0e0e0;
  border-left: 3px solid #1565c0;
  padding: 10px 14px;
  margin: 8px 0 10px;
  font-size: 8.5pt;
  font-family: 'Courier New', 'Liberation Mono', monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
pre code { background: none; padding: 0; color: inherit; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0 12px;
  font-size: 9.5pt;
}
th {
  background: #0d1b2a;
  color: #fff;
  padding: 7px 10px;
  text-align: left;
  font-weight: 600;
}
td {
  padding: 6px 10px;
  border-bottom: 1px solid #e8e8f0;
  vertical-align: top;
}
tr:nth-child(even) td { background: #f7f9ff; }
strong { font-weight: 700; }
em { font-style: italic; color: #333; }
.vspace { height: 4px; }
"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>{css}</style>
</head>
<body>
{header_html}
{''.join(parts)}
</body>
</html>"""


def _rl_inline(text: str) -> str:
    """Convert inline markdown to ReportLab XML tags."""
    import html as _html
    text = _html.escape(text)
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    text = re.sub(r'__(.*?)__', r'<b>\1</b>', text)
    text = re.sub(r'_(.*?)_', r'<i>\1</i>', text)
    text = re.sub(r'`(.*?)`', r'<font face="Courier" size="9"><b>\1</b></font>', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    return text


def _generate_pdf_reportlab(p: Path, content: str, title: str):
    """Professional PDF via ReportLab Platypus — pure Python, works in PyInstaller."""
    import datetime
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, HRFlowable, Preformatted)
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY, TA_CENTER

    # ── Colour palette ──────────────────────────────────────────────
    C_NAVY   = colors.HexColor('#0d1b2a')
    C_BLUE   = colors.HexColor('#1565c0')
    C_LBLUE  = colors.HexColor('#e8f4fd')
    C_ACCENT = colors.HexColor('#4fc3f7')
    C_RED    = colors.HexColor('#e53935')
    C_GREY   = colors.HexColor('#666666')
    C_LGREY  = colors.HexColor('#f4f4f8')
    C_BORDER = colors.HexColor('#e0e0e0')

    # ── Paragraph styles ────────────────────────────────────────────
    def ps(name, **kw):
        defaults = dict(fontName='Helvetica', fontSize=10.5, leading=16,
                        textColor=colors.HexColor('#1c1c2e'), alignment=TA_JUSTIFY,
                        spaceAfter=5, spaceBefore=0)
        defaults.update(kw)
        return ParagraphStyle(name, **defaults)

    ST = {
        'body':  ps('body'),
        'h1':    ps('h1',  fontName='Helvetica-Bold', fontSize=15, leading=20,
                    textColor=C_NAVY, spaceBefore=14, spaceAfter=8, alignment=TA_LEFT,
                    borderPadding=(0, 0, 4, 0)),
        'h2':    ps('h2',  fontName='Helvetica-Bold', fontSize=12.5, leading=17,
                    textColor=C_NAVY, spaceBefore=14, spaceAfter=7,
                    backColor=C_LBLUE, borderPadding=(6, 12, 6, 14), alignment=TA_LEFT,
                    borderColor=C_BLUE, borderWidth=0, leftIndent=0),
        'h3':    ps('h3',  fontName='Helvetica-Bold', fontSize=11, leading=15,
                    textColor=C_BLUE, spaceBefore=10, spaceAfter=5, alignment=TA_LEFT),
        'h4':    ps('h4',  fontName='Helvetica-Bold', fontSize=10.5, leading=14,
                    textColor=colors.HexColor('#333333'), spaceBefore=8, spaceAfter=4,
                    alignment=TA_LEFT),
        'bullet': ps('bullet', leftIndent=16, firstLineIndent=0, spaceAfter=3,
                     bulletIndent=0, alignment=TA_LEFT),
        'code':  ps('code', fontName='Courier', fontSize=8.5, leading=12,
                    backColor=C_LGREY, leftIndent=10, rightIndent=10,
                    spaceBefore=6, spaceAfter=6, alignment=TA_LEFT),
        'quote': ps('quote', fontName='Helvetica-Oblique', fontSize=10,
                    textColor=colors.HexColor('#444444'), leftIndent=14,
                    backColor=colors.HexColor('#f5f9ff'), spaceBefore=6, spaceAfter=6,
                    alignment=TA_LEFT),
        'meta':  ps('meta', fontName='Helvetica', fontSize=8, textColor=C_ACCENT,
                    alignment=TA_LEFT),
        'title_h': ps('title_h', fontName='Helvetica-Bold', fontSize=22, leading=28,
                      textColor=colors.white, alignment=TA_LEFT),
    }

    # ── Page footer with page numbers ───────────────────────────────
    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(C_GREY)
        w, h = A4
        canvas.drawCentredString(w / 2, 12 * mm, f'{doc.page}')
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(p), pagesize=A4,
        leftMargin=22*mm, rightMargin=22*mm,
        topMargin=20*mm, bottomMargin=22*mm,
    )

    story = []

    # ── Header block ────────────────────────────────────────────────
    if title:
        date_str = datetime.datetime.now().strftime('%d/%m/%Y')
        w = A4[0] - 44*mm  # content width
        hdr_data = [
            [Paragraph(_rl_inline(title), ST['title_h'])],
            [Paragraph(f'Document généré le {date_str}', ST['meta'])],
        ]
        hdr_tbl = Table(hdr_data, colWidths=[w])
        hdr_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), C_NAVY),
            ('LEFTPADDING',  (0, 0), (-1, -1), 20),
            ('RIGHTPADDING', (0, 0), (-1, -1), 20),
            ('TOPPADDING',   (0, 0), (0, 0),   18),
            ('BOTTOMPADDING',(0, 0), (0, 0),   4),
            ('TOPPADDING',   (0, 1), (0, 1),   2),
            ('BOTTOMPADDING',(0, 1), (0, 1),   16),
            ('LINEBEFORE',   (0, 0), (0, -1),  6, C_ACCENT),
        ]))
        story.append(hdr_tbl)
        story.append(Spacer(1, 10*mm))

    # ── Parse markdown into flowables ───────────────────────────────
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        if not s:
            story.append(Spacer(1, 3))
            i += 1
            continue

        # Headings
        if s.startswith('#### '):
            story.append(Paragraph(_rl_inline(s[5:]), ST['h4']))
        elif s.startswith('### '):
            story.append(Paragraph(f'<font color="#e53935">◆ </font>{_rl_inline(s[4:])}', ST['h3']))
        elif s.startswith('## '):
            # Blue background box
            w = A4[0] - 44*mm
            cell = Paragraph(_rl_inline(s[3:]), ST['h2'])
            tbl = Table([[cell]], colWidths=[w])
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), C_LBLUE),
                ('LEFTPADDING',  (0, 0), (-1, -1), 14),
                ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                ('TOPPADDING',   (0, 0), (-1, -1), 7),
                ('BOTTOMPADDING',(0, 0), (-1, -1), 7),
                ('LINEBEFORE',   (0, 0), (0, -1),  4, C_BLUE),
            ]))
            story.append(Spacer(1, 6))
            story.append(tbl)
            story.append(Spacer(1, 4))
            i += 1
            continue
        elif s.startswith('# '):
            story.append(Paragraph(_rl_inline(s[2:]), ST['h1']))
            story.append(HRFlowable(width='100%', thickness=2, color=C_NAVY, spaceAfter=4))

        # Bullet list
        elif s.startswith(('- ', '* ', '+ ', '• ')):
            items = []
            while i < len(lines):
                ls = lines[i].strip()
                if not ls:
                    break
                if ls and ls[0] in '-*+•' and (len(ls) < 2 or ls[1] == ' '):
                    item = ls[2:].strip() if len(ls) > 1 else ls[1:].strip()
                    items.append(Paragraph(f'<font color="#e53935">▸</font>  {_rl_inline(item)}',
                                          ST['bullet']))
                    i += 1
                else:
                    break
            story.extend(items)
            continue

        # Ordered list
        elif re.match(r'^\d+\.\s', s):
            num = 1
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i].strip()):
                item = re.sub(r'^\d+\.\s', '', lines[i].strip())
                story.append(Paragraph(
                    f'<font color="#1565c0"><b>{num}.</b></font>  {_rl_inline(item)}',
                    ST['bullet']))
                num += 1; i += 1
            continue

        # Fenced code block
        elif s.startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            code_text = '\n'.join(code_lines)
            w = A4[0] - 44*mm
            pre_tbl = Table([[Preformatted(code_text, ST['code'])]], colWidths=[w])
            pre_tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), C_LGREY),
                ('LEFTPADDING',  (0, 0), (-1, -1), 10),
                ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                ('TOPPADDING',   (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
                ('LINEBEFORE',   (0, 0), (0, -1),  3, C_BLUE),
                ('BOX', (0, 0), (-1, -1), 0.5, C_BORDER),
            ]))
            story.append(pre_tbl)
            story.append(Spacer(1, 4))

        # Blockquote
        elif s.startswith('> '):
            bq_lines = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                bq_lines.append(lines[i].strip()[2:])
                i += 1
            w = A4[0] - 44*mm
            bq_tbl = Table([[Paragraph(_rl_inline(' '.join(bq_lines)), ST['quote'])]], colWidths=[w])
            bq_tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f5f9ff')),
                ('LEFTPADDING',  (0, 0), (-1, -1), 14),
                ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                ('TOPPADDING',   (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
                ('LINEBEFORE',   (0, 0), (0, -1),  4, C_BLUE),
            ]))
            story.append(bq_tbl)
            story.append(Spacer(1, 4))
            continue

        # Markdown table
        elif s.startswith('|') and '|' in s[1:]:
            rows_data = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = lines[i].strip()
                if re.match(r'^\|[\s\-\|:]+\|$', row):
                    i += 1; continue
                cells = [c.strip() for c in row.strip('|').split('|')]
                rows_data.append(cells)
                i += 1
            if rows_data:
                col_count = max(len(r) for r in rows_data)
                w = A4[0] - 44*mm
                col_w = [w / col_count] * col_count
                tbl_data = []
                for ri, row in enumerate(rows_data):
                    style = ST['h4'] if ri == 0 else ST['body']
                    tbl_data.append([Paragraph(_rl_inline(c), style) for c in row])
                tbl = Table(tbl_data, colWidths=col_w)
                ts = TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), C_NAVY),
                    ('TEXTCOLOR',  (0, 0), (-1, 0), colors.white),
                    ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE',   (0, 0), (-1, -1), 9),
                    ('LEFTPADDING',  (0, 0), (-1, -1), 8),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                    ('TOPPADDING',   (0, 0), (-1, -1), 6),
                    ('BOTTOMPADDING',(0, 0), (-1, -1), 6),
                    ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1),
                     [colors.white, colors.HexColor('#f7f9ff')]),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ])
                tbl.setStyle(ts)
                story.append(tbl)
                story.append(Spacer(1, 6))
            continue

        # Horizontal rule
        elif re.match(r'^[-=]{3,}$', s):
            story.append(HRFlowable(width='100%', thickness=0.5,
                                     color=C_BORDER, spaceAfter=8, spaceBefore=8))

        # Normal paragraph
        else:
            story.append(Paragraph(_rl_inline(s), ST['body']))

        i += 1

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)


def generate_pdf(path: str, content: str, title: str = "") -> str:
    try:
        p = _resolve(path)
        if not p.suffix or p.suffix.lower() != '.pdf':
            p = p.with_suffix('.pdf')
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            _generate_pdf_reportlab(p, content, title)
            if p.exists() and p.stat().st_size > 1000:
                size_kb = p.stat().st_size // 1024
                return f"OK: PDF généré → {p} ({size_kb} KB)"
        except Exception as e:
            rl_err = str(e)
        # Fallback: fpdf
        try:
            _generate_pdf_fpdf(p, content, title)
            if p.exists() and p.stat().st_size > 0:
                return f"OK: PDF généré → {p} [fpdf]"
        except Exception:
            pass
        return f"ERREUR: PDF non créé (reportlab: {rl_err})"
    except Exception as e:
        return f"ERREUR génération PDF: {e}"


def _safe_latin1(text: str) -> str:
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'__(.*?)__', r'\1', text)
    replacements = {'•': '-', '–': '-', '—': '-', '"': '"', '"': '"',
                    '\u2019': "'", '\u2018': "'", '…': '...', '→': '->',
                    '✓': 'OK', '✗': 'X', '×': 'x', '€': 'EUR'}
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return text.encode('latin-1', errors='replace').decode('latin-1')


def _generate_pdf_fpdf(p: Path, content: str, title: str):
    from fpdf import FPDF
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    if title:
        pdf.set_font("Helvetica", "B", 16)
        try:
            pdf.multi_cell(0, 10, _safe_latin1(title), align="C")
        except Exception:
            pass
        pdf.ln(6)
    pdf.set_font("Helvetica", "", 11)
    for line in content.split("\n"):
        s = line.strip()
        try:
            if s.startswith("# "):
                pdf.set_font("Helvetica", "B", 14); pdf.multi_cell(0, 8, _safe_latin1(s[2:]))
                pdf.set_font("Helvetica", "", 11); pdf.ln(2)
            elif s.startswith("## "):
                pdf.set_font("Helvetica", "B", 12); pdf.multi_cell(0, 7, _safe_latin1(s[3:]))
                pdf.set_font("Helvetica", "", 11); pdf.ln(1)
            elif s.startswith("### "):
                pdf.set_font("Helvetica", "B", 11); pdf.multi_cell(0, 6, _safe_latin1(s[4:]))
                pdf.set_font("Helvetica", "", 11)
            elif s.startswith(("- ", "* ", "+ ")):
                pdf.multi_cell(0, 6, "- " + _safe_latin1(s[2:]))
            elif s == "":
                pdf.ln(3)
            else:
                pdf.multi_cell(0, 6, _safe_latin1(s))
        except Exception:
            pass
    pdf.output(str(p))


def glob_files(pattern: str, path: str = "") -> str:
    """Find files matching a glob pattern."""
    try:
        import glob as _glob
        base = Path(path).expanduser() if path else _get_workspace()
        if not base.is_absolute():
            base = _get_workspace() / base
        matches = _glob.glob(str(base / pattern), recursive=True)
        matches = [m for m in matches if not any(s in m for s in ['__pycache__', 'node_modules', '.git'])]
        if not matches:
            return f"Aucun fichier trouvé pour '{pattern}' dans {base}"
        return "\n".join(sorted(matches)[:100])
    except Exception as e:
        return f"Error: {e}"


def get_file_info(path: str) -> str:
    """Get file metadata: size, dates, permissions."""
    try:
        import datetime
        p = _resolve(path)
        stat = p.stat()
        size = stat.st_size
        size_str = f"{size} B" if size < 1024 else f"{size/1024:.1f} KB" if size < 1024**2 else f"{size/1024**2:.1f} MB"
        modified = datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        created = datetime.datetime.fromtimestamp(stat.st_ctime).strftime("%Y-%m-%d %H:%M:%S")
        ftype = "dossier" if p.is_dir() else "fichier"
        return f"Type: {ftype}\nChemin: {p}\nTaille: {size_str}\nModifié: {modified}\nCréé: {created}"
    except Exception as e:
        return f"Error: {e}"


def move_file(src: str, dst: str) -> str:
    """Move or rename a file/directory."""
    try:
        import shutil
        s = _resolve(src)
        d = _resolve(dst)
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))
        return f"OK: déplacé {s} → {d}"
    except Exception as e:
        return f"Error: {e}"


def copy_file(src: str, dst: str) -> str:
    """Copy a file or directory."""
    try:
        import shutil
        s = _resolve(src)
        d = _resolve(dst)
        d.parent.mkdir(parents=True, exist_ok=True)
        if s.is_dir():
            shutil.copytree(str(s), str(d))
        else:
            shutil.copy2(str(s), str(d))
        return f"OK: copié {s} → {d}"
    except Exception as e:
        return f"Error: {e}"


def delete_file(path: str) -> str:
    """Delete a file or directory. Requires explicit confirmation from user."""
    try:
        import shutil
        p = _resolve(path)
        if not p.exists():
            return f"Erreur: {p} n'existe pas"
        if p.is_dir():
            shutil.rmtree(str(p))
        else:
            p.unlink()
        return f"OK: supprimé {p}"
    except Exception as e:
        return f"Error: {e}"


def open_file(path: str) -> str:
    """Open a file or URL with the default system application."""
    try:
        import subprocess
        p = _resolve(path) if not path.startswith("http") else None
        target = str(p) if p else path
        subprocess.Popen(["open", target])
        return f"OK: ouvert {target}"
    except Exception as e:
        return f"Error: {e}"


def get_clipboard() -> str:
    """Get current clipboard text content."""
    try:
        import subprocess
        result = subprocess.run(["pbpaste"], capture_output=True, text=True, timeout=5)
        content = result.stdout
        if not content:
            return "(presse-papier vide)"
        return content[:4000]
    except Exception as e:
        return f"Error: {e}"


def set_clipboard(text: str) -> str:
    """Set clipboard text content."""
    try:
        import subprocess
        subprocess.run(["pbcopy"], input=text, text=True, timeout=5)
        return f"OK: presse-papier mis à jour ({len(text)} caractères)"
    except Exception as e:
        return f"Error: {e}"


def recall_facts(key: str = "") -> str:
    """Recall memorized facts. If key given, returns that fact; else lists all."""
    try:
        from monkey import memory as mem_mod
        facts = mem_mod.get_facts()
        if not facts:
            return "(aucun fait mémorisé)"
        if key:
            val = facts.get(key)
            return f"{key}: {val}" if val else f"Aucun fait pour la clé '{key}'"
        return "\n".join(f"- {k}: {v}" for k, v in facts.items())
    except Exception as e:
        return f"Error: {e}"


def search_files(directory: str, pattern: str) -> list[str]:
    try:
        return [str(p) for p in Path(directory).rglob(pattern)][:50]
    except Exception as e:
        return [f"Error: {e}"]
