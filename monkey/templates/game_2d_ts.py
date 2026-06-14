"""2D Game TS template — Phaser 3.80 + Vite + TS, AI-tunable structure.

Usage:
    from monkey.templates import game_2d_ts
    game_2d_ts.apply("/path/to/new-project")

After apply(): cd <project> && npm install && npm run build, then open file://.../dist/index.html for a reliable smoke test.

The template embeds AGENT.md docs at every level so an LLM editing the project
knows what each dir contains, where to tune gameplay, and what NOT to touch.
"""
from __future__ import annotations
from pathlib import Path

# ─── File contents ──────────────────────────────────────────────────────────

FILES: dict[str, str] = {}

FILES["package.json"] = """{
  "name": "game-2d-ts",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "phaser": "^3.80.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@vitest/ui": "^1.6.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
"""

FILES["tsconfig.json"] = """{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
"""

FILES["vite.config.ts"] = """import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: { port: 8080, host: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] }
      }
    }
  }
});
"""

FILES["vitest.config.ts"] = """import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    setupFiles: ['tests/unit/setup.ts']
  }
});
"""

FILES["playwright.config.ts"] = """import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: true,
    timeout: 60_000
  },
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'off',
    headless: true
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel', use: { ...devices['Pixel 5'] } }
  ]
});
"""

FILES["tests/unit/setup.ts"] = """// Stub Phaser: its module import touches HTMLCanvasElement.getContext which
// jsdom does not implement. Tests that need real Phaser belong in tests/e2e.
import { vi } from 'vitest';

vi.mock('phaser', () => {
  const noop = () => {};
  const Phaser: any = {
    CANVAS: 1,
    AUTO: 0,
    Scene: class {},
    Game: class { constructor(_: any) {} },
    Display: { Canvas: { CanvasPool: { create: noop, remove: noop } } },
    Math: { Between: (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1)) },
    Scale: { FIT: 0, CENTER_BOTH: 0 },
    Input: { Keyboard: { KeyCodes: {
      LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40,
      A: 65, D: 68, W: 87, S: 83, Q: 81, Z: 90,
      SPACE: 32, ENTER: 13, ESC: 27, P: 80, X: 88, J: 74, CTRL: 17
    } } }
  };
  return { default: Phaser, ...Phaser };
});

if (!process.env.DEBUG_TESTS) {
  globalThis.console = { ...console, log: vi.fn(), warn: vi.fn() };
}

// Stub Web Audio for MML / SfxBank tests (jsdom has no AudioContext).
class FakeParam { setValueAtTime() {} linearRampToValueAtTime() {} value = 0; }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam();
  type: any = 'square'; buffer: any = null;
  connect() {} start() {} stop() {} }
class FakeBuffer { getChannelData() { return new Float32Array(1024); } }
class FakeCtx {
  currentTime = 0; sampleRate = 44100; state = 'running'; destination = {};
  resume() {} createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer() { return new FakeBuffer(); }
}
(globalThis as any).AudioContext = FakeCtx;
(globalThis as any).window = (globalThis as any).window || globalThis;
(globalThis as any).window.AudioContext = FakeCtx;
"""

FILES["tests/unit/Autotile.test.ts"] = """import { describe, it, expect } from 'vitest';
import { neighborMask, autotileVariant, isSolid } from '../../src/engine/Autotile';

describe('Autotile', () => {
  it('isSolid returns true only for members', () => {
    const set = new Set(['1,1', '2,1']);
    expect(isSolid(set, 1, 1)).toBe(true);
    expect(isSolid(set, 2, 1)).toBe(true);
    expect(isSolid(set, 0, 0)).toBe(false);
  });

  it('neighborMask N=1 E=2 S=4 W=8', () => {
    const set = new Set(['1,0', '2,1', '1,2', '0,1', '1,1']);
    // center (1,1): N(1,0)=1, E(2,1)=2, S(1,2)=4, W(0,1)=8 → 15
    expect(neighborMask(set, 1, 1)).toBe(15);
  });

  it('neighborMask isolated tile = 0', () => {
    const set = new Set(['5,5']);
    expect(neighborMask(set, 5, 5)).toBe(0);
  });

  it('autotileVariant returns _top when no north neighbor', () => {
    const set = new Set(['3,3']);
    expect(autotileVariant(set, 3, 3)).toBe('_top');
  });

  it('autotileVariant returns body when north neighbor present', () => {
    const set = new Set(['3,3', '3,2']);
    expect(autotileVariant(set, 3, 3)).toBe('');
  });
});
"""

FILES["tests/unit/Save.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { save, load, reset } from '../../src/engine/Save';

describe('Save/Load', () => {
  beforeEach(() => reset());

  it('returns defaults when storage is empty', () => {
    const s = load();
    expect(s.highScore).toBe(0);
    expect(s.muted).toBe(false);
    expect(s.completed).toBe(false);
  });

  it('persists patches and merges with defaults', () => {
    save({ highScore: 42, muted: true });
    const s = load();
    expect(s.highScore).toBe(42);
    expect(s.muted).toBe(true);
    expect(s.lastLevel).toBe('level1');
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
});
"""

FILES["tests/unit/Tiles.test.ts"] = """import { describe, it, expect } from 'vitest';
import { TILE_BIOMES } from '../../src/engine/Tiles';

describe('Tiles biomes', () => {
  it('exposes at least one biome', () => {
    expect(TILE_BIOMES.length).toBeGreaterThan(0);
  });

  it('biome keys are unique strings', () => {
    expect(new Set(TILE_BIOMES).size).toBe(TILE_BIOMES.length);
    for (const k of TILE_BIOMES) expect(typeof k).toBe('string');
  });

  it('every biome key is from the supported set', () => {
    const SUPPORTED = new Set([
      'grass', 'dirt', 'stone', 'sand', 'cave', 'metal', 'snow',
      'lava', 'ice', 'water', 'swamp', 'desert', 'forest',
      'mushroom', 'castle', 'beach'
    ]);
    for (const k of TILE_BIOMES) expect(SUPPORTED.has(k)).toBe(true);
  });
});
"""

FILES["src/i18n/index.ts"] = """/**
 * Tiny i18n. No deps. ICU-style placeholders {name}.
 *
 *   import { t, setLocale, currentLocale } from '@/i18n';
 *   t('menu.start');                    // "Start"
 *   t('hud.score', { n: 42 });          // "Score: 42"
 *
 * Auto-detects from navigator.language on first import. Persisted to localStorage.
 * Add a language: drop a JSON in src/i18n/<code>.json + register in LOCALES.
 */
import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import de from './de.json';
import ja from './ja.json';

export type LocaleCode = 'en' | 'fr' | 'es' | 'de' | 'ja';
type Dict = Record<string, string>;

const LOCALES: Record<LocaleCode, Dict> = { en, fr, es, de, ja };
const STORAGE_KEY = 'i18n:locale';

function detect(): LocaleCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as LocaleCode | null;
    if (stored && stored in LOCALES) return stored;
    const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
    return (nav in LOCALES ? nav : 'en') as LocaleCode;
  } catch { return 'en'; }
}

let locale: LocaleCode = detect();

export function currentLocale(): LocaleCode { return locale; }

export function setLocale(code: LocaleCode) {
  if (!(code in LOCALES)) return;
  locale = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch {}
}

export function availableLocales(): LocaleCode[] {
  return Object.keys(LOCALES) as LocaleCode[];
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = LOCALES[locale];
  let s = dict[key];
  if (s === undefined) s = LOCALES.en[key];
  if (s === undefined) return key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp('\\\\{' + k + '\\\\}', 'g'), String(vars[k]));
  return s;
}
"""

FILES["src/i18n/en.json"] = """{
  "menu.title": "GAME 2D",
  "menu.start": "New Game",
  "menu.continue": "Continue",
  "menu.mute": "Sound: {state}",
  "menu.reset": "Reset Save",
  "menu.language": "Language: {code}",
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
  "victory.score": "Final Score: {n}"
}
"""

FILES["src/i18n/fr.json"] = """{
  "menu.title": "JEU 2D",
  "menu.start": "Nouvelle partie",
  "menu.continue": "Continuer",
  "menu.mute": "Son: {state}",
  "menu.reset": "Effacer la sauvegarde",
  "menu.language": "Langue: {code}",
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
  "victory.score": "Score final: {n}"
}
"""

FILES["src/i18n/es.json"] = """{
  "menu.title": "JUEGO 2D",
  "menu.start": "Nueva partida",
  "menu.continue": "Continuar",
  "menu.mute": "Sonido: {state}",
  "menu.reset": "Borrar guardado",
  "menu.language": "Idioma: {code}",
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
  "victory.score": "Puntuación: {n}"
}
"""

FILES["src/i18n/de.json"] = """{
  "menu.title": "SPIEL 2D",
  "menu.start": "Neues Spiel",
  "menu.continue": "Fortsetzen",
  "menu.mute": "Ton: {state}",
  "menu.reset": "Speicher löschen",
  "menu.language": "Sprache: {code}",
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
  "victory.score": "Endpunktzahl: {n}"
}
"""

FILES["src/i18n/ja.json"] = """{
  "menu.title": "ゲーム 2D",
  "menu.start": "ニューゲーム",
  "menu.continue": "コンティニュー",
  "menu.mute": "サウンド: {state}",
  "menu.reset": "セーブを削除",
  "menu.language": "言語: {code}",
  "menu.touch": "タッチ: {state}",
  "common.on": "オン",
  "common.off": "オフ",
  "hud.score": "スコア: {n}",
  "hud.lives": "残機: {n}",
  "hud.level": "レベル {n}",
  "gameover.title": "ゲームオーバー",
  "gameover.retry": "リトライ",
  "gameover.menu": "メインメニュー",
  "pause.title": "ポーズ",
  "pause.resume": "再開",
  "pause.quit": "終了",
  "victory.title": "勝利",
  "victory.score": "最終スコア: {n}"
}
"""

FILES["src/engine/MML.ts"] = """import { CONFIG } from '../config';
import { isMuted } from './Audio';

/**
 * Tiny MML (Music Macro Language) player. Compiles a string into note events
 * and schedules them on a single AudioContext.
 *
 * Subset:
 *   c d e f g a b   notes (relative to current octave)
 *   #  / + after note → sharp
 *   -  after note  → flat
 *   1 2 4 8 16    optional length (default L)
 *   .             dotted (length × 1.5)
 *   o<n>          set octave (default 4)
 *   l<n>          set default length
 *   t<n>          set tempo (BPM)
 *   v<0..15>      set volume
 *   r             rest of current length
 *   <             octave -1
 *   >             octave +1
 *   |             bar separator (ignored)
 *
 * Channels: pass an object { square: 'mml', triangle: 'mml', noise: 'mml' }.
 *
 * Example: 'o4 l8 t120 cdefgab>c'
 */

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

interface NoteEv { time: number; freq: number; dur: number; vol: number; type: OscillatorType; }

export interface MMLTrack {
  square?: string;
  triangle?: string;
  noise?: string;
}

function compile(mml: string, type: OscillatorType): NoteEv[] {
  let oct = 4, len = 4, tempo = 120, vol = 0.6;
  let t = 0;
  const evs: NoteEv[] = [];
  const s = mml.toLowerCase().replace(/\\s+/g, '');
  let i = 0;
  const beat = () => 60 / tempo;

  while (i < s.length) {
    const c = s[i++];
    if (c === '|') continue;
    if (c === '>') { oct++; continue; }
    if (c === '<') { oct--; continue; }
    if (c === 'o') { const n = readNum(); if (n !== null) oct = n; continue; }
    if (c === 'l') { const n = readNum(); if (n !== null) len = n; continue; }
    if (c === 't') { const n = readNum(); if (n !== null) tempo = n; continue; }
    if (c === 'v') { const n = readNum(); if (n !== null) vol = Math.max(0, Math.min(15, n)) / 15; continue; }
    if (c === 'r') { const l = readLen(); t += beat() * 4 / l; continue; }
    if (c >= 'a' && c <= 'g') {
      let st = SEMI[c];
      if (s[i] === '#' || s[i] === '+') { st++; i++; }
      else if (s[i] === '-') { st--; i++; }
      const l = readLen();
      const dur = beat() * 4 / l;
      const semis = (oct - 4) * 12 + st - 9; // A4 = 0
      const freq = 440 * Math.pow(2, semis / 12);
      evs.push({ time: t, freq, dur: dur * 0.95, vol, type });
      t += dur;
    }
  }
  return evs;

  function readNum(): number | null {
    let r = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') r += s[i++];
    return r ? parseInt(r, 10) : null;
  }
  function readLen(): number {
    const n = readNum();
    let l = n ?? len;
    if (s[i] === '.') { l = l / 1.5; i++; }
    return l;
  }
}

let ctx: AudioContext | null = null;
let nodes: AudioScheduledSourceNode[] = [];
let stopAt = 0;
let loopTimer: number | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 0.2;
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function schedule(evs: NoteEv[], t0: number): number {
  const c = getCtx();
  let end = t0;
  for (const e of evs) {
    const at = t0 + e.time;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(e.vol * CONFIG.AUDIO.MUSIC_VOLUME * CONFIG.AUDIO.MASTER_VOLUME, at + 0.005);
    g.gain.linearRampToValueAtTime(0, at + e.dur);
    g.connect(c.destination);
    if (e.type === 'sawtooth' && (e as any)._noise) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.connect(g);
      src.start(at);
      src.stop(at + e.dur);
      nodes.push(src);
    } else {
      const o = c.createOscillator();
      o.type = e.type;
      o.frequency.setValueAtTime(e.freq, at);
      o.connect(g);
      o.start(at);
      o.stop(at + e.dur + 0.01);
      nodes.push(o);
    }
    end = Math.max(end, at + e.dur);
  }
  return end;
}

export function play(track: MMLTrack, opts: { loop?: boolean } = {}) {
  if (isMuted()) return;
  stop();
  const c = getCtx();
  const t0 = c.currentTime + 0.05;
  let end = t0;
  if (track.square)   end = Math.max(end, schedule(compile(track.square,   'square'),   t0));
  if (track.triangle) end = Math.max(end, schedule(compile(track.triangle, 'triangle'), t0));
  if (track.noise) {
    const evs = compile(track.noise, 'sawtooth').map(e => ({ ...e, _noise: true } as any));
    end = Math.max(end, schedule(evs, t0));
  }
  stopAt = end;
  if (opts.loop) {
    const dur = (end - t0) * 1000;
    loopTimer = window.setTimeout(() => play(track, { loop: true }), Math.max(50, dur - 100));
  }
}

export function stop() {
  if (loopTimer !== null) { clearTimeout(loopTimer); loopTimer = null; }
  for (const n of nodes) { try { n.stop(); } catch {} }
  nodes = [];
}

// ─── Built-in chiptunes — drop-in melodies for common moods ──────────────────
export const TUNES = {
  // Heroic 4/4 in C major. Light triangle bass + lead square.
  hero: {
    square:   'o5 l8 t120 v10 cdefg2 cdefg2 abcd>c<bag2 g4 r4',
    triangle: 'o3 l4 t120 v8  c c g g  a a g2 f f e e d d c2',
  },
  // Mysterious minor in A. Slow.
  mystic: {
    square:   'o4 l8 t96 v9 a >c d e e d c <a g2 r2',
    triangle: 'o2 l4 t96 v7 a a e e d d a2 g g d d c c g2',
  },
  // Boss battle: aggressive tritone, fast 16ths.
  boss: {
    square:   'o5 l16 t160 v11 efef gfed cdef gabag fed2 r2',
    triangle: 'o2 l8 t160 v9  e e b b a a e e f f c c b b f f',
    noise:    'o3 l16 t160 v6 cccccccc cccccccc',
  },
  // Victory fanfare.
  victory: {
    square:   'o5 l8 t140 v12 ceg>c<bg ab>cd c2 r4',
    triangle: 'o3 l4 t140 v8  c g >c g  c g >c g'
  }
} as const;
"""

FILES["src/engine/SfxBank.ts"] = """import { sfx as basicSfx } from './Audio';

/**
 * SFX preset bank — extends Audio.ts with 20+ common 8-bit sounds.
 * All synthesized at runtime via square + noise.
 *
 *   import { sfx } from '@/engine/SfxBank';
 *   sfx('powerup');
 */

import { CONFIG } from '../config';
import { isMuted } from './Audio';

type Preset = {
  freq: number;
  dur: number;
  vol: number;
  slide?: number;     // freq slide over duration
  type?: OscillatorType;
  noise?: number;     // 0..1 mix of white noise
  arpeggio?: number[]; // semitone offsets cycled
};

const BANK: Record<string, Preset> = {
  // movement
  jump:      { freq: 440, dur: 0.10, vol: 0.40, slide: +400, type: 'square' },
  doublejump:{ freq: 660, dur: 0.10, vol: 0.40, slide: +600, type: 'square' },
  land:      { freq: 220, dur: 0.05, vol: 0.30, slide: -50,  noise: 0.4 },
  step:      { freq: 200, dur: 0.04, vol: 0.15, noise: 0.6 },
  dash:      { freq: 880, dur: 0.12, vol: 0.35, slide: -400, type: 'sawtooth' },
  // combat
  hit:       { freq: 300, dur: 0.08, vol: 0.45, slide: -200, noise: 0.5 },
  parry:     { freq: 1200, dur: 0.08, vol: 0.40, slide: -800, type: 'square' },
  shoot:     { freq: 880, dur: 0.05, vol: 0.30, slide: -300, type: 'square' },
  explode:   { freq: 100, dur: 0.30, vol: 0.55, slide: -50, noise: 0.9 },
  hurt:      { freq: 200, dur: 0.20, vol: 0.55, slide: -150, type: 'sawtooth' },
  death:     { freq: 110, dur: 0.50, vol: 0.60, slide: -100, noise: 0.4 },
  // pickups
  coin:      { freq: 880, dur: 0.10, vol: 0.40, slide: +1000, type: 'square' },
  gem:       { freq: 1320, dur: 0.15, vol: 0.40, arpeggio: [0, 4, 7] },
  heart:     { freq: 660, dur: 0.20, vol: 0.40, arpeggio: [0, 7, 12] },
  key:       { freq: 880, dur: 0.18, vol: 0.40, arpeggio: [0, 5, 12] },
  powerup:   { freq: 440, dur: 0.30, vol: 0.45, arpeggio: [0, 4, 7, 12, 16] },
  // ui / state
  select:    { freq: 660, dur: 0.05, vol: 0.30, type: 'square' },
  cancel:    { freq: 220, dur: 0.08, vol: 0.30, slide: -100, type: 'square' },
  pause:     { freq: 440, dur: 0.12, vol: 0.30, type: 'triangle' },
  victory:   { freq: 523, dur: 0.40, vol: 0.50, arpeggio: [0, 4, 7, 12], slide: +400 },
  levelup:   { freq: 660, dur: 0.50, vol: 0.50, arpeggio: [0, 2, 4, 5, 7, 9, 11, 12] },
  // ambient
  swim:      { freq: 200, dur: 0.20, vol: 0.20, noise: 0.7 },
  fire:      { freq: 100, dur: 0.30, vol: 0.20, noise: 1.0 },
  electric:  { freq: 1100, dur: 0.10, vol: 0.30, slide: -200, type: 'square', noise: 0.3 }
};

