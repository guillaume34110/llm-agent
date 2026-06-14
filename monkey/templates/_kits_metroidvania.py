"""Metroidvania kit — side-scroller with health, dash, double-jump, room transitions, mini-boss."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/kit.ts"] = """import { MainMenuScene } from './scenes/MainMenu';
import { GameScene } from './scenes/Game';
import { CONFIG } from './config';

export const KIT_SCENES = [MainMenuScene, GameScene];
export const KIT_GRAVITY = CONFIG.WORLD.GRAVITY;
export const KIT_NAME = 'metroidvania';
"""

FILES["src/entities/AGENT.md"] = """# AGENT.md — entities (metroidvania)

- `Player.ts` — health, dash, double-jump (gated by save flags `hasDash` / `hasDoubleJump`)
- `Enemy.ts` — patrol + contact damage
- `Boss.ts` — phase-based boss, drops "exit" on death
- `Goal.ts` — pickup; ability ∈ `'dash' | 'doubleJump' | 'exit'`
"""

FILES["src/entities/Player.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { sfx } from '../engine/Audio';
import { Health } from '../engine/Health';

export interface ActionState {
  left: boolean; right: boolean; up: boolean; down: boolean;
  jump: boolean; attack: boolean; attackDown: boolean;
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp: Health;
  facing: 1 | -1 = 1;
  hasDash = false;
  hasDoubleJump = false;
  jumpsLeft = 0;
  isDashing = false;
  iframes = 0;
  coyote = 0;
  jumpBuffer = 0;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setCollideWorldBounds(true);
    this.hp = new Health(6);
    this.play('player-idle');
  }
  hurt(dmg = 1) {
    if (this.iframes > 0) return;
    this.hp.damage(dmg);
    this.iframes = 1000;
    sfx('hurt');
    this.setTint(0xff5555);
    this.scene.time.delayedCall(180, () => this.clearTint());
  }
  tickInput(a: ActionState, dt: number) {
    this.iframes = Math.max(0, this.iframes - dt);
    if (this.isDashing) return;
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (onGround) {
      this.coyote = CONFIG.PLAYER.COYOTE_TIME_MS;
      this.jumpsLeft = this.hasDoubleJump ? 1 : 0;
    } else this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = a.jump ? CONFIG.PLAYER.JUMP_BUFFER_MS : Math.max(0, this.jumpBuffer - dt);
    const speed = CONFIG.PLAYER.SPEED;
    if (a.left) { this.body.setVelocityX(-speed); this.facing = -1; this.setFlipX(true); }
    else if (a.right) { this.body.setVelocityX(speed); this.facing = 1; this.setFlipX(false); }
    else this.body.setVelocityX(this.body.velocity.x * 0.8);
    if (this.jumpBuffer > 0 && (this.coyote > 0 || this.jumpsLeft > 0)) {
      this.body.setVelocityY(-CONFIG.PLAYER.JUMP_VELOCITY);
      this.jumpBuffer = 0;
      if (this.coyote <= 0) this.jumpsLeft -= 1;
      this.coyote = 0;
      sfx('jump');
    }
    if (a.attackDown && this.hasDash && !this.isDashing) {
      this.isDashing = true;
      this.body.setVelocityX(this.facing * speed * 2.5);
      this.body.setVelocityY(0);
      sfx('attack');
      this.scene.time.delayedCall(180, () => { this.isDashing = false; });
    }
    this.play(onGround ? (Math.abs(this.body.velocity.x) > 10 ? 'player-run' : 'player-idle') : 'player-jump', true);
  }
}
"""

FILES["src/entities/Enemy.ts"] = """import Phaser from 'phaser';
import { sfx } from '../engine/Audio';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp = 2;
  dir: 1 | -1 = 1;
  speed = 40;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.play('enemy-walk');
  }
  patrol() {
    this.body.setVelocityX(this.speed * this.dir);
    if (this.body.blocked.left) this.dir = 1;
    if (this.body.blocked.right) this.dir = -1;
    this.setFlipX(this.dir < 0);
  }
  damage(d = 1) {
    this.hp -= d;
    sfx('hurt');
    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => this.clearTint());
    if (this.hp <= 0) { sfx('explode'); this.destroy(); }
  }
}
"""

FILES["src/entities/Boss.ts"] = """import Phaser from 'phaser';
import { sfx } from '../engine/Audio';

export class Boss extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp = 8;
  phase = 1;
  cooldown = 0;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(2);
    this.setTint(0xff4080);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
  }
  tick(dt: number, target: Phaser.GameObjects.Sprite) {
    this.cooldown -= dt;
    const dx = target.x - this.x;
    this.body.setVelocityX(Math.sign(dx) * (40 + 30 * this.phase));
    if (this.cooldown <= 0) { this.body.setVelocityY(-220); this.cooldown = 1200; sfx('jump'); }
  }
  damage(d = 1) {
    this.hp -= d;
    this.setTint(0xffffff);
    this.scene.time.delayedCall(60, () => this.setTint(0xff4080));
    if (this.hp <= 4) this.phase = 2;
    if (this.hp <= 0) { sfx('victory'); this.destroy(); }
  }
}
"""

