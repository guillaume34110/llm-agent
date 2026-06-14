"""Monkey agent FastAPI server."""
from pathlib import Path
import os
import httpx
import uuid
import datetime
import json
import time
import threading
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import urllib.request
import urllib.error
from monkey import store
from monkey import memory as mem_mod
from monkey import llm as llm_mod
from monkey import custom_endpoints as custom_ep
from monkey.agent import chat_stream as agent_chat_stream
from monkey.tasks_store import TaskStore, preview_recurrence

WA_SIDECAR_URL = os.getenv("MONKEY_WA_URL", "http://127.0.0.1:3472")


_MEDIA_EXTS: dict[str, str] = {
    # image
    "jpg": "image", "jpeg": "image", "png": "image", "gif": "image", "webp": "image", "heic": "image", "bmp": "image",
    # video
    "mp4": "video", "mov": "video", "webm": "video", "mkv": "video", "avi": "video",
    # audio
    "mp3": "audio", "wav": "audio", "ogg": "audio", "m4a": "audio", "flac": "audio",
    # document
    "pdf": "document", "doc": "document", "docx": "document", "xls": "document", "xlsx": "document",
    "ppt": "document", "pptx": "document", "txt": "document", "csv": "document", "md": "document", "zip": "document",
}


def _wa_status() -> tuple[str | None, str]:
    """Return (owner_jid, status). Empty tuple on failure."""
    try:
        with urllib.request.urlopen(f"{WA_SIDECAR_URL}/wa/status", timeout=2) as resp:
            data = json.loads(resp.read())
    except Exception:
        return (None, "unreachable")
    status = str(data.get("status") or "")
    target = (data.get("user") or {}).get("id")
    return (target if status == "ready" else None, status)


import re as _re

_FENCE_RE = _re.compile(r"```[a-zA-Z0-9_-]*\s*\n?(.*?)\n?```", _re.DOTALL)
_BOLD_RE = _re.compile(r"\*\*(.+?)\*\*", _re.DOTALL)
_UNDERLINE_RE = _re.compile(r"__(.+?)__", _re.DOTALL)
_INLINE_CODE_RE = _re.compile(r"`([^`\n]+)`")
_HEADER_RE = _re.compile(r"^\s{0,3}#{1,6}\s+", _re.MULTILINE)
_BULLET_RE = _re.compile(r"^(\s*)[-*+]\s+", _re.MULTILINE)
_META_PREFIX_RE = _re.compile(
    r"^(\[(?:task|mail|agent|bot|system|note)\][^\n]*|"
    r"erreur\s*:[^\n]*|error\s*:[^\n]*|"
    r"voici (?:le|la|un|une|mon|ma) [^\n:]{1,40}\s*:\s*|"
    r"r[ée]ponse(?:\s+au\s+client)?\s*:\s*|"
    r"message\s*:\s*|"
    r"\(?\s*(?:message\s+)?envoy[ée]e?\.?\s*\)?|"
    r"\(?\s*done\.?\s*\)?|"
    r"\(?\s*sent\.?\s*\)?)\s*$",
    _re.IGNORECASE,
)


def _sanitize_outgoing(text: str) -> str:
    """Make agent output read as a real human message.

    - Strip ```lang ... ``` fences (keep inner)
    - Strip markdown emphasis: **bold**, __underline__, `inline`
    - Strip ATX headers (# ...) and turn bullets into • for WA
    - Drop standalone meta lines: [Task]..., ERREUR:..., "Voici le message:", "(envoyé)"
    - Drop pure pipe-table separator lines
    """
    if not isinstance(text, str):
        return str(text)
    s = text
    if "```" in s:
        s = _FENCE_RE.sub(lambda m: m.group(1), s)
        s = s.replace("```", "")
    s = _BOLD_RE.sub(r"\1", s)
    s = _UNDERLINE_RE.sub(r"\1", s)
    s = _INLINE_CODE_RE.sub(r"\1", s)
    s = _HEADER_RE.sub("", s)
    s = _BULLET_RE.sub(lambda m: f"{m.group(1)}• ", s)
    out_lines: list[str] = []
    for raw in s.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            out_lines.append("")
            continue
        # Pure pipe-table separator like |---|---|
        if _re.fullmatch(r"\|?\s*[:\-\|\s]+\|?", stripped) and "|" in stripped:
            continue
        # Standalone meta/marker line
        if _META_PREFIX_RE.match(stripped):
            continue
        out_lines.append(line)
    # Collapse runs of blank lines
    collapsed: list[str] = []
    blank = False
    for line in out_lines:
        if not line.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        collapsed.append(line)
    return "\n".join(collapsed).strip()


