"""Background scheduler: runs agent tasks whose scheduledFor has elapsed.

Single daemon thread, sequential runs (cap 1 concurrent) to avoid token bursts.
Use `start_scheduler(store, run_agent_fn)` once at app startup; call `tick(...)`
directly from tests to step the scheduler synchronously.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import re
import subprocess
import threading
import time
import traceback
from typing import Any, Callable

SHELL_TASK_TIMEOUT_SECONDS = 90
AGENT_JOB_TIMEOUT_SECONDS = int(__import__("os").environ.get("MONKEY_JOB_TIMEOUT", "600"))

RunAgentFn = Callable[[str, dict[str, Any]], str]


_JSON_LIKE = re.compile(r"^\s*[\{\[]")


def _flatten(value: Any, depth: int = 0) -> str:
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            parts.append(f"{k}: {_flatten(v, depth + 1)}")
        sep = "\n" if depth == 0 else "; "
        return sep.join(parts)
    if isinstance(value, list):
        return ", ".join(_flatten(v, depth + 1) for v in value)
    if isinstance(value, bool):
        return "yes" if value else "no"
    if value is None:
        return "n/a"
    return str(value)


def humanize_agent_output(text: str) -> str:
    """Convert raw JSON-shaped agent finals into a human-readable string.

    Regression guard: scheduled tasks were leaking tool-result-style JSON
    (e.g. `{"ok": true, "notified": [...], "btc_status": "..."}`) straight
    to WhatsApp. The agent's final message must be human text, not a
    machine payload. If the text parses as a JSON dict/list, flatten it;
    otherwise pass through.
    """
    if not isinstance(text, str):
        return str(text)
    stripped = text.strip()
    if not stripped or not _JSON_LIKE.match(stripped):
        return text
    try:
        data = json.loads(stripped)
    except (ValueError, TypeError):
        return text
    if not isinstance(data, (dict, list)):
        return text
    flat = _flatten(data).strip()
    return flat or text


def _auto_notify(task: dict[str, Any], result: str) -> None:
    """Default post-run WA notify. Skipped for alert-mode tasks."""
    mode = str(task.get("mode") or "report").lower()
    if mode == "alert":
        return
    try:
        from monkey import main as _m
        # Prefer the chat the task was scheduled from; fallback to owner.
        target = (task.get("waChatJid") or "").strip()
        if not target:
            target, _status = _m._wa_status()
        body = humanize_agent_output(str(result))
        title = str(task.get("title") or "scheduled task")
        # Only prepend the [Task] header when notifying the owner. For
        # third-party chats (waChatJid set), send pure human text — no
        # robotic prefix that gives away the bot.
        if task.get("waChatJid"):
            text = body.strip()
        else:
            text = f"[Task] {title}\n\n{body}".strip()
        if len(text) > 4000:
            text = text[:3990] + "\n…(truncated)"
        _m._wa_send_text(target or "", text)
        # Caption: only attach the title when notifying the owner; for
        # third-party chats keep caption empty so the task name doesn't leak.
        file_caption = "" if task.get("waChatJid") else title
        tool_calls = task.get("_toolCalls") or []
        if tool_calls:
            for path, kind in _m._extract_media_paths(tool_calls):
                _m._wa_send_file(target or "", path, kind, caption=file_caption)
        # SEND_DOC markers emitted by the agent (same protocol as wa-bridge).
        for path in task.get("_sendDocs") or []:
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
            kind = _m._MEDIA_EXTS.get(ext, "document")
            _m._wa_send_file(target or "", path, kind, caption=file_caption)
    except Exception:
        pass


def _run_shell_task(command: str) -> tuple[str, bool]:
    """Execute a shellCommand task via bash -lc. Returns (result_text, ok).
    Login shell so the user's PATH (homebrew, pyenv, etc.) is available."""
    try:
        proc = subprocess.run(
            ["bash", "-lc", command],
            capture_output=True,
            text=True,
            timeout=SHELL_TASK_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return (f"ERREUR: shell timeout after {SHELL_TASK_TIMEOUT_SECONDS}s", False)
    except Exception as e:  # noqa: BLE001
        return (f"ERREUR: shell exec failed: {e}", False)
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode == 0:
        body = stdout or "(no output)"
        return (body[:4000], True)
    head = stdout or stderr or "(no output)"
    return (f"ERREUR: exit {proc.returncode}: {head[:1000]}", False)


def tick(store, run_agent_fn: RunAgentFn, now: dt.datetime | None = None) -> list[dict[str, Any]]:
    """Run one scheduling pass. Returns the list of tasks processed (post-finish)."""
    claimed = store.claim_due(now=now)
    out: list[dict[str, Any]] = []
    for task in claimed:
        shell_command = (task.get("shellCommand") or "").strip()
        if shell_command:
            # Pure cron path — no agent, no LLM, no WA notify. Just run the
            # command and store its output as the run result.
            result, ok = _run_shell_task(shell_command)
            try:
                finished = store.finish_run(task["id"], str(result)[:8000], ok=ok)
                out.append(finished)
            except Exception:
                pass
            continue
        prompt = task.get("agentPrompt") or ""
        # Bind notify_user's target to the task's WA route for the run.
        # waChatJid first, owner fallback, empty string if none — notify_user
        # treats "set-but-empty" as "send to owner via sidecar default".
        from monkey import agent as _agent, main as _main
        prev_jid = _agent._CURRENT_WA_JID
        resolved = (task.get("waChatJid") or "").strip()
        if not resolved:
            try:
                resolved = (_main._wa_status()[0] or "")
            except Exception:
                resolved = ""
        _agent._CURRENT_WA_JID = resolved
        should_notify = False
        try:
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
                    _fut = _ex.submit(run_agent_fn, prompt, task)
                    try:
                        result = _fut.result(timeout=AGENT_JOB_TIMEOUT_SECONDS)
                        ok = True
                    except concurrent.futures.TimeoutError:
                        result = f"ERREUR: job timeout after {AGENT_JOB_TIMEOUT_SECONDS}s"
                        ok = False
            except Exception as e:  # noqa: BLE001
                result = f"ERREUR: {e}\n{traceback.format_exc()[:500]}"
                ok = False
            # Conditional report gate: the task always runs, but the WA notify
            # is gated on a YES/NO post-run check. NO → result is still stored
            # in runHistory for audit; no message goes out.
            should_notify = ok
            if ok:
                report_mode = (task.get("reportMode") or "always").lower()
                report_cond = (task.get("reportCondition") or "").strip()
                if report_mode == "conditional" and report_cond:
                    run_ts = (now or dt.datetime.now()).strftime("%Y-%m-%d %H:%M:%S")
                    check_prompt = (
                        f"Current date/time: {run_ts}\n"
                        "A scheduled task just ran. Decide whether the result is "
                        "worth reporting to the user, based on this condition:\n"
                        f"  Condition: {report_cond}\n"
                        f"  Task result:\n{str(result)[:4000]}\n"
                        "Use tools (web, prices, etc.) if the condition needs "
                        "external facts not present in the result. Respond with "
                        "STRICTLY one token: YES if the condition is met (report "
                        "it) or NO if not."
                    )
                    try:
                        verdict = str(run_agent_fn(check_prompt, task)).strip().upper()
                    except Exception as e:  # noqa: BLE001
                        verdict = f"NO ({e})"
                    should_notify = "YES" in verdict
                    if not should_notify:
                        result = (
                            f"[report suppressed — condition not met: "
                            f"{report_cond[:160]}]\n\n{result}"
                        )
        finally:
            _agent._CURRENT_WA_JID = prev_jid
        if should_notify:
            _auto_notify(task, str(result))
        try:
            finished = store.finish_run(task["id"], str(result)[:8000], ok=ok)
            out.append(finished)
        except Exception:
            pass
    return out


def start_scheduler(store, run_agent_fn: RunAgentFn, *, interval: float = 15.0) -> threading.Event:
    """Spawn a daemon loop. Returns an Event you can .set() to stop the loop."""
    stop = threading.Event()

    # App startup catch-up: every recurring task whose nextRunAt is in the past
    # gets advanced to the first future occurrence. Prevents a burst of stale
    # runs (e.g. hourly task + app closed 6h would otherwise fire one stale run).
    try:
        store.reconcile_recurring()
    except Exception:
        pass

    def _loop():
        while not stop.is_set():
            try:
                tick(store, run_agent_fn)
            except Exception:
                pass
            stop.wait(interval)

    t = threading.Thread(target=_loop, name="task-scheduler", daemon=True)
    t.start()
    return stop
