"""Game-project detection + browser probe for 'gameplay actually works' validation."""
from __future__ import annotations

import json
import os
import re


def find_dist_html(written_paths: set[str]) -> str | None:
    """Walk up from each written code path to find a project root with dist/index.html
    (or build/, public/, or root index.html). Returns absolute path or None."""
    roots: set[str] = set()
    for p in written_paths:
        if not p.lower().endswith((".ts", ".tsx", ".js", ".jsx", ".html", ".css")):
            continue
        cur = os.path.dirname(os.path.realpath(os.path.expanduser(p)))
        for _ in range(8):
            if os.path.isfile(os.path.join(cur, "package.json")):
                roots.add(cur); break
            parent = os.path.dirname(cur)
            if parent == cur: break
            cur = parent
    for root in roots:
        for sub in ("dist/index.html", "build/index.html", "public/index.html", "index.html"):
            cand = os.path.join(root, sub)
            if os.path.isfile(cand):
                return cand
    return None


def should_auto_browser_probe(
    nudge_count: int,
    *,
    is_game_project: bool,
    dist_html: str | None,
    already_done: bool,
) -> bool:
    return (
        not already_done
        and nudge_count >= 1
        and is_game_project
        and bool(dist_html)
    )


PROBE_JS_STATE = (
    "(async () => {"
    "  await new Promise(r=>setTimeout(r,800));"
    "  return JSON.stringify({"
    "    canvas: document.querySelectorAll('canvas').length,"
    "    gameLoaded: !!window.__game,"
    "    stageChildren: window.__game?.app?.stage?.children?.length || 0,"
    "    errors: window.__errors || []"
    "  });"
    "})()"
)
PROBE_JS_INPUT = (
    "(async () => {"
    "  const g = window.__game;"
    "  const before = g?.player?.x ?? g?.player?.position?.x ?? null;"
    "  window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',key:'ArrowRight',bubbles:true}));"
    "  await new Promise(r=>setTimeout(r,400));"
    "  window.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowRight',key:'ArrowRight',bubbles:true}));"
    "  const after = g?.player?.x ?? g?.player?.position?.x ?? null;"
    "  return JSON.stringify({before, after, moved: (before!=null && after!=null && before!==after)});"
    "})()"
)


def evaluate_probe_results(results: list[dict]) -> tuple[bool, list[str]]:
    """Inspect probe results, return (passed, failures)."""
    failures: list[str] = []
    state_res = None
    input_res = None
    for r in reversed(results):
        if r.get("name") != "browser_run_js":
            continue
        code = ((r.get("args") or {}).get("code") or "")
        out = (r.get("result") or "")
        if "moved" in code and input_res is None:
            input_res = out
        elif "gameLoaded" in code and state_res is None:
            state_res = out
        if state_res and input_res:
            break
    if state_res:
        if "Error" in state_res or "SyntaxError" in state_res:
            failures.append(f"probe state errored: {state_res[:120]}")
        else:
            try:
                d = json.loads(state_res)
                if d.get("canvas", 0) < 1:
                    failures.append("canvas count = 0 (DOM ne rend pas)")
                if not d.get("gameLoaded"):
                    failures.append("window.__game manquant — expose (window).__game = {app, player, scene}")
                if d.get("stageChildren", 0) < 1:
                    failures.append("app.stage.children vide — la scène ne se monte pas")
                if d.get("errors"):
                    failures.append(f"errors runtime: {d.get('errors')}")
            except Exception:
                failures.append(f"probe state JSON unparseable: {state_res[:120]}")
    else:
        failures.append("aucune probe state exécutée")
    if input_res:
        if "Error" in input_res or "SyntaxError" in input_res:
            failures.append(f"probe input errored: {input_res[:120]}")
        else:
            try:
                d = json.loads(input_res)
                if d.get("before") is None:
                    failures.append("player.x introuvable — expose (window).__game.player avec x ou position.x")
                elif not d.get("moved"):
                    failures.append("ArrowRight ne déplace pas player.x — wire les inputs sur window.addEventListener('keydown',…)")
            except Exception:
                failures.append(f"probe input JSON unparseable: {input_res[:120]}")
    else:
        failures.append("aucune probe input exécutée")
    return (not failures, failures)


