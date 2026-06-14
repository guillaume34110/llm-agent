#!/usr/bin/env python3
"""Agent quality battery — multi-category, real-flow, no regex shortcuts.

Runs the live sidecar `/chat/stream` with a battery of prompts spanning five
categories the user requires for production confidence:

  1. coherence   — common chit-chat / info requests, must answer coherently
                   *without* mis-firing tools
  2. tool        — tool-call validation: each prompt names a single best tool;
                   we assert that tool fired (path/arg sanity-checked when
                   relevant)
  3. web         — web research: search_web / search_images / search_news /
                   extract_url etc. must fire and the response must mention
                   results
  4. task        — multi-step plan creation: set_plan / add_reminder /
                   schedule_agent_task must fire
  5. skills      — pack expansion + skills lookup flow must work for small models
  6. image_gen   — image generation flow, must call generate_image and emit
                   markdown image link

Each test has a validator dict. Validators check both (a) the right tool fired
and (b) the user-facing response is coherent. We never coerce the path: if the
LLM picks the wrong folder, that's a real fail.

Usage:
    TEST_MODEL_ID=ministral-3-3b python3 scripts/test_agent_battery.py
    TEST_MODEL_ID=ministral-3-3b python3 scripts/test_agent_battery.py --category tool
    TEST_MODEL_ID=ministral-3-3b python3 scripts/test_agent_battery.py --verbose
    TEST_MODEL_ID=ministral-3-3b python3 scripts/test_agent_battery.py --min-success-rate 0.95
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import threading
import time
import urllib.request
import urllib.error


class _HardTimeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise _HardTimeout("hard timeout exceeded")


signal.signal(signal.SIGALRM, _alarm_handler)

SIDECAR = os.getenv("MONKEY_SIDECAR_URL", "http://localhost:3471")
MODEL_ID = os.getenv("TEST_MODEL_ID", "ministral-3-3b")
TIMEOUT = int(os.getenv("TEST_TIMEOUT", "240"))
VARIANT_SEED = int(os.getenv("TEST_VARIANT_SEED", str(int(time.time()))))
MIN_SUCCESS_RATE = float(os.getenv("TEST_MIN_SUCCESS_RATE", "0.90"))
# Efficiency gate: max fraction of tests allowed to be inefficient (overkill
# steps / redundant calls / over latency budget). None = report only, no gate.
_eff_env = os.getenv("TEST_MIN_EFFICIENCY_RATE")
MIN_EFFICIENCY_RATE = float(_eff_env) if _eff_env else None
# Optional LLM-as-judge quality scoring (slow, subjective → opt-in, never gates).
JUDGE_ENABLED = os.getenv("TEST_JUDGE", "0") == "1"
JUDGE_MODEL = os.getenv("TEST_JUDGE_MODEL", MODEL_ID)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
_rng = random.Random(VARIANT_SEED)

# Per-category efficiency budgets. `max_tools` counts SUBSTANTIVE tool calls
# (inert think/expand_tools excluded, reported separately). `max_seconds` is a
# soft wall-clock budget for the whole turn. Calibrated for a small local model
# on an M2: a request should resolve in the fewest steps that actually work.
INERT_TOOLS = {"think", "expand_tools"}
CATEGORY_BUDGETS = {
    "coherence":    {"max_tools": 1, "max_seconds": 25},
    "tool":         {"max_tools": 2, "max_seconds": 50},
    "web":          {"max_tools": 4, "max_seconds": 120},
    "task":         {"max_tools": 3, "max_seconds": 60},
    "skills":       {"max_tools": 2, "max_seconds": 50},
    "image_gen":    {"max_tools": 3, "max_seconds": 180},
    "conversation": {"max_tools": 3, "max_seconds": 90},
}


def pick(variants):
    """Pick one prompt variant per run so the model can't overfit to fixed wording.
    String → returned as-is. List → random choice seeded by TEST_VARIANT_SEED."""
    if isinstance(variants, str):
        return variants
    return _rng.choice(variants)


def stream_chat(prompt: str, history: list[dict] | None = None,
                session_id: str | None = None) -> list[dict]:
    body = {
        "message": prompt,
        "model_id": MODEL_ID,
        "provider_mode": "local",
        "session_id": session_id or f"battery-{int(time.time() * 1000)}",
        "history": history or [],
    }
    req = urllib.request.Request(
        f"{SIDECAR}/chat/stream",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    events: list[dict] = []
    t0 = time.time()
    signal.alarm(TIMEOUT + 10)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            for raw in resp:
                if time.time() - t0 > TIMEOUT:
                    events.append({"event": "_timeout"})
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    events.append(json.loads(payload))
                except json.JSONDecodeError:
                    events.append({"event": "_unparseable", "raw": payload[:200]})
    except _HardTimeout:
        events.append({"event": "_timeout"})
    except urllib.error.URLError as e:
        if "timed out" in str(e).lower() or "closed" in str(e).lower():
            events.append({"event": "_timeout"})
        else:
            events.append({"event": "_transport_error", "data": str(e)})
    except Exception as e:
        msg = repr(e)
        if any(k in msg.lower() for k in ("timed out", "closed", "abort")):
            events.append({"event": "_timeout"})
        else:
            events.append({"event": "_exception", "data": msg})
    finally:
        signal.alarm(0)
    return events


def find_tool_calls(events: list[dict], name: str) -> list[dict]:
    return [e for e in events if e.get("event") == "tool_start" and e.get("name") == name]


def find_done(events: list[dict]) -> str:
    for e in events:
        if e.get("event") == "done":
            return str(e.get("data") or "")
    return ""


def all_tool_names(events: list[dict]) -> list[str]:
    return [e.get("name", "") for e in events if e.get("event") == "tool_start"]


# ── Efficiency metrics ───────────────────────────────────────────────────────


def count_tools(events: list[dict]) -> tuple[int, int]:
    """Return (substantive, inert) tool-call counts. Inert = think/expand_tools
    which carry no result but still cost a model round-trip."""
    sub = inert = 0
    for n in all_tool_names(events):
        if n in INERT_TOOLS:
            inert += 1
        else:
            sub += 1
    return sub, inert


def redundant_tool_calls(events: list[dict]) -> int:
    """Count repeated identical calls (same name + same args). A model that
    re-issues the exact same tool call is looping / wasting steps."""
    seen: dict[str, int] = {}
    redundant = 0
    for e in events:
        if e.get("event") != "tool_start":
            continue
        key = e.get("name", "") + "::" + json.dumps(e.get("args") or {}, sort_keys=True, ensure_ascii=False)
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            redundant += 1
    return redundant


def efficiency_check(events: list[dict], dt: float, budget: dict) -> tuple[bool, str, dict]:
    """Judge whether the turn was efficient against its category budget.
    Returns (ok, reason, metrics). Orthogonal to functional correctness."""
    sub, inert = count_tools(events)
    redundant = redundant_tool_calls(events)
    metrics = {"sub": sub, "inert": inert, "redundant": redundant, "dt": dt}
    problems = []
    if sub > budget["max_tools"]:
        problems.append(f"{sub} tools > budget {budget['max_tools']}")
    if redundant:
        problems.append(f"{redundant} redundant call(s)")
    if dt > budget["max_seconds"]:
        problems.append(f"{dt:.0f}s > {budget['max_seconds']}s")
    return (not problems), "; ".join(problems), metrics


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * pct
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


# ── LLM-as-judge (opt-in) ────────────────────────────────────────────────────

_JUDGE_SYSTEM = (
    "You are a strict QA judge for an AI assistant. Given the USER request and the "
    "assistant's ANSWER, rate how well the answer actually serves the user on a 0-5 "
    "scale: 0=off-topic/empty, 1=barely, 2=weak, 3=acceptable, 4=good, 5=excellent and "
    "directly useful. Penalize narration of the process, code dumped instead of an answer, "
    "vague intent ('I will search...'), and answers that ignore the real subject. "
    'Reply with ONLY compact JSON: {"score": <int 0-5>, "reason": "<≤12 words>"}.'
)


def judge_quality(prompt: str, answer: str) -> tuple[int | None, str]:
    """Score answer quality 0-5 via a local model. Returns (score, reason).
    Best-effort: any failure → (None, reason) and never blocks the run."""
    if not answer.strip():
        return 0, "empty answer"
    body = {
        "model": JUDGE_MODEL,
        "messages": [
            {"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content": f"USER:\n{prompt}\n\nANSWER:\n{answer[:1500]}"},
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
    }
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = (data.get("message") or {}).get("content") or ""
        parsed = json.loads(content)
        score = int(parsed.get("score"))
        score = max(0, min(5, score))
        return score, str(parsed.get("reason") or "")[:60]
    except Exception as e:
        return None, f"judge_error:{type(e).__name__}"


def find_tool_args(events: list[dict], name: str) -> list[dict]:
    return [e.get("args") or {} for e in events if e.get("event") == "tool_start" and e.get("name") == name]


def find_tool_outputs(events: list[dict], name: str | None = None) -> list[str]:
    outs = []
    for e in events:
        if e.get("event") != "tool_done":
            continue
        if name and e.get("name") != name:
            continue
        out = e.get("output")
        if out is None:
            continue
        outs.append(str(out))
    return outs


def has_transport_error(events: list[dict]) -> str | None:
    for e in events:
        if e.get("event") in ("_transport_error", "_exception", "_timeout"):
            return str(e.get("data") or e.get("event"))
        if e.get("event") == "error":
            return str(e.get("data") or "")
    return None


# ── Validators ──────────────────────────────────────────────────────────────
# A validator returns (ok: bool, reason: str). reason is shown on failure.


def expect_tool(name: str, path_substr: str | None = None):
    def _val(events):
        calls = find_tool_calls(events, name)
        if not calls:
            return False, f"no tool_start name={name} (saw {all_tool_names(events) or 'none'})"
        if path_substr is not None:
            for c in calls:
                args = c.get("args") or {}
                path = str(args.get("path") or args.get("pattern") or "").lower()
                if path_substr.lower() in path:
                    return True, ""
            return False, f"tool {name} fired but no call had path containing {path_substr!r}"
        return True, ""
    return _val


def expect_any_tool(names: list[str]):
    def _val(events):
        fired = all_tool_names(events)
        for n in names:
            if n in fired:
                return True, ""
        return False, f"none of {names} fired (saw {fired or 'none'})"
    return _val


def expect_tool_sequence(names: list[str]):
    def _val(events):
        fired = all_tool_names(events)
        cursor = 0
        for name in names:
            try:
                cursor = fired.index(name, cursor) + 1
            except ValueError:
                return False, f"missing ordered tool sequence {names} (saw {fired or 'none'})"
        return True, ""
    return _val


def expect_no_tool(allowed_trivial: list[str] | None = None):
    """Pure-chat tests: no tools other than `think` / `set_plan`-free style.

    Some chit-chat triggers `expand_tools` or `think` which are inert. Allow
    a small whitelist; flag anything else.
    """
    allowed = set(allowed_trivial or ["think", "expand_tools"])
    def _val(events):
        fired = all_tool_names(events)
        bad = [t for t in fired if t not in allowed]
        if bad:
            return False, f"unexpected tools fired: {bad}"
        return True, ""
    return _val


def expect_response_contains(*phrases: str, case_sensitive: bool = False):
    def _val(events):
        done = find_done(events)
        if not done:
            return False, "no done event"
        hay = done if case_sensitive else done.lower()
        for p in phrases:
            needle = p if case_sensitive else p.lower()
            if needle in hay:
                return True, ""
        return False, f"response missing any of {list(phrases)}: head={done[:120]!r}"
    return _val


def expect_response_min_chars(n: int):
    def _val(events):
        done = find_done(events)
        if not done:
            return False, "no done event"
        if len(done.strip()) < n:
            return False, f"response too short ({len(done)} < {n}): {done[:120]!r}"
        return True, ""
    return _val


_INFRA_ERROR_MARKERS = (
    "model not pulled", "not pulled in ollama", "run: ollama pull",
    "connection refused", "could not connect", "timed out", "traceback (most recent",
    "internal server error", "502 bad gateway", "503 service",
)


def expect_no_error_response():
    def _val(events):
        done = find_done(events)
        if not done:
            return False, "no done event"
        d = done.strip()
        low = d.lower()
        if (d.startswith("ERREUR") or low.startswith("error:") or low.startswith("error ")
                or "did not use its tools" in d or "model did not" in low):
            return False, f"error-style response: {d[:120]!r}"
        if any(m in low for m in _INFRA_ERROR_MARKERS):
            return False, f"infra-error response: {d[:120]!r}"
        return True, ""
    return _val


def all_of(*validators):
    def _val(events):
        for v in validators:
            ok, reason = v(events)
            if not ok:
                return False, reason
        return True, ""
    return _val


def any_of(*validators):
    """Pass if ANY validator passes. Use for prompts answerable two valid ways,
    e.g. a recipe/definition the model can answer directly OR via web search.
    Product rule: no web search unless the user signals a web/current-info need,
    so a substantive direct answer is a legitimate (and faster) success path.
    """
    def _val(events):
        reasons = []
        for v in validators:
            ok, reason = v(events)
            if ok:
                return True, ""
            reasons.append(reason)
        return False, " | ".join(reasons)
    return _val


# Phrases that mean the agent gave up or only stated intent without producing a result.
# If the final response contains these (without offsetting substantive content), fail.
_NO_RESULT_PHRASES = (
    "couldn't find", "could not find", "unable to find", "no results", "no result",
    "did not find", "didn't find", "did not return", "didn't return",
    "i'll search", "i will search", "let me search", "let me look", "i'm going to search",
    "i will now search", "i'll now search", "i'll check", "i will check",
    "n'ai pas trouvé", "je n'ai pas trouvé", "aucun résultat", "aucun rÃ©sultat",
    "je vais chercher", "je cherche", "laissez-moi chercher", "permettez-moi de chercher",
    "désolé", "desolé", "sorry, i", "sorry, but i", "i'm sorry",
    "i can't access", "i cannot access", "je ne peux pas accéder",
    "no relevant", "nothing relevant", "rien de pertinent",
)


def _has_no_result_phrase(text: str) -> str | None:
    lo = text.lower()
    for p in _NO_RESULT_PHRASES:
        if p in lo:
            return p
    return None


def expect_tool_args_relate_to(name: str, *required_terms: str):
    """Tool fired with args (query/url/path) that mention at least one required_term.

    Catches the model calling search_web('hello') when the user asked about bitcoin.
    """
    def _val(events):
        argss = find_tool_args(events, name)
        if not argss:
            return False, f"no tool_start name={name}"
        for args in argss:
            blob = " ".join(str(v) for v in args.values() if isinstance(v, (str, int, float))).lower()
            for t in required_terms:
                if t.lower() in blob:
                    return True, ""
        return False, f"{name} called but args missing all of {list(required_terms)}: args={argss}"
    return _val


def expect_tool_output_substantive(name: str | None = None, min_chars: int = 60):
    """The tool produced a non-trivial output. None means any tool's output qualifies.

    Catches search_web returning an empty / error string while the agent pretends it worked.
    """
    def _val(events):
        outs = find_tool_outputs(events, name)
        if not outs:
            return False, f"no tool_done output for name={name}"
        for out in outs:
            text = out.strip()
            if len(text) < min_chars:
                continue
            lo = text.lower()
            if lo.startswith("erreur") or lo.startswith("error"):
                continue
            return True, ""
        head = outs[0][:120] if outs else ""
        return False, f"tool {name or 'any'} output too short / errored: head={head!r}"
    return _val


def expect_substantive_answer(*required_terms: str, min_chars: int = 40):
    """Final `done` text has substance and mentions at least one required term.

    - Length ≥ min_chars (after strip).
    - Contains ≥1 required term (case-insensitive).
    - Does not match a give-up / intent-only phrase from _NO_RESULT_PHRASES.
    """
    def _val(events):
        done = find_done(events)
        if not done:
            return False, "no done event"
        d = done.strip()
        if len(d) < min_chars:
            return False, f"answer too short ({len(d)} < {min_chars}): {d[:120]!r}"
        bad = _has_no_result_phrase(d)
        if bad:
            return False, f"answer is no-result/intent-only ({bad!r}): {d[:120]!r}"
        if required_terms:
            lo = d.lower()
            hit = any(t.lower() in lo for t in required_terms)
            if not hit:
                return False, f"answer missing any of {list(required_terms)}: {d[:120]!r}"
        return True, ""
    return _val


# ── Battery definitions ─────────────────────────────────────────────────────

COHERENCE_TESTS = [
    (["salut", "yo", "coucou", "hey", "wesh"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["hello", "hi", "hi there", "hey there", "good morning"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["bonjour", "bonsoir", "salutations", "bien le bonjour"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["comment ça va ?", "ça va ?", "tu vas bien ?", "how are you?", "how's it going?"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["merci beaucoup", "merci", "thanks", "thanks a lot", "thx"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["thank you", "thank you very much", "many thanks", "appreciate it"],
     all_of(expect_no_tool(), expect_response_min_chars(2), expect_no_error_response())),
    (["qui es-tu ?", "présente-toi", "tu es qui ?", "who are you?", "introduce yourself"],
     all_of(expect_no_tool(), expect_response_min_chars(10), expect_no_error_response())),
    (["quelle heure est-il ?", "il est quelle heure ?", "what time is it?", "tell me the time"],
     all_of(expect_response_min_chars(2), expect_no_error_response())),
    (["what day is it today?", "quel jour sommes-nous ?", "today's date?", "on est quel jour ?"],
     all_of(expect_response_min_chars(2), expect_no_error_response())),
    (["où suis-je ?", "where am I?", "ma localisation ?", "what's my location?"],
     all_of(expect_response_min_chars(2), expect_no_error_response())),
]

# Tool battery: prompts that should map to a single tool. The list covers the
# core toolbelt — these are the tools every model must fire correctly because
# almost every real conversation routes through one of them.
TOOL_TESTS = [
    (["list the files in my workspace folder", "show the files in my workspace", "what's in my workspace folder?",
      "ls my workspace", "montre-moi les fichiers du workspace", "liste le contenu de mon workspace"],
     expect_tool("list_dir")),
    (["liste les images du dossier dossier_sylvanus", "montre les images dans dossier_sylvanus",
      "quelles images y a-t-il dans dossier_sylvanus ?", "list the images in folder dossier_sylvanus"],
     expect_tool("list_dir_images", path_substr="sylvanus")),
    (["find every PDF in my workspace", "trouve tous les PDFs du workspace", "search all pdf files in workspace",
      "give me a list of pdfs in workspace", "liste tous les fichiers pdf de mon workspace"],
     expect_any_tool(["glob_files", "list_dir"])),
    (["read the file named package.json", "open package.json and show me its content",
      "lis le fichier package.json", "affiche le contenu de package.json", "what's inside package.json?"],
     expect_tool("read_file")),
    (["write a file hello_battery.txt with content 'hello world'",
      "create file hello_battery.txt containing 'hello world'",
      "crée un fichier hello_battery.txt avec le contenu 'hello world'",
      "save 'hello world' into a file named hello_battery.txt"],
     expect_tool("write_file")),
    (["create a folder named battery_test_dir", "make a directory called battery_test_dir",
      "crée un dossier battery_test_dir", "mkdir battery_test_dir"],
     expect_any_tool(["create_dir", "run_command"])),
    (["download https://httpbin.org/image/png to downloads/test.png",
      "save https://httpbin.org/image/png as downloads/test.png",
      "télécharge https://httpbin.org/image/png dans downloads/test.png"],
     expect_any_tool(["download_file", "http_request", "fetch_page"])),
    (["fetch the page at https://example.com", "get the content of https://example.com",
      "récupère la page https://example.com", "show me the html of https://example.com"],
     expect_any_tool(["fetch_page", "extract_url", "http_request"])),
    (["call https://api.github.com/zen and show me the response",
      "make a GET request to https://api.github.com/zen",
      "fais une requête GET sur https://api.github.com/zen"],
     expect_any_tool(["http_request", "fetch_page", "extract_url"])),
    (["what's the weather right now?", "tell me the current weather", "quelle est la météo actuelle ?",
      "il fait quel temps maintenant ?", "give me today's weather"],
     expect_any_tool(["get_weather", "search_web", "fetch_page", "http_request"])),
    (["set a reminder: drink water in 1 hour", "remind me to drink water in 1 hour",
      "rappelle-moi de boire de l'eau dans 1 heure", "schedule a reminder to drink water in 60 min"],
     expect_any_tool(["add_reminder", "schedule_agent_task"])),
    (["schedule a daily summary at 8am every weekday",
      "set up a daily summary at 8am on weekdays",
      "programme un résumé quotidien à 8h en semaine"],
     expect_any_tool(["schedule_agent_task", "add_reminder"])),
    (["plan a 3-step task: clean the inbox, write a summary, save it",
      "create a 3-step plan: inbox cleanup, summary, save",
      "fais un plan en 3 étapes : nettoyer la boîte mail, écrire un résumé, sauvegarder"],
     expect_tool("set_plan")),
    (["remember this fact: my favorite color is teal",
      "save the fact that my favorite color is teal",
      "souviens-toi que ma couleur préférée est turquoise",
      "note that I prefer the color teal"],
     expect_any_tool(["remember_fact", "remember_note"])),
    (["recall what you know about me", "what do you remember about me?",
      "qu'est-ce que tu sais sur moi ?", "list the facts you know about me"],
     expect_any_tool(["recall_facts", "kb_search"])),
    (["search images of red pandas", "find pictures of red pandas",
      "cherche des images de pandas roux", "show me red panda pictures"],
     expect_tool("search_images")),
    (["ouvre la calculatrice de mac", "lance la calculatrice macOS", "open the mac calculator",
      "launch the calculator app on mac"],
     expect_any_tool(["run_command", "open_app", "open_file"])),
    (["run the command echo battery-ok", "execute echo battery-ok in the shell",
      "exécute la commande echo battery-ok", "run `echo battery-ok` for me"],
     expect_tool("run_command")),
    (["encode the text 'hello' to base64", "base64 encode the string 'hello'",
      "encode 'hello' en base64", "give me 'hello' as base64"],
     expect_any_tool(["run_command", "think"])),
    (["what is my current city and country?", "where am I located right now?",
      "dans quelle ville et quel pays suis-je ?", "tell me my current city and country"],
     expect_response_min_chars(5)),
]

WEB_TESTS = [
    (["search the web for python 3.13 release notes",
      "look up python 3.13 release notes online",
      "cherche les notes de version de python 3.13",
      "find on the web the release notes for python 3.13"],
     all_of(expect_any_tool(["search_web", "search_and_read"]),
            expect_tool_output_substantive(min_chars=80),
            expect_substantive_answer("python", "3.13", min_chars=60))),
    (["recherche sur internet la météo à Paris demain",
      "trouve la météo de Paris pour demain",
      "look up tomorrow's weather in Paris on the web",
      "what's tomorrow's weather forecast for Paris?"],
     all_of(expect_any_tool(["search_web", "search_and_read", "get_weather", "fetch_page"]),
            expect_tool_output_substantive(min_chars=60),
            expect_substantive_answer("paris", min_chars=40))),
    (["find the latest news about bitcoin",
      "get me the latest bitcoin news",
      "donne-moi les dernières actualités sur le bitcoin",
      "what's the news on bitcoin today?"],
     all_of(expect_any_tool(["search_web", "search_and_read", "gdelt_search"]),
            expect_tool_output_substantive(min_chars=80),
            expect_substantive_answer("bitcoin", "btc", min_chars=60))),
    (["what is the latest version of node.js?",
      "tell me the latest node.js version",
      "quelle est la dernière version de node.js ?",
      "current node.js version?"],
     all_of(expect_any_tool(["search_web", "search_and_read", "fetch_page"]),
            expect_tool_output_substantive(min_chars=60),
            expect_substantive_answer("node", min_chars=30))),
    (["trouve un tutoriel ffmpeg pour convertir mp4 en gif",
      "cherche un tuto ffmpeg pour passer de mp4 à gif",
      "find an ffmpeg tutorial to convert mp4 to gif",
      "look up how to convert mp4 to gif with ffmpeg"],
     all_of(expect_any_tool(["search_web", "search_and_read"]),
            expect_tool_args_relate_to("search_web", "ffmpeg", "mp4", "gif"),
            expect_tool_output_substantive(min_chars=80),
            expect_substantive_answer("ffmpeg", "gif", min_chars=60))),
    (["show me images of the Eiffel Tower",
      "find pictures of the Eiffel Tower",
      "montre-moi des photos de la tour Eiffel",
      "search images of Eiffel Tower"],
     all_of(expect_tool("search_images"),
            expect_tool_args_relate_to("search_images", "eiffel", "tour"),
            expect_substantive_answer("eiffel", "tour", min_chars=20))),
    (["cherche des images de chats roux",
      "trouve-moi des photos de chats roux",
      "find pictures of orange cats",
      "search images of red tabby cats"],
     all_of(expect_tool("search_images"),
            expect_tool_args_relate_to("search_images", "cat", "chat", "tabby", "roux", "orange", "red"),
            expect_substantive_answer("cat", "chat", min_chars=20))),
    # Recipe is answerable from the model's own knowledge OR via web. No web
    # mention required → accept a substantive direct answer too (faster path).
    (["find a recipe for thai green curry",
      "trouve une recette de curry vert thaï",
      "cherche comment faire un curry vert thaïlandais",
      "show me a thai green curry recipe"],
     any_of(
         all_of(expect_any_tool(["search_web", "search_and_read"]),
                expect_tool_args_relate_to("search_web", "curry", "thai", "thaï", "recipe", "recette"),
                expect_tool_output_substantive(min_chars=80),
                expect_substantive_answer("curry", "thai", "thaï", min_chars=60)),
         expect_substantive_answer("curry", "thai", "thaï", min_chars=120))),
    (["quels sont les meilleurs restaurants à Pattaya ?",
      "trouve les meilleurs restaurants de Pattaya",
      "best restaurants in Pattaya?",
      "find top-rated restaurants in Pattaya"],
     all_of(expect_any_tool(["search_web", "search_and_read"]),
            expect_tool_args_relate_to("search_web", "pattaya", "restaurant"),
            expect_tool_output_substantive(min_chars=80),
            expect_substantive_answer("pattaya", min_chars=60))),
    (["what's on the homepage of github.com right now?",
      "fetch the current github.com homepage",
      "que voit-on sur la page d'accueil de github.com en ce moment ?",
      "show me github.com's homepage content"],
     all_of(expect_any_tool(["fetch_page", "extract_url", "search_web"]),
            expect_tool_output_substantive(min_chars=100),
            expect_substantive_answer("github", min_chars=60))),
    (["look up the wikipedia page for Alan Turing",
      "trouve la page wikipédia d'Alan Turing",
      "fetch the wikipedia article about Alan Turing",
      "what does wikipedia say about Alan Turing?"],
     all_of(expect_any_tool(["search_web", "fetch_page", "extract_url"]),
            expect_tool_output_substantive(min_chars=100),
            expect_substantive_answer("turing", min_chars=60))),
    (["find me the price of bitcoin in USD",
      "what's the bitcoin price in dollars right now?",
      "donne-moi le prix actuel du bitcoin en USD",
      "cours du bitcoin en dollars ?"],
     all_of(expect_any_tool(["search_web", "fetch_page", "http_request"]),
            expect_tool_args_relate_to("search_web", "bitcoin", "btc", "price", "usd", "dollar", "prix", "cours"),
            expect_tool_output_substantive(min_chars=40),
            expect_substantive_answer("bitcoin", "btc", "$", "usd", min_chars=20))),
    # A dictionary definition is core model knowledge. No web mention → a direct
    # substantive answer is the correct, faster path; web is also acceptable.
    (["recherche le sens du mot homéostasie",
      "définition du mot homéostasie",
      "what does the word homeostasis mean?",
      "look up the definition of homeostasis"],
     any_of(
         all_of(expect_any_tool(["search_web", "search_and_read", "fetch_page"]),
                expect_tool_args_relate_to("search_web", "homéostasie", "homeostasis"),
                expect_tool_output_substantive(min_chars=80),
                expect_substantive_answer("homeostasis", "homéostasie", min_chars=40)),
         expect_substantive_answer("homeostasis", "homéostasie", "équilibre", "equilibrium", "regulat", "régulat", min_chars=120))),
    (["find a youtube tutorial about typescript generics",
      "look up a youtube tutorial on typescript generics",
      "trouve un tuto youtube sur les génériques en typescript",
      "search youtube for typescript generics tutorial"],
     all_of(expect_any_tool(["search_web", "search_and_read", "fetch_page"]),
            expect_tool_args_relate_to("search_web", "typescript", "generic", "génériques"),
            expect_tool_output_substantive(min_chars=80),
            expect_substantive_answer("typescript", "generic", min_chars=60))),
    (["search github for awesome lists about rust",
      "find awesome rust lists on github",
      "cherche des awesome-lists rust sur github",
      "look up popular awesome-rust repositories on github"],
     all_of(expect_any_tool(["search_web", "github_code_search", "search_and_read"]),
            expect_tool_args_relate_to("search_web", "rust", "awesome", "github"),
            expect_tool_output_substantive(min_chars=60),
            expect_substantive_answer("rust", min_chars=30))),
]

TASK_TESTS = [
    (["plan a 4-step project to build a personal portfolio website",
      "create a 4-step plan to ship a personal portfolio site",
      "fais un plan en 4 étapes pour construire un site portfolio personnel",
      "set up a 4-step roadmap for a personal portfolio website"],
     all_of(expect_tool("set_plan"), expect_response_min_chars(40))),
    (["organise pour moi : 1) collecter les pdfs du workspace 2) faire un résumé 3) écrire un rapport",
      "organize this for me: 1) gather workspace pdfs 2) summarize them 3) write a report",
      "plan ces trois étapes : collecter les pdfs du workspace, les résumer, rédiger un rapport"],
     all_of(expect_any_tool(["set_plan", "list_dir", "glob_files"]), expect_response_min_chars(40))),
    (["schedule a task to remind me to call mom every sunday at 6pm",
      "set up a weekly reminder to call mom on sundays at 6pm",
      "programme un rappel pour appeler maman tous les dimanches à 18h",
      "remind me every sunday at 6pm to call my mom"],
     expect_any_tool(["schedule_agent_task", "add_reminder"])),
]

SKILLS_TESTS = [
    (["search existing skills about japanese tourist visa",
     "cherche un skill existant sur le visa touristique japonais",
     "look for a skill about tourist visa for japan",
     "trouve un skill sur le visa touriste japon"],
     all_of(
        expect_tool("skill_search"),
        expect_response_min_chars(10),
        expect_no_error_response(),
     )),
    (["list all available skills",
     "liste tous les skills disponibles",
     "show me the available skills",
     "affiche les skills disponibles"],
     all_of(
        expect_tool("skill_list"),
        expect_response_min_chars(10),
        expect_no_error_response(),
     )),
]

IMAGE_GEN_TESTS = [
    (["dessine un chat sur la lune en style aquarelle",
     "génère une aquarelle d'un chat sur la lune",
      "draw a cat on the moon in watercolor style",
      "create a watercolor painting of a cat on the moon"],
     all_of(expect_tool("generate_image"), expect_response_contains("!["))),
]


CATEGORIES: dict[str, list[tuple[str, callable]]] = {
    "coherence": COHERENCE_TESTS,
    "tool": TOOL_TESTS,
    "web": WEB_TESTS,
    "task": TASK_TESTS,
    "skills": SKILLS_TESTS,
    "image_gen": IMAGE_GEN_TESTS,
}

CATEGORY_MIN_SUCCESS_RATE = {
    category: MIN_SUCCESS_RATE
    for category in CATEGORIES
}


# ── Multi-turn conversations ─────────────────────────────────────────────────
# Each conversation runs in one session with accumulating history. Turn N must
# stay coherent with turns 1..N-1 — this is where weak models lose the subject
# (the "grenouilles -> vertical farming" drift) or redundantly re-do work.
# Turn validator gets the events of that turn; efficiency budget is per-turn.

CONVERSATION_TESTS = [
    {
        "name": "context-retention-frogs",
        "turns": [
            (["je veux élever des grenouilles dans de l'eau propre, des conseils ?",
              "comment élever des grenouilles dans une eau bien propre ?"],
             expect_substantive_answer("grenouille", "eau", "frog", "water", min_chars=60)),
            (["et quelle température leur faut-il ?",
              "il leur faut quelle température ?"],
             all_of(expect_substantive_answer("grenouille", "température", "eau", "temperature",
                                               "frog", "°c", "°", min_chars=30),
                    expect_no_error_response())),
        ],
    },
    {
        "name": "name-memory",
        "turns": [
            (["salut, je m'appelle Léa", "coucou, moi c'est Léa"],
             all_of(expect_response_min_chars(2), expect_no_error_response())),
            (["tu te souviens de mon prénom ?", "c'est quoi mon prénom déjà ?"],
             expect_response_contains("léa")),
        ],
    },
    {
        "name": "followup-no-redundant-search",
        "turns": [
            (["donne-moi le prix du bitcoin en USD", "prix du bitcoin en dollars ?"],
             all_of(expect_any_tool(["search_web", "fetch_page", "http_request", "search_and_read"]),
                    expect_substantive_answer("bitcoin", "btc", "$", "usd", min_chars=20))),
            (["et en euros ?", "convertis en euros stp"],
             all_of(expect_substantive_answer("euro", "€", "eur", "bitcoin", min_chars=10),
                    expect_no_error_response())),
        ],
    },
]


def _record(cat, prompt, events, dt, ok, reason, records, fails, verbose):
    """Score one executed turn (functional + efficiency + optional judge), print
    its line, and append to the running record list."""
    budget = CATEGORY_BUDGETS.get(cat, {"max_tools": 3, "max_seconds": 120})
    eff_ok, eff_reason, metrics = efficiency_check(events, dt, budget)
    done = find_done(events)
    tools = all_tool_names(events)
    judge_score = None
    judge_reason = ""
    if JUDGE_ENABLED and ok:
        judge_score, judge_reason = judge_quality(prompt, done)
    rec = {"cat": cat, "prompt": prompt, "ok": ok, "reason": reason,
           "dt": dt, "eff_ok": eff_ok, "eff_reason": eff_reason,
           "metrics": metrics, "judge": judge_score}
    records.append(rec)
    fmark = "PASS" if ok else "FAIL"
    emark = "eff" if eff_ok else "OVERKILL"
    steps = f"{metrics['sub']}t" + (f"+{metrics['inert']}i" if metrics['inert'] else "")
    jtxt = f" judge={judge_score}" if judge_score is not None else ""
    print(f"  [{cat} {dt:5.1f}s {fmark}/{emark} {steps}{jtxt}] {prompt!r}")
    print(f"      tools={tools} done={done.replace(chr(10), ' ')[:120]!r}")
    if not ok:
        print(f"      reason: {reason}")
        fails.append((cat, prompt, reason))
        if verbose:
            for ev in events:
                print(f"      ev: {json.dumps(ev)[:240]}")
    elif not eff_ok:
        print(f"      overkill: {eff_reason}")
    return rec


def run_conversations(verbose: bool, records, fails):
    """Run multi-turn conversations with accumulating history in one session."""
    print(f"\n========== category: conversation ({len(CONVERSATION_TESTS)} convos) ==========")
    cat_pass = cat_total = 0
    for convo in CONVERSATION_TESTS:
        sid = f"battery-conv-{convo['name']}-{int(time.time()*1000)}"
        history: list[dict] = []
        print(f"  -- conversation: {convo['name']} --")
        for variants, validator in convo["turns"]:
            prompt = pick(variants)
            t0 = time.time()
            events = stream_chat(prompt, history=history, session_id=sid)
            dt = time.time() - t0
            transport = has_transport_error(events)
            ok, reason = (False, f"transport={transport}") if transport else validator(events)
            rec = _record("conversation", prompt, events, dt, ok, reason, records, fails, verbose)
            cat_total += 1
            if ok:
                cat_pass += 1
            done = find_done(events)
            # Thread the turn into history so the next turn has context.
            history = history + [{"role": "user", "content": prompt},
                                 {"role": "assistant", "content": done}]
    return cat_pass, cat_total


def run_battery(only_category: str | None, verbose: bool, min_success_rate: float | None = None,
                min_efficiency_rate: float | None = None) -> int:
    min_success_rate = MIN_SUCCESS_RATE if min_success_rate is None else float(min_success_rate)
    if min_efficiency_rate is None:
        min_efficiency_rate = MIN_EFFICIENCY_RATE
    all_cats = list(CATEGORIES.keys()) + ["conversation"]
    cats = [only_category] if only_category else all_cats
    cat_summary: list[tuple[str, int, int]] = []
    records: list[dict] = []
    fails: list[tuple[str, str, str]] = []
    cat_gate_failures: list[tuple[str, float, float]] = []
    print(
        f"[battery] sidecar={SIDECAR} model={MODEL_ID} timeout={TIMEOUT}s "
        f"variant_seed={VARIANT_SEED} min_success_rate={min_success_rate:.0%} "
        f"efficiency_gate={('%.0f%%' % (min_efficiency_rate*100)) if min_efficiency_rate else 'report-only'} "
        f"judge={'on(%s)' % JUDGE_MODEL if JUDGE_ENABLED else 'off'}"
    )
    t_battery = time.time()
    for cat in cats:
        if cat == "conversation":
            cp, ct = run_conversations(verbose, records, fails)
            if ct:
                cat_summary.append((cat, cp, ct))
            continue
        tests = CATEGORIES.get(cat)
        if not tests:
            print(f"[battery] unknown category {cat!r}")
            continue
        print(f"\n========== category: {cat} ({len(tests)} tests) ==========")
        cat_pass = 0
        for variants, validator in tests:
            prompt = pick(variants)
            t0 = time.time()
            events = stream_chat(prompt)
            dt = time.time() - t0
            transport = has_transport_error(events)
            ok, reason = (False, f"transport={transport}") if transport else validator(events)
            _record(cat, prompt, events, dt, ok, reason, records, fails, verbose)
            if ok:
                cat_pass += 1
        cat_summary.append((cat, cat_pass, len(tests)))

    # ── functional summary ──
    overall_pass = sum(p for _, p, _ in cat_summary)
    overall_total = sum(n for _, _, n in cat_summary)
    print("\n========== functional summary (did it work) ==========")
    for cat, p, n in cat_summary:
        pct = (p / n * 100) if n else 0.0
        required = CATEGORY_MIN_SUCCESS_RATE.get(cat, min_success_rate) * 100
        ok = pct >= required
        print(f"  {cat:12s} {p}/{n}  ({pct:5.1f}%)  threshold>={required:4.1f}%  {'PASS' if ok else 'FAIL'}")
        if not ok:
            cat_gate_failures.append((cat, pct, required))
    pct = (overall_pass / overall_total * 100) if overall_total else 0.0
    overall_ok = pct >= (min_success_rate * 100)
    print(f"  {'TOTAL':12s} {overall_pass}/{overall_total}  ({pct:5.1f}%)  "
          f"threshold>={min_success_rate * 100:4.1f}%  {'PASS' if overall_ok else 'FAIL'}")

    # ── efficiency summary (was it lean) ──
    print("\n========== efficiency summary (steps / speed) ==========")
    eff_by_cat: dict[str, list[dict]] = {}
    for r in records:
        eff_by_cat.setdefault(r["cat"], []).append(r)
    eff_pass_total = eff_total = 0
    for cat, _, _ in cat_summary:
        rs = eff_by_cat.get(cat, [])
        if not rs:
            continue
        ep = sum(1 for r in rs if r["eff_ok"])
        avg_steps = sum(r["metrics"]["sub"] for r in rs) / len(rs)
        redundant = sum(r["metrics"]["redundant"] for r in rs)
        p50 = _percentile([r["dt"] for r in rs], 0.50)
        p95 = _percentile([r["dt"] for r in rs], 0.95)
        eff_pass_total += ep
        eff_total += len(rs)
        print(f"  {cat:12s} eff {ep}/{len(rs)} ({ep/len(rs)*100:5.1f}%)  "
              f"avg_steps={avg_steps:.1f}  redundant={redundant}  "
              f"lat p50={p50:4.1f}s p95={p95:4.1f}s")
    all_dt = [r["dt"] for r in records]
    eff_rate = (eff_pass_total / eff_total * 100) if eff_total else 0.0
    print(f"  {'TOTAL':12s} eff {eff_pass_total}/{eff_total} ({eff_rate:5.1f}%)  "
          f"lat p50={_percentile(all_dt,0.50):4.1f}s p95={_percentile(all_dt,0.95):4.1f}s "
          f"max={max(all_dt) if all_dt else 0:4.1f}s")
    overkillers = sorted([r for r in records if r["ok"] and not r["eff_ok"]],
                         key=lambda r: -r["metrics"]["sub"])[:8]
    if overkillers:
        print("\n[overkill — passed functionally but wasteful]")
        for r in overkillers:
            print(f"  - {r['cat']}: {r['prompt']!r} -> {r['eff_reason']}")
    slowest = sorted(records, key=lambda r: -r["dt"])[:5]
    print("\n[slowest turns]")
    for r in slowest:
        print(f"  - {r['dt']:5.1f}s {r['cat']}: {r['prompt']!r}")

    # ── judge summary ──
    if JUDGE_ENABLED:
        scored = [r["judge"] for r in records if isinstance(r["judge"], int)]
        print("\n========== quality (LLM-judge 0-5) ==========")
        if scored:
            print(f"  avg={sum(scored)/len(scored):.2f}  n={len(scored)}  "
                  f"low(<3)={sum(1 for s in scored if s < 3)}")
            for r in sorted([r for r in records if isinstance(r['judge'], int) and r['judge'] < 3],
                            key=lambda r: r['judge'])[:8]:
                print(f"  - score={r['judge']} {r['cat']}: {r['prompt']!r}")
        else:
            print("  (no scores — judge model unavailable?)")

    elapsed = time.time() - t_battery
    print(f"\n  finished in {elapsed/60:.1f} min")
    if cat_gate_failures:
        print("\n[threshold failures]")
        for cat, got, required in cat_gate_failures:
            print(f"  - {cat}: {got:5.1f}% < {required:4.1f}%")
    if fails:
        print("\n[fails]")
        for cat, prompt, reason in fails:
            print(f"  - {cat}: {prompt!r} -> {reason}")

    eff_gate_ok = True
    if min_efficiency_rate is not None:
        eff_gate_ok = (eff_rate / 100) >= min_efficiency_rate
        if not eff_gate_ok:
            print(f"\n[efficiency gate] {eff_rate:.1f}% < {min_efficiency_rate*100:.1f}% -> FAIL")
    return 0 if (overall_ok and not cat_gate_failures and eff_gate_ok) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", help="run only one (coherence/tool/web/task/skills/image_gen/conversation)")
    ap.add_argument("--min-success-rate", type=float, default=None, help="min functional pass rate (env TEST_MIN_SUCCESS_RATE or 0.90)")
    ap.add_argument("--min-efficiency-rate", type=float, default=None, help="min efficiency pass rate to gate on (env TEST_MIN_EFFICIENCY_RATE; default report-only)")
    ap.add_argument("--judge", action="store_true", help="enable LLM-as-judge quality scoring (also TEST_JUDGE=1)")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()
    if args.judge:
        global JUDGE_ENABLED
        JUDGE_ENABLED = True
    return run_battery(args.category, args.verbose,
                       min_success_rate=args.min_success_rate,
                       min_efficiency_rate=args.min_efficiency_rate)


if __name__ == "__main__":
    sys.exit(main())
