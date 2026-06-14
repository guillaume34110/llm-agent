"""Shared overrides for the 2D game scaffold template."""
from __future__ import annotations

FILES: dict[str, str] = {}

FILES["src/i18n/en.json"] = """{
  "menu.title": "GAME 2D",
  "menu.start": "New Game",
  "menu.continue": "Continue",
  "menu.mute": "Sound: {state}",
  "menu.reset": "Reset Save",
  "menu.language": "Language: {code}",
  "menu.highScore": "High Score {n}",
  "menu.controls": "UP/DOWN select  ENTER confirm  L language  M mute",
  "menu.touch": "Touch: {state}",
  "common.on": "ON",
  "common.off": "OFF",
  "hud.score": "Score: {n}",
  "hud.lives": "Lives: {n}",
  "hud.level": "Level {n}",
  "gameover.title": "GAME OVER",
  "gameover.retry": "Retry",
  "gameover.menu": "Main Menu",
  "pause.title": "PAUSED",
  "pause.resume": "Resume",
  "pause.quit": "Quit",
  "victory.title": "VICTORY",
  "victory.score": "Final Score: {n}",
  "gameover.newBest": "NEW BEST",
  "gameover.menuPrompt": "PRESS SPACE FOR MENU",
  "pause.resumePrompt": "PRESS ESC TO RESUME"
}
"""

FILES["src/i18n/fr.json"] = """{
  "menu.title": "JEU 2D",
  "menu.start": "Nouvelle partie",
  "menu.continue": "Continuer",
  "menu.mute": "Son: {state}",
  "menu.reset": "Effacer la sauvegarde",
  "menu.language": "Langue: {code}",
  "menu.highScore": "Meilleur score {n}",
  "menu.controls": "HAUT/BAS choisir  ENTREE valider  L langue  M son",
  "menu.touch": "Tactile: {state}",
  "common.on": "ON",
  "common.off": "OFF",
  "hud.score": "Score: {n}",
  "hud.lives": "Vies: {n}",
  "hud.level": "Niveau {n}",
  "gameover.title": "PARTIE TERMINÉE",
  "gameover.retry": "Recommencer",
  "gameover.menu": "Menu principal",
  "pause.title": "PAUSE",
  "pause.resume": "Reprendre",
  "pause.quit": "Quitter",
  "victory.title": "VICTOIRE",
  "victory.score": "Score final: {n}",
  "gameover.newBest": "NOUVEAU RECORD",
  "gameover.menuPrompt": "ESPACE POUR MENU",
  "pause.resumePrompt": "ECHAP POUR REPRENDRE"
}
"""

FILES["src/i18n/es.json"] = """{
  "menu.title": "JUEGO 2D",
  "menu.start": "Nueva partida",
  "menu.continue": "Continuar",
  "menu.mute": "Sonido: {state}",
  "menu.reset": "Borrar guardado",
  "menu.language": "Idioma: {code}",
  "menu.highScore": "Record {n}",
  "menu.controls": "ARRIBA/ABAJO seleccionar  ENTER confirmar  L idioma  M sonido",
  "menu.touch": "Táctil: {state}",
  "common.on": "ON",
  "common.off": "OFF",
  "hud.score": "Puntos: {n}",
  "hud.lives": "Vidas: {n}",
  "hud.level": "Nivel {n}",
  "gameover.title": "FIN DEL JUEGO",
  "gameover.retry": "Reintentar",
  "gameover.menu": "Menú principal",
  "pause.title": "PAUSA",
  "pause.resume": "Continuar",
  "pause.quit": "Salir",
  "victory.title": "VICTORIA",
  "victory.score": "Puntuacion final: {n}",
  "gameover.newBest": "NUEVO RECORD",
  "gameover.menuPrompt": "ESPACIO PARA MENU",
  "pause.resumePrompt": "ESC PARA SEGUIR"
}
"""

