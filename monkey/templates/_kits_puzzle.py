"""Puzzle kit — Tetris-style falling-block grid puzzle."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/kit.ts"] = """import { MainMenuScene } from './scenes/MainMenu';
import { GameScene } from './scenes/Game';

export const KIT_SCENES = [MainMenuScene, GameScene];
export const KIT_GRAVITY = 0;
export const KIT_NAME = 'puzzle';
"""

FILES["src/entities/AGENT.md"] = """# AGENT.md — entities (puzzle)

No physics entities. Grid + tetromino state lives in `Game.ts` directly.
"""

FILES["src/entities/Player.ts"] = """// Puzzle kit has no Player entity. Kept as stub for engine modules that import it.
export {};
"""

FILES["src/entities/Enemy.ts"] = """export {};
"""

FILES["src/entities/Goal.ts"] = """export {};
"""

FILES["src/levels/AGENT.md"] = """# AGENT.md — levels (puzzle)

`pieces.ts` — tetromino shapes + colors. Tune speed in `Game.ts` (`fallMs`).
"""

FILES["src/levels/pieces.ts"] = """export type Shape = number[][];

export interface Piece { shape: Shape; color: number; }

export const PIECES: Piece[] = [
  { shape: [[1,1,1,1]], color: 0x22d3ee },           // I
  { shape: [[1,1],[1,1]], color: 0xfde047 },         // O
  { shape: [[0,1,0],[1,1,1]], color: 0xa78bfa },     // T
  { shape: [[1,0,0],[1,1,1]], color: 0x60a5fa },     // J
  { shape: [[0,0,1],[1,1,1]], color: 0xfb923c },     // L
  { shape: [[1,1,0],[0,1,1]], color: 0x34d399 },     // S
  { shape: [[0,1,1],[1,1,0]], color: 0xf87171 },     // Z
];

export function rotate(shape: Shape): Shape {
  const r = shape.length, c = shape[0].length;
  const out: Shape = Array.from({ length: c }, () => Array(r).fill(0));
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) out[x][r - 1 - y] = shape[y][x];
  return out;
}
"""

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenu'); }
  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, 50, 'BLOCKS', { fontFamily: 'monospace', fontSize: '22px', color: '#fde047' }).setOrigin(0.5);
    this.add.text(w/2, h/2, 'SPACE: START\\nARROWS: MOVE\\nUP: ROTATE\\nX: HARD DROP', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fff', align: 'center'
    }).setOrigin(0.5);
    Music.start();
    this.input.keyboard!.once('keydown-SPACE', () => { sfx('confirm'); Music.stop(); this.scene.start('Game'); });
  }
}
"""

