"""Tests for agent.chat_stream loop primitives.

Cover :
- _persist_session writes a session row
- hard cap on max_iters cannot be exceeded by set_plan growth
- skill_create hot-injects content into current system prompt
- subagent inherits skills + halts on loop detection
- _quality_gate basic pass/fail
"""
import os
import sys
import json
from urllib.parse import unquote_plus, urlparse, parse_qs
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _patched_memory(tmp_path: Path):
    from monkey import memory
    memory.DB_PATH = tmp_path / "memory.db"
    return memory


def test_persist_session_is_noop(tmp_path):
    # Contract changed: _persist_session is intentionally a no-op to avoid
    # capturing hallucinated tool outputs as "memory". Explicit memorization
    # only via remember_fact / remember_note.
    mem = _patched_memory(tmp_path)
    from monkey import agent
    with patch.object(agent, "mem_mod", mem):
        agent._persist_session(
            user_message="fais un PDF de recette",
            final_text="OK PDF généré dans /tmp/r.pdf",
            tool_results=[{"name": "generate_pdf", "args": {}, "result": "OK"}],
        )
    assert mem.get_recent_sessions(5) == []


def test_persist_session_swallows_errors(tmp_path):
    from monkey import agent
    # Fake mem_mod that always raises
    class Boom:
        def save_session(self, *_a, **_k):
            raise RuntimeError("db down")
    with patch.object(agent, "mem_mod", Boom()):
        agent._persist_session("x", "y", [])  # must not raise


def test_hard_cap_constant_present():
    """Defensive: ensure the hard cap exists in source so it can't be removed silently."""
    src = Path(__file__).parent.parent / "monkey" / "agent.py"
    text = src.read_text()
    assert "_HARD_CAP_ITERS" in text
    # Cap is min()-clamped at the two budget update sites
    assert text.count("_HARD_CAP_ITERS") >= 3


def test_search_and_read_does_not_index_kb(tmp_path, monkeypatch):
    """search_and_read must NOT auto-index into KB (ephemeral results pollute context)."""
    from monkey.tools import web
    from monkey import kb_store

    monkeypatch.setenv("KB_DB_PATH", str(tmp_path / "kb.db"))
    monkeypatch.setenv("MONKEY_DISABLE_EMBED", "1")

    monkeypatch.setattr(web, "_search_via_browser", lambda q, n: [
        {"url": "https://example.test/a", "title": "test query result A", "snippet": "test query details"},
        {"url": "https://example.test/b", "title": "test query result B", "snippet": "test query more"},
    ])
    monkeypatch.setattr(web, "fetch_page", lambda u, n=2000: f"contenu détaillé pour {u} " * 30)

    out = web.search_and_read("test query", max_pages=2)
    assert "example.test" in out
    assert kb_store.size() == 0


def test_subagent_inherits_skills(monkeypatch):
    """_run_subagent must build a system prompt that includes selected skills."""
    from monkey import agent, skills as _skills_mod
    captured = {}

    def fake_chat(messages, model_id, tools):
        captured["system"] = messages[0]["content"]
        return {"text": "fini", "tool_calls": []}

    monkeypatch.setattr(agent.llm_mod, "chat", fake_chat)
    monkeypatch.setattr(_skills_mod, "select_skills", lambda msg: "[SKILL Cooking — test]\nbody")

    out = agent._run_subagent("comment cuisiner des pâtes")
    assert "Cooking" in captured["system"]
    assert out == "fini"


def test_subagent_halts_on_loop(monkeypatch):
    """If a tool returns the same error repeatedly, subagent must abort."""
    from monkey import agent
    call_count = {"n": 0}

    def fake_chat(messages, model_id, tools):
        call_count["n"] += 1
        if call_count["n"] >= 8:
            return {"text": "stop", "tool_calls": []}
        return {
            "text": "",
            "tool_calls": [{
                "id": f"t{call_count['n']}",
                "function": {"name": "read_file", "arguments": '{"path":"/no.txt"}'},
            }],
        }

    monkeypatch.setattr(agent.llm_mod, "chat", fake_chat)
    monkeypatch.setattr(agent, "_dispatch_tool",
                        lambda n, a: "ERREUR: file not found")

    out = agent._run_subagent("read /no.txt")
    assert out  # returns gracefully (loop or text), no exception
    # Loop detection should have stopped before 15 iters consumed
    assert call_count["n"] <= 8


def test_quality_gate_passes_for_docs_only():
    from monkey.agent import _quality_gate
    issues = _quality_gate([
        {"name": "generate_pdf", "args": {"path": "out.pdf"}, "result": "OK PDF written"},
    ])
    assert issues == []


def test_quality_gate_flags_code_without_build():
    from monkey.agent import _quality_gate
    issues = _quality_gate([
        {"name": "write_file", "args": {"path": "src/main.ts"}, "result": "OK: wrote src/main.ts"},
    ])
    assert issues  # missing build/test execution


def test_skill_hot_inject_logic():
    """Read the skill_create hot-inject path and verify its anchor exists."""
    src = Path(__file__).parent.parent / "monkey" / "agent.py"
    text = src.read_text()
    assert 'fn_name == "skill_create"' in text
    assert "messages[0][\"content\"] += " in text


def test_agent_dispatch_unknown_tool():
    from monkey.agent import _dispatch_tool
    out = _dispatch_tool("does_not_exist", {})
    assert out.startswith("ERREUR:")
    assert "outil inconnu" in out


