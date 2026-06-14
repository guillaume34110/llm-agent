"""Deterministic post-conditions before allowing 'done'.

Generic across project types (web / CLI / API / lib / script / docs).
"""
from __future__ import annotations

import os
import re

_WEB_FILE_EXTS = (".html", ".htm")
_CODE_FILE_EXTS = (
    ".html", ".htm", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".scss",
    ".vue", ".svelte", ".py", ".rs", ".go", ".java", ".kt", ".swift",
    ".cpp", ".cc", ".c", ".h", ".hpp", ".rb", ".php", ".cs", ".sh", ".bash",
)
_TEXT_DOC_EXTS = (".md", ".txt", ".rst", ".json", ".yaml", ".yml", ".toml", ".xml", ".csv", ".pdf")
_BROWSER_TEST_TOOLS = {"browser_navigate", "browser_get_text", "browser_run_js",
                       "browser_screenshot", "browser_click", "browser_fill"}

_BUILD_CMD_PAT = re.compile(
    r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|typecheck|lint|tsc|check|preview)\b"
    r"|\btsc\b|\bcargo\s+(build|check|test|clippy)\b|\bgo\s+(build|test|vet)\b"
    r"|\bpytest\b|\bmypy\b|\bruff\s+check\b|\beslint\b|\bvitest\b|\bjest\b",
    re.IGNORECASE,
)


def _extract_written_paths(tool_results: list[dict]) -> list[str]:
    paths: list[str] = []
    for r in tool_results:
        if r["name"] not in ("write_file", "edit_file", "append_to_file"):
            continue
        result = r.get("result") or ""
        if not result.startswith("OK:"):
            continue
        for token in result.split():
            tok = token.rstrip(".,;)\"'")
            low = tok.lower()
            if any(low.endswith(ext) for ext in _CODE_FILE_EXTS + _TEXT_DOC_EXTS):
                paths.append(tok)
    return paths