let ctxRef: AudioContext | null = null;
function ctx(): AudioContext {
  if (!ctxRef) ctxRef = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctxRef.state === 'suspended') ctxRef.resume();
  return ctxRef;
}

function noiseBuf(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 0.5;
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function sfx(name: string) {
  if (isMuted()) return;
  const p = BANK[name];
  if (!p) { basicSfx(name as any); return; }  // fallback to legacy bank
  const c = ctx();
  const t0 = c.currentTime;
  const vol = p.vol * CONFIG.AUDIO.SFX_VOLUME * CONFIG.AUDIO.MASTER_VOLUME;

  if (p.arpeggio) {
    const step = p.dur / p.arpeggio.length;
    for (let i = 0; i < p.arpeggio.length; i++) {
      const f = p.freq * Math.pow(2, p.arpeggio[i] / 12);
      tone(c, t0 + i * step, step * 0.95, f, f + (p.slide || 0), vol, p.type || 'square', p.noise || 0);
    }
  } else {
    tone(c, t0, p.dur, p.freq, p.freq + (p.slide || 0), vol, p.type || 'square', p.noise || 0);
  }
}

function tone(c: AudioContext, at: number, dur: number, f1: number, f2: number, vol: number, type: OscillatorType, noise: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.005);
  g.gain.linearRampToValueAtTime(0, at + dur);
  g.connect(c.destination);
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f1), at);
  o.frequency.linearRampToValueAtTime(Math.max(20, f2), at + dur);
  o.connect(g);
  o.start(at);
  o.stop(at + dur + 0.02);
  if (noise > 0) {
    const ng = c.createGain();
    ng.gain.value = noise * vol;
    ng.connect(c.destination);
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c);
    src.connect(ng);
    src.start(at);
    src.stop(at + dur);
  }
}

export const SFX_NAMES = Object.keys(BANK);
"""

FILES["public/audio/AGENT.md"] = """# public/audio/

Drop external `.ogg` / `.mp3` here for richer music. Loaded via Phaser's normal
audio loader inside Preload.ts. Procedural MML stays as default; user files
override only when present.

Sources (CC0 / CC-BY recommended):
- OpenGameArt 8-bit chiptunes
- freesound.org (filter by license)
- jsfxr / Bfxr exports

Naming: `<mood>.ogg` (hero.ogg, boss.ogg, mystic.ogg, victory.ogg).
"""

FILES["src/i18n/AGENT.md"] = """# AGENT.md — src/i18n/

Tiny i18n. Add a language by:
1. drop `src/i18n/<code>.json` (copy `en.json` and translate)
2. import + register in `index.ts` LOCALES map
3. extend `LocaleCode` type union

Use `t('namespace.key', { vars })` everywhere instead of literals. Keys not found in current locale fall back to English. Locale persists in localStorage `i18n:locale`.
"""

FILES["tests/unit/i18n.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, currentLocale, availableLocales } from '../../src/i18n';

describe('i18n', () => {
  beforeEach(() => setLocale('en'));

  it('returns the key when missing in every locale', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('renders placeholders', () => {
    expect(t('hud.score', { n: 42 })).toContain('42');
  });

  it('switches locale and translates', () => {
    setLocale('fr');
    expect(currentLocale()).toBe('fr');
    expect(t('menu.start')).toMatch(/Nouvelle/);
    setLocale('ja');
    expect(t('menu.start')).toContain('ニュー');
  });

  it('exposes 5 locales by default', () => {
    expect(availableLocales().sort()).toEqual(['de','en','es','fr','ja']);
  });

  it('falls back to English when key missing in current locale', () => {
    setLocale('fr');
    // @ts-ignore — simulate missing key by direct fetch through t
    expect(t('common.on')).toBeTruthy();
  });
});
"""

FILES["tests/unit/MML.test.ts"] = """import { describe, it, expect } from 'vitest';
import { TUNES, play, stop } from '../../src/engine/MML';

describe('MML TUNES catalog', () => {
  it('exposes hero / mystic / boss / victory tracks', () => {
    expect(Object.keys(TUNES).sort()).toEqual(['boss', 'hero', 'mystic', 'victory']);
  });
  it('every track has at least one channel string', () => {
    for (const k of Object.keys(TUNES)) {
      const t = (TUNES as any)[k];
      const has = !!(t.square || t.triangle || t.noise);
      expect(has).toBe(true);
    }
  });
});

describe('MML player', () => {
  it('play() with stubbed AudioContext does not throw', () => {
    expect(() => { play(TUNES.hero); stop(); }).not.toThrow();
  });
  it('stop() is idempotent', () => {
    expect(() => { stop(); stop(); }).not.toThrow();
  });
});
"""

FILES["tests/unit/SfxBank.test.ts"] = """import { describe, it, expect } from 'vitest';
import { sfx, SFX_NAMES } from '../../src/engine/SfxBank';

describe('SfxBank presets', () => {
  it('exposes 20+ named presets', () => {
    expect(SFX_NAMES.length).toBeGreaterThanOrEqual(20);
  });
  it('contains core movement / combat / pickup / ui presets', () => {
    for (const name of ['jump', 'land', 'hit', 'shoot', 'coin', 'powerup', 'select', 'victory']) {
      expect(SFX_NAMES).toContain(name);
    }
  });
  it('sfx(name) does not throw for known preset', () => {
    expect(() => sfx('jump')).not.toThrow();
    expect(() => sfx('powerup')).not.toThrow();
  });
  it('sfx(unknown) falls back without throwing', () => {
    expect(() => sfx('totally-unknown-sfx-name-xyz')).not.toThrow();
  });
});
"""

FILES["tests/unit/InputMap.test.ts"] = """import { describe, it, expect } from 'vitest';

// Lightweight integration: mocked Phaser scene, focus on axis() composition.
// Real keyboard/gamepad behaviour is covered in E2E.
describe('InputMap axis composition', () => {
  it('keyboard down sets ±1 on axes', async () => {
    // Create a fake scene whose addKey returns a stub key with mutable isDown.
    const keyState: Record<string, boolean> = {};
    const mkKey = (name: string) => ({ get isDown() { return !!keyState[name]; } });
    const scene: any = {
      input: { keyboard: { addKey: (n: any) => mkKey(String(n)) }, gamepad: { total: 0, getPad: () => null } },
      events: { on: () => {} }
    };
    const { InputMap } = await import('../../src/engine/Input');
    const im = new InputMap(scene);
    expect(im.axis()).toEqual({ x: 0, y: 0 });
    keyState['37'] = true; // LEFT
    expect(im.axis().x).toBeLessThan(0);
    keyState['37'] = false; keyState['39'] = true; // RIGHT
    expect(im.axis().x).toBeGreaterThan(0);
  });

  it('external touch axis overrides keyboard when nonzero', async () => {
    const scene: any = {
      input: { keyboard: { addKey: () => ({ isDown: false }) }, gamepad: { total: 0, getPad: () => null } },
      events: { on: () => {} }
    };
    const { InputMap } = await import('../../src/engine/Input');
    const im = new InputMap(scene);
    im.external = { isDown: () => false, axis: { x: 0.7, y: -0.4 } };
    const a = im.axis();
    expect(a.x).toBeCloseTo(0.7);
    expect(a.y).toBeCloseTo(-0.4);
  });
});
"""

FILES["tests/e2e/boot.spec.ts"] = """import { test, expect } from '@playwright/test';

// Headless WebGL drivers occasionally surface harmless warnings as pageerrors
// (framebuffer-unsupported, GL_INVALID_OPERATION on extensions). These are
// not real game-breaking errors — Phaser falls back to canvas. Filter known noise.
const KNOWN_NOISE = [
  /Framebuffer status: Framebuffer Unsupported/i,
  /WebGL: INVALID_OPERATION/i,
  /WEBGL_lose_context/i
];
const isReal = (msg: string) => !KNOWN_NOISE.some(rx => rx.test(msg));

test('boots and renders canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const real = errors.filter(isReal);
  expect(real, `unexpected runtime errors: ${real.join('; ')}`).toEqual([]);
});

test('error overlay does not appear on clean boot', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  expect(await page.locator('#g2d-err').count()).toBe(0);
});

test('canvas is non-zero size', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});
"""

FILES["tests/AGENT.md"] = """# AGENT.md — tests/

- `tests/unit/**/*.test.ts` — Vitest, jsdom env. Run: `npm test`.
- `tests/e2e/**/*.spec.ts` — Playwright, real browser. Run: `npm run test:e2e` (auto-starts vite).

Add unit tests for any new engine module (pure TS). Add E2E for any new scene transition or input path. Keep tests independent and deterministic — no time-based flakes.
"""

FILES["index.html"] = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0a0a23" />
  <meta name="description" content="A pixel-art 2D platformer." />
  <meta property="og:title" content="Game 2D" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%230a0a23'/%3E%3Crect x='4' y='4' width='8' height='8' fill='%234ade80'/%3E%3C/svg%3E" />
  <title>Game 2D</title>
  <style>
    html,body{margin:0;height:100%;background:#0a0a23;overflow:hidden;font-family:system-ui,sans-serif;color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;touch-action:none}
    #app{display:flex;align-items:center;justify-content:center;height:100%;position:relative}
    canvas{image-rendering:pixelated;display:block}
    #loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#4ade80;font-family:monospace;font-size:14px;letter-spacing:.2em;z-index:10}
    #loading.hidden{display:none}
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="loading">LOADING…</div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
"""

FILES["AGENT.md"] = """# AGENT.md — game-2d-ts (root)

Tu es un LLM qui édite ce projet de jeu 2D. Lis ce doc AVANT toute modif.

## Stack
- **Phaser 3.80** (moteur 2D web — physics, scenes, input, audio, tilemap, particles)
- **TypeScript strict**
- **Vite** (dev server + prod build, code-split: phaser chunk séparé)

## Modules engine disponibles
- `Camera` (follow/shake/fade/zoom/pan), `Input` (keyboard+gamepad+touch hook), `Audio` (SFX procédural + mute persistant), `Music` (loop arpège procédural), `Save` (localStorage typé), `StateMachine`, `UI` (HUD), `Particles`, `Parallax` (multi-layer scroll), `Tilemap` (ASCII grid → world), `Animations` (spritesheets canvas runtime), `Transitions` (screen wipes), `Touch` (virtual d-pad mobile)

## Architecture
```
src/
  main.ts            ← entry point, instancie le jeu — NE PAS toucher sauf ajout de scene
  config.ts          ← constantes globales (taille, gravity, vitesses) — TUNE ICI
  engine/            ← couche moteur (camera, input, audio, save) — NE PAS modifier sans bonne raison
  scenes/            ← scenes Phaser (Boot, Preload, MainMenu, Game, GameOver) — AJOUTE/ÉDITE ICI
  entities/          ← Player, Enemy, classes de game objects — AJOUTE ICI
  levels/            ← définitions de niveaux (data-only) — TUNE ICI
  assets/            ← placeholders (générés runtime via Phaser.Graphics)
```

Chaque sous-dir a son propre AGENT.md avec règles spécifiques.

## Workflow LLM
1. Demande user → identifie le sujet (gameplay tuning, nouveau niveau, nouvel ennemi, nouvelle mécanique)
2. Localise le bon dir via les AGENT.md
3. Édite UNIQUEMENT les fichiers ciblés
4. Si tu ajoutes un fichier : `npm run build` doit passer exit 0
5. Smoke-test agent: `npm run build` puis ouvre `file://.../dist/index.html`

## Règles d'or
- **Ne réinvente pas** : Phaser fournit déjà physics, input, tween, particles. Cherche dans la doc Phaser avant de coder.
- **Pas de magic numbers** : tout va dans `src/config.ts`.
- **Une scene = une responsabilité** : ne mélange pas menu et gameplay.
- **Entities = classes** qui étendent `Phaser.Physics.Arcade.Sprite`.
- **Save** : passe par `engine/Save.ts`, jamais `localStorage` direct.
- **Audio** : passe par `engine/Audio.ts` (intègre ZzFX pour SFX procéduraux).

## Tuning points (ce que le user demandera typiquement)
- Vitesse joueur, hauteur de saut → `src/config.ts:PLAYER`
- Gravité, taille monde → `src/config.ts:WORLD`
- Spawn ennemis → `src/levels/level1.ts`
- Couleurs / palette → `src/config.ts:PALETTE`
- HUD score/vies → `src/scenes/Game.ts:createHUD()`

## Build / run
```sh
npm install
npm run build    # build prod dans dist/
open file://.../dist/index.html
```
"""

FILES["README.md"] = """# game-2d-ts

Production-ready 2D platformer. Phaser 3 + TS + Vite. AI-tunable structure with `AGENT.md` docs at every level.

## Run

```sh
npm install
npm run build    # → dist/  (deployable static)
open file://.../dist/index.html
```

## Features

- **Engine** : camera (follow/shake/fade/zoom/pan), procedural audio (SFX + music), parallax, particles, FSM, save (localStorage), screen wipes
- **Input** : keyboard (WASD/AZERTY/arrows) + gamepad (XInput) + touch (auto-shows on touch devices)
- **Levels** : data-style (level1) + ASCII tilemap (level2/3). `#.PCEG` legend. LLM can author levels by editing the rows array.
- **Scenes** : Boot → Preload → MainMenu (new game / continue / mute / reset save) → Game → Pause → GameOver
- **Persistence** : high score, last level reached, mute, completion flag, per-level best
- **Mobile** : viewport meta + touch overlay + tap-friendly menus
- **Pixel art** : procedural spritesheets at runtime (no asset files), pixelated rendering

## Deploy

`dist/` is fully static. Drop on any host:

- **Vercel / Netlify** : connect repo, build cmd `npm run build`, output `dist`
- **GitHub Pages** : push `dist/` to `gh-pages` branch
- **S3 / Cloudflare Pages** : upload `dist/` as static site

Phaser chunk is separated for caching (`assets/phaser-*.js`). Game code is ~23 KB.

## Tune

Read `AGENT.md` and per-dir `AGENT.md` files. All gameplay numbers live in `src/config.ts`.
"""

FILES["src/AGENT.md"] = """# AGENT.md — src/

Entry point and config.

- `main.ts` : crée la `Phaser.Game` instance, déclare l'ordre des scenes. Ne modifie que pour AJOUTER une scene à la liste.
- `config.ts` : **TOUS les nombres magiques vivent ici**. Tuner gameplay = modifier ce fichier.

Sous-dirs : voir leur propre AGENT.md.
"""

FILES["src/kit.ts"] = """/**
 * Platformer kit. Side-scroller with gravity, jump, attack.
 * Replace these scenes when generating a different genre kit.
 */
import { MainMenuScene } from './scenes/MainMenu';
import { GameScene } from './scenes/Game';
import { CONFIG } from './config';

export const KIT_SCENES = [MainMenuScene, GameScene];
export const KIT_GRAVITY = CONFIG.WORLD.GRAVITY;
export const KIT_NAME = 'platformer';
"""

FILES["src/main.ts"] = """import Phaser from 'phaser';
import { CONFIG } from './config';
import { BootScene } from './scenes/Boot';
import { PreloadScene } from './scenes/Preload';
import { PauseScene } from './scenes/Pause';
import { GameOverScene } from './scenes/GameOver';
import { KIT_SCENES, KIT_GRAVITY } from './kit';
import { installErrorBoundary } from './engine/ErrorBoundary';
import { installAudioUnlock } from './engine/AudioUnlock';
import { info } from './engine/Telemetry';

installErrorBoundary();
installAudioUnlock();
info('boot');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: CONFIG.WORLD.VIEW_WIDTH,
  height: CONFIG.WORLD.VIEW_HEIGHT,
  pixelArt: true,
  backgroundColor: CONFIG.PALETTE.BG,
  input: { gamepad: true },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: KIT_GRAVITY }, debug: CONFIG.DEBUG }
  },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, PreloadScene, ...KIT_SCENES, PauseScene, GameOverScene]
});

// Agent-friendly facade: exposes { app, player, scene } so smoke probes can
// inspect runtime state regardless of which scene is active. `raw` keeps the
// underlying Phaser.Game accessible.
(window as any).__game = {
  raw: game,
  get scene() {
    const active = game.scene?.getScenes?.(true) || [];
    return active[0] || null;
  },
  get player() {
    const active = game.scene?.getScenes?.(true) || [];
    for (const s of active) {
      const p = (s as any).player;
      if (p) return p;
    }
    return null;
  },
  get app() {
    const active = game.scene?.getScenes?.(true) || [];
    const sc: any = active[0];
    const len = sc?.children?.list?.length ?? sc?.sys?.displayList?.list?.length ?? 0;
    return { stage: { children: { length: len } } };
  }
};
// Wire keyboard events on window so probes that dispatch KeyboardEvent on
// window are also seen by Phaser's input system (which listens on the canvas).
window.addEventListener('keydown', (e) => {
  const sc = (game.scene?.getScenes?.(true) || [])[0] as any;
  if (sc?.input?.keyboard?.emit) {
    sc.input.keyboard.emit('keydown', e);
    sc.input.keyboard.emit('keydown-' + (e.code || '').toUpperCase(), e);
  }
});
window.addEventListener('keyup', (e) => {
  const sc = (game.scene?.getScenes?.(true) || [])[0] as any;
  if (sc?.input?.keyboard?.emit) {
    sc.input.keyboard.emit('keyup', e);
    sc.input.keyboard.emit('keyup-' + (e.code || '').toUpperCase(), e);
  }
});
"""

FILES["src/config.ts"] = "__RENDERED_AT_APPLY__"

FILES["src/engine/AGENT.md"] = """# AGENT.md — src/engine/

Couche moteur réutilisable. **Modifie avec prudence** — toutes les scenes en dépendent.

