"""Shell tool with command allowlist."""
import subprocess, shlex

ALLOWED_COMMANDS = {"ls", "cat", "echo", "pwd", "git", "python3", "pip", "npm", "node", "curl", "wget", "grep", "find", "head", "tail", "wc", "diff", "sort", "uniq", "mkdir", "touch", "cp", "mv", "rm", "zip", "unzip", "tar", "open", "which", "env", "printenv", "osascript", "say"}


def _esc_as(s: str) -> str:
    """Escape a string for safe interpolation inside an AppleScript double-quoted literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\r", " ").replace("\n", " ")


import os as _os

_DESTRUCTIVE = {"rm", "cp", "mv"}


def _find_project_root(path: str | None) -> str | None:
    if not path:
        return None
    cur = _os.path.realpath(_os.path.expanduser(path))
    if _os.path.isfile(cur):
        cur = _os.path.dirname(cur)
    for _ in range(8):
        if _os.path.isfile(_os.path.join(cur, "package.json")):
            return cur
        parent = _os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


def _looks_like_game_2d_project(root: str) -> bool:
    if not root:
        return False
    pkg = _os.path.join(root, "package.json")
    game_scene = _os.path.join(root, "src", "scenes", "Game.ts")
    readme = _os.path.join(root, "README.md")
    try:
        if _os.path.isfile(pkg):
            with open(pkg, "r") as f:
                if '"phaser"' in f.read().lower():
                    return True
    except Exception:
        pass
    if _os.path.isfile(game_scene):
        return True
    try:
        if _os.path.isfile(readme):
            with open(readme, "r") as f:
                text = f.read().lower()
            if "game-2d-ts" in text or "2d platformer" in text:
                return True
    except Exception:
        pass
    return False


def _preview_guard(parts: list[str], cwd: str | None) -> str | None:
    if not parts or parts[0] not in {"npm", "pnpm", "yarn", "bun"}:
        return None
    joined = " ".join(parts).lower()
    if " preview" not in f" {joined} ":
        return None
    root = _find_project_root(cwd or _os.getcwd())
    if not root or not _looks_like_game_2d_project(root):
        return None
    dist = _os.path.join(root, "dist", "index.html")
    if _os.path.isfile(dist):
        return (
            "ERREUR: `npm run preview` interdit pour un run de validation de jeu 2D. "
            f"Utilise `npm run build` puis `browser_navigate file://{dist}`."
        )
    return (
        "ERREUR: `npm run preview` interdit pour un run de validation de jeu 2D. "
        "Fais d'abord `npm run build`, puis ouvre `file://.../dist/index.html` avec browser_navigate."
    )

def _is_path_safe(path: str) -> bool:
    """True if absolute path lies under HOME or /tmp."""
    if not path:
        return False
    real = _os.path.realpath(_os.path.expanduser(path))
    home = _os.path.realpath(_os.path.expanduser("~"))
    if real.startswith(home + _os.sep) or real == home:
        return True
    if real.startswith("/tmp/") or real == "/tmp":
        return True
    if real.startswith("/private/tmp/") or real == "/private/tmp":
        return True
    return False


def send_notification(title: str, message: str) -> str:
    """Send a macOS system notification."""
    try:
        script = f'display notification "{_esc_as(message)}" with title "{_esc_as(title)}"'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return f"OK: notification envoyée — {title}"
        return f"Error: {result.stderr.strip()}"
    except Exception as e:
        return f"Error: {e}"


def add_reminder(title: str, due_date: str = "", notes: str = "", list_name: str = "Reminders") -> str:
    """Add a reminder to macOS Reminders app. due_date format: 'YYYY-MM-DD HH:MM' or 'YYYY-MM-DD'."""
    try:
        if due_date:
            # Parse to AppleScript date
            parts = due_date.strip().split()
            date_str = parts[0]
            time_str = parts[1] if len(parts) > 1 else "09:00"
            y, mo, d = date_str.split("-")
            h, mi = time_str.split(":")
            months = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"]
            month_name = months[int(mo)-1]
            as_date = f'date "{month_name} {int(d)}, {y} {h}:{mi}:00"'
            due_line = f"set dueDate of newReminder to {as_date}"
        else:
            due_line = ""
        notes_line = f'set body of newReminder to "{_esc_as(notes)}"' if notes else ""
        script = f"""