def quality_gate(tool_results: list[dict]) -> list[str]:
    """Return list of issues blocking 'done'. Empty = pass."""
    issues: list[str] = []
    written_paths = _extract_written_paths(tool_results)
    if not written_paths:
        return issues

    code_paths = [p for p in written_paths if any(p.lower().endswith(ext) for ext in _CODE_FILE_EXTS)]
    web_paths = [p for p in written_paths if any(p.lower().endswith(ext) for ext in _WEB_FILE_EXTS)]

    if not code_paths:
        return issues

    has_browser_test = any(r["name"] in _BROWSER_TEST_TOOLS for r in tool_results)

    last_build: dict[str, str] = {}
    build_ok_cwds: list[str] = []
    has_real_runtime_exec = False
    for r in tool_results:
        nm = r["name"]
        if nm in {"http_request"} or nm in _BROWSER_TEST_TOOLS:
            has_real_runtime_exec = True
        if nm == "run_command":
            args = r.get("args") or {}
            cmd = (args.get("command") or "") if isinstance(args, dict) else ""
            cwd_arg = (args.get("cwd") or "") if isinstance(args, dict) else ""
            cwd_abs = os.path.realpath(os.path.expanduser(cwd_arg)) if cwd_arg else ""
            if cmd and _BUILD_CMD_PAT.search(cmd):
                result = r.get("result") or ""
                m = re.match(r"\[exit=(-?\d+)\]", result)
                if m:
                    ec = int(m.group(1))
                    cmd_key = re.sub(r"\s*\|\s*(head|tail|grep|less|more|cat)\b.*$", "", cmd).strip()
                    cmd_key = re.sub(r"\s*2>&1\s*$", "", cmd_key).strip()
                    sigpipe_ok = (ec == 141) and ("error TS" not in result) and ("error:" not in result.lower())
                    ok = (ec == 0) or sigpipe_ok
                    last_build[cmd_key] = "ok" if ok else "fail"
                    if ok:
                        has_real_runtime_exec = True
                        build_ok_cwds.append(cwd_abs)
            elif cmd:
                if re.search(r"\b(node|python3?|deno|bun|\./|cargo\s+run|go\s+run|ruby|php)\b", cmd):
                    result = r.get("result") or ""
                    m = re.match(r"\[exit=(-?\d+)\]", result)
                    if m and m.group(1) == "0":
                        has_real_runtime_exec = True

    if web_paths and not has_browser_test:
        issues.append(
            f"Code web livré ({len(web_paths)} fichier(s) HTML) sans test runtime navigateur. "
            "browser_navigate + browser_run_js (ou browser_click/browser_fill) requis pour user stories E2E."
        )

    if len(code_paths) >= 3 and not has_real_runtime_exec:
        issues.append(
            f"{len(code_paths)} fichiers de code livrés sans exécution runtime réelle. "
            "Lance `npm run build` (ou tsc/cargo/pytest) avec exit 0, OU browser_navigate sur le HTML produit, "
            "OU http_request sur l'API, OU exécution CLI directe. "
            "`npm install` ne compte pas — il n'observe rien du code que tu viens d'écrire."
        )

    failed = [c for c, v in last_build.items() if v == "fail"]
    if failed:
        issues.append(
            "Build/test commande(s) en échec (exit≠0) : "
            + "; ".join(failed[:3])
            + ". Lis la stderr, fixe les erreurs, relance jusqu'à exit 0."
        )

    has_ts_code = any(p.lower().endswith((".ts", ".tsx")) for p in code_paths)
    has_build_ok = any(v == "ok" for v in last_build.values())
    if has_ts_code and not has_build_ok:
        issues.append(
            "Projet TypeScript livré sans `npm run build` (ou `tsc`) avec exit 0. "
            "Tu DOIS valider la compilation avant de finir : `run_command npm run build` dans le workspace."
        )

    if has_ts_code and has_build_ok:
        ts_roots: set[str] = set()
        for p in code_paths:
            if not p.lower().endswith((".ts", ".tsx", ".js", ".jsx")):
                continue
            cur = os.path.dirname(os.path.realpath(os.path.expanduser(p)))
            for _ in range(8):
                if os.path.isfile(os.path.join(cur, "package.json")):
                    ts_roots.add(cur); break
                parent = os.path.dirname(cur)
                if parent == cur: break
                cur = parent
        if ts_roots:
            ok_in_root = False
            for cwd_abs in build_ok_cwds:
                if not cwd_abs:
                    continue
                for root in ts_roots:
                    if cwd_abs == root or cwd_abs.startswith(root + os.sep):
                        ok_in_root = True; break
                if ok_in_root:
                    break
            if not ok_in_root:
                roots_disp = ", ".join(sorted(ts_roots))[:200]
                issues.append(
                    f"Build OK détecté MAIS hors du projet livré (cwds: {build_ok_cwds[:3]}). "
                    f"Le projet TS est dans : {roots_disp}. "
                    f"Relance `run_command` avec `cwd=<racine du projet>` (où se trouve son package.json), "
                    f"PAS depuis le repo parent."
                )

    if (has_ts_code or any(p.lower().endswith((".js", ".jsx", ".tsx")) for p in code_paths)) and not has_browser_test:
        roots: set[str] = set()
        for p in code_paths:
            cur = os.path.dirname(p)
            for _ in range(6):
                if os.path.isfile(os.path.join(cur, "package.json")):
                    roots.add(cur); break
                parent = os.path.dirname(cur)
                if parent == cur: break
                cur = parent
        for root in roots:
            html_targets = [
                os.path.join(root, "dist", "index.html"),
                os.path.join(root, "build", "index.html"),
                os.path.join(root, "public", "index.html"),
                os.path.join(root, "index.html"),
            ]
            if any(os.path.isfile(h) for h in html_targets):
                issues.append(
                    "Projet web (HTML présent dans le workspace) sans test navigateur. "
                    "Lance browser_navigate file:///… (ou http://localhost:…) puis browser_run_js pour valider "
                    "que le DOM rend correctement (canvas non-null, pas d'erreur console)."
                )
                break

    has_navigate = any(r["name"] == "browser_navigate" for r in tool_results)
    has_run_js = any(r["name"] == "browser_run_js" for r in tool_results)
    if has_navigate and not has_run_js:
        issues.append(
            "browser_navigate exécuté mais AUCUN browser_run_js — test trop superficiel. "
            "Tu DOIS appeler browser_run_js pour vérifier que le DOM rend : "
            "ex. `return document.querySelectorAll('canvas').length` (>=1), "
            "`return !!app && app.stage.children.length > 0`, "
            "`return Array.from(document.querySelectorAll('canvas')).every(c => c.width>0)`."
        )

    is_game = False
    for r in tool_results:
        if r["name"] not in ("write_file", "edit_file"):
            continue
        args = r.get("args") or {}
        content = (args.get("content") or "") if isinstance(args, dict) else ""
        if not content:
            continue
        if ("app.ticker.add" in content or "requestAnimationFrame" in content
            or "from 'pixi.js'" in content or 'from "pixi.js"' in content
            or "new Application(" in content or "phaser" in content.lower()):
            is_game = True; break
    if is_game and has_run_js:
        has_input_sim = False
        for r in tool_results:
            if r["name"] != "browser_run_js":
                continue
            args = r.get("args") or {}
            code = (args.get("code") or "") if isinstance(args, dict) else ""
            if ("KeyboardEvent" in code or "dispatchEvent" in code
                or "keydown" in code.lower() or "input.keys" in code.lower()
                or "player.position" in code.lower() or "stage.children" in code.lower()):
                has_input_sim = True; break
        if not has_input_sim:
            issues.append(
                "Projet jeu détecté (Pixi/raf/ticker) MAIS browser_run_js ne simule aucun input ni n'inspecte "
                "l'état du jeu. Tu DOIS exécuter une preuve gameplay : "
                "`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight'})); "
                "await new Promise(r=>setTimeout(r,200)); return window.__player?.position?.x;` "
                "ou équivalent. Sans ça, 'ça compile' ≠ 'ça joue'."
            )
    if is_game and not has_run_js:
        issues.append(
            "Projet jeu (Pixi/ticker/raf) sans aucun browser_run_js — gameplay non vérifié. "
            "Expose une référence globale (`(window as any).__game = { app, scene, player }`) "
            "puis simule un input et vérifie que la position change."
        )

    if is_game and len(code_paths) >= 10:
        wrote_spec = any(
            r["name"] in ("write_file", "edit_file")
            and ((r.get("args") or {}).get("path") or "").lower().endswith(("spec.md", "design.md", "plan.md"))
            for r in tool_results
        )
        if not wrote_spec:
            issues.append(
                "Aucun SPEC.md / DESIGN.md écrit avant de coder — projet vague livré sans spec. "
                "Écris d'abord `SPEC.md` qui détaille : palette précise (hex), entités (sprites, taille, anim), "
                "mécaniques (collision résolution, dt-scaling), 8 niveaux nommés, conditions win/lose, contrôles. "
                "PUIS code en suivant cette spec."
            )

    return issues
