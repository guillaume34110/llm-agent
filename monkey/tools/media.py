"""Media tools: audio extraction/conversion (ffmpeg), archives, hashes."""
from __future__ import annotations
import hashlib
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path

from monkey.tools.files import _resolve


def _ok(m: str) -> str: return f"OK: {m}"
def _err(m: str) -> str: return f"ERREUR: {m}"


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def audio_extract(video_path: str, output_path: str, codec: str = "mp3", bitrate: str = "192k") -> str:
    """Extract audio track from a video file (requires ffmpeg)."""
    if not _has_ffmpeg():
        return _err("ffmpeg manquant (brew install ffmpeg)")
    src = _resolve(video_path)
    if not src.exists():
        return _err(f"introuvable: {src}")
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-i", str(src), "-vn", "-acodec",
           "libmp3lame" if codec == "mp3" else codec, "-b:a", bitrate, str(out)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return _err(f"ffmpeg: {r.stderr[-400:]}")
    except subprocess.TimeoutExpired:
        return _err("ffmpeg timeout 300s")
    return _ok(f"audio → {out} ({out.stat().st_size // 1024} KB)")


def audio_convert(input_path: str, output_path: str, bitrate: str = "192k") -> str:
    """Convert audio between formats (mp3, wav, ogg, flac, m4a). Requires ffmpeg."""
    if not _has_ffmpeg():
        return _err("ffmpeg manquant")
    src = _resolve(input_path)
    if not src.exists():
        return _err(f"introuvable: {src}")
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-i", str(src), "-b:a", bitrate, str(out)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return _err(f"ffmpeg: {r.stderr[-400:]}")
    except subprocess.TimeoutExpired:
        return _err("ffmpeg timeout")
    return _ok(f"audio → {out}")


def video_thumbnail(video_path: str, output_path: str, time: str = "00:00:01") -> str:
    """Extract a thumbnail frame from a video at given timestamp (HH:MM:SS)."""
    if not _has_ffmpeg():
        return _err("ffmpeg manquant")
    src = _resolve(video_path)
    if not src.exists():
        return _err(f"introuvable: {src}")
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-ss", time, "-i", str(src), "-frames:v", "1", "-q:v", "2", str(out)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            return _err(f"ffmpeg: {r.stderr[-400:]}")
    except subprocess.TimeoutExpired:
        return _err("ffmpeg timeout")
    return _ok(f"thumbnail → {out}")


def video_to_gif(video_path: str, output_path: str, start: str = "0", duration: str = "5",
                 fps: int = 12, width: int = 480) -> str:
    """Convert a clip of video to GIF (start sec, duration sec)."""
    if not _has_ffmpeg():
        return _err("ffmpeg manquant")
    src = _resolve(video_path)
    if not src.exists():
        return _err(f"introuvable: {src}")
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    vf = f"fps={fps},scale={width}:-1:flags=lanczos"
    cmd = ["ffmpeg", "-y", "-ss", str(start), "-t", str(duration), "-i", str(src),
           "-vf", vf, "-loop", "0", str(out)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            return _err(f"ffmpeg: {r.stderr[-400:]}")
    except subprocess.TimeoutExpired:
        return _err("ffmpeg timeout")
    return _ok(f"gif → {out}")


def compress_archive(paths: list[str], output_path: str, format: str = "zip") -> str:
    """Compress a list of files/dirs into a .zip or .tar.gz archive."""
    if not paths:
        return _err("paths vide")
    out = _resolve(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fmt = format.lower().strip()
    try:
        if fmt == "zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
                for s in paths:
                    sp = _resolve(s)
                    if not sp.exists():
                        continue
                    if sp.is_file():
                        zf.write(sp, sp.name)
                    else:
                        for f in sp.rglob("*"):
                            if f.is_file():
                                zf.write(f, f.relative_to(sp.parent))
        elif fmt in ("tar.gz", "tgz", "tar"):
            mode = "w:gz" if fmt != "tar" else "w"
            with tarfile.open(out, mode) as tf:
                for s in paths:
                    sp = _resolve(s)
                    if sp.exists():
                        tf.add(sp, arcname=sp.name)
        else:
            return _err(f"format inconnu: {format} (zip|tar.gz)")
    except Exception as e:
        return _err(str(e))
    size = out.stat().st_size
    return _ok(f"archive → {out} ({size // 1024} KB)")


def extract_archive(archive_path: str, output_dir: str) -> str:
    """Extract a .zip / .tar.gz / .tar archive into a directory."""
    src = _resolve(archive_path)
    if not src.exists():
        return _err(f"introuvable: {src}")
    out = _resolve(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    name = src.name.lower()
    try:
        if name.endswith(".zip"):
            with zipfile.ZipFile(src) as zf:
                zf.extractall(out)
        elif name.endswith((".tar.gz", ".tgz", ".tar")):
            with tarfile.open(src) as tf:
                tf.extractall(out)
        else:
            return _err("format non supporté (.zip / .tar.gz)")
    except Exception as e:
        return _err(str(e))
    return _ok(f"extrait → {out}")


def file_hash(path: str, algo: str = "sha256") -> str:
    """Compute a cryptographic hash (md5, sha1, sha256, sha512) of a file."""
    p = _resolve(path)
    if not p.exists():
        return _err(f"introuvable: {p}")
    algo = algo.lower().strip()
    if algo not in {"md5", "sha1", "sha256", "sha512"}:
        return _err(f"algo: md5|sha1|sha256|sha512 (got {algo})")
    h = hashlib.new(algo)
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return _ok(f"{algo}={h.hexdigest()} {p}")