FILES["src/i18n/de.json"] = """{
  "menu.title": "SPIEL 2D",
  "menu.start": "Neues Spiel",
  "menu.continue": "Fortsetzen",
  "menu.mute": "Ton: {state}",
  "menu.reset": "Speicher löschen",
  "menu.language": "Sprache: {code}",
  "menu.highScore": "Bestwert {n}",
  "menu.controls": "HOCH/RUNTER wahlen  ENTER bestatigen  L sprache  M ton",
  "menu.touch": "Touch: {state}",
  "common.on": "AN",
  "common.off": "AUS",
  "hud.score": "Punkte: {n}",
  "hud.lives": "Leben: {n}",
  "hud.level": "Level {n}",
  "gameover.title": "SPIEL VORBEI",
  "gameover.retry": "Wiederholen",
  "gameover.menu": "Hauptmenü",
  "pause.title": "PAUSE",
  "pause.resume": "Weiter",
  "pause.quit": "Beenden",
  "victory.title": "SIEG",
  "victory.score": "Endpunktzahl: {n}",
  "gameover.newBest": "NEUER REKORD",
  "gameover.menuPrompt": "LEERTASTE FUR MENU",
  "pause.resumePrompt": "ESC ZUM FORTSETZEN"
}
"""

FILES["src/i18n/ja.json"] = """{
  "menu.title": "ゲーム 2D",
  "menu.start": "ニューゲーム",
  "menu.continue": "コンティニュー",
  "menu.mute": "サウンド: {state}",
  "menu.reset": "セーブを削除",
  "menu.language": "言語: {code}",
  "menu.highScore": "ハイスコア {n}",
  "menu.controls": "上下で選択  ENTERで決定  Lで言語  Mで音",
  "menu.touch": "タッチ: {state}",
  "common.on": "オン",
  "common.off": "オフ",
  "hud.score": "スコア: {n}",
  "hud.lives": "ライフ: {n}",
  "hud.level": "レベル {n}",
  "gameover.title": "ゲームオーバー",
  "gameover.retry": "リトライ",
  "gameover.menu": "メインメニュー",
  "pause.title": "一時停止",
  "pause.resume": "再開",
  "pause.quit": "終了",
  "victory.title": "勝利",
  "victory.score": "最終スコア: {n}",
  "gameover.newBest": "ベスト更新",
  "gameover.menuPrompt": "SPACEでメニュー",
  "pause.resumePrompt": "ESCで再開"
}
"""

FILES["src/engine/Save.ts"] = """import { CONFIG } from '../config';

/** Typed localStorage wrapper with schema versioning + forward migrations.
 *  Bump SAVE_VERSION when SaveData shape changes; add a step in MIGRATIONS.
 *  Older saves auto-upgrade; corrupt blobs degrade to defaults (never throw). */
export const SAVE_VERSION = 3;

export interface SaveData {
  _v: number;
  highScore: number;
  muted: boolean;
  lastLevel: string;
  completed: boolean;
  bestPerLevel: Record<string, number>;
  locale: string;             // v2: persisted UI locale
  flags: Record<string, boolean>; // v3: kit-specific unlocks / switches
}

const DEFAULT: SaveData = {
  _v: SAVE_VERSION,
  highScore: 0,
  muted: false,
  lastLevel: 'level1',
  completed: false,
  bestPerLevel: {},
  locale: 'en',
  flags: {}
};

type Migration = (raw: any) => any;
export const MIGRATIONS: Record<number, Migration> = {
  // 1 -> 2 : add locale field, normalize missing _v.
  1: (r) => ({ ...r, _v: 2, locale: r.locale || 'en' }),
  // 2 -> 3 : add generic flags bag for kit-specific progression.
  2: (r) => ({ ...r, _v: 3, flags: typeof r.flags === 'object' && r.flags ? r.flags : {} })
};

export function migrate(raw: any): SaveData {
  let cur = { ...raw };
  let v = typeof cur._v === 'number' ? cur._v : 1;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    cur = step(cur);
    v = cur._v ?? v + 1;
  }
  return { ...DEFAULT, ...cur, _v: SAVE_VERSION };
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(CONFIG.SAVE_KEY);
    if (!raw) return { ...DEFAULT };
    return migrate(JSON.parse(raw));
  } catch {
    return { ...DEFAULT };
  }
}

export function save(patch: Partial<SaveData>) {
  const cur = load();
  const next = { ...cur, ...patch, _v: SAVE_VERSION };
  try { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(next)); } catch {}
}

export function setFlag(name: string, enabled = true) {
  const cur = load();
  save({ flags: { ...cur.flags, [name]: enabled } });
}

export function reset() {
  try { localStorage.removeItem(CONFIG.SAVE_KEY); } catch {}
}
"""