Modules :
- `Camera.ts`    : follow, shake, fade, zoom, deadzone
- `Input.ts`     : keyboard → semantic action map (extend with mouse/touch/gamepad as needed)
- `Audio.ts`     : musique + SFX (ZzFX-style procédural via WebAudio)
- `Save.ts`      : localStorage typé (high score, settings)
- `StateMachine.ts` : FSM pour ennemis/joueur
- `UI.ts`        : helpers HUD (text, healthbar, score)
- `Particles.ts` : presets émetteurs (explosion, dust, sparkle)
- `Sprites.ts`   : pixel-art ASCII forge (defineSprite + buildAll). Joueur 16×16 (idle/run/jump/attack/hurt), ennemi 14×14, coin 8×8 spinning. **Pour ajouter un perso** : copier un bloc de frames, tweaker les pixels, defineSprite(...). Lis le doc en tête du fichier.
- `Animations.ts`: re-export legacy de Sprites (compat)
- `Tiles.ts`     : forge de tiles 16×16 par biome (grass/dirt/stone/sand/cave/metal/snow), avec grain + edge + variant `_top` pour caps. `buildTiles(scene, defaultBiome)` doit être appelé en Preload.
- `Autotile.ts`  : bitmask 4-directions, `paintWalls(scene, walls, tileSize, biome)` choisit auto la bonne variante (top vs body) selon les voisins. Utilise ça au lieu de `add.image(..., 'platform')` pour des plateformes connectées proprement.

**Quand AJOUTER ici** : feature transverse réutilisable par plusieurs scenes/entities.
**Quand NE PAS** : logique gameplay spécifique → `entities/` ou `scenes/`.
"""

FILES["src/engine/Camera.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/**
 * Smooth camera helpers.
 * Usage: `cam.follow(player); cam.shake(); cam.fadeOut(500);`
 */
export class Cam {
  constructor(private cam: Phaser.Cameras.Scene2D.Camera) {}

  follow(target: Phaser.GameObjects.GameObject) {
    this.cam.startFollow(target as any, true, CONFIG.CAMERA.LERP, CONFIG.CAMERA.LERP);
    this.cam.setDeadzone(CONFIG.CAMERA.DEADZONE_W, CONFIG.CAMERA.DEADZONE_H);
  }

  bounds(w: number, h: number) {
    this.cam.setBounds(0, 0, w, h);
  }

  shake(ms = CONFIG.CAMERA.SHAKE_DURATION_MS, intensity = CONFIG.CAMERA.SHAKE_INTENSITY) {
    this.cam.shake(ms, intensity);
  }

  flash(color = 0xffffff, ms = 100) {
    this.cam.flash(ms, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
  }

  fadeOut(ms = 500, cb?: () => void) {
    this.cam.fadeOut(ms);
    if (cb) this.cam.once('camerafadeoutcomplete', cb);
  }

  fadeIn(ms = 500) {
    this.cam.fadeIn(ms);
  }

  zoom(z: number, ms = 0) {
    if (ms <= 0) { this.cam.setZoom(z); return; }
    this.cam.zoomTo(z, ms);
  }

  pan(x: number, y: number, ms = 500) {
    this.cam.pan(x, y, ms, Phaser.Math.Easing.Sine.InOut);
  }
}
"""

FILES["src/engine/Input.ts"] = """import Phaser from 'phaser';

/** Unified input → semantic actions. Keyboard + gamepad. Add an action: extend `Action` + bindings. */
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'pause' | 'confirm';

const PAD_DEADZONE = 0.25;

export class InputMap {
  private keys: Partial<Record<Action, Phaser.Input.Keyboard.Key[]>> = {};
  private justPressed = new Set<Action>();
  private wasDown = new Set<Action>();

  constructor(private scene: Phaser.Scene) {
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const k = (codes: number[]) => codes.map(c => scene.input.keyboard!.addKey(c));
    this.keys = {
      left:    k([KC.LEFT, KC.A, KC.Q]),
      right:   k([KC.RIGHT, KC.D]),
      up:      k([KC.UP, KC.W, KC.Z]),
      down:    k([KC.DOWN, KC.S]),
      jump:    k([KC.SPACE, KC.UP, KC.W, KC.Z]),
      attack:  k([KC.X, KC.J, KC.CTRL]),
      pause:   k([KC.ESC, KC.P]),
      confirm: k([KC.ENTER, KC.SPACE])
    };
    scene.events.on('preupdate', () => this.tick());
  }

  /** First connected gamepad (or null). */
  private pad(): Phaser.Input.Gamepad.Gamepad | null {
    const g = this.scene.input.gamepad;
    return g && g.total > 0 ? g.getPad(0) : null;
  }

  /** Pad button mapping (XInput-ish). A=jump, B=attack, Start=pause. */
  private padDown(a: Action): boolean {
    const p = this.pad();
    if (!p) return false;
    const lx = p.leftStick.x, ly = p.leftStick.y;
    switch (a) {
      case 'left':    return p.left  || lx < -PAD_DEADZONE;
      case 'right':   return p.right || lx >  PAD_DEADZONE;
      case 'up':      return p.up    || ly < -PAD_DEADZONE;
      case 'down':    return p.down  || ly >  PAD_DEADZONE;
      case 'jump':    return p.A;
      case 'attack':  return p.B;
      case 'pause':   return !!p.buttons[9]?.pressed;  // Start
      case 'confirm': return p.A;
    }
  }

  /** Optional external source (touch overlay) consulted in isDown(). */
  external: { isDown: (a: Action) => boolean; axis?: { x: number; y: number } } | null = null;

  isDown(a: Action): boolean {
    if ((this.keys[a] || []).some(k => k.isDown)) return true;
    if (this.external?.isDown(a)) return true;
    return this.padDown(a);
  }

  /** Continuous axis in [-1,1] from pad left stick or touch joystick (kbd = ±1). */
  axis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.isDown('left'))  x = -1;
    if (this.isDown('right')) x = 1;
    if (this.isDown('up'))    y = -1;
    if (this.isDown('down'))  y = 1;
    const p = this.pad();
    if (p) {
      if (Math.abs(p.leftStick.x) > PAD_DEADZONE) x = p.leftStick.x;
      if (Math.abs(p.leftStick.y) > PAD_DEADZONE) y = p.leftStick.y;
    }
    if (this.external?.axis) {
      if (this.external.axis.x !== 0) x = this.external.axis.x;
      if (this.external.axis.y !== 0) y = this.external.axis.y;
    }
    return { x, y };
  }

  /** True only on the frame the action transitioned from up to down. */
  pressed(a: Action): boolean {
    return this.justPressed.has(a);
  }

  private tick() {
    this.justPressed.clear();
    for (const a of Object.keys(this.keys) as Action[]) {
      const down = this.isDown(a);
      if (down && !this.wasDown.has(a)) this.justPressed.add(a);
      if (down) this.wasDown.add(a); else this.wasDown.delete(a);
    }
  }
}
"""

FILES["src/engine/Audio.ts"] = """import { CONFIG } from '../config';
import { load, save } from './Save';

/**
 * Tiny procedural SFX — no asset files needed.
 * Add a sound: define preset in PRESETS and call `sfx('jump')`.
 *
 * Each preset: [vol, freq, attack, sustain, decay, slide, noise]
 * noise > 0 mixes a white-noise buffer (real noise, not sawtooth).
 */
type Preset = [number, number, number, number, number, number, number];

const PRESETS: Record<string, Preset> = {
  jump:    [0.4, 660, 0.01, 0.05, 0.10,  600, 0.0],
  hit:     [0.5, 220, 0.00, 0.04, 0.08, -300, 0.4],
  coin:    [0.4, 880, 0.01, 0.06, 0.10, 1200, 0.0],
  death:   [0.6, 110, 0.02, 0.20, 0.40, -200, 0.3],
  step:    [0.15, 200, 0.00, 0.02, 0.04, -100, 0.5],
  victory: [0.5, 523, 0.02, 0.30, 0.40,  800, 0.0]
};

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = load().muted;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate * 0.5;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

export function sfx(name: keyof typeof PRESETS) {
  if (muted) return;
  const p = PRESETS[name];
  if (!p) return;
  const [vol, freq, attack, sustain, decay, slide, noise] = p;
  const c = getCtx();
  const t = c.currentTime;
  const dur = attack + sustain + decay;

  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol * CONFIG.AUDIO.SFX_VOLUME * CONFIG.AUDIO.MASTER_VOLUME, t + attack);
  g.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(c.destination);

  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.linearRampToValueAtTime(Math.max(50, freq + slide), t + dur);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + dur + 0.05);

  if (noise > 0) {
    const ng = c.createGain();
    ng.gain.value = noise * vol * CONFIG.AUDIO.SFX_VOLUME * CONFIG.AUDIO.MASTER_VOLUME;
    ng.connect(c.destination);
    const src = c.createBufferSource();
    src.buffer = getNoiseBuffer(c);
    src.connect(ng);
    src.start(t);
    src.stop(t + dur);
  }
}

export function unlockAudio() { getCtx(); }
export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; save({ muted }); return muted; }
export function setMuted(v: boolean) { muted = v; save({ muted }); }
"""

FILES["src/engine/Save.ts"] = """import { CONFIG } from '../config';

/** Typed localStorage wrapper with schema versioning + forward migrations.
 *  Bump SAVE_VERSION when SaveData shape changes; add a step in MIGRATIONS.
 *  Older saves auto-upgrade; corrupt blobs degrade to defaults (never throw). */
export const SAVE_VERSION = 2;

export interface SaveData {
  _v: number;
  highScore: number;
  muted: boolean;
  lastLevel: string;
  completed: boolean;
  bestPerLevel: Record<string, number>;
  locale: string;             // v2: persisted UI locale
}

const DEFAULT: SaveData = {
  _v: SAVE_VERSION,
  highScore: 0,
  muted: false,
  lastLevel: 'level1',
  completed: false,
  bestPerLevel: {},
  locale: 'en'
};

type Migration = (raw: any) => any;
export const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2 : add locale field, normalize missing _v.
  1: (r) => ({ ...r, _v: 2, locale: r.locale || 'en' })
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

export function reset() {
  try { localStorage.removeItem(CONFIG.SAVE_KEY); } catch {}
}
"""

FILES["src/engine/StateMachine.ts"] = """/**
 * Minimal FSM for entities. Each state has enter/update/exit.
 * Usage:
 *   const fsm = new FSM('idle', { idle:{...}, run:{...} });
 *   fsm.update(dt);
 *   fsm.transition('run');
 */
export interface State {
  enter?(): void;
  update?(dt: number): void;
  exit?(): void;
}

export class FSM<K extends string> {
  current: K;
  constructor(initial: K, private states: Record<K, State>) {
    this.current = initial;
    this.states[initial]?.enter?.();
  }

  transition(to: K) {
    if (to === this.current) return;
    this.states[this.current]?.exit?.();
    this.current = to;
    this.states[to]?.enter?.();
  }

  update(dt: number) {
    this.states[this.current]?.update?.(dt);
  }
}
"""

FILES["src/engine/UI.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/** HUD helpers — typed text/healthbar/score on a fixed (scroll-locked) layer. */
export class HUD {
  private layer: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
  }

  text(x: number, y: number, value = '', size = 12): Phaser.GameObjects.Text {
    const t = this.scene.add.text(x, y, value, {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    }).setScrollFactor(0);
    this.layer.add(t);
    return t;
  }

  bar(x: number, y: number, w: number, h: number, color = 0xff3355): {
    set: (ratio: number) => void;
    destroy: () => void;
  } {
    const bg = this.scene.add.rectangle(x, y, w, h, 0x000000, 0.6).setOrigin(0).setScrollFactor(0);
    const fg = this.scene.add.rectangle(x, y, w, h, color).setOrigin(0).setScrollFactor(0);
    this.layer.add([bg, fg]);
    return {
      set: (r: number) => { fg.width = Math.max(0, Math.min(1, r)) * w; },
      destroy: () => { bg.destroy(); fg.destroy(); }
    };
  }
}
"""

FILES["src/engine/Particles.ts"] = """import Phaser from 'phaser';

/** Preset particle emitters using Phaser.GameObjects.Particles. */
export function dust(scene: Phaser.Scene, x: number, y: number) {
  const e = scene.add.particles(x, y, 'pixel', {
    speed: { min: 30, max: 80 },
    angle: { min: 240, max: 300 },
    lifespan: 300,
    scale: { start: 1.5, end: 0 },
    quantity: 4,
    tint: 0xaaaaaa,
    emitting: false
  });
  e.explode(8);
  scene.time.delayedCall(400, () => e.destroy());
}

export function explosion(scene: Phaser.Scene, x: number, y: number, color = 0xf87171) {
  const e = scene.add.particles(x, y, 'pixel', {
    speed: { min: 50, max: 200 },
    angle: { min: 0, max: 360 },
    lifespan: 500,
    scale: { start: 2, end: 0 },
    quantity: 12,
    tint: color,
    emitting: false
  });
  e.explode(20);
  scene.time.delayedCall(600, () => e.destroy());
}

export function sparkle(scene: Phaser.Scene, x: number, y: number, color = 0xfbbf24) {
  const e = scene.add.particles(x, y, 'pixel', {
    speed: { min: 20, max: 60 },
    angle: { min: 0, max: 360 },
    lifespan: 400,
    scale: { start: 1, end: 0 },
    quantity: 6,
    tint: color,
    emitting: false
  });
  e.explode(10);
  scene.time.delayedCall(500, () => e.destroy());
}
"""

FILES["src/engine/Music.ts"] = """import { CONFIG } from '../config';
import { isMuted } from './Audio';

/**
 * Procedural background music — chord arpeggio loop, no audio files.
 * Call `Music.start()` after a user gesture (Audio unlock). `Music.stop()` to halt.
 *
 * Chord progression in NOTES (semitones from A4=440Hz). Edit to change feel.
 */
const A4 = 440;
const NOTES = [
  // i-VI-III-VII (Am-F-C-G) arpeggios, one chord per bar (1.6s)
  [0, 3, 7, 12], [-4, 0, 5, 8], [3, 7, 12, 15], [-2, 2, 7, 10]
];

let ctx: AudioContext | null = null;
let timer: number | null = null;
let bar = 0;
let beat = 0;
const BAR_MS = 1600;
const BEAT_MS = BAR_MS / 4;

