"""Runtime skill management tools.

Exposes :
  - skill_list                     — list all skills (builtin + learned)
  - skill_search(query)            — find best matching existing skills
  - skill_create(name, topic, …)   — research the web, distill, audit, persist
  - skill_revise(name, reason)     — re-research and replace
  - skill_delete(name)             — drop a learned skill
"""
from __future__ import annotations
import json
import re
from typing import Iterable

from monkey import skills_store

# heuristic distill / audit prompts kept in-module for clarity
_DISTILL_SYSTEM = """Tu es un expert qui produit des fiches mémo (skills) pour un agent IA.
On te donne le SUJET et des EXTRAITS web bruts (sources hétérogènes).
Tu dois en extraire un skill dense, factuel, en français, structuré comme suit :

[SKILL <Nom> — <one-liner>]

— sections claires (5 à 10), titres en MAJUSCULES, listes denses
— chiffres, dates, démarches, URLs officielles préférées
— pas de phrase creuse, pas de duplicata d'info
— jamais de conseil médical/financier/juridique engageant
— si zone sensible (santé, finance, légal) : un disclaimer court en haut

Termine STRICTEMENT par :
SOURCES:
- url1
- url2
...

NE COPIE PAS de paragraphes entiers — reformule, condense.
Cible : 800 à 3000 caractères max.
"""

_AUDIT_SYSTEM = """Tu audites un skill généré par un autre agent. Tu réponds UNIQUEMENT en JSON :
{ "ok": true|false, "issues": [string, ...] }

Critères :
- contenu factuel cohérent avec le sujet annoncé ? (sinon ok=false)
- au moins 2 SOURCES citées avec URLs plausibles ?
- pas de phrases hallucinées (numéros de loi imaginaires, articles inexistants) ?
- si santé/finance/légal : disclaimer présent ?
- format respecté (titre [SKILL …], sections, SOURCES en bas) ?
- longueur entre 400 et 6000 caractères ?

Répond UNIQUEMENT avec le JSON, aucune explication.
"""


def _llm_call(messages: list[dict]) -> str:
    """Single-shot LLM helper (no tools)."""
    from monkey import agent as agent_mod
    try:
        out = agent_mod._call_llm_guarded(messages, None)
        return (out.get("text") or out.get("content") or "").strip()
    except Exception as e:
        return f"__LLM_ERROR__: {e}"


def _research(queries: Iterable[str], max_pages: int = 3) -> tuple[str, list[str]]:
    """Run search_and_read on each query, concatenate, return (raw_text, urls)."""
    from monkey.tools.web import search_and_read
    parts: list[str] = []
    urls: list[str] = []
    for q in queries:
        q = (q or "").strip()
        if not q:
            continue
        try:
            txt = search_and_read(q, max_pages=max_pages)
        except Exception as e:
            txt = f"(error on '{q}': {e})"
        parts.append(f"=== Query: {q} ===\n{txt}")
        for m in re.finditer(r"https?://[^\s)\]]+", txt):
            u = m.group(0).rstrip(".,;)")
            if u not in urls:
                urls.append(u)
    return "\n\n".join(parts)[:18000], urls[:20]


def _audit(content: str) -> tuple[bool, list[str]]:
    """Two-layer audit : structural checks first, then LLM."""
    issues: list[str] = []
    if len(content) < 400:
        issues.append("content_too_short")
    if len(content) > 8000:
        issues.append("content_too_long")
    if "SOURCES" not in content.upper():
        issues.append("missing_sources_section")
    urls = re.findall(r"https?://[^\s)\]]+", content)
    if len(urls) < 2:
        issues.append("less_than_2_sources")
    if not re.search(r"\[SKILL\s+", content):
        issues.append("missing_skill_header")
    if issues:
        return False, issues

    # LLM gate (fail-closed if unparseable)
    raw = _llm_call([
        {"role": "system", "content": _AUDIT_SYSTEM},
        {"role": "user", "content": content},
    ])
    if raw.startswith("__LLM_ERROR__"):
        return False, ["audit_llm_unreachable"]
    try:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return False, ["audit_unparseable"]
        d = json.loads(m.group(0))
        if not isinstance(d, dict) or "ok" not in d:
            return False, ["audit_unparseable"]
        if not d.get("ok"):
            return False, list(d.get("issues") or ["audit_rejected"])
        return True, []
    except Exception:
        return False, ["audit_unparseable"]