FILES["src/engine/index.ts"] = """export * from './Camera';
export * from './Input';
export * from './Audio';
export * from './Music';
export * from './Save';
export * from './StateMachine';
export * from './UI';
export * from './Particles';
export * from './Parallax';
export * from './Tilemap';
export * from './Animations';
export * from './Transitions';
export * from './Touch';
export * from './Health';
export * from './Combat';
export * from './Inventory';
export * from './Dialog';
export * from './Menu';
export * from './Bullets';
export * from './GridMovement';
export * from './Quest';
export * from './Sequencer';
export * from './TurnBattle';
export * from './Editor';
export * from './TiledLoader';
export * from './Perf';
export * from './Telemetry';
export * from './Lifecycle';
export * from './AudioUnlock';
export * from './SpriteSource';
"""

FILES["src/engine/TiledLoader.ts"] = """/**
 * Tiled (mapeditor.org) JSON loader. Supports the orthogonal subset we need:
 * one tilelayer (CSV/array data) + optional object layer.
 *
 *   import { parseTiled } from '@/engine/TiledLoader';
 *   const map = parseTiled(await (await fetch('/levels/x.json')).json());
 *
 * Map result is shape-compatible with parseTilemap() in Tilemap.ts so it can
 * be dropped into existing scenes.
 */
import { parseTilemap, type ParsedMap } from './Tilemap';

export interface TiledObject { x: number; y: number; type: string; name?: string; }
export interface TiledMap {
  width: number; height: number; tilewidth: number; tileheight: number;
  tiles: number[][];          // [y][x] of gid (0 = empty)
  objects: TiledObject[];
}

interface RawLayer { type: string; data?: number[]; width?: number; height?: number; objects?: any[]; name?: string; }
export interface RawMap { width: number; height: number; tilewidth: number; tileheight: number; layers: RawLayer[]; }

export function parseTiled(raw: RawMap): TiledMap {
  if (!raw || typeof raw.width !== 'number' || typeof raw.height !== 'number') {
    throw new Error('parseTiled: invalid map (missing width/height)');
  }
  const tileLayer = raw.layers.find(l => l.type === 'tilelayer');
  if (!tileLayer || !Array.isArray(tileLayer.data)) {
    throw new Error('parseTiled: no tilelayer with data[] found');
  }
  const w = tileLayer.width ?? raw.width;
  const h = tileLayer.height ?? raw.height;
  const data = tileLayer.data;
  if (data.length != w * h) {
    throw new Error(`parseTiled: data length ${data.length} != ${w}*${h}`);
  }
  const tiles: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(data[y * w + x] | 0);
    tiles.push(row);
  }
  const objects: TiledObject[] = [];
  for (const layer of raw.layers) {
    if (layer.type !== 'objectgroup' || !Array.isArray(layer.objects)) continue;
    for (const o of layer.objects) {
      objects.push({
        x: Math.round(o.x / raw.tilewidth),
        y: Math.round(o.y / raw.tileheight),
        type: String(o.type || o.class || layer.name || 'obj'),
        name: o.name ? String(o.name) : undefined
      });
    }
  }
  return { width: w, height: h, tilewidth: raw.tilewidth, tileheight: raw.tileheight, tiles, objects };
}

/** Convert TiledMap back to a flat ascii grid (for legacy parseTilemap reuse). */
export function tiledToAscii(map: TiledMap, gidToChar: (gid: number) => string = defaultGid): string[] {
  return map.tiles.map(row => row.map(gidToChar).join(''));
}
function defaultGid(g: number): string { return g === 0 ? '.' : '#'; }

/** Convert a raw Tiled map into the ParsedMap shape used by the platformer scene. */
export function parseTiledLevel(raw: RawMap): ParsedMap {
  const map = parseTiled(raw);
  const rows = tiledToAscii(map).map((row) => row.split(''));
  const setTile = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= rows.length) return;
    if (x < 0 || x >= rows[y].length) return;
    rows[y][x] = ch;
  };
  for (const obj of map.objects) {
    const type = obj.type.toLowerCase();
    if (type === 'player' || type === 'spawn') setTile(obj.x, obj.y, 'P');
    else if (type === 'goal' || type === 'exit') setTile(obj.x, obj.y, 'G');
    else if (type === 'coin' || type === 'pickup') setTile(obj.x, obj.y, 'C');
    else if (type === 'enemy' || type === 'foe') setTile(obj.x, obj.y, 'E');
  }
  return parseTilemap(rows.map((row) => row.join('')));
}
"""