def test_chat_stream_surfaces_terminal_audit_failure(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda _name, _args: "OK: file content")
    monkeypatch.setattr(agent, "_DIRECT_ACTION_RETURN_TOOLS", frozenset())

    main_calls = {"n": 0}
    audit_calls = {"n": 0}

    def fake_call(messages, _model_id, tools=None, force_tool=False):
        tail = "\n".join(str(m.get("content") or "") for m in messages[-3:])
        if "AUDIT" in tail and "Reply JSON only" in tail:
            audit_calls["n"] += 1
            return {
                "text": "not json" if audit_calls["n"] == 1 else "still not json",
                "tool_calls": [],
            }
        main_calls["n"] += 1
        if main_calls["n"] == 1:
            return {
                "text": "",
                "tool_calls": [{
                    "id": "t1",
                    "function": {"name": "read_file", "arguments": '{"path":"package.json"}'},
                }],
            }
        return {"text": "Voici le contenu.", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Lis package.json",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    audit_events = [ev for ev in events if ev.get("event") == "audit"]
    assert [ev.get("status") for ev in audit_events] == ["checking", "failed", "checking", "failed"]
    assert audit_events[-1].get("terminal") is True
    assert events[-1]["event"] == "done"
    assert events[-1]["data"].startswith("ERREUR: self-audit failed")


def test_audit_fail_counter_resets_when_gate_rearms():
    src = Path(__file__).parent.parent / "monkey" / "agent.py"
    text = src.read_text()
    assert text.count("_audit_fail_count = 0") >= 3


def test_detect_action_tool_prefers_add_reminder():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "set a reminder: drink water in 1 hour",
        {"add_reminder", "schedule_agent_task", "set_plan"},
    )

    assert tool == "add_reminder"


def test_detect_action_tool_prefers_read_file():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "lis le fichier package.json",
        {"read_file", "write_file", "run_command"},
    )

    assert tool == "read_file"


def test_detect_action_tool_prefers_skill_list():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "show me the available skills",
        {"skill_list", "skill_search", "expand_tools"},
    )

    assert tool == "skill_list"


def test_detect_action_tool_prefers_set_plan():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "fais un plan en 3 étapes pour nettoyer ma boîte mail",
        {"set_plan", "schedule_agent_task"},
    )

    assert tool == "set_plan"


def test_detect_action_tool_prefers_set_plan_for_numbered_organize_prompt():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "organise pour moi : 1) collecter les pdfs du workspace 2) faire un résumé 3) écrire un rapport",
        {"set_plan", "list_dir", "glob_files"},
    )

    assert tool == "set_plan"


def test_detect_action_tool_prefers_list_dir_for_workspace():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "show the files in my workspace",
        {"list_dir", "read_file", "write_file"},
    )

    assert tool == "list_dir"


def test_detect_action_tool_prefers_list_dir_for_whats_in_workspace_folder():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "what's in my workspace folder?",
        {"list_dir", "read_file", "search_web"},
    )

    assert tool == "list_dir"


def test_detect_action_tool_prefers_list_dir_for_french_show_workspace():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "montre-moi les fichiers du workspace",
        {"list_dir", "read_file", "search_web"},
    )

    assert tool == "list_dir"


def test_detect_action_tool_prefers_list_dir_for_ls_workspace():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "ls my workspace",
        {"list_dir", "run_command"},
    )

    assert tool == "list_dir"


def test_detect_action_tool_prefers_recall_facts():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "list the facts you know about me",
        {"recall_facts", "remember_note"},
    )

    assert tool == "recall_facts"


def test_detect_action_tool_prefers_glob_files_for_pdfs():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "find every PDF in my workspace",
        {"glob_files", "run_command", "list_dir"},
    )

    assert tool == "glob_files"


def test_detect_action_tool_prefers_glob_files_for_search_pdfs():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "search all pdf files in workspace",
        {"glob_files", "run_command", "list_dir"},
    )

    assert tool == "glob_files"


def test_detect_action_tool_prefers_search_web_for_weather():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "il fait quel temps maintenant ?",
        {"search_web", "fetch_page", "http_request"},
    )

    assert tool == "search_web"


def test_detect_action_tool_prefers_fetch_page_for_page_url():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "récupère la page https://example.com",
        {"fetch_page", "download_file", "http_request"},
    )

    assert tool == "fetch_page"


def test_detect_action_tool_prefers_http_request_for_api_call():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "call https://api.github.com/zen and show me the response",
        {"search_web", "fetch_page", "http_request"},
    )

    assert tool == "http_request"


def test_detect_action_tool_prefers_search_web_for_general_web_query():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "find the latest news about bitcoin",
        {"search_web", "run_command"},
    )

    assert tool == "search_web"


def test_detect_action_tool_prefers_search_web_for_price_query():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "donne-moi le prix actuel du bitcoin en USD",
        {"search_web", "fetch_page"},
    )

    assert tool == "search_web"


def test_detect_action_tool_prefers_search_web_for_definition_query():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "définition du mot homéostasie",
        {"search_web", "fetch_page"},
    )

    assert tool == "search_web"


def test_detect_action_tool_prefers_generate_image_for_draw_prompt():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "draw a cat on the moon in watercolor style",
        {"generate_image", "search_images"},
    )

    assert tool == "generate_image"