def _wa_send_text(target: str, text: str) -> None:
    text = _sanitize_outgoing(text)
    payload = json.dumps({"to": target, "message": text}).encode()
    try:
        req = urllib.request.Request(
            f"{WA_SIDECAR_URL}/wa/send",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:
        pass


def _wa_send_file(target: str, path: str, kind: str, caption: str = "") -> None:
    payload: dict = {"to": target, "path": path, "kind": kind}
    caption = _sanitize_outgoing(caption or "")
    if caption:
        payload["caption"] = caption[:900]
    try:
        req = urllib.request.Request(
            f"{WA_SIDECAR_URL}/wa/send-file",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=120).read()
    except Exception:
        pass


def _extract_media_paths(tool_calls: list[dict]) -> list[tuple[str, str]]:
    """Scan tool outputs for absolute file paths that point at media files on disk.
    Returns deduped list of (abs_path, kind)."""
    import re
    pattern = re.compile(r"(/[^\s\"'`<>]+\.[A-Za-z0-9]{2,5})")
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for call in tool_calls:
        text = str(call.get("output") or "")
        for match in pattern.findall(text):
            path = match.rstrip(".,;:!?)")
            if path in seen:
                continue
            ext = path.rsplit(".", 1)[-1].lower()
            kind = _MEDIA_EXTS.get(ext)
            if not kind:
                continue
            if not os.path.isfile(path):
                continue
            seen.add(path)
            out.append((path, kind))
    return out


def _wa_notify(title: str, body: str, tool_calls: list[dict] | None = None) -> None:
    """Best-effort: send the task result to the owner JID. Also send any media files produced."""
    target, _status = _wa_status()
    if not target:
        return
    text = body.strip()
    if len(text) > 4000:
        text = text[:3990] + "\n…(truncated)"
    _wa_send_text(target, text)
    if tool_calls:
        for path, kind in _extract_media_paths(tool_calls):
            _wa_send_file(target, path, kind, caption=title)

BACKEND_URL = os.getenv("MONKEY_BACKEND_URL", "https://ai.progsoft.eu")
MONKEY_DIR = os.path.join(os.path.expanduser("~"), ".monkey")
os.makedirs(MONKEY_DIR, exist_ok=True)

SESSIONS_FILE = os.path.join(MONKEY_DIR, "sessions.json")
CONFIG_FILE = os.path.join(MONKEY_DIR, "config.json")
TASKS_FILE = os.path.join(MONKEY_DIR, "tasks.json")
DEFAULT_WORKSPACE = os.path.join(os.path.expanduser("~"), "Documents", "Agent")
TASK_STORE = TaskStore(TASKS_FILE)

app = FastAPI(title="Monkey Agent", version="1.0.0")


def _run_scheduled_agent(prompt: str, task: dict) -> str:
    """Drain agent_chat_stream until done; return assistant text. Used by the scheduler."""
    final = ""
    last_error = ""
    tool_calls: list[dict] = []
    model_id = (task.get("modelId") or "").strip() or None
    image_model_id = (task.get("imageModelId") or store.get("LAST_IMAGE_MODEL_ID") or "").strip() or None
    image_size = (task.get("imageSize") or store.get("LAST_IMAGE_SIZE") or "").strip() or None
    if not model_id:
        return "ERREUR: task has no pinned modelId — edit the task and select a model."
    task_id = str(task.get("id") or "")

    def _log(kind: str, label: str, detail: str | None = None) -> None:
        if not task_id:
            return
        try:
            TASK_STORE.append_run_log(task_id, {"kind": kind, "label": label, "detail": detail})
        except Exception:
            pass

    if task_id:
        try:
            TASK_STORE.reset_run_log(task_id)
        except Exception:
            pass
    _log("start", "run started", (prompt or "")[:200])
    # If the task is bound to a WhatsApp chat, use a whatsapp:<jid> session so
    # _CURRENT_WA_JID is set during the run (notify_user, send_whatsapp_text route
    # to the right thread). Otherwise fall back to the generic scheduled: session.
    wa_chat_jid = (task.get("waChatJid") or "").strip()
    session_id = f"whatsapp:{wa_chat_jid}" if wa_chat_jid else f"scheduled:{task_id}"
    # Scheduled tasks must execute with full tool access (including image/media
    # paths and WhatsApp send helpers). Ignore any persisted restrictive mode.
    scheduled_tool_mode = "full"
    # Reuse the chat's document folder. List files at run time (so docs added
    # after the task was scheduled are picked up). The block goes through
    # extra_system_instructions, same path as the live wa-bridge — chat_only
    # mode still sees it because docs are injected via system prompt, not tools.
    context_folder = (task.get("contextFolder") or "").strip() or None
    folder_files: list[str] = []
    folder_block = ""
    if context_folder:
        try:
            for name in sorted(os.listdir(context_folder)):
                if name.startswith("."):
                    continue
                if os.path.isfile(os.path.join(context_folder, name)):
                    folder_files.append(name)
        except Exception:
            folder_files = []
        if folder_files:
            sample = folder_files[:40]
            extra = len(folder_files) - len(sample)
            folder_block = "\n".join([
                "[AVAILABLE DOCUMENTS — files in the user-configured context folder for this chat]",
                *(f"- {n}" for n in sample),
                f"(+{extra} more)" if extra > 0 else "",
                "To send one of these documents to the user via WhatsApp, write `[SEND_DOC: <exact filename>]` on its own line in your reply.",
                "The bridge will strip the marker and send the file as a WhatsApp document attachment. Only filenames from the list above are valid; never invent paths.",
                "[END AVAILABLE DOCUMENTS]",
            ])
            folder_block = "\n".join([ln for ln in folder_block.split("\n") if ln])
    try:
        for evt in agent_chat_stream(
            [],
            prompt,
            model_id,
            image_model_id,
            image_size=image_size,
            session_id=session_id,
            tool_mode=scheduled_tool_mode,
            extra_system_instructions=folder_block or None,
            context_folder=context_folder,
            scheduled_run=True,
        ):
            if not isinstance(evt, dict):
                continue
            ev = evt.get("event")
            if ev == "done":
                final = str(evt.get("data") or "")
            elif ev == "tool_start":
                args = evt.get("args")
                try:
                    detail = json.dumps(args, ensure_ascii=False)[:400] if args else None
                except Exception:
                    detail = str(args)[:400] if args else None
                _log("tool_start", str(evt.get("name") or "?"), detail)
            elif ev == "tool_done":
                output = evt.get("output")
                detail = str(output)[:400] if output is not None else None
                _log("tool_done", str(evt.get("name") or "?"), detail)
                tool_calls.append({
                    "name": evt.get("name"),
                    "args": evt.get("args"),
                    "output": evt.get("output"),
                })
            elif ev == "intent":
                _log("intent", "intent", str(evt.get("data") or evt.get("message") or "")[:400])
            elif ev == "model_route":
                _log("model", "model_route", str(evt.get("message") or evt.get("data") or "")[:200])
            elif ev == "error":
                last_error = str(evt.get("data") or evt.get("message") or "")
                _log("error", "error", last_error[:400])
    except Exception as e:
        _log("error", "exception", str(e)[:400])
        return f"ERREUR: {e}"
    if not final:
        return f"ERREUR: {last_error or 'no output from agent'}"
    # Parse [SEND_DOC: filename] markers — same protocol as wa-bridge. Only
    # filenames from the listed folder are accepted; the markers are stripped
    # from the user-facing text before notify.
    send_docs: list[str] = []
    if folder_files and context_folder:
        import re
        allowed = set(folder_files)
        def _swap(m):
            name = m.group(1).strip()
            if not name or "/" in name or "\\" in name or name in (".", ".."):
                return ""
            if name not in allowed:
                return ""
            abs_p = os.path.join(context_folder, name)
            if abs_p not in send_docs:
                send_docs.append(abs_p)
            return ""
        final = re.sub(r"\[SEND_DOC:\s*([^\]\n]+?)\s*\]", _swap, final)
        final = re.sub(r"\n{3,}", "\n\n", final).strip()
    from monkey.scheduler import humanize_agent_output
    text = humanize_agent_output(final)
    _log("done", "run finished", text[:200])
    # Stash tool_calls on the task dict so scheduler.tick can fish out media for
    # WA file uploads without re-running the agent. Auto-notify itself now lives
    # in scheduler.tick (mode-aware: skipped for alert tasks).
    try:
        task["_toolCalls"] = tool_calls
        if send_docs:
            task["_sendDocs"] = send_docs
    except Exception:
        pass
    return text


@app.on_event("startup")
def _start_task_scheduler():
    from monkey.scheduler import start_scheduler
    TASK_STORE.boot_recover_orphans()
    interval = float(os.environ.get("MONKEY_SCHEDULER_INTERVAL", "15"))
    if interval <= 0:
        return
    app.state._scheduler_stop = start_scheduler(TASK_STORE, _run_scheduled_agent, interval=interval)


@app.on_event("shutdown")
def _stop_task_scheduler():
    stop = getattr(app.state, "_scheduler_stop", None)
    if stop is not None:
        stop.set()
app.add_middleware(CORSMiddleware, allow_origins=[
    "http://localhost:8001", "http://127.0.0.1:8001",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3470",
    "http://localhost:1420",
    "tauri://localhost",
], allow_methods=["*"], allow_headers=["*"])


# ── Models ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    model_id: str | None = None
    image_model_id: str | None = None
    image_size: str | None = None
    video_model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    history: list[dict] = []
    session_id: str = "global"
    animal_id: str | None = None
    extra_system_instructions: str | None = None
    tool_mode: str | None = None
    context_folder: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None

class ApprovalDecisionRequest(BaseModel):
    id: str
    decision: str  # "allow" | "deny"
    scope: str = "once"  # "once" | "session"
    session_id: str = "global"
    tool: str | None = None

class LoginRequest(BaseModel):
    email: str
    password: str

class BrowserNavigateRequest(BaseModel):
    url: str

class BrowserClickRequest(BaseModel):
    selector: str

class BrowserFillRequest(BaseModel):
    selector: str
    value: str

class BrowserScrollRequest(BaseModel):
    direction: str = "down"
    amount: int = 500

class BrowserRunJsRequest(BaseModel):
    code: str

class BrowserWaitRequest(BaseModel):
    selector: str = ""
    timeout_ms: int = 10000

class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 5

class WebSearchAndReadRequest(BaseModel):
    query: str
    max_pages: int = 3

class WebFetchRequest(BaseModel):
    url: str
    max_chars: int = 50000

class TaskCreateRequest(BaseModel):
    title: str
    details: str = ""
    scheduledFor: str
    endsAt: str | None = None
    allDay: bool = False
    status: str = "planned"
    source: str = "user"
    agentPrompt: str | None = None
    shellCommand: str | None = None
    recurrence: str | None = None
    recurrenceUntil: str | None = None
    recurrenceCount: int | None = None
    modelId: str | None = None
    imageModelId: str | None = None
    mode: str | None = None
    waChatJid: str | None = None
    waChatLabel: str | None = None
    waChatKind: str | None = None
    toolMode: str | None = None
    contextFolder: str | None = None
    reportMode: str | None = None
    reportCondition: str | None = None

class TaskUpdateRequest(BaseModel):
    title: str | None = None
    details: str | None = None
    scheduledFor: str | None = None
    endsAt: str | None = None
    allDay: bool | None = None
    status: str | None = None
    source: str | None = None
    agentPrompt: str | None = None
    shellCommand: str | None = None
    recurrence: str | None = None
    recurrenceUntil: str | None = None
    recurrenceCount: int | None = None
    modelId: str | None = None
    imageModelId: str | None = None
    mode: str | None = None
    waChatJid: str | None = None
    waChatLabel: str | None = None
    waChatKind: str | None = None
    toolMode: str | None = None
    contextFolder: str | None = None
    reportMode: str | None = None
    reportCondition: str | None = None


class RecurrencePreviewRequest(BaseModel):
    recurrence: str
    scheduledFor: str
    count: int = 5
    recurrenceUntil: str | None = None
    recurrenceCount: int | None = None


def _model_to_dict(model: BaseModel, *, exclude_none: bool = False, exclude_unset: bool = False) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=exclude_none, exclude_unset=exclude_unset)
    return model.dict(exclude_none=exclude_none, exclude_unset=exclude_unset)


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/login")
def login(req: LoginRequest):
    try:
        token = llm_mod.login(req.email, req.password)
    except Exception as e:
        raise HTTPException(401, f"Login failed: {e}")
    if not token:
        raise HTTPException(401, "No token received — check backend config")
    return {"ok": True}


@app.post("/logout")
def logout():
    store.delete("TOKEN")
    return {"ok": True}


@app.get("/status")
def status():
    return {"authenticated": bool(store.get("TOKEN")), "version": "1.0.0"}


@app.get("/auth/status")
def auth_status():
    token = store.get("TOKEN")
    email = store.get("EMAIL") or ""
    return {"logged_in": bool(token), "email": email}


# ── Chat ──────────────────────────────────────────────────────────────────────

@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest):
    # Remember the user's active model so scheduled tasks can reuse it.
    if req.model_id:
        try: store.set("LAST_MODEL_ID", req.model_id)
        except Exception: pass
    if req.image_model_id:
        try: store.set("LAST_IMAGE_MODEL_ID", req.image_model_id)
        except Exception: pass
    if req.image_size:
        try: store.set("LAST_IMAGE_SIZE", req.image_size)
        except Exception: pass
    if req.video_model_id:
        try: store.set("LAST_VIDEO_MODEL_ID", req.video_model_id)
        except Exception: pass
    def generate():
        try:
            for event in agent_chat_stream(
                req.history,
                req.message,
                model_id=req.model_id,
                image_model_id=req.image_model_id,
                image_size=req.image_size,
                session_id=req.session_id,
                animal_id=req.animal_id,
                video_model_id=req.video_model_id,
                provider_mode=req.provider_mode,
                provider_user_id=req.provider_user_id,
                extra_system_instructions=req.extra_system_instructions,
                tool_mode=req.tool_mode,
                context_folder=req.context_folder,
                llama_base_url=req.llama_base_url,
                llama_bearer_token=req.llama_bearer_token,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except PermissionError as e:
            yield f"data: {json.dumps({'event': 'error', 'data': str(e)})}\n\n"
        except RuntimeError as e:
            yield f"data: {json.dumps({'event': 'error', 'data': str(e)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'data': str(e)})}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Games ───────────────────────────────────────────────────────────────────


class ChessMoveRequest(BaseModel):
    fen: str
    legal_moves: list[str]
    history: list[str] | None = None
    model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


def _match_chess_move(raw: str, legal: list[str]) -> str | None:
    """Map a free-form model reply to one legal SAN move, or None if no match.

    Weak local models add punctuation, move numbers, or prose. We accept an
    exact match first, then case-insensitive, then scan for the first legal SAN
    token anywhere in the reply. None → caller plays a fallback legal move.
    """
    if not raw:
        return None
    legal_ci = {m.lower(): m for m in legal}
    first_line = raw.strip().strip('."\'` ').split("\n")[0].strip()
    if first_line in legal:
        return first_line
    if first_line.lower() in legal_ci:
        return legal_ci[first_line.lower()]
    for tk in _re.findall(r"[A-Za-z][A-Za-z0-9+#=\-]{0,6}", raw):
        if tk.lower() in legal_ci:
            return legal_ci[tk.lower()]
    return None


def _game_model_id(req_model_id: str | None) -> str | None:
    """Resolve the model for a mini-game request. The game UIs don't always have
    an 'active' model in hand (it's only set after a chat routes one), so when the
    client sends none we reuse the last model the user chatted with — the same
    LAST_MODEL_ID the chat stream persists. Keeps the GM/opponent live instead of
    silently dropping to the offline fallback.

    Experimental 'waaagh-*' base models (tiny nGPT bases) can't honour the game's
    JSON contract — they emit word-salad. They're never a valid GM, so an explicit
    request for one, or a reused LAST_MODEL_ID pointing at one, resolves to None →
    the game uses its deterministic offline content and the badge stays honest."""
    def _ok(m: str) -> bool:
        return bool(m) and not m.lower().startswith("waaagh")
    mid = (req_model_id or "").strip()
    if mid:
        return mid if _ok(mid) else None
    try:
        last = (store.get("LAST_MODEL_ID") or "").strip()
    except Exception:
        last = ""
    return last if _ok(last) else None


# Locale code → English language name, so the GM/NPC prompts can ask the model to
# narrate in the player's chosen UI language (the LLM output is most of what the
# player reads in-game). English is the default and needs no instruction.
_LANG_NAMES = {
    "fr": "French", "en": "English", "es": "Spanish", "de": "German",
    "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish",
    "ru": "Russian", "uk": "Ukrainian", "tr": "Turkish", "ar": "Arabic",
    "hi": "Hindi", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    "vi": "Vietnamese", "th": "Thai", "id": "Indonesian", "sv": "Swedish",
}


def _lang_clause(lang: str | None) -> str:
    """A one-line directive appended to a game system prompt so all player-facing
    prose comes back in the player's language. Empty for English / unknown codes
    (the prompts are already authored in English)."""
    code = (lang or "").strip().lower()[:5]
    code = code.split("-")[0]
    name = _LANG_NAMES.get(code)
    if not name or name == "English":
        return ""
    return f" Write ALL player-facing text (narration, names, blurbs, labels, replies) in {name}, regardless of the language of this prompt."


@app.post("/game/chess/move")
def chess_move_endpoint(req: ChessMoveRequest):
    """Ask the model for Black's move; validate against the client's legal list.

    The client (chess.js) is the source of truth for legality — it sends the
    exact legal SAN list. We only pick from it. If the model returns an illegal
    or unparseable move we play a random legal move so the game never stalls
    (the guard-rail the user chose). FEN/legal-move exchange only — no prompt
    content, consistent with the local-first matchmaking invariant.
    """
    import random
    legal = [m for m in (req.legal_moves or []) if isinstance(m, str) and m.strip()]
    if not legal:
        raise HTTPException(400, "no legal moves")
    fallback = random.choice(legal)
    model_id = _game_model_id(req.model_id)
    if not model_id:
        return {"move": fallback, "fallback": True, "reason": "no_model"}
    moves_str = ", ".join(legal)
    hist = " ".join(req.history or [])
    sys = (
        "You are a chess engine playing Black. Reply with EXACTLY ONE move in "
        "Standard Algebraic Notation (SAN) and nothing else. The move MUST be one "
        "of the provided legal moves. No explanation, no move number, no punctuation."
    )
    user = (
        f"FEN: {req.fen}\n"
        + (f"Moves so far: {hist}\n" if hist else "")
        + f"Legal moves (choose one): {moves_str}\n"
        "Your move:"
    )
    messages = [{"role": "system", "content": sys}, {"role": "user", "content": user}]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
        )
        raw = (result.get("text") or "").strip()
    except Exception as e:
        return {"move": fallback, "fallback": True, "reason": f"llm_error: {str(e)[:120]}"}
    move = _match_chess_move(raw, legal)
    if move is None:
        return {"move": fallback, "fallback": True, "reason": "illegal_or_unparsed", "raw": raw[:80]}
    return {"move": move, "fallback": False}


