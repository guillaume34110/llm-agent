"""One-shot seeder for high-value skills the agent commonly hits.

Run: `python -m monkey.seed_skills` — idempotent (skips if already present at v>=seed).
"""
from __future__ import annotations
from monkey import skills_store

SEEDS = [
    {
        "name": "pixijs-v8-graphics-api",
        "description": "PixiJS v8 Graphics API migration (v7 beginFill/drawRect deprecated)",
        "triggers": ["pixi", "pixijs", "graphics", "beginfill", "drawrect", "ts2339", "rect", "fill", "v8"],
        "content": """[SKILL PixiJS v8 Graphics — migration v7→v8]

Disclaimer: vérifie la version installée avant d'appliquer (`npm ls pixi.js`).

DÉTECTION
- `error TS2339: Property 'rect' does not exist on type 'Graphics'` → pixi v7 installé, code v8 écrit.
- `error TS2339: Property 'beginFill' does not exist` → pixi v8 installé, code v7 écrit.

RÈGLE
- pixi.js >= 8.0.0 : utilise la NOUVELLE API chainable (`.rect().fill()`).
- pixi.js < 8.0.0 : utilise l'ANCIENNE API (`beginFill/drawRect/endFill`).
- NE MIX JAMAIS les deux dans le même projet.

API V8 (chainable)
```ts
g.rect(x, y, w, h).fill({ color: 0xff00ff });
g.circle(cx, cy, r).fill(0xffffff);
g.rect(0,0,10,10).stroke({ color: 0x00ff00, width: 2 });
g.moveTo(0,0).lineTo(10,10).stroke({ width: 1, color: 0xffffff });
```

API V7 (procedural — DEPRECATED en v8)
```ts
g.beginFill(0xff00ff); g.drawRect(x, y, w, h); g.endFill();
g.lineStyle(1, 0xffffff); g.moveTo(0,0); g.lineTo(10,10);
```

TICKER V8 (breaking)
- Le callback reçoit maintenant `Ticker`, plus `number`.
```ts
app.ticker.add((ticker) => { const dt = ticker.deltaTime; ... });
```

PROCÉDURE EN CAS D'ERREUR
1. `cat package.json | grep pixi` ou `npm ls pixi.js` pour confirmer la version.
2. Choisir UNE API et la respecter.
3. Si tu veux v8 mais le projet est en v7 : `npm install pixi.js@^8` puis migrer le code.
4. Re-build : `npm run build` doit retourner exit 0.

SOURCES:
- https://pixijs.com/8.x/guides/migrations/v8
- https://pixijs.download/release/docs/scene.Graphics.html
- https://github.com/pixijs/pixijs/releases/tag/v8.0.0
""",
        "sources": [
            "https://pixijs.com/8.x/guides/migrations/v8",
            "https://pixijs.download/release/docs/scene.Graphics.html",
        ],
    },
    {
        "name": "edit-file-stale-old-str-recovery",
        "description": "Recover from edit_file 'chaîne introuvable' / 'string not found' errors",
        "triggers": ["edit_file", "introuvable", "not found", "stale", "old_str", "chaine", "string"],
        "content": """[SKILL edit_file stale_old_str — recovery procedure]

SYMPTÔME
- `Erreur: chaîne introuvable dans <path>` ou `string not found`.
- Le `old_str` envoyé ne correspond plus au contenu réel du fichier.

CAUSES PROBABLES
1. Tu te souviens d'une ancienne version (cache mental après plusieurs edits).
2. Espaces/indentation différents (tabs vs spaces, trailing spaces).
3. Le fichier vient d'être réécrit complètement par `write_file`.
4. Le `old_str` contient des escapes (\\n) au lieu de vrais newlines.

PROCÉDURE OBLIGATOIRE — ne re-tente jamais le même `old_str`
1. Appelle `open_file` ou `read_file` sur le path AVANT de retenter.
2. Identifie un fragment UNIQUE de 3-5 lignes EXACTEMENT comme dans le fichier (copier-coller mental, pas de reformatage).
3. Si la modif touche plusieurs zones : fais un edit par zone, pas un edit géant.
4. Si trop de divergences accumulées : réécris le fichier complet via `write_file`.

ANTI-PATTERN
- Ne PAS répéter le même `old_str` 3 fois en espérant que ça marche.
- Ne PAS deviner — relire d'abord.

QUICK CHECK
- Si tu as fait `write_file` puis veux `edit_file` : tu DOIS d'abord `read_file`.

SOURCES:
- https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- https://github.com/anthropics/anthropic-cookbook
""",
        "sources": [
            "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
        ],
    },
    {
        "name": "vite-typescript-pixi-game-scaffold",
        "description": "Scaffold a Vite + TypeScript + PixiJS game project that builds clean first try",
        "triggers": ["vite", "typescript", "pixi", "game", "scaffold", "tsconfig", "package.json", "setup"],
        "content": """[SKILL Vite + TS + PixiJS — scaffold qui build du premier coup]

OBJECTIF
Bootstrap d'un projet TS/Vite/PixiJS où `npm run build` passe exit 0 dès l'init.

ÉTAPES (ORDRE STRICT)
1. `mkdir -p <project>/src/{scenes,entities,levels} && cd <project>`
2. Écris `package.json` :
```json
{
  "name": "<project>",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": { "pixi.js": "^8.0.0" },
  "devDependencies": { "typescript": "^5.4.0", "vite": "^5.2.0" }
}
```
3. Écris `tsconfig.json` :
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": false,
    "noFallthroughCasesInSwitch": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src"]
}
```
4. Écris `index.html` à la racine du projet (Vite convention) :
```html
<!doctype html><html><head><meta charset="UTF-8"><title><project></title></head>
<body style="margin:0;background:#000"><div id="app"></div>
<script type="module" src="/src/main.ts"></script></body></html>
```
5. Écris `src/main.ts` minimal qui démarre Pixi v8 :
```ts
import { Application } from "pixi.js";
const app = new Application();
await app.init({ width: 320, height: 288, background: 0x0a0a23 });
document.getElementById("app")!.appendChild(app.canvas);
(window as any).__game = { app };
```
6. `npm install` (dans le cwd du projet, PAS le parent).
7. `npm run build` — DOIT retourner exit 0.

PIÈGES À ÉVITER
- `cwd` mal placé : toujours `cd <project>` avant `npm install` / `npm run build`.
- API Pixi v7 mélangée à v8 (voir skill PixiJS).
- Oubli de `index.html` à la racine → Vite échoue silencieusement.
- `"type": "module"` manquant → erreurs ESM.

VALIDATION
- `npm run build` exit 0
- `dist/index.html` existe
- `(window as any).__game` exposé pour tests browser_run_js

SOURCES:
- https://vitejs.dev/guide/
- https://pixijs.com/8.x/guides/basics/getting-started
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html
""",
        "sources": [
            "https://vitejs.dev/guide/",
            "https://pixijs.com/8.x/guides/basics/getting-started",
        ],
    },
]


def main() -> None:
    seeded = []
    skipped = []
    for s in SEEDS:
        existing = skills_store.get_learned(s["name"])
        if existing and existing.get("version", 0) >= 1 and "[SEED]" in (existing.get("description") or ""):
            skipped.append(s["name"])
            continue
        skills_store.save_learned(
            name=s["name"],
            description="[SEED] " + s["description"],
            triggers=s["triggers"],
            content=s["content"],
            sources=s["sources"],
        )
        seeded.append(s["name"])
    print(f"Seeded: {seeded}")
    print(f"Skipped: {skipped}")


if __name__ == "__main__":
    main()