FILES["src/scenes/Game.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { InputMap } from '../engine/Input';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { PIECES, rotate, Shape } from '../levels/pieces';

const COLS = 10;
const ROWS = 20;
const CELL = 8;

interface Active { shape: Shape; color: number; x: number; y: number; }

export class GameScene extends Phaser.Scene {
  in!: InputMap;
  grid: number[][] = [];
  colors: number[][] = [];
  active!: Active;
  fallMs = 600;
  fallAcc = 0;
  moveAcc = 0;
  score = 0;
  hud!: Phaser.GameObjects.Text;
  gfx!: Phaser.GameObjects.Graphics;
  ox = 0;
  oy = 0;

  constructor() { super('Game'); }

  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.cameras.main.setBackgroundColor('#0b0d2b');
    this.ox = Math.floor((w - COLS * CELL) / 2);
    this.oy = Math.floor((h - ROWS * CELL) / 2);
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.colors = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.in = new InputMap(this);
    this.gfx = this.add.graphics();
    this.hud = this.add.text(4, 4, 'SCORE 0', { fontFamily: 'monospace', fontSize: '10px', color: '#fff' });
    this.spawn();
    Music.start();
  }

  spawn() {
    const p = PIECES[Math.floor(Math.random() * PIECES.length)];
    const shape = p.shape.map(r => r.slice());
    this.active = { shape, color: p.color, x: Math.floor((COLS - shape[0].length) / 2), y: 0 };
    if (this.collide(this.active.shape, this.active.x, this.active.y)) {
      Music.stop();
      this.scene.start('GameOver', { score: this.score });
    }
  }

  collide(shape: Shape, ax: number, ay: number): boolean {
    for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[0].length; x++) {
      if (!shape[y][x]) continue;
      const gx = ax + x, gy = ay + y;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && this.grid[gy][gx]) return true;
    }
    return false;
  }

  lock() {
    const s = this.active.shape;
    for (let y = 0; y < s.length; y++) for (let x = 0; x < s[0].length; x++) {
      if (!s[y][x]) continue;
      const gy = this.active.y + y, gx = this.active.x + x;
      if (gy >= 0 && gy < ROWS) { this.grid[gy][gx] = 1; this.colors[gy][gx] = this.active.color; }
    }
    sfx('confirm');
    this.clearLines();
    this.spawn();
  }

  clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(v => v)) {
        this.grid.splice(y, 1); this.colors.splice(y, 1);
        this.grid.unshift(Array(COLS).fill(0)); this.colors.unshift(Array(COLS).fill(0));
        cleared++; y++;
      }
    }
    if (cleared > 0) {
      this.score += [0, 100, 300, 500, 800][cleared] || 1000;
      this.hud.setText('SCORE ' + this.score);
      sfx('explode');
    }
  }

  hardDrop() {
    while (!this.collide(this.active.shape, this.active.x, this.active.y + 1)) this.active.y++;
    this.lock();
  }

  update(_t: number, dt: number) {
    if (this.in.pressed('pause')) { this.scene.launch('Pause'); this.scene.pause(); return; }

    this.moveAcc -= dt;
    if (this.moveAcc <= 0) {
      if (this.in.isDown('left') && !this.collide(this.active.shape, this.active.x - 1, this.active.y)) {
        this.active.x--; this.moveAcc = 90;
      } else if (this.in.isDown('right') && !this.collide(this.active.shape, this.active.x + 1, this.active.y)) {
        this.active.x++; this.moveAcc = 90;
      } else if (this.in.isDown('down') && !this.collide(this.active.shape, this.active.x, this.active.y + 1)) {
        this.active.y++; this.moveAcc = 50; this.fallAcc = 0;
      }
    }
    if (this.in.pressed('jump') || this.in.pressed('up')) {
      const r = rotate(this.active.shape);
      if (!this.collide(r, this.active.x, this.active.y)) { this.active.shape = r; sfx('attack'); }
    }
    if (this.in.pressed('attack')) this.hardDrop();

    this.fallAcc += dt;
    if (this.fallAcc >= this.fallMs) {
      this.fallAcc = 0;
      if (!this.collide(this.active.shape, this.active.x, this.active.y + 1)) this.active.y++;
      else this.lock();
    }

    this.draw();
  }

  draw() {
    const g = this.gfx; g.clear();
    g.fillStyle(0x000000, 0.5).fillRect(this.ox - 1, this.oy - 1, COLS * CELL + 2, ROWS * CELL + 2);
    g.lineStyle(1, 0x334155, 1).strokeRect(this.ox - 1, this.oy - 1, COLS * CELL + 2, ROWS * CELL + 2);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (this.grid[y][x]) g.fillStyle(this.colors[y][x], 1).fillRect(this.ox + x * CELL, this.oy + y * CELL, CELL - 1, CELL - 1);
    }
    const s = this.active.shape;
    g.fillStyle(this.active.color, 1);
    for (let y = 0; y < s.length; y++) for (let x = 0; x < s[0].length; x++) {
      if (!s[y][x]) continue;
      const gy = this.active.y + y, gx = this.active.x + x;
      if (gy >= 0) g.fillRect(this.ox + gx * CELL, this.oy + gy * CELL, CELL - 1, CELL - 1);
    }
  }
}
"""