# ── Game maker — raw single-turn completion ──────────────────────────────────
# The 8-bit maker's sprite/map AI needs a CLEAN model call: just a terse author
# spec as system + the user's request, NO agent SYSTEM_PROMPT, NO tools, NO intent
# router. Going through /chat/stream corrupts structured output (the agent fires
# generate_image on "draw…" prompts and its prose-oriented system prompt competes
# with the grid/DSL format). This endpoint is the bypass: one system + one user
# message in, one text out. The client owns all parsing/validation. Local-first:
# no content stored, no payload logged.

class MakerCompleteRequest(BaseModel):
    system: str
    prompt: str
    model_id: str | None = None
    temperature: float | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


@app.post("/game/maker/complete")
def maker_complete_endpoint(req: MakerCompleteRequest):
    model_id = _game_model_id(req.model_id)
    if not model_id:
        raise HTTPException(400, "no_model")
    messages = [
        {"role": "system", "content": req.system},
        {"role": "user", "content": req.prompt},
    ]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
            temperature=req.temperature,
        )
    except Exception as e:
        raise HTTPException(502, f"llm_error: {str(e)[:160]}")
    return {"text": (result.get("text") or "")}


# ── Poker (heads-up Texas Hold'em) — LLM opponent ────────────────────────────
# The client owns EVERY number (deck, pot, stacks, betting legality, hand ranking,
# win/loss). This endpoint only asks the model to pick ONE action token from the
# exact legal list the client sends (fold/check/call/raise_half/raise_pot/all_in),
# mirroring chess/move's legal-SAN pick. An illegal/garbled reply returns a passive
# fallback so the game never stalls. The view is fog-limited (opponent's own hole
# cards + board only, never the human's) — local-first matchmaking invariant.


class PokerMoveRequest(BaseModel):
    view: dict                         # fog-limited PokerView (opaque to the server)
    legal_actions: list[str]
    model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


def _match_poker_action(raw: str, legal: list[str]) -> str | None:
    """Map a free-form model reply to one legal action token, or None.

    Accept an exact token first, then case-insensitive, then scan for any legal
    token appearing as a word in the reply (weak models wrap it in prose)."""
    if not raw:
        return None
    legal_ci = {a.lower(): a for a in legal}
    first = raw.strip().strip('."\'` ').split("\n")[0].strip().lower()
    if first in legal_ci:
        return legal_ci[first]
    for tk in _re.findall(r"[a-z_]+", raw.lower()):
        if tk in legal_ci:
            return legal_ci[tk]
    return None


@app.post("/game/poker/move")
def poker_move_endpoint(req: PokerMoveRequest):
    """Ask the model for the opponent's poker action; validate against the legal set.

    The client is the source of truth for legality and every chip amount — it sends
    the exact legal action tokens. We only pick one. On an illegal/unparseable reply
    we return a passive fallback (check > call > fold) so the hand never stalls."""
    legal = [a for a in (req.legal_actions or []) if isinstance(a, str) and a.strip()]
    if not legal:
        raise HTTPException(400, "no legal actions")

    def _passive() -> str:
        for a in ("check", "call", "fold"):
            if a in legal:
                return a
        return legal[0]

    fallback = _passive()
    model_id = _game_model_id(req.model_id)
    if not model_id:
        return {"action": fallback, "fallback": True, "reason": "no_model"}

    v = req.view or {}
    hole = ", ".join(v.get("hole") or []) or "?"
    board = ", ".join(v.get("board") or []) or "(none yet)"
    acts_str = ", ".join(legal)
    sys = (
        "You are a sharp, aggressive heads-up No-Limit Texas Hold'em player. Reply "
        "with EXACTLY ONE action token from the provided legal list and nothing "
        "else — no explanation, no punctuation. Play to win chips: value-bet strong "
        "hands, fold weak hands to big bets, and bluff occasionally. "
        "Tokens: check (no bet to face), call (match the bet), fold (give up the "
        "hand), raise_half (raise ~half pot), raise_pot (raise ~full pot), all_in "
        "(shove your whole stack)."
    )
    user = (
        f"Your hole cards: {hole}\n"
        f"Board: {board}\n"
        f"Street: {v.get('street', '?')}\n"
        f"Pot: {v.get('pot', 0)}  ·  To call: {v.get('toCall', 0)}\n"
        f"Your stack: {v.get('stackCpu', 0)}  ·  Opponent stack: {v.get('stackYou', 0)}\n"
        f"Legal actions (choose one): {acts_str}\n"
        "Your action:"
    )
    messages = [{"role": "system", "content": sys}, {"role": "user", "content": user}]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
        )
        raw = (result.get("text") or "").strip()
    except Exception as e:
        return {"action": fallback, "fallback": True, "reason": f"llm_error: {str(e)[:120]}"}
    action = _match_poker_action(raw, legal)
    if action is None:
        return {"action": fallback, "fallback": True, "reason": "illegal_or_unparsed", "raw": raw[:80]}
    return {"action": action, "fallback": False}


# ── Scrabble (you vs LLM) — lexicon oracle + opponent proposer ────────────────
# The client owns EVERY number (tile bag, board, racks, geometry, premiums, scoring,
# bingo, end-game). The model does only two things, both its core competence: (1)
# judge whether words are valid in the chosen language, and (2) propose its own play
# from its fog-limited rack. The client re-validates geometry + the dictionary on the
# proposal, so the model can never inflate a score or sneak a fake word. The view is
# fog-limited (opponent's own rack + board only) — local-first matchmaking invariant.

_SCRABBLE_DIR = {"H": "H", "V": "V", "HORIZONTAL": "H", "VERTICAL": "V", "ACROSS": "H", "DOWN": "V"}


class ScrabbleMoveRequest(BaseModel):
    view: dict                         # fog-limited ScrabbleView (opaque to the server)
    model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


class ScrabbleValidateRequest(BaseModel):
    words: list[str]
    lang: str | None = None
    model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


@app.post("/game/scrabble/move")
def scrabble_move_endpoint(req: ScrabbleMoveRequest):
    """Ask the model for the opponent's Scrabble play. Returns {word,row,col,dir} or
    {pass:true}. The client turns this into placements, re-validates geometry AND the
    dictionary, and falls back to exchange/pass on anything illegal — so a garbled or
    cheating reply never corrupts the board or the score."""
    model_id = _game_model_id(req.model_id)
    if not model_id:
        return {"pass": True, "fallback": True, "reason": "no_model"}

    v = req.view or {}
    lang_name = _LANG_NAMES.get((v.get("lang") or "en").lower(), "English")
    rack = " ".join(v.get("rack") or []) or "(empty)"
    board_rows = v.get("board") or []
    # Number the rows/cols so the model can address cells (0-indexed, matching the client).
    board_str = "\n".join(f"{i:>2} {row}" for i, row in enumerate(board_rows)) or "(empty board)"
    first = bool(v.get("firstMove"))
    sys = (
        f"You are a strong Scrabble player playing in {lang_name}. Build the highest-scoring "
        "legal word you can from your rack, hooking onto letters already on the board. "
        "Use '_' tiles as blanks (any letter, 0 points). Reply with ONLY a JSON object, no prose:\n"
        '{\"word\":\"<full word incl. board letters it passes through>\",\"row\":<0-14>,'
        '\"col\":<0-14>,\"dir\":\"H\"|\"V\"}\n'
        "row,col = the cell of the word's FIRST letter; H = left-to-right, V = top-to-bottom. "
        "The word string must spell out every cell it covers, including letters already on the "
        "board. If you cannot form any legal word, reply exactly {\"pass\":true}."
    )
    user = (
        f"Your rack: {rack}\n"
        f"Board (row index then 15 cells, '.' = empty):\n{board_str}\n"
        + ("This is the FIRST move: your word must cover the centre cell row 7, col 7.\n" if first else "")
        + "Your play (JSON only):"
    )
    messages = [{"role": "system", "content": sys}, {"role": "user", "content": user}]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
        )
        raw = (result.get("text") or "").strip()
    except Exception as e:
        return {"pass": True, "fallback": True, "reason": f"llm_error: {str(e)[:120]}"}
    obj = _extract_json(raw)
    if not isinstance(obj, dict):
        return {"pass": True, "fallback": True, "reason": "unparsed", "raw": raw[:80]}
    if obj.get("pass") is True or not obj.get("word"):
        return {"pass": True, "fallback": True, "reason": "model_pass"}
    word = str(obj.get("word") or "").strip()
    try:
        row = int(obj.get("row"))
        col = int(obj.get("col"))
    except (TypeError, ValueError):
        return {"pass": True, "fallback": True, "reason": "bad_coords", "raw": raw[:80]}
    direction = _SCRABBLE_DIR.get(str(obj.get("dir") or "H").strip().upper(), "H")
    return {"word": word, "row": row, "col": col, "dir": direction, "fallback": False}


