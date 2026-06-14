"""Repo-skills runtime tools.

Exposes :
  - repo_skill_list                 — list curated GitHub-repo skills
  - repo_skill_search(query)        — find best matching repo skills
  - repo_skill_show(name)           — full card (install + usage + notes)
  - repo_skill_install(name, cwd?)  — run the install snippet via shell

These wrap monkey/repo_skills.py REPO_SKILLS registry.
"""
from __future__ import annotations
import json
import shlex
import subprocess
from pathlib import Path

from monkey import repo_skills


def repo_skill_list() -> str:
    out = [
        {
            "name": r["name"],
            "repo": r["repo"],
            "category": r["category"],
            "when_to_use": r["when_to_use"],
        }
        for r in repo_skills.REPO_SKILLS
    ]
    return json.dumps({"total": len(out), "items": out}, ensure_ascii=False, indent=2)


def repo_skill_search(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return "ERREUR: query vide"
    hits = repo_skills.search(q, top_k=5)
    if not hits:
        return f"Aucun repo skill ne match: {q!r}. Liste complète via repo_skill_list."
    out = [
        {"score": s, "name": r["name"], "repo": r["repo"],
         "category": r["category"], "when_to_use": r["when_to_use"]}
        for s, r in hits
    ]
    return json.dumps(out, ensure_ascii=False, indent=2)


def repo_skill_show(name: str) -> str:
    r = repo_skills.by_name((name or "").strip())
    if not r:
        return f"ERREUR: repo skill '{name}' inconnu. Utilise repo_skill_list."
    return repo_skills.render_card(r)


VALID_KITS = ("platformer", "metroidvania", "topdown-rpg", "shmup", "puzzle")
VALID_BIOMES = (
    "grass", "dirt", "stone", "sand", "cave", "metal", "snow",
    "lava", "ice", "water", "swamp", "desert", "forest", "mushroom",
    "castle", "beach",
)


def scaffold_game_2d(
    target_dir: str,
    kit: str = "platformer",
    biomes: list[str] | None = None,
    name: str = "game-2d-ts",
    title: str | None = None,
    tuning: dict | None = None,
) -> str:
    """Scaffold a complete 2D game project (Phaser 3 + TS + Vite + AI docs).

    All gameplay parameters are settable at scaffold time — no post-edit needed.

    Args:
        target_dir: destination directory.
        kit ∈ {platformer, metroidvania, topdown-rpg, shmup, puzzle}: selects genre.
        biomes: optional whitelist among {grass, dirt, stone, sand, cave, metal,
            snow, lava, ice, water, swamp, desert, forest, mushroom, castle, beach}.
            None or empty → all biomes baked in.
        name: package.json `name` (default 'game-2d-ts').
        title: HTML page title; defaults to `name`.
        tuning: deep-merge dict overriding CONFIG. Sections + keys:
            DEBUG: bool
            WORLD: VIEW_WIDTH, VIEW_HEIGHT, LEVEL_WIDTH, LEVEL_HEIGHT, GRAVITY, TILE
            PLAYER: SPEED, JUMP_VELOCITY, MAX_FALL_SPEED, COYOTE_TIME_MS,
                    JUMP_BUFFER_MS, LIVES, HIT_INVUL_MS
            ENEMY: PATROL_SPEED, DAMAGE
            CAMERA: LERP, SHAKE_INTENSITY, SHAKE_DURATION_MS, DEADZONE_W, DEADZONE_H
            AUDIO: MASTER_VOLUME, MUSIC_VOLUME, SFX_VOLUME
            PALETTE: BG, PLAYER, ENEMY, PLATFORM, COIN, HUD (ints, rendered as 0xRRGGBB)
            SAVE_KEY: str
            Unknown keys → ERREUR.
            Example: tuning={"PLAYER": {"SPEED": 220, "JUMP_VELOCITY": -400},
                             "WORLD": {"GRAVITY": 1100},
                             "PALETTE": {"PLAYER": 0xff00aa}}

    After: `cd <target> && npm install && npm run build`, then open `file:///ABS/PATH/dist/index.html` for a reliable agent smoke test.
    Tests: `npm test` (unit) / `npm run test:e2e` (Playwright, run `npx playwright install` first).
    """
    if not target_dir:
        return "ERREUR: target_dir requis"
    kit = (kit or "platformer").strip()
    if kit not in VALID_KITS:
        return f"ERREUR: kit '{kit}' inconnu. Valides: {', '.join(VALID_KITS)}"
    if biomes:
        bad = [b for b in biomes if b not in VALID_BIOMES]
        if bad:
            return f"ERREUR: biome(s) inconnus {bad}. Valides: {', '.join(VALID_BIOMES)}"
    name = (name or "game-2d-ts").strip() or "game-2d-ts"
    from monkey.templates import game_2d_ts
    try:
        result = game_2d_ts.apply(
            target_dir, kit=kit, biomes=biomes,
            name=name, title=title, tuning=tuning,
        )
    except ValueError as e:
        return f"ERREUR: tuning invalide — {e}"
    except Exception as e:
        return f"ERREUR: scaffold échec — {e}"
    out = [
        f"OK: scaffolded 2D game template (kit={kit}, name={result['name']}) into {result['root']}",
        f"  files created: {len(result['created'])}",
        f"  files skipped (already exist): {len(result['skipped'])}",
    ]
    if tuning:
        out.append(f"  tuning applied to: {', '.join(sorted(tuning.keys()))}")
    out += [
        "",
        "Next steps:",
        f"  cd {result['root']}",
        "  npm install",
        "  npm run build",
        f"  browser_navigate file://{result['root']}/dist/index.html",
        "",
        f"Read {result['root']}/AGENT.md before editing.",
        "All gameplay numbers were baked into src/config.ts at scaffold time.",
    ]
    return "\n".join(out)


VALID_FULLSTACK_FEATURES = (
    "auth", "users", "settings", "uploads", "dashboard", "notifications",
)


def scaffold_app_fullstack(
    target_dir: str,
    name: str = "my-app",
    features: list[str] | None = None,
) -> str:
    """Scaffold a full-stack TypeScript app (NestJS + Prisma + Postgres + React + Redux + Tailwind/shadcn).

    Strict 4-layer backend (controller → service → logic|repository), Redux-only frontend
    business logic. Tailwind + shadcn UI primitives baked in. Tests at every layer.

    Args:
        target_dir: where to write files (created if missing).
        name: workspace package name (root package.json).
        features: any subset of {auth, users, settings, uploads, dashboard, notifications}.
                  Pass None or [] for the bare skeleton (health feature only).
                  users/settings/uploads/dashboard auto-enable auth if missing.

    After: `cd <target> && npm install && docker compose up -d db &&
    npm run -w apps/server prisma:migrate && npm run dev`.
    Tests: `npm run -w apps/server test`, `npm run -w apps/web test`.
    """
    if not target_dir:
        return "ERREUR: target_dir requis"
    name = (name or "my-app").strip() or "my-app"
    feats = features or []
    bad = [f for f in feats if f not in VALID_FULLSTACK_FEATURES]
    if bad:
        return (
            f"ERREUR: feature(s) inconnues {bad}. "
            f"Valides: {', '.join(VALID_FULLSTACK_FEATURES)}"
        )
    from monkey.templates import app_fullstack_ts
    try:
        result = app_fullstack_ts.apply(target_dir, name=name, features=feats)
    except Exception as e:
        return f"ERREUR: scaffold échec — {e}"
    out = [
        f"OK: scaffolded fullstack app '{name}' into {result['root']}",
        f"  features: {', '.join(result['features']) if result['features'] else '(skeleton only)'}",
        f"  files created: {len(result['created'])}",
        f"  files skipped (already exist): {len(result['skipped'])}",
    ]
    if result.get("auto_added_features"):
        out.append(f"  auto-enabled deps: {', '.join(result['auto_added_features'])}")
    out += [
        "",
        "Next steps:",
        f"  cd {result['root']}",
        "  npm install",
        "  docker compose up -d db",
        "  npm run -w apps/server prisma:migrate",
        "  npm run dev",
        "",
        f"Read {result['root']}/AGENT.md before editing.",
        "Layer rules: controller→service→{logic|repository}. No Prisma in logic. No fetch in components.",
    ]
    return "\n".join(out)


def repo_skill_install(name: str, cwd: str = "") -> str:
    r = repo_skills.by_name((name or "").strip())
    if not r:
        return f"ERREUR: repo skill '{name}' inconnu."
    install = r.get("install", "").strip()
    if not install or "<project>" in install or "<dir>" in install:
        return (
            f"ERREUR: install command requires manual placeholder substitution. "
            f"Voir card via repo_skill_show('{name}'). Snippet: {install}"
        )
    work = Path(cwd).expanduser() if cwd else Path.cwd()
    if not work.exists():
        return f"ERREUR: cwd '{work}' n'existe pas."
    try:
        proc = subprocess.run(
            install, shell=True, cwd=str(work),
            capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        return f"ERREUR: install timeout (>600s) pour '{name}'."
    except Exception as e:
        return f"ERREUR: install échec — {e}"
    tail = (proc.stdout or "")[-1500:] + "\n" + (proc.stderr or "")[-1500:]
    if proc.returncode != 0:
        return f"ERREUR: install rc={proc.returncode}\n{tail}"
    return f"OK: '{name}' installé dans {work}\n{tail}"