FILES["src/engine/Editor.ts"] = """/**
 * In-app paint editor. Headless logic lives in EditorState (testable),
 * Phaser overlay attaches via attach(scene, state). Toggle with `~` or `?edit=1`.
 *
 * Persists current map to localStorage under EDITOR_KEY. Export via serialize().
 */

export interface EditorMap { width: number; height: number; tiles: number[][]; }

export const EDITOR_KEY = 'g2d-editor-map';
export interface EditorAttachOpts {
  onChange?: (state: EditorState) => void;
  storageKey?: string;
}

export class EditorState {
  width: number;
  height: number;
  tiles: number[][];
  brush = 1;
  history: { x: number; y: number; prev: number }[] = [];

  constructor(map: EditorMap) {
    this.width = map.width;
    this.height = map.height;
    this.tiles = map.tiles.map(r => r.slice());
  }

  static blank(w: number, h: number): EditorState {
    const tiles: number[][] = [];
    for (let y = 0; y < h; y++) tiles.push(new Array(w).fill(0));
    return new EditorState({ width: w, height: h, tiles });
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  paint(x: number, y: number, id: number = this.brush): boolean {
    if (!this.inBounds(x, y)) return false;
    const prev = this.tiles[y][x];
    if (prev === id) return false;
    this.history.push({ x, y, prev });
    this.tiles[y][x] = id;
    return true;
  }

  erase(x: number, y: number): boolean { return this.paint(x, y, 0); }

  undo(): boolean {
    const e = this.history.pop();
    if (!e) return false;
    this.tiles[e.y][e.x] = e.prev;
    return true;
  }

  cycleBrush(delta: number, max = 8): void {
    this.brush = ((this.brush + delta - 1 + max) % max) + 1;
  }

  serialize(): string {
    return JSON.stringify({ width: this.width, height: this.height, tiles: this.tiles });
  }

  static deserialize(s: string): EditorState {
    const o = JSON.parse(s);
    return new EditorState({ width: o.width, height: o.height, tiles: o.tiles });
  }

  save(storage: Storage = localStorage, key: string = EDITOR_KEY): void { storage.setItem(key, this.serialize()); }

  static restore(storage: Storage = localStorage, key: string = EDITOR_KEY): EditorState | null {
    const s = storage.getItem(key);
    return s ? EditorState.deserialize(s) : null;
  }
}

/** Phaser overlay glue - bind input listeners. Imported lazily by Game scene. */
export function attachEditor(scene: any, state: EditorState, tileSize: number, opts: EditorAttachOpts = {}): () => void {
  let active = (typeof location !== 'undefined' && /[?&]edit=1/.test(location.search));
  const overlay = scene.add?.graphics?.().setDepth?.(3500);
  const hud = scene.add?.text?.(8, 52, '', {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: '#7dd3fc',
    backgroundColor: '#000000'
  })?.setScrollFactor?.(0)?.setDepth?.(3501);
  const storageKey = opts.storageKey || EDITOR_KEY;
  const notify = () => { opts.onChange?.(state); render(); };
  const render = () => {
    overlay?.clear?.();
    if (!active) {
      hud?.setVisible?.(false);
      return;
    }
    hud?.setVisible?.(true);
    hud?.setText?.('EDIT  brush=' + state.brush + '  [ ] brush  ctrl/cmd+s save  ~ toggle');
    overlay?.lineStyle?.(1, 0x38bdf8, 0.18);
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const wx = x * tileSize;
        const wy = y * tileSize;
        overlay?.strokeRect?.(wx, wy, tileSize, tileSize);
        if (state.tiles[y][x] > 0) overlay?.fillStyle?.(0x38bdf8, 0.18)?.fillRect?.(wx, wy, tileSize, tileSize);
      }
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '~' || e.key === '`') { active = !active; render(); }
    if (!active) return;
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && state.undo()) notify();
    if (e.key === '[') { state.cycleBrush(-1); render(); }
    if (e.key === ']') { state.cycleBrush(+1); render(); }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { state.save(localStorage, storageKey); e.preventDefault(); render(); }
  };
  const onPtr = (p: any) => {
    if (!active) return;
    const wx = Math.floor((p.worldX ?? p.x) / tileSize);
    const wy = Math.floor((p.worldY ?? p.y) / tileSize);
    const changed = p.rightButtonDown && p.rightButtonDown() ? state.erase(wx, wy) : state.paint(wx, wy);
    if (changed) notify();
  };
  const onMove = (p: any) => { if (p.isDown) onPtr(p); };
  const cleanup = () => {
    window.removeEventListener('keydown', onKey);
    scene.input?.off?.('pointerdown', onPtr);
    scene.input?.off?.('pointermove', onMove);
    scene.events?.off?.('postupdate', render);
    overlay?.destroy?.();
    hud?.destroy?.();
  };
  window.addEventListener('keydown', onKey);
  scene.input?.on?.('pointerdown', onPtr);
  scene.input?.on?.('pointermove', onMove);
  scene.events?.on?.('postupdate', render);
  scene.events?.once?.('shutdown', cleanup);
  scene.events?.once?.('destroy', cleanup);
  render();
  return cleanup;
}
"""