@app.post("/game/scrabble/validate")
def scrabble_validate_endpoint(req: ScrabbleValidateRequest):
    """The lexicon oracle: are ALL the given words valid in the language? Fail-closed —
    no model, an error, or an unparseable reply → valid:false (the play is rejected and
    the tiles go back), so a flaky model can never wave through a fake word."""
    words = [w.strip() for w in (req.words or []) if isinstance(w, str) and w.strip()]
    if not words:
        return {"valid": False, "reason": "no_words"}
    model_id = _game_model_id(req.model_id)
    if not model_id:
        return {"valid": False, "reason": "no_model"}
    lang_name = _LANG_NAMES.get((req.lang or "en").lower(), "English")
    sys = (
        f"You are a {lang_name} Scrabble dictionary judge. You are given one or more words. "
        f"Answer YES only if EVERY word is a valid, standard {lang_name} word that would be "
        "accepted in Scrabble (common nouns, verbs, adjectives and their inflected forms; "
        "no proper nouns, no abbreviations, no hyphenated or multi-word entries). If ANY word "
        "is invalid, answer NO. Reply with ONLY the single word YES or NO."
    )
    user = "Words: " + ", ".join(words) + "\nAll valid?"
    messages = [{"role": "system", "content": sys}, {"role": "user", "content": user}]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
        )
        raw = (result.get("text") or "").strip().lower()
    except Exception as e:
        return {"valid": False, "reason": f"llm_error: {str(e)[:120]}"}
    # Fail-closed: accept only a clear affirmative. French "oui" tolerated too.
    head = raw.strip('."\'` *\n').split()[0] if raw.strip() else ""
    valid = head in ("yes", "oui", "y", "valid", "true")
    return {"valid": valid}


# ── RTS (Iron Marsh) — LLM enemy commander ───────────────────────────────────
# The client owns EVERY number (economy, power, tech, combat, win/loss) in its TS
# sim. This endpoint only asks the model for strategic INTENT: a small JSON plan
# {stance, buildPriority[], targets[], taunt}. We constrain it to a whitelist the
# client sends and validate the reply against it; an illegal/garbled answer returns
# the client's fallback plan so the AI never stalls. The world summary is fog-limited
# and nothing is persisted (local-first matchmaking invariant).


class RtsCommandRequest(BaseModel):
    world: dict                       # fog-limited RtsWorldView (opaque to the server)
    stances: list[str]                # whitelist of allowed stance strings
    roles: list[str]                  # whitelist of allowed build role ids
    targets: list[str]                # whitelist of allowed target categories
    personality: str | None = None    # flavour layer (aggressive / defensive / raider)
    lang: str | None = None
    model_id: str | None = None
    provider_mode: str | None = None
    provider_user_id: str | None = None
    llama_base_url: str | None = None
    llama_bearer_token: str | None = None


def _rts_fallback_plan(req: "RtsCommandRequest", reason: str) -> dict:
    """Deterministic plan the server hands back when the model can't be used. The
    client ALSO has its own fallback (authoritative); this just keeps the contract
    shape consistent with chess/move."""
    stance = "turtle" if "turtle" in req.stances else (req.stances[0] if req.stances else "turtle")
    return {"plan": {"stance": stance, "buildPriority": [], "targets": [], "taunt": ""},
            "fallback": True, "reason": reason}


@app.post("/game/rts/command")
def rts_command_endpoint(req: RtsCommandRequest):
    model_id = _game_model_id(req.model_id)
    if not model_id:
        return _rts_fallback_plan(req, "no_model")

    stances = ", ".join(req.stances) or "aggress, turtle, expand, raid, tech"
    roles = ", ".join(req.roles)
    targets = ", ".join(req.targets)
    persona = (req.personality or "a pragmatic").strip()
    sys = (
        "You are the enemy commander in a real-time strategy battle (Command & "
        "Conquer: Red Alert style), playing against a human. You are " + persona
        + " commander.\n\n"
        "HOW TO PLAY A COHERENT GAME (follow this order — do NOT build a random "
        "square block of buildings):\n"
        "1. ECONOMY FIRST. You need power, then ore income. Open with: power -> "
        "refinery -> barracks -> (second refinery) -> factory -> tech. Build each "
        "ONE at a time; never stack duplicates you don't need.\n"
        "2. POWER must stay ahead of consumption, or production slows and turrets "
        "shut off. If power looks tight, put 'power' first in buildPriority.\n"
        "3. ONE of each tech building is enough (1 barracks, 1 factory, 1 tech "
        "center). Two refineries is plenty. Do NOT request more of a building you "
        "already have unless it's defense.\n"
        "4. ARMY once the economy stands: list the UNIT ids you want next in "
        "buildPriority. Counter the human — infantry beats infantry, anti-tank and "
        "tanks beat vehicles, artillery breaks turtles, the elite walker is your "
        "hammer. Mix units; don't spam one type.\n"
        "5. DEFENSE only when turtling or under pressure (a couple of turrets), not "
        "as your whole base.\n"
        "6. ATTACK with 'targets' once you have an army: hit harvesters to starve "
        "them, power to blind them, then the base. Pick stance to match: 'aggress' "
        "to push, 'raid' to harass, 'expand'/'tech' to grow, 'turtle' to fortify.\n\n"
        "READ YOUR REPORT AND DECIDE (these fields drive the right call):\n"
        "- 'myArmyCount' is how many combat units you field. Small (0-3): keep "
        "building economy/army, stance 'expand' or 'tech'. Medium (4-8): start "
        "pressing with 'aggress' or 'raid'. LARGE (9+): you have a war machine "
        "sitting idle — go 'aggress' and commit it NOW. A big army that never "
        "attacks is a wasted army; do not keep stockpiling forever.\n"
        "- 'creditsFull' true means your bank is nearly capped and income is being "
        "WASTED. Spend it: queue more/expensive units and push. Never hoard credits.\n"
        "- 'enemyBaseFound' true means you know where the human base is — pick "
        "'aggress' with targets ['enemyBase'] and finish them. False means you "
        "haven't found it: keep an aggressive/raid stance so your troops advance and "
        "scout toward them instead of camping.\n"
        "- 'scoutedEnemy' is what you actually see; counter it (lots of their tanks "
        "-> build anti-tank/artillery; lots of infantry -> your own infantry/turrets).\n"
        "- The engine AUTO-maintains your harvesters and minimum power, so spend your "
        "buildPriority mostly on ARMY plus the single next key building.\n\n"
        "buildPriority is your SHORTLIST of what to build NEXT (3-6 ids, best first), "
        "NOT your whole base — the engine already enforces the order and counts above. "
        "Just tell it your current intent for this moment of the game.\n\n"
        "Reply with EXACTLY ONE JSON object and nothing else — no prose, no code "
        "fence. Shape:\n"
        '{"stance": <one of the stances>, "buildPriority": [<role ids, best first>], '
        '"targets": [<target ids, best first>], "taunt": <one short in-character line>}\n'
        f"stance MUST be one of: {stances}.\n"
        f"buildPriority items MUST come from: {roles}.\n"
        f"targets items MUST come from: {targets}.\n"
        "Read your fog-limited situation report, decide the single best next move, "
        "and keep the taunt short and in character."
        + _lang_clause(req.lang)
    )
    user = "Situation report (JSON):\n" + json.dumps(req.world, ensure_ascii=False) + "\nYour command:"
    messages = [{"role": "system", "content": sys}, {"role": "user", "content": user}]
    try:
        result = llm_mod.chat(
            messages,
            model_id=model_id,
            tools=None,
            force_tool=False,
            provider_mode=req.provider_mode,
            provider_user_id=req.provider_user_id,
            llama_base_url=req.llama_base_url,
            llama_bearer_token=req.llama_bearer_token,
        )
        raw = (result.get("text") or "").strip()
    except Exception as e:
        return _rts_fallback_plan(req, f"llm_error: {str(e)[:120]}")

    obj = _extract_json(raw)
    if not isinstance(obj, dict):
        return _rts_fallback_plan(req, "unparseable")

    # Server-side whitelist filtering (the client re-validates authoritatively).
    stance = obj.get("stance")
    if stance not in req.stances:
        return _rts_fallback_plan(req, "bad_stance")
    role_set, target_set = set(req.roles), set(req.targets)
    build_priority = [r for r in obj.get("buildPriority", []) if isinstance(r, str) and r in role_set]
    plan_targets = [t for t in obj.get("targets", []) if isinstance(t, str) and t in target_set]
    taunt = obj.get("taunt")
    taunt = taunt[:160] if isinstance(taunt, str) else ""
    return {"plan": {"stance": stance, "buildPriority": build_priority,
                     "targets": plan_targets, "taunt": taunt}, "fallback": False}


def _extract_json(raw: str):
    """Pull a JSON object out of an LLM reply (handles code fences + prose)."""
    if not raw:
        return None
    s = raw.strip()
    m = _re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, _re.S)
    if m:
        s = m.group(1)
    i, j = s.find("{"), s.rfind("}")
    if i == -1 or j == -1 or j < i:
        return None
    blob = s[i:j + 1]
    try:
        return json.loads(blob)
    except Exception:
        pass
    # Small models often emit trailing commas; strip them and retry.
    try:
        return json.loads(_re.sub(r",\s*([}\]])", r"\1", blob))
    except Exception:
        return None


@app.post("/approve")
def approve_endpoint(req: ApprovalDecisionRequest):
    from monkey import approvals as _approvals
    ok = _approvals.STORE.resolve(req.id, req.decision, req.scope)
    if req.decision == "allow" and req.scope == "session" and req.tool:
        _approvals.STORE.allow_session(req.session_id, req.tool)
    return {"ok": ok}


# ── Models ────────────────────────────────────────────────────────────────────

_MODELS_CACHE: list = []
_MODELS_CACHE_TIME: float = 0.0
_MODELS_CACHE_TTL = 6 * 3600  # 6 hours
_MODELS_LOCK = threading.Lock()


