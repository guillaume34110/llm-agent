"""Platformer-specific overrides for the 2D game scaffold template."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { load, save, reset } from '../engine/Save';
import { unlockAudio, isMuted, toggleMute } from '../engine/Audio';
import { Music } from '../engine/Music';
import { wipe } from '../engine/Transitions';
import { t, currentLocale, availableLocales, setLocale } from '../i18n';

const ITEMS = ['start', 'continue', 'mute', 'language', 'reset'] as const;
type Item = typeof ITEMS[number];

export class MainMenuScene extends Phaser.Scene {
  private idx = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private cooldownUntil = 0;
  private titleText!: Phaser.GameObjects.Text;
  private hiText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private touchText!: Phaser.GameObjects.Text;

  constructor() { super('MainMenu'); }

  create() {
    document.getElementById('loading')?.classList.add('hidden');
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.titleText = this.add.text(w/2, 50, '', {
      fontFamily: 'monospace', fontSize: '32px', color: '#ffffff'
    }).setOrigin(0.5);

    this.hiText = this.add.text(w/2, 88, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa'
    }).setOrigin(0.5);

    this.texts = ITEMS.map((_label, i) => {
      const t = this.add.text(w/2, 130 + i * 18, '', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff'
      }).setOrigin(0.5);
      t.setData('i', i);
      t.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.idx = i; this.activate(); });
      return t;
    });

    this.touchText = this.add.text(w/2, h - 28, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#7dd3fc'
    }).setOrigin(0.5);

    this.hintText = this.add.text(w/2, h - 16, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#666'
    }).setOrigin(0.5);

    this.refresh();
    this.cooldownUntil = this.time.now + 200;

    this.input.keyboard!.on('keydown-UP',    () => { this.idx = (this.idx + ITEMS.length - 1) % ITEMS.length; this.refresh(); });
    this.input.keyboard!.on('keydown-DOWN',  () => { this.idx = (this.idx + 1) % ITEMS.length; this.refresh(); });
    this.input.keyboard!.on('keydown-W',     () => { this.idx = (this.idx + ITEMS.length - 1) % ITEMS.length; this.refresh(); });
    this.input.keyboard!.on('keydown-S',     () => { this.idx = (this.idx + 1) % ITEMS.length; this.refresh(); });
    this.input.keyboard!.on('keydown-ENTER', () => this.activate());
    this.input.keyboard!.on('keydown-SPACE', () => this.activate());
    this.input.keyboard!.on('keydown-M',     () => { toggleMute(); this.refresh(); });
    this.input.keyboard!.on('keydown-L',     () => { this.cycleLocale(); this.refresh(); });
  }

  private refresh() {
    const hi = load().highScore.toString().padStart(5, '0');
    this.titleText.setText(t('menu.title'));
    this.hiText.setText(t('menu.highScore', { n: hi }));
    this.hintText.setText(t('menu.controls'));
    this.touchText.setText(t('menu.touch', { state: this.touchState() }));
    this.texts.forEach((label, i) => {
      const base = this.itemLabel(ITEMS[i]);
      const sel = i === this.idx;
      label.setText(sel ? `> ${base} <` : base);
      label.setColor(sel ? '#fbbf24' : '#ffffff');
    });
  }

  private activate() {
    if (this.time.now < this.cooldownUntil) return;
    unlockAudio();
    const choice: Item = ITEMS[this.idx];
    if (choice === 'start') {
      save({ lastLevel: 'level1', completed: false });
      Music.start();
      wipe(this, 'left', 400, () => this.scene.start('Game', { level: 'level1' }));
    } else if (choice === 'continue') {
      const s = load();
      Music.start();
      wipe(this, 'left', 400, () => this.scene.start('Game', { level: s.lastLevel || 'level1' }));
    } else if (choice === 'mute') {
      toggleMute();
      this.refresh();
    } else if (choice === 'language') {
      this.cycleLocale();
      this.refresh();
    } else if (choice === 'reset') {
      reset();
      this.scene.restart();
    }
  }

  private itemLabel(choice: Item) {
    if (choice === 'start') return t('menu.start');
    if (choice === 'continue') return t('menu.continue');
    if (choice === 'mute') return t('menu.mute', { state: isMuted() ? t('common.off') : t('common.on') });
    if (choice === 'language') return t('menu.language', { code: currentLocale().toUpperCase() });
    return t('menu.reset');
  }

  private cycleLocale() {
    const locales = availableLocales();
    const idx = locales.indexOf(currentLocale());
    setLocale(locales[(idx + 1) % locales.length]);
  }

  private touchState() {
    const forced = typeof location !== 'undefined' && /[?&]touch=1\\b/.test(location.search);
    const on = forced || this.sys.game.device.input.touch;
    return t(on ? 'common.on' : 'common.off');
  }
}
"""

