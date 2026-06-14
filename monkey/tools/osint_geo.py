"""OSINT geo + news + entities (companies, wikidata).

`nominatim_geocode`: forward geocoding via OpenStreetMap Nominatim (free, no auth).
`nominatim_reverse`: reverse geocoding (lat/lon → address).
`gdelt_search`: search the GDELT 2.0 article API (world news, free, no auth).
`recherche_entreprises`: French company registry (SIREN, dirigeants, NAF, adresse) via api.recherche-entreprises.fabrique.social.gouv.fr.
`wikidata_search`: search Wikidata entities and pull a compact JSON of their key claims.
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote_plus

from monkey.tools import _netcache

_NOMINATIM = "https://nominatim.openstreetmap.org"
_UA_NOMINATIM = "Monkey-OSINT/1.0 (https://github.com/local)"  # Nominatim requires identifying UA


def nominatim_geocode(query: str, limit: int = 5) -> str:
    """Forward geocode an address/place → list of {display_name, lat, lon, type, osm_id}."""
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"
    url = f"{_NOMINATIM}/search?q={quote_plus(q)}&format=json&limit={limit}&addressdetails=1"
    resp = _netcache.request("GET", url, timeout=20, headers={"User-Agent": _UA_NOMINATIM})
    if resp.get("status") != 200:
        return f"ERREUR: nominatim status={resp.get('status')}"
    try:
        items = json.loads(resp.get("text") or "[]")
    except Exception as e:
        return f"ERREUR: nominatim parse failed: {e}"
    out = []
    for it in items[:limit]:
        out.append({
            "display_name": it.get("display_name"),
            "lat": float(it["lat"]) if it.get("lat") else None,
            "lon": float(it["lon"]) if it.get("lon") else None,
            "type": it.get("type"),
            "class": it.get("class"),
            "osm_id": it.get("osm_id"),
            "osm_type": it.get("osm_type"),
            "address": it.get("address"),
            "importance": it.get("importance"),
        })
    return json.dumps({"query": q, "count": len(out), "results": out},
                      ensure_ascii=False, indent=2)


def nominatim_reverse(lat: float, lon: float) -> str:
    """Reverse geocode lat/lon → structured address."""
    try:
        latf = float(lat); lonf = float(lon)
    except Exception:
        return "ERREUR: lat/lon must be numeric"
    url = f"{_NOMINATIM}/reverse?lat={latf}&lon={lonf}&format=json&addressdetails=1"
    resp = _netcache.request("GET", url, timeout=20, headers={"User-Agent": _UA_NOMINATIM})
    if resp.get("status") != 200:
        return f"ERREUR: nominatim status={resp.get('status')}"
    try:
        d = json.loads(resp.get("text") or "{}")
    except Exception as e:
        return f"ERREUR: nominatim parse failed: {e}"
    return json.dumps({
        "lat": latf, "lon": lonf,
        "display_name": d.get("display_name"),
        "address": d.get("address"),
        "osm_id": d.get("osm_id"),
        "osm_type": d.get("osm_type"),
    }, ensure_ascii=False, indent=2)


def gdelt_search(query: str, max_results: int = 20, timespan: str = "1m") -> str:
    """Search GDELT 2.0 for news articles. `timespan` examples: '24h', '7d', '1m', '6m', '1y'."""
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"
    url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={quote_plus(q)}"
           f"&mode=artlist&format=json&maxrecords={max_results}&timespan={timespan}&sort=datedesc")
    resp = _netcache.request("GET", url, timeout=20)
    if resp.get("status") != 200:
        return f"ERREUR: gdelt status={resp.get('status')}"
    txt = (resp.get("text") or "").strip()
    if not txt:
        return f"OK: no GDELT articles for '{q}'"
    try:
        d = json.loads(txt)
    except Exception as e:
        return f"ERREUR: gdelt parse failed: {e}"
    arts = []
    for a in (d.get("articles") or [])[:max_results]:
        arts.append({
            "title": a.get("title"),
            "url": a.get("url"),
            "domain": a.get("domain"),
            "language": a.get("language"),
            "seendate": a.get("seendate"),
            "sourcecountry": a.get("sourcecountry"),
        })
    return json.dumps({"query": q, "timespan": timespan, "count": len(arts), "articles": arts},
                      ensure_ascii=False, indent=2)


def recherche_entreprises(query: str, limit: int = 5) -> str:
    """Search French company registry (SIREN/SIRET, dirigeants, NAF, address). Free public API."""
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"
    url = f"https://recherche-entreprises.api.gouv.fr/search?q={quote_plus(q)}&per_page={limit}"
    resp = _netcache.request("GET", url, timeout=20)
    if resp.get("status") != 200:
        return f"ERREUR: recherche-entreprises status={resp.get('status')}"
    try:
        d = json.loads(resp.get("text") or "{}")
    except Exception as e:
        return f"ERREUR: parse failed: {e}"
    out = []
    for r in (d.get("results") or [])[:limit]:
        siege = r.get("siege") or {}
        out.append({
            "nom": r.get("nom_complet") or r.get("nom_raison_sociale"),
            "siren": r.get("siren"),
            "siret_siege": siege.get("siret"),
            "naf": r.get("activite_principale"),
            "date_creation": r.get("date_creation"),
            "tranche_effectif_salarie": r.get("tranche_effectif_salarie"),
            "nature_juridique": r.get("nature_juridique"),
            "etat_administratif": r.get("etat_administratif"),
            "adresse": siege.get("adresse"),
            "code_postal": siege.get("code_postal"),
            "commune": siege.get("libelle_commune"),
            "dirigeants": [
                {"nom": d.get("nom"), "prenoms": d.get("prenoms"),
                 "qualite": d.get("qualite"), "date_de_naissance": d.get("date_de_naissance")}
                for d in (r.get("dirigeants") or [])
            ],
        })
    return json.dumps({"query": q, "total": d.get("total_results", 0),
                       "count": len(out), "results": out},
                      ensure_ascii=False, indent=2)


def wikidata_search(query: str, limit: int = 5, lang: str = "en") -> str:
    """Search Wikidata entities by label; returns id, label, description, url for each match."""
    q = (query or "").strip()
    if not q:
        return "ERREUR: query required"
    url = (f"https://www.wikidata.org/w/api.php?action=wbsearchentities&search={quote_plus(q)}"
           f"&language={lang}&format=json&limit={limit}")
    resp = _netcache.request("GET", url, timeout=20)
    if resp.get("status") != 200:
        return f"ERREUR: wikidata status={resp.get('status')}"
    try:
        d = json.loads(resp.get("text") or "{}")
    except Exception as e:
        return f"ERREUR: wikidata parse failed: {e}"
    out = []
    for it in (d.get("search") or [])[:limit]:
        out.append({
            "id": it.get("id"),
            "label": it.get("label"),
            "description": it.get("description"),
            "url": it.get("concepturi") or (f"https://www.wikidata.org/wiki/{it.get('id')}" if it.get("id") else None),
        })
    return json.dumps({"query": q, "count": len(out), "results": out},
                      ensure_ascii=False, indent=2)