def _fetch_models_raw(token: str) -> list:
    """Fetch and flatten models from backend."""
    headers = {}
    if token:
        headers["Cookie"] = f"token={token}"
    resp = httpx.get(f"{BACKEND_URL}/api/models", headers=headers, timeout=8)
    if resp.status_code != 200:
        return []
    data = resp.json()
    flat = []
    if isinstance(data, dict) and "categories" in data:
        for cat, models in data["categories"].items():
            for m in models:
                if m.get("supportsTools") is False:
                    continue
                m.setdefault("category", cat)
                flat.append(m)
    elif isinstance(data, list):
        flat = [m for m in data if m.get("supportsTools") is not False]
    return flat


def _refresh_models():
    """Fetch models from backend catalog. No health-check — trust the catalog."""
    global _MODELS_CACHE, _MODELS_CACHE_TIME
    token = store.get("TOKEN") or ""
    try:
        flat = _fetch_models_raw(token)
        if not flat:
            return
        with _MODELS_LOCK:
            _MODELS_CACHE = flat
            _MODELS_CACHE_TIME = time.time()
    except Exception:
        pass


@app.get("/models")
def get_models():
    global _MODELS_CACHE, _MODELS_CACHE_TIME
    with _MODELS_LOCK:
        age = time.time() - _MODELS_CACHE_TIME
        cached = list(_MODELS_CACHE)
    if age > _MODELS_CACHE_TTL or not cached:
        threading.Thread(target=_refresh_models, daemon=True).start()
        if not cached:
            try:
                token = store.get("TOKEN") or ""
                flat = _fetch_models_raw(token)
                with _MODELS_LOCK:
                    _MODELS_CACHE = flat
                    _MODELS_CACHE_TIME = time.time()
                cached = flat
            except Exception:
                cached = []
    return list(cached) + custom_ep.list_catalog_entries_chat() + _waaagh_catalog_entries()


def _waaagh_catalog_entries() -> list[dict]:
    """Local WAAAGH-Net family (Orkish nGPT base model), served via scripts/serve.py.

    Only advertised when its OpenAI-compatible server is reachable, so the model
    list stays honest about what can actually answer.
    """
    base = os.getenv("WAAAGH_BASE_URL", "http://127.0.0.1:8088")
    try:
        r = httpx.get(f"{base}/v1/models", timeout=1.5)
        if r.status_code >= 400:
            return []
        ids = [m.get("id") for m in (r.json().get("data") or []) if m.get("id")]
    except Exception:
        return []
    return [{
        "id": mid,
        "name": "Grot-80M (WAAAGH)",
        "category": "Local",
        "family": "WAAAGH",
        "provider": "waaagh",
        "endpointLabel": "local nGPT",
        "supportsTools": True,
        "supportsVision": False,
        "supportsAudioInput": False,
        "inputCostPer1MTokensCents": 0,
        "outputCostPer1MTokensCents": 0,
    } for mid in ids]


class CustomEndpointsPayload(BaseModel):
    endpoints: list[dict]


@app.get("/custom-endpoints")
def list_custom_endpoints():
    return {"endpoints": custom_ep.list_endpoints()}


@app.post("/custom-endpoints")
def set_custom_endpoints(payload: CustomEndpointsPayload):
    custom_ep.replace_all(payload.endpoints)
    return {"ok": True, "count": len(custom_ep.list_endpoints())}


# ── Image models ──────────────────────────────────────────────────────────────

IMAGE_MODELS = [
    {"id": "black-forest-labs/flux-schnell",    "name": "Flux Schnell (rapide)",     "default": True},
    {"id": "black-forest-labs/flux-1-pro",       "name": "Flux 1 Pro",                "default": False},
    {"id": "black-forest-labs/flux-1.1-pro",     "name": "Flux 1.1 Pro",              "default": False},
    {"id": "black-forest-labs/flux-pro-ultra",   "name": "Flux Pro Ultra",            "default": False},
    {"id": "openai/gpt-5-image-mini",            "name": "GPT-5 Image Mini",          "default": False},
    {"id": "openai/gpt-5-image",                 "name": "GPT-5 Image",               "default": False},
    {"id": "google/gemini-2.5-flash-image",      "name": "Gemini 2.5 Flash Image",    "default": False},
    {"id": "stabilityai/stable-diffusion-xl",    "name": "Stable Diffusion XL",       "default": False},
]

@app.get("/image-models")
def get_image_models():
    return IMAGE_MODELS + custom_ep.list_catalog_entries_for("image")


# ── Music models ──────────────────────────────────────────────────────────────

MUSIC_MODELS = [
    {"id": "google/lyria-3-clip-preview", "name": "Lyria 3 Clip (~30s, ~4¢)",  "default": True},
    {"id": "google/lyria-3-pro-preview",  "name": "Lyria 3 Pro (full song, ~8¢)", "default": False},
]

@app.get("/music-models")
def get_music_models():
    return MUSIC_MODELS + custom_ep.list_catalog_entries_for("music")


# ── Video models ──────────────────────────────────────────────────────────────

VIDEO_MODELS = [
    {"id": "kwaivgi/kling-video-o1", "name": "Kling O1 (5-10s, ~11¢/s)", "default": True},
    {"id": "google/veo-3.1-lite", "name": "Veo 3.1 Lite (cheap, ~5¢/s)", "default": False},
    {"id": "google/veo-3.1-fast", "name": "Veo 3.1 Fast (~10¢/s)", "default": False},
    {"id": "google/veo-3.1", "name": "Veo 3.1 (premium, ~40¢/s)", "default": False},
    {"id": "kwaivgi/kling-video-v3.0-standard", "name": "Kling v3.0 Standard (~13¢/s)", "default": False},
    {"id": "kwaivgi/kling-video-v3.0-pro", "name": "Kling v3.0 Pro (~17¢/s)", "default": False},
    {"id": "alibaba/wan-2.6", "name": "Wan 2.6 (~4¢/s)", "default": False},
    {"id": "minimax/hailuo-2.3", "name": "Hailuo 2.3 (~9¢/s)", "default": False},
    {"id": "openai/sora-2-pro", "name": "Sora 2 Pro (premium, ~30¢/s)", "default": False},
]

@app.get("/video-models")
def get_video_models():
    return VIDEO_MODELS + custom_ep.list_catalog_entries_for("video")


class ImageRequest(BaseModel):
    prompt: str
    model_id: str = "black-forest-labs/flux-schnell"
    path: str = ""
    size: str = "1024x1024"

@app.post("/generate-image")
def generate_image_endpoint(req: ImageRequest):
    from monkey.tools.image import generate_image
    result = generate_image(req.prompt, req.path, req.model_id, req.size)
    return {"result": result}


# ── Memory / Sessions ─────────────────────────────────────────────────────────

try:
    with open(SESSIONS_FILE, "r") as f:
        SESSIONS: dict = json.load(f)
except Exception:
    SESSIONS = {}


def _save_sessions():
    with open(SESSIONS_FILE, "w") as f:
        json.dump(SESSIONS, f)


@app.get("/memory/sessions")
def list_sessions():
    return list(SESSIONS.values())


@app.post("/memory/sessions")
def save_session(session: dict):
    sid = session.get("id") or str(uuid.uuid4())
    session["id"] = sid
    session["updatedAt"] = datetime.datetime.utcnow().isoformat() + "Z"
    SESSIONS[sid] = session
    _save_sessions()
    return {"ok": True, "session": session}


@app.get("/tasks")
def list_tasks():
    return TASK_STORE.list_tasks()


@app.get("/tasks/upcoming")
def list_upcoming_tasks(limit: int = 20):
    return TASK_STORE.list_upcoming(limit=limit)


@app.post("/tasks")
def create_task(req: TaskCreateRequest):
    try:
        task = TASK_STORE.create_task(_model_to_dict(req))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "task": task}


@app.put("/tasks/{task_id}")
def update_task(task_id: str, req: TaskUpdateRequest):
    try:
        task = TASK_STORE.update_task(task_id, _model_to_dict(req, exclude_unset=True))
    except KeyError:
        raise HTTPException(404, "Task not found")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "task": task}


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    try:
        TASK_STORE.delete_task(task_id)
    except KeyError:
        raise HTTPException(404, "Task not found")
    return {"ok": True}


@app.post("/recurrence/preview")
def recurrence_preview(req: RecurrencePreviewRequest):
    try:
        items = preview_recurrence(
            req.recurrence,
            req.scheduledFor,
            n=max(1, min(20, req.count)),
            until_iso=req.recurrenceUntil,
            count=req.recurrenceCount,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "occurrences": items}


@app.get("/memory/profile")
def get_profile():
    return {"profile": mem_mod.get_profile_summary(), "facts": mem_mod.get_facts()}


@app.post("/memory/fact")
def add_fact(body: dict):
    key = body.get("key", "")
    value = body.get("value", "")
    if not key or len(key) > 100:
        raise HTTPException(400, "key must be 1-100 chars")
    if len(value) > 5000:
        raise HTTPException(400, "value max 5000 chars")
    mem_mod.upsert_fact(key, value)
    return {"ok": True}


@app.get("/memory/atoms")
def memory_atoms(limit: int = 50, q: str | None = None):
    """Unified library feed: facts + free notes + session summaries."""
    return {"items": mem_mod.list_atoms(limit=max(1, min(limit, 200)), q=q)}


@app.post("/memory/note")
def memory_add_note(body: dict):
    content = str(body.get("content", "")).strip()
    if not content:
        raise HTTPException(400, "content required")
    if len(content) > 5000:
        raise HTTPException(400, "content max 5000 chars")
    tags = body.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    nid = mem_mod.add_note(content, tags=[str(t) for t in tags], session_id=str(body.get("session_id") or ""))
    return {"ok": True, "id": f"note:{nid}"}


@app.post("/memory/archive")
def memory_archive(body: dict):
    atom_id = str(body.get("id", ""))
    ok = mem_mod.archive_atom(atom_id)
    return {"ok": ok}


@app.post("/memory/summarize")
def memory_summarize(body: dict):
    """Summarize and group all memory atoms into themed markdown synthesis.

    Body: { model_id?: string, limit?: int }
    Returns: { summary: str, count: int }
    """
    model_id = (body.get("model_id") or "").strip() or None
    limit = int(body.get("limit") or 200)
    atoms = mem_mod.list_atoms(limit=max(1, min(limit, 500)))
    if not atoms:
        return {"summary": "_(aucun souvenir à résumer)_", "count": 0}
    lines = []
    for a in atoms:
        t = a.get("type") or "atom"
        c = (a.get("content") or "").replace("\n", " ").strip()
        if len(c) > 400:
            c = c[:400] + "…"
        lines.append(f"- [{t}] {c}")
    corpus = "\n".join(lines)
    prompt = (
        "Tu reçois la mémoire locale d'un utilisateur (faits de profil, notes libres, "
        "résumés de sessions). Produis une synthèse markdown concise:\n"
        "1. Regroupe par thème (## Titres de section).\n"
        "2. Sous chaque thème, bullet points fusionnant les doublons.\n"
        "3. Termine par '## Doublons / à archiver' listant les souvenirs redondants ou obsolètes.\n"
        "Pas de blabla, pas d'introduction, markdown direct.\n\n"
        f"MÉMOIRE ({len(atoms)} items):\n{corpus}"
    )
    try:
        result = llm_mod.chat(
            [{"role": "user", "content": prompt}],
            model_id=model_id,
        )
        summary = (result.get("text") or "").strip()
    except Exception as e:
        raise HTTPException(500, f"summarize failed: {e}")
    return {"summary": summary or "_(synthèse vide)_", "count": len(atoms)}