_GAME_LIB_RE = re.compile(
    r"(?:^|[^a-z])("
    r"pixi\.js|phaser|kaboom|kaplay|melonjs|excalibur|"
    r"matter-js|planck|p2-es|cannon-es|"
    r"three(?:\.js)?|babylon(?:js)?|"
    r"p5(?:\.js)?|love2d|love\.graphics|"
    r"playcanvas|construct\s*3|godot|gdscript|"
    r"impact\.js|crafty|melon|rot\.js|"
    r"defold|cocos2d|cocoscreator"
    r")",
    re.IGNORECASE,
)
_GAME_CODE_RE = re.compile(
    r"(?:"
    r"requestanimationframe|app\.ticker\.add|"
    r"new\s+application\s*\(|"
    r"getcontext\(\s*['\"]2d['\"]|"
    r"<canvas[\s>]|"
    r"\bgame\s*loop\b|\bgameloop\b|"
    r"\btilemap\b|\btileset\b|\bspritesheet\b|\bsprite_sheet\b|"
    r"\bplayer\.(?:x|y|vx|vy|velocity|hp|health|lives)\b|"
    r"\benemy\.(?:x|y|hp|health)\b|"
    r"\bcollision\b|\bhitbox\b|\bcollider\b|"
    r"\bpowerup\b|\bpower-?up\b|"
    r"\bcoyote[_\s-]?time\b|\bjump[_\s-]?buffer\b"
    r")",
    re.IGNORECASE,
)
_GAME_THEME_RE = re.compile(
    r"\b("
    r"jeu|game|gaming|gamedev|"
    r"platformer|metroidvania|shmup|shoot[\s-]*em[\s-]*up|"
    r"roguelike|roguelite|rpg|jrpg|crpg|arpg|"
    r"beat[\s-]*em[\s-]*up|brawler|fighter|fighting[\s-]*game|"
    r"puzzle[\s-]*game|match[\s-]*3|"
    r"endless[\s-]*runner|auto[\s-]*runner|"
    r"tower[\s-]*defense|td[\s-]*game|"
    r"bullet[\s-]*hell|danmaku|"
    r"sandbox[\s-]*game|survival[\s-]*game|"
    r"retro|retrogame|"
    r"gameboy|game[\s-]*boy|nes|snes|n64|"
    r"genesis|megadrive|mega[\s-]*drive|"
    r"arcade|atari|amiga|commodore|c64|"
    r"8[\s-]*bit|16[\s-]*bit|"
    r"pixel[\s-]*art|pixelart|"
    r"chiptune|chip[\s-]*tune|"
    r"mario|zelda|sonic|metroid|castlevania|megaman|mega[\s-]*man|"
    r"pacman|pac[\s-]*man|pokemon|pokémon|tetris|"
    r"hollow[\s-]*knight|celeste|stardew|undertale|"
    r"contra|gradius|1942|donkey[\s-]*kong"
    r")\b",
    re.IGNORECASE,
)
_GAME_PATH_RE = re.compile(
    r"(?:^|/)(games?|levels?|sprites?|tilesets?|tilemaps?|entities|enemies|"
    r"powerups?|biomes?|chiptune|sfx|bgm|gamedata)(?:/|$)",
    re.IGNORECASE,
)


def is_game_project(tool_results: list[dict]) -> bool:
    """Scaffold_game_2d called, OR any code/path/content matches the game lexical field."""
    for r in tool_results:
        name = r.get("name")
        if name == "scaffold_game_2d":
            return True
        if name not in ("write_file", "edit_file", "append_to_file"):
            continue
        args = r.get("args") or {}
        if not isinstance(args, dict):
            continue
        path = (args.get("path") or args.get("file_path") or "")
        if path and _GAME_PATH_RE.search(path):
            return True
        content = args.get("content") or args.get("new_content") or ""
        if not content:
            continue
        if (_GAME_LIB_RE.search(content)
                or _GAME_CODE_RE.search(content)
                or _GAME_THEME_RE.search(content)):
            return True
    return False
