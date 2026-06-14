"""Top-down RPG kit — Zelda/Pokemon-style. Grid movement, NPC dialog, turn-based battle."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/kit.ts"] = """import { MainMenuScene } from './scenes/MainMenu';
import { GameScene } from './scenes/Game';
import { BattleScene } from './scenes/Battle';

export const KIT_SCENES = [MainMenuScene, GameScene, BattleScene];
export const KIT_GRAVITY = 0;
export const KIT_NAME = 'topdown-rpg';
"""

FILES["src/entities/AGENT.md"] = """# AGENT.md — entities (top-down RPG)

- `Player.ts` — 4-direction grid movement (uses `engine/GridMovement`)
- `NPC.ts` — static character that triggers dialog on overlap
- `EncounterTrigger.ts` — invisible zone that fires battle scene
"""

FILES["src/entities/Player.ts"] = """import Phaser from 'phaser';
import { GridMover } from '../engine/GridMovement';

export class Player extends Phaser.GameObjects.Sprite {
  mover!: GridMover;
  constructor(scene: Phaser.Scene, x: number, y: number, tile: number, canEnter: (gx: number, gy: number) => boolean) {
    super(scene, x, y, 'player_sheet', 0);
    scene.add.existing(this);
    this.mover = new GridMover(this, tile, 140, canEnter);
    this.play('player-idle');
  }
  tickInput(dir: 'left' | 'right' | 'up' | 'down' | null) {
    if (!dir || this.mover.isMoving()) {
      this.setFlipX(this.mover.facing === 'left');
      return;
    }
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    this.mover.tryMove(dx as -1|0|1, dy as -1|0|1);
    this.setFlipX(this.mover.facing === 'left');
  }
}
"""

FILES["src/entities/NPC.ts"] = """import Phaser from 'phaser';

export class NPC extends Phaser.GameObjects.Sprite {
  lines: string[];
  gx: number; gy: number;
  constructor(scene: Phaser.Scene, x: number, y: number, gx: number, gy: number, lines: string[]) {
    super(scene, x, y, 'enemy_sheet', 0);
    this.lines = lines;
    this.gx = gx; this.gy = gy;
    scene.add.existing(this);
    this.setTint(0x60a5fa);
  }
}
"""

FILES["src/levels/AGENT.md"] = """# AGENT.md — levels (top-down RPG)

`world.ts` describes the overworld grid: walls, NPCs, encounter zones, exit.
`enemies.ts` lists battlable enemy archetypes with stats.
"""

FILES["src/levels/world.ts"] = """// Open world : carte = grille de maps. Chaque map a 4 voisins (north/south/east/west).
// Le joueur sort par un bord → la map cible est chargée et il rentre par le bord opposé.

export interface MapDef {
  id: string;
  cols: number; rows: number;
  tint: number;                                    // background color
  walls: Array<[number, number]>;
  npcs: Array<{ x: number; y: number; lines: string[] }>;
  encounters: Array<[number, number]>;
  neighbors: { n?: string; s?: string; e?: string; w?: string };
  exit?: [number, number];                          // optional win tile
}

const ring = (cols: number, rows: number, gaps: { n?: boolean; s?: boolean; e?: boolean; w?: boolean }): Array<[number, number]> => {
  const w: Array<[number, number]> = [];
  for (let i = 0; i < cols; i++) {
    if (!gaps.n || i !== Math.floor(cols/2)) w.push([i, 0]);
    if (!gaps.s || i !== Math.floor(cols/2)) w.push([i, rows-1]);
  }
  for (let i = 1; i < rows-1; i++) {
    if (!gaps.w || i !== Math.floor(rows/2)) w.push([0, i]);
    if (!gaps.e || i !== Math.floor(rows/2)) w.push([cols-1, i]);
  }
  return w;
};

