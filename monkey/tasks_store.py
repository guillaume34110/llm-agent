"""Local-first task storage for Monkey."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading
import uuid
from typing import Any

from dateutil.rrule import rrulestr


VALID_STATUS = {"planned", "done", "cancelled"}
MIN_INTERVAL_MINUTES = 10
RUN_HISTORY_CAP = 20
RUN_LOG_CAP = 50
# A run still marked runStartedAt after this many minutes is considered orphaned
# (sidecar killed mid-run, crash, etc.). Recovery clears runStartedAt so the next
# claim_due can proceed and recurring tasks can advance.
STALE_RUN_MINUTES = 30


def _rrule_interval_minutes(rule: str) -> int | None:
    """Return the recurrence interval in minutes from an RRULE string. None if unparseable."""
    raw = (rule or "").strip()
    if not raw:
        return None
    body = raw.split("RRULE:", 1)[1] if raw.upper().startswith("RRULE:") else raw
    try:
        parts = dict(p.split("=", 1) for p in body.split(";") if "=" in p)
    except Exception:
        return None
    freq = (parts.get("FREQ") or "").upper()
    try:
        interval = int(parts.get("INTERVAL", "1"))
    except ValueError:
        interval = 1
    minutes_per = {"MINUTELY": 1, "HOURLY": 60, "DAILY": 60 * 24, "WEEKLY": 60 * 24 * 7,
                   "MONTHLY": 60 * 24 * 30, "YEARLY": 60 * 24 * 365}.get(freq)
    if minutes_per is None:
        return None
    return minutes_per * max(1, interval)


def _parse_rrule(rule: str, dtstart: dt.datetime):
    """Parse an RRULE string anchored at dtstart. Raises ValueError if invalid
    or if the minimum interval (MIN_INTERVAL_MINUTES) is violated."""
    raw = (rule or "").strip()
    if not raw:
        raise ValueError("recurrence vide")
    # Accept either bare "FREQ=...;..." or "RRULE:FREQ=...". rrulestr handles both.
    try:
        rr = rrulestr(raw, dtstart=dtstart, cache=False)
    except Exception as e:
        raise ValueError(f"RRULE invalide: {e}") from e
    # Enforce min interval. Parse FREQ + INTERVAL from the raw text.
    body = raw.split("RRULE:", 1)[1] if raw.upper().startswith("RRULE:") else raw
    parts = dict(p.split("=", 1) for p in body.split(";") if "=" in p)
    freq = (parts.get("FREQ") or "").upper()
    try:
        interval = int(parts.get("INTERVAL", "1"))
    except ValueError:
        interval = 1
    minutes_per = {"MINUTELY": 1, "HOURLY": 60, "DAILY": 60 * 24, "WEEKLY": 60 * 24 * 7,
                   "MONTHLY": 60 * 24 * 30, "YEARLY": 60 * 24 * 365}.get(freq)
    if minutes_per is None:
        raise ValueError(f"FREQ non supporté: {freq!r}")
    if minutes_per * max(1, interval) < MIN_INTERVAL_MINUTES:
        raise ValueError(f"intervalle minimal {MIN_INTERVAL_MINUTES} minutes")
    return rr


def _compute_next_run(rule: str, dtstart: dt.datetime, after: dt.datetime | None,
                       until: dt.datetime | None, count: int | None,
                       runs_so_far: int) -> dt.datetime | None:
    rr = _parse_rrule(rule, dtstart)
    ref = after or dtstart
    # rrule.after returns the first occurrence strictly after ref. Use inc=True
    # so dtstart itself counts if ref == dtstart.
    nxt = rr.after(ref, inc=(after is None))
    if nxt is None:
        return None
    if until is not None and nxt > until:
        return None
    if count is not None and runs_so_far >= count:
        return None
    return nxt


def preview_recurrence(rule: str, dtstart_iso: str, n: int = 5,
                        until_iso: str | None = None, count: int | None = None) -> list[str]:
    dtstart = _parse_datetime_local(dtstart_iso)
    rr = _parse_rrule(rule, dtstart)
    until = _parse_datetime_local(until_iso) if until_iso else None
    out: list[str] = []
    for occ in rr:
        if until is not None and occ > until:
            break
        if count is not None and len(out) >= count:
            break
        out.append(occ.isoformat(timespec="minutes"))
        if len(out) >= max(1, n):
            break
    return out


_TZ_ABBREV_RE = re.compile(r"\s*\b(?:UTC|GMT|Z|CEST|CET|EST|EDT|PST|PDT|MST|MDT|CDT|CST|BST|JST|KST|IST|AEST|AEDT|ACST|ACDT|AWST|HKT|SGT|MSK|EET|EEST|WET|WEST)\b\s*$", re.IGNORECASE)


def _parse_datetime_local(value: str) -> dt.datetime:
    raw = (value or "").strip()
    if not raw:
        raise ValueError("scheduledFor requis")
    # Small models (Ministral-3-3B, Llama-3.2-3B) often append a timezone
    # abbreviation ("2026-05-26T14:00:00 CEST"). fromisoformat only accepts
    # numeric offsets (+02:00). Strip the abbrev — caller treats the value
    # as local time anyway.
    raw = _TZ_ABBREV_RE.sub("", raw).strip()
    raw = raw.replace(" ", "T")
    if len(raw) == 10:
        raw = raw + "T09:00"
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError as e:
        raise ValueError(f"datetime invalide: {value!r}") from e
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _normalize_scheduled(value: str, all_day: bool) -> str:
    raw = (value or "").strip()
    if all_day:
        day = raw.split("T", 1)[0].split(" ", 1)[0]
        try:
            return dt.date.fromisoformat(day).isoformat()
        except ValueError as e:
            raise ValueError(f"date invalide: {value!r}") from e
    when = _parse_datetime_local(raw).replace(second=0, microsecond=0)
    return when.isoformat(timespec="minutes")


def _normalize_end(value: str | None, all_day: bool, scheduled_for: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if all_day:
        day = raw.split("T", 1)[0].split(" ", 1)[0]
        try:
            return dt.date.fromisoformat(day).isoformat()
        except ValueError as e:
            raise ValueError(f"date de fin invalide: {value!r}") from e
    start = _parse_datetime_local(scheduled_for)
    end = _parse_datetime_local(raw).replace(second=0, microsecond=0)
    if end <= start:
        raise ValueError("endsAt doit être après scheduledFor")
    return end.isoformat(timespec="minutes")


def _task_window(task: dict[str, Any]) -> tuple[dt.datetime, dt.datetime] | None:
    if task.get("allDay"):
        return None
    start = _parse_datetime_local(str(task.get("scheduledFor", "")))
    end_raw = str(task.get("endsAt") or "").strip()
    end = _parse_datetime_local(end_raw) if end_raw else start + dt.timedelta(minutes=30)
    if end <= start:
        end = start + dt.timedelta(minutes=30)
    return start, end


def _sort_key(task: dict[str, Any]) -> tuple[int, dt.datetime, str]:
    all_day = 0 if task.get("allDay") else 1
    when = _parse_datetime_local(str(task.get("scheduledFor", "")))
    return (all_day, when, str(task.get("title", "")).lower())


class TaskStore:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self._tasks: dict[str, dict[str, Any]] = {}
        self._mtime: float = 0.0
        self._load()

    def _load(self):
        try:
            with open(self.path, "r") as f:
                data = json.load(f)
            if isinstance(data, list):
                self._tasks = {str(t.get("id")): t for t in data if isinstance(t, dict) and t.get("id")}
            else:
                self._tasks = {}
        except Exception:
            self._tasks = {}
        try:
            self._mtime = os.path.getmtime(self.path)
        except OSError:
            self._mtime = 0.0

    def _maybe_reload(self):
        """Reload from disk if file mtime changed since last read.
        Guards against concurrent writers (e.g. multiple sidecar instances)."""
        try:
            mtime = os.path.getmtime(self.path)
        except OSError:
            return
        if mtime != self._mtime:
            self._load()

    def _recover_orphan_runs(self, ref: dt.datetime) -> bool:
        """Clear runStartedAt for runs older than threshold (sidecar crash, kill,
        etc.). Threshold is min(STALE_RUN_MINUTES, 1.5 * recurrence interval) for
        recurring tasks. For recurring tasks, also advance nextRunAt past the
        missed slot so the loop resumes. Returns True if any task was modified.
        Caller must hold the lock and call _save() if True."""
        now_iso = ref.isoformat(timespec="seconds")
        changed = False
        for task in self._tasks.values():
            started = task.get("runStartedAt")
            if not started:
                continue
            try:
                started_dt = _parse_datetime_local(str(started))
            except ValueError:
                # Unparseable runStartedAt → clear it
                task["runStartedAt"] = None
                task["updatedAt"] = now_iso
                changed = True
                continue
            # Per-task threshold: shorter of fixed STALE_RUN_MINUTES and 1.5x interval
            recurrence = str(task.get("recurrence") or "").strip()
            stale_min = STALE_RUN_MINUTES
            if recurrence:
                interval_min = _rrule_interval_minutes(recurrence)
                if interval_min is not None:
                    stale_min = min(stale_min, max(MIN_INTERVAL_MINUTES, int(interval_min * 1.5)))
            threshold = ref - dt.timedelta(minutes=stale_min)
            if started_dt > threshold:
                continue
            # Orphaned run: clear marker, log failure
            task["runStartedAt"] = None
            task["runFinishedAt"] = now_iso
            task["runResult"] = "ERREUR: run orphaned (sidecar restart or crash)"
            task["updatedAt"] = now_iso
            recurrence = str(task.get("recurrence") or "").strip()
            if recurrence and task.get("status") == "planned":
                # Append failure to history so count-bounded recurrences progress
                history = list(task.get("runHistory") or [])
                history.append({
                    "startedAt": started,
                    "finishedAt": now_iso,
                    "result": "ERREUR: run orphaned",
                    "ok": False,
                })
                if len(history) > RUN_HISTORY_CAP:
                    history = history[-RUN_HISTORY_CAP:]
                task["runHistory"] = history
                task["lastRunAt"] = now_iso
                try:
                    dtstart = _parse_datetime_local(str(task.get("scheduledFor", "")))
                    until = task.get("recurrenceUntil")
                    until_dt = _parse_datetime_local(str(until)) if until else None
                    count = task.get("recurrenceCount")
                    nxt = _compute_next_run(recurrence, dtstart, ref, until_dt,
                                             int(count) if count else None, len(history))
                except Exception:
                    nxt = None
                if nxt is None:
                    task["status"] = "done"
                    task["nextRunAt"] = None
                else:
                    task["nextRunAt"] = nxt.isoformat(timespec="minutes")
            changed = True
        return changed

    def boot_recover_orphans(self) -> int:
        """Called once at sidecar startup: immediately orphan every run marked
        in-progress (runStartedAt set). The new process cannot resume an old run."""
        now_iso = dt.datetime.now().isoformat(timespec="seconds")
        count = 0
        with self._lock:
            self._maybe_reload()
            for task in self._tasks.values():
                if not task.get("runStartedAt"):
                    continue
                task["runStartedAt"] = None
                task["runFinishedAt"] = now_iso
                task["runResult"] = "ERREUR: run orphaned (sidecar restart or crash)"
                task["updatedAt"] = now_iso
                recurrence = str(task.get("recurrence") or "").strip()
                if recurrence and task.get("status") == "planned":
                    history = list(task.get("runHistory") or [])
                    history.append({
                        "startedAt": now_iso,
                        "finishedAt": now_iso,
                        "result": "ERREUR: run orphaned",
                        "ok": False,
                    })
                    if len(history) > RUN_HISTORY_CAP:
                        history = history[-RUN_HISTORY_CAP:]
                    task["runHistory"] = history
                    task["lastRunAt"] = now_iso
                count += 1
            if count:
                self._save()
        return count

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.list_tasks(), f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)
        try:
            self._mtime = os.path.getmtime(self.path)
        except OSError:
            self._mtime = 0.0

    def list_tasks(self) -> list[dict[str, Any]]:
        self._maybe_reload()
        items = list(self._tasks.values())
        items.sort(key=_sort_key)
        return [dict(t) for t in items]

    def get_task(self, task_id: str) -> dict[str, Any]:
        self._maybe_reload()
        task = self._tasks.get(task_id)
        if not task:
            raise KeyError(task_id)
        return dict(task)

    def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._maybe_reload()
            now = dt.datetime.now().isoformat(timespec="seconds")
            task = self._normalize_task(payload, existing=None, now=now)
            task["id"] = str(uuid.uuid4())
            task = self._auto_shift_if_needed(task)
            self._tasks[task["id"]] = task
            self._save()
            return dict(task)

    def update_task(self, task_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._maybe_reload()
            existing = self._tasks.get(task_id)
            if not existing:
                raise KeyError(task_id)
            now = dt.datetime.now().isoformat(timespec="seconds")
            merged = dict(existing)
            for key, value in patch.items():
                if value is None and key != "endsAt":
                    continue
                merged[key] = value
            task = self._normalize_task(merged, existing=existing, now=now)
            task["id"] = task_id
            task = self._auto_shift_if_needed(task, exclude_id=task_id)
            self._tasks[task_id] = task
            self._save()
            return dict(task)

    def list_upcoming(self, limit: int = 20, now: dt.datetime | None = None) -> list[dict[str, Any]]:
        """Planned tasks whose scheduledFor >= now, sorted chronologically, capped."""
        ref = now or dt.datetime.now()
        with self._lock:
            self._maybe_reload()
            if self._recover_orphan_runs(ref):
                self._save()
        out: list[dict[str, Any]] = []
        for task in self._tasks.values():
            if task.get("status") != "planned":
                continue
            trigger = str(task.get("nextRunAt") or task.get("scheduledFor", ""))
            try:
                when = _parse_datetime_local(trigger)
            except ValueError:
                continue
            # Keep overdue/in-progress planned tasks visible (recurring loops or stuck runs).
            out.append((when, task))  # type: ignore[arg-type]
        out.sort(key=lambda r: r[0])
        return [dict(t) for _, t in out[: max(0, int(limit))]]

    def reconcile_recurring(self, now: dt.datetime | None = None) -> int:
        """Advance every planned recurring task whose nextRunAt is in the past.

        Use case: app was closed for hours/days. We don't want to fire a burst
        of stale catch-up runs (the data they were meant to act on is no longer
        current). Jump straight to the first occurrence strictly after `now`.

        Returns the number of tasks advanced. Run at scheduler startup, before
        the first tick.
        """
        ref = now or dt.datetime.now()
        now_iso = ref.isoformat(timespec="seconds")
        advanced = 0
        with self._lock:
            self._maybe_reload()
            for task in self._tasks.values():
                if task.get("status") != "planned":
                    continue
                recurrence = str(task.get("recurrence") or "").strip()
                if not recurrence:
                    continue
                trigger = str(task.get("nextRunAt") or task.get("scheduledFor", ""))
                try:
                    when = _parse_datetime_local(trigger)
                except ValueError:
                    continue
                if when >= ref:
                    continue
                try:
                    dtstart = _parse_datetime_local(str(task.get("scheduledFor", "")))
                    until = task.get("recurrenceUntil")
                    until_dt = _parse_datetime_local(str(until)) if until else None
                    count = task.get("recurrenceCount")
                    runs = len(task.get("runHistory") or [])
                    nxt = _compute_next_run(recurrence, dtstart, ref, until_dt,
                                             int(count) if count else None, runs)
                except Exception:
                    continue
                if nxt is None:
                    task["status"] = "done"
                    task["nextRunAt"] = None
                else:
                    task["nextRunAt"] = nxt.isoformat(timespec="minutes")
                task["updatedAt"] = now_iso
                advanced += 1
            if advanced:
                self._save()
        return advanced

    def claim_due(self, now: dt.datetime | None = None, max_age_hours: float = 24.0) -> list[dict[str, Any]]:
        """Atomically pick planned tasks with agentPrompt set whose nextRunAt (or
        scheduledFor for non-recurring legacy tasks) <= now. Marks runStartedAt
        to avoid double-pickup. Skips tasks too far in the past."""
        ref = now or dt.datetime.now()
        cutoff = ref - dt.timedelta(hours=max_age_hours)
        with self._lock:
            self._maybe_reload()
            recovered = self._recover_orphan_runs(ref)
            claimed: list[dict[str, Any]] = []
            now_iso = ref.isoformat(timespec="seconds")
            for task in self._tasks.values():
                if task.get("status") != "planned":
                    continue
                if not task.get("agentPrompt") and not task.get("shellCommand"):
                    continue
                if task.get("runStartedAt"):
                    continue
                trigger = str(task.get("nextRunAt") or task.get("scheduledFor", ""))
                try:
                    when = _parse_datetime_local(trigger)
                except ValueError:
                    continue
                if when > ref:
                    continue
                if when < cutoff:
                    # For recurring tasks, skip the missed slot instead of cancelling.
                    if task.get("recurrence"):
                        try:
                            dtstart = _parse_datetime_local(str(task.get("scheduledFor", "")))
                            until = task.get("recurrenceUntil")
                            until_dt = _parse_datetime_local(str(until)) if until else None
                            count = task.get("recurrenceCount")
                            runs = len(task.get("runHistory") or [])
                            nxt = _compute_next_run(str(task["recurrence"]), dtstart, ref,
                                                     until_dt, int(count) if count else None, runs)
                            if nxt is None:
                                task["status"] = "done"
                            else:
                                task["nextRunAt"] = nxt.isoformat(timespec="minutes")
                            task["updatedAt"] = now_iso
                        except Exception:
                            task["status"] = "cancelled"
                            task["runResult"] = "ERREUR: recurrence error"
                            task["updatedAt"] = now_iso
                        continue
                    task["status"] = "cancelled"
                    task["runResult"] = "ERREUR: task expired (>24h late)"
                    task["updatedAt"] = now_iso
                    continue
                task["runStartedAt"] = now_iso
                task["updatedAt"] = now_iso
                claimed.append(dict(task))
            if claimed or recovered:
                self._save()
            return claimed

    def finish_run(self, task_id: str, result: str, *, ok: bool = True) -> dict[str, Any]:
        with self._lock:
            self._maybe_reload()
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            now_iso = dt.datetime.now().isoformat(timespec="seconds")
            recurrence = str(task.get("recurrence") or "").strip()
            if recurrence:
                # Append to history (cap), then schedule the next occurrence.
                history = list(task.get("runHistory") or [])
                history.append({
                    "startedAt": task.get("runStartedAt"),
                    "finishedAt": now_iso,
                    "result": str(result),
                    "ok": bool(ok),
                })
                if len(history) > RUN_HISTORY_CAP:
                    history = history[-RUN_HISTORY_CAP:]
                task["runHistory"] = history
                task["lastRunAt"] = now_iso
                task["runStartedAt"] = None
                task["runFinishedAt"] = now_iso
                task["runResult"] = str(result)
                task["updatedAt"] = now_iso
                try:
                    dtstart = _parse_datetime_local(str(task.get("scheduledFor", "")))
                    until = task.get("recurrenceUntil")
                    until_dt = _parse_datetime_local(str(until)) if until else None
                    count = task.get("recurrenceCount")
                    ref = dt.datetime.now()
                    nxt = _compute_next_run(recurrence, dtstart, ref, until_dt,
                                             int(count) if count else None, len(history))
                except Exception:
                    nxt = None
                if nxt is None:
                    task["status"] = "done"
                    task["nextRunAt"] = None
                else:
                    task["status"] = "planned"
                    task["nextRunAt"] = nxt.isoformat(timespec="minutes")
                self._save()
                return dict(task)
            task["runFinishedAt"] = now_iso
            task["runResult"] = str(result)
            task["status"] = "done" if ok else "cancelled"
            task["updatedAt"] = now_iso
            self._save()
            return dict(task)

    def reset_run_log(self, task_id: str) -> None:
        """Clear runLog for a task. Called at the start of a new run so the UI
        shows only the live run's steps."""
        with self._lock:
            self._maybe_reload()
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            task["runLog"] = []
            task["updatedAt"] = dt.datetime.now().isoformat(timespec="seconds")
            self._save()

    def append_run_log(self, task_id: str, entry: dict[str, Any]) -> None:
        """Append a streaming event to runLog. Caps at RUN_LOG_CAP (oldest dropped)."""
        with self._lock:
            self._maybe_reload()
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            log = list(task.get("runLog") or [])
            normalized = {
                "ts": str(entry.get("ts") or dt.datetime.now().isoformat(timespec="seconds")),
                "kind": str(entry.get("kind") or "info"),
                "label": str(entry.get("label") or ""),
            }
            detail = entry.get("detail")
            if detail is not None:
                normalized["detail"] = str(detail)[:400]
            log.append(normalized)
            if len(log) > RUN_LOG_CAP:
                log = log[-RUN_LOG_CAP:]
            task["runLog"] = log
            task["updatedAt"] = normalized["ts"]
            self._save()

    def delete_task(self, task_id: str) -> None:
        with self._lock:
            self._maybe_reload()
            if task_id not in self._tasks:
                raise KeyError(task_id)
            del self._tasks[task_id]
            self._save()

    def _normalize_task(self, payload: dict[str, Any], existing: dict[str, Any] | None, now: str) -> dict[str, Any]:
        title = str(payload.get("title", "")).strip()
        if not title:
            raise ValueError("title requis")
        all_day = bool(payload.get("allDay", False))
        status = str(payload.get("status", "planned") or "planned").strip()
        if status not in VALID_STATUS:
            raise ValueError(f"status invalide: {status!r}")
        scheduled_for = _normalize_scheduled(str(payload.get("scheduledFor", "")), all_day)
        ends_at = _normalize_end(payload.get("endsAt"), all_day, scheduled_for)
        agent_prompt = payload.get("agentPrompt")
        if agent_prompt is None and existing is not None:
            agent_prompt = existing.get("agentPrompt")
        agent_prompt = (str(agent_prompt).strip() if agent_prompt else "") or None
        shell_command = payload.get("shellCommand")
        if shell_command is None and existing is not None:
            shell_command = existing.get("shellCommand")
        shell_command = (str(shell_command).strip() if shell_command else "") or None
        if agent_prompt and shell_command:
            raise ValueError("set agentPrompt OR shellCommand, not both")
        run_result = payload.get("runResult")
        if run_result is None and existing is not None:
            run_result = existing.get("runResult")
        run_started_at = payload.get("runStartedAt")
        if run_started_at is None and existing is not None:
            run_started_at = existing.get("runStartedAt")
        run_finished_at = payload.get("runFinishedAt")
        if run_finished_at is None and existing is not None:
            run_finished_at = existing.get("runFinishedAt")

        def _carry(key: str):
            v = payload.get(key)
            if v is None and existing is not None:
                v = existing.get(key)
            return v

        recurrence = _carry("recurrence")
        recurrence = (str(recurrence).strip() if recurrence else "") or None
        recurrence_until_raw = _carry("recurrenceUntil")
        recurrence_until: str | None
        if recurrence_until_raw:
            recurrence_until = _normalize_scheduled(str(recurrence_until_raw), all_day=False)
        else:
            recurrence_until = None
        recurrence_count_raw = _carry("recurrenceCount")
        recurrence_count: int | None = None
        if recurrence_count_raw not in (None, ""):
            try:
                recurrence_count = int(recurrence_count_raw)
                if recurrence_count < 1:
                    recurrence_count = None
            except (TypeError, ValueError):
                raise ValueError(f"recurrenceCount invalide: {recurrence_count_raw!r}")
        run_history = _carry("runHistory")
        run_history = list(run_history) if isinstance(run_history, list) else (run_history or [])
        run_log = _carry("runLog")
        run_log = list(run_log) if isinstance(run_log, list) else []
        last_run_at = _carry("lastRunAt")
        model_id = _carry("modelId")
        model_id = (str(model_id).strip() if model_id else "") or None
        if agent_prompt and not model_id:
            raise ValueError("modelId required for agent task (no auto-mode)")
        image_model_id = _carry("imageModelId")
        image_model_id = (str(image_model_id).strip() if image_model_id else "") or None
        mode_raw = _carry("mode")
        mode = (str(mode_raw).strip().lower() if mode_raw else "") or "report"
        if mode not in ("report", "alert"):
            raise ValueError(f"mode invalide: {mode_raw!r}")
        wa_chat_jid_raw = _carry("waChatJid")
        wa_chat_jid = (str(wa_chat_jid_raw).strip() if wa_chat_jid_raw else "") or None
        wa_chat_label_raw = _carry("waChatLabel")
        wa_chat_label = (str(wa_chat_label_raw).strip()[:120] if wa_chat_label_raw else "") or None
        wa_chat_kind_raw = _carry("waChatKind")
        wa_chat_kind = (str(wa_chat_kind_raw).strip().lower() if wa_chat_kind_raw else "") or None
        if wa_chat_kind and wa_chat_kind not in ("owner", "contact"):
            wa_chat_kind = None
        tool_mode_raw = _carry("toolMode")
        tool_mode = (str(tool_mode_raw).strip().lower() if tool_mode_raw else "") or None
        if tool_mode and tool_mode not in ("full", "chat_only", "chat_search"):
            tool_mode = None
        context_folder_raw = _carry("contextFolder")
        context_folder = (str(context_folder_raw).strip() if context_folder_raw else "") or None
        # Report mode: 'always' (default — always notify after the run) or
        # 'conditional' (the task still runs every tick, but the report is sent
        # only if the post-run condition check returns YES).
        report_mode_raw = _carry("reportMode")
        report_mode = (str(report_mode_raw).strip().lower() if report_mode_raw else "") or "always"
        if report_mode not in ("always", "conditional"):
            raise ValueError(f"reportMode invalide: {report_mode_raw!r}")
        report_condition_raw = _carry("reportCondition")
        report_condition = (str(report_condition_raw).strip() if report_condition_raw else "") or None
        if report_mode == "conditional" and not report_condition:
            raise ValueError("reportCondition required when reportMode=conditional")
        # Validate recurrence early and compute nextRunAt anchor.
        next_run_at: str | None = None
        if recurrence:
            if all_day:
                raise ValueError("recurrence non supportée pour journée entière")
            dtstart = _parse_datetime_local(scheduled_for)
            until_dt = _parse_datetime_local(recurrence_until) if recurrence_until else None
            # Parse rrule for validation (raises on min-interval / bad freq).
            _parse_rrule(recurrence, dtstart)
            existing_next = (existing or {}).get("nextRunAt") if existing else None
            if existing_next and existing.get("recurrence") == recurrence and \
                    existing.get("scheduledFor") == scheduled_for:
                next_run_at = str(existing_next)
            else:
                nxt = _compute_next_run(recurrence, dtstart, None, until_dt,
                                         recurrence_count, len(run_history))
                next_run_at = nxt.isoformat(timespec="minutes") if nxt else None
        task = {
            "id": str((existing or {}).get("id") or payload.get("id") or ""),
            "title": title,
            "details": str(payload.get("details", "") or "").strip(),
            "scheduledFor": scheduled_for,
            "endsAt": ends_at,
            "allDay": all_day,
            "status": status,
            "source": str(payload.get("source") or (existing or {}).get("source") or "user"),
            "agentPrompt": agent_prompt,
            "shellCommand": shell_command,
            "runResult": run_result,
            "runStartedAt": run_started_at,
            "runFinishedAt": run_finished_at,
            "recurrence": recurrence,
            "recurrenceUntil": recurrence_until,
            "recurrenceCount": recurrence_count,
            "nextRunAt": next_run_at,
            "lastRunAt": str(last_run_at) if last_run_at else None,
            "runHistory": run_history,
            "runLog": run_log,
            "modelId": model_id,
            "imageModelId": image_model_id,
            "mode": mode,
            "waChatJid": wa_chat_jid,
            "waChatLabel": wa_chat_label,
            "waChatKind": wa_chat_kind,
            "toolMode": tool_mode,
            "contextFolder": context_folder,
            "reportMode": report_mode,
            "reportCondition": report_condition,
            "createdAt": str((existing or {}).get("createdAt") or now),
            "updatedAt": now,
        }
        return task

    def _auto_shift_if_needed(self, task: dict[str, Any], exclude_id: str | None = None) -> dict[str, Any]:
        if task.get("allDay") or task.get("status") != "planned":
            return task
        candidate = dict(task)
        window = _task_window(candidate)
        if not window:
            return candidate
        start, end = window
        original_had_end = bool(candidate.get("endsAt"))
        for _ in range(96):
            overlaps = False
            for other in self._tasks.values():
                if exclude_id and other.get("id") == exclude_id:
                    continue
                if other.get("status") != "planned" or other.get("allDay"):
                    continue
                other_window = _task_window(other)
                if not other_window:
                    continue
                other_start, other_end = other_window
                if start < other_end and end > other_start:
                    overlaps = True
                    break
            if not overlaps:
                candidate["scheduledFor"] = start.isoformat(timespec="minutes")
                candidate["endsAt"] = end.isoformat(timespec="minutes") if original_had_end else candidate.get("endsAt")
                return candidate
            start += dt.timedelta(minutes=30)
            end += dt.timedelta(minutes=30)
        candidate["scheduledFor"] = start.isoformat(timespec="minutes")
        candidate["endsAt"] = end.isoformat(timespec="minutes") if original_had_end else candidate.get("endsAt")
        return candidate
