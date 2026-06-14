"""notify_user tool: explicit WhatsApp push from inside an agent run.

Used for alert-mode scheduled tasks where auto-notify is disabled. The agent
calls this only when a watched condition is actually met, so silent runs stay
silent.
"""
from __future__ import annotations


def notify_user(text: str) -> str:
    from monkey import main, agent
    # Live WhatsApp conversation: route to the active chat, NOT the owner.
    # Scheduled runs: scheduler pre-binds _CURRENT_WA_JID to the task's target
    # (waChatJid or resolved owner). When pre-bound — even to empty string —
    # honor it (sidecar default = owner). Standalone runs (attr unset/None)
    # fall back to live owner lookup.
    bound = getattr(agent, "_CURRENT_WA_JID", None)
    if bound is None:
        target = (main._wa_status()[0] or "")
        if not target:
            return "ERREUR: no whatsapp target (sidecar not ready and no active session)"
    else:
        target = bound.strip()
    body = str(text)[:4000]
    main._wa_send_text(target, body)
    return "ok"