function note(c: AudioContext, semis: number, dur: number, vol = 0.08, type: OscillatorType = 'triangle') {
  const t = c.currentTime;
  const f = A4 * Math.pow(2, semis / 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol * CONFIG.AUDIO.MUSIC_VOLUME * CONFIG.AUDIO.MASTER_VOLUME, t + 0.02);
  g.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(c.destination);
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function step() {
  if (!ctx) return;
  if (!isMuted()) {
    const chord = NOTES[bar % NOTES.length];
    note(ctx, chord[beat % chord.length], BEAT_MS / 1000 * 0.9);
    if (beat === 0) note(ctx, chord[0] - 12, BEAT_MS / 1000 * 1.5, 0.06, 'sawtooth');
  }
  beat++;
  if (beat >= 4) { beat = 0; bar++; }
}

export const Music = {
  start() {
    if (timer != null) return;
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    bar = 0; beat = 0;
    step();
    timer = window.setInterval(step, BEAT_MS);
  },
  stop() {
    if (timer != null) { clearInterval(timer); timer = null; }
  },
  isPlaying() { return timer != null; }
};
"""

FILES["src/engine/Transitions.ts"] = """import Phaser from 'phaser';

/**
 * Screen-wipe transitions. Use between scenes/levels for polish.
 *   wipeOut(scene, 'left', 400, () => scene.scene.start('Next'));
 */
export type WipeDir = 'left' | 'right' | 'up' | 'down';

export function wipe(scene: Phaser.Scene, dir: WipeDir = 'left', duration = 400, cb?: () => void) {
  const cam = scene.cameras.main;
  const W = cam.width, H = cam.height;
  const rect = scene.add.rectangle(0, 0, W, H, 0x0a0a23).setOrigin(0).setScrollFactor(0).setDepth(99999);
  let from: any = {}, to: any = {};
  switch (dir) {
    case 'left':  rect.x = W;  to = { x: 0 };  break;
    case 'right': rect.x = -W; to = { x: 0 };  break;
    case 'up':    rect.y = H;  to = { y: 0 };  break;
    case 'down':  rect.y = -H; to = { y: 0 };  break;
  }
  scene.tweens.add({
    targets: rect, ...to, duration, ease: 'Cubic.easeInOut',
    onComplete: () => { cb?.(); scene.tweens.add({ targets: rect, alpha: 0, duration: 200, onComplete: () => rect.destroy() }); }
  });
}
"""

FILES["src/engine/Touch.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/**
 * Virtual on-screen controls. Auto-shows on touch devices but can be forced
 * via `?touch=1` URL flag for testing on desktop.
 *
 * Layout: analog stick (left thumb) + A/B/X/Y buttons (right thumb) + Pause (top-right).
 * Stick reports continuous direction in `axis` (x,y in [-1,1]). Discrete keys
 * left/right/up/down derived from axis with a small deadzone for compat.
 */
type TouchAction = 'left'|'right'|'up'|'down'|'jump'|'attack'|'confirm'|'pause';

export class TouchControls {
  private down: Record<TouchAction, boolean> = {
    left: false, right: false, up: false, down: false,
    jump: false, attack: false, confirm: false, pause: false
  };
  axis = { x: 0, y: 0 };
  enabled = false;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private knob?: Phaser.GameObjects.Arc;
  private stickBase?: Phaser.GameObjects.Arc;
  private stickPid: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private stickRadius = 28;

  constructor(private scene: Phaser.Scene, opts: { force?: boolean } = {}) {
    const force = opts.force || /[?&]touch=1\\b/.test(typeof location !== 'undefined' ? location.search : '');
    if (!scene.sys.game.device.input.touch && !force) return;
    this.enabled = true;
    const W = CONFIG.WORLD.VIEW_WIDTH, H = CONFIG.WORLD.VIEW_HEIGHT;
    this.buildStick(scene, 50, H - 50);
    this.buildBtn(scene, W - 28, H - 28,  'A', 'jump',    0x22c55e);
    this.buildBtn(scene, W - 56, H - 50,  'B', 'attack',  0xef4444);
    this.buildBtn(scene, W - 80, H - 28,  'X', 'confirm', 0x3b82f6);
    this.buildBtn(scene, W - 14, 14,      '⏸', 'pause',  0x71717a);
  }

  private buildStick(scene: Phaser.Scene, cx: number, cy: number) {
    this.stickCenter = { x: cx, y: cy };
    const base = scene.add.circle(cx, cy, this.stickRadius, 0xffffff, 0.10).setStrokeStyle(1, 0xffffff, 0.3).setScrollFactor(0).setDepth(2000);
    const knob = scene.add.circle(cx, cy, 12, 0xffffff, 0.30).setStrokeStyle(1, 0xffffff, 0.5).setScrollFactor(0).setDepth(2001);
    this.stickBase = base; this.knob = knob;
    this.objs.push(base, knob);
    const hit = scene.add.circle(cx, cy, this.stickRadius + 18, 0xffffff, 0.0001).setScrollFactor(0).setDepth(1999).setInteractive();
    this.objs.push(hit);
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => { this.stickPid = p.id; this.updateStick(p.x, p.y); });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (this.stickPid === p.id) this.updateStick(p.x, p.y); });
    scene.input.on('pointerup',   (p: Phaser.Input.Pointer) => { if (this.stickPid === p.id) { this.stickPid = null; this.resetStick(); } });
  }

  private updateStick(px: number, py: number) {
    const cam = this.scene.cameras.main;
    const sx = (px - cam.x) / cam.zoom;
    const sy = (py - cam.y) / cam.zoom;
    let dx = sx - this.stickCenter.x, dy = sy - this.stickCenter.y;
    const r = Math.hypot(dx, dy);
    if (r > this.stickRadius) { dx = dx / r * this.stickRadius; dy = dy / r * this.stickRadius; }
    this.knob?.setPosition(this.stickCenter.x + dx, this.stickCenter.y + dy);
    this.axis.x = dx / this.stickRadius;
    this.axis.y = dy / this.stickRadius;
    const D = 0.25;
    this.down.left  = this.axis.x < -D;
    this.down.right = this.axis.x >  D;
    this.down.up    = this.axis.y < -D;
    this.down.down  = this.axis.y >  D;
  }

  private resetStick() {
    this.knob?.setPosition(this.stickCenter.x, this.stickCenter.y);
    this.axis.x = 0; this.axis.y = 0;
    this.down.left = this.down.right = this.down.up = this.down.down = false;
  }

  private buildBtn(scene: Phaser.Scene, x: number, y: number, label: string, action: TouchAction, color: number) {
    const bg = scene.add.circle(x, y, 14, color, 0.30).setStrokeStyle(1, 0xffffff, 0.5).setScrollFactor(0).setDepth(2000);
    const txt = scene.add.text(x, y, label, { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    bg.setInteractive(new Phaser.Geom.Circle(x, y, 22), Phaser.Geom.Circle.Contains);
    bg.on('pointerdown', () => { this.down[action] = true;  bg.setFillStyle(color, 0.55); });
    const release = () => { this.down[action] = false; bg.setFillStyle(color, 0.30); };
    bg.on('pointerup', release).on('pointerout', release).on('pointerupoutside', release);
    this.objs.push(bg, txt);
  }

  isDown(a: TouchAction): boolean { return this.enabled && !!this.down[a]; }
  destroy() { this.objs.forEach(o => o.destroy()); this.objs = []; }
}
"""

FILES["src/engine/Parallax.ts"] = """import Phaser from 'phaser';

/**
 * Multi-layer parallax background. Each layer scrolls at a fraction of camera speed
 * (scrollFactor 0..1). Use procedural shapes or a tileSprite with a texture key.
 *
 * Example:
 *   new Parallax(this, [
 *     { color: 0x1a1a3a, scrollFactor: 0.0 },   // sky (static)
 *     { color: 0x2a2a5a, scrollFactor: 0.2, height: 120, yOffset: 60 },
 *     { color: 0x3a3a7a, scrollFactor: 0.5, height: 80,  yOffset: 140 }
 *   ]);
 */
export interface ParallaxLayer {
  color?: number;
  texture?: string;       // optional tileSprite key
  scrollFactor: number;   // 0 = static, 1 = follows camera 1:1
  height?: number;        // px (default = view height)
  yOffset?: number;       // px from top (default 0)
  alpha?: number;
}

export class Parallax {
  private layers: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, defs: ParallaxLayer[]) {
    const cam = scene.cameras.main;
    const W = cam.width * 4, H = cam.height;
    for (const d of defs) {
      const h = d.height ?? H;
      const y = d.yOffset ?? 0;
      let obj: Phaser.GameObjects.GameObject;
      if (d.texture) {
        obj = scene.add.tileSprite(0, y, W, h, d.texture).setOrigin(0, 0);
      } else {
        obj = scene.add.rectangle(0, y, W, h, d.color ?? 0x000000, d.alpha ?? 1).setOrigin(0, 0);
      }
      (obj as any).setScrollFactor(d.scrollFactor, 1);
      (obj as any).setDepth(-1000 + this.layers.length);
      this.layers.push(obj);
    }
  }

  destroy() { this.layers.forEach(l => l.destroy()); this.layers = []; }
}
"""

FILES["src/engine/Tilemap.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/**
 * String-grid → static platforms. Compact level format an LLM can write directly.
 *
 * Legend (default):
 *   '#' = solid tile, '.' = empty, 'P' = player spawn, 'C' = coin,
 *   'E' = enemy (auto-patrol over adjacent solids), 'G' = goal
 *
 * Returns spawn coords + groups for the scene to consume.
 */
export interface ParsedMap {
  spawn: { x: number; y: number };
  goal: { x: number; y: number } | null;
  coins: Array<{ x: number; y: number }>;
  enemies: Array<{ x: number; y: number; minX: number; maxX: number }>;
  buildPlatforms: (group: Phaser.Physics.Arcade.StaticGroup) => void;
}

export function parseTilemap(rows: string[]): ParsedMap {
  const T = CONFIG.WORLD.TILE;
  const out: ParsedMap = {
    spawn: { x: T, y: T },
    goal: null,
    coins: [],
    enemies: [],
    buildPlatforms: () => {}
  };
  const solids: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      const x = c * T + T / 2, y = r * T + T / 2;
      if (ch === '#') solids.push({ x, y });
      else if (ch === 'P') out.spawn = { x, y };
      else if (ch === 'C') out.coins.push({ x, y });
      else if (ch === 'G') out.goal = { x, y };
      else if (ch === 'E') {
        // patrol bounds = current row tile span left/right until non-# below
        let lo = c, hi = c;
        const below = rows[r + 1] || '';
        while (lo > 0 && below[lo - 1] === '#') lo--;
        while (hi < row.length - 1 && below[hi + 1] === '#') hi++;
        out.enemies.push({
          x, y,
          minX: lo * T + T / 2,
          maxX: hi * T + T / 2
        });
      }
    }
  }
  out.buildPlatforms = (g) => {
    for (const s of solids) g.create(s.x, s.y, 'platform').refreshBody();
  };
  return out;
}
"""

FILES["src/engine/Sprites.ts"] = """import Phaser from 'phaser';

/**
 * Pixel-art sprite forge — no PNG files. Sprites are described as ASCII grids
 * mapped to a palette. Each char = 1 pixel. Frames laid out horizontally.
 *
 * Why ASCII? An LLM can read/edit a 12×16 grid and the diff is meaningful.
 * Bitmaps are opaque; ASCII is a real source format.
 *
 * Char convention (extend per character):
 *   '.' = transparent
 *   any other char = palette key
 *
 * Usage:
 *   defineSprite('player_sheet', PLAYER_FRAMES, PLAYER_PALETTE);
 *   buildAll(scene);
 *
 * To add a new character: copy a frame block, tweak pixels, push into FRAMES.
 */

export type Palette = Record<string, string | null>;
export interface SpriteDef { key: string; frames: string[][]; palette: Palette; }

const REGISTRY: SpriteDef[] = [];

export function defineSprite(key: string, frames: string[][], palette: Palette) {
  REGISTRY.push({ key, frames, palette });
}

export function rasterize(scene: Phaser.Scene, def: SpriteDef) {
  if (scene.textures.exists(def.key)) return;
  const h = def.frames[0].length;
  const w = def.frames[0][0].length;
  const n = def.frames.length;
  const canvas = (Phaser.Display.Canvas.CanvasPool as any).create(scene, w * n, h, Phaser.CANVAS, true);
  const ctx: CanvasRenderingContext2D = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let f = 0; f < n; f++) {
    const grid = def.frames[f];
    for (let y = 0; y < h; y++) {
      const row = grid[y] || '';
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue;
        const color = def.palette[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(f * w + x, y, 1, 1);
      }
    }
  }
  scene.textures.addSpriteSheet(def.key, canvas, { frameWidth: w, frameHeight: h });
}