# ── Workspace ─────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    try:
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_config(cfg: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f)


def get_workspace() -> str:
    ws = _load_config().get("workspace", DEFAULT_WORKSPACE)
    os.makedirs(ws, exist_ok=True)
    return ws


# ── Local models ─────────────────────────────────────────────────────────────
# Catalogue of on-device small models. Each installable model becomes one
# agent tool exposed automatically — see monkey/local_models/__init__.py.

@app.get("/local-models")
def local_models_list():
    from monkey.local_models import registry as _reg
    return {"models": _reg.list_state()}


@app.post("/local-models/{model_id}/download")
def local_models_download(model_id: str):
    from monkey.local_models import download as _dl
    import json as _json

    def _gen():
        for ev in _dl.download(model_id):
            yield f"data: {_json.dumps(ev)}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_BG_INSTALLS: dict[str, threading.Thread] = {}


@app.post("/local-models/{model_id}/install")
def local_models_install(model_id: str):
    """Fire-and-forget install. Drains the download generator on a background
    thread so the generator's post-loop `write_meta` runs even if the HTTP
    client disconnects. Poll /local-models/{id}/status to know when done."""
    from monkey.local_models import download as _dl, registry as _reg
    if _reg.is_installed(model_id):
        return {"ok": True, "already_installed": True}
    existing = _BG_INSTALLS.get(model_id)
    if existing and existing.is_alive():
        return {"ok": True, "running": True}

    def _drain():
        try:
            for _ in _dl.download(model_id):
                pass
        except Exception:
            pass

    t = threading.Thread(target=_drain, name=f"install-{model_id}", daemon=True)
    t.start()
    _BG_INSTALLS[model_id] = t
    return {"ok": True, "started": True}


@app.delete("/local-models/{model_id}")
def local_models_delete(model_id: str):
    from monkey.local_models import registry as _reg
    ok = _reg.remove(model_id)
    if not ok:
        raise HTTPException(404, "model not installed or not removable")
    return {"ok": True}


@app.post("/local-models/{model_id}/load")
def local_models_load(model_id: str):
    """Pre-warm a model into RAM. Useful to avoid first-call latency."""
    from monkey.local_models import runtime as _rt
    try:
        _rt.get(model_id)
        return {"ok": True, "loaded": _rt.loaded_ids()}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/local-models/{model_id}/unload")
def local_models_unload(model_id: str):
    from monkey.local_models import runtime as _rt
    _rt.unload(model_id)
    return {"ok": True, "loaded": _rt.loaded_ids()}


@app.get("/local-models/{model_id}/status")
def local_models_status(model_id: str):
    from monkey.local_models import download as _dl, registry as _reg, runtime as _rt
    return {
        "installed": _reg.is_installed(model_id),
        "loaded": _rt.is_loaded(model_id),
        "download": _dl.status(model_id),
    }


@app.post("/local-models/{model_id}/embed")
def local_models_embed(model_id: str, body: dict):
    """Embed a batch of texts with an installed local embed-task model.

    Used by the desktop KB when the user picks a local embedding model.
    Returns {dim, vectors}. Errors mapped to 4xx with ERREUR: prefix preserved.
    """
    import json as _json
    from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt
    spec = _cat.by_id(model_id)
    if spec is None:
        raise HTTPException(404, f"unknown model: {model_id}")
    if spec.get("task") != "embed":
        raise HTTPException(400, f"model {model_id} is not an embed-task model")
    if not _reg.is_installed(model_id):
        raise HTTPException(409, f"ERREUR: local model not installed: {model_id}")
    texts = body.get("texts") or body.get("input") or []
    if not isinstance(texts, list) or not texts:
        raise HTTPException(400, "texts (non-empty list) required")
    prefix = body.get("prefix")
    args = {"texts": [str(t) for t in texts]}
    if prefix:
        args["prefix"] = str(prefix)
    out = _lmt.dispatch_local(spec["tool_name"], args)
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        data = _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")
    return {"dim": data.get("dim", 0), "vectors": data.get("vectors", [])}


@app.post("/local-tts")
def local_tts(body: dict):
    """Synthesize speech via the first installed TTS model (Piper).

    Args: text (str, required), voice (str, optional 'fr'|'en'|...).
    Returns the adapter JSON: {audio_path, voice, bytes, format}. The desktop
    Test button uses this to verify the TTS modality with audible output.
    """
    import json as _json
    from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text required")
    tts_specs = _cat.by_task("tts")
    spec = next((s for s in tts_specs if _reg.is_installed(s["id"])), None)
    if spec is None:
        raise HTTPException(409, "ERREUR: no TTS model installed (install Piper from Settings → Local models)")
    args = {"text": text}
    if body.get("voice"):
        args["voice"] = str(body["voice"])
    out = _lmt.dispatch_local(spec["tool_name"], args)
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        data = _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")
    audio_path = data.get("audio_path")
    if audio_path and os.path.exists(audio_path):
        import base64 as _b64
        try:
            with open(audio_path, "rb") as f:
                data["audio_b64"] = _b64.b64encode(f.read()).decode("ascii")
        except Exception:
            pass
    return data


@app.post("/local-image")
def local_image(body: dict):
    """Generate an image via the first installed image_gen model (FLUX).

    Args: prompt (str, required), size (str), seed (int), steps (int).
    Returns adapter JSON + image_b64 (PNG) so the desktop can render inline
    without filesystem scope wrangling.
    """
    import json as _json
    from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")
    specs = _cat.by_task("image_gen")
    spec = next((s for s in specs if _reg.is_installed(s["id"])), None)
    if spec is None:
        raise HTTPException(409, "ERREUR: no image_gen model installed (install FLUX from Settings -> Local models)")
    args: dict = {"prompt": prompt}
    if body.get("size"):
        args["size"] = str(body["size"])
    if body.get("seed") is not None:
        args["seed"] = body["seed"]
    if body.get("steps") is not None:
        args["steps"] = body["steps"]
    out = _lmt.dispatch_local(spec["tool_name"], args)
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        data = _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")
    image_path = data.get("image_path")
    if image_path and os.path.exists(image_path):
        import base64 as _b64
        try:
            with open(image_path, "rb") as f:
                data["image_b64"] = _b64.b64encode(f.read()).decode("ascii")
        except Exception:
            pass
    return data


@app.post("/image-to-3d")
def image_to_3d(body: dict):
    """Convert a 2D image into a 3D object (Gaussian splats, .ply) via the
    first installed image_to_3d model (TripoSplat).

    Args: image_path (str, absolute) OR image_b64 (str); gaussians (int, opt).

    Streams SSE: {"event":"progress","elapsed":n} heartbeats every 3s while the
    conversion runs (WKWebView kills idle fetches at ~60s and a conversion takes
    minutes), then one final {"event":"done", output_path, format, bytes,
    gaussians} or {"event":"error","message"}. The .ply can be large, so we
    return the on-disk path (no base64 by default).
    """
    import base64 as _b64
    import json as _json
    import tempfile as _tmp
    from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt
    specs = _cat.by_task("image_to_3d")
    spec = next((s for s in specs if _reg.is_installed(s["id"])), None)
    if spec is None:
        raise HTTPException(409, "ERREUR: no image_to_3d model installed (install TripoSplat from Background -> 2D -> 3D)")
    image_path = (body.get("image_path") or "").strip()
    if not image_path:
        b64 = body.get("image_b64")
        if not b64:
            raise HTTPException(400, "image_path or image_b64 required")
        try:
            raw = _b64.b64decode(b64)
        except Exception as e:
            raise HTTPException(400, f"invalid image_b64: {e}")
        tmp_dir = os.path.join(_tmp.gettempdir(), "monkey-3d-in")
        os.makedirs(tmp_dir, exist_ok=True)
        # Keep the original filename stem: the adapter names the output .ply
        # after the input file, which is what the asset list displays.
        import re as _re
        stem = _re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.splitext(str(body.get("name") or ""))[0])[:40].strip("._-")
        image_path = os.path.join(tmp_dir, f"{stem or 'in-' + str(os.getpid())}-{int(time.time())}.png")
        with open(image_path, "wb") as f:
            f.write(raw)
    elif not os.path.exists(image_path):
        raise HTTPException(400, f"file not found: {image_path}")
    # Output dir: <workspace>/3d/ — visible to the user, not a hidden dot-folder.
    out_dir = os.path.join(get_workspace(), "3d")
    os.makedirs(out_dir, exist_ok=True)
    args: dict = {"image_path": image_path, "out_dir": out_dir}
    if body.get("gaussians") is not None:
        args["gaussians"] = body["gaussians"]

    def _gen():
        result: dict = {}

        def _work():
            try:
                result["out"] = _lmt.dispatch_local(spec["tool_name"], args)
            except Exception as e:
                result["out"] = f"ERREUR: conversion crashed: {e}"

        t = threading.Thread(target=_work, daemon=True)
        t.start()
        start = time.time()
        while t.is_alive():
            t.join(3.0)
            if t.is_alive():
                yield f"data: {_json.dumps({'event': 'progress', 'elapsed': int(time.time() - start)})}\n\n"
        out = result.get("out") or "ERREUR: conversion produced no result"
        if out.startswith("ERREUR:"):
            yield f"data: {_json.dumps({'event': 'error', 'message': out})}\n\n"
            return
        try:
            payload = _json.loads(out)
        except Exception as e:
            yield f"data: {_json.dumps({'event': 'error', 'message': f'adapter returned non-JSON: {e}'})}\n\n"
            return
        yield f"data: {_json.dumps({'event': 'done', **payload})}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/3d-assets")
def list_3d_assets():
    """List generated 3D assets (.ply) from <workspace>/3d/, newest first.
    Powers the asset library in Background -> 2D -> 3D."""
    out_dir = os.path.join(get_workspace(), "3d")
    assets = []
    try:
        for entry in os.scandir(out_dir):
            if entry.is_file() and entry.name.endswith(".ply"):
                st = entry.stat()
                assets.append({
                    "name": entry.name,
                    "path": entry.path,
                    "bytes": st.st_size,
                    "mtime": int(st.st_mtime),
                })
    except FileNotFoundError:
        pass
    assets.sort(key=lambda a: a["mtime"], reverse=True)
    return {"assets": assets}