def test_detect_action_tool_does_not_confuse_create_folder_with_image_generation():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "create a folder named battery_test_dir",
        {"generate_image", "create_dir", "run_command"},
    )

    assert tool in {"create_dir", "run_command"}


def test_detect_action_tool_prefers_search_images_for_french_photo_query():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "montre-moi des photos de la tour Eiffel",
        {"search_images", "search_web"},
    )

    assert tool == "search_images"


def test_detect_action_tool_prefers_skill_search_for_topic_query():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "cherche un skill existant sur le visa touristique japonais",
        {"skill_list", "skill_search"},
    )

    assert tool == "skill_search"


def test_detect_action_tool_prefers_search_web_for_wikipedia_article():
    from monkey.agent import _detect_action_tool

    tool = _detect_action_tool(
        "fetch the wikipedia article about Alan Turing",
        {"search_web", "fetch_page"},
    )

    assert tool == "search_web"


def test_try_deterministic_weekday_schedule_parses_daily_summary():
    from monkey.agent import _try_deterministic_weekday_schedule

    args = _try_deterministic_weekday_schedule("schedule a daily summary at 8am every weekday")

    assert args is not None
    assert "summary" in args["prompt"]
    assert args["recurrence"] == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    assert len(args["scheduled_for"]) == 16


def test_try_deterministic_weekday_schedule_parses_french_weekday_format():
    from monkey.agent import _try_deterministic_weekday_schedule

    args = _try_deterministic_weekday_schedule("programme un résumé quotidien à 8h en semaine")

    assert args is not None
    assert "résumé" in args["prompt"]
    assert args["recurrence"] == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"


def test_try_deterministic_weekly_schedule_parses_sunday_call_mom():
    from monkey.agent import _try_deterministic_weekly_schedule

    args = _try_deterministic_weekly_schedule("schedule a task to remind me to call mom every sunday at 6pm")

    assert args is not None
    assert "call mom" in args["prompt"]
    assert args["recurrence"] == "FREQ=WEEKLY;BYDAY=SU"


def test_try_deterministic_oneshot_schedule_parses_relative_minutes():
    from monkey.agent import _try_deterministic_oneshot_schedule

    args = _try_deterministic_oneshot_schedule("schedule a reminder to drink water in 60 min")

    assert args is not None
    assert args["prompt"] == "drink water"
    assert args["title"] == "drink water"
    # One-shot must NOT carry a recurrence (else it repeats forever).
    assert "recurrence" not in args
    assert len(args["scheduled_for"]) == 16


def test_try_deterministic_oneshot_schedule_parses_french_hours_prefix():
    from monkey.agent import _try_deterministic_oneshot_schedule

    args = _try_deterministic_oneshot_schedule("dans 1 heure rappelle moi de sortir le chien")

    assert args is not None
    assert args["prompt"] == "sortir le chien"
    assert "recurrence" not in args


def test_try_deterministic_oneshot_schedule_ignores_recurring():
    """Recurring wording belongs to the recurring builders — one-shot must defer."""
    from monkey.agent import _try_deterministic_oneshot_schedule

    assert _try_deterministic_oneshot_schedule("remind me every 30 min to stretch") is None
    assert _try_deterministic_oneshot_schedule("toutes les 2 heures rappelle moi") is None


def test_schedule_agent_task_is_terminal_direct_return():
    """schedule_agent_task must early-return after the first forced call so weak
    models can't re-call it (duplicate tasks). Regression guard, 2026-06-08."""
    from monkey.agent import _DIRECT_ACTION_RETURN_TOOLS

    assert "schedule_agent_task" in _DIRECT_ACTION_RETURN_TOOLS


def test_try_deterministic_run_command_args_extracts_backtick_command():
    from monkey.agent import _try_deterministic_run_command_args

    args = _try_deterministic_run_command_args("run `echo battery-ok` for me", "/tmp")

    assert args == {"command": "echo battery-ok", "cwd": "/tmp"}


def test_try_deterministic_run_command_args_prefers_calculator_shortcut():
    from monkey.agent import _try_deterministic_run_command_args

    args = _try_deterministic_run_command_args("lance la calculatrice macOS", "/tmp")

    assert args == {"command": "open -a Calculator", "cwd": "/tmp"}


def test_try_deterministic_run_command_args_uses_python_for_base64():
    from monkey.agent import _try_deterministic_run_command_args

    args = _try_deterministic_run_command_args("encode 'hello' en base64", "/tmp")

    assert args is not None
    assert args["cwd"] == "/tmp"
    assert args["command"].startswith("python3 -c ")
    assert args["command"].endswith(" hello")


def test_try_deterministic_recall_facts_args_lists_all_facts():
    from monkey.agent import _try_deterministic_recall_facts_args

    args = _try_deterministic_recall_facts_args("list the facts you know about me")

    assert args == {"key": ""}


def test_memory_request_recognizes_save_the_fact_that():
    from monkey.agent import _looks_like_memory_request

    assert _looks_like_memory_request("save the fact that my favorite color is teal")


def test_try_deterministic_fetch_page_args_extracts_url():
    from monkey.agent import _try_deterministic_fetch_page_args

    args = _try_deterministic_fetch_page_args("récupère la page https://example.com")

    assert args == {"url": "https://example.com", "max_chars": 12000}


def test_try_deterministic_search_web_args_builds_query():
    from monkey.agent import _try_deterministic_search_web_args

    args = _try_deterministic_search_web_args("find the latest news about bitcoin")

    assert args == {"query": "find latest news about bitcoin", "max_results": 3}