FILES["src/scenes/Game.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { Cam } from '../engine/Camera';
import { attachEditor, EditorState, type EditorMap } from '../engine/Editor';
import { InputMap } from '../engine/Input';
import { autotileVariant } from '../engine/Autotile';
import { PerfMonitor, shouldShowPerf, perfLabel } from '../engine/Perf';
import { HUD } from '../engine/UI';
import { sfx } from '../engine/Audio';
import { sparkle, dust } from '../engine/Particles';
import { Parallax } from '../engine/Parallax';
import { TouchControls } from '../engine/Touch';
import { wipe } from '../engine/Transitions';
import { save } from '../engine/Save';
import { t } from '../i18n';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Goal } from '../entities/Goal';
import { LEVEL_1 } from '../levels/level1';
import { LEVEL_2 } from '../levels/level2';
import { LEVEL_3 } from '../levels/level3';

interface LevelDef {
  spawn: { x: number; y: number };
  goal: { x: number; y: number } | null;
  coins: Array<{ x: number; y: number }>;
  enemies: Array<{ x: number; y: number; minX: number; maxX: number }>;
  buildPlatforms: (g: Phaser.Physics.Arcade.StaticGroup) => void;
  editorMap: EditorMap;
  next: string | null;
  width: number;
  height: number;
}

function rowsToEditorMap(rows: string[]): EditorMap {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tiles: rows.map((row) => [...row].map((ch) => ch === '#' ? 1 : 0)),
  };
}

function platformerEditorMap(): EditorMap {
  const T = CONFIG.WORLD.TILE;
  const cols = Math.floor(CONFIG.WORLD.LEVEL_WIDTH / T);
  const rows = Math.floor(CONFIG.WORLD.LEVEL_HEIGHT / T);
  const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const pl of LEVEL_1.platforms) {
    const row = Math.floor(pl.y / T);
    const col = Math.floor(pl.x / T);
    for (let i = 0; i < pl.w; i++) tiles[row][col + i] = 1;
  }
  return { width: cols, height: rows, tiles };
}

function fromTilemap(L: { rows: string[]; parsed: any; next: string | null }, T: number): LevelDef {
  const p = L.parsed;
  return {
    spawn: p.spawn, goal: p.goal, coins: p.coins, enemies: p.enemies,
    buildPlatforms: p.buildPlatforms,
    editorMap: rowsToEditorMap(L.rows),
    next: L.next,
    width: L.rows[0].length * T,
    height: L.rows.length * T
  };
}

function levelByName(name: string): LevelDef {
  const W = CONFIG.WORLD.LEVEL_WIDTH, H = CONFIG.WORLD.LEVEL_HEIGHT, T = CONFIG.WORLD.TILE;
  if (name === 'level2') return fromTilemap(LEVEL_2, T);
  if (name === 'level3') return fromTilemap(LEVEL_3, T);
  return {
    spawn: LEVEL_1.spawn,
    goal: LEVEL_1.goal,
    coins: LEVEL_1.coins,
    enemies: LEVEL_1.enemies,
    buildPlatforms: (g) => {
      for (const pl of LEVEL_1.platforms) {
        for (let i = 0; i < pl.w; i++) g.create(pl.x + i * 16 + 8, pl.y + 8, 'platform').refreshBody();
      }
    },
    editorMap: platformerEditorMap(),
    next: LEVEL_1.next,
    width: W, height: H
  };
}

export class GameScene extends Phaser.Scene {
  player!: Player;
  enemies!: Phaser.Physics.Arcade.Group;
  coins!: Phaser.Physics.Arcade.StaticGroup;
  platforms!: Phaser.Physics.Arcade.StaticGroup;
  goal!: Goal | null;
  cam!: Cam;
  input2!: InputMap;
  hud!: HUD;
  scoreText!: Phaser.GameObjects.Text;
  livesText!: Phaser.GameObjects.Text;
  levelText!: Phaser.GameObjects.Text;
  score: number = 0;
  lives: number = CONFIG.PLAYER.LIVES;
  levelName: string = 'level1';
  transitioning = false;
  touch!: TouchControls;
  perf!: PerfMonitor;
  fpsText?: Phaser.GameObjects.Text;

  constructor() { super('Game'); }

  init(data: { level?: string; score?: number; lives?: number }) {
    this.levelName = data?.level ?? 'level1';
    this.score = data?.score ?? 0;
    this.lives = data?.lives ?? CONFIG.PLAYER.LIVES;
    this.transitioning = false;
  }

