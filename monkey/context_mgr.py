"""Context management: history compaction, project state scan, token-budgeted synthesis."""
from __future__ import annotations

import json
import os
import re
import threading
from queue import Queue

MAX_MESSAGES_IN_CONTEXT = 80
KEEP_LAST_FULL = 16
CONTEXT_SUMMARY_TRIGGER_TOKENS = 100_000

_CODE_SCAN_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go")
_EXPORT_RE = re.compile(
    r"^export\s+(?:default\s+)?(class|function|const|let|interface|type|enum)\s+(\w+)",
    re.MULTILINE,
)
_IMPORT_RE = re.compile(r"""^import\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]""", re.MULTILINE)
_CTOR_RE = re.compile(r"^\s*(?:export\s+)?class\s+(\w+)[^{]*\{[^}]*?constructor\s*\(([^)]{0,200})\)", re.MULTILINE | re.DOTALL)
_FUNC_RE = re.compile(r"^export\s+function\s+(\w+)\s*\(([^)]{0,200})\)", re.MULTILINE)


def summarize_tool_content(name: str, content: str) -> str:
    """Replace a tool result body with a 1-line marker for older history."""
    if not content:
        return f"[tool={name} → empty]"
    head = content[:80].replace("\n", " ").strip()
    status = "OK" if content.startswith("OK:") else ("ERR" if content.startswith("ERREUR:") or content.startswith("Error") else "—")
    return f"[tool={name} status={status} {head}…]"


def compact_history(messages: list[dict]) -> None:
    """In-place compaction: keep system + last KEEP_LAST_FULL full; older tool messages
    and assistant tool_calls.arguments get summarized to slash token usage."""
    n = len(messages)
    if n <= KEEP_LAST_FULL + 2:
        return
    cutoff = n - KEEP_LAST_FULL
    for i in range(1, cutoff):
        m = messages[i]
        role = m.get("role")
        if role == "tool":
            c = m.get("content") or ""
            if len(c) > 120:
                m["content"] = summarize_tool_content(m.get("name", "?"), c)
        elif role == "assistant" and m.get("tool_calls"):
            slim = []
            for tc in m["tool_calls"]:
                fn = tc.get("function", {})
                args_raw = fn.get("arguments", "{}")
                try:
                    a = json.loads(args_raw) if isinstance(args_raw, str) else dict(args_raw)
                except Exception:
                    a = {}
                for k in ("content", "new_content", "new_string", "old_string", "thought", "reasoning"):
                    if isinstance(a.get(k), str) and len(a[k]) > 120:
                        a[k] = f"[{len(a[k])}c]"
                slim.append({**tc, "function": {**fn, "arguments": json.dumps(a, ensure_ascii=False)}})
            m["tool_calls"] = slim
        elif role == "user" and isinstance(m.get("content"), str):
            c = m["content"]
            # New slim recap format: "[ok: a,b | err: c→…]" — already minimal, leave it.
            # Legacy verbose recaps from older sessions: collapse to a marker.
            if (c.startswith("[Résultats outils") or c.startswith("[Tool results:")) and len(c) > 200:
                m["content"] = "[older tool recap collapsed]"


def scan_project_state(workspace: str, max_files: int = 60, max_chars: int = 3500) -> str:
    """Build a compact project-state snapshot for context refresh."""
    if not workspace or not os.path.isdir(workspace):
        return ""
    entries: list[str] = []
    skip_dirs = {"node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__", "target", ".cache"}
    count = 0
    for root, dirs, files in os.walk(workspace):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
        for fname in sorted(files):
            if count >= max_files:
                break
            if not fname.endswith(_CODE_SCAN_EXTS):
                continue
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, workspace)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    body = f.read(20000)
            except Exception:
                continue
            exports = [m.group(2) for m in _EXPORT_RE.finditer(body)]
            imports = [m.group(1) for m in _IMPORT_RE.finditer(body) if m.group(1).startswith(".")]
            ctors = [(m.group(1), " ".join(m.group(2).split())) for m in _CTOR_RE.finditer(body)]
            funcs = [(m.group(1), " ".join(m.group(2).split())) for m in _FUNC_RE.finditer(body)]
            line = f"  {rel}"
            if exports:
                line += f"  exports={','.join(exports[:8])}"
            if ctors:
                line += "  ctors=" + "; ".join(f"{n}({p[:80]})" for n, p in ctors[:4])
            if funcs and not ctors:
                line += "  funcs=" + "; ".join(f"{n}({p[:60]})" for n, p in funcs[:3])
            if imports:
                line += f"  imports={','.join(imports[:6])}"
            entries.append(line)
            count += 1
        if count >= max_files:
            break
    if not entries:
        return ""
    block = "\n".join(entries)
    if len(block) > max_chars:
        block = block[:max_chars] + "\n  …(truncated)"
    return (
        "[PROJECT STATE — source of truth, do not invent modules]\n"
        f"workspace={workspace}\n{block}\n"
        "Before any import, verify the module/symbol is listed above. "
        "If something you need is missing: create it first (write_file), then import it."
    )