def test_try_deterministic_search_web_args_supports_homepage_lookup():
    from monkey.agent import _try_deterministic_search_web_args

    args = _try_deterministic_search_web_args("show me github.com's homepage content")

    assert args is not None
    assert "github" in args["query"].lower()
    assert "homepage" in args["query"].lower()


def test_try_deterministic_search_images_args_extracts_query():
    from monkey.agent import _try_deterministic_search_images_args

    args = _try_deterministic_search_images_args("search images of red pandas")

    assert args == {"query": "red pandas", "max_results": 5}


def test_try_deterministic_skill_list_args_returns_empty_payload():
    from monkey.agent import _try_deterministic_skill_list_args

    args = _try_deterministic_skill_list_args("liste tous les skills disponibles")

    assert args == {}


def test_try_deterministic_generate_image_args_uses_prompt():
    from monkey.agent import _try_deterministic_generate_image_args

    args = _try_deterministic_generate_image_args("draw a cat on the moon in watercolor style")

    assert args == {
        "prompt": "A watercolor painting of a cat on the moon, dreamy composition, soft brush strokes, detailed fur, starry night sky",
        "size": "384x384",
        "seed": 1780042950,
    }


def test_try_deterministic_http_request_args_extracts_get_request():
    from monkey.agent import _try_deterministic_http_request_args

    args = _try_deterministic_http_request_args("call https://api.github.com/zen and show me the response")

    assert args == {
        "url": "https://api.github.com/zen",
        "method": "GET",
    }


def test_finalize_direct_action_result_embeds_generated_image():
    from monkey.agent import _finalize_direct_action_result

    final = _finalize_direct_action_result(
        "generate_image",
        "OK: image generated (local FLUX) -> /tmp/cat.png (246 KB) [AI-marked]",
    )

    assert final == "![image](/tmp/cat.png)"


