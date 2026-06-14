"""Persistent skill store.

Layout (under ~/.monkey/skills/):
  index.json                    — {name: {description, triggers[], source, path, sources[], created_at, version}}
  learned/<name>.md             — content
  embeds.json                   — {name: {hash, vec[]}}  (optional)

Skills come from two origins :
  - "builtin"  : hardcoded in monkey/skills.py (always available)
  - "learned"  : auto-created at runtime via tools/skills_tool.py

Selection uses a hybrid score :
  - regex match (1.0)
  - keyword/triggers match (0.6 - 0.8)
  - cosine similarity over embeddings (0..1) if available

Top-K skills above MIN_SCORE are concatenated into the system prompt.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import time
from pathlib import Path
from typing import Iterable

ROOT = Path.home() / ".monkey" / "skills"
LEARNED_DIR = ROOT / "learned"
INDEX_PATH = ROOT / "index.json"
EMBEDS_PATH = ROOT / "embeds.json"

MAX_LEARNED = 200            # hard cap, LRU prune beyond
MAX_LEARNED_PER_DAY = 5      # quota anti runaway
COOLDOWN_SECONDS = 24 * 3600 # avoid re-learning same topic
TOP_K = 4
MIN_SCORE = 0.30
VECTOR_ENABLED_THRESHOLD = 8  # only build embeddings once we have many learned skills


def _ensure_dirs() -> None:
    LEARNED_DIR.mkdir(parents=True, exist_ok=True)


def _read_index() -> dict:
    _ensure_dirs()
    if not INDEX_PATH.exists():
        return {}
    try:
        return json.loads(INDEX_PATH.read_text())
    except Exception:
        return {}


def _write_index(idx: dict) -> None:
    _ensure_dirs()
    INDEX_PATH.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9-]+", "-", name.strip().lower())
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:60] or "skill"


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ─── Builtin skill registration ─────────────────────────────────────────────
# Builtins are pushed by monkey.skills at import time via register_builtin().
_BUILTINS: dict[str, dict] = {}


def register_builtin(name: str, pattern: re.Pattern, content: str, description: str = "") -> None:
    _BUILTINS[name] = {
        "name": name,
        "pattern": pattern,
        "content": content,
        "description": description or name,
        "triggers": [],
        "source": "builtin",
    }


def list_builtin_names() -> list[str]:
    return list(_BUILTINS.keys())


# ─── Learned skill CRUD ─────────────────────────────────────────────────────

def list_learned() -> dict:
    return _read_index()


def get_learned(name: str) -> dict | None:
    idx = _read_index()
    return idx.get(name)


def read_learned_content(name: str) -> str:
    entry = get_learned(name)
    if not entry:
        return ""
    p = LEARNED_DIR / entry["path"]
    if not p.exists():
        return ""
    return p.read_text()


def save_learned(name: str, description: str, triggers: list[str], content: str,
                 sources: list[str] | None = None) -> dict:
    """Persist a learned skill. Returns the index entry."""
    _ensure_dirs()
    slug = _slugify(name)
    if slug in _BUILTINS:
        raise ValueError(f"name '{slug}' clashes with builtin")
    idx = _read_index()
    rel_path = f"{slug}.md"
    (LEARNED_DIR / rel_path).write_text(content)
    entry = {
        "name": slug,
        "description": description.strip()[:200],
        "triggers": [t.strip().lower() for t in triggers if t.strip()][:20],
        "source": "learned",
        "path": rel_path,
        "sources": sources or [],
        "created_at": time.time(),
        "updated_at": time.time(),
        "version": (idx.get(slug, {}).get("version", 0) + 1),
        "uses": idx.get(slug, {}).get("uses", 0),
    }
    idx[slug] = entry
    _write_index(idx)
    _invalidate_embed(slug)
    _enforce_cap(idx)
    return entry


def delete_learned(name: str) -> bool:
    slug = _slugify(name)
    idx = _read_index()
    if slug not in idx:
        return False
    p = LEARNED_DIR / idx[slug]["path"]
    if p.exists():
        p.unlink()
    del idx[slug]
    _write_index(idx)
    _invalidate_embed(slug)
    return True


def bump_use(name: str) -> None:
    idx = _read_index()
    if name in idx:
        idx[name]["uses"] = idx[name].get("uses", 0) + 1
        idx[name]["last_used_at"] = time.time()
        _write_index(idx)


def _enforce_cap(idx: dict) -> None:
    if len(idx) <= MAX_LEARNED:
        return
    # LRU prune by last_used_at then created_at
    items = sorted(
        idx.values(),
        key=lambda e: (e.get("last_used_at", 0), e.get("created_at", 0)),
    )
    to_drop = items[: len(idx) - MAX_LEARNED]
    for entry in to_drop:
        delete_learned(entry["name"])


def quota_check() -> tuple[bool, str]:
    idx = _read_index()
    cutoff = time.time() - 24 * 3600
    recent = sum(1 for e in idx.values() if e.get("created_at", 0) >= cutoff)
    if recent >= MAX_LEARNED_PER_DAY:
        return False, f"quota quotidienne atteinte ({recent}/{MAX_LEARNED_PER_DAY})"
    return True, ""


def cooldown_check(topic: str) -> tuple[bool, str]:
    idx = _read_index()
    now = time.time()
    norm = topic.strip().lower()
    for e in idx.values():
        if (e.get("description", "").lower() == norm or e["name"] == _slugify(topic)) \
                and (now - e.get("created_at", 0)) < COOLDOWN_SECONDS:
            return False, f"skill on similar topic created <{COOLDOWN_SECONDS//3600}h ago"
    return True, ""


# ─── Embeddings (optional, lazy) ────────────────────────────────────────────

def _read_embeds() -> dict:
    if not EMBEDS_PATH.exists():
        return {}
    try:
        return json.loads(EMBEDS_PATH.read_text())
    except Exception:
        return {}


def _write_embeds(d: dict) -> None:
    _ensure_dirs()
    EMBEDS_PATH.write_text(json.dumps(d))


def _invalidate_embed(name: str) -> None:
    e = _read_embeds()
    if name in e:
        del e[name]
        _write_embeds(e)


def _embed_text(text: str) -> list[float] | None:
    """Compute embedding via backend; returns None on failure or if disabled."""
    if os.getenv("MONKEY_DISABLE_EMBED", "0") == "1":
        return None
    try:
        from monkey import llm as llm_mod
        from monkey import store
        import httpx
        token = store.get("TOKEN")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Cookie"] = f"token={token}"
        resp = httpx.post(
            f"{llm_mod.BACKEND_URL}/api/llm/embed",
            json={"input": text[:4000]},
            headers=headers, timeout=20, verify=False,
        )
        if resp.status_code != 200:
            return None
        d = resp.json()
        vec = d.get("embedding") or d.get("data", [{}])[0].get("embedding")
        if isinstance(vec, list) and vec:
            return [float(x) for x in vec]
    except Exception:
        return None
    return None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _ensure_embed_for(name: str, summary: str) -> list[float] | None:
    """Build/cache embedding for a learned skill summary."""
    embeds = _read_embeds()
    h = _content_hash(summary)
    cached = embeds.get(name)
    if cached and cached.get("hash") == h:
        return cached["vec"]
    vec = _embed_text(summary)
    if vec:
        embeds[name] = {"hash": h, "vec": vec}
        _write_embeds(embeds)
    return vec


# ─── Selection / scoring ────────────────────────────────────────────────────

def _keyword_score(haystack: str, triggers: list[str]) -> float:
    if not triggers:
        return 0.0
    hl = haystack.lower()
    hits = sum(1 for t in triggers if t and t in hl)
    if hits == 0:
        return 0.0
    return min(0.8, 0.4 + 0.15 * hits)


def select_skills(user_message: str, workspace_files: Iterable[str] | None = None,
                  enable_vector: bool | None = None) -> str:
    """Return concatenated skill blocks for the matched skills."""
    haystack = (user_message or "") + "\n" + "\n".join(workspace_files or [])
    if not haystack.strip():
        return ""

    scored: list[tuple[float, str, str, dict]] = []  # (score, name, content, entry)

    # Builtins via regex
    for name, b in _BUILTINS.items():
        if b["pattern"].search(haystack):
            scored.append((1.0, name, b["content"], b))

    # Learned via triggers + (optional) vector
    learned = _read_index()
    use_vec = enable_vector
    if use_vec is None:
        use_vec = len(learned) >= VECTOR_ENABLED_THRESHOLD

    user_vec = None
    if use_vec and learned:
        user_vec = _embed_text(user_message[:1000])

    for name, e in learned.items():
        triggers = e.get("triggers", [])
        kw = _keyword_score(haystack, triggers)
        vec_score = 0.0
        if user_vec and use_vec:
            summary = e.get("description", "") + "\n" + " ".join(triggers)
            v = _ensure_embed_for(name, summary)
            if v:
                vec_score = max(0.0, _cosine(user_vec, v))
        score = max(kw, vec_score)
        if score >= MIN_SCORE:
            content = read_learned_content(name)
            if content:
                scored.append((score, name, content, e))

    if not scored:
        return ""

    # Top-K by score, dedupe by name
    scored.sort(key=lambda x: -x[0])
    seen: set[str] = set()
    chosen = []
    for s, n, c, e in scored:
        if n in seen:
            continue
        seen.add(n)
        chosen.append((s, n, c, e))
        if len(chosen) >= TOP_K:
            break

    # Bump usage counters for learned ones
    for s, n, c, e in chosen:
        if e.get("source") == "learned":
            bump_use(n)

    blocks = [c for _, _, c, _ in chosen]
    return "\n\n# ─── SKILLS STACK ACTIVÉES ───\n\n" + "\n\n".join(blocks)
