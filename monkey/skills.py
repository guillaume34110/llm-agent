"""Stack-specific skill bundles auto-injected into SYSTEM_PROMPT.

Each skill = (regex matching user_message OR workspace, guidance text).
Only matched skills are concatenated, keeping the prompt lean.
"""
from __future__ import annotations
import re
from monkey import skills_store

# (name, pattern, content) — kept for legacy consumers / tests
_SKILLS: list[tuple[str, re.Pattern, str]] = []


def _add(name: str, pattern: str, content: str) -> None:
    pat = re.compile(pattern, re.IGNORECASE)
    body = content.strip()
    _SKILLS.append((name, pat, body))
    desc = body.split("\n", 1)[0][:200]
    skills_store.register_builtin(name, pat, body, desc)


# ─────────────────────────────────────────────────────────────────────────────
_add(
    "typescript",
    r"(\btypescript\b|\.ts\b|\btsx\b|\btsc\b|\btsconfig\b|\bts\b)",
    """
[SKILL TypeScript — discipline stricte]

NOMMAGE (non-négociable) :
- Classes, interfaces, types, enums : `PascalCase` (`Player`, `LevelDef`, `GameObject`).
- Fonctions, variables, méthodes : `camelCase` (`loadLevel`, `isGrounded`, `playerSpeed`).
- Constantes globales : `SCREAMING_SNAKE` (`GRAVITY`, `SCREEN_WIDTH`).
- Fichier = nom du symbole exporté principal en kebab ou même casse : `Player.ts` exporte `class Player`. `level-def.ts` ou `LevelDef.ts` exporte `interface LevelDef`. Sois cohérent dans TOUT le projet — choisis kebab OU PascalCase pour les fichiers, ne mélange pas.

IMPORTS (anti-erreur TS2307) :
- AVANT chaque `import { Foo } from './bar'` : vérifie dans [ÉTAT PROJET] que `bar.ts` existe ET exporte `Foo`. Si absent → tu DOIS le créer d'abord (write_file) avant d'importer.
- Chemin relatif depuis le fichier courant : `../core/types` depuis `entities/Player.ts`. Compte les `..`.
- Index files (`index.ts`) : optionnel, mais si tu en crées un, exporte tout via `export * from './player'` PAS `export { Player } from './player'` à moitié.
- Pas d'extension dans imports TS (`from './player'` pas `'./player.ts'`).

TYPES (anti-erreur TS2339, TS2352) :
- Avant `obj.foo`, vérifie que `foo` est dans la déclaration du type de `obj`. Si tu as oublié, lis le fichier d'origine via `read_file`.
- JAMAIS `as Foo` quand les shapes ne matchent pas → construis l'objet complet avec TOUTES les props requises.
- Tuple : `[number, number]`. Array indexable par littéral entier.
- `noUncheckedIndexedAccess` actif : `arr[0]` est `T | undefined`.

UNUSED (anti-erreur TS6133) :
- IMPORTANT : `_prefix` ne silence QUE les paramètres, PAS les variables locales. Pour locals → SUPPRIME, n'y a pas de `_unused` qui marche en local.
- Import non utilisé → SUPPRIME-le complètement (pas de "au cas où").
- Paramètre callback non utilisé : `(_event) => ...` OK (parameters seulement) ou drop-le.
- Si TS6133 sur ta variable locale : (a) utilise-la vraiment, OU (b) supprime-la, OU (c) en dernier recours désactive `noUnusedLocals` dans `tsconfig.json`.

NODE_MODULES (interdiction absolue) :
- JAMAIS `rm -rf node_modules`. JAMAIS `rm package-lock.json`. Jamais nuke pour "repartir propre".
- Si un build échoue avec TS2339 sur des méthodes Pixi/lib (`.rect`, `.circle`, `.fill`) ou TS2305 sur exports → c'est PROBABLEMENT que `node_modules` est cassé/incomplet, PAS ton code. `npm install` (sans rm) suffit.
- Erreur TS2339 sur ta propre classe = ton code. Erreur TS2339 sur API d'une lib externe = vérifie la version installée AVANT de modifier ton code (`cat node_modules/<lib>/package.json | grep version`).
- Si tu nukes node_modules, tu perds 50+ itérations à courir derrière des erreurs fantômes. NE LE FAIS PAS.

VERBATIM MODULE SYNTAX (anti-erreur TS1484) :
- Vite vanilla-ts active `"verbatimModuleSyntax": true` → `import type { Foo }` OBLIGATOIRE pour types/interfaces.
- Règle simple : si tu importes uniquement pour annoter (`: Foo`, `extends Foo`, `implements Foo`) → `import type { Foo } from '...'`.
- Si tu importes une CLASSE que tu instancies → `import { Foo } from '...'` (sans `type`).
- Mixte : sépare `import { Class1 } from '...'` et `import type { Type1 } from '...'`.

CONSTRUCTORS (anti-erreur TS2554) :
- Une fois un ctor défini, c'est CONTRACTUEL. JAMAIS changer la signature en cours de route.
- Choisis UN style et applique-le à TOUTES les entités du projet :
  - Style A — positional : `constructor(x: number, y: number)` → appelle `new Foo(10, 20)`.
  - Style B — options object : `constructor(opts: { x: number; y: number })` → appelle `new Foo({ x: 10, y: 20 })`.
- Vérifie systématiquement après écriture de la classe : grep tous les `new ClassName(` dans le projet et aligne-les.
- Le style B est PRÉFÉRÉ pour entités avec >2 paramètres (lisibilité), le style A pour 1-2 params primitifs.

CONFIG :
- `tsconfig.json` projet généré web : garde `strict:true`. `verbatimModuleSyntax:true` est l'usage moderne (Vite default).
- Si tu vois trop de TS6133 sur variables locales légitimes (work-in-progress) → mets `"noUnusedLocals": false` dans `tsconfig.json` `compilerOptions`.
- Toujours `npm run build` entre chaque batch de modifs sensibles. Build rouge → fixe avant de continuer.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "vite",
    r"\b(vite|\.vite|vite\.config|pixi|pixie|phaser|three\.js|threejs|webgl)\b",
    """
[SKILL Vite — workflow stricte]

SCAFFOLD :
- `npm create vite@latest . -- --template vanilla-ts` génère démo : `src/counter.ts`, `src/typescript.svg`, `public/vite.svg`, `src/style.css`, `index.html` avec contenu jetable. SUPPRIME-les AVANT de coder (`rm src/counter.ts src/typescript.svg public/vite.svg`) et écrase `src/main.ts` + `index.html` avec ton bootstrap propre.
- Vérifie `package.json` après `npm install` : note la version exacte de chaque lib (pixi.js v8 ≠ v7 → API différente).

ENTRY POINT :
- `index.html` doit charger `<script type="module" src="/src/main.ts"></script>`. Pas d'autre script.
- `src/main.ts` est le SEUL point d'entrée. Toute autre logique vit dans modules importés depuis `main.ts`.
- Canvas : crée-le dans `index.html` avec `<div id="app"></div>` puis `app.canvas` injecté en JS. NE crée PAS deux canvas.

BUILD/TEST :
- `npm run build` (= `tsc && vite build`) DOIT exit 0 avant tout E2E. Lis stderr en cas d'erreur, fixe, relance.
- E2E sans dev-server : `npm run build` puis `browser_navigate file:///abs/path/dist/index.html`. Plus fiable que dev-server.
- Si dev-server : background ET attends 2-3s avant `browser_navigate http://localhost:5173`.

CONFIG :
- Pour PixiJS : `optimizeDeps: { include: ['pixi.js'] }` dans `vite.config.ts` si imports lents.
- `tsconfig.json` Vite vanilla-ts a `"moduleResolution": "bundler"` — laisse-le, ne change pas.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "pixi",
    r"\b(pixi|pixie|pixijs|pixi\.js)\b",
    """
[SKILL PixiJS — API stricte par version]

VERSION (CRITIQUE) :
- npm install pixi.js → v8 par défaut. v8 et v7 ont des API DIFFÉRENTES — JAMAIS mélanger.
- Vérifie `package.json` après install. Si v8 → applique règles v8. Si tu veux v7, fixe `"pixi.js": "^7.4.0"` AVANT `npm install`.

API v8 (ce que tu utilises par défaut) :
- `import { Application, Container, Graphics, Sprite, Assets, Text } from 'pixi.js'` (pas de sous-paths).
- Init ASYNC : `const app = new Application(); await app.init({ width, height, background: 0x1a1a2e, antialias: false });` puis `document.getElementById('app')!.appendChild(app.canvas);`
- `app.canvas` (HTMLCanvasElement). PAS `app.view`.
- `Graphics` chainable : `g.rect(x,y,w,h).fill(0xff0000)`, `g.circle(x,y,r).fill(c)`, `g.moveTo().lineTo().stroke({ color, width })`. JAMAIS `beginFill/drawRect/endFill` (v7).
- Assets : `await Assets.load('sprite.png'); const s = new Sprite(Assets.get('sprite.png'));` ou `Sprite.from('url')` après load.
- Ticker : `app.ticker.add((ticker) => { const dt = ticker.deltaTime; update(dt); });` Le callback reçoit un Ticker, pas un nombre.
- Container : `addChild`, `removeChild`, `position.set(x,y)`, `scale.set(s)`, `pivot.set`. Inchangé v7→v8.
- Text : `new Text({ text: 'hello', style: { fontFamily: 'monospace', fontSize: 16, fill: 0xffffff } })`.

NOMMAGE PIXI :
- Une instance `app: Application`. UNE seule par projet.
- `stage = app.stage` (Container racine). Tes scènes vivent en enfants de `stage`.
- Sprite/Graphics : nom = rôle (`playerSprite`, `groundGfx`, `enemyContainer`).

GOTCHAS :
- `app.screen.width/height` pour la taille de rendu. PAS `app.view.width` (n'existe pas en v8).
- Game-loop : ne crée JAMAIS de Graphics dans le ticker — réutilise et `clear()` puis redessine si tu animes une forme procédurale.
- Pas besoin de `@types/pixi.js` — types inclus.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "web-game",
    r"\b(jeu|game|platformer|plateformer|mario|sonic|2d|sprite|gameboy|arcade)\b",
    """
[SKILL Web-Game architecture — structure imposée + gameplay réel]

PHASE 0 — SPEC.md AVANT le code (obligatoire si prompt vague) :
- Écris `SPEC.md` à la racine du projet AVANT d'écrire 5+ fichiers TS.
- Doit contenir : palette précise (3-6 couleurs hex), liste entités (sprites/taille/anim/comportement), mécaniques (collision résolution, dt-scaling, gravité, jump force), N niveaux nommés avec thème, conditions win/lose, contrôles, HUD.
- Tu DOIS respecter cette spec dans le code, pas dériver vers du minimaliste vide.

ARBORESCENCE (à respecter EXACTEMENT) :
```
src/
  main.ts              ← bootstrap : crée app, lance scene initiale
  core/
    types.ts           ← TOUTES les interfaces partagées (GameObject, Rect, Vec2, LevelDef)
    constants.ts       ← SCREEN_WIDTH, SCREEN_HEIGHT, GRAVITY, TILE_SIZE (SCREAMING_SNAKE)
    Input.ts           ← class Input (singleton) — keydown/keyup → isDown(key)
    Game.ts            ← class Game — orchestrateur scenes + ticker
  entities/
    Player.ts          ← class Player implements GameObject
    Enemy.ts           ← class Enemy implements GameObject
    Platform.ts        ← class Platform implements GameObject
  levels/
    level1.ts ... levelN.ts  ← export const Level1: LevelDef = { ... }
    index.ts           ← export const ALL_LEVELS: LevelDef[] = [Level1, Level2, ...]
  scenes/
    Scene.ts           ← interface Scene { enter(); exit(); update(dt); }
    PlayScene.ts       ← implements Scene
    MenuScene.ts, GameOverScene.ts
```

TYPES PARTAGÉS (dans `core/types.ts`, JAMAIS dupliqués) :
```ts
export interface Vec2 { x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }
export interface GameObject {
  position: Vec2;
  size: { width: number; height: number };
  update(dt: number): void;
  // sprite/container ajouté par chaque entité, pas dans le contract
}
export interface LevelDef {
  id: number;
  name: string;
  platforms: Rect[];
  enemies: { x: number; y: number; type: string }[];
  playerStart: Vec2;
  goal: Rect;             // ← Rect, PAS Vec2 — sinon collision impossible
  width: number;          // largeur totale du niveau (peut > screen)
  bgTheme?: string;
}
```
**`goal: Rect` non négociable** — si tu mets `Vec2` tu ne peux pas faire d'AABB pour la win condition.

Une fois ces types posés, NE LES MODIFIE PAS sans raison. Si tu veux ajouter un champ, ajoute-le dans `types.ts` PUIS adapte les implémentations.

COLLISION AABB + RÉSOLUTION AXE PAR AXE (le seul pattern qui marche) :
```ts
function aabb(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width
      && a.x + a.width > b.x
      && a.y < b.y + b.height
      && a.y + a.height > b.y;
}

// Résolution : déplacer X puis résoudre X, ensuite Y puis résoudre Y.
// JAMAIS bouger les deux axes d'un coup et tenter de "deviner" quel côté a touché.
function moveAndCollide(player: Player, dx: number, dy: number, platforms: Rect[]) {
  // X axis
  player.position.x += dx;
  for (const p of platforms) {
    if (!aabb(player.rect(), p)) continue;
    if (dx > 0) player.position.x = p.x - player.size.width;
    else if (dx < 0) player.position.x = p.x + p.width;
  }
  // Y axis
  player.position.y += dy;
  player.isGrounded = false;
  for (const p of platforms) {
    if (!aabb(player.rect(), p)) continue;
    if (dy > 0) {
      player.position.y = p.y - player.size.height;
      player.velocity.y = 0;
      player.isGrounded = true;
    } else if (dy < 0) {
      player.position.y = p.y + p.height;
      player.velocity.y = 0;
    }
  }
}
```
- **JAMAIS** définir `collidePlatform` mais oublier de l'appeler. Si tu ajoutes une méthode de collision, elle DOIT être appelée à chaque frame dans `update()`.
- **JAMAIS** mélanger `position += velocity` puis `collide()` séparément ailleurs — utilise `moveAndCollide` ou inline le pattern.

DT-SCALING (consistance frame-rate) :
```ts
// main.ts ticker:
app.ticker.add((ticker) => {
  const dt = ticker.deltaTime; // 1.0 = 60fps frame; 2.0 = 30fps
  scene.update(dt);
});

// Player.update(dt):
this.velocity.y += GRAVITY * dt;        // multiplier dt sur les forces
const dx = this.velocity.x * dt;
const dy = this.velocity.y * dt;
moveAndCollide(this, dx, dy, platforms);
```
- N'inverse pas dt avec /60 — `ticker.deltaTime` est déjà en frames-équivalent-60fps.
- Toute valeur ajoutée à velocity ou position DOIT être multipliée par `dt`.

INPUT (UN seul listener global) :
- `Input.init()` appelé UNE fois dans `main.ts`. Ajoute `window.addEventListener('keydown'/'keyup', ...)`.
- `Input.isDown('ArrowLeft')`, `Input.isDown('Space')`, `Input.isDown('KeyZ')`. Utilise `event.code` (pas `event.key`).
- Aucune entité n'écoute le clavier directement.

LEVELS + TRANSITIONS :
- N niveaux → N fichiers `level1.ts ... levelN.ts` chacun `export const LevelN: LevelDef = {...}`. + `levels/index.ts` agrégateur (`ALL_LEVELS`).
- `loadLevel(def)` DOIT instancier : platforms, enemies, goal, player (avec position = playerStart). N'oublie AUCUNE de ces 4 catégories.
- Transition : à chaque frame, si `aabb(player.rect(), goal)` → `loadLevel(ALL_LEVELS[++levelIndex])` ou écran "you win" si dernier.
- Game over : si `aabb(player.rect(), enemy.rect())` ou `player.position.y > level.height + 200` → reset au playerStart du level courant.

CAMERA (si level.width > screen.width) :
- Container `world` enfant de `scene.container`. Tous les platforms/enemies/player dans `world`.
- À chaque frame : `world.position.x = -clamp(player.position.x - SCREEN_WIDTH/2, 0, level.width - SCREEN_WIDTH)`.
- Si tu n'implémentes pas la caméra, contrains `level.width <= SCREEN_WIDTH` strictement.

HUD (toujours visible) :
- `Text` pour nom du niveau + score/lives. Ajouté à `scene.container` directement (PAS dans `world`) pour rester fixe à l'écran.

SCENES (contrat strict) :
```ts
export interface Scene {
  container: Container;
  enter(): void;        // 0 args. Setup interne (Input.init, listeners).
  exit(): void;         // 0 args. Cleanup.
  update(dt: number): void;
}
```
- `enter()` ne PREND PAS le stage en argument. Le code appelant fait :
  `app.stage.addChild(scene.container); scene.enter();`
- `exit()` symétrique : `scene.exit(); app.stage.removeChild(scene.container);`
- JAMAIS `scene.enter(app.stage)` — c'est l'erreur TS2554 qui boucle pendant 50 itérations.

GAME LOOP :
- UNE seule `app.ticker.add` dans `Game.ts` ou `main.ts`. Elle appelle `currentScene.update(ticker.deltaTime)`.
- Le ticker callback reçoit un `Ticker` en v8, pas un nombre. Lis `.deltaTime` dessus.

E2E TEST GAMEPLAY (preuve obligatoire — pas juste "ça compile") :

ÉTAPE 1 — expose l'état du jeu en global pour pouvoir l'inspecter :
```ts
// main.ts, après création des objets:
(window as any).__game = { app, scene: playScene, get player() { return playScene.player; } };
```

ÉTAPE 2 — `npm run build` → exit 0, dist/ produit.

ÉTAPE 3 — sers en local : `npx serve dist -p 8080` (run_command run_in_background:true).

ÉTAPE 4 — `browser_navigate http://localhost:8080/`.

ÉTAPE 5 — `browser_run_js` vérifications structurelles :
```js
return {
  canvas: document.querySelectorAll('canvas').length,
  stageChildren: window.__game?.app?.stage?.children?.length,
  hasPlayer: !!window.__game?.player,
  errors: window.__lastErrors || []
};
```
Doit retourner `{ canvas: 1, stageChildren: >=1, hasPlayer: true, errors: [] }`.

ÉTAPE 6 — `browser_run_js` simulation gameplay (CRITIQUE — sans ça, faux positif structurel) :
```js
const startX = window.__game.player.position.x;
const startY = window.__game.player.position.y;
// Simule "marcher à droite" pendant 30 frames
for (let i=0; i<30; i++) {
  window.dispatchEvent(new KeyboardEvent('keydown', {code:'ArrowRight'}));
  await new Promise(r => requestAnimationFrame(r));
}
window.dispatchEvent(new KeyboardEvent('keyup', {code:'ArrowRight'}));
const movedX = window.__game.player.position.x - startX;
// Simule un saut
window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space'}));
await new Promise(r => setTimeout(r, 50));
const jumpedY = window.__game.player.position.y - startY; // négatif si monte
return { movedX, jumpedY, grounded: window.__game.player.isGrounded };
```
Attendu : `movedX > 20` (le joueur a vraiment bougé), `jumpedY < 0` à un moment, `grounded` change selon collision.

ÉTAPE 7 — `browser_screenshot` preuve visuelle finale.

Si une étape échoue, FIXE LE BUG, ne valide pas. Un canvas blanc n'est pas un jeu.

MINIMALISME ≠ VIDE :
- "Minimaliste" veut dire mécaniques simples + esthétique épurée. PAS "1 cercle + 1 rectangle = sprite final".
- Personnages : minimum un sprite distinguable (multi-Graphics composé : crâne + corps + détails) OU une texture procédurale via Sprite (cf skill `pixel-art-svg`).
- Background : minimum un fond stylisé (grille, dégradé, silhouettes) — pas un aplat uni.
- Pas de framework de scène externe, pas de physics engine, pas de tween lib. Tout fait main, ~800-2000 LOC pour un platformer N niveaux.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "cyberpunk-aesthetic",
    r"\b(cyberpunk|néon|neon|synthwave|retrowave|gameboy)\b",
    """
[SKILL Cyberpunk aesthetic]
Si le brief mentionne "cyberpunk", "néon", "synthwave", "rétro futuriste" : applique cette palette + ce traitement visuel SANS exception.

PALETTE (à mettre dans `core/constants.ts`):
```ts
export const COLORS = {
  BG_DEEP: 0x0a0014,      // fond le plus sombre
  BG_MID: 0x1a0033,       // mid-ground
  GRID: 0x2a0a4a,         // lignes de grille discrètes
  NEON_PINK: 0xff006e,    // accent principal (joueur)
  NEON_PURPLE: 0x8338ec,  // ennemis / hazards
  NEON_BLUE: 0x3a86ff,    // plateformes / structure
  NEON_GREEN: 0x06ffa5,   // pickups / goal
  NEON_YELLOW: 0xffbe0b,  // alertes
  WHITE: 0xf5f5ff,        // texte HUD
} as const;
```
PixiJS Application: `background: 0x0a0014`. JAMAIS le vert GameBoy `0x0f380f` si le brief dit cyberpunk.

BACKGROUND OBLIGATOIRE (au moins 2 couches dans le world Container, ajoutées AVANT plateformes):
1. **Grid scanlines** : un Graphics qui trace verticales+horizontales tous les 32px en `COLORS.GRID` avec alpha 0.4. Pose-le derrière tout.
2. **Building silhouettes** : 5-12 rectangles noirs `0x000000` aux hauteurs aléatoires en milieu d'écran. Ajoute 1-3 fenêtres allumées aléatoires (petits rect `NEON_YELLOW` ou `NEON_PINK`) par building.
3. (bonus) Horizon line : 1 ligne horizontale `NEON_PINK` à mi-hauteur, alpha 0.6.

```ts
// scenes/CyberpunkBg.ts
export function buildCyberpunkBg(width: number, height: number): Container {
  const c = new Container();
  const grid = new Gfx();
  for (let x = 0; x <= width; x += 32) grid.moveTo(x, 0).lineTo(x, height);
  for (let y = 0; y <= height; y += 32) grid.moveTo(0, y).lineTo(width, y);
  grid.stroke({ width: 1, color: COLORS.GRID, alpha: 0.4 });
  c.addChild(grid);

  const horizon = new Gfx().moveTo(0, height * 0.55).lineTo(width, height * 0.55).stroke({ width: 2, color: COLORS.NEON_PINK, alpha: 0.6 });
  c.addChild(horizon);

  for (let i = 0; i < 10; i++) {
    const bw = 40 + Math.random() * 80;
    const bh = 80 + Math.random() * 200;
    const bx = i * (width / 10) + Math.random() * 20;
    const by = height * 0.55 - bh;
    const b = new Gfx().rect(bx, by, bw, bh).fill(0x000000);
    for (let w = 0; w < 3; w++) {
      if (Math.random() < 0.6) {
        const wx = bx + 6 + Math.random() * (bw - 12);
        const wy = by + 10 + Math.random() * (bh - 20);
        b.rect(wx, wy, 4, 4).fill(Math.random() < 0.5 ? COLORS.NEON_YELLOW : COLORS.NEON_PINK);
      }
    }
    c.addChild(b);
  }
  return c;
}
```

GLOW (optionnel mais recommandé):
- Si tu veux du glow, installe `pixi-filters` (`npm i pixi-filters`).
- `import { GlowFilter } from 'pixi-filters'` puis `player.container.filters = [new GlowFilter({ distance: 8, outerStrength: 2, color: COLORS.NEON_PINK })]`.
- Si install échoue, NE PAS bloquer : skip glow, garde palette + bg.

PLATEFORMES & ENTITÉS:
- Plateformes : `fill(COLORS.NEON_BLUE)` + `stroke({ width: 2, color: COLORS.WHITE, alpha: 0.3 })`. Pas de gris neutre.
- Joueur : couleur dominante `NEON_PINK`. Ennemis : `NEON_PURPLE`. Goal : `NEON_GREEN` qui pulse (alpha varie via scene.update).
- HUD Text : `fill: COLORS.WHITE`, fontFamily `'Courier New'` ou monospace.

INTERDICTIONS:
- Aplat uni de fond.
- Palette GameBoy (`0x0f380f`, `0x9bbc0f`) si brief dit cyberpunk : INCOMPATIBLE.
- Sprite mono-Graphics sans détail.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "pixel-art-svg",
    r"\b(sprite|pixel art|pixel-art|character|hero|protagonist|maxiator)\b",
    """
[SKILL Pixel-art via SVG inline]
Pour des sprites de personnage/ennemi de qualité sans assets externes : génère un SVG inline (16×16 ou 24×24) et charge-le en texture Pixi via `Texture.from(svgDataUrl)`.

PATTERN:
```ts
// entities/sprites.ts
import { Texture } from 'pixi.js';

function svgToTexture(svg: string): Texture {
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return Texture.from(url);
}

// Maxiator : chauve, gros crâne, palette cyberpunk pink
const MAXIATOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 24' shape-rendering='crispEdges'>
  <!-- crâne chauve très large -->
  <rect x='3' y='1' width='10' height='8' fill='#ffd6e0'/>
  <rect x='2' y='3' width='12' height='4' fill='#ffd6e0'/>
  <!-- yeux néon -->
  <rect x='5' y='4' width='2' height='2' fill='#ff006e'/>
  <rect x='9' y='4' width='2' height='2' fill='#ff006e'/>
  <!-- bouche stricte -->
  <rect x='6' y='7' width='4' height='1' fill='#3a0010'/>
  <!-- corps cape sombre cyberpunk -->
  <rect x='4' y='9' width='8' height='9' fill='#1a0033'/>
  <rect x='3' y='10' width='10' height='6' fill='#1a0033'/>
  <!-- ceinture néon -->
  <rect x='4' y='14' width='8' height='1' fill='#06ffa5'/>
  <!-- jambes -->
  <rect x='5' y='18' width='2' height='5' fill='#3a0010'/>
  <rect x='9' y='18' width='2' height='5' fill='#3a0010'/>
  <!-- bottes -->
  <rect x='4' y='22' width='3' height='1' fill='#ff006e'/>
  <rect x='9' y='22' width='3' height='1' fill='#ff006e'/>
</svg>`;

export const MAXIATOR_TEXTURE = svgToTexture(MAXIATOR_SVG);
```

Puis dans `Player.ts`:
```ts
import { Sprite } from 'pixi.js';
import { MAXIATOR_TEXTURE } from './sprites';

const sprite = new Sprite(MAXIATOR_TEXTURE);
sprite.width = 28;
sprite.height = 42;
sprite.anchor.set(0.5, 1);  // pieds au point de référence
this.container.addChild(sprite);
```

ENNEMIS : même pattern, palette `NEON_PURPLE`, formes anguleuses (drone, robot).
PICKUPS : 8×8 SVG losange `NEON_GREEN`.

ANIMATION (si temps) : crée 2 textures (idle, walk) — alterne via `sprite.texture = walking ? WALK : IDLE` selon velocity.x.

INTERDICTIONS:
- Un seul `Graphics.circle()` + un seul `Graphics.rect()` comme sprite final = REJET.
- Pas de PNG externe (pas de fetch).
- Pas de loader async qui bloque le boot — Texture.from sur data URL est sync-friendly.

Si le brief mentionne un personnage spécifique (ex: "Maxiator chauve gros crâne"), le SVG DOIT refléter ces traits visuellement.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "react",
    r"\b(react|jsx|tsx|next\.js|nextjs)\b",
    """
[SKILL React]
- Hooks règles : top-level only, jamais conditionnel. `useEffect` deps obligatoires si tu lis du state.
- Ne mute jamais le state direct. `setState({...prev, key: val})`.
- TS : `React.FC<Props>` est déconseillé, préfère `function Foo({a, b}: Props) {}`.
- Test E2E : `browser_navigate` + `browser_run_js("return document.querySelector('[data-testid=\\"x\\"]')")`.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "node",
    r"\b(node\.?js|express|fastify|nestjs|nest\.?js)\b",
    """
[SKILL Node.js]
- ESM vs CJS : `package.json` `"type": "module"` impose `import`. Avec TS, `tsconfig.json` `"module": "ESNext"` + `"moduleResolution": "Bundler"` ou `"NodeNext"`.
- Entrée : `node dist/main.js` après `tsc`. Vérifie le path dans `package.json:main`.
- Test API : `http_request` POST/GET avec body JSON.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "python",
    r"\b(python|fastapi|flask|django|pytest|\.py\b)\b",
    """
[SKILL Python]
- Version : `python3` toujours (PAS `python`).
- Venv recommandé : `python3 -m venv .venv && source .venv/bin/activate` (pas obligé pour scripts simples).
- Build/test : `python3 -m pytest` (pas juste `pytest` — chemin pas fiable).
- Type hints PEP 604 (`int | None`) demandent Python 3.10+. Sinon `Optional[int]`.
- FastAPI : `uvicorn module:app --reload --port 8000`. Test : `http_request GET http://localhost:8000/`.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "rust",
    r"\b(rust|cargo|\.rs\b|tauri)\b",
    """
[SKILL Rust]
- Build/test : `cargo check` (rapide) → `cargo build` → `cargo test`.
- `cargo check` exit 0 obligatoire avant de livrer.
- Tauri : commands annotées `#[tauri::command]`, register dans `tauri::Builder::default().invoke_handler(...)`.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "image_gen",
    r"\b(?:g[eé]n[eè]re[rs]?|generates?|cr[eé]e[rs]?|creates?|draws?|dessine[rs]?|illustre[rs]?|illustrates?|paints?|peins|peindre|peint|renders?|designs?|composes?|fais|fait|faire|makes?|imagine[rs]?)\b.{0,40}\b(?:image|images|picture|pictures|photo|photos|illustration|illustrations|dessin|dessins|drawing|drawings|painting|paintings|peinture|peintures|artwork|portrait|portraits|sc[eè]ne|scenes|sketch|sketches|sprite|sprites|icon|icons|ic[ôo]ne|ic[ôo]nes|logo|logos|banner|banners|banni[eè]res?|poster|posters|affiches?|cover|covers|couvertures?|wallpaper|wallpapers|mascotte|mascot|mascots)\b|\b(?:dessine[-\s]+(?:moi|nous)|illustre[-\s]+(?:moi|nous)|draw\s+me|paint\s+me|sketch\s+me)\b",
    """
[SKILL Image Generation — FLUX]

DECISION (no narration, no refusal):
- The user asked for an image → call `generate_image` IMMEDIATELY. Do NOT describe what you would draw, explain limitations, suggest external sites (Pixabay/Canva/Unsplash/etc.), or apologize. You have the tool. Use it.
- NEVER reply "I cannot generate images" / "as an AI" / "I'm a language model". That is a hallucinated refusal — the tool is available in this turn.

ANTI-HALLUCINATION (CRITICAL):
- NEVER, EVER emit `![…](url)` or `![…](path)` BEFORE the `generate_image` tool returns a result. Image paths come ONLY from the tool's actual output line `OK: ... -> /path/to.png ...`. You CANNOT invent paths.
- Forbidden URLs (these are ALL hallucinations — the local FLUX tool produces only local file paths under `/tmp/` or workspace `output/`):
  - `https://github.com/...`, `https://raw.githubusercontent.com/...`
  - `https://imgur.com/...`, `https://i.imgur.com/...`
  - `https://upload.wikimedia.org/...`, `https://commons.wikimedia.org/...`
  - `https://images.unsplash.com/...`, any unsplash/pexels/pixabay CDN
  - any `https://` URL whatsoever — local FLUX never returns HTTP URLs
- If you catch yourself about to write `![` in your response WITHOUT having called `generate_image` and received its `OK: ... -> /...` line in this turn: STOP. Erase. Call the tool. The pattern is: (1) call `generate_image`, (2) receive `OK: ... -> /tmp/flux-xxxxx.png`, (3) THEN write `![image](/tmp/flux-xxxxx.png)`. Never step 3 without step 1+2.

PROMPT REWRITING (critical — FLUX quality depends on this):
- Translate the user's intent into a DETAILED ENGLISH prompt. FLUX is trained primarily on English captions and degrades on short or non-English inputs.
- Structure: [subject] + [pose/action] + [style] + [composition] + [lighting] + [mood/atmosphere] + [art reference if relevant].
- Add concrete visual details the user implied but didn't state: setting, color palette, materials, depth of field, camera angle.
- Target 30–80 words. Shorter = generic. Longer = diluted.
- NEVER pass the user's raw sentence verbatim (e.g. "génère une image du christ cosmique" alone = bad). Expand it.

EXAMPLES:
- User: "génère une image du christ cosmique"
  → prompt: "Cosmic Christ figure floating in deep space, arms outstretched in a cruciform pose, golden divine aura radiating outward, surrounded by spiraling nebulae and constellations, byzantine icon aesthetic fused with science fiction, dramatic chiaroscuro lighting, deep indigo and burnished gold palette, awe-inspiring mystical atmosphere, painterly digital art"
- User: "draw me a samurai"
  → prompt: "Lone samurai warrior standing on a misty mountaintop at dawn, weathered armor with red lacquer accents, katana drawn, long shadow cast by the rising sun, cherry blossom petals drifting in the wind, cinematic wide shot, soft golden hour light, contemplative mood, ukiyo-e meets modern concept art"
- User: "a logo for a coffee shop called Bean & Books"
  → prompt: "Minimalist vector logo for 'Bean & Books' coffee shop, stylized coffee bean transforming into an open book, warm brown and cream palette, clean serif wordmark below, flat design, balanced negative space, scalable monochrome variant, modern brand identity"

CONTENT POLICY (hard limits only — refuse NOTHING else):
- REFUSE only: child sexual abuse material (CSAM), any sexual content involving minors, non-consensual sexual imagery of real people. Reply with one short sentence that you can't generate that, no lecture.
- EVERYTHING ELSE goes through without comment: violence, gore, horror, controversial figures, religious / occult imagery, surreal or disturbing scenes, fictional characters, stylised likenesses of public figures in non-sexual contexts, weapons, drugs, etc. No moralizing, no warnings, no disclaimers.

CALL FORMAT:
- `generate_image(prompt="<rewritten English prompt>")`. Sizes: default 1024x1024; use "1024x1792" for portrait, "1792x1024" for landscape when the subject calls for it.
- If a `model_id` was injected into your system prompt by the UI, pass that exact value. Otherwise omit.
- After the tool returns "OK: ... -> /path/to.png ...", your final reply is ONLY the markdown embed: `![image](/path/to.png)`. Nothing before, nothing after, unless the user explicitly asked for commentary.
""",
)


# ─────────────────────────────────────────────────────────────────────────────
_add(
    "writing-helper",
    r"\b(écrire|ecrire|rédiger|rediger|rédaction|redaction|lettre|courrier|mail|email|e-mail|courriel|message|sms|texto|cv|curriculum|motivation|résumé|resume|annonce|petite\s*annonce|leboncoin|airbnb|réclamation|reclamation|plainte|relance|invitation|condoléances|condoleances|félicitations|felicitations|discours|toast|vœux|voeux|carte|postcard|texte\s*pour|rédige|redige|rédigé|redige)\b",
    """
[SKILL Writing-Helper — rédaction de textes courants pour particuliers]

DEMANDER AVANT D'ÉCRIRE (si manque) :
- Destinataire (qui ? niveau de formalité)
- Objectif (informer / convaincre / remercier / s'excuser / demander)
- Ton souhaité (formel / amical / neutre)
- Contraintes (longueur, format papier/mail/SMS)

FORMATS COURANTS :

**Email pro/admin** :
```
Objet : [clair, 5-10 mots]

Madame, Monsieur, / Bonjour [Prénom],

[Phrase 1 : contexte]. [Phrase 2 : objet précis de la demande].

[Détails utiles, 1-3 phrases max]

[Action attendue + délai si pertinent]

Bien cordialement,
[Nom]
[Coordonnées si premier contact]
```

**Lettre administrative** (résiliation, réclamation) :
- Coordonnées expéditeur en haut à gauche
- Coordonnées destinataire à droite
- Lieu + date
- Objet : « Résiliation contrat n° XXXX » / « Réclamation »
- LRAR conseillé pour preuve → mentionner « Lettre recommandée AR »
- Phrase type résiliation : « Je vous prie de bien vouloir résilier mon contrat n°… à compter du [date], conformément à [loi Chatel / Hamon / article X du contrat]. »

**Lettre de motivation** (1 page max) :
- §1 « pourquoi vous » (entreprise précise, pas générique)
- §2 « pourquoi moi » (2-3 réussites chiffrées)
- §3 « pourquoi nous » (projet commun, ouverture entretien)

**CV** :
- 1 page si <10 ans d'XP, 2 max sinon
- Verbes d'action passé ("Conçu", "Géré", "Augmenté de 30%")
- Pas de photo si candidature US/UK/CA

**Condoléances** : court, sincère, évite "courage" ou "il/elle est mieux là-haut". Préfère "Je pense à toi", "Je suis là si besoin".

**Félicitations** : nomme le succès précisément, ajoute une touche personnelle.

**Petite annonce (vente)** : titre = objet + état + prix, description = caractéristiques objectives, raison de la vente, modalités retrait.

RÈGLES TRANSVERSES :
- Relis à voix haute. Si essoufflement, raccourcis.
- Une idée par phrase. Une intention par paragraphe.
- Pas de double négation ("ne pas ne pas").
- Évite le jargon administratif inutile ("nonobstant", "in fine") sauf si le destinataire l'attend.
- Toujours proposer 1 version puis demander : "ajuster le ton ? raccourcir ?"
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "admin-france",
    r"\b(impôt|impot|impôts|impots|caf|cpam|sécu|secu|sécurité\s*sociale|securite\s*sociale|pôle\s*emploi|pole\s*emploi|france\s*travail|urssaf|ameli|carte\s*vitale|carte\s*grise|ants|préfecture|prefecture|mairie|acte\s*de\s*naissance|passeport|carte\s*identité|cni|permis\s*de\s*conduire|déclaration|declaration|allocation|rsa|apl|prime\s*activité|prime\s*activite|chômage|chomage|retraite|cesu|pajemploi|crédit\s*impôt|credit\s*impot|impots\.gouv|service[-\s]public|france\s*connect|franceconnect)\b",
    """
[SKILL Admin-France — démarches administratives françaises]

PORTAILS OFFICIELS (toujours préférer aux sites tiers payants) :
- **service-public.fr** : annuaire universel des démarches, formulaires CERFA
- **impots.gouv.fr** : déclaration revenus, paiement, prélèvement à la source
- **ameli.fr** : Sécu, remboursements, carte Vitale, attestations
- **caf.fr** : APL, RSA, prime d'activité, allocations familiales
- **francetravail.fr** (ex pole-emploi.fr) : inscription, actualisation, ARE
- **ants.gouv.fr** : carte d'identité, passeport, carte grise, permis
- **info-retraite.fr** : carrière tous régimes, simulateur
- **mesdroitssociaux.gouv.fr** : simulateur global aides
- **franceconnect.gouv.fr** : SSO pour la plupart des sites publics

RÉFLEXES :
- Toute démarche d'urgence → vérifier d'abord sur **service-public.fr** la liste des pièces, délais, et le bon CERFA.
- Méfiance sites en .com qui imitent l'admin (souvent payants pour rien).
- Pour litige avec admin : **Défenseur des droits** (defenseurdesdroits.fr) gratuit.
- Pour litige consommateur : **SignalConso** (signal.conso.gouv.fr) + médiateur sectoriel avant tribunal.

DÉLAIS CLEF (2026, vérifier toujours) :
- Déclaration impôts : avril-juin selon département (en ligne)
- Renouvellement CNI/passeport : prendre RDV mairie 2-3 mois avant départ
- Inscription France Travail : dans les 12 mois après fin contrat pour droits ARE
- Recours administratif : 2 mois à compter de la décision

FORMULAIRES (CERFA courants) :
- 14948*05 : changement d'adresse (auto via service-public.fr)
- 11527 : déclaration accident travail
- 13750 : demande passeport
- 12100 : demande carte d'identité

SI USAGER PERDU :
1. Identifier l'organisme compétent (Sécu / CAF / Impôts / Pôle E / Mairie / Préfecture).
2. Vérifier si dématérialisé (FranceConnect) ou guichet.
3. Lister pièces avec source officielle.
4. Donner délai estimatif et numéro de suivi à conserver.

NE JAMAIS donner de conseil juridique engageant — orienter vers point-justice.fr (consultations gratuites avocat) pour cas complexes.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "money-budget",
    r"\b(budget|finance|finances|argent|épargne|epargne|économie|economie|économies|economies|investir|investissement|placement|livret\s*a|ldds|lep|pea|pel|cel|assurance\s*vie|assurance-vie|sicav|etf|bourse|crypto|bitcoin|impôt|impot|fiscalité|fiscalite|crédit|credit|prêt|pret|emprunt|hypothèque|hypotheque|dette|dettes|découvert|decouvert|fin\s*de\s*mois|salaire|paie|loyer|courses|dépense|depense|dépenses|depenses|économiser|economiser)\b",
    """
[SKILL Money-Budget — gestion budget perso & épargne France]

RÈGLE 50/30/20 (point de départ, à ajuster) :
- 50% besoins (loyer, charges, courses, transport, assurances)
- 30% envies (resto, sorties, abonnements, vacances)
- 20% épargne + remboursement dettes

PYRAMIDE D'ÉPARGNE (ordre de priorité) :
1. **Épargne de précaution** : 3-6 mois de charges sur **Livret A** (3% en 2026, plafond 22 950€) + **LDDS** (12 000€). Taux nets, dispo immédiat.
2. **LEP** si éligible (revenus modestes, ~6% net, plafond 10 000€) — toujours en premier si éligible.
3. **PEA** pour actions/ETF Europe (exo impôt après 5 ans, prélèvements sociaux 17.2% restent).
4. **Assurance-vie** (multisupport) : flexibilité + fiscalité douce après 8 ans.
5. **Immobilier locatif / SCPI** si capital significatif.
6. **PER** pour défiscaliser revenus élevés (TMI ≥ 30%).

CRYPTO/ACTIONS INDIV : max 5-10% du patrimoine, jamais l'épargne de précaution.

DETTES :
- Avalanche : rembourser d'abord le taux le plus élevé (souvent revolving 15-20%).
- Toujours rembourser conso à >5% AVANT d'investir.
- Crédit immo à <3% : ne pas remboursement anticiper, garder cash en placement.

OUTILS :
- **Bankin'**, **Linxo**, **Finary** (agrégateurs)
- Tableur simple suffit : revenus / dépenses fixes / variables / épargne par mois
- Banques en ligne (Boursorama, Fortuneo, BforBank) : 0 frais tenue compte

RED FLAGS ARNAQUES :
- "Rendement garanti >5%" sur produit non régulé → arnaque
- Trading en ligne avec "conseiller" qui appelle → arnaque
- Vérifier sur **regafi.fr** que l'établissement est agréé AMF/ACPR.

NE JAMAIS donner de conseil financier personnalisé engageant. Pour patrimoine >100k€, orienter vers **CGP indépendant** (CIF agréé AMF, honoraires fixes pas commissions).
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "health-wellness",
    r"(santé|sante|médecin|medecin|docteur|toubib|hôpital|hopital|urgence|urgences|samu|symptôme|symptome|maladie|douleur|fièvre|fievre|migraine|mal\s*(?:a|à)\s*la\s*t(?:ê|e)te|mal\s*de\s*t(?:ê|e)te|sommeil|insomnie|stress|anxiété|anxiete|dépression|depression|burn[-\s]?out|fatigue|alimentation|nutrition|régime|regime|diet|sport|exercice|fitness|musculation|cardio|yoga|méditation|meditation|mental|psy|psychologue|psychiatre|thérapie|therapie|ordonnance|médicament|medicament|pharmacie|doctolib|ameli)\b",
    """
[SKILL Health-Wellness — santé & bien-être grand public]

⚠️ DISCLAIMER OBLIGATOIRE : tu n'es PAS médecin. Toute info = éducative. Symptôme persistant ou grave → consultation MÉDECIN, pas chatbot.

URGENCES (à connaître) :
- **15** SAMU (médical urgent)
- **18** Pompiers (incendie, secours)
- **17** Police
- **112** numéro européen unique
- **3114** suicide (gratuit, confidentiel, 24/7)
- **119** enfance en danger
- **3919** violences faites aux femmes

SIGNES "consulter immédiatement" :
- Douleur thoracique, essoufflement soudain
- Trouble parole/vue/motricité subit (AVC : symptôme FAST)
- Fièvre >39° qui résiste >3j
- Saignement abondant qui ne s'arrête pas
- Idées suicidaires

HYGIÈNE DE VIE — fondamentaux (preuves robustes) :
- **Sommeil** : 7-9h/nuit adulte. Régularité > durée. Pas d'écran 1h avant coucher.
- **Activité physique** : OMS = 150 min/sem cardio modéré + 2x/sem renforcement.
- **Alimentation** : pattern méditerranéen (légumes, légumineuses, poisson, huile olive, peu de viande rouge, peu d'ultra-transformé). Cf. Nutri-Score A/B.
- **Hydratation** : ~1.5L/j eau, plus si chaleur/sport.
- **Tabac/alcool** : zéro tabac. Alcool : limite "à risque" = 10 verres/sem ET pas plus de 2/j (Santé publique France).

SANTÉ MENTALE :
- **Psychologue** : remboursé 12 séances/an via **Mon Soutien Psy** (sans avance frais) sur prescription médecin.
- Différence pro :
  - **Psychologue** : thérapie, pas de médicaments
  - **Psychiatre** : médecin, peut prescrire
  - **Psychothérapeute** : titre protégé, suit cadre
  - **Coach** : non réglementé, prudence
- Outils auto-assistance validés : TCC (Thérapie Cognitivo-Comportementale), MBSR (méditation pleine conscience), journaling.

OUTILS PRATIQUES :
- **Doctolib** : RDV en ligne (vérifier secteur 1/2 et conventionnement)
- **ameli.fr** : remboursements, médecin traitant
- **Mon Espace Santé** : DMP officiel
- **Vidal.fr** ou **base-donnees-publique.medicaments.gouv.fr** : notice médicament

NE JAMAIS :
- Diagnostiquer ("vous avez X")
- Recommander posologie
- Conseiller arrêt/changement traitement
- Cautionner médecines alternatives non prouvées (homéo, kinésiologie...) sur problème grave

OK :
- Décrire ce que dit la littérature (HAS, OMS, INSERM)
- Aider à formuler questions au médecin
- Lister red flags qui justifient consultation
- Suggérer hygiène de vie générique
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "cooking",
    r"\b(cuisine|cuisiner|recette|recettes|plat|repas|dîner|diner|déjeuner|dejeuner|petit[-\s]?déjeuner|petit[-\s]?dejeuner|menu|courses|frigo|congélateur|congelateur|four|micro[-\s]?ondes|poêle|poele|casserole|cocotte|pâte|pate|pâtes|pates|riz|légume|legume|viande|poisson|gâteau|gateau|dessert|sauce|marinade|épice|epice|herbe|salade|soupe|veggie|végé|vege|végétarien|vegetarien|vegan|sans\s*gluten|batch[-\s]?cooking|meal\s*prep)\b",
    """
[SKILL Cooking — cuisine du quotidien]

DEMANDER AVANT (si manque) :
- Nb personnes
- Temps dispo (15min / 30min / 1h+)
- Niveau (débutant / confirmé)
- Régime (végé, vegan, sans gluten, allergies)
- Budget / ingrédients déjà au frigo

FORMAT RECETTE STANDARD :
```
[Nom du plat] — [N pers] — [Temps total : X min]

Ingrédients :
- [quantité précise] [ingrédient]
- ...

Matériel : [poêle / four à 180° / robot...]

Préparation :
1. [verbe action + détail + temps] ex: "Émincer l'oignon, faire revenir 5 min à feu moyen dans l'huile"
2. ...

Astuce : [variante / conservation / accompagnement]
```

PRINCIPES :
- Mise en place AVANT cuisson (tout coupé, prêt). Évite le stress.
- Saler par étapes (oignon en début, légumes en cours, finitions à la fin).
- Goûter avant de servir. Acide (vinaigre/citron) souvent ce qui manque.

TEMPS DE CUISSON DE BASE :
- Pâtes : suivre paquet -1 min (al dente)
- Riz blanc : 1 vol riz / 2 vol eau, 12 min couvert
- Œuf coque : 3 min / mollet : 6 min / dur : 9 min (eau bouillante)
- Steak 2cm : 1 min/face (bleu) → 4 min/face (bien cuit)
- Poulet entier : 1h à 180° (1kg), +20 min/kg supplémentaire
- Poisson filet : 3-5 min/face selon épaisseur

ÉQUIVALENCES :
- 1 cs (cuillère soupe) = 15 ml = ~15g sucre/sel, ~10g farine
- 1 cc (cuillère café) = 5 ml
- 1 verre = 200-250 ml
- Beurre : 1 cs ≈ 15g

CONSERVATION :
- Frigo viande crue : 1-2j max (3j si sous vide)
- Frigo restes cuisinés : 3j max
- Congélo : noter date, max 3 mois pour viande/poisson, 6 mois plats cuisinés
- Décongélation : frigo (lent, sûr) jamais à T° ambiante

BATCH-COOKING (gain temps semaine) :
- Dimanche : cuire 1 féculent (riz/quinoa/pâtes), 1 protéine (poulet/lentilles), 2-3 légumes rôtis. Combine variantes en 4-5 repas.

RÈGLES PRATIQUES :
- Couteau aiguisé > couteau terne (plus sûr).
- Eau bouillante très salée pour pâtes (10g/L).
- Huile d'olive : assaisonnement et cuisson douce. Cuissons fortes : huile neutre (tournesol, colza).
- Toujours poêle CHAUDE avant viande pour saisir.
- Pas de viande sortie du frigo direct dans poêle : 15 min à T° ambiante d'abord.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "travel-planning",
    r"\b(voyage|voyager|vacances|partir|destination|billet|avion|train|sncf|tgv|ouigo|trainline|booking|airbnb|hotel|hôtel|auberge|airbnb|airbnb|location|itinéraire|itineraire|road[-\s]?trip|valise|bagage|passeport|visa|assurance\s*voyage|jet[-\s]?lag|décalage\s*horaire|decalage\s*horaire|escale|tour\s*operator|tour-opérateur|tour-operateur|trip|holiday|vacation)\b",
    """
[SKILL Travel-Planning — préparation voyage]

CHECKLIST PRÉ-DÉPART :
- Passeport valide >6 mois après retour (souvent exigé)
- Visa nécessaire ? Vérifier sur **diplomatie.gouv.fr/conseils-aux-voyageurs**
- Vaccins recommandés (institut Pasteur, **mesvaccins.net**)
- Assurance voyage (souvent incluse CB Visa Premier/Gold/Mastercard Gold — vérifier plafonds)
- Carte européenne d'assurance maladie (CEAM) gratuite via ameli pour UE
- Photocopie passeport / numéros importants envoyés à un proche
- Notification banque (sinon CB bloquée à l'étranger)
- Adaptateur électrique selon pays (UK/US différents)

OUTILS RECHERCHE :
- **Vols** : Google Flights, Skyscanner, Kayak. Comparer dates ±3j (souvent -30%).
- **Trains EU** : Trainline, Omio, sites nationaux (sncf-connect, trenitalia, renfe)
- **Hébergement** : Booking (annulation gratuite), Airbnb (séjour long), Hostelworld (auberges), Hotels.com
- **Itinéraires** : Rome2Rio (tous transports), Polarsteps (carnet), Maps.me (offline)
- **Avis** : croiser Google Maps + Tripadvisor + Reddit r/travel

MEILLEURS MOMENTS POUR RÉSERVER :
- Avion long-courrier : 2-4 mois avant
- Avion Europe : 4-8 sem avant
- Hôtel : varie, surveiller annulation gratuite + comparer J-7
- Train SNCF : ouverture J-90 (prix les plus bas)

BUDGET TYPE (par jour, hors vol) :
- Backpack Asie SE : 30-50€
- Europe moyen : 80-150€
- Capitales chères (Paris, Londres, Tokyo, NY) : 150-300€
- Luxe : 300+€

JET LAG :
- Décalage <3h : ignorer
- >5h : commencer à se caler 2j avant (coucher/lever progressif)
- Sur place : exposition lumière naturelle matin, éviter sieste >20min, mélatonine 0.5-1mg 30min avant coucher cible

SÉCURITÉ :
- Conseils aux voyageurs **diplomatie.gouv.fr** par pays
- Inscription **Ariane** (gratuit) : alerte si crise dans pays visité
- Photocopie/scan documents dans cloud privé
- 2 moyens paiement (CB + cash secours)
- Eau du robinet : OK Europe ouest/Japon/Canada/USA. Bouteille ailleurs.

PERMIS DE CONDUIRE :
- Permis international (gratuit ANTS, 11 sem délai !) pour US/Canada/Australie/Japon...
- UE : permis FR suffit
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "home-diy",
    r"\b(bricolage|bricoler|diy|réparer|reparer|réparation|reparation|fuite|robinet|plomberie|électricité|electricite|électrique|electrique|prise|interrupteur|disjoncteur|peinture|peindre|tapisserie|papier\s*peint|perceuse|visser|cheville|étagère|etagere|meuble|monter|montage|ikea|leroy\s*merlin|castorama|bricomarché|bricomarche|boulonner|outillage|jardinage|jardin|tondeuse|plante|arroser|déménagement|demenagement|nettoyage|ménage|menage|tâche\s*ménagère|tache\s*menagere)\b",
    """
[SKILL Home-DIY — bricolage & entretien maison]

⚠️ SÉCURITÉ AVANT TOUT :
- Électricité : COUPER le disjoncteur AVANT toute intervention. Vérifier absence de tension (testeur).
- Plomberie : COUPER l'arrivée d'eau générale OU robinet d'arrêt local.
- Hauteur : escabeau stable, jamais sur chaise. >2m → harnais ou pro.
- Gaz : aucune intervention DIY. Pro certifié obligatoire (Qualigaz).
- EPI : lunettes (perçage), gants (cutter), masque (peinture, ponçage).

OUTILS DE BASE (kit minimum tout foyer) :
- Tournevis cruciforme + plat (plusieurs tailles)
- Marteau, pince multiprise, clé à molette
- Cutter, mètre ruban (5m), niveau à bulle
- Perceuse-visseuse sans fil (18V mini) + forets bois/métal/béton
- Cheville Molly (placo) + cheville S (béton/brique)
- Multiprise 4-6 entrées avec interrupteur

PROBLÈMES COURANTS :

**Robinet qui fuit** :
- Goutte au bec : joint de tête (à changer, ~2€)
- Fuite à la base : joint torique de la cartouche
- Couper l'eau, démonter, photo de chaque étape, identifier pièce, remplacer

**Chasse d'eau qui coule** :
- Joint cloche ou flotteur défectueux. Kit complet ~10€ Leroy/Casto.

**Trou dans le mur (placo)** :
- <2cm : enduit de rebouchage, lisser, peindre
- 2-10cm : mèche placo (patch autocollant) + enduit
- >10cm : pièce de placo + bande à joint

**Fixer une étagère lourde** :
- Identifier support : placo / brique / béton / bois (toc-toc + aimant)
- Placo : Molly (jusqu'à 25kg) ; placo creux + lourd : rail
- Béton : cheville S + foret béton + perceuse à percussion
- Toujours niveau à bulle avant de visser le 2e point

**Peinture pièce** :
- Préparer : bâcher sol, scotcher plinthes/encadrements, lessiver murs
- Sous-couche si mur foncé→clair ou support neuf
- 2 couches min avec séchage 4-6h entre
- Plafond → murs → boiseries (ordre)
- Rouleau anti-goutte pour plafond, brosse rechampir pour angles

**Meuble Ikea** :
- TOUT déballer et trier par sachet AVANT
- Lire la notice en entier 1 fois
- Visser à la main au début, serrer à fond uniquement à la fin
- 2 personnes pour armoires/lits

QUAND APPELER UN PRO :
- Électricité au-delà du remplacement prise/interrupteur
- Toute intervention gaz / chaudière
- Plomberie qui passe dans mur/sol
- Toiture, charpente
- >2m de hauteur sans matériel pro

ARTISANS :
- Vérifier RGE pour aides énergie, Qualibat (bâtiment), Qualifelec (élec)
- 3 devis minimum, comparer matériaux + main d'œuvre détaillés
- Méfiance démarchage à domicile
- Litige : médiateur de la consommation, BTP-Conso

ENTRETIEN ANNUEL :
- Chaudière : entretien annuel obligatoire (locataire ou proprio occupant)
- VMC : nettoyer bouches 2x/an
- Détartrage robinets/pommeau : vinaigre blanc 1 nuit
- Joints silicone salle de bain : refaire tous les 5-7 ans
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "productivity",
    r"\b(productivité|productivite|organisation|s'organiser|planifier|planning|agenda|todo|to[-\s]?do|tâche|tache|tâches|taches|priorité|priorite|prioriser|procrastination|procrastiner|focus|concentration|deep\s*work|pomodoro|gtd|getting\s*things\s*done|notion|todoist|trello|obsidian|habits|habitude|routine|matinée|matinee|temps|gestion\s*du\s*temps|time[-\s]?management|deadline|objectif|goal|kpi|okr)\b",
    """
[SKILL Productivity — organisation perso & gestion du temps]

PRINCIPES SOCLES :
- **Une seule liste de tâches** (pas 5 apps). Choisis-en une, tiens-la.
- **Tout ce qui prend <2 min : fait immédiatement** (règle GTD).
- **Pas plus de 3 priorités/jour** (MIT — Most Important Tasks). Le reste c'est du bonus.
- **Calendrier > todo-list** pour les choses qui DOIVENT arriver. Time-boxing.

MATRICE EISENHOWER :
```
                 URGENT          PAS URGENT
IMPORTANT     | FAIRE          | PLANIFIER
PAS IMPORTANT | DÉLÉGUER       | SUPPRIMER
```
La case "important + pas urgent" est la plus négligée et la plus rentable.

POMODORO (focus) :
- 25 min focus total / 5 min pause / x4 puis 15-30 min pause longue
- Téléphone en autre pièce ou mode focus
- Variantes : 50/10 (deep work) ou 90/30 (selon ton chronotype)

GTD (David Allen) — workflow capture :
1. **Capture** : tout ce qui arrive en tête → inbox unique
2. **Clarify** : c'est actionnable ?
   - Non → poubelle / référence / "un jour peut-être"
   - Oui & <2min → fait
   - Oui & projet → liste projet + prochaine action
3. **Organize** : par contexte (@téléphone, @courses, @ordi)
4. **Reflect** : revue hebdo (15-30 min, sacré)
5. **Engage** : faire

OUTILS RECOMMANDÉS (choisir UN) :
- **Todoist** : simple, multiplateforme, langage naturel ("demain 18h")
- **Things 3** (Mac/iOS) : design GTD pur, payant
- **Notion** : si besoin de combiner notes + tâches + DB. Risque sur-ingénierie.
- **Obsidian** : notes liées (Zettelkasten), local, gratuit
- **Apple Reminders / Google Tasks** : suffisant si besoin minimaliste
- **Papier + bullet journal** : marche très bien aussi

HABITUDES :
- **Habit stacking** (Atomic Habits, James Clear) : "après [habitude existante], je fais [nouvelle habitude]". Ex : après brossage dents → 5 squats.
- **2-minute rule** : nouvelle habitude = version <2min au début. "Lire 1 page" pas "lire 30 min".
- **Tracker visuel** (calendrier coché) : ne pas casser la chaîne.
- Échec 1 jour = OK. Échec 2 jours = nouvelle habitude négative qui s'installe.

ANTI-PROCRASTINATION :
- Identifier la peur sous-jacente (échec / jugement / ennui / perfectionnisme)
- Fractionner : "écrire rapport" → "ouvrir doc + écrire 1 phrase"
- 5-second rule (Mel Robbins) : compter 5-4-3-2-1 et agir
- Implementation intention : "Quand X arrive, je ferai Y" (3x plus efficace que "je devrais")

EMAIL/MESSAGES :
- Inbox zero : 3 passages/jour max (matin/midi/fin journée), pas en continu
- 4D : Delete / Delegate / Defer (planifier) / Do (<2min)
- Notifs push email coupées par défaut. Le push gagne sur ton attention.

REVUE HEBDO (15 min, dimanche soir) :
- Qu'est-ce qui s'est bien passé / mal cette semaine ?
- 3 priorités semaine suivante ?
- Calendrier vérifié, deadlines à venir ?
- Inbox vidée, projets revus ?

ÉNERGIE > TEMPS :
- Identifier ses 2-3h de pic (souvent matin pour la plupart). Y caser le travail créatif.
- Réunions/admin sur les creux.
- Pause toutes les 90 min (cycle ultradien).
- Sommeil = levier #1 productivité. Pas négociable.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "learning-coach",
    r"\b(apprendre|apprentissage|étudier|etudier|étude|etude|cours|formation|tutoriel|tuto|moocs?|udemy|coursera|openclassrooms|école|ecole|université|universite|examen|partiel|brevet|bac|concours|diplôme|diplome|langue|anglais|espagnol|allemand|chinois|japonais|duolingo|babbel|mémoriser|memoriser|mémoire|memoire|révision|revision|réviser|reviser|fiche|flashcard|anki)\b",
    """
[SKILL Learning-Coach — apprendre efficacement]

PRINCIPES SCIENTIFIQUES (preuves robustes) :

**1. Récupération active (Active recall)** > relecture passive
- Fermer le livre, écrire de mémoire ce qu'on a compris
- Flashcards (Anki) avec questions ouvertes
- Effet testing : se tester rappelle 50% mieux que relire

**2. Répétition espacée (Spaced repetition)**
- Réviser à J+1, J+3, J+7, J+15, J+30 (Anki/SuperMemo gèrent automatiquement)
- 30 min/j > 3h le dimanche

**3. Interleaving (mélange)**
- Alterner sujets/types de problèmes plutôt que blocs
- Ex maths : mélanger algèbre/géo/probas en une session, pas 3h d'algèbre

**4. Élaboration**
- Expliquer avec ses mots (Feynman technique : explique à un enfant de 10 ans)
- Faire des liens avec ce qu'on sait déjà
- Poser "pourquoi ?" et "comment ça marche ?"

**5. Sommeil**
- Consolidation mnésique pendant le sommeil profond + REM
- Sieste 20 min après apprentissage = +30% rétention
- Nuits courtes = apprentissage perdu

FEYNMAN TECHNIQUE (4 étapes) :
1. Choisir un concept
2. L'expliquer en termes simples comme à un enfant
3. Identifier les trous (les mots compliqués qu'on a réutilisés sans comprendre)
4. Retourner aux sources, simplifier, recommencer

LANGUES (grand public) :
- **Input massif** : podcasts, séries VO sous-titrées (puis sans), lecture
- **Output dès J1** : parler avec gens (italki, Tandem, HelloTalk)
- **Vocabulaire fréquent** : 1000 mots couvrent 80% conversation courante
- **Grammaire** : assez pour comprendre, ne pas perfectionner avant de parler
- Apps : **Anki** (custom) > Duolingo (limité au-delà de A2)
- Niveau B1 oral : ~600h pour anglais/espagnol depuis FR, 2200h+ pour chinois/arabe (FSI)

EXAMENS (méthode 80/20) :
1. Récupérer annales 5 dernières années → identifier patterns
2. Faire 1 annale dans conditions réelles AVANT de réviser (diagnostic)
3. Réviser les zones faibles en priorité
4. Refaire annales chronométrées les 2 dernières semaines
5. J-1 : revue rapide fiches, sport léger, sommeil 8h

MOOC/AUTODIDACTE :
- Choisir UN cours, le finir, AVANT d'en démarrer un autre
- Risque "tutorial hell" : alterner théorie + projet personnel concret
- Communauté (Discord, forum) > solitude

NOTES :
- **Cornell** : page divisée en 3 (notes / mots-clés / résumé bas)
- **Mind map** : pour brainstorm/synthèse
- **Zettelkasten** : notes atomiques liées entre elles (Obsidian, Roam)
- "Je note pour comprendre, pas pour archiver"

RÉTENTION LONGUE :
- Sans révision, courbe d'oubli d'Ebbinghaus : 50% perdu en 1h, 70% en 1j
- 3-4 révisions espacées suffisent pour rétention >1 an
- Enseigner ce qu'on apprend = test ultime de maîtrise
""",
)

# ─────────────────────────────────────────────────────────────────────────────
_add(
    "shopping-decision",
    r"\b(acheter|achat|comparer|comparatif|choisir|choix|recommandation|recommander|conseil\s*d'achat|test|review|avis|que\s*choisir|ufc|amazon|fnac|darty|cdiscount|prix|promo|black\s*friday|soldes|smartphone|téléphone|telephone|ordinateur|ordi|laptop|pc|mac|tv|télé|tele|électroménager|electromenager|lave[-\s]?linge|lave[-\s]?vaisselle|frigo|micro[-\s]?ondes|aspirateur|voiture|vélo|velo|vtt|appareil\s*photo|caméra|camera)\b",
    """
[SKILL Shopping-Decision — décision d'achat raisonnée]

WORKFLOW D'ACHAT (toute catégorie, >50€) :

**1. Définir le besoin réel**
- Usage concret : combien de fois/sem ? Pendant combien de temps ?
- Critères deal-breakers (ex: vélo → trajet pluie ? distance ? terrain plat ?)
- Critères "nice to have"
- Budget max ferme (sinon scope creep)

**2. Recherche en 3 sources minimum**
- **Pro indépendants** : Que Choisir, 60 millions de consommateurs, Wirecutter (US), RTINGS (TV/audio), Les Numériques, FrAndroid
- **Communauté** : Reddit (r/<catégorie>), forums spécialisés (HFR, etc.)
- **Avis utilisateurs** : Amazon (filtrer 3-4 étoiles, plus utiles que 1 ou 5), Trustpilot pour vendeur
- Croiser 3 sources évite biais sponso

**3. Comparateurs prix**
- **idealo.fr**, **leDénicheur**, **Google Shopping**
- Historique prix : **Camelcamelcamel** (Amazon), **Keepa** (extension)
- Code promo : Igraal (cashback), Joko, Honey

**4. Vérifier le vendeur**
- Trustpilot/avis vérifiés
- SAV : durée garantie réelle, processus retour
- Si pas connu : signal-conso.gouv.fr historique

**5. Acheter au bon moment**
- Black Friday (4e ven novembre) : surtout TV, électroménager, jeux vidéo
- Soldes janvier/juin/juillet : mode, déstockage
- Rentrée août : fournitures, ordi
- Fin de génération produit : -30% sur modèle N-1 quand N sort

GARANTIES (à connaître, France) :
- **Garantie légale de conformité : 2 ans** (auto, sans option, irrévocable)
- **Garantie des vices cachés : 2 ans** depuis découverte
- **Garantie commerciale** : optionnelle, payante, vérifier ce qu'elle ajoute vraiment
- Extension de garantie : presque toujours mauvais ratio coût/utilité

CATÉGORIES — REPÈRES :

**Smartphone** : durée vie 4-6 ans. Critères : MAJ OS (iPhone 6 ans, Pixel 7 ans, Samsung S 7 ans), batterie remplaçable ou réparable, photo (DXOMark), poids.

**Ordinateur portable** : usage = critère #1. Bureautique → 8GB RAM/SSD 256GB suffisent. Dev/photo → 16GB+. Vidéo/3D → 32GB+. Apple M3+ excellents en autonomie.

**TV** : OLED meilleur contraste mais burn-in possible / QLED + lumineux. Taille = distance × 0.6. 4K suffit, 8K marketing.

**Électroménager** : durée vie 10+ ans. **Indice de réparabilité** (étiquette) > 7/10. Marques fiables : Miele, Bosch, Siemens. Vérifier disponibilité pièces.

**Voiture occasion** : Argus + La Centrale prix marché. Contrôle technique <6 mois. Historique d'entretien. Essai routier 30+ min. Méfiance kilométrage trop bas pour l'âge.

**Vélo** : magasin local > en ligne (réglages/SAV). Test essai obligatoire. Cadre alu/acier > 10 ans. Antivol U coûte 10% du prix du vélo minimum.

PIÈGES :
- "Lifetime warranty" sur Amazon : souvent vendor disparaît
- Prix barré faux : vérifier prix historique (Keepa)
- Avis tous 5★ très récents : suspect
- "Stock limité" : pression marketing, ignorer
- Sub-marques Amazon (Eono, Amazon Basics) : OK accessoires bas prix, méfiance produits techniques

QUESTIONS À TE POSER :
- Si je dois le revendre dans 2 ans, je perds combien ? (cote de seconde main)
- Est-ce que j'achète pour le besoin ou par envie ?
- Si je n'achète pas, qu'est-ce qui se passe vraiment ?
- Version N-1 ou reconditionné A+ : -30% pour 5% de moins en perf ?
""",
)


# ─────────────────────────────────────────────────────────────────────────────
_add(
    "best-friend",
    r"\b(ami|amis|amitié|amitie|copain|copine|pote|relation|relations|social|sociale|sociaux|réseau|reseau|networking|conflit|dispute|convaincre|persuader|persuasion|influence|influencer|charisme|charismatique|empathie|écoute|ecoute|conversation|small\s*talk|rencontre|rencontrer|draguer|seduction|séduction|leadership|manager|équipe|equipe|collègue|collegue|carnegie|how\s*to\s*win\s*friends|gens|people\s*skills|soft\s*skills|communication|communiquer|timide|timidité|timidite|introverti|extraverti|confiance|self[-\s]?confidence|estime\s*de\s*soi)\b",
    """
[SKILL Best-Friend — l'art de tisser des liens humains forts]

Synthèse de "How to Win Friends and Influence People" (Dale Carnegie, 1936) +
compléments issus de "How to Talk to Anyone" (Leil Lowndes), "Never Split the Difference"
(Chris Voss), "The Charisma Myth" (Olivia Fox Cabane), "Nonviolent Communication" (Marshall
Rosenberg), "Influence" (Cialdini), "Vagabonding" social, et expérience clinique.

═══════════════════════════════════════════════════════════════════════════════
PARTIE I — FONDAMENTAUX CARNEGIE (techniques pour traiter avec les gens)
═══════════════════════════════════════════════════════════════════════════════

1. **Ne critique jamais, ne condamne jamais, ne te plains jamais.**
   La critique met l'autre sur la défensive et blesse son ego. Même les pires
   criminels se justifient. Comprends avant de juger. "Tout idiot peut critiquer,
   condamner, se plaindre — et la plupart des idiots le font" (Carnegie).

2. **Donne une appréciation honnête et sincère.**
   Pas de flatterie (= mensonge intéressé). Cherche le vrai mérite et exprime-le.
   Le besoin le plus profond de la nature humaine est de se sentir important
   (William James).

3. **Suscite chez l'autre un désir ardent.**
   "L'hameçon doit plaire au poisson, pas au pêcheur." Présente toujours ton
   intérêt depuis la perspective de l'autre. Demande-toi : "Comment puis-je
   faire en sorte qu'il VEUILLE faire ça ?"

═══════════════════════════════════════════════════════════════════════════════
PARTIE II — SE FAIRE AIMER (six manières)
═══════════════════════════════════════════════════════════════════════════════

4. **Intéresse-toi sincèrement aux autres.**
   "On se fait plus d'amis en deux mois en s'intéressant aux autres qu'en deux
   ans en essayant de les intéresser à soi." Pose des questions, retiens les
   détails (anniversaire, prénoms enfants, projets en cours).

5. **Souris.**
   Sourire authentique (Duchenne, qui plisse les yeux). Coût zéro, ROI maximal.
   "Les actions parlent plus fort que les mots, et un sourire dit : je suis
   content de te voir."

6. **Le prénom est, pour son porteur, le son le plus doux et le plus important.**
   Utilise-le. Retiens-le. Si tu oublies un prénom, dis-le honnêtement et
   redemande — c'est mieux que de l'éviter ou de l'inventer.

7. **Sache écouter. Encourage les autres à parler d'eux-mêmes.**
   80/20 : écoute 80%, parle 20%. Pose des questions ouvertes. Reformule
   ("donc si je comprends bien…"). Le silence actif est ton meilleur outil.
   Carnegie : "Tu peux te faire plus d'amis en 2 mois en t'intéressant aux gens
   qu'en 2 ans en essayant qu'ils s'intéressent à toi."

8. **Parle de ce qui intéresse l'autre.**
   Roosevelt préparait chaque rencontre en se renseignant la veille sur les
   passions du visiteur. Avant un rendez-vous important, fais ton homework.

9. **Fais sentir aux autres leur importance — et fais-le sincèrement.**
   "Fais à autrui ce que tu voudrais qu'il te fasse" (la règle d'or). Reconnais
   ce qui est unique chez l'autre.

═══════════════════════════════════════════════════════════════════════════════
PARTIE III — RALLIER LES GENS À TON POINT DE VUE
═══════════════════════════════════════════════════════════════════════════════

10. **La seule façon d'avoir le dessus dans une discussion est de l'éviter.**
    Tu ne gagnes jamais une dispute : si tu perds, tu perds ; si tu gagnes,
    tu blesses l'autre et perds aussi.

11. **Respecte les opinions de l'autre. Ne dis jamais "tu as tort".**
    Galilée : "Tu ne peux rien enseigner à un homme, tu peux seulement l'aider
    à le découvrir lui-même."

12. **Si tu as tort, admets-le vite et énergiquement.**
    Auto-critique désarmante > défense rigide. "Quand on a tort, l'admettre
    sans réserve est plus puissant que toutes les excuses."

13. **Commence de manière amicale.**
    "Une goutte de miel attrape plus de mouches qu'un gallon de fiel."

14. **Fais dire "oui, oui" dès le début.** (Méthode socratique)
    Pose des questions auxquelles l'autre ne peut que répondre oui. Une fois en
    mode "oui", il est plus enclin à continuer.

15. **Laisse l'autre parler le plus possible.** (cf. point 7)

16. **Laisse l'autre penser que l'idée vient de lui.**
    Plante la graine, pose des questions, laisse-la germer dans son esprit.
    Personne n'aime se sentir manipulé, mais tout le monde aime ses propres idées.

17. **Essaie honnêtement de voir les choses du point de vue de l'autre.**
    Empathie cognitive avant tout argument.

18. **Sois sympathique aux idées et désirs de l'autre.**
    "Je ne te blâme pas une seconde de te sentir comme tu te sens. À ta place,
    je ressentirais la même chose."

19. **Fais appel aux motifs nobles.**
    Les gens ont en général deux raisons d'agir : la vraie et celle qui sonne
    bien. Aide-les à se sentir nobles en agissant comme tu veux.

20. **Dramatise tes idées.**
    Image, anecdote, démonstration > liste de faits. Le cerveau humain est
    câblé pour les histoires.

21. **Lance un défi.**
    Le travail bien fait satisfait le besoin profond d'importance. "Le moyen
    sûr d'obtenir des résultats est de stimuler la compétition."

═══════════════════════════════════════════════════════════════════════════════
PARTIE IV — CHANGER LES GENS SANS LES OFFENSER
═══════════════════════════════════════════════════════════════════════════════

22. **Commence par des compliments et de l'appréciation sincère.**
23. **Signale les erreurs INDIRECTEMENT.** ("J'ai remarqué que…" plutôt que "tu as fait…")
24. **Parle de tes propres erreurs avant de critiquer celles de l'autre.**
25. **Pose des questions au lieu de donner des ordres.** ("Et si on essayait…?")
26. **Permets à l'autre de sauver la face.** Jamais d'humiliation publique.
27. **Loue le moindre progrès et chaque progrès. Sois "chaleureux dans ton approbation et prodigue dans tes éloges".**
28. **Donne à l'autre une réputation à laquelle il devra se montrer digne.**
29. **Encourage. Fais paraître la faute facile à corriger.**
30. **Fais en sorte que l'autre soit content de faire ce que tu suggères.**

═══════════════════════════════════════════════════════════════════════════════
PARTIE V — EXTENSIONS MODERNES (au-delà de Carnegie)
═══════════════════════════════════════════════════════════════════════════════

**Voss — Negotiation tactique :**
- **Tactical empathy** : nomme l'émotion de l'autre ("on dirait que tu es frustré").
- **Mirroring** : répète les 1-3 derniers mots de l'autre, avec intonation montante.
  Effet : il développe.
- **Calibrated questions** : "Comment puis-je faire ça ?" force l'autre à
  trouver une solution, désamorce la confrontation.
- **No is the new yes** : laisse l'autre dire non — il se sent en contrôle.
- **"That's right"** > "you're right". Vise le premier.

**Cialdini — 6 leviers d'influence :**
- Réciprocité (donne d'abord), Engagement/cohérence (petit oui → grand oui),
  Preuve sociale, Autorité, Sympathie, Rareté.

**Cabane — Charisme = présence + puissance + chaleur.**
- **Présence** : 100% attention à l'instant. Métabolise les ruminations,
  reviens aux sensations corporelles avant chaque interaction.
- **Body language** : posture ouverte, contact visuel soutenu (60-70%), pas
  d'auto-touching nerveux.
- Avant un événement social : visualise un souvenir où tu te sentais aimé/puissant.
  Ton corps adopte le même état.

**Rosenberg — CNV (4 étapes pour conflit) :**
1. **Observation** sans jugement ("quand tu arrives 30 min après l'heure")
2. **Sentiment** ("je me sens frustré")
3. **Besoin** ("parce que j'ai besoin de respect de mon temps")
4. **Demande** concrète et négociable ("peux-tu m'envoyer un SMS si tu es en retard ?")

**Lowndes — Petits hacks :**
- **Sticky eyes** : maintiens le regard 1 seconde de plus que naturel après la
  fin d'une phrase de l'autre.
- **Big-baby pivot** : tourne tout ton corps (pas juste la tête) vers l'autre
  quand il parle.
- **Hello old friend** : aborde un inconnu comme si tu retrouvais un vieil ami.
- **Never the naked thank you** : "merci POUR [chose précise]".

**Habits long-terme :**
- **Suivi** : SMS/message 24-48h après une rencontre marquante. "Content de
  t'avoir croisé, j'ai repensé à ce que tu disais sur X."
- **Journal social** : note prénoms, détails, projets de tes contacts.
  À ressortir lors de la prochaine rencontre.
- **Réciprocité programmée** : envoie une ressource utile sans rien demander
  en retour, 2-3 fois par an, à tes contacts clés.
- **Vulnérabilité calibrée** : partager une faille humaine renforce le lien
  (Brené Brown). Pas du dumping émotionnel — une touche.

**Pièges à éviter :**
- Le "name-dropping" pour impressionner → effet inverse.
- Le sarcasme avec quelqu'un qu'on connaît mal.
- Donner des conseils non sollicités (proposer "veux-tu mon avis ?" d'abord).
- Comparer la souffrance de l'autre à la sienne ("moi aussi j'ai vécu pire").
- Téléphone visible pendant une conversation = -50% de qualité perçue.

═══════════════════════════════════════════════════════════════════════════════
RÈGLE D'OR OPÉRATIONNELLE
═══════════════════════════════════════════════════════════════════════════════

Avant chaque interaction importante, demande-toi :
1. Que veut/ressent/craint cette personne en ce moment ?
2. Comment puis-je la faire se sentir importante, écoutée, comprise ?
3. Quelle est l'issue où NOUS DEUX gagnons ?

Le meilleur ami est celui qui te rappelle qui tu veux devenir, sans te juger
pour qui tu es aujourd'hui.
""",
)

# ─────────────────────────────────────────────────────────────────────────────
def select_skills(user_message: str, workspace_files: list[str] | None = None) -> str:
    """Delegate to the persistent skill store (builtin + learned)."""
    return skills_store.select_skills(user_message, workspace_files)