def test_chat_stream_deterministic_set_plan_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    events = list(agent.chat_stream(
        history=[],
        user_message="plan a 3-step task: clean the inbox, write a summary, save it",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "set_plan" for ev in events)
    assert any(ev.get("event") == "plan" and ev.get("steps") == ["clean the inbox", "write a summary", "save it"] for ev in events)
    assert events[-1]["event"] == "done"
    assert events[-1]["data"].startswith("Plan ready:")


def test_chat_stream_deterministic_generic_plan_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    events = list(agent.chat_stream(
        history=[],
        user_message="set up a 4-step roadmap for a personal portfolio website",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "set_plan" for ev in events)
    plan_events = [ev for ev in events if ev.get("event") == "plan"]
    assert plan_events
    assert len(plan_events[-1]["steps"]) == 4
    assert events[-1]["event"] == "done"
    assert len(events[-1]["data"]) >= 40


def test_chat_stream_deterministic_skill_list_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda name, _args: "skill-a\nskill-b" if name == "skill_list" else "ERREUR: unexpected tool")

    events = list(agent.chat_stream(
        history=[],
        user_message="liste tous les skills disponibles",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "skill_list" for ev in events)
    assert events[-1]["event"] == "done"
    assert "skill-a" in events[-1]["data"]


def test_chat_stream_deterministic_recall_facts_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda name, args: "- favorite_color: teal" if name == "recall_facts" else "ERREUR: unexpected tool")

    events = list(agent.chat_stream(
        history=[],
        user_message="list the facts you know about me",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "recall_facts" for ev in events)
    assert events[-1]["event"] == "done"
    assert "favorite_color" in events[-1]["data"]


def test_chat_stream_direct_returns_after_forced_skill_list(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    calls = {"n": 0}

    def fake_call(_messages, _model_id, tools=None, force_tool=False):
        calls["n"] += 1
        return {
            "text": "",
            "tool_calls": [{
                "id": "t1",
                "function": {"name": "skill_list", "arguments": "{}"},
            }],
        }

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda name, _args: "skill-a\nskill-b" if name == "skill_list" else "ERREUR: unexpected tool")

    events = list(agent.chat_stream(
        history=[],
        user_message="show me the available skills",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert calls["n"] in {0, 1}
    assert any(ev.get("event") == "tool_start" and ev.get("name") == "skill_list" for ev in events)
    assert events[-1]["event"] == "done"
    assert "skill-a" in events[-1]["data"]


def test_chat_stream_deterministic_run_command_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda name, args: f"[exit=0] {args['command']}" if name == "run_command" else "ERREUR: unexpected tool")

    events = list(agent.chat_stream(
        history=[],
        user_message="run the command echo battery-ok",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "run_command" for ev in events)
    assert events[-1]["event"] == "done"
    assert "echo battery-ok" in events[-1]["data"]


def test_small_talk_recognizes_who_are_you():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("who are you?") is True


def test_small_talk_recognizes_thanks_a_lot():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("thanks a lot") is True


def test_small_talk_recognizes_where_am_i():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("où suis-je ?") is True


def test_small_talk_recognizes_good_morning():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("good morning")


def test_small_talk_recognizes_whats_my_location():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("what's my location?") is True


def test_small_talk_recognizes_many_thanks():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("many thanks")


def test_small_talk_recognizes_yo():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("yo")


def test_small_talk_recognizes_hows_it_going():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("how's it going?")


def test_small_talk_recognizes_tu_es_qui():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("tu es qui ?")


def test_small_talk_recognizes_tell_me_the_time():
    from monkey.agent import _is_pure_small_talk

    assert _is_pure_small_talk("tell me the time")


def test_shell_request_does_not_treat_natural_language_find_as_command():
    from monkey.agent import _looks_like_shell_request

    assert not _looks_like_shell_request("find the latest news about bitcoin") is True


def test_auto_browser_probe_triggers_on_first_nudge():
    from monkey.agent import _should_auto_browser_probe

    assert _should_auto_browser_probe(
        1,
        is_game_project=True,
        dist_html="/tmp/game/dist/index.html",
        already_done=False,
    ) is True
    assert _should_auto_browser_probe(
        0,
        is_game_project=True,
        dist_html="/tmp/game/dist/index.html",
        already_done=False,
    ) is False
    assert _should_auto_browser_probe(
        1,
        is_game_project=False,
        dist_html="/tmp/game/dist/index.html",
        already_done=False,
    ) is False


def test_refresh_local_tools_maps_dynamic_categories(monkeypatch):
    from monkey import agent

    fake_tool = {
        "type": "function",
        "function": {
            "name": "local_speak",
            "description": "tts",
            "parameters": {"type": "object", "properties": {"text": {"type": "string"}}},
        },
    }
    fake_models = [{"id": "piper-tts", "task": "tts", "tool_name": "local_speak"}]

    monkeypatch.setattr("monkey.local_models.tools.dynamic_tools", lambda: [fake_tool])
    monkeypatch.setattr("monkey.local_models.catalog.all_models", lambda: fake_models)

    agent._refresh_local_tools()

    assert agent._TOOL_CATEGORIES.get("local_speak") == "media"

    search_names = {
        t["function"]["name"]
        for t in agent._get_active_tools(None, frozenset({"core_min", "search", "browse"}))
    }
    assert "local_speak" not in search_names

    media_names = {
        t["function"]["name"]
        for t in agent._get_active_tools(None, frozenset({"core_min", "media"}))
    }
    assert "local_speak" in media_names


def test_scheduled_whatsapp_runs_do_not_auto_load_media_tools(monkeypatch):
    from monkey import agent

    fake_tool = {
        "type": "function",
        "function": {
            "name": "local_speak",
            "description": "tts",
            "parameters": {"type": "object", "properties": {"text": {"type": "string"}}},
        },
    }
    fake_models = [{"id": "piper-tts", "task": "tts", "tool_name": "local_speak"}]

    monkeypatch.setattr("monkey.local_models.tools.dynamic_tools", lambda: [fake_tool])
    monkeypatch.setattr("monkey.local_models.catalog.all_models", lambda: fake_models)

    agent._refresh_local_tools()

    live_names = {
        t["function"]["name"]
        for t in agent._get_active_tools(
            None,
            agent._select_packs("orchestrate", "hello", "whatsapp:demo"),
        )
    }
    scheduled_names = {
        t["function"]["name"]
        for t in agent._get_active_tools(
            None,
            agent._select_packs("orchestrate", "hello", "whatsapp:demo", scheduled_run=True),
        )
    }

    assert "local_speak" in live_names
    assert "local_speak" not in scheduled_names


def test_deepseek_v3_uses_compressed_tool_schema(monkeypatch):
    from monkey import agent
    from monkey.tools import image as image_tools

    # _drop_unavailable_tools hides generate_image when no FLUX/custom image
    # endpoint is configured on the host; force it available so the schema
    # comparison is deterministic across environments.
    monkeypatch.setattr(image_tools, "image_generation_available", lambda: True)

    compact = agent._get_active_tools("deepseek/deepseek-v3.2")

    assert compact is not agent.TOOLS
    assert len(compact) == len(agent.TOOLS)
    assert any(
        compact_tool["function"]["description"] != full_tool["function"]["description"]
        for compact_tool, full_tool in zip(compact, agent.TOOLS)
    )


def test_whatsapp_web_requests_force_web_tools():
    from monkey import agent

    assert agent._should_force_web_tools(
        "Quel est le prix du bitcoin aujourd'hui ?",
        "search",
        "whatsapp:demo",
    ) is True
    assert agent._should_force_web_tools(
        "comment tu vas",
        "chat",
        "whatsapp:demo",
    ) is False
    assert agent._should_force_web_tools(
        "Quel est le prix du bitcoin aujourd'hui ?",
        "search",
        "desktop:demo",
    ) is False


def test_whatsapp_web_requests_do_not_force_generic_questions():
    from monkey import agent

    assert agent._should_force_web_tools(
        "Tu fais quoi ?",
        "search",
        "whatsapp:demo",
    ) is False


def test_web_query_overlap_rejects_ambiguous_only_match():
    from monkey import agent

    assert agent._web_query_overlaps_user(
        "repair windows audio",
        "windows secure boot policy mismatch",
    ) is False


def test_whatsapp_chat_stream_forces_first_tool_call(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda _name, _args: "OK: stub search result")
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    calls: list[bool] = []

    def fake_call(messages, model_id, tools=None, force_tool=False):
        calls.append(force_tool)
        if len(calls) == 1:
            return {
                "text": "",
                "tool_calls": [{
                    "id": "t1",
                    "function": {
                        "name": "search_web",
                        "arguments": json.dumps({"query": "bitcoin price today"}),
                    },
                }],
            }
        if len(calls) == 2:
            return {"text": "Le bitcoin est en hausse.", "tool_calls": []}
        return {"text": "{\"ok\": true, \"issues\": []}", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Quel est le prix du bitcoin aujourd'hui ?",
        model_id="test-model",
        session_id="whatsapp:demo",
        animal_id="monkey",
    ))

    assert calls[0] is True
    assert any(ev.get("event") == "tool_start" and ev.get("name") == "search_web" for ev in events)
    assert events[-1]["event"] == "done"


def test_whatsapp_chat_stream_rewrites_unrelated_forced_query(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    dispatched: list[dict] = []

    def fake_dispatch(name, args):
        if name == "search_web":
            dispatched.append(dict(args))
            return "OK: []"
        return "ERREUR: unexpected tool"

    calls = {"n": 0}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "text": "",
                "tool_calls": [{
                    "id": "t1",
                    "function": {
                        "name": "search_web",
                        "arguments": json.dumps({"query": "tokyo weather today"}),
                    },
                }],
            }
        return {"text": "Le bitcoin est en hausse.", "tool_calls": []}

    monkeypatch.setattr(agent, "_dispatch_tool", fake_dispatch)
    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Quel est le prix du bitcoin aujourd'hui ?",
        model_id="test-model",
        session_id="whatsapp:demo",
        animal_id="monkey",
    ))

    assert dispatched, "search_web should have been called"
    q = str(dispatched[0].get("query") or "").lower()
    assert "bitcoin" in q
    assert "tokyo" not in q
    assert any(ev.get("event") == "tool_query_rewritten" for ev in events)
    assert events[-1]["event"] == "done"


def test_whatsapp_chat_stream_rewrites_unrelated_browser_search_url(monkeypatch, tmp_path):
    from monkey import agent

    # Isolated workspace: the message mentions "dossier_sylvanus" and the folder-image
    # short-circuit (_deterministic_folder_image_reply) rglobs the whole workspace for a
    # matching dir. With "/tmp" it matched stale pytest litter and pre-empted the LLM flow
    # this test exercises. tmp_path is empty → short-circuit no-ops → rewrite path runs.
    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", str(tmp_path)))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    dispatched: list[dict] = []

    def fake_dispatch(name, args):
        if name == "browser_navigate":
            dispatched.append(dict(args))
            return "OK: {}"
        return "ERREUR: unexpected tool"

    calls = {"n": 0}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "text": "",
                "tool_calls": [{
                    "id": "t1",
                    "function": {
                        "name": "browser_navigate",
                        "arguments": json.dumps({"url": "https://duckduckgo.com/?q=repair+windows+11+audio"}),
                    },
                }],
            }
        return {"text": "Done.", "tool_calls": []}

    monkeypatch.setattr(agent, "_dispatch_tool", fake_dispatch)
    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Evangelize Maxime at Sylvanus cult and send images from dossier_sylvanus",
        model_id="test-model",
        session_id="whatsapp:demo",
        animal_id="monkey",
    ))

    assert dispatched, "browser_navigate should have been called"
    url = str(dispatched[0].get("url") or "")
    parsed = urlparse(url)
    q = unquote_plus((parse_qs(parsed.query).get("q") or [""])[0]).lower()
    assert "windows" not in q
    assert "sylvanus" in q or "maxime" in q
    assert any(ev.get("event") == "tool_query_rewritten" for ev in events)
    assert events[-1]["event"] == "done"


