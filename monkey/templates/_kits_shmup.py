"""Shmup kit — vertical-scroll shoot 'em up. Player ship, enemy waves, bullet patterns."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/kit.ts"] = """import { MainMenuScene } from './scenes/MainMenu';
import { GameScene } from './scenes/Game';

export const KIT_SCENES = [MainMenuScene, GameScene];
export const KIT_GRAVITY = 0;
export const KIT_NAME = 'shmup';
"""

FILES["src/entities/AGENT.md"] = """# AGENT.md — entities (shmup)

- `Ship.ts` — player vertical-scroller ship, fires upward
- `Foe.ts` — enemy that descends with horizontal sine wave + shoots
"""

FILES["src/entities/Player.ts"] = """import Phaser from 'phaser';
import { sfx } from '../engine/Audio';
import { Health } from '../engine/Health';

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp: Health;
  iframes = 0;
  fireCooldown = 0;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.body.setCollideWorldBounds(true);
    this.hp = new Health(3);
    this.play('player-idle');
  }
  hurt() {
    if (this.iframes > 0) return;
    this.hp.damage(1);
    this.iframes = 800;
    sfx('hurt');
    this.setTint(0xff5555);
    this.scene.time.delayedCall(120, () => this.clearTint());
  }
  tick(dt: number) {
    this.iframes = Math.max(0, this.iframes - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
  }
}
"""

FILES["src/entities/Enemy.ts"] = """import Phaser from 'phaser';
import { sfx } from '../engine/Audio';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp = 2;
  baseX = 0;
  age = 0;
  fireDelay = 1000;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_sheet', 0);
    this.baseX = x;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.body.setVelocityY(60);
    this.fireDelay = 700 + Math.random() * 800;
    this.play('enemy-walk');
  }
  tick(dt: number) {
    this.age += dt;
    this.x = this.baseX + Math.sin(this.age / 500) * 24;
  }
  damage(d = 1) {
    this.hp -= d;
    sfx('hurt');
    this.setTint(0xffffff);
    this.scene.time.delayedCall(60, () => this.clearTint());
    if (this.hp <= 0) { sfx('explode'); this.destroy(); }
  }
}
"""

FILES["src/entities/Goal.ts"] = """import Phaser from 'phaser';
export class Goal extends Phaser.GameObjects.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'goal');
    scene.add.existing(this);
  }
}
"""

FILES["src/levels/AGENT.md"] = """# AGENT.md — levels (shmup)

`waves.ts` — list of enemy waves. Each: `{ at: ms, count, y: spawnY }`.
"""

FILES["src/levels/waves.ts"] = """export interface Wave { at: number; count: number; y: number; spread: number; }

export const WAVES: Wave[] = [
  { at:  500, count: 4, y: -16, spread: 40 },
  { at: 2500, count: 6, y: -16, spread: 30 },
  { at: 5000, count: 5, y: -16, spread: 36 },
  { at: 8000, count: 8, y: -16, spread: 24 },
];

export const LEVEL_DURATION_MS = 14000;
"""

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenu'); }
  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, 60, 'STARSHIP', { fontFamily: 'monospace', fontSize: '22px', color: '#fbbf24' }).setOrigin(0.5);
    this.add.text(w/2, h/2, 'SPACE: START   ARROWS: MOVE   X: FIRE', { fontFamily: 'monospace', fontSize: '10px', color: '#fff' }).setOrigin(0.5);
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
import { Enemy } from '../entities/Enemy';
import { InputMap } from '../engine/Input';
import { BulletPool } from '../engine/Bullets';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { WAVES, LEVEL_DURATION_MS } from '../levels/waves';

export class GameScene extends Phaser.Scene {
  player!: Player;
  enemies!: Phaser.Physics.Arcade.Group;
  in!: InputMap;
  pBullets!: BulletPool;
  eBullets!: BulletPool;
  score = 0;
  hudScore!: Phaser.GameObjects.Text;
  hudHp!: Phaser.GameObjects.Text;
  elapsed = 0;
  spawned = new Set<number>();

  constructor() { super('Game'); }

  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.cameras.main.setBackgroundColor('#0b0d2b');
    this.physics.world.setBounds(0, 0, w, h);

    this.player = new Player(this, w/2, h - 30);
    this.enemies = this.physics.add.group();

    this.pBullets = new BulletPool(this, 'pixel', 'player', 1);
    this.eBullets = new BulletPool(this, 'pixel', 'enemy', 1);

    this.physics.add.overlap(this.pBullets.group, this.enemies, (b, e) => {
      this.pBullets.recycle(b as Phaser.Physics.Arcade.Sprite);
      (e as Enemy).damage(1);
      this.score += 10;
      this.hudScore.setText('SCORE ' + this.score);
    });
    this.physics.add.overlap(this.eBullets.group, this.player, (b) => {
      this.eBullets.recycle(b as Phaser.Physics.Arcade.Sprite);
      this.player.hurt();
    });
    this.physics.add.overlap(this.enemies, this.player, () => this.player.hurt());

    this.in = new InputMap(this);
    this.hudScore = this.add.text(8, 8, 'SCORE 0', { fontFamily: 'monospace', fontSize: '11px', color: '#fff' });
    this.hudHp = this.add.text(8, 22, '', { fontFamily: 'monospace', fontSize: '11px', color: '#f87171' });
    this.player.hp.on('died', () => { Music.stop(); this.scene.start('GameOver', { score: this.score }); });

    Music.start();
  }

  spawnWave(idx: number) {
    if (this.spawned.has(idx)) return;
    this.spawned.add(idx);
    const w = CONFIG.WORLD.VIEW_WIDTH;
    const wave = WAVES[idx];
    const start = (w - (wave.count - 1) * wave.spread) / 2;
    for (let i = 0; i < wave.count; i++) {
      const e = new Enemy(this, start + i * wave.spread, wave.y - i * 16);
      this.enemies.add(e);
    }
  }

  update(_t: number, dt: number) {
    this.elapsed += dt;
    for (let i = 0; i < WAVES.length; i++) if (this.elapsed >= WAVES[i].at) this.spawnWave(i);

    this.player.tick(dt);
    if (this.in.pressed('pause')) { this.scene.launch('Pause'); this.scene.pause(); return; }

    const sp = 200;
    let vx = 0, vy = 0;
    if (this.in.isDown('left')) vx -= sp;
    if (this.in.isDown('right')) vx += sp;
    if (this.in.isDown('up')) vy -= sp;
    if (this.in.isDown('down')) vy += sp;
    this.player.body.setVelocity(vx, vy);

    if (this.in.isDown('attack') && this.player.fireCooldown <= 0) {
      this.pBullets.fire(this.player.x, this.player.y - 10, 0, -300);
      this.player.fireCooldown = 140;
      sfx('attack');
    }

    (this.enemies.getChildren() as Enemy[]).forEach(e => {
      e.tick(dt);
      e.fireDelay -= dt;
      if (e.fireDelay <= 0 && e.y > 0) {
        e.fireDelay = 1500 + Math.random() * 800;
        this.eBullets.aimed(e.x, e.y, this.player.x, this.player.y, 140);
      }
      if (e.y > CONFIG.WORLD.VIEW_HEIGHT + 40) e.destroy();
    });

    this.hudHp.setText('HP ' + '#'.repeat(Math.max(0, this.player.hp.current)));

    if (this.elapsed >= LEVEL_DURATION_MS && this.enemies.countActive() === 0) {
      Music.stop();
      this.scene.start('GameOver', { score: this.score, win: true });
    }
  }
}
"""