tell application "Reminders"
    set targetList to list "{list_name}"
    set newReminder to make new reminder at end of targetList
    set name of newReminder to "{_esc_as(title)}"
    {due_line}
    {notes_line}
end tell
"""
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return f"OK: rappel ajouté — {title}" + (f" (échéance: {due_date})" if due_date else "")
        return f"Error: {result.stderr.strip()}"
    except Exception as e:
        return f"Error: {e}"


def create_calendar_event(title: str, start: str, end: str = "", notes: str = "", calendar: str = "") -> str:
    """Create a macOS Calendar event. start/end format: 'YYYY-MM-DD HH:MM'."""
    try:
        def _as_date(s: str) -> str:
            parts = s.strip().split()
            date_str = parts[0]; time_str = parts[1] if len(parts) > 1 else "09:00"
            y, mo, d = date_str.split("-"); h, mi = time_str.split(":")
            months = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"]
            return f'date "{months[int(mo)-1]} {int(d)}, {y} {h}:{mi}:00"'
        end_time = end or start  # default same day
        cal_line = f'set calendar of newEvent to calendar "{calendar}"' if calendar else ""
        notes_line = f'set description of newEvent to "{_esc_as(notes)}"' if notes else ""
        script = f"""
tell application "Calendar"
    tell calendar 1
        set newEvent to make new event at end of events
        set summary of newEvent to "{_esc_as(title)}"
        set start date of newEvent to {_as_date(start)}
        set end date of newEvent to {_as_date(end_time)}
        {notes_line}
    end tell
    reload calendars
end tell
"""
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return f"OK: événement créé — {title} ({start})"
        return f"Error: {result.stderr.strip()}"
    except Exception as e:
        return f"Error: {e}"


def run_command(command: str, cwd: str | None = None, timeout: int = 30) -> str:
    # Auto-extract leading `cd <path> && rest` into cwd parameter
    import re as _re
    m = _re.match(r'^\s*cd\s+([^\s&;|]+)\s*&&\s*(.+)$', command)
    if m:
        cd_path, rest = m.group(1), m.group(2)
        if cwd is None:
            cwd = cd_path.strip("'\"")
        command = rest
    try:
        parts = shlex.split(command)
    except ValueError as e:
        return f"ERREUR: commande mal formée — {e}"
    if not parts or parts[0] not in ALLOWED_COMMANDS:
        return f"Command not allowed: {parts[0] if parts else '(empty)'}. Use cwd parameter for working directory. Allowed: {', '.join(sorted(ALLOWED_COMMANDS))}"
    if parts[0] in _DESTRUCTIVE:
        path_args = [a for a in parts[1:] if not a.startswith("-")]
        for p in path_args:
            if not _is_path_safe(p):
                return f"ERREUR: chemin interdit pour {parts[0]}: {p} (autorisé: ~ ou /tmp uniquement)"
        if parts[0] == "rm":
            joined = " ".join(parts).lower()
            if "node_modules" in joined or "package-lock.json" in joined:
                return ("ERREUR: rm node_modules / package-lock.json INTERDIT. "
                        "Si build échoue avec TS2339 sur lib externe, fais juste `npm install` "
                        "(sans rm). Si tu insistes, l'utilisateur doit le faire manuellement.")
    preview_guard = _preview_guard(parts, cwd)
    if preview_guard:
        return preview_guard
    try:
        result = subprocess.run(parts, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        out = result.stdout + result.stderr
        body = out[:4000] if out else "(no output)"
        return f"[exit={result.returncode}]\n{body}"
    except subprocess.TimeoutExpired:
        return f"[exit=124]\nCommand timed out after {timeout}s"
    except Exception as e:
        return f"[exit=1]\nError: {e}"
