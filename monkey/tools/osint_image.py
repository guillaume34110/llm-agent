"""OSINT image tools: EXIF reader, perceptual hash, reverse-image search URLs.

`exif_extract`: pull EXIF metadata (GPS, camera, timestamps, software) from a
local image file using PIL. No new deps.

`image_phash`: compute a 64-bit average hash (aHash) of an image. Cheap
perceptual fingerprint — same aHash means visually similar (lossy resize +
recompression). PIL only.

`reverse_image_urls`: build ready-to-open URLs for reverse-image search across
Google Lens, Yandex, TinEye, Bing Visual Search. The agent opens these in the
stealth browser to surface where the image appears online.
"""
from __future__ import annotations

import json
import os
from urllib.parse import quote


def _gps_to_decimal(coord, ref) -> float | None:
    try:
        def _r(v):
            return float(v[0]) / float(v[1]) if isinstance(v, tuple) else float(v)
        d, m, s = (_r(x) for x in coord)
        dec = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            dec = -dec
        return round(dec, 7)
    except Exception:
        return None


def exif_extract(path: str) -> str:
    """Extract EXIF metadata from a local image. Returns JSON with camera, datetime, GPS (lat/lon), software."""
    if not path or not os.path.exists(path):
        return f"ERREUR: file not found '{path}'"
    try:
        from PIL import Image, ExifTags
    except Exception as e:
        return f"ERREUR: Pillow unavailable: {e}"
    try:
        img = Image.open(path)
        raw = img._getexif() or {}
    except Exception as e:
        return f"ERREUR: cannot read image: {e}"
    if not raw:
        return json.dumps({"path": path, "has_exif": False}, ensure_ascii=False, indent=2)

    tagmap = {v: k for k, v in ExifTags.TAGS.items()}
    decoded = {}
    for tag_id, val in raw.items():
        name = ExifTags.TAGS.get(tag_id, str(tag_id))
        if name == "GPSInfo":
            continue
        if isinstance(val, bytes):
            try:
                val = val.decode("utf-8", "replace").strip("\x00")
            except Exception:
                val = repr(val)[:80]
        decoded[name] = val if isinstance(val, (str, int, float)) else str(val)[:200]

    gps_lat = gps_lon = gps_alt = None
    gps_raw = raw.get(tagmap.get("GPSInfo", -1)) or {}
    if isinstance(gps_raw, dict) and gps_raw:
        gps_named = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_raw.items()}
        if "GPSLatitude" in gps_named and "GPSLatitudeRef" in gps_named:
            gps_lat = _gps_to_decimal(gps_named["GPSLatitude"], gps_named["GPSLatitudeRef"])
        if "GPSLongitude" in gps_named and "GPSLongitudeRef" in gps_named:
            gps_lon = _gps_to_decimal(gps_named["GPSLongitude"], gps_named["GPSLongitudeRef"])
        if "GPSAltitude" in gps_named:
            try:
                a = gps_named["GPSAltitude"]
                gps_alt = float(a[0]) / float(a[1]) if isinstance(a, tuple) else float(a)
            except Exception:
                pass

    out = {
        "path": path,
        "has_exif": True,
        "camera_make": decoded.get("Make"),
        "camera_model": decoded.get("Model"),
        "software": decoded.get("Software"),
        "datetime_original": decoded.get("DateTimeOriginal") or decoded.get("DateTime"),
        "lens": decoded.get("LensModel"),
        "iso": decoded.get("ISOSpeedRatings"),
        "f_number": decoded.get("FNumber"),
        "exposure": decoded.get("ExposureTime"),
        "focal_length": decoded.get("FocalLength"),
        "orientation": decoded.get("Orientation"),
        "gps_lat": gps_lat,
        "gps_lon": gps_lon,
        "gps_alt": gps_alt,
        "gps_maps_url": (f"https://www.google.com/maps?q={gps_lat},{gps_lon}"
                        if gps_lat is not None and gps_lon is not None else None),
    }
    return json.dumps({k: v for k, v in out.items() if v not in (None, "", [])},
                      ensure_ascii=False, indent=2)


def image_phash(path: str) -> str:
    """64-bit average hash (aHash) of an image. Same hash → visually similar."""
    if not path or not os.path.exists(path):
        return f"ERREUR: file not found '{path}'"
    try:
        from PIL import Image
    except Exception as e:
        return f"ERREUR: Pillow unavailable: {e}"
    try:
        img = Image.open(path).convert("L").resize((8, 8), Image.LANCZOS)
    except Exception as e:
        return f"ERREUR: cannot read image: {e}"
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    bits = 0
    for i, p in enumerate(pixels):
        if p >= avg:
            bits |= 1 << (63 - i)
    return json.dumps({"path": path, "ahash_hex": f"{bits:016x}", "ahash_int": bits},
                      ensure_ascii=False, indent=2)


def reverse_image_urls(image_url: str) -> str:
    """Build reverse-image search URLs (Google Lens, Yandex, TinEye, Bing) for a public image URL."""
    if not image_url or not image_url.startswith(("http://", "https://")):
        return "ERREUR: image_url must be an http(s) URL"
    u = quote(image_url, safe="")
    return json.dumps({
        "image_url": image_url,
        "google_lens": f"https://lens.google.com/uploadbyurl?url={u}",
        "yandex": f"https://yandex.com/images/search?rpt=imageview&url={u}",
        "tineye": f"https://tineye.com/search?url={u}",
        "bing_visual": f"https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{u}",
    }, ensure_ascii=False, indent=2)