  create() {
    const lvl = levelByName(this.levelName);
    this.physics.world.setBounds(0, 0, lvl.width, lvl.height);

    new Parallax(this, [
      { color: 0x0a0a23, scrollFactor: 0.0 },
      { color: 0x1e1e4a, scrollFactor: 0.2, height: 100, yOffset: lvl.height - 180 },
      { color: 0x2a2a6a, scrollFactor: 0.5, height: 60,  yOffset: lvl.height - 120, alpha: 0.7 }
    ]);

    this.platforms = this.physics.add.staticGroup();
    this.coins = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group({ allowGravity: true, collideWorldBounds: true });

    if (this.isEditorEnabled()) {
      const saved = EditorState.restore(localStorage, this.editorStorageKey());
      const seed = saved && saved.width === lvl.editorMap.width && saved.height === lvl.editorMap.height
        ? saved
        : new EditorState(lvl.editorMap);
      this.rebuildPlatformsFromEditor(seed);
      attachEditor(this, seed, CONFIG.WORLD.TILE, {
        storageKey: this.editorStorageKey(),
        onChange: (state) => this.rebuildPlatformsFromEditor(state),
      });
    } else {
      lvl.buildPlatforms(this.platforms);
    }
    for (const c of lvl.coins) this.coins.create(c.x, c.y, 'coin').refreshBody();
    for (const e of lvl.enemies) this.enemies.add(new Enemy(this, e.x, e.y, e.minX, e.maxX));

    this.goal = lvl.goal ? new Goal(this, lvl.goal.x, lvl.goal.y) : null;
    this.player = new Player(this, lvl.spawn.x, lvl.spawn.y);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.overlap(this.player, this.coins, (_p, c) => this.collectCoin(c as any));
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.hitEnemy(e as Enemy));
    if (this.goal) this.physics.add.overlap(this.player, this.goal, () => this.reachGoal());

    this.cam = new Cam(this.cameras.main);
    this.cam.bounds(lvl.width, lvl.height);
    this.cam.follow(this.player);
    this.cam.fadeIn(400);

    this.input2 = new InputMap(this);
    this.touch = new TouchControls(this);
    this.input2.external = { isDown: (a) => (a === 'left' || a === 'right' || a === 'jump') ? this.touch.isDown(a as any) : false };
    this.perf = new PerfMonitor();

    this.hud = new HUD(this);
    this.scoreText = this.hud.text(8, 6, this.scoreLabel(), 12);
    this.livesText = this.hud.text(CONFIG.WORLD.VIEW_WIDTH - 96, 6, this.livesLabel(), 12);
    this.levelText = this.hud.text(8, 20, this.levelLabel(), 10);
    if (CONFIG.DEBUG || shouldShowPerf()) this.fpsText = this.hud.text(8, 34, 'FPS --', 10);

    save({ lastLevel: this.levelName });
  }

  update(_t: number, dt: number) {
    if (this.transitioning) return;
    this.perf.tick(this.time.now);
    this.player.tick(dt, this.input2);
    this.enemies.children.each((e: any) => { e.tick(dt); return true; });
    if (this.fpsText) this.fpsText.setText(perfLabel(this.perf));
    if (this.player.y > CONFIG.WORLD.LEVEL_HEIGHT + 40) {
      this.player.takeHit();
      this.player.setPosition(40, 40);
      this.player.body.setVelocity(0, 0);
      this.lives--;
      this.livesText.setText(this.livesLabel());
      sfx('death');
      if (this.lives <= 0) {
        this.transitioning = true;
        this.cam.fadeOut(500, () => this.scene.start('GameOver', { score: this.score }));
      }
    }
    if (this.input2.pressed('pause')) {
      this.scene.launch('Pause');
      this.scene.pause();
    }
  }

  collectCoin(c: Phaser.GameObjects.GameObject) {
    sparkle(this, (c as any).x, (c as any).y);
    sfx('coin');
    (c as any).destroy();
    this.score += 10;
    this.scoreText.setText(this.scoreLabel());
  }

  hitEnemy(e: Enemy) {
    if (this.player.isInvulnerable()) return;
    if (this.player.body!.velocity.y > 0 && this.player.y < e.y - 4) {
      e.kill();
      this.player.bounce();
      this.score += 25;
      this.scoreText.setText(this.scoreLabel());
      sfx('hit');
      return;
    }
    this.player.takeHit();
    this.cam.shake();
    sfx('hit');
    dust(this, this.player.x, this.player.y);
    this.lives--;
    this.livesText.setText(this.livesLabel());
    if (this.lives <= 0) {
      this.transitioning = true;
      this.cam.fadeOut(500, () => this.scene.start('GameOver', { score: this.score }));
    }
  }

  reachGoal() {
    if (this.transitioning) return;
    this.transitioning = true;
    sfx('victory');
    const cur = levelByName(this.levelName);
    save({ lastLevel: cur.next || this.levelName });
    wipe(this, 'left', 500, () => {
      if (cur.next) this.scene.restart({ level: cur.next, score: this.score, lives: this.lives });
      else { save({ completed: true }); this.scene.start('GameOver', { score: this.score, win: true }); }
    });
  }

  scoreLabel() { return t('hud.score', { n: this.score.toString().padStart(5, '0') }); }
  livesLabel() { return t('hud.lives', { n: this.lives }); }
  levelLabel() {
    const n = this.levelName.replace(/^level/i, '');
    return t('hud.level', { n });
  }

  private isEditorEnabled() {
    return typeof location !== 'undefined' && /[?&]edit=1\\b/.test(location.search);
  }

  private editorStorageKey() {
    return `g2d-editor-map:${this.levelName}`;
  }

  private rebuildPlatformsFromEditor(state: EditorState) {
    const T = CONFIG.WORLD.TILE;
    this.platforms.clear(true, true);
    const solids = new Set<string>();
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (state.tiles[y][x] > 0) solids.add(`${x},${y}`);
    }
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.tiles[y][x] <= 0) continue;
        const variant = autotileVariant(solids, x, y);
        this.platforms.create(x * T + T / 2, y * T + T / 2, 'tile_stone' + variant).refreshBody();
      }
    }
  }
}
"""

FILES["src/scenes/Pause.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { t } from '../i18n';

export class PauseScene extends Phaser.Scene {
  constructor() { super('Pause'); }

  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0);
    this.add.text(w/2, h/2, t('pause.title'), {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(w/2, h/2 + 30, t('pause.resumePrompt'), {
      fontFamily: 'monospace', fontSize: '10px', color: '#fbbf24'
    }).setOrigin(0.5);

    this.input.keyboard!.once('keydown-ESC', () => {
      this.scene.stop();
      this.scene.resume('Game');
    });
  }
}
"""