FILES["src/engine/Perf.ts"] = """/**
 * FPS overlay + frame budget tracking. Toggle with `?perf=1`.
 * Pure data side: PerfMonitor records frame samples and computes fps + p95.
 */
export class PerfMonitor {
  private samples: number[] = [];
  private last = 0;
  readonly capacity: number;
  constructor(capacity = 120) { this.capacity = capacity; }

  tick(now: number): void {
    if (this.last === 0) { this.last = now; return; }
    const dt = now - this.last;
    this.last = now;
    this.samples.push(dt);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  fps(): number {
    if (!this.samples.length) return 0;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  p95dt(): number {
    if (!this.samples.length) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }

  reset(): void { this.samples.length = 0; this.last = 0; }
}

export function shouldShowPerf(): boolean {
  return typeof location !== 'undefined' && /[?&]perf=1/.test(location.search);
}

export function perfLabel(m: PerfMonitor): string {
  return `FPS ${Math.round(m.fps())}  P95 ${Math.round(m.p95dt())}ms`;
}
"""

FILES["tests/unit/Save.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { save, load, reset, setFlag } from '../../src/engine/Save';

describe('Save/Load', () => {
  beforeEach(() => reset());

  it('returns defaults when storage is empty', () => {
    const s = load();
    expect(s.highScore).toBe(0);
    expect(s.muted).toBe(false);
    expect(s.completed).toBe(false);
    expect(s.flags).toEqual({});
  });

  it('persists patches and merges with defaults', () => {
    save({ highScore: 42, muted: true });
    const s = load();
    expect(s.highScore).toBe(42);
    expect(s.muted).toBe(true);
    expect(s.lastLevel).toBe('level1');
    expect(s.flags).toEqual({});
  });

  it('reset clears persisted state', () => {
    save({ highScore: 99 });
    reset();
    expect(load().highScore).toBe(0);
  });

  it('survives corrupted storage by returning defaults', () => {
    localStorage.setItem('game-2d-ts:v1', '{not-json');
    const s = load();
    expect(s.highScore).toBe(0);
  });

  it('stores kit-specific flags in the typed save bag', () => {
    setFlag('hasDash');
    expect(load().flags.hasDash).toBe(true);
  });
});
"""

FILES["tests/unit/TiledLoader.test.ts"] = """import { describe, it, expect } from 'vitest';
import { parseTiled, parseTiledLevel, tiledToAscii } from '../../src/engine/TiledLoader';
import raw from '../../src/levels/example.tiled.json';

describe('TiledLoader', () => {
  it('parses example map dims', () => {
    const m = parseTiled(raw as any);
    expect(m.width).toBe(8);
    expect(m.height).toBe(4);
    expect(m.tiles.length).toBe(4);
    expect(m.tiles[0].length).toBe(8);
  });

  it('row 3 is solid floor (gid=2)', () => {
    const m = parseTiled(raw as any);
    expect(m.tiles[3].every(g => g === 2)).toBe(true);
  });

  it('extracts objects with tile-grid coords', () => {
    const m = parseTiled(raw as any);
    const goal = m.objects.find(o => o.type === 'goal');
    expect(goal).toBeTruthy();
    expect(goal!.x).toBe(7);
    expect(goal!.y).toBe(2);
  });

  it('rejects mismatched data length', () => {
    expect(() => parseTiled({
      width: 4, height: 2, tilewidth: 32, tileheight: 32,
      layers: [{ type: 'tilelayer', data: [0, 0, 0] }]
    } as any)).toThrow(/data length/);
  });

  it('rejects map with no tilelayer', () => {
    expect(() => parseTiled({
      width: 4, height: 2, tilewidth: 32, tileheight: 32,
      layers: [{ type: 'objectgroup', objects: [] }]
    } as any)).toThrow(/tilelayer/);
  });

  it('tiledToAscii produces one string per row', () => {
    const m = parseTiled(raw as any);
    const ascii = tiledToAscii(m);
    expect(ascii.length).toBe(4);
    expect(ascii[3].length).toBe(8);
  });

  it('parseTiledLevel maps object types into ParsedMap entities', () => {
    const parsed = parseTiledLevel(raw as any);
    expect(parsed.goal).toBeTruthy();
    expect(parsed.spawn.x).toBeGreaterThan(0);
  });
});
"""

FILES["tests/unit/Save.migrate.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { migrate, SAVE_VERSION, load, save, reset } from '../../src/engine/Save';

describe('Save migrations', () => {
  beforeEach(() => { try { localStorage.clear(); } catch {} });

  it('upgrades v1 blob (no _v field) to current', () => {
    const v1 = { highScore: 5, muted: true, lastLevel: 'level2', completed: false, bestPerLevel: {} };
    const out = migrate(v1);
    expect(out._v).toBe(SAVE_VERSION);
    expect(out.locale).toBe('en');
    expect(out.flags).toEqual({});
    expect(out.highScore).toBe(5);
  });

  it('preserves locale if already set in pre-v2 blob', () => {
    const out = migrate({ highScore: 0, locale: 'fr' });
    expect(out.locale).toBe('fr');
  });

  it('upgrades v2 blob by adding flags', () => {
    const out = migrate({ _v: 2, highScore: 1, locale: 'de' });
    expect(out._v).toBe(SAVE_VERSION);
    expect(out.flags).toEqual({});
    expect(out.locale).toBe('de');
  });

  it('current-version blob round-trips unchanged', () => {
    const cur = { _v: SAVE_VERSION, highScore: 9, muted: false, lastLevel: 'l1',
                  completed: true, bestPerLevel: { l1: 99 }, locale: 'ja', flags: { hasDash: true } };
    const out = migrate(cur);
    expect(out.highScore).toBe(9);
    expect(out.locale).toBe('ja');
    expect(out.flags.hasDash).toBe(true);
  });

  it('corrupt JSON degrades to defaults', () => {
    localStorage.setItem('game-2d-ts:v1', '{not json');
    const out = load();
    expect(out._v).toBe(SAVE_VERSION);
    expect(out.highScore).toBe(0);
  });

  it('save() always stamps current version', () => {
    save({ highScore: 12 });
    const raw = JSON.parse(localStorage.getItem('game-2d-ts:v1')!);
    expect(raw._v).toBe(SAVE_VERSION);
    reset();
  });
});
"""
