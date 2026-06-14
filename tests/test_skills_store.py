"""Tests for monkey/skills_store.py and monkey/tools/skills_tool.py.

Covers :
- builtin registration via monkey.skills
- learned skill CRUD + persistence
- regex selection (builtins) and trigger/keyword selection (learned)
- quota + cooldown
- LRU cap
- name conflict (builtin vs learned)
- vector cosine helper
- skill_create pipeline mocked end-to-end (LLM + research stubbed)
- audit fail-closed paths
- agent dispatcher routes new tools
"""
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _patched_store(tmp_path: Path):
    from monkey import skills_store
    skills_store.ROOT = tmp_path / "skills"
    skills_store.LEARNED_DIR = skills_store.ROOT / "learned"
    skills_store.INDEX_PATH = skills_store.ROOT / "index.json"
    skills_store.EMBEDS_PATH = skills_store.ROOT / "embeds.json"
    skills_store.LEARNED_DIR.mkdir(parents=True, exist_ok=True)
    return skills_store


# ─── Builtin registration ───────────────────────────────────────────────────

def test_builtins_registered_via_skills_module():
    from monkey import skills, skills_store
    names = skills_store.list_builtin_names()
    # at least the original technical + grand-public skills
    for expected in ("typescript", "python", "rust", "cooking", "writing-helper",
                     "best-friend", "money-budget", "admin-france"):
        assert expected in names, f"builtin '{expected}' missing"


def test_builtin_regex_select(tmp_path):
    skills_store = _patched_store(tmp_path)
    from monkey import skills  # ensures register
    # builtins ride on regex match → score 1.0
    out = skills_store.select_skills("comment cuisiner des pâtes carbonara")
    assert "[SKILL Cooking" in out


# ─── Learned CRUD ───────────────────────────────────────────────────────────

def test_save_and_load_learned(tmp_path):
    s = _patched_store(tmp_path)
    content = (
        "[SKILL Visa Japon — démarche touristique 2026]\n\n"
        "DURÉE : 90 jours sans visa pour Français.\n"
        "PASSEPORT : valide pendant le séjour.\n"
        "VOIR : ambassade-japon.fr\n\n"
        "SOURCES:\n- https://example.gouv.fr/japon\n- https://mofa.go.jp/visa"
    )
    entry = s.save_learned(
        name="Visa Japon", description="visa touristique Japon",
        triggers=["japon", "tokyo", "visa", "vacances japon"],
        content=content, sources=["https://example.gouv.fr/japon"],
    )
    assert entry["name"] == "visa-japon"
    assert entry["version"] == 1
    # persisted on disk
    assert (s.LEARNED_DIR / "visa-japon.md").exists()
    assert s.read_learned_content("visa-japon") == content


def test_learned_select_via_triggers(tmp_path):
    s = _patched_store(tmp_path)
    from monkey import skills  # noqa
    s.save_learned(
        name="visa-japon", description="visa Japon",
        triggers=["japon", "tokyo", "visa japon"],
        content="[SKILL Visa Japon — démo]\n\nVOIR ambassade.\n\nSOURCES:\n- https://x.com/a\n- https://y.com/b",
    )
    out = s.select_skills("je pars en vacances à Tokyo l'an prochain", enable_vector=False)
    assert "visa-japon" in out.lower() or "Visa Japon" in out


def test_delete_learned(tmp_path):
    s = _patched_store(tmp_path)
    s.save_learned("temp", "test", ["x"], "[SKILL Temp — t]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d")
    assert s.delete_learned("temp") is True
    assert s.delete_learned("temp") is False
    assert not (s.LEARNED_DIR / "temp.md").exists()


def test_name_conflict_with_builtin(tmp_path):
    s = _patched_store(tmp_path)
    from monkey import skills  # registers builtins
    import pytest
    with pytest.raises(ValueError):
        s.save_learned("python", "py", ["py"], "[SKILL Python — x]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d")


# ─── Quota + cooldown ───────────────────────────────────────────────────────

def test_quota_check_blocks_after_limit(tmp_path):
    s = _patched_store(tmp_path)
    for i in range(s.MAX_LEARNED_PER_DAY):
        s.save_learned(f"sk{i}", f"topic {i}", ["x"],
                       "[SKILL X — y]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d")
    ok, why = s.quota_check()
    assert not ok
    assert "quota" in why.lower()


def test_cooldown_check_recent_topic(tmp_path):
    s = _patched_store(tmp_path)
    s.save_learned("topic-x", "topic x", ["x"],
                   "[SKILL X — y]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d")
    ok, _ = s.cooldown_check("topic x")
    assert not ok
    ok, _ = s.cooldown_check("totally other")
    assert ok


def test_lru_cap(tmp_path):
    s = _patched_store(tmp_path)
    s.MAX_LEARNED = 3
    for i in range(5):
        s.save_learned(f"sk{i}", f"t{i}", ["x"],
                       "[SKILL X — y]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d")
        time.sleep(0.01)
    idx = s.list_learned()
    assert len(idx) <= 3
    # newest preserved (sk4 must be in)
    assert "sk4" in idx


# ─── Vector helper ──────────────────────────────────────────────────────────

def test_cosine_unit_vectors():
    from monkey.skills_store import _cosine
    assert _cosine([1, 0], [1, 0]) == 1.0
    assert abs(_cosine([1, 0], [0, 1])) < 1e-9
    assert _cosine([1, 1], [1, 1]) > 0.99
    assert _cosine([], [1]) == 0.0