# ─── Public tool entry points ───────────────────────────────────────────────

def skill_list() -> str:
    builtins = skills_store.list_builtin_names()
    learned = skills_store.list_learned()
    out = {
        "builtin": sorted(builtins),
        "learned": [
            {"name": n, "description": e.get("description", ""),
             "triggers": e.get("triggers", []), "version": e.get("version", 1),
             "uses": e.get("uses", 0)}
            for n, e in sorted(learned.items())
        ],
        "total": len(builtins) + len(learned),
    }
    return json.dumps(out, ensure_ascii=False, indent=2)


def skill_search(query: str) -> str:
    """Show which skills would match `query`. Doesn't mutate state."""
    q = (query or "").strip()
    if not q:
        return "ERREUR: query vide"
    block = skills_store.select_skills(q)
    if not block:
        return f"Aucun skill ne couvre actuellement: {q!r}. Tu peux appeler skill_create pour le créer."
    # extract names from header lines [SKILL Name …]
    names = re.findall(r"\[SKILL\s+([A-Za-z0-9 _-]+?)\s*[—\-]", block)
    return f"Skills pertinents: {', '.join(names) if names else '(détectés via regex)'}\n\n--- contenu ---\n{block[:1500]}…"


def skill_create(name: str, topic: str, triggers: list[str],
                 research_queries: list[str]) -> str:
    """Research → distill → audit → persist a learned skill.
    Returns OK: … on success, ERREUR: … on rejection.
    """
    if not name or not topic:
        return "ERREUR: name et topic obligatoires"
    if not triggers:
        return "ERREUR: triggers obligatoires (5+ mots-clés)"
    if not research_queries:
        return "ERREUR: research_queries obligatoires (au moins 2)"

    ok, why = skills_store.quota_check()
    if not ok:
        return f"ERREUR: {why}"
    ok, why = skills_store.cooldown_check(topic)
    if not ok:
        return f"ERREUR: {why}"

    # 1. research
    raw, urls = _research(research_queries[:4], max_pages=3)
    if not raw or len(raw) < 400:
        return "ERREUR: recherche web insuffisante (sources <400 chars)"

    # 2. distill
    distill_user = (
        f"SUJET: {topic}\n"
        f"NOM CIBLE: {name}\n"
        f"DÉCLENCHEURS ATTENDUS: {', '.join(triggers)}\n\n"
        f"EXTRAITS WEB:\n{raw}"
    )
    content = _llm_call([
        {"role": "system", "content": _DISTILL_SYSTEM},
        {"role": "user", "content": distill_user},
    ])
    if content.startswith("__LLM_ERROR__"):
        return f"ERREUR: distillation LLM échouée ({content[:120]})"

    # ensure SOURCES block lists at least the URLs we collected
    if "SOURCES" not in content.upper() and urls:
        content = content.rstrip() + "\n\nSOURCES:\n" + "\n".join(f"- {u}" for u in urls[:8])

    # 3. audit (fail-closed)
    ok, issues = _audit(content)
    if not ok:
        return f"ERREUR: skill rejeté par audit — {', '.join(issues)}"

    # 4. persist
    try:
        entry = skills_store.save_learned(
            name=name, description=topic, triggers=triggers,
            content=content, sources=urls,
        )
    except ValueError as e:
        return f"ERREUR: {e}"

    return (
        f"OK: skill '{entry['name']}' créé (v{entry['version']}, "
        f"{len(content)} chars, {len(urls)} sources)."
    )


def skill_revise(name: str, reason: str) -> str:
    entry = skills_store.get_learned(name)
    if not entry:
        return f"ERREUR: skill '{name}' inconnu"
    triggers = entry.get("triggers", [])
    queries = [entry.get("description", name) + " " + reason] + [
        f"{name} {t}" for t in triggers[:2]
    ]
    return skill_create(
        name=name, topic=entry.get("description", name),
        triggers=triggers, research_queries=queries,
    )


def skill_delete(name: str) -> str:
    if name in skills_store.list_builtin_names():
        return "ERREUR: impossible de supprimer un skill builtin"
    if skills_store.delete_learned(name):
        return f"OK: skill '{name}' supprimé"
    return f"ERREUR: skill '{name}' inconnu"