def test_scheduled_run_rewrites_unrelated_search_query(monkeypatch, tmp_path):
    from monkey import agent

    # Isolated workspace — see test_whatsapp_chat_stream_rewrites_unrelated_browser_search_url:
    # avoids the folder-image short-circuit matching stale "dossier_sylvanus" dirs under /tmp.
    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", str(tmp_path)))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    dispatched: list[dict] = []

    def fake_dispatch(name, args):
        if name == "search_and_read":
            dispatched.append(dict(args))
            return "OK: []"
        return "ERREUR: unexpected tool"

    calls = {"n": 0}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "text": "",
                "tool_calls": [{
                    "id": "t1",
                    "function": {
                        "name": "search_and_read",
                        "arguments": json.dumps({"query": "ldconfig introuvable dans PATH correction"}),
                    },
                }],
            }
        return {"text": "Done.", "tool_calls": []}

    monkeypatch.setattr(agent, "_dispatch_tool", fake_dispatch)
    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Evangelize Maxime at Sylvanus cult and send images from dossier_sylvanus",
        model_id="test-model",
        session_id="whatsapp:demo",
        animal_id="monkey",
        scheduled_run=True,
    ))

    assert dispatched, "search_and_read should have been called"
    q = str(dispatched[0].get("query") or "").lower()
    assert "sylvanus" in q or "maxime" in q
    assert "ldconfig" not in q
    assert any(ev.get("event") == "tool_query_rewritten" for ev in events)
    assert events[-1]["event"] == "done"


def test_scheduled_run_skips_live_whatsapp_protocol(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    captured: dict[str, str] = {}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        captured["system"] = str(messages[0].get("content") or "")
        return {"text": "Done.", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Prépare un résumé factuel.",
        model_id="test-model",
        session_id="whatsapp:demo",
        animal_id="monkey",
        scheduled_run=True,
    ))

    assert "WHATSAPP CONVERSATIONAL OUTPUT" not in captured["system"]
    assert "WhatsApp has FULL agent parity with desktop chat." not in captured["system"]
    assert events[-1]["event"] == "done"


