"""Per-animal site memory: which hosts produced useful results for which intent.

Tiny JSON-backed store. Injected into search/browser protocols so the agent
prioritizes sites that already worked for this animal.

Local-only (sidecar-side). Not synced server-side.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

_LOCK = threading.Lock()
_PATH = Path(os.environ.get("MONKEY_SITE_MEMORY") or (Path.home() / ".monkey" / "site_memory.json"))

# Intent classification — keep terse, keyword-based. Same keys reused everywhere.
_INTENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "real_estate": (
        "maison", "appartement", "studio", "loyer", "louer", "vente immobil", "achat immobil",
        "immobilier", "immo ", "house", "apartment", "rent", "for sale", "real estate", "wohnung",
        "casa", "alquiler", "vivienda", "piso",
    ),
    "shopping": (
        "acheter", "prix", "best price", "buy ", "shop", "shopping", "amazon", "promo", "discount",
        "soldes", "comparateur", "comparer prix",
    ),
    "second_hand": (
        "occasion", "leboncoin", "vinted", "second hand", "used ", "ebay-klein",
    ),
    "travel": (
        "vol ", "flight", "hotel", "hôtel", "booking", "voyage", "trip", "airbnb", "vacances",
        "kayak", "skyscanner", "tripadvisor",
    ),
    "jobs": (
        "emploi", "job ", "jobs", "recrutement", "offre d'emploi", "stage", "cdi", "cdd",
        "freelance mission", "linkedin job",
    ),
    "food": (
        "restaurant", "resto", "bar ", "café ", "yelp", "thefork",
    ),
    "cars": (
        "voiture", "auto occasion", "car ", "vehicle", "lacentrale", "autotrader",
    ),
    "code": (
        "github", "stackoverflow", "code ", "snippet", "library", "package", "install ",
        "error ", "exception ", "bug ",
    ),
    "academic": (
        "paper", "publication", "arxiv", "doi", "scholar", "thèse", "thesis",
    ),
    "news": (
        "actualité", "actualite", "news ", "presse", "journal ",
    ),
}


def classify_intent(msg: str) -> str:
    """Return intent kind for `msg`, or 'other' if nothing matches."""
    if not msg:
        return "other"
    low = msg.lower()
    for kind, kws in _INTENT_KEYWORDS.items():
        if any(k in low for k in kws):
            return kind
    return "other"


def _load() -> dict:
    try:
        if not _PATH.exists():
            return {}
        return json.loads(_PATH.read_text("utf-8") or "{}")
    except Exception:
        return {}


def _save(data: dict) -> None:
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    except Exception:
        pass


def _host_of(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


_NOISE_HOSTS = {
    "google.com", "google.fr", "google.de", "google.es", "google.co.uk", "google.it",
    "consent.google.com", "accounts.google.com",
    "bing.com", "duckduckgo.com", "yandex.com", "yandex.ru",
    "recaptcha.net",
}


def record_hit(animal_id: str | None, intent_kind: str, url: str, ok: bool) -> None:
    """Bump or decay a host's score for (animal, intent). No-op on noise/empty."""
    host = _host_of(url)
    if not host or host in _NOISE_HOSTS or not intent_kind or intent_kind == "other":
        return
    key_animal = (animal_id or "_default").strip() or "_default"
    with _LOCK:
        data = _load()
        a = data.setdefault(key_animal, {})
        kind = a.setdefault(intent_kind, {})
        entry = kind.setdefault(host, {"score": 0.0, "hits": 0, "last": 0})
        delta = 1.0 if ok else -0.5
        entry["score"] = float(entry.get("score", 0)) + delta
        entry["hits"] = int(entry.get("hits", 0)) + 1
        entry["last"] = int(time.time())
        # Cap noise: drop entries with score <= -3
        if entry["score"] <= -3:
            kind.pop(host, None)
        _save(data)


def top_sites(animal_id: str | None, intent_kind: str, n: int = 5) -> list[str]:
    """Return top-N hosts for this animal+intent, ordered by score desc."""
    if not intent_kind or intent_kind == "other":
        return []
    key_animal = (animal_id or "_default").strip() or "_default"
    data = _load()
    kind = (data.get(key_animal) or {}).get(intent_kind) or {}
    if not kind:
        return []
    ranked = sorted(
        kind.items(),
        key=lambda kv: (float(kv[1].get("score", 0)), int(kv[1].get("last", 0))),
        reverse=True,
    )
    return [host for host, meta in ranked[:n] if float(meta.get("score", 0)) > 0]
