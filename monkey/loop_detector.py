"""Detects when the agent is looping on identical tool outputs/errors.

Usage:
    det = LoopDetector()
    state = det.observe("run_command", output_str)
    if state.looping and state.occurrences == 3:
        # nudge: ask agent to consult skills
    if state.looping and state.occurrences >= 5:
        # auto: trigger skill_create from web search
"""
from __future__ import annotations
import hashlib
import re
from dataclasses import dataclass, field
from collections import deque

WINDOW = 8           # last N tool_done observations kept
MIN_REPEATS = 3      # below this, not considered a loop


def _normalize(text: str) -> str:
    """Collapse whitespace, strip volatile bits (paths with timestamps, hashes)."""
    if not text:
        return ""
    s = text[:4000]
    s = re.sub(r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\b", "<TS>", s)
    s = re.sub(r"\b[0-9a-f]{8,}\b", "<HEX>", s)
    s = re.sub(r"/tmp/[^\s\"']+", "/tmp/<X>", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _kind(tool: str, output: str) -> str:
    """Compute a *kind* signature — coarser than full output.
    Same kind = same class of failure, even if line numbers / file paths differ.
    Used as a parallel counter so build-error retries are detected even when
    each TS message varies slightly across iterations.
    Returns '' for non-error or successful outputs (no kind tracking).
    """
    if not output:
        return ""
    text = output[:4000]
    # Don't track successes
    if text.lstrip().startswith("OK:") and "error" not in text.lower():
        return ""
    # Build/test command failed — coarse kind regardless of which errors
    # (sets of TS codes vary between builds, but "build failed" is the loop)
    if tool == "run_command":
        # Look at command line itself, not just output, to avoid matching
        # `npm view` or `cat package.json` whose body happens to contain "tsc".
        cmd_line = re.search(r"^\$\s*(.{0,300})", text, re.M)
        cmd_str = (cmd_line.group(1) if cmd_line else "").lower()
        ec = re.search(r"\[exit=(\d+)\]", text)
        ec_nonzero = bool(ec and ec.group(1) != "0")
        has_ts_err = "error TS" in text
        is_build_cmd = any(k in cmd_str for k in (
            "npm run build", "npm run test", "npm test",
            "tsc", "vite build", "cargo build", "cargo check",
            "pytest", "go build", "go test", "yarn build", "pnpm build",
        ))
        if has_ts_err or (ec_nonzero and is_build_cmd):
            return f"{tool}:build_failed"
    # TS error code fallback for non-run_command tools
    codes = sorted(set(re.findall(r"error TS(\d+)", text)))
    if codes:
        return f"{tool}:ts:" + ",".join(codes[:1])  # only first code → stabler
    # ESLint / generic "error" + exit code
    if re.search(r"\[exit=[1-9]", text) or re.search(r"(?i)\berror\b", text):
        # extract first error keyword cluster
        m = re.search(r"(?im)error[:\s]+([A-Za-z_][\w.-]{2,40})", text)
        if m:
            return f"{tool}:err:{m.group(1).lower()}"
        # fallback: tool + non-zero exit
        ec = re.search(r"\[exit=(\d+)\]", text)
        if ec and ec.group(1) != "0":
            return f"{tool}:exit:{ec.group(1)}"
    # edit_file with stale old_str (very common LLM trap)
    if tool == "edit_file" and ("introuvable" in text.lower() or "not found" in text.lower() or "no match" in text.lower()):
        return f"{tool}:stale_old_str"
    # ERREUR: prefix from our own tools
    if text.startswith("ERREUR:") or text.startswith("Erreur:"):
        first = text[:120]
        return f"{tool}:erreur:{re.sub(r'[^a-zA-Z]+', '_', first)[:60].lower()}"
    return ""


# kinds that warrant aggressive auto-skill trigger (lower threshold)
HIGH_SIGNAL_KINDS = {
    "run_command:build_failed",
    "edit_file:stale_old_str",
}


def _signature(tool: str, output: str) -> str:
    norm = _normalize(output)
    h = hashlib.sha1((tool + "::" + norm).encode("utf-8", "ignore")).hexdigest()[:12]
    return f"{tool}:{h}"


def _extract_error_summary(tool: str, output: str) -> str:
    """One-liner summary suitable for a search query / skill topic."""
    if not output:
        return tool
    text = output[:2000]
    # TS errors
    m = re.search(r"error TS\d+:.*", text)
    if m:
        return f"typescript {m.group(0)[:200]}"
    # generic error lines
    m = re.search(r"(?im)^.*error[:\s].{5,200}$", text)
    if m:
        return m.group(0).strip()[:240]
    # exit code line
    m = re.search(r"\[exit=\d+\]", text)
    if m:
        # take next non-empty line
        idx = text.find(m.group(0))
        rest = text[idx + len(m.group(0)):].strip()
        return (m.group(0) + " " + rest[:200]).strip()
    return text[:200].strip()


@dataclass
class LoopState:
    looping: bool = False
    signature: str = ""
    occurrences: int = 0
    summary: str = ""
    kind: str = ""


class LoopDetector:
    def __init__(self, window: int = WINDOW, min_repeats: int = MIN_REPEATS):
        self.window = window
        self.min_repeats = min_repeats
        self._sigs: deque[tuple[str, str, str, str]] = deque(maxlen=window)
        # (signature, tool, summary, kind)
        # Persistent kind counter — error-class loops survive across long
        # tool sequences (build → edit×N → read → build → …). Bounded by
        # MAX_KINDS to avoid unbounded growth.
        self._kind_counter: dict[str, int] = {}
        self._kind_summary: dict[str, str] = {}

    def observe(self, tool: str, output: str) -> LoopState:
        sig = _signature(tool, output)
        kind = _kind(tool, output)
        summary = _extract_error_summary(tool, output)
        self._sigs.append((sig, tool, summary, kind))
        sig_count = sum(1 for s, _, _, _ in self._sigs if s == sig)
        kind_count = 0
        if kind:
            self._kind_counter[kind] = self._kind_counter.get(kind, 0) + 1
            self._kind_summary[kind] = summary
            kind_count = self._kind_counter[kind]
            if len(self._kind_counter) > 64:
                # drop lowest counters to bound memory
                lo = sorted(self._kind_counter.items(), key=lambda x: x[1])[:16]
                for k, _ in lo:
                    self._kind_counter.pop(k, None)
                    self._kind_summary.pop(k, None)
        count = max(sig_count, kind_count)
        looping = count >= self.min_repeats
        out_sig = kind if (kind and kind_count >= sig_count and kind_count >= self.min_repeats) else sig
        return LoopState(
            looping=looping,
            signature=out_sig,
            occurrences=count,
            summary=summary,
            kind=kind,
        )

    def reset(self) -> None:
        self._sigs.clear()
        self._kind_counter.clear()
        self._kind_summary.clear()
