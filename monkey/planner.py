"""Planner-worker decomposition (feature-flagged via MONKEY_DECOMPOSE=1).

Big models burn credits doing what small models can do in parallel:
read N pages, summarize N items, draft N variants. This module asks a
planner LLM to slice the user's request into independent subtasks, fans
them out to focused subagents in worker threads, and reduces the results
with a synthesis pass.

Activation gates (all must hold):
  * MONKEY_DECOMPOSE=1 in env
  * detected intent ∈ {orchestrate, code, search, browse}
  * planner returned >= 2 subtasks (single-task = let the main loop handle it)

Caller is expected to inspect the result and fall back to the standard
loop when:
  * plan() returns None
  * execute() succeeds on less than ~half the subtasks (caller's call)
"""

from __future__ import annotations

import json
import os
import re
import threading
from typing import Callable, Optional

MIN_SUBTASKS = 2
MAX_SUBTASKS = 5
WORKER_TIMEOUT_S = 180
# Hard cap on the prompt size we'll let the planner emit (sum of all
# subtask strings). Keeps a misbehaving planner from triggering a fan-out
# that costs more than just letting the big model answer directly.
MAX_TOTAL_SUBTASK_CHARS = 4000
# Caller can treat this as "decomposition failed in practice, fall back".
MIN_OK_RATIO = 0.5
# Intents that can plausibly benefit from fan-out. `chat` excluded — a
# single-turn reply doesn't decompose. Caller can pass any intent; this is
# advisory.
DECOMPOSABLE_INTENTS = frozenset({"orchestrate", "code", "search", "browse"})


_PLANNER_SYSTEM = (
    "You are a planning module. Decompose the user request into independent "
    "subtasks that small LLMs can execute in parallel. Rules:\n"
    "- Each subtask must be self-contained: it cannot read another subtask's output.\n"
    "- 2 to 5 subtasks. Fewer = better. If the request is a single atomic action, return [].\n"
    "- Phrase each subtask as a concrete imperative ('Fetch X', 'Summarize Y', 'Draft Z').\n"
    "- Then provide a reducer instruction: how to merge subtask outputs into the final answer.\n"
    "Reply with strict JSON ONLY: {\"subtasks\": [string], \"reducer\": string}. No prose."
)

_REDUCER_SYSTEM = (
    "You are a reducer. Combine the subtask outputs into a single coherent answer "
    "for the user, following the reducer instruction. Stay in the user's language. "
    "Do not mention the decomposition mechanism."
)


def is_enabled() -> bool:
    return os.getenv("MONKEY_DECOMPOSE", "").strip() == "1"


def should_attempt(intent: str) -> bool:
    """Cheap gate the caller can use before paying for plan()."""
    return is_enabled() and intent in DECOMPOSABLE_INTENTS


def _extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def plan(user_message: str, llm_call: Callable, model_id: Optional[str]) -> Optional[dict]:
    """Returns {"subtasks": [...], "reducer": ...} or None if not decomposable."""
    messages = [
        {"role": "system", "content": _PLANNER_SYSTEM},
        {"role": "user", "content": user_message},
    ]
    try:
        result = llm_call(messages, model_id, [])
    except Exception:
        return None
    parsed = _extract_json(result.get("text") or "")
    if not parsed:
        return None
    subs = parsed.get("subtasks")
    reducer = parsed.get("reducer") or ""
    if not isinstance(subs, list):
        return None
    subs = [str(s).strip() for s in subs if str(s).strip()]
    if len(subs) < MIN_SUBTASKS:
        return None
    subs = subs[:MAX_SUBTASKS]
    if sum(len(s) for s in subs) > MAX_TOTAL_SUBTASK_CHARS:
        return None
    return {"subtasks": subs, "reducer": str(reducer).strip()}


def execute(
    subtasks: list[str],
    run_subagent: Callable[[str, str], str],
    context: str = "",
) -> list[dict]:
    """Run subtasks in parallel worker threads. Returns ordered results.

    Each result dict: {"task": str, "ok": bool, "result": str}.
    `context` is passed to each subagent — typically the original user
    message — so workers have grounding without re-seeing siblings' output.
    """
    results: list[Optional[str]] = [None] * len(subtasks)
    errors: list[Optional[str]] = [None] * len(subtasks)

    def _worker(i: int, task: str) -> None:
        try:
            results[i] = run_subagent(task, context)
        except Exception as e:
            errors[i] = str(e)

    threads = [
        threading.Thread(target=_worker, args=(i, t), daemon=True)
        for i, t in enumerate(subtasks)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=WORKER_TIMEOUT_S)

    out: list[dict] = []
    for i, task in enumerate(subtasks):
        if errors[i] is not None:
            out.append({"task": task, "ok": False, "result": f"error: {errors[i]}"})
        elif results[i] is None:
            out.append({"task": task, "ok": False, "result": "timeout"})
        else:
            out.append({"task": task, "ok": True, "result": results[i] or ""})
    return out


def ok_ratio(subtask_results: list[dict]) -> float:
    if not subtask_results:
        return 0.0
    return sum(1 for r in subtask_results if r.get("ok")) / len(subtask_results)


def reduce(
    user_message: str,
    reducer_instruction: str,
    subtask_results: list[dict],
    llm_call: Callable,
    model_id: Optional[str],
) -> str:
    bullets = []
    for i, r in enumerate(subtask_results, 1):
        status = "OK" if r.get("ok") else "FAIL"
        bullets.append(f"[{i}] ({status}) {r['task']}\n{r['result']}")
    body = "\n\n".join(bullets)
    messages = [
        {"role": "system", "content": _REDUCER_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Original request:\n{user_message}\n\n"
                f"Reducer instruction: {reducer_instruction}\n\n"
                f"Subtask outputs:\n{body}\n\n"
                "Produce the final answer."
            ),
        },
    ]
    try:
        result = llm_call(messages, model_id, [])
        return (result.get("text") or "").strip()
    except Exception as e:
        return f"reduce failed: {e}"
