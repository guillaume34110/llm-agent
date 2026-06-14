"""Graphics / image / 3D tools — game-dev oriented."""
from __future__ import annotations
import json
import math
import subprocess
from pathlib import Path
from typing import Any

from monkey.tools.files import _resolve


def _ok(msg: str) -> str: return f"OK: {msg}"
def _err(msg: str) -> str: return f"ERREUR: {msg}"


# ─── SVG generation ─────────────────────────────────────────────────────────

def svg_shape(kind: str, path: str, width: int = 512, height: int = 512,
              fill: str = "#3b82f6", stroke: str = "#0f172a", stroke_width: float = 2.0,
              params: dict | None = None) -> str:
    """Generate a clean SVG containing one or several primitive shapes.

    kind ∈ {circle, rect, star, polygon, hex-grid, gear, heart, arrow, ribbon}.
    params : extra knobs depending on kind (radius, points, sides, rows, cols…).
    """
    try:
        import svgwrite
    except ImportError:
        return _err("svgwrite manquant (pip install svgwrite)")
    p = params or {}
    p_out = _resolve(path)
    p_out.parent.mkdir(parents=True, exist_ok=True)
    dwg = svgwrite.Drawing(str(p_out), size=(width, height), profile="tiny")
    cx, cy = width / 2, height / 2
    common = {"fill": fill, "stroke": stroke, "stroke_width": stroke_width}

    k = kind.lower().strip()
    if k == "circle":
        r = float(p.get("radius", min(width, height) * 0.4))
        dwg.add(dwg.circle(center=(cx, cy), r=r, **common))
    elif k == "rect":
        rx = float(p.get("rx", 8))
        w = float(p.get("w", width * 0.7))
        h = float(p.get("h", height * 0.7))
        dwg.add(dwg.rect(insert=(cx - w / 2, cy - h / 2), size=(w, h), rx=rx, ry=rx, **common))
    elif k == "star":
        n = int(p.get("points", 5))
        outer = float(p.get("outer", min(width, height) * 0.45))
        inner = float(p.get("inner", outer * 0.4))
        pts = []
        for i in range(n * 2):
            r = outer if i % 2 == 0 else inner
            a = -math.pi / 2 + i * math.pi / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        dwg.add(dwg.polygon(points=pts, **common))
    elif k == "polygon":
        n = int(p.get("sides", 6))
        r = float(p.get("radius", min(width, height) * 0.4))
        pts = [(cx + r * math.cos(-math.pi / 2 + i * 2 * math.pi / n),
                cy + r * math.sin(-math.pi / 2 + i * 2 * math.pi / n)) for i in range(n)]
        dwg.add(dwg.polygon(points=pts, **common))
    elif k == "hex-grid":
        cols = int(p.get("cols", 8))
        rows = int(p.get("rows", 6))
        size = float(p.get("size", min(width / (cols * 1.8), height / (rows * 1.7))))
        for r_i in range(rows):
            for c_i in range(cols):
                ox = size * 1.5 + c_i * size * math.sqrt(3) + (size * math.sqrt(3) / 2 if r_i % 2 else 0)
                oy = size + r_i * size * 1.5
                pts = [(ox + size * math.cos(-math.pi / 2 + i * math.pi / 3),
                        oy + size * math.sin(-math.pi / 2 + i * math.pi / 3)) for i in range(6)]
                dwg.add(dwg.polygon(points=pts, **common))
    elif k == "gear":
        teeth = int(p.get("teeth", 12))
        outer = float(p.get("outer", min(width, height) * 0.42))
        inner = float(p.get("inner", outer * 0.78))
        pts = []
        for i in range(teeth * 2):
            r = outer if i % 2 == 0 else inner
            a = i * math.pi / teeth
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        dwg.add(dwg.polygon(points=pts, **common))
        dwg.add(dwg.circle(center=(cx, cy), r=outer * 0.25, fill="white", stroke=stroke, stroke_width=stroke_width))
    elif k == "heart":
        # parametric heart curve scaled to fit
        s = min(width, height) * 0.018
        pts = []
        for t in [i * math.pi / 60 for i in range(121)]:
            x = 16 * math.sin(t) ** 3
            y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts.append((cx + x * s, cy + y * s))
        dwg.add(dwg.polygon(points=pts, **common))
    elif k == "arrow":
        l = float(p.get("length", width * 0.7))
        h = float(p.get("thickness", height * 0.18))
        head = h * 1.8
        x0 = cx - l / 2
        x1 = cx + l / 2
        pts = [(x0, cy - h / 2), (x1 - head, cy - h / 2), (x1 - head, cy - head),
               (x1, cy), (x1 - head, cy + head), (x1 - head, cy + h / 2), (x0, cy + h / 2)]
        dwg.add(dwg.polygon(points=pts, **common))
    elif k == "ribbon":
        h = float(p.get("h", height * 0.3))
        dwg.add(dwg.polygon(points=[
            (0, cy - h / 2), (width, cy - h / 2),
            (width - h * 0.5, cy), (width, cy + h / 2),
            (0, cy + h / 2), (h * 0.5, cy),
        ], **common))
    else:
        return _err(f"kind inconnu: {kind} (essaie circle|rect|star|polygon|hex-grid|gear|heart|arrow|ribbon)")

    dwg.save()
    return _ok(f"SVG écrit: {p_out} ({kind}, {width}x{height})")