def estimate_tokens(messages: list[dict]) -> int:
    """Rough token estimate: chars / 3.5 (slightly conservative for FR+code)."""
    total = 0
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            total += len(c)
        for tc in m.get("tool_calls") or []:
            args = tc.get("function", {}).get("arguments")
            if isinstance(args, str):
                total += len(args)
    return int(total / 3.5)


def synthesize_history(messages: list[dict], llm_call_fn, model_id: str | None) -> None:
    """Collapse old history into a single summary message when context exceeds budget."""
    if len(messages) <= 12:
        return
    system_msg = messages[0]
    tail = messages[-8:]
    middle = messages[1:-8]
    transcript_lines: list[str] = []
    for m in middle:
        role = m.get("role", "?")
        content = m.get("content") or ""
        if isinstance(content, str):
            content = content[:300]
        tcs = m.get("tool_calls") or []
        tc_summary = ""
        if tcs:
            tc_names = [tc.get("function", {}).get("name", "?") for tc in tcs]
            tc_summary = f" tools={','.join(tc_names)}"
        transcript_lines.append(f"[{role}{tc_summary}] {content}")
    transcript = "\n".join(transcript_lines)[:30000]
    synth_prompt = [
        system_msg,
        {"role": "user", "content": (
            "History synthesis (>100k ctx). Summarize this transcript as bullet points (max 1500 chars):\n"
            "- Architecture decisions made\n- Files created (path → role)\n- Errors hit + fixes\n"
            "- Current state (build OK/KO, tests OK/KO)\n- Remaining task\n\n"
            f"TRANSCRIPT:\n{transcript}"
        )},
    ]
    q: Queue = Queue()
    threading.Thread(target=llm_call_fn, args=(synth_prompt, model_id, [], q), daemon=True).start()
    try:
        status, value = q.get(timeout=120)
    except Exception:
        return
    if status != "ok":
        return
    summary = (value.get("text") or "")[:2000]
    if not summary:
        return
    messages[:] = [system_msg, {"role": "user", "content": f"[HISTORY SYNTHESIS]\n{summary}"}, *tail]


def apply_message_window(messages: list[dict]) -> None:
    """Keep a bounded working set before any LLM call."""
    if len(messages) > MAX_MESSAGES_IN_CONTEXT:
        system_msg = messages[0]
        messages[:] = [system_msg] + messages[-(MAX_MESSAGES_IN_CONTEXT - 1):]
    compact_history(messages)


def prepare_messages_for_llm(messages: list[dict], model_id: str | None, llm_call_fn) -> int:
    """Compact and synthesize history until context is back under the soft cap."""
    synth_passes = 0
    previous_estimate: int | None = None
    for _ in range(3):
        apply_message_window(messages)
        estimate = estimate_tokens(messages)
        if estimate <= CONTEXT_SUMMARY_TRIGGER_TOKENS or len(messages) <= 12:
            return synth_passes
        synthesize_history(messages, llm_call_fn, model_id)
        synth_passes += 1
        apply_message_window(messages)
        next_estimate = estimate_tokens(messages)
        if next_estimate <= CONTEXT_SUMMARY_TRIGGER_TOKENS:
            return synth_passes
        if previous_estimate is not None and next_estimate >= previous_estimate:
            return synth_passes
        previous_estimate = next_estimate
    return synth_passes