@app.get("/local-image/progress")
def local_image_progress():
    """Live progress for the in-flight FLUX job (single global slot).

    Returns 404 when no job is running. Payload fields: stage, step, total,
    elapsed, prompt, width, height, steps (subset depending on stage).
    """
    from monkey.local_models import progress as _p
    data = _p.read()
    if not data:
        raise HTTPException(404, "no image generation in progress")
    return data


# ─────────────────────────────────────────────────────────────────────────────
# P2P provider endpoints — called by the local provider-runtime (Rust) after
# it has decrypted a Noise tunnel payload. Sidecar binds to 127.0.0.1 only, so
# these are not auth-gated: the only legitimate caller is the co-located
# runtime process. The runtime never reaches Ollama for these tasks; we hold
# the ONNX/system adapters here.
#
# Request shape mirrors what the desktop client sends over Noise:
#   /p2p/ocr             {image_b64: str, lang?: str}
#   /p2p/sentiment       {text: str}
#   /p2p/image_classify  {image_b64: str, top_k?: int}
#
# Return shape is the adapter's native JSON (forwarded verbatim by the
# runtime to the client over Noise).
# ─────────────────────────────────────────────────────────────────────────────

def _decode_b64_to_tmp(b64_data: str, suffix: str) -> str:
    """Decode base64 image bytes to a tempfile, return its absolute path.
    Caller is responsible for unlinking when done."""
    import base64 as _b64
    import tempfile
    try:
        raw = _b64.b64decode(b64_data, validate=False)
    except Exception as e:
        raise HTTPException(400, f"image_b64 decode failed: {e}")
    if not raw:
        raise HTTPException(400, "image_b64 is empty")
    fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="monkey-p2p-")
    with os.fdopen(fd, "wb") as f:
        f.write(raw)
    return tmp


@app.post("/p2p/ocr")
def p2p_ocr(body: dict):
    from monkey.local_models import registry as _reg, tools as _lmt
    if not (_reg.is_installed("paddle-ocr-v4") or _reg.is_installed("tesseract")):
        raise HTTPException(409, "ERREUR: no OCR engine installed on this provider (need paddle-ocr-v4 or tesseract)")
    image_b64 = body.get("image_b64")
    if not image_b64:
        raise HTTPException(400, "image_b64 required")
    tmp = _decode_b64_to_tmp(image_b64, ".png")
    try:
        args = {"image_path": tmp}
        if body.get("lang"):
            args["lang"] = str(body["lang"])
        hints = body.get("hints")
        if isinstance(hints, dict) and hints:
            args["hints"] = hints
        out = _lmt.dispatch_local("local_ocr", args)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    # OCR adapter returns the raw extracted text (not JSON). Wrap for the wire.
    return {"text": out}


@app.post("/p2p/sentiment")
def p2p_sentiment(body: dict):
    import json as _json
    from monkey.local_models import registry as _reg, tools as _lmt
    if not _reg.is_installed("xlm-sentiment"):
        raise HTTPException(409, "ERREUR: xlm-sentiment not installed on this provider")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text required")
    out = _lmt.dispatch_local("local_sentiment", {"text": text})
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        return _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")


@app.post("/p2p/image_classify")
def p2p_image_classify(body: dict):
    import json as _json
    from monkey.local_models import registry as _reg, tools as _lmt
    if not _reg.is_installed("vit-image-classify"):
        raise HTTPException(409, "ERREUR: vit-image-classify not installed on this provider")
    image_b64 = body.get("image_b64")
    if not image_b64:
        raise HTTPException(400, "image_b64 required")
    tmp = _decode_b64_to_tmp(image_b64, ".png")
    try:
        args = {"image_path": tmp}
        if body.get("top_k") is not None:
            args["top_k"] = int(body["top_k"])
        out = _lmt.dispatch_local("local_image_classify", args)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        return _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")


@app.post("/local-transcribe")
def local_transcribe(body: dict):
    """Transcribe audio via the first installed ASR model (Whisper).

    Args: audio_path (str, absolute) OR audio_b64 (str, raw bytes of WAV/MP3/...).
    Optional: language (str ISO code), selftest (bool — synthesize a known
    phrase via TTS first, then transcribe own output for end-to-end check).
    Returns adapter JSON: {text, language, duration, segments}. When selftest
    is set, the response also carries {tts_audio_path, expected_text}.
    """
    import base64 as _b64
    import json as _json
    import tempfile
    from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt

    asr_specs = _cat.by_task("asr")
    asr_spec = next((s for s in asr_specs if _reg.is_installed(s["id"])), None)
    if asr_spec is None:
        raise HTTPException(409, "ERREUR: no ASR model installed (install Whisper from Settings → Local models)")

    expected_text = None
    tts_audio_path = None

    if body.get("selftest"):
        expected_text = (body.get("text") or "Bonjour, je suis Monkey. Test de synthese vocale locale.").strip()
        tts_specs = _cat.by_task("tts")
        tts_spec = next((s for s in tts_specs if _reg.is_installed(s["id"])), None)
        if tts_spec is None:
            raise HTTPException(409, "ERREUR: selftest needs a TTS model (install Piper from Settings → Local models)")
        tts_out = _lmt.dispatch_local(tts_spec["tool_name"], {"text": expected_text})
        if tts_out.startswith("ERREUR:"):
            raise HTTPException(400, tts_out)
        try:
            tts_json = _json.loads(tts_out)
        except Exception as e:
            raise HTTPException(500, f"TTS adapter returned non-JSON: {e}")
        tts_audio_path = tts_json.get("audio_path")
        if not tts_audio_path:
            raise HTTPException(500, "TTS adapter returned no audio_path")
        audio_path = tts_audio_path
    else:
        audio_path = (body.get("audio_path") or "").strip()
        if not audio_path and body.get("audio_b64"):
            try:
                raw = _b64.b64decode(body["audio_b64"])
            except Exception as e:
                raise HTTPException(400, f"audio_b64 decode failed: {e}")
            fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="monkey-transcribe-")
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
            audio_path = tmp
        if not audio_path:
            raise HTTPException(400, "audio_path or audio_b64 or selftest required")

    args = {"audio_path": audio_path}
    if body.get("language"):
        args["language"] = str(body["language"])
    out = _lmt.dispatch_local(asr_spec["tool_name"], args)
    if out.startswith("ERREUR:"):
        raise HTTPException(400, out)
    try:
        data = _json.loads(out)
    except Exception as e:
        raise HTTPException(500, f"adapter returned non-JSON: {e}")
    if expected_text is not None:
        data["expected_text"] = expected_text
        data["tts_audio_path"] = tts_audio_path
    return data


@app.get("/workspace")
def workspace_get():
    return {"path": get_workspace()}


@app.post("/workspace")
def workspace_set(body: dict):
    raw = body.get("path", "").strip()
    if not raw:
        raise HTTPException(400, "path required")
    resolved = os.path.expanduser(raw)
    if not os.path.isabs(resolved):
        raise HTTPException(400, "path must be absolute")
    os.makedirs(resolved, exist_ok=True)
    cfg = _load_config()
    cfg["workspace"] = resolved
    _save_config(cfg)
    return {"path": resolved}


def _tool_ok_or_400(result: str) -> str:
    if result.startswith(("Error:", "ERREUR:")):
        raise HTTPException(400, result)
    return result


def _extract_arrow_path(result: str) -> str:
    if "→" not in result:
        raise HTTPException(500, result)
    return result.split("→", 1)[1].strip()


@app.post("/browser/navigate")
def browser_navigate_endpoint(req: BrowserNavigateRequest):
    from monkey.tools.web import browser_navigate
    return browser_navigate(req.url)


@app.get("/browser/text")
def browser_text_endpoint(selector: str = ""):
    from monkey.tools.web import browser_get_text
    return {"text": _tool_ok_or_400(browser_get_text(selector))}


@app.get("/browser/links")
def browser_links_endpoint(limit: int = Query(30, ge=1, le=100)):
    from monkey.tools.web import browser_get_links
    return {"links": _tool_ok_or_400(browser_get_links(limit))}


@app.post("/browser/click")
def browser_click_endpoint(req: BrowserClickRequest):
    from monkey.tools.web import browser_click
    return {"result": _tool_ok_or_400(browser_click(req.selector))}


@app.post("/browser/fill")
def browser_fill_endpoint(req: BrowserFillRequest):
    from monkey.tools.web import browser_fill
    return {"result": _tool_ok_or_400(browser_fill(req.selector, req.value))}


@app.post("/browser/scroll")
def browser_scroll_endpoint(req: BrowserScrollRequest):
    from monkey.tools.web import browser_scroll
    return {"result": _tool_ok_or_400(browser_scroll(req.direction, req.amount))}


@app.post("/browser/run-js")
def browser_run_js_endpoint(req: BrowserRunJsRequest):
    from monkey.tools.web import browser_run_js
    return {"result": _tool_ok_or_400(browser_run_js(req.code))}


@app.post("/browser/screenshot")
def browser_screenshot_endpoint():
    from monkey.tools.web import browser_screenshot
    result = _tool_ok_or_400(browser_screenshot())
    return {"path": _extract_arrow_path(result)}


@app.post("/browser/wait-for")
def browser_wait_for_endpoint(req: BrowserWaitRequest):
    from monkey.tools.web import browser_wait_for
    return {"result": _tool_ok_or_400(browser_wait_for(req.selector, req.timeout_ms))}


@app.post("/browser/back")
def browser_back_endpoint():
    from monkey.tools.web import browser_navigate_back
    return {"result": _tool_ok_or_400(browser_navigate_back())}


@app.get("/browser/current-url")
def browser_current_url_endpoint():
    from monkey.tools.web import browser_current_url
    return {"url": _tool_ok_or_400(browser_current_url())}


@app.get("/browser/clean-text")
def browser_clean_text_endpoint(max_chars: int = Query(8000, ge=100, le=200000)):
    from monkey.tools.web import browser_get_clean_text
    return {"text": _tool_ok_or_400(browser_get_clean_text(max_chars))}


# ── Web (search + fetch via stealth browser) ──────────────────────────────────

@app.post("/web/search")
def web_search_endpoint(req: WebSearchRequest):
    from monkey.tools.web import search_web
    if not req.query.strip():
        raise HTTPException(400, "query required")
    return {"results": search_web(req.query, req.max_results)}


@app.post("/web/search-and-read")
def web_search_and_read_endpoint(req: WebSearchAndReadRequest):
    from monkey.tools.web import search_and_read
    if not req.query.strip():
        raise HTTPException(400, "query required")
    return {"text": _tool_ok_or_400(search_and_read(req.query, req.max_pages))}