FILES["src/entities/Goal.ts"] = """import Phaser from 'phaser';

export type GoalKind = 'dash' | 'doubleJump' | 'exit';

export class Goal extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  kind: GoalKind;
  constructor(scene: Phaser.Scene, x: number, y: number, kind: GoalKind = 'exit') {
    super(scene, x, y, 'goal');
    this.kind = kind;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    if (kind === 'dash') this.setTint(0x60a5fa);
    else if (kind === 'doubleJump') this.setTint(0xfbbf24);
  }
}
"""

FILES["src/levels/AGENT.md"] = """# AGENT.md — levels (metroidvania)

`rooms.ts` defines rooms. Each room: `{ size, blocks, spawns, exits }`.
Coords are in TILE units. Add a room → push a key in `ROOM_ORDER`.
"""

FILES["src/levels/rooms.ts"] = """export interface Room {
  cols: number; rows: number;
  biome: string;
  blocks: Array<[number, number]>;
  player: [number, number];
  enemies: Array<[number, number]>;
  goals: Array<{ x: number; y: number; kind: 'dash' | 'doubleJump' | 'exit' }>;
  boss?: [number, number];
  music: number[];
}

const floor = (cols: number, row: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) out.push([c, row]);
  return out;
};

export const ROOMS: Record<string, Room> = {
  entry: {
    cols: 30, rows: 12,
    biome: 'cave',
    blocks: [...floor(30, 11), [12, 8], [13, 8], [14, 8]],
    player: [2, 10],
    enemies: [[8, 10], [20, 10]],
    goals: [
      { x: 16, y: 7, kind: 'dash' },
      { x: 28, y: 10, kind: 'exit' },
    ],
    music: [220, 277, 330, 392],
  },
  hub: {
    cols: 36, rows: 14,
    biome: 'cave',
    blocks: [
      ...floor(36, 13),
      [10, 10], [11, 10], [12, 10],
      [22, 8], [23, 8], [24, 8],
    ],
    player: [2, 12],
    enemies: [[14, 12], [28, 12]],
    goals: [
      { x: 23, y: 7, kind: 'doubleJump' },
      { x: 34, y: 12, kind: 'exit' },
    ],
    music: [196, 247, 294, 370],
  },
  boss: {
    cols: 24, rows: 12,
    biome: 'stone',
    blocks: floor(24, 11),
    player: [2, 10],
    enemies: [],
    goals: [],
    boss: [18, 9],
    music: [165, 196, 220, 247],
  },
};

export const ROOM_ORDER = ['entry', 'hub', 'boss'] as const;
export type RoomKey = typeof ROOM_ORDER[number];
"""

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { load, save } from '../engine/Save';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenu'); }
  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, 60, 'METROID-LIKE', { fontFamily: 'monospace', fontSize: '22px', color: '#a78bfa' }).setOrigin(0.5);
    this.add.text(w/2, h/2, 'SPACE: START   R: RESET SAVE', { fontFamily: 'monospace', fontSize: '11px', color: '#fff' }).setOrigin(0.5);
    Music.start();
    this.input.keyboard!.once('keydown-SPACE', () => {
      sfx('confirm'); Music.stop();
      const sd = load();
      this.scene.start('Game', { room: sd.lastLevel || 'entry' });
    });
    this.input.keyboard!.on('keydown-R', () => {
      save({ highScore: 0, muted: false, lastLevel: 'entry', completed: false, bestPerLevel: {}, flags: {} });
      sfx('confirm');
    });
  }
}
"""

FILES["src/scenes/Game.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { Goal, GoalKind } from '../entities/Goal';
import { Cam } from '../engine/Camera';
import { InputMap } from '../engine/Input';
import { sfx } from '../engine/Audio';
import { Music } from '../engine/Music';
import { load, save } from '../engine/Save';
import { wipe } from '../engine/Transitions';
import { autotileVariant } from '../engine/Autotile';
import { ROOMS, ROOM_ORDER, RoomKey } from '../levels/rooms';

export class GameScene extends Phaser.Scene {
  player!: Player;
  cam!: Cam;
  in!: InputMap;
  blocks!: Phaser.Physics.Arcade.StaticGroup;
  enemies!: Phaser.Physics.Arcade.Group;
  boss?: Boss;
  goals!: Phaser.Physics.Arcade.StaticGroup;
  hud!: { hp: Phaser.GameObjects.Text; abil: Phaser.GameObjects.Text };
  roomKey: RoomKey = 'entry';

  constructor() { super('Game'); }

  create(data: { room?: RoomKey }) {
    this.roomKey = (data?.room as RoomKey) ?? 'entry';
    const room = ROOMS[this.roomKey];
    const T = CONFIG.WORLD.TILE;
    const W = room.cols * T, H = room.rows * T;
    this.physics.world.setBounds(0, 0, W, H);

    this.blocks = this.physics.add.staticGroup();
    const wallSet = new Set<string>();
    for (const [c, r] of room.blocks) wallSet.add(c + ',' + r);
    const biome = room.biome;
    for (const [c, r] of room.blocks) {
      const v = autotileVariant(wallSet, c, r);
      this.blocks.create(c * T + T/2, r * T + T/2, 'tile_' + biome + v).refreshBody();
    }

    this.enemies = this.physics.add.group();
    for (const [c, r] of room.enemies) this.enemies.add(new Enemy(this, c*T+T/2, r*T+T/2));

    this.goals = this.physics.add.staticGroup();
    for (const g of room.goals) {
      this.goals.add(new Goal(this, g.x*T+T/2, g.y*T+T/2, g.kind as GoalKind));
    }

    if (room.boss) this.boss = new Boss(this, room.boss[0]*T+T/2, room.boss[1]*T+T/2);

    const sd = load();
    this.player = new Player(this, room.player[0]*T+T/2, room.player[1]*T+T/2);
    this.player.hasDash = !!sd.flags.hasDash;
    this.player.hasDoubleJump = !!sd.flags.hasDoubleJump;

    this.physics.add.collider(this.player, this.blocks);
    this.physics.add.collider(this.enemies, this.blocks);
    if (this.boss) this.physics.add.collider(this.boss, this.blocks);

    this.physics.add.overlap(this.player, this.enemies, () => this.player.hurt(1));
    if (this.boss) this.physics.add.overlap(this.player, this.boss, () => this.player.hurt(1));
    this.physics.add.overlap(this.player, this.goals, (_p, g) => this.collectGoal(g as Goal));

    this.cam = new Cam(this.cameras.main);
    this.cam.bounds(W, H);
    this.cam.follow(this.player);

    this.in = new InputMap(this);
    this.hud = {
      hp: this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#fff' }).setScrollFactor(0),
      abil: this.add.text(8, 22, '', { fontFamily: 'monospace', fontSize: '10px', color: '#a78bfa' }).setScrollFactor(0),
    };
    this.player.hp.on('died', () => { Music.stop(); this.scene.start('GameOver', { score: 0 }); });
    Music.start();
  }

  collectGoal(g: Goal) {
    sfx('victory');
    const sd = load();
    if (g.kind === 'dash') { save({ flags: { ...sd.flags, hasDash: true } }); this.player.hasDash = true; g.destroy(); return; }
    if (g.kind === 'doubleJump') { save({ flags: { ...sd.flags, hasDoubleJump: true } }); this.player.hasDoubleJump = true; g.destroy(); return; }
    g.destroy();
    const idx = ROOM_ORDER.indexOf(this.roomKey);
    const next = ROOM_ORDER[idx + 1];
    if (!next) { Music.stop(); this.scene.start('GameOver', { score: 100, win: true }); return; }
    save({ lastLevel: next });
    Music.stop();
    wipe(this, 'right', 400, () => this.scene.restart({ room: next }));
  }

  update(_t: number, dt: number) {
    if (!this.player) return;
    if (this.in.pressed('pause')) { this.scene.launch('Pause'); this.scene.pause(); return; }
    this.player.tickInput({
      left: this.in.isDown('left'),
      right: this.in.isDown('right'),
      up: this.in.isDown('up'),
      down: this.in.isDown('down'),
      jump: this.in.pressed('jump'),
      attack: this.in.pressed('attack'),
      attackDown: this.in.isDown('attack'),
    }, dt);
    (this.enemies.getChildren() as Enemy[]).forEach(e => e.patrol());
    if (this.boss && this.boss.active) this.boss.tick(dt, this.player);
    if (this.boss && !this.boss.active) {
      this.boss = undefined;
      const goal = new Goal(this, this.player.x + 60, this.player.y, 'exit');
      this.goals.add(goal);
    }
    this.hud.hp.setText('HP ' + '#'.repeat(Math.max(0, this.player.hp.current)));
    const a: string[] = [];
    if (this.player.hasDash) a.push('DASH(B)');
    if (this.player.hasDoubleJump) a.push('2xJUMP');
    this.hud.abil.setText(a.join(' '));
  }
}
"""