FILES["src/scenes/GameOver.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { load, save } from '../engine/Save';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { wipe } from '../engine/Transitions';
import { t } from '../i18n';

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create(data: { score: number; win?: boolean }) {
    const score = data?.score ?? 0;
    const win = !!data?.win;
    const cur = load();
    const isNew = score > cur.highScore;
    if (isNew) save({ highScore: score });
    sfx(win || isNew ? 'victory' : 'death');

    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, h/2 - 30, win ? t('victory.title') : t('gameover.title'), {
      fontFamily: 'monospace', fontSize: '24px', color: win ? '#4ade80' : '#f87171'
    }).setOrigin(0.5);
    this.add.text(
      w/2,
      h/2,
      (win ? t('victory.score', { n: score }) : t('hud.score', { n: score })) +
        (isNew ? `  (${t('gameover.newBest')})` : ''),
      {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff'
      }
    ).setOrigin(0.5);
    this.add.text(w/2, h/2 + 30, t('gameover.menuPrompt'), {
      fontFamily: 'monospace', fontSize: '10px', color: '#fbbf24'
    }).setOrigin(0.5);

    this.input.keyboard!.once('keydown-SPACE', () => {
      Music.stop();
      wipe(this, 'right', 400, () => this.scene.start('MainMenu'));
    });
  }
}
"""

FILES["src/levels/AGENT.md"] = """# AGENT.md — src/levels/

Niveaux = pure data (pas de logique). Une scene Game lit cette data et instancie le monde.

## Format
```ts
export const LEVEL_1 = {
  spawn: { x, y },                       // player start
  platforms: [{ x, y, w }, ...],         // w en tiles de 16px
  coins: [{ x, y }, ...],
  enemies: [{ x, y, minX, maxX }, ...]   // patrol bounds
};
```

## Pour AJOUTER un niveau
1. Crée `src/levels/level2.ts`
2. Importe-le dans `Game.ts` (et ajoute logique de progression si besoin)
3. Pas de code, que des coordonnées — un LLM peut générer un niveau de zéro en quelques secondes.

## Variante Tiled JSON
- Parseur prêt dans `engine/TiledLoader.ts`
- Usage type :
```ts
import raw from './my-level.tiled.json';
import { parseTiled, parseTiledLevel, tiledToAscii } from '../engine/TiledLoader';

const MAP = parseTiled(raw as any);
export const LEVEL_X = {
  rows: tiledToAscii(MAP),
  parsed: parseTiledLevel(raw as any),
  next: null as string | null,
};
```

## Tips placement
- Player commence en bas-gauche (`x:50, y:H-50`)
- Sol = `{ x:0, y:H-16, w: LEVEL_WIDTH/16 }`
- Plateformes flottantes : laisse 48-80px de gap vertical pour qu'un saut classique passe
- Enemy patrol bounds : `maxX - minX >= 64` minimum
"""