def test_select_falls_back_when_embed_unavailable(tmp_path):
    s = _patched_store(tmp_path)
    # disable network embed
    os.environ["MONKEY_DISABLE_EMBED"] = "1"
    try:
        for i in range(s.VECTOR_ENABLED_THRESHOLD + 1):
            s.save_learned(
                f"learned-{i}", f"sujet {i}", [f"kw{i}", "shared-keyword"],
                f"[SKILL L{i} — t]\n\nbody.\n\nSOURCES:\n- https://a/b\n- https://c/d",
            )
        out = s.select_skills("question avec shared-keyword", enable_vector=None)
        assert out  # at least one should match via keyword fallback
    finally:
        os.environ.pop("MONKEY_DISABLE_EMBED", None)


# ─── skill_create pipeline ─────────────────────────────────────────────────

_FAKE_DISTILL = """[SKILL Visa Japon — démarche touristique 2026]

DURÉE : 90 jours sans visa pour ressortissants français.
PASSEPORT : valide pendant tout le séjour.
DOUANE : règles strictes sur médicaments.
SANTÉ : disclaimer — ce skill est informatif, vérifier auprès de l'ambassade.

SOURCES:
- https://www.diplomatie.gouv.fr/fr/conseils-aux-voyageurs/conseils-par-pays-destination/japon/
- https://www.mofa.go.jp/j_info/visit/visa/index.html
"""

_FAKE_AUDIT_OK = '{"ok": true, "issues": []}'
_FAKE_AUDIT_BAD = '{"ok": false, "issues": ["sources_invented"]}'


def test_skill_create_happy_path(tmp_path, monkeypatch):
    s = _patched_store(tmp_path)
    from monkey.tools import skills_tool

    calls = {"n": 0}
    def fake_llm(messages):
        calls["n"] += 1
        return _FAKE_DISTILL if calls["n"] == 1 else _FAKE_AUDIT_OK

    def fake_research(queries, max_pages=3):
        return ("=== Query: visa japon ===\nDes infos sur le visa japonais "
                "https://www.mofa.go.jp/visa…" + "x" * 600), \
               ["https://www.mofa.go.jp/visa", "https://diplomatie.gouv.fr/japon"]

    monkeypatch.setattr(skills_tool, "_llm_call", fake_llm)
    monkeypatch.setattr(skills_tool, "_research", fake_research)

    out = skills_tool.skill_create(
        name="visa-japon", topic="visa touristique Japon",
        triggers=["japon", "tokyo", "visa"],
        research_queries=["visa japon touriste 2026", "ambassade japon paris"],
    )
    assert out.startswith("OK:"), out
    assert s.get_learned("visa-japon") is not None
    content = s.read_learned_content("visa-japon")
    assert "[SKILL" in content
    assert "SOURCES" in content


def test_skill_create_rejected_if_audit_fails(tmp_path, monkeypatch):
    _patched_store(tmp_path)
    from monkey.tools import skills_tool

    def fake_llm(messages):
        # 1st call distill, 2nd audit — make audit say not ok
        if any("audit" in (m.get("content") or "").lower() for m in messages):
            return _FAKE_AUDIT_BAD
        return _FAKE_DISTILL

    def fake_research(queries, max_pages=3):
        return "x" * 800, ["https://a.test/1", "https://b.test/2"]

    # detect distill vs audit by message system
    def routed(messages):
        sysmsg = next((m["content"] for m in messages if m.get("role") == "system"), "")
        if "audites" in sysmsg.lower():
            return _FAKE_AUDIT_BAD
        return _FAKE_DISTILL

    monkeypatch.setattr(skills_tool, "_llm_call", routed)
    monkeypatch.setattr(skills_tool, "_research", fake_research)

    out = skills_tool.skill_create(
        name="bad-skill", topic="topic",
        triggers=["a", "b"], research_queries=["q1", "q2"],
    )
    assert out.startswith("ERREUR:")
    assert "audit" in out.lower()


def test_skill_create_rejects_short_research(tmp_path, monkeypatch):
    _patched_store(tmp_path)
    from monkey.tools import skills_tool
    monkeypatch.setattr(skills_tool, "_research", lambda q, max_pages=3: ("too short", []))
    out = skills_tool.skill_create(
        name="short-skill", topic="x",
        triggers=["a"], research_queries=["q"],
    )
    assert out.startswith("ERREUR:")
    assert "recherche" in out.lower()


def test_audit_structural_fail_closed(tmp_path):
    _patched_store(tmp_path)
    from monkey.tools.skills_tool import _audit
    # missing SOURCES + skill header → reject without LLM
    ok, issues = _audit("juste du texte sans rien")
    assert ok is False
    assert any("source" in i for i in issues) or "missing_skill_header" in issues


def test_skill_search_returns_existing(tmp_path):
    _patched_store(tmp_path)
    from monkey import skills  # noqa - register builtins
    from monkey.tools import skills_tool
    out = skills_tool.skill_search("recette de pâtes")
    assert "Cooking" in out or "cooking" in out


def test_skill_search_empty_query():
    from monkey.tools import skills_tool
    out = skills_tool.skill_search("")
    assert out.startswith("ERREUR:")


def test_skill_list_format(tmp_path):
    _patched_store(tmp_path)
    from monkey import skills  # noqa
    from monkey.tools import skills_tool
    import json
    out = skills_tool.skill_list()
    d = json.loads(out)
    assert "builtin" in d and "learned" in d
    assert d["total"] >= len(d["builtin"])


# ─── Agent dispatcher wiring ───────────────────────────────────────────────

def test_agent_tool_registry_contains_skill_tools():
    from monkey import agent
    expected = {"skill_list", "skill_search", "skill_create", "skill_revise", "skill_delete"}
    assert expected.issubset(agent.TOOL_NAMES)
