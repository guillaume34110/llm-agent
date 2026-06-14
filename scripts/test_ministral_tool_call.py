#!/usr/bin/env python3
"""Real-flow regression test for Ministral 3 3B tool calling.

Hits the live sidecar `/chat/stream` with the user-reported prompt and asserts
that the agent emits a `tool_start` event for `list_dir_images` whose `path`
resolves to a folder named `dossier_sylvanus` somewhere under the workspace.

Two test modes:
  - default: end-to-end via the agent (deterministic short-circuit allowed). Must
    succeed and emit a `tool_start` event for `list_dir_images`.
  - --no-shortcut: sets env `MONKEY_DISABLE_FOLDER_IMAGE_SHORTCUT=1` so the
    deterministic short-circuit refuses to fire — forces the real LLM path.
    Asserts that Ministral itself produces the tool_call.

Run examples:
    python3 scripts/test_ministral_tool_call.py
    python3 scripts/test_ministral_tool_call.py --no-shortcut --runs 3
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

SIDECAR = os.getenv("MONKEY_SIDECAR_URL", "http://localhost:3471")
PROMPT = "montre moi les images du dossier_sylvanus"
MODEL_ID = os.getenv("TEST_MODEL_ID", "ministral-3-3b")
TIMEOUT = 300  # seconds per run (matches agent's own forced-retry cap)


def stream_chat(body: dict) -> list[dict]:
    """POST /chat/stream and parse SSE events into a list of dicts."""
    req = urllib.request.Request(
        f"{SIDECAR}/chat/stream",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    events: list[dict] = []
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            for raw in resp:
                if time.time() - t0 > TIMEOUT:
                    events.append({"event": "_timeout", "data": "client read timeout"})
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
    except urllib.error.URLError as e:
        events.append({"event": "_transport_error", "data": str(e)})
    return events


def summarize(events: list[dict]) -> str:
    lines = []
    for ev in events:
        kind = ev.get("event", "?")
        if kind == "tool_start":
            lines.append(f"  tool_start name={ev.get('name')} args={ev.get('args')}")
        elif kind == "tool_done":
            out = str(ev.get("output", ""))[:120].replace("\n", " ")
            lines.append(f"  tool_done name={ev.get('name')} output_head={out!r}")
        elif kind == "thinking":
            phase = ev.get("phase", "")
            extra = ""
            if phase == "calling_model":
                extra = f" ctx_tok={ev.get('context_tokens')} num_tools={ev.get('num_tools')}"
            lines.append(f"  thinking phase={phase}{extra}")
        elif kind == "usage":
            lines.append(
                f"  usage prompt={ev.get('prompt_tokens')} completion={ev.get('completion_tokens')}"
            )
        elif kind == "done":
            data = str(ev.get("data", ""))[:240].replace("\n", " ")
            lines.append(f"  done {data!r}")
        elif kind == "error":
            lines.append(f"  ERROR {ev.get('data')}")
        else:
            lines.append(f"  {kind} {json.dumps({k: v for k, v in ev.items() if k != 'event'})[:200]}")
    return "\n".join(lines)


def has_tool_start(events: list[dict], expected_name: str) -> dict | None:
    for ev in events:
        if ev.get("event") == "tool_start" and ev.get("name") == expected_name:
            return ev
    return None


def has_done(events: list[dict]) -> dict | None:
    for ev in events:
        if ev.get("event") == "done":
            return ev
    return None


def run_one(force_real_llm: bool) -> tuple[bool, list[dict], str]:
    body = {
        "message": PROMPT,
        "model_id": MODEL_ID,
        "provider_mode": "local",
        "session_id": f"test-ministral-{int(time.time())}",
        "history": [],
    }
    if force_real_llm:
        # Hint to the sidecar that the shortcut should be disabled for this
        # test session; the agent reads this flag at runtime.
        body["session_id"] = "MONKEY_TEST_NO_SHORTCUT_" + body["session_id"]
    events = stream_chat(body)
    tool_evt = has_tool_start(events, "list_dir_images")
    done = has_done(events)
    ok = tool_evt is not None
    path = (tool_evt.get("args", {}) if tool_evt else {}).get("path") or ""
    # Path must resolve to a folder containing `sylvanus` in its name —
    # weaker models (phi-4-mini) like to invent plausible-looking but wrong
    # paths even when the workspace scan shows `dossier_sylvanus`.
    path_ok = "sylvanus" in path.lower()
    if ok and not path_ok:
        ok = False
    if ok and force_real_llm:
        # If shortcut was disabled, also check that the tool_call came from the
        # LLM (not the deterministic short-circuit). The agent emits a `usage`
        # event before any LLM tool_call but not before the short-circuit.
        had_usage_before = False
        for ev in events:
            if ev.get("event") == "usage":
                had_usage_before = True
            if ev.get("event") == "tool_start" and ev.get("name") == "list_dir_images":
                if not had_usage_before:
                    ok = False
                break
    if ok:
        status = f"OK tool_start path={path!r}"
    elif tool_evt is not None and not path_ok:
        status = f"FAIL wrong path={path!r} (must contain 'sylvanus')"
    else:
        status = f"FAIL no list_dir_images tool_start. done={done.get('data') if done else 'no done'!r}"
    return ok, events, status


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=1, help="how many sequential runs")
    ap.add_argument(
        "--no-shortcut",
        action="store_true",
        help="disable the deterministic folder-image short-circuit (real LLM only)",
    )
    ap.add_argument("--verbose", "-v", action="store_true", help="dump full event list")
    args = ap.parse_args()

    print(f"[test] sidecar={SIDECAR} model={MODEL_ID} prompt={PROMPT!r}")
    print(f"[test] mode={'REAL LLM (no shortcut)' if args.no_shortcut else 'agent default'}")

    passes = 0
    fails: list[str] = []
    for i in range(args.runs):
        print(f"\n=== run {i + 1}/{args.runs} ===")
        ok, events, status = run_one(args.no_shortcut)
        print(f"[run {i + 1}] {status}")
        if args.verbose or not ok:
            print(summarize(events))
        if ok:
            passes += 1
        else:
            fails.append(f"run {i + 1}: {status}")

    print(f"\n[summary] {passes}/{args.runs} passed")
    if fails:
        for f in fails:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