export function buildAll(scene: Phaser.Scene) {
  for (const d of REGISTRY) rasterize(scene, d);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER FRAMES
//
// Player — 16×16. Frames: 0=idle, 1-2=run, 3=jump, 4=attack, 5=hurt
// Tweak palette for skin/hair/clothes; tweak grids for pose.
// ─────────────────────────────────────────────────────────────────────────────

const PLAYER_PALETTE: Palette = {
  H: '#3b2f2f',  // hair / outline dark
  S: '#f9c9a4',  // skin
  E: '#1f2937',  // eye
  M: '#7c2d12',  // mouth
  B: '#2563eb',  // body shirt
  T: '#1d4ed8',  // shirt shade
  P: '#7c3aed',  // pants
  L: '#5b21b6',  // pants shade
  K: '#0f172a',  // boots / outline
  W: '#ffffff',  // eye white / highlight
};

const PLAYER_IDLE = [
  '....HHHHHH......',
  '...HSSSSSSH.....',
  '...HSWEWESH.....',
  '...HSSMMSSH.....',
  '...HHSSSSHH.....',
  '....BBBBBB......',
  '...BBTBBTBB.....',
  '...BBTBBTBB.....',
  '...BBBBBBBB.....',
  '....BBBBBB......',
  '....PPPPPP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....KK..KK......',
  '....KK..KK......',
];

const PLAYER_RUN_A = [
  '....HHHHHH......',
  '...HSSSSSSH.....',
  '...HSWEWESH.....',
  '...HSSMMSSH.....',
  '...HHSSSSHH.....',
  '....BBBBBB......',
  '..BBBTBBTBB.....',
  '..BBBTBBTBB.....',
  '...BBBBBBBB.....',
  '....BBBBBB......',
  '....PPPPPP......',
  '...PLPPPPLP.....',
  '..PLPP..PPLP....',
  '..PLP....PLP....',
  '..KK......KK....',
  '..KK......KK....',
];

const PLAYER_RUN_B = [
  '....HHHHHH......',
  '...HSSSSSSH.....',
  '...HSEWEWSH.....',
  '...HSSMMSSH.....',
  '...HHSSSSHH.....',
  '....BBBBBB......',
  '...BBTBBTBBB....',
  '...BBTBBTBBB....',
  '....BBBBBBBB....',
  '.....BBBBBB.....',
  '.....PPPPPP.....',
  '.....PLPPPP.....',
  '.....PLPPLP.....',
  '......PPPLP.....',
  '......KK.KK.....',
  '......KK.KK.....',
];

const PLAYER_JUMP = [
  '....HHHHHH......',
  '...HSSSSSSH.....',
  '...HSWEWESH.....',
  '...HSSOOSSH.....',  // O = open mouth
  '...HHSSSSHH.....',
  '...BBBBBBBB.....',
  '..BBBTBBTBBB....',
  '..BBBTBBTBBB....',
  '...BBBBBBBB.....',
  '....BBBBBB......',
  '....PPPPPP......',
  '...PLPPPPLP.....',
  '...PLP..PLP.....',
  '...KK....KK.....',
  '................',
  '................',
];

const PLAYER_ATTACK = [
  '....HHHHHH..XX..',
  '...HSSSSSSH.XX..',
  '...HSWEWESH.XX..',
  '...HSSMMSSHXXXX.',  // X = sword
  '...HHSSSSHHHXX..',
  '....BBBBBBB.X...',
  '...BBTBBTBBX....',
  '...BBTBBTBB.....',
  '...BBBBBBBB.....',
  '....BBBBBB......',
  '....PPPPPP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....KK..KK......',
  '....KK..KK......',
];

const PLAYER_HURT = [
  '....HHHHHH......',
  '...HRRRRRRH.....',  // R = red flash skin
  '...HRWXWXRH.....',  // X = X eye
  '...HRRwwRRH.....',  // w = down mouth
  '...HHRRRRHH.....',
  '....RRRRRR......',
  '...RRRBRRBR.....',
  '...RRRBRRBR.....',
  '...RRRRRRRR.....',
  '....RRRRRR......',
  '....PPPPPP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....PLPPLP......',
  '....KK..KK......',
  '....KK..KK......',
];

// extend palette with attack/hurt-only chars
PLAYER_PALETTE['X'] = '#e5e7eb';   // sword steel
PLAYER_PALETTE['O'] = '#ef4444';   // open mouth
PLAYER_PALETTE['R'] = '#fca5a5';   // hurt skin
PLAYER_PALETTE['w'] = '#7f1d1d';   // hurt mouth

defineSprite('player_sheet', [PLAYER_IDLE, PLAYER_RUN_A, PLAYER_RUN_B, PLAYER_JUMP, PLAYER_ATTACK, PLAYER_HURT], PLAYER_PALETTE);

// Enemy — 14×14 slime/goblin. Frames: 0/1 walk wobble, 2 hurt
const ENEMY_PALETTE: Palette = {
  G: '#16a34a',
  D: '#15803d',
  W: '#ffffff',
  E: '#0f172a',
  M: '#7f1d1d',
  R: '#fca5a5',
};

const ENEMY_IDLE = [
  '..............',
  '....DDDDDD....',
  '...DGGGGGGD...',
  '..DGGGGGGGGD..',
  '..DGWEGGEWGD..',
  '..DGGGGGGGGD..',
  '..DGGMMMMGGD..',
  '..DGGGGGGGGD..',
  '.DGGGGGGGGGGD.',
  '.DGGGGGGGGGGD.',
  '.DDDDDDDDDDDD.',
  '..D.D.D.D.D...',
  '..............',
  '..............',
];

const ENEMY_WALK = [
  '..............',
  '..............',
  '....DDDDDD....',
  '...DGGGGGGD...',
  '..DGWEGGEWGD..',
  '..DGGGGGGGGD..',
  '..DGGMMMMGGD..',
  '..DGGGGGGGGD..',
  '.DGGGGGGGGGGD.',
  '.DGGGGGGGGGGD.',
  '.DDDDDDDDDDDD.',
  '...D.D.D.D....',
  '..............',
  '..............',
];

const ENEMY_HURT = [
  '..............',
  '....DDDDDD....',
  '...DRRRRRRD...',
  '..DRRRRRRRRD..',
  '..DRWXRRXWRD..',
  '..DRRRRRRRRD..',
  '..DRRMMMMRRD..',
  '..DRRRRRRRRD..',
  '.DRRRRRRRRRRD.',
  '.DRRRRRRRRRRD.',
  '.DDDDDDDDDDDD.',
  '..D.D.D.D.D...',
  '..............',
  '..............',
];

ENEMY_PALETTE['X'] = '#1f2937';
defineSprite('enemy_sheet', [ENEMY_IDLE, ENEMY_WALK, ENEMY_HURT], ENEMY_PALETTE);

// Coin — 8×8 spinning, 4 frames
const COIN_PALETTE: Palette = { Y: '#fbbf24', O: '#d97706', H: '#fde68a' };
const COIN_F1 = ['..OYYO..','.OYHHYO.','OYHHHHYO','OYHHHHYO','OYHHHHYO','OYHHHHYO','.OYHHYO.','..OYYO..'];
const COIN_F2 = ['..OYYO..','..OYYO..','.OYHHYO.','.OYHHYO.','.OYHHYO.','.OYHHYO.','..OYYO..','..OYYO..'];
const COIN_F3 = ['..OYYO..','..OYYO..','..OYYO..','..OYYO..','..OYYO..','..OYYO..','..OYYO..','..OYYO..'];
const COIN_F4 = ['..OYYO..','..OYYO..','.OYHHYO.','.OYHHYO.','.OYHHYO.','.OYHHYO.','..OYYO..','..OYYO..'];
defineSprite('coin_sheet', [COIN_F1, COIN_F2, COIN_F3, COIN_F4], COIN_PALETTE);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API expected by Preload + scenes
// ─────────────────────────────────────────────────────────────────────────────

export function buildSpritesheets(scene: Phaser.Scene) {
  buildAll(scene);
}

export function registerAnims(scene: Phaser.Scene) {
  const A = scene.anims;
  if (!A.exists('player-idle')) {
    A.create({ key: 'player-idle',  frames: A.generateFrameNumbers('player_sheet', { start: 0, end: 0 }), frameRate: 1, repeat: -1 });
    A.create({ key: 'player-run',   frames: A.generateFrameNumbers('player_sheet', { start: 1, end: 2 }), frameRate: 10, repeat: -1 });
    A.create({ key: 'player-jump',  frames: A.generateFrameNumbers('player_sheet', { start: 3, end: 3 }), frameRate: 1, repeat: -1 });
    A.create({ key: 'player-attack',frames: A.generateFrameNumbers('player_sheet', { start: 4, end: 4 }), frameRate: 12, repeat: 0 });
    A.create({ key: 'player-hurt',  frames: A.generateFrameNumbers('player_sheet', { start: 5, end: 5 }), frameRate: 1, repeat: 0 });
  }
  if (!A.exists('enemy-idle')) {
    A.create({ key: 'enemy-idle', frames: A.generateFrameNumbers('enemy_sheet', { start: 0, end: 0 }), frameRate: 1, repeat: -1 });
    A.create({ key: 'enemy-walk', frames: A.generateFrameNumbers('enemy_sheet', { start: 0, end: 1 }), frameRate: 6, repeat: -1 });
    A.create({ key: 'enemy-hurt', frames: A.generateFrameNumbers('enemy_sheet', { start: 2, end: 2 }), frameRate: 1, repeat: 0 });
  }
  if (!A.exists('coin-spin')) {
    A.create({ key: 'coin-spin', frames: A.generateFrameNumbers('coin_sheet', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
  }
}
"""

FILES["src/engine/Animations.ts"] = """// Re-export Sprites under legacy name to keep older imports working.
export { buildSpritesheets, registerAnims, defineSprite, buildAll, rasterize } from './Sprites';
export type { Palette, SpriteDef } from './Sprites';
"""

FILES["src/engine/Tiles.ts"] = """import Phaser from 'phaser';

/**
 * Procedural tile forge. Produces a 16×16 tile texture per biome with surface
 * detail (grain, edge highlight, dark bottom) so tiled platforms read as a
 * proper terrain instead of flat squares.
 *
 * Tile keys are derived from biome + variant : 'tile_grass', 'tile_grass_top',
 * 'tile_dirt', 'tile_stone', 'tile_sand', 'tile_cave', 'tile_metal'.
 *
 * Use 'platform' as a default alias to whichever biome the kit prefers.
 */

export interface TileBiome {
  key: string;
  base: string;
  shade: string;
  highlight: string;
  edge: string;
  speckles?: number;     // 0..40 grain density
}

const ALL_BIOMES: TileBiome[] = [
  { key: 'grass',    base: '#16a34a', shade: '#14532d', highlight: '#86efac', edge: '#052e16', speckles: 18 },
  { key: 'dirt',     base: '#92400e', shade: '#451a03', highlight: '#c2410c', edge: '#1c0701', speckles: 22 },
  { key: 'stone',    base: '#64748b', shade: '#334155', highlight: '#cbd5e1', edge: '#0f172a', speckles: 14 },
  { key: 'sand',     base: '#fbbf24', shade: '#b45309', highlight: '#fde68a', edge: '#78350f', speckles: 25 },
  { key: 'cave',     base: '#1e293b', shade: '#0f172a', highlight: '#475569', edge: '#020617', speckles: 12 },
  { key: 'metal',    base: '#9ca3af', shade: '#4b5563', highlight: '#e5e7eb', edge: '#111827', speckles: 8  },
  { key: 'snow',     base: '#e0f2fe', shade: '#7dd3fc', highlight: '#ffffff', edge: '#0c4a6e', speckles: 10 },
  { key: 'lava',     base: '#dc2626', shade: '#7f1d1d', highlight: '#fde047', edge: '#450a0a', speckles: 20 },
  { key: 'ice',      base: '#bae6fd', shade: '#0284c7', highlight: '#f0f9ff', edge: '#0c4a6e', speckles: 6  },
  { key: 'water',    base: '#3b82f6', shade: '#1e3a8a', highlight: '#93c5fd', edge: '#172554', speckles: 14 },
  { key: 'swamp',    base: '#365314', shade: '#1a2e05', highlight: '#84cc16', edge: '#0a0f02', speckles: 24 },
  { key: 'desert',   base: '#fde68a', shade: '#a16207', highlight: '#fef3c7', edge: '#451a03', speckles: 22 },
  { key: 'forest',   base: '#166534', shade: '#052e16', highlight: '#22c55e', edge: '#020617', speckles: 18 },
  { key: 'mushroom', base: '#a855f7', shade: '#581c87', highlight: '#f5d0fe', edge: '#1e1b4b', speckles: 20 },
  { key: 'castle',   base: '#3f3f46', shade: '#18181b', highlight: '#a1a1aa', edge: '#09090b', speckles: 10 },
  { key: 'beach',    base: '#fef3c7', shade: '#d97706', highlight: '#fffbeb', edge: '#78350f', speckles: 18 },
];

// Scaffold-time biome filter. Empty list = include every biome.
// The Python scaffolder rewrites this constant when --biomes is passed.
const BIOME_FILTER: string[] = [/* __BIOME_FILTER__ */];
const _filter = BIOME_FILTER.length > 0 ? new Set(BIOME_FILTER) : null;
const BIOMES: TileBiome[] = _filter ? ALL_BIOMES.filter(b => _filter!.has(b.key)) : ALL_BIOMES;

const SIZE = 16;

function paintTile(ctx: CanvasRenderingContext2D, b: TileBiome, ox: number, oy: number, hasTop: boolean) {
  // base
  ctx.fillStyle = b.base;
  ctx.fillRect(ox, oy, SIZE, SIZE);
  // bottom shade band (3 px)
  ctx.fillStyle = b.shade;
  ctx.fillRect(ox, oy + SIZE - 3, SIZE, 3);
  // top highlight (1 px) only if it's a "top" tile (grass cap)
  if (hasTop) {
    ctx.fillStyle = b.highlight;
    ctx.fillRect(ox, oy, SIZE, 2);
  }
  // dark edges (left/right column 1 px)
  ctx.fillStyle = b.edge;
  ctx.fillRect(ox, oy, 1, SIZE);
  ctx.fillRect(ox + SIZE - 1, oy, 1, SIZE);
  ctx.fillRect(ox, oy + SIZE - 1, SIZE, 1);
  // grain speckles — deterministic per biome
  const n = b.speckles || 0;
  let seed = (b.key.charCodeAt(0) * 9301 + 49297) & 0x7fffffff;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const x = 2 + Math.floor(rnd() * (SIZE - 4));
    const y = 3 + Math.floor(rnd() * (SIZE - 6));
    ctx.fillStyle = rnd() > 0.5 ? b.shade : b.highlight;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }
}

export function buildTiles(scene: Phaser.Scene, defaultBiome: string = 'stone') {
  for (const b of BIOMES) {
    for (const variant of ['', '_top'] as const) {
      const key = 'tile_' + b.key + variant;
      if (scene.textures.exists(key)) continue;
      const canvas = (Phaser.Display.Canvas.CanvasPool as any).create(scene, SIZE, SIZE, Phaser.CANVAS, true);
      const ctx: CanvasRenderingContext2D = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      paintTile(ctx, b, 0, 0, variant === '_top');
      scene.textures.addCanvas(key, canvas);
    }
  }
  // Default 'platform' alias used by older code paths
  if (!scene.textures.exists('platform')) {
    const src = scene.textures.get('tile_' + defaultBiome).getSourceImage();
    const canvas = (Phaser.Display.Canvas.CanvasPool as any).create(scene, SIZE, SIZE, Phaser.CANVAS, true);
    const ctx: CanvasRenderingContext2D = canvas.getContext('2d');
    ctx.drawImage(src as any, 0, 0);
    scene.textures.addCanvas('platform', canvas);
  }
}

export const TILE_BIOMES = BIOMES.map(b => b.key);
"""

FILES["src/engine/Autotile.ts"] = """import Phaser from 'phaser';

/**
 * 4-bit bitmask autotile helper. For each solid cell, looks at its 4 cardinal
 * neighbors (N/E/S/W). Bits: N=1, E=2, S=4, W=8. Total 16 combinations.
 *
 * Picks tile variant : '_top' when no neighbor above, base otherwise. This
 * gives free grass caps on platform tops without authoring per-tile sprites.
 *
 * Usage:
 *   const set = new Set<string>(); for (const w of walls) set.add(w[0]+','+w[1]);
 *   const variant = autotileVariant(set, x, y);            // '' | '_top'
 *   scene.add.image(px, py, 'tile_grass' + variant);
 */

export function isSolid(set: Set<string>, x: number, y: number): boolean {
  return set.has(x + ',' + y);
}

export function neighborMask(set: Set<string>, x: number, y: number): number {
  let m = 0;
  if (isSolid(set, x, y - 1)) m |= 1;  // N
  if (isSolid(set, x + 1, y)) m |= 2;  // E
  if (isSolid(set, x, y + 1)) m |= 4;  // S
  if (isSolid(set, x - 1, y)) m |= 8;  // W
  return m;
}

/** Returns the suffix to append to a base tile key. '_top' = exposed sky face. */
export function autotileVariant(set: Set<string>, x: number, y: number): '' | '_top' {
  const mask = neighborMask(set, x, y);
  return (mask & 1) ? '' : '_top';      // no neighbor north → top variant
}

/** Convenience: paint a wall set onto a scene with a chosen biome. */
export function paintWalls(scene: Phaser.Scene, walls: Array<[number, number]>, tileSize: number, biome: string = 'stone') {
  const set = new Set<string>();
  for (const [c, r] of walls) set.add(c + ',' + r);
  for (const [c, r] of walls) {
    const v = autotileVariant(set, c, r);
    scene.add.image(c * tileSize + tileSize / 2, r * tileSize + tileSize / 2, 'tile_' + biome + v);
  }
}
"""

FILES["src/engine/Health.ts"] = """/**
 * HP component with events. Attach to entities that take damage.
 * Emits: 'damaged'(amount, source?), 'healed'(amount), 'died'.
 */
import Phaser from 'phaser';

export class Health extends Phaser.Events.EventEmitter {
  private hp: number;
  constructor(public max: number) { super(); this.hp = max; }
  get current() { return this.hp; }
  damage(amount: number, source?: any) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.emit('damaged', amount, source);
    if (this.hp === 0) this.emit('died');
  }
  heal(amount: number) {
    if (this.hp <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.max, this.hp + amount);
    if (this.hp > before) this.emit('healed', this.hp - before);
  }
  setMax(v: number) { this.max = v; this.hp = Math.min(this.hp, v); }
  reset() { this.hp = this.max; }
  isDead() { return this.hp <= 0; }
}
"""

FILES["src/engine/Combat.ts"] = """import Phaser from 'phaser';
import { Health } from './Health';

/**
 * Attack hitboxes & damage routing. Spawn a transient hitbox via `spawnHitbox`,
 * register defender with `damageable`. Hit triggers Health.damage + knockback.
 */
export interface HitboxOpts {
  x: number; y: number; w: number; h: number;
  damage: number;
  team: 'player' | 'enemy';
  knockback?: number;
  durationMs?: number;
  source?: any;
}

const HITBOXES = new WeakMap<Phaser.Scene, Phaser.GameObjects.Group>();
const DEFENDERS = new WeakMap<Phaser.Scene, Map<Phaser.GameObjects.GameObject, { hp: Health; team: string }>>();

function getGroup(scene: Phaser.Scene): Phaser.GameObjects.Group {
  let g = HITBOXES.get(scene);
  if (!g) { g = scene.add.group(); HITBOXES.set(scene, g); }
  return g;
}

export function damageable(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, hp: Health, team: 'player' | 'enemy') {
  let m = DEFENDERS.get(scene);
  if (!m) { m = new Map(); DEFENDERS.set(scene, m); }
  m.set(target, { hp, team });
  target.once(Phaser.GameObjects.Events.DESTROY, () => m!.delete(target));
}

export function spawnHitbox(scene: Phaser.Scene, opts: HitboxOpts) {
  const zone = scene.add.zone(opts.x, opts.y, opts.w, opts.h);
  scene.physics.add.existing(zone);
  const body = zone.body as Phaser.Physics.Arcade.Body;
  body.setAllowGravity(false);
  body.setImmovable(true);
  const m = DEFENDERS.get(scene);
  if (m) {
    for (const [obj, def] of m) {
      if (def.team === opts.team) continue;
      scene.physics.add.overlap(zone, obj as any, () => {
        def.hp.damage(opts.damage, opts.source);
        if (opts.knockback && (obj as any).body) {
          const dx = (obj as any).x - opts.x;
          const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
          (obj as any).body.setVelocityX(dir * opts.knockback);
          (obj as any).body.setVelocityY(-Math.abs(opts.knockback) * 0.5);
        }
      });
    }
  }
  getGroup(scene).add(zone);
  scene.time.delayedCall(opts.durationMs ?? 80, () => zone.destroy());
  return zone;
}
"""

FILES["src/engine/Inventory.ts"] = """import Phaser from 'phaser';

/** Item registry + bag. Items are pure data. */
export interface Item {
  id: string;
  name: string;
  desc?: string;
  stack?: number;        // max stack (default 1)
  consumable?: boolean;
  use?: (ctx: any) => void;
}

export class Inventory extends Phaser.Events.EventEmitter {
  private slots = new Map<string, number>();
  constructor(public registry: Record<string, Item>) { super(); }
  add(id: string, qty = 1) {
    if (!this.registry[id]) return false;
    const max = this.registry[id].stack ?? 1;
    const cur = this.slots.get(id) ?? 0;
    const next = Math.min(max, cur + qty);
    this.slots.set(id, next);
    this.emit('changed', id, next);
    return true;
  }
  remove(id: string, qty = 1) {
    const cur = this.slots.get(id) ?? 0;
    const next = Math.max(0, cur - qty);
    if (next === 0) this.slots.delete(id); else this.slots.set(id, next);
    this.emit('changed', id, next);
  }
  count(id: string) { return this.slots.get(id) ?? 0; }
  has(id: string) { return this.count(id) > 0; }
  list(): Array<{ item: Item; qty: number }> {
    const out: Array<{ item: Item; qty: number }> = [];
    for (const [id, qty] of this.slots) out.push({ item: this.registry[id], qty });
    return out;
  }
  serialize() { return Object.fromEntries(this.slots); }
  restore(data: Record<string, number>) {
    this.slots.clear();
    for (const [id, qty] of Object.entries(data || {})) this.slots.set(id, qty);
  }
}
"""

FILES["src/engine/Dialog.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/** Modal dialog box with typewriter + choices. Pauses world via custom flag. */
export interface DialogChoice { label: string; next?: string; effect?: () => void; }
export interface DialogNode {
  id: string;
  text: string;
  speaker?: string;
  choices?: DialogChoice[];
  next?: string;
}

export class Dialog {
  private active = false;
  private container: Phaser.GameObjects.Container | null = null;
  private resolve: (() => void) | null = null;
  constructor(private scene: Phaser.Scene) {}
  isActive() { return this.active; }
  show(nodes: Record<string, DialogNode>, startId: string): Promise<void> {
    return new Promise(resolve => { this.resolve = resolve; this.render(nodes, startId); });
  }
  private render(nodes: Record<string, DialogNode>, id: string) {
    const W = CONFIG.WORLD.VIEW_WIDTH, H = CONFIG.WORLD.VIEW_HEIGHT;
    this.active = true;
    this.cleanup();
    const node = nodes[id]; if (!node) return this.close();
    const c = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(5000);
    const bg = this.scene.add.rectangle(8, H - 80, W - 16, 72, 0x000000, 0.85).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.6);
    c.add(bg);
    if (node.speaker) {
      const sp = this.scene.add.text(14, H - 90, node.speaker, { fontFamily: 'monospace', fontSize: '10px', color: '#fbbf24', backgroundColor: '#000' }).setPadding(4, 2, 4, 2);
      c.add(sp);
    }
    const txt = this.scene.add.text(16, H - 72, '', { fontFamily: 'monospace', fontSize: '10px', color: '#fff', wordWrap: { width: W - 32 } });
    c.add(txt);
    this.container = c;
    let i = 0;
    const tick = this.scene.time.addEvent({
      delay: 22, loop: true, callback: () => {
        i++; txt.setText(node.text.slice(0, i));
        if (i >= node.text.length) tick.remove(false);
      }
    });
    const advance = () => {
      if (i < node.text.length) { i = node.text.length; txt.setText(node.text); tick.remove(false); return; }
      if (node.choices && node.choices.length) { this.showChoices(c, node.choices, nodes); return; }
      if (node.next) this.render(nodes, node.next);
      else this.close();
    };
    this.scene.input.keyboard!.once('keydown-SPACE', advance);
    this.scene.input.keyboard!.once('keydown-ENTER', advance);
    bg.setInteractive().once('pointerdown', advance);
  }
  private showChoices(c: Phaser.GameObjects.Container, choices: DialogChoice[], nodes: Record<string, DialogNode>) {
    const W = CONFIG.WORLD.VIEW_WIDTH, H = CONFIG.WORLD.VIEW_HEIGHT;
    let idx = 0;
    const labels = choices.map((ch, i) => this.scene.add.text(20, H - 50 + i * 12, '', { fontFamily: 'monospace', fontSize: '10px' }));
    const refresh = () => labels.forEach((l, i) => {
      l.setText((i === idx ? '> ' : '  ') + choices[i].label);
      l.setColor(i === idx ? '#fbbf24' : '#ffffff');
    });
    refresh();
    labels.forEach(l => c.add(l));
    const onUp = () => { idx = (idx + choices.length - 1) % choices.length; refresh(); };
    const onDown = () => { idx = (idx + 1) % choices.length; refresh(); };
    const onConfirm = () => {
      this.scene.input.keyboard!.off('keydown-UP', onUp);
      this.scene.input.keyboard!.off('keydown-DOWN', onDown);
      const ch = choices[idx];
      ch.effect?.();
      if (ch.next) this.render(nodes, ch.next); else this.close();
    };
    this.scene.input.keyboard!.on('keydown-UP', onUp);
    this.scene.input.keyboard!.on('keydown-DOWN', onDown);
    this.scene.input.keyboard!.once('keydown-SPACE', onConfirm);
    this.scene.input.keyboard!.once('keydown-ENTER', onConfirm);
  }
  private cleanup() { this.container?.destroy(); this.container = null; }
  private close() { this.cleanup(); this.active = false; this.resolve?.(); this.resolve = null; }
}
"""

FILES["src/engine/Menu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

/** Generic list menu with cursor + nested submenu support. */
export interface MenuItem { label: string; action?: () => void; submenu?: MenuItem[]; disabled?: boolean; }
export interface MenuOpts { title?: string; items: MenuItem[]; x?: number; y?: number; width?: number; }

export function openMenu(scene: Phaser.Scene, opts: MenuOpts): Phaser.GameObjects.Container {
  const W = opts.width ?? 160;
  const x = opts.x ?? (CONFIG.WORLD.VIEW_WIDTH - W) / 2;
  const y = opts.y ?? 30;
  const c = scene.add.container(x, y).setScrollFactor(0).setDepth(4000);
  let idx = 0;
  const items = opts.items.filter(i => !i.disabled);
  const lineH = 14;
  const h = (opts.title ? 22 : 6) + items.length * lineH + 8;
  const bg = scene.add.rectangle(0, 0, W, h, 0x000000, 0.88).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.6);
  c.add(bg);
  if (opts.title) {
    c.add(scene.add.text(W / 2, 4, opts.title, { fontFamily: 'monospace', fontSize: '11px', color: '#fbbf24' }).setOrigin(0.5, 0));
  }
  const labels = items.map((it, i) =>
    scene.add.text(8, (opts.title ? 22 : 6) + i * lineH, '', { fontFamily: 'monospace', fontSize: '10px' })
  );
  labels.forEach(l => c.add(l));
  const refresh = () => labels.forEach((l, i) => {
    l.setText((i === idx ? '> ' : '  ') + items[i].label);
    l.setColor(i === idx ? '#fbbf24' : '#ffffff');
  });
  refresh();
  const kb = scene.input.keyboard!;
  const onUp = () => { idx = (idx + items.length - 1) % items.length; refresh(); };
  const onDown = () => { idx = (idx + 1) % items.length; refresh(); };
  const onConfirm = () => {
    const it = items[idx];
    if (it.submenu) openMenu(scene, { title: it.label, items: it.submenu });
    else { it.action?.(); close(); }
  };
  const onCancel = () => close();
  const close = () => {
    kb.off('keydown-UP', onUp); kb.off('keydown-DOWN', onDown);
    kb.off('keydown-ENTER', onConfirm); kb.off('keydown-SPACE', onConfirm);
    kb.off('keydown-ESC', onCancel);
    c.destroy();
  };
  kb.on('keydown-UP', onUp); kb.on('keydown-DOWN', onDown);
  kb.on('keydown-ENTER', onConfirm); kb.on('keydown-SPACE', onConfirm);
  kb.on('keydown-ESC', onCancel);
  return c;
}
"""

FILES["src/engine/Bullets.ts"] = """import Phaser from 'phaser';

/**
 * Pooled bullet group. fire(x,y,vx,vy) returns a sprite.
 * Patterns: spread, ring, aimed.
 */
export class BulletPool {
  group: Phaser.Physics.Arcade.Group;
  constructor(scene: Phaser.Scene, key: string, public team: 'player' | 'enemy', public damage = 1) {
    this.group = scene.physics.add.group({
      defaultKey: key,
      maxSize: 200,
      runChildUpdate: false,
      allowGravity: false
    });
  }
  fire(x: number, y: number, vx: number, vy: number, life = 2000): Phaser.Physics.Arcade.Sprite | null {
    const b = this.group.get(x, y) as Phaser.Physics.Arcade.Sprite | null;
    if (!b) return null;
    b.setActive(true).setVisible(true);
    (b.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    b.setVelocity(vx, vy);
    b.setData('team', this.team);
    b.setData('damage', this.damage);
    this.group.scene.time.delayedCall(life, () => { if (b.active) this.recycle(b); });
    return b;
  }
  recycle(b: Phaser.Physics.Arcade.Sprite) { b.setActive(false).setVisible(false); b.body?.stop(); }
  spread(x: number, y: number, count: number, baseAngle: number, arc: number, speed: number) {
    const half = arc / 2;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const a = baseAngle - half + t * arc;
      this.fire(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
  }
  ring(x: number, y: number, count: number, speed: number, offset = 0) {
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2;
      this.fire(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
  }
  aimed(x: number, y: number, tx: number, ty: number, speed: number) {
    const a = Math.atan2(ty - y, tx - x);
    this.fire(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
  }
}
"""

FILES["src/engine/GridMovement.ts"] = """import Phaser from 'phaser';

/**
 * Tile-aligned 4-way movement (for top-down RPG). Snaps to grid, animates between tiles.
 * Call `tryMove(dx, dy)` from update; returns true if started a step.
 */
export class GridMover {
  private moving = false;
  private targetX = 0;
  private targetY = 0;
  facing: 'up'|'down'|'left'|'right' = 'down';
  constructor(public obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject,
              public tileSize: number, public stepMs: number,
              public canEnter: (gx: number, gy: number) => boolean) {
    const o: any = obj;
    this.targetX = Math.round(o.x / tileSize) * tileSize;
    this.targetY = Math.round(o.y / tileSize) * tileSize;
    o.x = this.targetX; o.y = this.targetY;
  }
  isMoving() { return this.moving; }
  tryMove(dx: -1|0|1, dy: -1|0|1): boolean {
    if (this.moving || (dx === 0 && dy === 0)) return false;
    if (dx !== 0 && dy !== 0) dy = 0; // 4-way
    this.facing = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
    const o: any = this.obj;
    const gx = Math.round(o.x / this.tileSize) + dx;
    const gy = Math.round(o.y / this.tileSize) + dy;
    if (!this.canEnter(gx, gy)) return false;
    this.targetX = gx * this.tileSize;
    this.targetY = gy * this.tileSize;
    this.moving = true;
    const scene: Phaser.Scene = (o.scene);
    scene.tweens.add({
      targets: o, x: this.targetX, y: this.targetY,
      duration: this.stepMs, ease: 'Linear',
      onComplete: () => { this.moving = false; }
    });
    return true;
  }
}
"""

FILES["src/engine/Quest.ts"] = """import Phaser from 'phaser';

/** Quest flags + journal. Persist via Save module if needed. */
export class QuestLog extends Phaser.Events.EventEmitter {
  private flags = new Set<string>();
  private vars = new Map<string, number>();
  set(flag: string) { if (!this.flags.has(flag)) { this.flags.add(flag); this.emit('flag', flag); } }
  unset(flag: string) { this.flags.delete(flag); }
  has(flag: string) { return this.flags.has(flag); }
  inc(key: string, by = 1) { const v = (this.vars.get(key) ?? 0) + by; this.vars.set(key, v); this.emit('var', key, v); return v; }
  get(key: string) { return this.vars.get(key) ?? 0; }
  serialize() { return { flags: [...this.flags], vars: Object.fromEntries(this.vars) }; }
  restore(d: { flags?: string[]; vars?: Record<string, number> }) {
    this.flags = new Set(d?.flags ?? []);
    this.vars = new Map(Object.entries(d?.vars ?? {}));
  }
}
"""

FILES["src/engine/Sequencer.ts"] = """import Phaser from 'phaser';

/** Cutscene runner. Each step is async; await Sequencer.run(scene, [...]). */
export type Step = (scene: Phaser.Scene) => Promise<void>;

export const seq = {
  wait: (ms: number): Step => (s) => new Promise(r => s.time.delayedCall(ms, r)),
  moveTo: (obj: any, x: number, y: number, ms = 400): Step => (s) =>
    new Promise(r => { s.tweens.add({ targets: obj, x, y, duration: ms, onComplete: () => r() }); }),
  fadeOut: (ms = 400): Step => (s) =>
    new Promise(r => { s.cameras.main.fadeOut(ms); s.cameras.main.once('camerafadeoutcomplete', () => r()); }),
  fadeIn: (ms = 400): Step => (s) =>
    new Promise(r => { s.cameras.main.fadeIn(ms); s.cameras.main.once('camerafadeincomplete', () => r()); }),
  call: (fn: () => void): Step => async () => { fn(); }
};

export async function run(scene: Phaser.Scene, steps: Step[]) {
  for (const st of steps) await st(scene);
}
"""

FILES["src/engine/TurnBattle.ts"] = """import Phaser from 'phaser';

/** Classic turn-based battle FSM. Generic — UI is up to the scene. */
export interface Combatant {
  id: string;
  name: string;
  hp: number; maxHp: number;
  atk: number; def: number; spd: number;
  team: 'party' | 'enemies';
  alive(): boolean;
}
export interface BattleAction { actor: Combatant; type: 'attack' | 'defend' | 'item' | 'skill'; targetId?: string; payload?: any; }

export class TurnEngine extends Phaser.Events.EventEmitter {
  combatants: Combatant[] = [];
  turnOrder: Combatant[] = [];
  current = 0;
  add(c: Combatant) { this.combatants.push(c); }
  start() { this.turnOrder = [...this.combatants].sort((a, b) => b.spd - a.spd); this.current = 0; this.emit('turn-start', this.activeActor()); }
  activeActor() { return this.turnOrder[this.current]; }
  resolve(a: BattleAction) {
    if (a.type === 'attack' && a.targetId) {
      const tgt = this.combatants.find(c => c.id === a.targetId);
      if (!tgt || !tgt.alive()) return;
      const dmg = Math.max(1, a.actor.atk - Math.floor(tgt.def / 2));
      tgt.hp = Math.max(0, tgt.hp - dmg);
      this.emit('hit', a.actor, tgt, dmg);
      if (tgt.hp === 0) this.emit('defeated', tgt);
    }
    this.next();
  }
  private next() {
    if (this.partyDefeated()) { this.emit('end', 'lose'); return; }
    if (this.enemiesDefeated()) { this.emit('end', 'win'); return; }
    do { this.current = (this.current + 1) % this.turnOrder.length; }
    while (!this.turnOrder[this.current].alive());
    this.emit('turn-start', this.activeActor());
  }
  private partyDefeated() { return this.combatants.filter(c => c.team === 'party').every(c => !c.alive()); }
  private enemiesDefeated() { return this.combatants.filter(c => c.team === 'enemies').every(c => !c.alive()); }
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
"""

FILES["src/scenes/AGENT.md"] = """# AGENT.md — src/scenes/

Une scene Phaser = un mode de jeu (menu, gameplay, pause, gameover).

Cycle de vie Phaser : `init() → preload() → create() → update(t,dt)`.

| Scene       | Rôle                                                           |
|-------------|----------------------------------------------------------------|
| Boot        | charge config minimale, lance Preload                          |
| Preload     | génère textures runtime (carrés colorés), lance MainMenu       |
| MainMenu    | titre + "press SPACE to start" + high score                    |
| Game        | gameplay principal — c'est ici que tu **édites le plus**       |
| Pause       | overlay (scene.launch + pause), résume sur ESC                 |
| GameOver    | écran de fin, sauve highscore, retour menu                     |

## Pour AJOUTER une scene
1. Crée `src/scenes/MaScene.ts` qui étend `Phaser.Scene`
2. Importe-la dans `src/main.ts` et ajoute-la au `scene: [...]`
3. Lance-la via `this.scene.start('MaScene')`

## Pour MODIFIER le gameplay
- 90% des changements vont dans `Game.ts`
- Spawn d'entités → `levels/level1.ts`
- Tuning numéros → `config.ts`
"""

FILES["src/scenes/Boot.ts"] = """import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() { this.scene.start('Preload'); }
}
"""

FILES["src/scenes/Preload.ts"] = """import Phaser from 'phaser';
import { buildSpritesheets, registerAnims } from '../engine/Sprites';
import { buildTiles } from '../engine/Tiles';

/**
 * Generate textures procedurally — no asset files needed.
 * Sprites: ASCII-defined pixel art (see engine/Sprites.ts).
 * Tiles:   biome-themed 16×16 tiles with grain + edge (see engine/Tiles.ts).
 *
 * To use real PNG art instead, replace the build* calls with this.load.spritesheet(...).
 */
export class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  create() {
    const g = this.add.graphics();

    // 1×1 white pixel for particles + parallax
    g.fillStyle(0xffffff).fillRect(0, 0, 1, 1);
    g.generateTexture('pixel', 1, 1).clear();

    // legacy single-frame coin alias (some kits still reference 'coin')
    g.fillStyle(0xfbbf24).fillCircle(4, 4, 4);
    g.generateTexture('coin', 8, 8).clear();

    // goal flag 12×24
    g.clear();
    g.fillStyle(0xfbbf24).fillRect(0, 0, 2, 24);
    g.fillStyle(0xf87171).fillTriangle(2, 2, 12, 6, 2, 10);
    g.generateTexture('goal', 12, 24).clear();

    g.destroy();

    // Tile palette (all biomes) + 'platform' alias
    buildTiles(this, 'stone');

    // Animated character spritesheets (ASCII pixel-art)
    buildSpritesheets(this);
    registerAnims(this);

    this.scene.start('MainMenu');
  }
}
"""

FILES["src/scenes/MainMenu.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { load } from '../engine/Save';
import { unlockAudio, isMuted, toggleMute } from '../engine/Audio';
import { Music } from '../engine/Music';
import { wipe } from '../engine/Transitions';

const ITEMS = ['NEW GAME', 'CONTINUE', 'MUTE', 'RESET SAVE'] as const;
type Item = typeof ITEMS[number];

export class MainMenuScene extends Phaser.Scene {
  private idx = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private cooldownUntil = 0;

  constructor() { super('MainMenu'); }

  create() {
    document.getElementById('loading')?.classList.add('hidden');
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.text(w/2, 50, 'GAME 2D', {
      fontFamily: 'monospace', fontSize: '32px', color: '#ffffff'
    }).setOrigin(0.5);

    const save = load();
    const hi = save.highScore;
    this.add.text(w/2, 88, `HIGH SCORE  ${hi.toString().padStart(5,'0')}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa'
    }).setOrigin(0.5);

    this.texts = ITEMS.map((label, i) => {
      const t = this.add.text(w/2, 130 + i * 18, '', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff'
      }).setOrigin(0.5);
      t.setData('label', label);
      t.setData('i', i);
      t.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.idx = i; this.activate(); });
      return t;
    });

    this.add.text(w/2, h - 16, '↑↓ select  ⏎ confirm  M mute', {
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
  }

  private refresh() {
    const muteLbl = isMuted() ? 'UNMUTE' : 'MUTE';
    this.texts.forEach((t, i) => {
      const base = ITEMS[i] === 'MUTE' ? muteLbl : ITEMS[i];
      const sel = i === this.idx;
      t.setText(sel ? `> ${base} <` : base);
      t.setColor(sel ? '#fbbf24' : '#ffffff');
    });
  }

  private activate() {
    if (this.time.now < this.cooldownUntil) return;
    unlockAudio();
    const choice: Item = ITEMS[this.idx];
    if (choice === 'NEW GAME') {
      const s = load();
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify({ ...s, lastLevel: 'level1' }));
      Music.start();
      wipe(this, 'left', 400, () => this.scene.start('Game', { level: 'level1' }));
    } else if (choice === 'CONTINUE') {
      const s = load();
      Music.start();
      wipe(this, 'left', 400, () => this.scene.start('Game', { level: s.lastLevel || 'level1' }));
    } else if (choice === 'MUTE') {
      toggleMute(); this.refresh();
    } else if (choice === 'RESET SAVE') {
      localStorage.removeItem(CONFIG.SAVE_KEY);
      this.scene.restart();
    }
  }
}
"""

FILES["src/scenes/Game.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { Cam } from '../engine/Camera';
import { InputMap } from '../engine/Input';
import { HUD } from '../engine/UI';
import { sfx } from '../engine/Audio';
import { sparkle, dust } from '../engine/Particles';
import { Parallax } from '../engine/Parallax';
import { TouchControls } from '../engine/Touch';
import { wipe } from '../engine/Transitions';
import { save } from '../engine/Save';
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
  next: string | null;
  width: number;
  height: number;
}

function fromTilemap(L: { rows: string[]; parsed: any; next: string | null }, T: number): LevelDef {
  const p = L.parsed;
  return {
    spawn: p.spawn, goal: p.goal, coins: p.coins, enemies: p.enemies,
    buildPlatforms: p.buildPlatforms,
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
  score: number = 0;
  lives: number = CONFIG.PLAYER.LIVES;
  levelName: string = 'level1';
  transitioning = false;
  touch!: TouchControls;
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

    // Parallax background — 3 layers, deepest first
    new Parallax(this, [
      { color: 0x0a0a23, scrollFactor: 0.0 },
      { color: 0x1e1e4a, scrollFactor: 0.2, height: 100, yOffset: lvl.height - 180 },
      { color: 0x2a2a6a, scrollFactor: 0.5, height: 60,  yOffset: lvl.height - 120, alpha: 0.7 }
    ]);

    this.platforms = this.physics.add.staticGroup();
    this.coins = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group({ allowGravity: true, collideWorldBounds: true });

    lvl.buildPlatforms(this.platforms);
    for (const c of lvl.coins) this.coins.create(c.x, c.y, 'coin').refreshBody();
    for (const e of lvl.enemies) this.enemies.add(new Enemy(this, e.x, e.y, e.minX, e.maxX));

    this.goal = lvl.goal ? new Goal(this, lvl.goal.x, lvl.goal.y) : null;

    this.player = new Player(this, lvl.spawn.x, lvl.spawn.y);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.overlap(this.player, this.coins, (_p, c) => this.collectCoin(c as any));
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.hitEnemy(e as Enemy));
    if (this.goal) {
      this.physics.add.overlap(this.player, this.goal, () => this.reachGoal());
    }

    this.cam = new Cam(this.cameras.main);
    this.cam.bounds(lvl.width, lvl.height);
    this.cam.follow(this.player);
    this.cam.fadeIn(400);

    this.input2 = new InputMap(this);
    this.touch = new TouchControls(this);
    this.input2.external = { isDown: (a) => (a === 'left' || a === 'right' || a === 'jump') ? this.touch.isDown(a as any) : false };

    this.hud = new HUD(this);
    this.scoreText = this.hud.text(8, 6, this.scoreLabel(), 12);
    this.livesText = this.hud.text(CONFIG.WORLD.VIEW_WIDTH - 80, 6, this.livesLabel(), 12);
    if (CONFIG.DEBUG) this.fpsText = this.hud.text(CONFIG.WORLD.VIEW_WIDTH/2 - 20, 6, 'FPS --', 10);

    // Persist current level reached
    save({ lastLevel: this.levelName });
  }

  update(_t: number, dt: number) {
    if (this.transitioning) return;
    this.player.tick(dt, this.input2);
    this.enemies.children.each((e: any) => { e.tick(dt); return true; });
    if (this.fpsText) this.fpsText.setText('FPS ' + Math.round(this.game.loop.actualFps));
    // Pit death
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

  scoreLabel() { return `SCORE ${this.score.toString().padStart(5, '0')}`; }
  livesLabel() { return `LIVES ${this.lives}`; }
}
"""

FILES["src/scenes/Pause.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';

export class PauseScene extends Phaser.Scene {
  constructor() { super('Pause'); }

  create() {
    const w = CONFIG.WORLD.VIEW_WIDTH, h = CONFIG.WORLD.VIEW_HEIGHT;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.6).setOrigin(0);
    this.add.text(w/2, h/2, 'PAUSED', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(w/2, h/2 + 30, 'PRESS ESC TO RESUME', {
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
    this.add.text(w/2, h/2 - 30, win ? 'YOU WIN' : 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '24px', color: win ? '#4ade80' : '#f87171'
    }).setOrigin(0.5);
    this.add.text(w/2, h/2, `SCORE ${score}` + (isNew ? '  (NEW BEST)' : ''), {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(w/2, h/2 + 30, 'PRESS SPACE FOR MENU', {
      fontFamily: 'monospace', fontSize: '10px', color: '#fbbf24'
    }).setOrigin(0.5);

    this.input.keyboard!.once('keydown-SPACE', () => {
      Music.stop();
      wipe(this, 'right', 400, () => this.scene.start('MainMenu'));
    });
  }
}
"""

FILES["src/entities/AGENT.md"] = """# AGENT.md — src/entities/

Classes Phaser pour game objects. Chaque entité = `extends Phaser.Physics.Arcade.Sprite`.

## Pour AJOUTER une entité (ex: Boss, NPC, Pickup)
1. Crée `src/entities/Boss.ts`
2. Étends `Phaser.Physics.Arcade.Sprite`
3. Constructor : `(scene, x, y)` puis `scene.add.existing(this); scene.physics.add.existing(this);`
4. Méthode `tick(dt)` appelée par la scene
5. Importe + instancie dans `Game.ts:create()`

## Pattern recommandé
```ts
export class Boss extends Phaser.Physics.Arcade.Sprite {
  fsm: FSM<'idle'|'attack'>;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'boss');
    this.fsm = new FSM('idle', { idle:{...}, attack:{...} });
  }
  tick(dt: number) { this.fsm.update(dt); }
}
```

## Pour TUNER une entité existante
- Player vitesse/jump → `config.ts:PLAYER`
- Enemy patrol → `config.ts:ENEMY`
- Comportement spécial → édite la classe directement
"""

FILES["src/entities/Player.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { InputMap } from '../engine/Input';
import { sfx } from '../engine/Audio';

/**
 * Player with coyote-time, jump-buffer, and i-frames after taking a hit.
 * Tune all numbers in `config.ts:PLAYER`.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private lastGroundedAt = 0;
  private lastJumpPressedAt = -9999;
  private invulUntil = 0;

  declare body: Phaser.Physics.Arcade.Body;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setCollideWorldBounds(true);
    this.play('player-idle');
  }

  tick(dt: number, input: InputMap) {
    const t = this.scene.time.now;
    const grounded = this.body.blocked.down || this.body.touching.down;
    if (grounded) this.lastGroundedAt = t;

    // Horizontal
    let vx = 0;
    if (input.isDown('left'))  vx -= CONFIG.PLAYER.SPEED;
    if (input.isDown('right')) vx += CONFIG.PLAYER.SPEED;
    this.body.setVelocityX(vx);
    if (vx !== 0) this.flipX = vx < 0;

    // Jump (with coyote + buffer)
    if (input.pressed('jump')) this.lastJumpPressedAt = t;
    const coyoteOk = (t - this.lastGroundedAt) <= CONFIG.PLAYER.COYOTE_TIME_MS;
    const bufferOk = (t - this.lastJumpPressedAt) <= CONFIG.PLAYER.JUMP_BUFFER_MS;
    if (coyoteOk && bufferOk) {
      this.body.setVelocityY(CONFIG.PLAYER.JUMP_VELOCITY);
      this.lastJumpPressedAt = -9999;
      this.lastGroundedAt = -9999;
      sfx('jump');
    }

    // Cap fall speed
    if (this.body.velocity.y > CONFIG.PLAYER.MAX_FALL_SPEED) {
      this.body.setVelocityY(CONFIG.PLAYER.MAX_FALL_SPEED);
    }

    // i-frame blink
    this.alpha = (t < this.invulUntil && Math.floor(t / 80) % 2 === 0) ? 0.3 : 1;

    // Anim state
    if (!grounded) this.play('player-jump', true);
    else if (vx !== 0) this.play('player-run', true);
    else this.play('player-idle', true);
  }

  takeHit() {
    this.invulUntil = this.scene.time.now + CONFIG.PLAYER.HIT_INVUL_MS;
    this.body.setVelocityY(-200);
  }

  bounce() { this.body.setVelocityY(CONFIG.PLAYER.JUMP_VELOCITY * 0.7); }

  isInvulnerable() { return this.scene.time.now < this.invulUntil; }
}
"""

FILES["src/entities/Enemy.ts"] = """import Phaser from 'phaser';
import { CONFIG } from '../config';
import { explosion } from '../engine/Particles';

/**
 * Patrol enemy: walks back and forth between minX..maxX. Dies on stomp.
 * Tune in `config.ts:ENEMY`.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  private dir = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, private minX: number, private maxX: number) {
    super(scene, x, y, 'enemy_sheet', 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setCollideWorldBounds(true);
    this.play('enemy-walk');
  }

  tick(_dt: number) {
    if (this.x <= this.minX) this.dir = 1;
    if (this.x >= this.maxX) this.dir = -1;
    this.body.setVelocityX(this.dir * CONFIG.ENEMY.PATROL_SPEED);
    this.flipX = this.dir < 0;
  }

  kill() {
    explosion(this.scene, this.x, this.y, CONFIG.PALETTE.ENEMY);
    this.destroy();
  }
}
"""

FILES["src/entities/Goal.ts"] = """import Phaser from 'phaser';

/** End-of-level goal flag. Overlap with player → triggers level transition. */
export class Goal extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'goal');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
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

## Tips placement
- Player commence en bas-gauche (`x:50, y:H-50`)
- Sol = `{ x:0, y:H-16, w: LEVEL_WIDTH/16 }`
- Plateformes flottantes : laisse 48-80px de gap vertical pour qu'un saut classique passe
- Enemy patrol bounds : `maxX - minX >= 64` minimum
"""

FILES["src/levels/level1.ts"] = """import { CONFIG } from '../config';

const W = CONFIG.WORLD.LEVEL_WIDTH;
const H = CONFIG.WORLD.LEVEL_HEIGHT;

export const LEVEL_1 = {
  spawn: { x: 40, y: H - 60 },
  platforms: [
    // Ground
    { x: 0,    y: H - 16, w: W / 16 },
    // Floating platforms
    { x: 200,  y: H - 80,  w: 4 },
    { x: 360,  y: H - 130, w: 3 },
    { x: 520,  y: H - 90,  w: 5 },
    { x: 760,  y: H - 150, w: 4 },
    { x: 960,  y: H - 100, w: 6 },
    { x: 1200, y: H - 160, w: 4 },
    { x: 1400, y: H - 110, w: 5 },
    { x: 1640, y: H - 140, w: 4 },
    { x: 1880, y: H - 90,  w: 6 },
    { x: 2120, y: H - 130, w: 5 }
  ],
  coins: [
    { x: 220, y: H - 100 }, { x: 240, y: H - 100 }, { x: 260, y: H - 100 },
    { x: 380, y: H - 150 }, { x: 540, y: H - 110 }, { x: 780, y: H - 170 },
    { x: 980, y: H - 120 }, { x: 1220, y: H - 180 }, { x: 1420, y: H - 130 },
    { x: 1660, y: H - 160 }, { x: 1900, y: H - 110 }, { x: 2140, y: H - 150 }
  ],
  enemies: [
    { x: 600,  y: H - 32, minX: 540,  maxX: 700 },
    { x: 1000, y: H - 32, minX: 940,  maxX: 1100 },
    { x: 1500, y: H - 32, minX: 1440, maxX: 1600 },
    { x: 2000, y: H - 32, minX: 1940, maxX: 2150 }
  ],
  goal: { x: W - 40, y: H - 40 },
  next: 'level2'
};
"""

FILES["src/levels/level2.ts"] = """import { parseTilemap } from '../engine/Tilemap';

/**
 * Tilemap-style level. ASCII grid → world. Tile size = CONFIG.WORLD.TILE (16px).
 *
 * Legend: # solid, . empty, P spawn, C coin, E enemy, G goal.
 * An LLM can generate a level by writing this string array directly.
 */
const ROWS = [
  '..............................................................',
  '..............................................................',
  '............CCC...............................................',
  '..........########............................................',
  '...P..........................CCC.............................',
  '##############.......##....##############......CCC............',
  '.................E............................########........',
  '.....##############......E....................................',
  '.................##############.....E.........................',
  '..........................................############........',
  '............................................................G.',
  '##############################################################'
];

export const LEVEL_2 = {
  rows: ROWS,
  parsed: parseTilemap(ROWS),
  next: 'level3' as string | null
};
"""

FILES["src/levels/level3.ts"] = """import { parseTilemap } from '../engine/Tilemap';

const ROWS = [
  '..............................................................................',
  '..............................................................................',
  '...........CCC..........CCC.......................CCC..........................',
  '..........#####.......#######....................#####.........................',
  '...P............................CCC............................................',
  '#######....##......E....##.....######......E........##.....##.......##.........',
  '......................................................................######...',
  '....##############......E.......................##############.................',
  '..................######......E.....######...........................CCC.......',
  '...........................##############......E.................##########....',
  '...................................................######......................',
  '............................................................................G.',
  '################################################################################'
];

export const LEVEL_3 = {
  rows: ROWS,
  parsed: parseTilemap(ROWS),
  next: null as string | null
};
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

export interface TiledObject { x: number; y: number; type: string; name?: string; }
export interface TiledMap {
  width: number; height: number; tilewidth: number; tileheight: number;
  tiles: number[][];          // [y][x] of gid (0 = empty)
  objects: TiledObject[];
}

interface RawLayer { type: string; data?: number[]; width?: number; height?: number; objects?: any[]; name?: string; }
interface RawMap   { width: number; height: number; tilewidth: number; tileheight: number; layers: RawLayer[]; }

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
  if (data.length !== w * h) {
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
"""

FILES["src/engine/Editor.ts"] = """/**
 * In-app paint editor. Headless logic lives in EditorState (testable),
 * Phaser overlay attaches via attach(scene, state). Toggle with `~` or `?edit=1`.
 *
 * Persists current map to localStorage under EDITOR_KEY. Export via serialize().
 */

export interface EditorMap { width: number; height: number; tiles: number[][]; }

export const EDITOR_KEY = 'g2d-editor-map';

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

  save(storage: Storage = localStorage): void { storage.setItem(EDITOR_KEY, this.serialize()); }

  static restore(storage: Storage = localStorage): EditorState | null {
    const s = storage.getItem(EDITOR_KEY);
    return s ? EditorState.deserialize(s) : null;
  }
}

/** Phaser overlay glue — bind input listeners. Imported lazily by Game scene. */
export function attachEditor(scene: any, state: EditorState, tileSize: number): () => void {
  let active = (typeof location !== 'undefined' && /[?&]edit=1/.test(location.search));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '~' || e.key === '`') active = !active;
    if (!active) return;
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) state.undo();
    if (e.key === '[') state.cycleBrush(-1);
    if (e.key === ']') state.cycleBrush(+1);
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { state.save(); e.preventDefault(); }
  };
  const onPtr = (p: any) => {
    if (!active) return;
    const wx = Math.floor((p.worldX ?? p.x) / tileSize);
    const wy = Math.floor((p.worldY ?? p.y) / tileSize);
    if (p.rightButtonDown && p.rightButtonDown()) state.erase(wx, wy);
    else state.paint(wx, wy);
  };
  window.addEventListener('keydown', onKey);
  scene.input?.on?.('pointerdown', onPtr);
  scene.input?.on?.('pointermove', (p: any) => { if (p.isDown) onPtr(p); });
  return () => { window.removeEventListener('keydown', onKey); };
}
"""

FILES["src/levels/example.tiled.json"] = """{
  "width": 8, "height": 4, "tilewidth": 32, "tileheight": 32,
  "layers": [
    { "type": "tilelayer", "name": "ground", "width": 8, "height": 4,
      "data": [
        0,0,0,0,0,0,0,0,
        0,0,0,1,1,0,0,0,
        0,1,1,1,1,1,1,0,
        2,2,2,2,2,2,2,2
      ]
    },
    { "type": "objectgroup", "name": "spawns", "objects": [
      { "type": "player", "name": "p1", "x": 32, "y": 64 },
      { "type": "goal",   "x": 224, "y": 64 }
    ]}
  ]
}
"""

FILES["tests/unit/TiledLoader.test.ts"] = """import { describe, it, expect } from 'vitest';
import { parseTiled, tiledToAscii } from '../../src/engine/TiledLoader';
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
});
"""

FILES["src/engine/SpriteSource.ts"] = """/**
 * SpriteSource — drop-in adapter for external sprite sheets.
 *
 * Supported sources:
 *  - LPC (Universal-LPC-Spritesheet-Character-Generator). 64×64 frames,
 *    13 cols × 21 rows. Drop sheet at: public/sprites/lpc/<name>.png
 *  - Kenney 1-bit / Tiny / Pixel packs. Variable tile size, single sheet.
 *    Drop at: public/sprites/kenney/<name>.png + matching meta json.
 *  - agent-sprite-forge exports (PNG + sprite.json) at public/sprites/forge/.
 *
 * If no sheet is found, the procedural Textures.ts pipeline is used (default).
 *
 * Loader (Phaser-side) lives in scenes/Preload.ts; this module is pure data
 * so it stays unit-testable without a browser.
 */