def test_chat_stream_recovers_folder_image_requests_when_model_skips_tools(monkeypatch, tmp_path):
    from monkey import agent

    target = tmp_path / "sylvanus"
    target.mkdir()
    (target / "tree.png").write_bytes(b"png")
    (target / "note.txt").write_text("ignore")

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", tmp_path))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    calls: list[tuple[bool, list[str]]] = []

    def fake_call(_messages, _model_id, tools=None, force_tool=False):
        tool_names = [t["function"]["name"] for t in (tools or [])]
        calls.append((force_tool, tool_names))
        return {
            "text": "I will inspect the folder and fetch the images for you.",
            "tool_calls": [],
        }

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="donne moi les images de sylvanus depuis le dossier sylvanus",
        model_id="phi-4-mini:3.8b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert calls == []
    assert any(ev.get("event") == "tool_start" and ev.get("name") == "list_dir_images" for ev in events)
    assert events[-1]["event"] == "done"
    assert "![tree.png](" in events[-1]["data"]
    assert "Please rephrase" not in events[-1]["data"]


def test_ensure_non_empty_final_inlines_list_dir_images_results():
    from monkey.agent import _ensure_non_empty_final

    result = json.dumps({
        "directory": "/Users/test/Documents/Agent/sylvanus",
        "count": 2,
        "truncated": False,
        "images": [
            {"name": "tree.png", "path": "/Users/test/Documents/Agent/sylvanus/tree.png", "relativePath": "sylvanus/tree.png", "sizeBytes": 3},
            {"name": "river.jpg", "path": "/Users/test/Documents/Agent/sylvanus/river.jpg", "relativePath": "sylvanus/river.jpg", "sizeBytes": 3},
        ],
    }, ensure_ascii=False)

    final = _ensure_non_empty_final(
        messages=[],
        user_message="donne moi les images de sylvanus depuis le dossier sylvanus",
        model_id="phi-4-mini:3.8b",
        text="Voici.",
        tool_results=[{"name": "list_dir_images", "args": {"path": "sylvanus"}, "result": result}],
    )

    assert "Voici." in final
    assert "![tree.png](sylvanus/tree.png)" in final
    assert "![river.jpg](sylvanus/river.jpg)" in final