# ── Knowledge base (sidecar mirror of desktop docs) ───────────────────────────

class KbIngestRequest(BaseModel):
    title: str = ""
    text: str
    source: str = ""
    tags: list[str] = []

class KbSearchRequest(BaseModel):
    query: str
    top_k: int = 5


@app.post("/kb/ingest")
def kb_ingest_endpoint(req: KbIngestRequest):
    from monkey import kb_store
    if not req.text or not req.text.strip():
        raise HTTPException(400, "text required")
    src = req.source.strip() or f"local:{int(time.time())}"
    added = kb_store.add(src, req.text, title=req.title or "", tags=req.tags or [])
    return {"ok": True, "added": added, "source": src, "size": kb_store.size()}


@app.post("/kb/search")
def kb_search_endpoint(req: KbSearchRequest):
    from monkey import kb_store
    if not req.query.strip():
        raise HTTPException(400, "query required")
    return {"results": kb_store.search(req.query, top_k=max(1, min(req.top_k, 20)))}


@app.get("/kb/size")
def kb_size_endpoint():
    from monkey import kb_store
    return {"size": kb_store.size()}


# ── Mail (IMAP/SMTP) ──────────────────────────────────────────────────────────

class MailAccountUpsertRequest(BaseModel):
    id: str | None = None
    label: str | None = None
    email: str
    imap: dict
    smtp: dict
    authType: str = "password"
    indexInKb: bool = False
    password: str | None = None


class MailTestRequest(BaseModel):
    imap: dict
    email: str
    password: str


class MailSendRequest(BaseModel):
    accountId: str
    to: list[str]
    subject: str = ""
    body: str = ""
    cc: list[str] = []
    bcc: list[str] = []
    inReplyTo: str | None = None
    references: str | None = None
    html: str | None = None


@app.get("/mail/accounts")
def mail_list_accounts():
    from monkey import mail_store
    items = mail_store.list_accounts()
    for it in items:
        it["credentialsReady"] = bool(mail_store.get_password(it["id"]))
    return {"accounts": items}


@app.post("/mail/accounts")
def mail_upsert_account(req: MailAccountUpsertRequest):
    from monkey import mail_store
    try:
        account = mail_store.upsert_account(_model_to_dict(req))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if req.password:
        try:
            mail_store.set_password(account["id"], req.password)
        except Exception as e:
            raise HTTPException(500, f"keychain write failed: {e}")
    account["credentialsReady"] = bool(mail_store.get_password(account["id"]))
    return {"ok": True, "account": account}


@app.delete("/mail/accounts/{account_id}")
def mail_delete_account(account_id: str):
    from monkey import mail_store
    mail_store.delete_password(account_id)
    ok = mail_store.delete_account(account_id)
    if not ok:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


@app.post("/mail/test")
def mail_test_connection(req: MailTestRequest):
    from monkey import imap_client
    ok, err = imap_client.test_login(
        req.imap["host"], int(req.imap["port"]),
        req.imap.get("socket") or "SSL",
        req.email, req.password,
    )
    return {"ok": ok, "error": err}


@app.post("/mail/sync/{account_id}")
def mail_sync(account_id: str, max_messages: int = Query(200, ge=1, le=2000)):
    from monkey import mail_store, imap_client
    account = mail_store.get_account(account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    password = mail_store.get_password(account_id)
    if not password:
        raise HTTPException(401, "Password not in keychain — re-enter credentials")
    result = imap_client.sync_inbox(
        account, password, max_messages=max_messages, last_uid=account["lastUid"],
    )
    if not result["ok"]:
        mail_store.set_sync_state(account_id, last_error=result["error"])
        raise HTTPException(502, result["error"])
    inserted = 0
    indexed_ids: list[str] = []
    for msg in result["messages"]:
        mid = mail_store.insert_message(account_id, msg)
        if mid:
            inserted += 1
            if account["indexInKb"]:
                indexed_ids.append(mid)
    mail_store.set_sync_state(account_id, last_uid=result["new_last_uid"], last_error="")
    # Post-sync KB indexation (Phase 6)
    if indexed_ids:
        _index_messages_in_kb(account, indexed_ids)
    return {"ok": True, "fetched": result["fetched"], "inserted": inserted, "indexed": len(indexed_ids)}


@app.get("/mail/list")
def mail_list_messages(account_id: str | None = None, folder: str = "INBOX",
                       limit: int = Query(50, ge=1, le=200), offset: int = 0,
                       unread_only: bool = False):
    from monkey import mail_store
    return {
        "messages": mail_store.list_messages(
            account_id=account_id, folder=folder, limit=limit, offset=offset,
            unread_only=unread_only,
        )
    }


@app.get("/mail/message/{message_id}")
def mail_get_message(message_id: str):
    from monkey import mail_store
    msg = mail_store.get_message(message_id, with_html=True)
    if not msg:
        raise HTTPException(404, "Message not found")
    return msg


@app.get("/mail/search")
def mail_search(q: str = Query(..., min_length=1), account_id: str | None = None,
                limit: int = Query(20, ge=1, le=100)):
    from monkey import mail_store
    return {"results": mail_store.search_messages(q, account_id=account_id, limit=limit)}


@app.get("/mail/unread-count")
def mail_unread_count(account_id: str | None = None):
    from monkey import mail_store
    return {"count": mail_store.unread_count(account_id=account_id)}


@app.post("/mail/send")
def mail_send(req: MailSendRequest):
    from monkey import mail_store, smtp_client, imap_client
    account = mail_store.get_account(req.accountId)
    if not account:
        raise HTTPException(404, "Account not found")
    password = mail_store.get_password(req.accountId)
    if not password:
        raise HTTPException(401, "Password not in keychain")
    if not req.to:
        raise HTTPException(400, "Recipient required")
    ok, err, raw = smtp_client.send(
        account, password,
        to=req.to, subject=req.subject, body=req.body,
        cc=req.cc, bcc=req.bcc,
        in_reply_to=req.inReplyTo, references=req.references, html=req.html,
    )
    if not ok:
        raise HTTPException(502, err)
    # Best-effort: APPEND to Sent so the message shows up across clients
    if raw:
        try:
            imap_client.append_sent(account, password, raw)
        except Exception:
            pass
    return {"ok": True}


class MailFlagRequest(BaseModel):
    accountId: str
    uid: int
    flag: str
    remove: bool = False
    folder: str = "INBOX"


@app.post("/mail/flag")
def mail_flag(req: MailFlagRequest):
    from monkey import mail_store, imap_client
    account = mail_store.get_account(req.accountId)
    if not account:
        raise HTTPException(404, "Account not found")
    password = mail_store.get_password(req.accountId)
    if not password:
        raise HTTPException(401, "Password not in keychain")
    ok, err = imap_client.set_flag(
        account, password, req.uid, req.flag, remove=req.remove, folder=req.folder
    )
    if not ok:
        raise HTTPException(502, err)
    return {"ok": True}


class MailMoveRequest(BaseModel):
    accountId: str
    uid: int
    destFolder: str
    folder: str = "INBOX"


@app.post("/mail/move")
def mail_move(req: MailMoveRequest):
    from monkey import mail_store, imap_client
    account = mail_store.get_account(req.accountId)
    if not account:
        raise HTTPException(404, "Account not found")
    password = mail_store.get_password(req.accountId)
    if not password:
        raise HTTPException(401, "Password not in keychain")
    ok, err = imap_client.move_to(
        account, password, req.uid, req.destFolder, folder=req.folder
    )
    if not ok:
        raise HTTPException(502, err)
    return {"ok": True}


def _index_messages_in_kb(account: dict, message_ids: list[str]) -> None:
    """Phase 6: push synced mail bodies into the unified KB."""
    from monkey import mail_store, kb_store
    for mid in message_ids:
        msg = mail_store.get_message(mid, with_html=False)
        if not msg:
            continue
        body = (msg.get("bodyText") or "").strip()
        if not body or len(body) < 200:
            continue
        # Skip encrypted bodies (PGP / S/MIME envelopes)
        if "BEGIN PGP MESSAGE" in body or "BEGIN PGP SIGNED MESSAGE" in body:
            continue
        title = (msg.get("subject") or "")[:200] or "(no subject)"
        source = f"mail:{account['id']}:{msg['uid']}"
        text = (
            f"From: {msg.get('from','')}\n"
            f"Subject: {title}\n"
            f"Date: {msg.get('dateTs',0)}\n\n"
            f"{body}"
        )
        try:
            kb_store.add(source, text, title=f"[Mail] {title}", tags=["mail", account.get("email", "")])
            mail_store.mark_indexed(mid)
        except Exception:
            pass


@app.post("/web/fetch")
def web_fetch_endpoint(req: WebFetchRequest):
    from monkey.tools.web import fetch_page
    if not req.url.strip():
        raise HTTPException(400, "url required")
    return {"text": _tool_ok_or_400(fetch_page(req.url, req.max_chars))}


# ── File serving ──────────────────────────────────────────────────────────────

@app.get("/file")
def serve_file(path: str = Query(...)):
    """Serve a local file (images, PDFs, etc.) from an absolute path."""
    resolved = os.path.realpath(path)
    if not os.path.isfile(resolved):
        raise HTTPException(404, "File not found")
    # Safety: only serve from workspace or home
    home = os.path.expanduser("~")
    if not resolved.startswith(home):
        raise HTTPException(403, "Access denied")
    return FileResponse(resolved)


@app.get("/extract-pdf")
def extract_pdf_endpoint(path: str = Query(...), pages: str = Query("")):
    """Extract text from a PDF at an absolute path. Used by desktop attachment service."""
    resolved = os.path.realpath(path)
    if not os.path.isfile(resolved):
        raise HTTPException(404, "File not found")
    home = os.path.expanduser("~")
    if not resolved.startswith(home):
        raise HTTPException(403, "Access denied")
    if not resolved.lower().endswith(".pdf"):
        raise HTTPException(400, "Not a PDF")
    from monkey.tools.office import pdf_extract_text
    text = pdf_extract_text(resolved, pages=pages)
    return {"text": text, "path": resolved}


import uuid as _uuid
from fastapi import UploadFile, File as FastFile

@app.post("/upload-tmp")
async def upload_tmp(file: UploadFile = FastFile(...)):
    """Persist a browser-dropped file under ~/.monkey/uploads/ so the agent can read it by path."""
    uploads_dir = Path.home() / ".monkey" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    safe_name = (file.filename or "upload").replace("/", "_").replace("..", "_")
    target = uploads_dir / f"{_uuid.uuid4().hex[:8]}_{safe_name}"
    with open(target, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    return {"path": str(target), "name": safe_name, "size": target.stat().st_size}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("MONKEY_PORT", "3471"))
    uvicorn.run(app, host="127.0.0.1", port=port)