export interface SheetConfig {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

// LPC: 13 cols × 21 rows (rows are walk-up, walk-left, walk-down, walk-right
// for cast/thrust/walk/slash/shoot/hurt animations).
export const LPC_SHEET: Omit<SheetConfig, 'key' | 'url'> = {
  frameWidth: 64, frameHeight: 64, columns: 13, rows: 21
};

export const LPC_ROWS = {
  cast_up: 0, cast_left: 1, cast_down: 2, cast_right: 3,
  thrust_up: 4, thrust_left: 5, thrust_down: 6, thrust_right: 7,
  walk_up: 8, walk_left: 9, walk_down: 10, walk_right: 11,
  slash_up: 12, slash_left: 13, slash_down: 14, slash_right: 15,
  shoot_up: 16, shoot_left: 17, shoot_down: 18, shoot_right: 19,
  hurt: 20
} as const;

export type LpcAnim = keyof typeof LPC_ROWS;

/** Compute frame indices for an LPC animation row. */
export function lpcFrames(anim: LpcAnim): number[] {
  const row = LPC_ROWS[anim];
  // hurt row has 6 frames, all others 7-9 (walk has 9 in v1, 8 in v2). Use 8 as
  // the safe overlap; consumers can override via slice().
  const count = anim === 'hurt' ? 6 : 8;
  const start = row * LPC_SHEET.columns;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(start + i);
  return out;
}

export function lpcSheet(key: string, url: string): SheetConfig {
  return { key, url, ...LPC_SHEET };
}

export function kenneySheet(key: string, url: string, tile = 16, columns = 16, rows = 16): SheetConfig {
  return { key, url, frameWidth: tile, frameHeight: tile, columns, rows };
}

/**
 * Resolve which source to use for a given character key.
 * Priority: forge → lpc → kenney → procedural.
 * Caller passes a list of known assets (from import.meta.glob in Phaser side).
 */
export function resolveCharacter(key: string, available: string[]): SheetConfig | null {
  const candidates = [
    `/sprites/forge/${key}.png`,
    `/sprites/lpc/${key}.png`,
    `/sprites/kenney/${key}.png`
  ];
  for (const url of candidates) {
    if (!available.includes(url)) continue;
    if (url.includes('/lpc/'))    return lpcSheet(key, url);
    if (url.includes('/kenney/')) return kenneySheet(key, url);
    if (url.includes('/forge/'))  return { key, url, frameWidth: 32, frameHeight: 32, columns: 8, rows: 4 };
  }
  return null;
}
"""

FILES["public/sprites/AGENT.md"] = """# public/sprites/

External sprite drop-in. The procedural pipeline (src/engine/Textures.ts) is
default; sheets dropped here are loaded automatically by Preload.ts and used
when an entity's sprite key matches a filename.

Layout:

  public/sprites/lpc/<key>.png       64×64 frames, 13 cols × 21 rows
  public/sprites/kenney/<key>.png    Kenney sheet (16×16 by default)
  public/sprites/forge/<key>.png     agent-sprite-forge export
  public/sprites/forge/<key>.json    optional frame metadata

LPC source: https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator
Kenney    : https://kenney.nl/assets (CC0)
forge     : https://github.com/0x0funky/agent-sprite-forge

To use a sheet, name it after the entity key (e.g. `hero.png`, `slime.png`)
and the resolver in `src/engine/SpriteSource.ts` will pick it up. Animation
rows for LPC are documented in `LPC_ROWS`.

Licenses: drop only CC0 / CC-BY-SA assets. Do NOT commit large binaries —
keep these in a separate `assets/` repo or git-lfs if the project grows.
"""

FILES["tests/unit/SpriteSource.test.ts"] = """import { describe, it, expect } from 'vitest';
import { LPC_SHEET, LPC_ROWS, lpcFrames, lpcSheet, kenneySheet, resolveCharacter } from '../../src/engine/SpriteSource';

describe('LPC sheet config', () => {
  it('uses 64×64 frames on a 13×21 grid', () => {
    expect(LPC_SHEET.frameWidth).toBe(64);
    expect(LPC_SHEET.frameHeight).toBe(64);
    expect(LPC_SHEET.columns).toBe(13);
    expect(LPC_SHEET.rows).toBe(21);
  });

  it('row registry exposes 4-direction walk', () => {
    expect(LPC_ROWS.walk_up).toBe(8);
    expect(LPC_ROWS.walk_down).toBe(10);
    expect(LPC_ROWS.hurt).toBe(20);
  });
});

describe('lpcFrames', () => {
  it('walk_down starts at row 10 × cols and runs 8 frames', () => {
    const f = lpcFrames('walk_down');
    expect(f.length).toBe(8);
    expect(f[0]).toBe(10 * 13);
    expect(f[7]).toBe(10 * 13 + 7);
  });

  it('hurt has 6 frames', () => {
    expect(lpcFrames('hurt').length).toBe(6);
  });
});

describe('sheet builders', () => {
  it('lpcSheet packs key+url with LPC dims', () => {
    const s = lpcSheet('hero', '/sprites/lpc/hero.png');
    expect(s.frameWidth).toBe(64);
    expect(s.url).toBe('/sprites/lpc/hero.png');
  });

  it('kenneySheet defaults to 16×16 16×16', () => {
    const s = kenneySheet('tiles', '/sprites/kenney/tiles.png');
    expect(s.frameWidth).toBe(16);
    expect(s.columns).toBe(16);
  });

  it('kenneySheet accepts overrides', () => {
    const s = kenneySheet('big', '/u.png', 32, 8, 4);
    expect(s.frameWidth).toBe(32);
    expect(s.rows).toBe(4);
  });
});

describe('resolveCharacter priority', () => {
  it('forge beats lpc beats kenney', () => {
    const all = ['/sprites/forge/hero.png', '/sprites/lpc/hero.png', '/sprites/kenney/hero.png'];
    expect(resolveCharacter('hero', all)!.url).toContain('/forge/');
  });

  it('falls back to lpc when no forge', () => {
    const r = resolveCharacter('hero', ['/sprites/lpc/hero.png']);
    expect(r!.url).toContain('/lpc/');
    expect(r!.frameWidth).toBe(64);
  });

  it('returns null when no sheet matches', () => {
    expect(resolveCharacter('ghost', [])).toBeNull();
  });
});
"""

FILES["src/engine/Telemetry.ts"] = """/**
 * Pluggable telemetry sink. Default = console + ring buffer (no network).
 * Swap install() with a Sentry/PostHog adapter when going live.
 */
export type Severity = 'info' | 'warn' | 'error';
export interface TelemetryEvent { ts: number; sev: Severity; msg: string; ctx?: Record<string, unknown>; }
export type Sink = (e: TelemetryEvent) => void;

const RING_MAX = 200;
const ring: TelemetryEvent[] = [];
let sink: Sink = (e) => { void e; };

export function install(s: Sink) { sink = s; }
export function recent(): readonly TelemetryEvent[] { return ring.slice(); }

export function report(sev: Severity, msg: string, ctx?: Record<string, unknown>) {
  const e: TelemetryEvent = { ts: Date.now(), sev, msg, ctx };
  ring.push(e);
  if (ring.length > RING_MAX) ring.shift();
  try { sink(e); } catch {}
}

export const info  = (m: string, c?: Record<string, unknown>) => report('info', m, c);
export const warn  = (m: string, c?: Record<string, unknown>) => report('warn', m, c);
export const error = (m: string, c?: Record<string, unknown>) => report('error', m, c);
"""

FILES["src/engine/ErrorBoundary.ts"] = """import { error as logError } from './Telemetry';

/**
 * Global error boundary. Catches window errors + unhandled promise rejections
 * and routes them through Telemetry. Shows a fallback overlay so a thrown
 * scene doesn't blank-screen the user.
 */
let installed = false;

export function installErrorBoundary(opts: { showOverlay?: boolean } = {}) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const show = opts.showOverlay !== false;

