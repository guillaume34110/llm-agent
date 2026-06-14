#!/usr/bin/env python3
"""In-process e2e: multi-turn conversation through agent.chat_stream against the
live bundled llama-server (llama-3.2-3b, --jinja). Exercises the edited
agent.py / llm.py source directly (no PyInstaller rebuild needed).

Targets the exact prompt that crashed with HTTP 500 "Failed to parse" so we can
confirm the fix: weak model emits a JSON tool-call as content, llama.cpp rejects
it, llm.py retries without native tools, agent extracts the inline JSON.
"""
from __future__ import annotations
import os
import sys
import time
import threading

LLAMA_URL = os.getenv("LLAMA_URL", "http://127.0.0.1:50402")
LLAMA_KEY = os.getenv("LLAMA_KEY", "")
MODEL_ID = os.getenv("TEST_MODEL_ID", "llama-3.2-3b")
PER_TURN_CAP = int(os.getenv("PER_TURN_CAP", "180"))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from monkey import agent  # noqa: E402


def run_turn(history, user_msg):
    print(f"\n{'='*70}\nUSER: {user_msg}\n{'='*70}")
    events = []
    done_text = None
    err = None
    t0 = time.time()

    def _drive():
        nonlocal done_text, err
        try:
            for ev in agent.chat_stream(
                history=history,
                user_message=user_msg,
                model_id=MODEL_ID,
                session_id="e2e-conv-llama",
                provider_mode="local",
                tool_mode="auto",
                llama_base_url=LLAMA_URL,
                llama_bearer_token=LLAMA_KEY,
            ):
                events.append(ev)
                kind = ev.get("event")
                if kind == "tool_start":
                    print(f"  [tool_start] {ev.get('name')} args={ev.get('args')}")
                elif kind == "tool_done":
                    out = str(ev.get("output"))[:160].replace("\n", " ")
                    print(f"  [tool_done]  {ev.get('name')} -> {out}")
                elif kind == "error":
                    print(f"  [ERROR] {ev.get('data')}")
                elif kind == "done":
                    done_text = ev.get("data")
        except Exception as e:  # noqa: BLE001
            err = e

    th = threading.Thread(target=_drive, daemon=True)
    th.start()
    th.join(PER_TURN_CAP)
    dt = time.time() - t0
    if th.is_alive():
        print(f"  [TIMEOUT] turn exceeded {PER_TURN_CAP}s")
        return None, events, dt
    if err is not None:
        print(f"  [EXCEPTION] {type(err).__name__}: {err}")
        return None, events, dt
    print(f"\nASSISTANT ({dt:.1f}s): {str(done_text)[:600]}")
    return done_text, events, dt


def main():
    print(f"Model={MODEL_ID} llama={LLAMA_URL} key={'set' if LLAMA_KEY else 'EMPTY'}")
    history: list[dict] = []
    turns = [
        "je veux me lancer dans l'elevage des grenouilles des conseils ?",
        "et niveau budget pour debuter, tu estimes combien ?",
    ]
    results = []
    for msg in turns:
        text, events, dt = run_turn(history, msg)
        ev_kinds = [e.get("event") for e in events]
        has_error = "error" in ev_kinds or any(
            isinstance(text, str) and text.startswith("Erreur") for _ in [0]
        ) or (isinstance(text, str) and ("HTTP 500" in text or "did not use its tools" in text))
        ok = bool(text) and not has_error
        results.append(ok)
        history.append({"role": "user", "content": msg})
        history.append({"role": "assistant", "content": str(text or "")})

    print(f"\n{'='*70}\nRESULT: {sum(results)}/{len(results)} turns OK")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