export const WORLD: Record<string, MapDef> = {
  village: {
    id: 'village', cols: 20, rows: 15, tint: 0x1a3a1a,
    walls: [...ring(20, 15, { e: true, s: true }),
      [8, 6], [9, 6], [10, 6], [11, 6], [8, 7], [11, 7]],   // house
    npcs: [
      { x: 5, y: 5, lines: ['Welcome to PIXEL VILLAGE.', 'East: forest.', 'South: cave path.'] },
      { x: 14, y: 9, lines: ['Wild slimes east!', 'Pack potions.'] },
    ],
    encounters: [],
    neighbors: { e: 'forest', s: 'path' },
  },
  forest: {
    id: 'forest', cols: 20, rows: 15, tint: 0x14532d,
    walls: [...ring(20, 15, { w: true, e: true }),
      [4, 4], [5, 4], [4, 5], [12, 9], [13, 9], [13, 10]],
    npcs: [{ x: 10, y: 7, lines: ['The trees whisper.', 'Boss lies further east.'] }],
    encounters: [[6, 6], [10, 8], [14, 5], [9, 11]],
    neighbors: { w: 'village', e: 'boss' },
  },
  path: {
    id: 'path', cols: 20, rows: 15, tint: 0x422006,
    walls: [...ring(20, 15, { n: true, s: true })],
    npcs: [],
    encounters: [[8, 5], [11, 9]],
    neighbors: { n: 'village', s: 'cave' },
  },
  cave: {
    id: 'cave', cols: 18, rows: 13, tint: 0x1f2937,
    walls: [...ring(18, 13, { n: true })],
    npcs: [{ x: 9, y: 6, lines: ['You found the relic!', 'Return to the village.'] }],
    encounters: [[5, 4], [12, 8], [9, 9]],
    neighbors: { n: 'path' },
  },
  boss: {
    id: 'boss', cols: 16, rows: 12, tint: 0x3b0764,
    walls: [...ring(16, 12, { w: true })],
    npcs: [],
    encounters: [],
    neighbors: { w: 'forest' },
    exit: [8, 6],
  },
};

export const START_MAP = 'village';
export const START_POS: [number, number] = [3, 7];
"""

FILES["src/levels/enemies.ts"] = """import { Combatant } from '../engine/TurnBattle';

export function makeEnemy(name: string, hp = 8, atk = 4, def = 1, spd = 5): Combatant {
  return {
    id: name + '_' + Math.random().toString(36).slice(2, 6),
    name, hp, maxHp: hp, atk, def, spd,
    team: 'enemies',
    alive() { return this.hp > 0; },
  };
}

export function makeHero(): Combatant {
  return {
    id: 'hero',
    name: 'HERO',
    hp: 20, maxHp: 20, atk: 6, def: 2, spd: 6,
    team: 'party',
    alive() { return this.hp > 0; },
  };
}

export const ENEMY_POOL = ['SLIME', 'BAT', 'GHOST'];
"""

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenu'); }
  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, 60, 'TOP-DOWN RPG', { fontFamily: 'monospace', fontSize: '20px', color: '#34d399' }).setOrigin(0.5);
    this.add.text(w/2, h/2, 'SPACE: START', { fontFamily: 'monospace', fontSize: '12px', color: '#fff' }).setOrigin(0.5);
    Music.start();
    this.input.keyboard!.once('keydown-SPACE', () => {
      sfx('confirm'); Music.stop();
      this.scene.start('Game');
    });
  }
}
"""