# ─── Image → SVG (vectorization) ────────────────────────────────────────────

def image_to_svg(input_path: str, output_path: str, mode: str = "color",
                 max_colors: int = 8) -> str:
    """Vectorize a raster image to SVG. Tries vtracer (best), falls back to
    a simple posterize+contour SVG using PIL.
    mode ∈ {color, bw}.
    """
    src = _resolve(input_path)
    dst = _resolve(output_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")

    # Try vtracer if installed
    try:
        if subprocess.run(["which", "vtracer"], capture_output=True).returncode == 0:
            args = ["vtracer", "--input", str(src), "--output", str(dst)]
            if mode == "bw":
                args += ["--colormode", "binary"]
            else:
                args += ["--colormode", "color", "--color_precision", str(min(8, max_colors))]
            r = subprocess.run(args, capture_output=True, text=True, timeout=60)
            if r.returncode == 0 and dst.exists():
                return _ok(f"SVG vectorisé via vtracer: {dst}")
    except Exception:
        pass

    # Fallback: posterize → embed as base64 raster in SVG (acceptable quality, pure-python)
    try:
        from PIL import Image
        import base64, io
        img = Image.open(src).convert("RGB")
        if mode == "bw":
            img = img.convert("L").convert("RGB")
        img = img.quantize(colors=max(2, min(64, max_colors))).convert("RGB")
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(
            f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n'
            f'  <image href="data:image/png;base64,{b64}" width="{w}" height="{h}"/>\n'
            f'</svg>\n'
        )
        return _ok(f"SVG (raster posterizé, fallback) écrit: {dst}. Installe `vtracer` pour vrai vectoriel.")
    except Exception as e:
        return _err(f"échec image→svg: {e}")


# ─── Image → 3D heightmap STL ───────────────────────────────────────────────

def image_to_heightmap_stl(input_path: str, output_path: str,
                           max_height: float = 30.0, scale: float = 0.5) -> str:
    """Convert grayscale image to STL mesh (each pixel = a height vertex).
    Useful for game-dev terrain, lithophanes, props from concept art.
    """
    src = _resolve(input_path)
    dst = _resolve(output_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        import numpy as np
        from PIL import Image
        from stl import mesh as stl_mesh
    except ImportError as e:
        return _err(f"dépendance manquante: {e}. pip install numpy-stl Pillow")

    img = Image.open(src).convert("L")
    if scale != 1.0:
        img = img.resize((max(8, int(img.width * scale)), max(8, int(img.height * scale))))
    arr = np.array(img, dtype=np.float32) / 255.0 * max_height
    h, w = arr.shape
    if h * w > 250_000:
        return _err(f"image trop grande après scale ({w}x{h}). Réduit `scale` (ex: 0.25)")

    # Build vertex grid + 2 triangles per quad
    verts = np.zeros((h, w, 3), dtype=np.float32)
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    verts[..., 0] = xs[None, :]
    verts[..., 1] = ys[:, None]
    verts[..., 2] = arr

    faces = []
    for y in range(h - 1):
        for x in range(w - 1):
            v00 = verts[y, x]
            v10 = verts[y, x + 1]
            v01 = verts[y + 1, x]
            v11 = verts[y + 1, x + 1]
            faces.append([v00, v11, v10])
            faces.append([v00, v01, v11])
    faces_arr = np.array(faces, dtype=np.float32)

    mesh_data = stl_mesh.Mesh(np.zeros(len(faces_arr), dtype=stl_mesh.Mesh.dtype))
    for i, f in enumerate(faces_arr):
        mesh_data.vectors[i] = f
    dst.parent.mkdir(parents=True, exist_ok=True)
    mesh_data.save(str(dst))
    return _ok(f"STL écrit: {dst} ({w}x{h} vertices, {len(faces_arr)} triangles)")


# ─── Color palette extraction ───────────────────────────────────────────────

def extract_palette(input_path: str, n: int = 8) -> str:
    """Extract dominant colors from an image. Returns JSON list of hex codes."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    img = Image.open(src).convert("RGB")
    img.thumbnail((256, 256))
    q = img.quantize(colors=max(1, min(64, n)))
    palette = q.getpalette() or []
    counts = sorted(q.getcolors() or [], key=lambda c: -c[0])
    out = []
    for cnt, idx in counts[:n]:
        r, g, b = palette[idx * 3:idx * 3 + 3]
        out.append({"hex": f"#{r:02x}{g:02x}{b:02x}", "weight": cnt})
    return json.dumps({"palette": out, "count": len(out)}, ensure_ascii=False, indent=2)


# ─── Image manipulation (Pillow wrappers) ───────────────────────────────────

def resize_image(input_path: str, output_path: str, width: int = 0, height: int = 0,
                 fit: str = "contain") -> str:
    """fit ∈ {contain, cover, stretch}. 0 = auto-keep aspect."""
    src = _resolve(input_path)
    dst = _resolve(output_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    img = Image.open(src)
    w, h = img.size
    tw, th = width or w, height or h
    if fit == "stretch":
        out = img.resize((tw, th))
    elif fit == "cover":
        out = img.copy()
        out.thumbnail((max(tw, th * w / h), max(th, tw * h / w)))
        cx, cy = out.width // 2, out.height // 2
        out = out.crop((cx - tw // 2, cy - th // 2, cx + tw - tw // 2, cy + th - th // 2))
    else:  # contain
        out = img.copy()
        out.thumbnail((tw, th))
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(str(dst))
    return _ok(f"resize {src.name} → {dst} ({out.size})")


def convert_image(input_path: str, output_path: str, quality: int = 90) -> str:
    """Convert image format based on output extension (jpg/png/webp/avif/gif/bmp)."""
    src = _resolve(input_path)
    dst = _resolve(output_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    img = Image.open(src)
    if dst.suffix.lower() in (".jpg", ".jpeg") and img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1])
        img = bg
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(dst), quality=quality, optimize=True)
    return _ok(f"converti: {src.suffix} → {dst.suffix} ({dst})")


def ocr_image(input_path: str, lang: str = "eng+fra") -> str:
    """OCR via tesseract binary. Returns extracted text."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return _err("pytesseract / Pillow manquant")
    if subprocess.run(["which", "tesseract"], capture_output=True).returncode != 0:
        return _err("binaire tesseract absent (brew install tesseract tesseract-lang)")
    try:
        text = pytesseract.image_to_string(Image.open(src), lang=lang)
        return text.strip() or "(aucun texte détecté)"
    except Exception as e:
        return _err(f"OCR échec: {e}")


def image_to_ascii(input_path: str, width: int = 80) -> str:
    """Convert image to ASCII art (fun, useful for terminal previews)."""
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"fichier source absent: {src}")
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    chars = "@%#*+=-:. "
    img = Image.open(src).convert("L")
    aspect = img.height / img.width
    new_h = max(8, int(width * aspect * 0.5))
    img = img.resize((width, new_h))
    px = list(img.getdata())
    rows = ["".join(chars[min(len(chars) - 1, p * len(chars) // 256)]
                    for p in px[i:i + width]) for i in range(0, len(px), width)]
    return "\n".join(rows)


def generate_spritesheet(input_paths: list[str], output_path: str,
                         cols: int = 0, padding: int = 2, bg: str = "transparent") -> str:
    """Combine N images into a regular grid spritesheet. cols=0 → auto sqrt."""
    if not input_paths:
        return _err("input_paths vide")
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    imgs = []
    for p in input_paths:
        rp = _resolve(p)
        if not rp.exists():
            return _err(f"fichier absent: {rp}")
        imgs.append(Image.open(rp).convert("RGBA"))
    n = len(imgs)
    cols = cols or max(1, int(math.ceil(math.sqrt(n))))
    rows = int(math.ceil(n / cols))
    cw = max(i.width for i in imgs)
    ch = max(i.height for i in imgs)
    W = cols * cw + (cols + 1) * padding
    H = rows * ch + (rows + 1) * padding
    bg_color = (0, 0, 0, 0) if bg == "transparent" else bg
    sheet = Image.new("RGBA", (W, H), bg_color)
    meta = []
    for i, im in enumerate(imgs):
        c, r = i % cols, i // cols
        x = padding + c * (cw + padding)
        y = padding + r * (ch + padding)
        sheet.paste(im, (x, y), im)
        meta.append({"index": i, "x": x, "y": y, "w": im.width, "h": im.height})
    dst = _resolve(output_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(dst))
    meta_path = dst.with_suffix(".json")
    meta_path.write_text(json.dumps({"frame_w": cw, "frame_h": ch, "cols": cols,
                                      "rows": rows, "frames": meta}, indent=2))
    return _ok(f"spritesheet {W}x{H} ({n} frames, {cols}x{rows}) → {dst} + meta {meta_path.name}")


def tilemap_render(tilemap_json: str, tileset_path: str, output_path: str) -> str:
    """Render a JSON tilemap (matrix of tile indices) using a tileset spritesheet.

    tilemap_json format: {"tile_w": 32, "tile_h": 32, "map": [[0,1,2],[3,0,1],...]}
    Tile indices start at 0; -1 = empty.
    """
    try:
        from PIL import Image
    except ImportError:
        return _err("Pillow manquant")
    try:
        data = json.loads(tilemap_json) if isinstance(tilemap_json, str) else tilemap_json
    except Exception as e:
        return _err(f"tilemap JSON invalide: {e}")
    tw, th = int(data.get("tile_w", 32)), int(data.get("tile_h", 32))
    grid = data.get("map") or []
    if not grid or not grid[0]:
        return _err("map vide")
    rows = len(grid)
    cols = len(grid[0])
    ts = Image.open(_resolve(tileset_path)).convert("RGBA")
    tiles_per_row = max(1, ts.width // tw)
    out = Image.new("RGBA", (cols * tw, rows * th), (0, 0, 0, 0))
    for r, row in enumerate(grid):
        for c, idx in enumerate(row):
            if idx is None or idx < 0:
                continue
            sx = (idx % tiles_per_row) * tw
            sy = (idx // tiles_per_row) * th
            tile = ts.crop((sx, sy, sx + tw, sy + th))
            out.paste(tile, (c * tw, r * th), tile)
    dst = _resolve(output_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(str(dst))
    return _ok(f"tilemap rendu: {dst} ({cols}x{rows} tuiles, {out.size})")
