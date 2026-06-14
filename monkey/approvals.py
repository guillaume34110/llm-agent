"""Approval bridge between agent loop (Python sidecar) and UI (Tauri/React).

Sensitive tools and dangerous shell patterns require user approval before execution.
The agent thread blocks on a threading.Event; the UI POSTs the decision to /approve."""
import re
import threading
import uuid
from typing import Optional

# Tools that always trigger approval prompt (unless session-allowlisted)
SENSITIVE_TOOLS = {"run_command", "delete_file"}

# Shell patterns that ALWAYS require approval — bypass session allowlist.
# Install/global/sudo/pipe-to-shell are high-blast-radius.
_DANGEROUS_PATTERNS = [
    r"\bnpm\s+(?:install|i|add)\s+(?:[^&|;\n]*\s+)?-g\b",
    r"\bnpm\s+(?:install|i|add)\s+(?:[^&|;\n]*\s+)?--global\b",
    r"\byarn\s+global\s+add\b",
    r"\bpnpm\s+(?:add|install|i)\s+(?:[^&|;\n]*\s+)?-g\b",
    r"\bbrew\s+(?:install|reinstall|cask\s+install)\b",
    r"\bport\s+install\b",
    r"\b(?:curl|wget)\s+[^|;]*\|\s*(?:sh|bash|zsh)\b",
    r"\brm\s+-rf\s+/\S*",
    r"\bsudo\b",
    r"\bchmod\s+\+?[ux]",
    r"\bpip(?:3)?\s+install\s+(?!-r\s)",
    r"\bpipx\s+install\b",
    r"\bgem\s+install\b",
    r"\bcargo\s+install\b",
    r"\bgo\s+install\b",
    r"\bdocker\s+(?:run|exec|build)\b",
    r"\b(?:apt|apt-get|yum|dnf|pacman)\s+install\b",
]
_DANGEROUS_RE = [re.compile(p, re.IGNORECASE) for p in _DANGEROUS_PATTERNS]


class ApprovalStore:
    """In-memory pending requests + per-session allowlist."""

    def __init__(self):
        self._events: dict[str, threading.Event] = {}
        self._decisions: dict[str, dict] = {}
        self._allowlist: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def is_allowed(self, session_id: str, tool_name: str) -> bool:
        with self._lock:
            return tool_name in self._allowlist.get(session_id, set())

    def allow_session(self, session_id: str, tool_name: str):
        with self._lock:
            self._allowlist.setdefault(session_id, set()).add(tool_name)

    def create_pending(self) -> str:
        rid = uuid.uuid4().hex
        with self._lock:
            self._events[rid] = threading.Event()
        return rid

    def resolve(self, rid: str, decision: str, scope: str = "once") -> bool:
        with self._lock:
            ev = self._events.get(rid)
            if ev is None:
                return False
            self._decisions[rid] = {"decision": decision, "scope": scope}
        ev.set()
        return True

    def wait(self, rid: str, timeout: float = 300.0) -> dict:
        with self._lock:
            ev = self._events.get(rid)
        if ev is None:
            return {"decision": "deny", "scope": "once", "reason": "no_pending"}
        ok = ev.wait(timeout)
        with self._lock:
            decision = self._decisions.pop(rid, None)
            self._events.pop(rid, None)
        if not ok or decision is None:
            return {"decision": "deny", "scope": "once", "reason": "timeout"}
        return decision


STORE = ApprovalStore()


def matched_dangerous_pattern(cmd: str) -> Optional[str]:
    """Return matched pattern source, or None."""
    if not isinstance(cmd, str):
        return None
    for rx in _DANGEROUS_RE:
        if rx.search(cmd):
            return rx.pattern
    return None


def needs_approval(tool_name: str, args: dict, session_id: str) -> tuple[bool, str, bool]:
    """Return (needs_approval, reason, bypass_allowlist).
    bypass_allowlist=True means even session-approved tools still need confirmation
    (used for dangerous patterns)."""
    if tool_name == "run_command":
        cmd = str(args.get("command", "") if isinstance(args, dict) else "")
        pat = matched_dangerous_pattern(cmd)
        if pat:
            return (True, f"dangerous_pattern:{pat}", True)
        if STORE.is_allowed(session_id, tool_name):
            return (False, "", False)
        return (True, "sensitive_tool", False)
    if tool_name in SENSITIVE_TOOLS:
        if STORE.is_allowed(session_id, tool_name):
            return (False, "", False)
        return (True, "sensitive_tool", False)
    return (False, "", False)


def summarize_for_user(tool_name: str, args: dict) -> tuple[str, str]:
    """Return (title, summary) for UI display."""
    if not isinstance(args, dict):
        args = {}
    if tool_name == "run_command":
        return ("Commande shell", str(args.get("command", "")))
    if tool_name == "delete_file":
        return ("Suppression fichier", str(args.get("path", "")))
    return (tool_name, "Action sensible")