FILES["src/scenes/Game.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { Player } from '../entities/Player';
import { NPC } from '../entities/NPC';
import { Cam } from '../engine/Camera';
import { InputMap } from '../engine/Input';
import { Dialog } from '../engine/Dialog';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { wipe } from '../engine/Transitions';
import { autotileVariant } from '../engine/Autotile';
import { WORLD, START_MAP, START_POS, MapDef } from '../levels/world';

const BIOME_BY_MAP: Record<string, string> = {
  village: 'grass', forest: 'grass', path: 'dirt', cave: 'cave', boss: 'stone',
};

interface InitData { mapId?: string; px?: number; py?: number; }

export class GameScene extends Phaser.Scene {
  player!: Player;
  in!: InputMap;
  npcs: NPC[] = [];
  walls = new Set<string>();
  dialog!: Dialog;
  cooldown = 0;
  current!: MapDef;
  spawn: [number, number] = START_POS;
  spawnMap = START_MAP;
  private static keyOf(gx: number, gy: number) { return gx + ',' + gy; }

  constructor() { super('Game'); }

  init(data: InitData) {
    this.spawnMap = data.mapId || START_MAP;
    this.spawn = (data.px !== undefined && data.py !== undefined) ? [data.px, data.py] : START_POS;
  }

  create() {
    const T = CONFIG.WORLD.TILE;
    const m = WORLD[this.spawnMap];
    this.current = m;
    const W = m.cols * T, H = m.rows * T;
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.setBackgroundColor(Phaser.Display.Color.IntegerToColor(m.tint).rgba);

    this.walls.clear();
    this.npcs = [];
    const wallSet = new Set<string>();
    for (const [c, r] of m.walls) wallSet.add(c + ',' + r);
    const biome = BIOME_BY_MAP[m.id] || 'stone';
    for (const [c, r] of m.walls) {
      const v = autotileVariant(wallSet, c, r);
      this.add.image(c*T+T/2, r*T+T/2, 'tile_' + biome + v);
      this.walls.add(GameScene.keyOf(c, r));
    }

    for (const n of m.npcs) {
      this.npcs.push(new NPC(this, n.x*T+T/2, n.y*T+T/2, n.x, n.y, n.lines));
      this.walls.add(GameScene.keyOf(n.x, n.y));
    }

    const canEnter = (gx: number, gy: number) => {
      // Edge tiles act as exits when neighbor exists in that direction.
      const inX = gx >= 0 && gx < m.cols;
      const inY = gy >= 0 && gy < m.rows;
      if (!inX || !inY) {
        if (gx < 0 && m.neighbors.w) return true;
        if (gx >= m.cols && m.neighbors.e) return true;
        if (gy < 0 && m.neighbors.n) return true;
        if (gy >= m.rows && m.neighbors.s) return true;
        return false;
      }
      return !this.walls.has(GameScene.keyOf(gx, gy));
    };

    this.player = new Player(this, this.spawn[0]*T+T/2, this.spawn[1]*T+T/2, T, canEnter);

    if (m.exit) this.add.rectangle(m.exit[0]*T+T/2, m.exit[1]*T+T/2, T, T, 0xfde047);

    const cam = new Cam(this.cameras.main);
    cam.bounds(W, H);
    cam.follow(this.player);

    this.in = new InputMap(this);
    this.dialog = new Dialog(this);

    Music.start();
  }

  private travel(toMap: string, entryEdge: 'n'|'s'|'e'|'w') {
    const dest = WORLD[toMap];
    const T = CONFIG.WORLD.TILE;
    let px = Math.floor(dest.cols/2), py = Math.floor(dest.rows/2);
    if (entryEdge === 'w') { px = 1; py = Math.floor(dest.rows/2); }
    if (entryEdge === 'e') { px = dest.cols - 2; py = Math.floor(dest.rows/2); }
    if (entryEdge === 'n') { py = 1; px = Math.floor(dest.cols/2); }
    if (entryEdge === 's') { py = dest.rows - 2; px = Math.floor(dest.cols/2); }
    Music.stop();
    wipe(this, 'down', 250, () => this.scene.restart({ mapId: toMap, px, py }));
  }

  update(_t: number, dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.dialog.isActive()) return;
    if (this.in.pressed('pause')) { this.scene.launch('Pause'); this.scene.pause(); return; }

    let dir: 'left' | 'right' | 'up' | 'down' | null = null;
    if (this.in.isDown('left')) dir = 'left';
    else if (this.in.isDown('right')) dir = 'right';
    else if (this.in.isDown('up')) dir = 'up';
    else if (this.in.isDown('down')) dir = 'down';
    this.player.tickInput(dir);

    const T = CONFIG.WORLD.TILE;
    const m = this.current;
    const px = Math.round(this.player.x / T);
    const py = Math.round(this.player.y / T);

    // Edge crossings → load neighbor map
    if (!this.player.mover.isMoving()) {
      if (px < 0 && m.neighbors.w) return this.travel(m.neighbors.w, 'e');
      if (px >= m.cols && m.neighbors.e) return this.travel(m.neighbors.e, 'w');
      if (py < 0 && m.neighbors.n) return this.travel(m.neighbors.n, 's');
      if (py >= m.rows && m.neighbors.s) return this.travel(m.neighbors.s, 'n');
    }

    if (this.in.pressed('confirm') || this.in.pressed('jump')) {
      for (const npc of this.npcs) {
        if (Math.abs(npc.gx - px) + Math.abs(npc.gy - py) <= 1) {
          sfx('confirm');
          const nodes: Record<string, any> = {};
          npc.lines.forEach((l, i) => {
            nodes['n' + i] = { id: 'n' + i, text: l, next: i < npc.lines.length - 1 ? 'n' + (i+1) : undefined };
          });
          this.dialog.show(nodes, 'n0');
          return;
        }
      }
    }

    if (this.cooldown <= 0 && !this.player.mover.isMoving()) {
      for (const [ec, er] of m.encounters) {
        if (px === ec && py === er && Math.random() < 0.3) {
          this.cooldown = 1500;
          sfx('hurt');
          Music.stop();
          wipe(this, 'down', 300, () => this.scene.start('Battle', { onWin: 'Game', returnTo: m.id, returnPx: px, returnPy: py }));
          return;
        }
      }
    }

    if (m.exit && px === m.exit[0] && py === m.exit[1]) {
      Music.stop();
      this.scene.start('GameOver', { score: 100, win: true });
    }
  }
}
"""

FILES["src/scenes/Battle.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { TurnEngine, BattleAction } from '../engine/TurnBattle';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { wipe } from '../engine/Transitions';
import { makeEnemy, makeHero, ENEMY_POOL } from '../levels/enemies';

export class BattleScene extends Phaser.Scene {
  engine!: TurnEngine;
  hero!: ReturnType<typeof makeHero>;
  enemy!: ReturnType<typeof makeEnemy>;
  cursor = 0;
  log!: Phaser.GameObjects.Text;
  hpText!: Phaser.GameObjects.Text;
  options = ['ATTACK', 'DEFEND', 'RUN'];
  cursorSprite!: Phaser.GameObjects.Text;
  busy = false;
  onWinScene = 'Game';
  returnData: any = {};

  constructor() { super('Battle'); }

  create(data: { onWin?: string; returnTo?: string; returnPx?: number; returnPy?: number }) {
    this.onWinScene = data?.onWin || 'Game';
    this.returnData = { mapId: data?.returnTo, px: data?.returnPx, py: data?.returnPy };
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.cameras.main.setBackgroundColor('#222034');

    this.hero = makeHero();
    const enemyName = ENEMY_POOL[Math.floor(Math.random() * ENEMY_POOL.length)];
    this.enemy = makeEnemy(enemyName);

    this.engine = new TurnEngine();
    this.engine.add(this.hero);
    this.engine.add(this.enemy);

    this.add.rectangle(w*0.7, h*0.3, 36, 36, 0xff4080);
    this.add.rectangle(w*0.25, h*0.55, 28, 28, 0x60a5fa);

    this.add.text(w*0.7, h*0.3 + 26, this.enemy.name, { fontFamily: 'monospace', fontSize: '10px', color: '#fff' }).setOrigin(0.5);
    this.hpText = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fff' });

    this.options.forEach((o, i) => {
      this.add.text(40, h - 60 + i*14, o, { fontFamily: 'monospace', fontSize: '12px', color: '#fff' });
    });
    this.cursorSprite = this.add.text(20, h - 60, '>', { fontFamily: 'monospace', fontSize: '12px', color: '#fde047' });
    this.log = this.add.text(w/2, h - 12, '', { fontFamily: 'monospace', fontSize: '10px', color: '#fde047' }).setOrigin(0.5, 1);

    this.engine.start();
    this.refreshHud();
    Music.start();
  }

  refreshHud() {
    this.hpText.setText(`HERO HP ${this.hero.hp}/${this.hero.maxHp}\\nFOE  HP ${this.enemy.hp}/${this.enemy.maxHp}`);
    this.cursorSprite.setY((CONFIG.WORLD.VIEW_HEIGHT) - 60 + this.cursor*14);
  }

  doAction(act: string) {
    if (this.busy) return;
    this.busy = true;
    if (act === 'RUN') {
      this.log.setText('Got away!');
      sfx('confirm');
      this.time.delayedCall(600, () => { Music.stop(); wipe(this, 'up', 300, () => this.scene.start(this.onWinScene, this.returnData)); });
      return;
    }
    if (act === 'ATTACK') {
      const a: BattleAction = { actor: this.hero, type: 'attack', targetId: this.enemy.id };
      this.engine.resolve(a);
      sfx('attack');
      this.log.setText('You hit ' + this.enemy.name);
    } else {
      this.log.setText('You defend.');
    }
    this.refreshHud();
    if (!this.enemy.alive()) {
      this.time.delayedCall(700, () => { sfx('victory'); Music.stop(); wipe(this, 'up', 300, () => this.scene.start(this.onWinScene, this.returnData)); });
      return;
    }
    this.time.delayedCall(500, () => {
      const ea: BattleAction = { actor: this.enemy, type: 'attack', targetId: this.hero.id };
      this.engine.resolve(ea);
      sfx('hurt');
      this.refreshHud();
      this.log.setText(this.enemy.name + ' hits you');
      if (!this.hero.alive()) {
        this.time.delayedCall(600, () => { Music.stop(); this.scene.start('GameOver', { score: 0 }); });
      } else {
        this.time.delayedCall(400, () => { this.busy = false; this.log.setText(''); });
      }
    });
  }

  update() {
    if (this.busy) return;
    const k = this.input.keyboard!;
    if (Phaser.Input.Keyboard.JustDown(k.addKey('UP'))) { this.cursor = (this.cursor + this.options.length - 1) % this.options.length; this.refreshHud(); sfx('confirm'); }
    if (Phaser.Input.Keyboard.JustDown(k.addKey('DOWN'))) { this.cursor = (this.cursor + 1) % this.options.length; this.refreshHud(); sfx('confirm'); }
    if (Phaser.Input.Keyboard.JustDown(k.addKey('SPACE')) || Phaser.Input.Keyboard.JustDown(k.addKey('ENTER'))) {
      this.doAction(this.options[this.cursor]);
    }
  }
}
"""