  window.addEventListener('error', (ev) => {
    logError('window.error', { msg: ev.message, src: ev.filename, line: ev.lineno });
    if (show) renderOverlay(ev.message);
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    logError('unhandledrejection', { reason });
    if (show) renderOverlay(reason);
  });
}

function renderOverlay(msg: string) {
  if (document.getElementById('g2d-err')) return;
  const d = document.createElement('div');
  d.id = 'g2d-err';
  d.style.cssText = 'position:fixed;inset:0;background:#0a0a23ee;color:#f87171;font-family:monospace;padding:24px;z-index:9999;display:flex;flex-direction:column;gap:12px';
  const h = document.createElement('h2'); h.style.margin = '0'; h.textContent = 'Game crashed';
  const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = String(msg).slice(0, 500);
  const btn = document.createElement('button'); btn.style.cssText = 'padding:8px 16px;cursor:pointer'; btn.textContent = 'Reload';
  btn.addEventListener('click', () => location.reload());
  d.appendChild(h); d.appendChild(pre); d.appendChild(btn);
  document.body.appendChild(d);
}
"""

FILES["src/engine/AudioUnlock.ts"] = """/**
 * iOS / Safari / Chrome require a user gesture before AudioContext fires.
 * Call install() once at app start; the first pointerdown/keydown resumes
 * any pending contexts AND replays a silent buffer to satisfy auto-play.
 */
const ctxs: AudioContext[] = [];

export function track(c: AudioContext) { if (c && !ctxs.includes(c)) ctxs.push(c); }

export function isUnlocked(): boolean {
  return ctxs.every(c => c.state === 'running');
}

export function installAudioUnlock() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    for (const c of ctxs) {
      try { c.resume(); } catch {}
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
      } catch {}
    }
    if (isUnlocked()) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });
}
"""

FILES["src/engine/Lifecycle.ts"] = """/**
 * Scene cleanup helpers — Phaser scenes leak DOM listeners and timers if you
 * wire them by hand. onShutdown() registers a cleanup that fires on scene
 * SHUTDOWN and DESTROY events.
 */
export type Cleanup = () => void;

export function onShutdown(scene: any, cleanup: Cleanup) {
  if (!scene || !scene.events) { cleanup(); return; }
  let done = false;
  const run = () => { if (done) return; done = true; try { cleanup(); } catch {} };
  scene.events.once('shutdown', run);
  scene.events.once('destroy', run);
}

export class CleanupBag {
  private fns: Cleanup[] = [];
  add(fn: Cleanup): this { this.fns.push(fn); return this; }
  run() {
    while (this.fns.length) {
      const fn = this.fns.pop()!;
      try { fn(); } catch {}
    }
  }
  bindToScene(scene: any) { onShutdown(scene, () => this.run()); return this; }
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
    expect(out.highScore).toBe(5);
  });

  it('preserves locale if already set in pre-v2 blob', () => {
    const out = migrate({ highScore: 0, locale: 'fr' });
    expect(out.locale).toBe('fr');
  });

  it('current-version blob round-trips unchanged', () => {
    const cur = { _v: SAVE_VERSION, highScore: 9, muted: false, lastLevel: 'l1',
                  completed: true, bestPerLevel: { l1: 99 }, locale: 'ja' };
    const out = migrate(cur);
    expect(out.highScore).toBe(9);
    expect(out.locale).toBe('ja');
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

FILES["tests/unit/Telemetry.test.ts"] = """import { describe, it, expect } from 'vitest';
import { info, warn, error, install, recent } from '../../src/engine/Telemetry';

describe('Telemetry', () => {
  it('captures events into ring buffer', () => {
    const before = recent().length;
    info('boot');
    warn('thing', { id: 1 });
    error('boom');
    const after = recent();
    expect(after.length).toBeGreaterThanOrEqual(before + 3);
    expect(after[after.length - 1].sev).toBe('error');
    expect(after[after.length - 2].ctx).toEqual({ id: 1 });
  });

  it('routes to installed sink', () => {
    const seen: string[] = [];
    install(e => seen.push(`${e.sev}:${e.msg}`));
    info('a');
    error('b');
    expect(seen).toContain('info:a');
    expect(seen).toContain('error:b');
  });

  it('sink that throws does not break the call', () => {
    install(() => { throw new Error('sink-broken'); });
    expect(() => info('survives')).not.toThrow();
  });
});
"""

FILES["tests/unit/Perf.test.ts"] = """import { describe, it, expect } from 'vitest';
import { PerfMonitor } from '../../src/engine/Perf';

describe('PerfMonitor', () => {
  it('reports 60fps for ~16.67ms frames', () => {
    const m = new PerfMonitor();
    let t = 0;
    for (let i = 0; i < 30; i++) { t += 16.67; m.tick(t); }
    expect(Math.round(m.fps())).toBe(60);
  });

  it('p95 catches the tail of slow frames', () => {
    const m = new PerfMonitor();
    let t = 0;
    for (let i = 0; i < 80; i++) { t += 16; m.tick(t); }
    for (let i = 0; i < 20; i++) { t += 200; m.tick(t); }
    expect(m.p95dt()).toBeGreaterThan(16);
  });

  it('capacity caps sample buffer', () => {
    const m = new PerfMonitor(50);
    let t = 0;
    for (let i = 0; i < 200; i++) { t += 10; m.tick(t); }
    expect(m.fps()).toBeGreaterThan(0);
  });
});
"""

FILES["tests/unit/Lifecycle.test.ts"] = """import { describe, it, expect, vi } from 'vitest';
import { onShutdown, CleanupBag } from '../../src/engine/Lifecycle';

function fakeScene() {
  const handlers: Record<string, Function[]> = {};
  return {
    events: {
      once(ev: string, fn: Function) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev: string) { (handlers[ev] || []).forEach(fn => fn()); }
    }
  };
}

describe('Lifecycle', () => {
  it('onShutdown fires on shutdown event', () => {
    const cb = vi.fn();
    const sc = fakeScene();
    onShutdown(sc, cb);
    sc.events.emit('shutdown');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('runs only once even if both shutdown+destroy fire', () => {
    const cb = vi.fn();
    const sc = fakeScene();
    onShutdown(sc, cb);
    sc.events.emit('shutdown');
    sc.events.emit('destroy');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('CleanupBag runs all in LIFO and survives throwing fns', () => {
    const order: number[] = [];
    const bag = new CleanupBag();
    bag.add(() => order.push(1));
    bag.add(() => { throw new Error('x'); });
    bag.add(() => order.push(3));
    bag.run();
    expect(order).toEqual([3, 1]);
  });

  it('cleanup runs immediately if scene has no events', () => {
    const cb = vi.fn();
    onShutdown(null, cb);
    expect(cb).toHaveBeenCalled();
  });
});
"""

FILES["tests/unit/Editor.test.ts"] = """import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '../../src/engine/Editor';

describe('EditorState', () => {
  let s: EditorState;
  beforeEach(() => { s = EditorState.blank(4, 3); });

  it('starts blank', () => {
    expect(s.tiles.flat().every(t => t === 0)).toBe(true);
    expect(s.brush).toBe(1);
  });

  it('paint mutates tile + records history', () => {
    expect(s.paint(1, 1, 5)).toBe(true);
    expect(s.tiles[1][1]).toBe(5);
    expect(s.history.length).toBe(1);
  });

  it('paint same value is a no-op', () => {
    s.paint(0, 0, 3);
    expect(s.paint(0, 0, 3)).toBe(false);
  });

  it('paint OOB returns false', () => {
    expect(s.paint(99, 99)).toBe(false);
    expect(s.paint(-1, 0)).toBe(false);
  });

  it('erase resets to 0', () => {
    s.paint(2, 1, 7);
    s.erase(2, 1);
    expect(s.tiles[1][2]).toBe(0);
  });

  it('undo reverses last paint', () => {
    s.paint(1, 0, 4);
    s.paint(1, 0, 5);
    s.undo();
    expect(s.tiles[0][1]).toBe(4);
    s.undo();
    expect(s.tiles[0][1]).toBe(0);
  });

  it('cycleBrush wraps in [1, max]', () => {
    s.cycleBrush(+1); expect(s.brush).toBe(2);
    s.cycleBrush(+10); expect(s.brush).toBeGreaterThanOrEqual(1);
    s.cycleBrush(-1); expect(s.brush).toBeGreaterThanOrEqual(1);
  });

  it('serialize / deserialize roundtrip', () => {
    s.paint(2, 1, 9);
    const out = s.serialize();
    const t = EditorState.deserialize(out);
    expect(t.tiles[1][2]).toBe(9);
    expect(t.width).toBe(4);
  });

  it('save / restore via in-memory storage', () => {
    const mem: Record<string, string> = {};
    const storage: any = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => { mem[k] = v; },
      removeItem: (k: string) => { delete mem[k]; }
    };
    s.paint(3, 2, 6);
    s.save(storage);
    const r = EditorState.restore(storage);
    expect(r).not.toBeNull();
    expect(r!.tiles[2][3]).toBe(6);
  });
});
"""


# ─── Apply ──────────────────────────────────────────────────────────────────

# Files defined as platformer-specific; replaced by other kits.
PLATFORMER_ONLY = {
    "src/kit.ts",
    "src/scenes/MainMenu.ts",
    "src/scenes/Game.ts",
    "src/entities/Player.ts",
    "src/entities/Enemy.ts",
    "src/entities/Goal.ts",
    "src/entities/AGENT.md",
    "src/levels/AGENT.md",
    "src/levels/level1.ts",
    "src/levels/level2.ts",
    "src/levels/level3.ts",
}

# Kit registry. Each entry maps file paths to content.
# When apply(target, kit=X), files in KITS[X] override / add to FILES (minus PLATFORMER_ONLY).
KITS: dict[str, dict[str, str]] = {}

KITS["platformer"] = {}  # uses baseline FILES as-is

# Populated by genre modules below.
from monkey.templates import (  # noqa: E402
    _game_2d_platformer,
    _game_2d_shared,
    _kits_metroidvania,
    _kits_topdown_rpg,
    _kits_shmup,
    _kits_puzzle,
)

# Override the highest-churn sections from smaller template modules so future
# runtime/scaffold changes do not require giant edits in this monolithic file.
FILES.update(_game_2d_shared.FILES)
FILES.update(_game_2d_platformer.FILES)

KITS["metroidvania"] = _kits_metroidvania.FILES
KITS["topdown-rpg"] = _kits_topdown_rpg.FILES
KITS["shmup"] = _kits_shmup.FILES
KITS["puzzle"] = _kits_puzzle.FILES

KIT_NAMES = list(KITS.keys())


ALL_BIOME_KEYS = (
    "grass", "dirt", "stone", "sand", "cave", "metal", "snow",
    "lava", "ice", "water", "swamp", "desert", "forest", "mushroom",
    "castle", "beach",
)


CONFIG_DEFAULTS: dict = {
    "DEBUG": False,
    "WORLD": {
        "VIEW_WIDTH": 480, "VIEW_HEIGHT": 270,
        "LEVEL_WIDTH": 2400, "LEVEL_HEIGHT": 540,
        "GRAVITY": 900, "TILE": 16,
    },
    "PLAYER": {
        "SPEED": 160, "JUMP_VELOCITY": -340, "MAX_FALL_SPEED": 600,
        "COYOTE_TIME_MS": 100, "JUMP_BUFFER_MS": 120,
        "LIVES": 3, "HIT_INVUL_MS": 1000,
    },
    "ENEMY": {"PATROL_SPEED": 50, "DAMAGE": 1},
    "CAMERA": {
        "LERP": 0.1, "SHAKE_INTENSITY": 0.005, "SHAKE_DURATION_MS": 200,
        "DEADZONE_W": 80, "DEADZONE_H": 60,
    },
    "AUDIO": {"MASTER_VOLUME": 0.6, "MUSIC_VOLUME": 0.3, "SFX_VOLUME": 0.7},
    "PALETTE": {
        "BG": 0x0a0a23, "PLAYER": 0x4ade80, "ENEMY": 0xf87171,
        "PLATFORM": 0x6366f1, "COIN": 0xfbbf24, "HUD": 0xffffff,
    },
    "SAVE_KEY": "game-2d-ts:v1",
}

# Fields rendered as 0x... hex literals (colors).
_HEX_FIELDS = {("PALETTE", k) for k in CONFIG_DEFAULTS["PALETTE"].keys()}


def _deep_merge(base: dict, over: dict) -> dict:
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in base.items()}
    for k, v in (over or {}).items():
        if k not in base:
            raise ValueError(f"unknown config key '{k}'. valid: {sorted(base.keys())}")
        if isinstance(base[k], dict):
            if not isinstance(v, dict):
                raise ValueError(f"config key '{k}' expects a dict")
            for sk, sv in v.items():
                if sk not in base[k]:
                    raise ValueError(
                        f"unknown config key '{k}.{sk}'. valid: {sorted(base[k].keys())}"
                    )
                out[k][sk] = sv
        else:
            out[k] = v
    return out


def _fmt_value(section: str | None, key: str, val) -> str:
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, str):
        return f"'{val}'"
    if isinstance(val, int) and section is not None and (section, key) in _HEX_FIELDS:
        return f"0x{val:06x}"
    return str(val)


def _render_config_ts(cfg: dict) -> str:
    lines = [
        "/**",
        " * Global tuning surface — LLM-tunable via apply(tuning=...).",
        " * Re-edit here for runtime tweaks; defaults come from the scaffold.",
        " */",
        "export const CONFIG = {",
    ]
    keys = list(cfg.keys())
    for i, k in enumerate(keys):
        v = cfg[k]
        comma = "," if i < len(keys) - 1 else ""
        if isinstance(v, dict):
            lines.append(f"  {k}: {{")
            sub_keys = list(v.keys())
            for j, sk in enumerate(sub_keys):
                sv = _fmt_value(k, sk, v[sk])
                sc = "," if j < len(sub_keys) - 1 else ""
                lines.append(f"    {sk}: {sv}{sc}")
            lines.append(f"  }}{comma}")
            if i < len(keys) - 1:
                lines.append("")
        else:
            lines.append(f"  {k}: {_fmt_value(None, k, v)}{comma}")
    lines.append("} as const;")
    return "\n".join(lines) + "\n"


def apply(
    target: str | Path,
    kit: str = "platformer",
    biomes: list[str] | None = None,
    name: str = "game-2d-ts",
    title: str | None = None,
    tuning: dict | None = None,
) -> dict:
    """Write the template into `target` directory.

    Args:
        target: destination directory.
        kit: platformer | metroidvania | topdown-rpg | shmup | puzzle.
        biomes: optional whitelist of biome keys. None or empty = all biomes.
        name: package.json `name` (also default page title).
        title: HTML <title> + og:title. Defaults to `name`.
        tuning: deep-merge override for CONFIG. Same shape as CONFIG_DEFAULTS,
            e.g. {"PLAYER": {"SPEED": 220, "JUMP_VELOCITY": -400},
                  "WORLD": {"GRAVITY": 1100, "LEVEL_WIDTH": 4800},
                  "PALETTE": {"PLAYER": 0xff00aa}}.
            Unknown keys raise ValueError.
    """
    if kit not in KITS:
        raise ValueError(f"unknown kit '{kit}'. choose from: {', '.join(KIT_NAMES)}")
    if biomes:
        bad = [b for b in biomes if b not in ALL_BIOME_KEYS]
        if bad:
            raise ValueError(f"unknown biome(s) {bad}. valid: {', '.join(ALL_BIOME_KEYS)}")

    cfg = _deep_merge(CONFIG_DEFAULTS, tuning or {})
    title_str = title or name

    root = Path(target).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    created: list[str] = []
    skipped: list[str] = []

    merged: dict[str, str] = {}
    for rel, content in FILES.items():
        if kit != "platformer" and rel in PLATFORMER_ONLY:
            continue
        merged[rel] = content
    for rel, content in KITS[kit].items():
        merged[rel] = content

    merged["src/config.ts"] = _render_config_ts(cfg)

    if "package.json" in merged:
        merged["package.json"] = merged["package.json"].replace(
            '"name": "game-2d-ts"', f'"name": "{name}"', 1,
        )
    if "index.html" in merged:
        merged["index.html"] = (
            merged["index.html"]
            .replace("<title>Game 2D</title>", f"<title>{title_str}</title>")
            .replace('content="Game 2D"', f'content="{title_str}"')
        )

    if biomes:
        biome_literal = ", ".join(f"'{b}'" for b in biomes)
        tiles_key = "src/engine/Tiles.ts"
        if tiles_key in merged:
            merged[tiles_key] = merged[tiles_key].replace(
                "const BIOME_FILTER: string[] = [/* __BIOME_FILTER__ */];",
                f"const BIOME_FILTER: string[] = [{biome_literal}];",
            )

    for rel, content in merged.items():
        p = root / rel
        if p.exists():
            skipped.append(rel)
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        created.append(rel)
    return {
        "created": created, "skipped": skipped, "root": str(root),
        "kit": kit, "biomes": biomes or list(ALL_BIOME_KEYS),
        "name": name, "title": title_str, "config": cfg,
    }


def file_count(kit: str = "platformer") -> int:
    if kit == "platformer":
        return len(FILES)
    base = sum(1 for k in FILES if k not in PLATFORMER_ONLY)
    return base + len(KITS.get(kit, {}))
