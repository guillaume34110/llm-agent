"""OSINT scratch notebook.

Why this exists: long OSINT runs make 20+ tool calls; intermediate findings
(URLs, names, dates, IDs, snippets) get dropped from the agent's context as
the conversation rolls. A persistent topic-keyed markdown notebook on disk
lets the agent accumulate findings then dump the full record into its final
report. One file per topic in ~/.monkey/osint/<slug>.md.
"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

NOTEBOOK_DIR = Path.home() / ".monkey" / "osint"

_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def _slug(topic: str) -> str:
    s = topic.strip().lower()
    s = _SLUG_RE.sub("-", s).strip("-")
    return s[:80] or "untitled"


def _path(topic: str) -> Path:
    return NOTEBOOK_DIR / f"{_slug(topic)}.md"


def osint_note(topic: str, key: str, value: str) -> str:
    """Append a finding `key: value` under `topic`. Creates file on first call.

    Use this for any durable finding: URL, handle, full name, email, phone,
    DOB, employer, location, breach name, etc. Keep `value` concise — quote
    the source URL when relevant.
    """
    if not topic or not topic.strip():
        return "ERREUR: topic required"
    if not key or not key.strip():
        return "ERREUR: key required"
    p = _path(topic)
    p.parent.mkdir(parents=True, exist_ok=True)
    ts = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    line = f"- **{key.strip()}**: {str(value).strip()}  _({ts})_\n"
    if not p.exists():
        p.write_text(f"# OSINT — {topic.strip()}\n\n", encoding="utf-8")
    with p.open("a", encoding="utf-8") as f:
        f.write(line)
    return f"OK: noted under {p.name}"


def osint_dump(topic: str) -> str:
    """Return the full notebook for `topic`, or a marker if empty."""
    p = _path(topic)
    if not p.exists():
        return f"(empty notebook for: {topic})"
    return p.read_text(encoding="utf-8")


def osint_list() -> str:
    """List all existing OSINT notebooks with line counts."""
    if not NOTEBOOK_DIR.exists():
        return "(no notebooks)"
    items = []
    for p in sorted(NOTEBOOK_DIR.glob("*.md")):
        try:
            n = sum(1 for _ in p.read_text(encoding="utf-8").splitlines() if _.startswith("- "))
        except Exception:
            n = 0
        items.append(f"- {p.stem} ({n} notes)")
    return "\n".join(items) if items else "(no notebooks)"


_URL_RE = re.compile(r"https?://[^\s)\]>\"']+", re.I)


def osint_citation_check(text: str, min_urls: int = 1) -> str:
    """Audit a draft OSINT report for inline source URLs. Returns JSON with warnings.

    Heuristic: count distinct http(s) URLs in the draft. If below `min_urls`,
    the report is unsourced and should be rewritten with citations. Also flags
    short / empty drafts and very long claim-dense drafts with no URLs.
    """
    t = (text or "").strip()
    warnings: list[str] = []
    if not t:
        return '{"ok": false, "warnings": ["empty draft"], "url_count": 0}'
    urls = list({u.rstrip(".,;:") for u in _URL_RE.findall(t)})
    if len(urls) < min_urls:
        warnings.append(f"only {len(urls)} URL(s) found, expected at least {min_urls}")
    # Heuristic: lots of factual-looking lines but no URLs
    lines = [l for l in t.splitlines() if l.strip()]
    if len(lines) >= 8 and not urls:
        warnings.append("8+ lines of claims with zero URLs — unsourced")
    import json as _json
    return _json.dumps({
        "ok": not warnings,
        "url_count": len(urls),
        "urls": urls[:20],
        "warnings": warnings,
    }, ensure_ascii=False, indent=2)


def osint_clear(topic: str = "") -> str:
    """Delete one notebook (topic given) or all notebooks (topic empty)."""
    if topic.strip():
        p = _path(topic)
        if p.exists():
            p.unlink()
            return f"OK: cleared {p.name}"
        return f"(nothing to clear for: {topic})"
    if not NOTEBOOK_DIR.exists():
        return "OK: 0 cleared"
    n = 0
    for p in NOTEBOOK_DIR.glob("*.md"):
        try:
            p.unlink()
            n += 1
        except Exception:
            pass
    return f"OK: {n} cleared"