def test_chat_stream_executes_inline_text_tool_call_and_inlines_images(monkeypatch, tmp_path):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", tmp_path))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    replies = iter([
        {"text": "```sh\nlist_dir_images('sylvanus')\n```", "tool_calls": []},
        {"text": "Les images du dossier sont ici.", "tool_calls": []},
    ])

    def fake_call(_messages, _model_id, _tools=None, force_tool=False):
        return next(replies)

    result = json.dumps({
        "directory": str(tmp_path / "sylvanus"),
        "count": 1,
        "truncated": False,
        "images": [
            {"name": "tree.png", "path": str(tmp_path / "sylvanus" / "tree.png"), "relativePath": "sylvanus/tree.png", "sizeBytes": 3},
        ],
    }, ensure_ascii=False)

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)
    monkeypatch.setattr(agent, "_dispatch_tool", lambda name, _args: result if name == "list_dir_images" else "ERREUR: unexpected tool")

    events = list(agent.chat_stream(
        history=[],
        user_message="montre moi les images de sylvanus depuis le dossier sylvanus",
        model_id="phi-4-mini:3.8b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "list_dir_images" for ev in events)
    assert events[-1]["event"] == "done"
    assert "![tree.png](sylvanus/tree.png)" in events[-1]["data"]


def test_extract_inline_tool_call_accepts_unquoted_path():
    from monkey.agent import _extract_inline_tool_call

    parsed = _extract_inline_tool_call("```now\nlist_dir_images(/Users/test/Documents/Agent/sylvanus)\n```")

    assert parsed == ("list_dir_images", {"path": "/Users/test/Documents/Agent/sylvanus"})


def test_chat_stream_short_circuits_folder_image_requests(monkeypatch, tmp_path):
    from monkey import agent

    folder = tmp_path / "dossier_sylvanus"
    folder.mkdir()
    (folder / "tree.png").write_bytes(b"png")

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", tmp_path))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    called = {"llm": 0}

    def fake_call(*_args, **_kwargs):
        called["llm"] += 1
        return {"text": "should not be called", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    events = list(agent.chat_stream(
        history=[],
        user_message="montre moi les images de sylvanus depuis le dossier sylvanus",
        model_id="phi-4-mini:3.8b",
        session_id="desktop:demo",
        animal_id="monkey",
        context_folder=str(folder),
    ))

    assert called["llm"] == 0
    assert any(ev.get("event") == "tool_start" and ev.get("name") == "list_dir_images" for ev in events)
    assert events[-1]["event"] == "done"
    assert "![tree.png](" in events[-1]["data"]


def test_chat_stream_short_circuits_underscore_folder_without_context(monkeypatch, tmp_path):
    # User writes "dossier_sylvanus" with no context_folder configured — the
    # deterministic short-circuit must still resolve the folder by name. Regression
    # guard: small chat models (Ministral 3 3B) fail to call list_dir_images on
    # their own, so we MUST handle this in the deterministic path.
    from monkey import agent

    folder = tmp_path / "dossier_sylvanus"
    folder.mkdir()
    (folder / "tree.png").write_bytes(b"png")

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", tmp_path))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    called = {"llm": 0}

    def fake_call(*_args, **_kwargs):
        called["llm"] += 1
        return {"text": "should not be called", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    events = list(agent.chat_stream(
        history=[],
        user_message="montre moi les images du dossier_sylvanus",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert called["llm"] == 0
    assert any(ev.get("event") == "tool_start" and ev.get("name") == "list_dir_images" for ev in events)
    assert events[-1]["event"] == "done"
    assert "![tree.png](" in events[-1]["data"]


def test_prepare_messages_for_llm_synthesizes_large_context(monkeypatch):
    from monkey import agent

    messages = [{"role": "system", "content": "sys"}] + [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"bloc-{i} " + ("x" * 20000)}
        for i in range(20)
    ]
    calls = {"n": 0}

    def fake_synthesize(msgs, llm_call_fn, model_id):
        calls["n"] += 1
        msgs[:] = [msgs[0], {"role": "user", "content": "[SYNTHÈSE HISTORIQUE]\ncompact"}] + msgs[-8:]

    from monkey import context_mgr
    monkeypatch.setattr(context_mgr, "synthesize_history", fake_synthesize)

    synth_passes = agent._prepare_messages_for_llm(messages, None, agent._llm_call_raw)

    assert synth_passes == 1
    assert calls["n"] == 1
    assert any((m.get("content") or "").startswith("[SYNTHÈSE HISTORIQUE]") for m in messages)


def test_chat_helper_uses_context_guard(monkeypatch):
    from monkey import agent

    seen = {"called": 0}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        seen["called"] += 1
        return {"text": "ok", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    out = agent.chat([], "bonjour")

    assert out == "ok"
    assert seen["called"] == 1


def test_subagent_uses_context_guard(monkeypatch):
    from monkey import agent

    seen = {"called": 0}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        seen["called"] += 1
        return {"text": "fini", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    out = agent._run_subagent("résume ceci")

    assert out == "fini"
    assert seen["called"] == 1


# ── Game launch (chess MVP) ──────────────────────────────────────────────────

def test_detect_game_launch_positive():
    from monkey import agent
    positives = [
        "play chess",
        "let's play chess",
        "on joue aux échecs",
        "jouer aux echecs",
        "lance une partie d'échecs",
        "I want to play a game of chess",
        "start chess",
        "fais un cheeze game",
        "ouvre les échecs",
        "partie d'echec",
        "partie d’échec",
        "une partie d'échecs",
        "jouer aux échec",
    ]
    for msg in positives:
        assert agent._detect_game_launch(msg) == {"game": "chess"}, msg


def test_detect_game_launch_negative():
    from monkey import agent
    negatives = [
        "explain the rules of chess",
        "what is the best chess opening",
        "check this out",
        "jeu de dames",
        "parle moi des échecs de Marcel Duchamp",
        "ma partie a été un échec total",
        "x" * 250,
        "",
    ]
    for msg in negatives:
        assert agent._detect_game_launch(msg) is None, msg


def test_detect_game_launch_rpg_positive():
    from monkey import agent
    positives = [
        "lance un jdr",
        "on joue à un jeu de rôle",
        "joue a un jeu de role",
        "play rpg",
        "start an rpg",
        "lance une partie de jdr",
        "ouvre un jeu d'aventure",
        "démarre un donjon",
        "let's play a dungeon crawl",
        "je veux jouer à un rpg",
    ]
    for msg in positives:
        assert agent._detect_game_launch(msg) == {"game": "rpg"}, msg


def test_detect_game_launch_rpg_negative():
    from monkey import agent
    negatives = [
        "explain what a tabletop rpg is",
        "raconte moi l'histoire d'un jeu de rôle célèbre",
        "quel est le meilleur jdr papier",
        "I play guitar",
        "role of the manager in a team",
    ]
    for msg in negatives:
        assert agent._detect_game_launch(msg) is None, msg


def test_chat_stream_game_launch_shortcut(monkeypatch):
    from monkey import agent

    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", "/tmp"))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda _messages, _model_id, _fn: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_args, **_kwargs: None)

    events = list(agent.chat_stream(
        history=[],
        user_message="play chess",
        model_id="ministral-3-3b",
        session_id="desktop:demo",
        animal_id="monkey",
    ))

    assert any(ev.get("event") == "tool_start" and ev.get("name") == "launch_game" for ev in events)
    assert any(ev.get("event") == "game_launch" and ev.get("game") == "chess" for ev in events)
    assert events[-1]["event"] == "done"


# ── Chess move matcher (server guard-rail) ───────────────────────────────────

def test_match_chess_move_cases():
    from monkey.main import _match_chess_move
    legal = ["e5", "Nf6", "d5", "c5", "O-O", "e8=Q+"]
    assert _match_chess_move("e5", legal) == "e5"
    assert _match_chess_move("e5\n", legal) == "e5"
    assert _match_chess_move('"e5"', legal) == "e5"
    assert _match_chess_move("nf6", legal) == "Nf6"          # case-insensitive
    assert _match_chess_move("I play Nf6 here", legal) == "Nf6"  # token scan
    assert _match_chess_move("My move: O-O", legal) == "O-O"
    assert _match_chess_move("e8=Q+", legal) == "e8=Q+"
    assert _match_chess_move("Qxe7", legal) is None          # not legal
    assert _match_chess_move("", legal) is None
