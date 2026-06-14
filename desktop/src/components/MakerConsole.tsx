import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Power, Plus, Copy, Trash2, Pencil, Wand2, Save, RotateCcw, ArrowLeft,
  Play, Palette as PaletteIcon, Map as MapIcon, Code2, BookOpen, Download,
  History as HistoryIcon, X as XIcon, GitCommit,
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { CartRuntime } from '../game/engine/runtime';
import { cartToHtml, cartName } from '../game/engine/export';
import { cssColor } from '../game/engine/palette';
import {
  SHEET, SPR_PX, SPR_PER_ROW, MAP_W, MAP_H, SPRITE_COUNT,
} from '../game/engine/types';
import type { Cart } from '../game/engine/types';
import {
  loadCarts, getCart, saveCart, deleteCart, duplicateCart, createCart,
} from '../game/engine/storage';
import {
  loadHistory, recordSnapshot, setEntryMessage, rollbackTo, autoMessage,
} from '../game/engine/history';
import type { HistoryEntry, CartDiff } from '../game/engine/history';
import { agentStream, makerComplete } from '../agent/agent';

// ── theme ────────────────────────────────────────────────────────────────
const SHELL = 'var(--gb-shell)';
const INK = 'var(--gb-ink)';
const MID = 'var(--gb-mid)';
const DARK = 'var(--gb-dark)';
const SCREEN_BG = 'var(--gb-screen)';

// Playground accents — pulled straight from the 8-bit palette so the chrome
// speaks the same colour language as the carts it builds. Each is paired with a
// darker shade for the chunky "pressable" drop-shadow under buttons/tabs.
const C_RED = cssColor(8);
const C_ORANGE = cssColor(9);
const C_YELLOW = cssColor(10);
const C_GREEN = cssColor(11);
const C_BLUE = cssColor(12);
const C_INDIGO = cssColor(13);
const C_PINK = cssColor(14);
// hand-tuned darker twins (the palette's own dark cousins) for 3D bottoms
const D_GREEN = cssColor(3);
const D_BLUE = cssColor(1);
const D_RED = cssColor(2);
const D_INK = 'var(--gb-dark)';

// One bright identity per editor tab → the whole pane reads as a colourful toy.
const TAB_META: Record<Tab, { label: string; icon: React.ComponentType<any>; color: string; dark: string }> = {
  run:    { label: 'play',   icon: Play,        color: C_GREEN,  dark: D_GREEN },
  sprite: { label: 'sprite', icon: PaletteIcon, color: C_PINK,   dark: D_RED },
  map:    { label: 'map',    icon: MapIcon,     color: C_BLUE,   dark: D_BLUE },
  code:   { label: 'code',   icon: Code2,       color: C_ORANGE, dark: D_RED },
  doc:    { label: 'doc',    icon: BookOpen,    color: C_INDIGO, dark: D_BLUE },
};

// Compact authoring spec handed to the model for text-to-cart (mirrors
// game/engine/ENGINE-CONTEXT.md). Kept terse so it fits one system block.
const AUTHOR_SPEC = `You write a tiny 8-bit game "cart" in plain JavaScript for the Monkey engine.
HARD LIMITS: 128x128 screen, 16 fixed palette colours (indices 0-15), sprites 8x8 (ids 0-255), tilemap 128x32.
Define top-level functions (any subset): _init() runs once, _update() runs 30x/s for logic, _draw() runs 30x/s to render.
DRAW API (call directly, no import): cls(c), pset(x,y,c), pget(x,y), line(x0,y0,x1,y1,c), rect(x0,y0,x1,y1,c), rectfill(...), circ(x,y,r,c), circfill(x,y,r,c), spr(n,x,y,flipx?,flipy?), sspr(...), map(cx,cy,sx,sy,cw,ch), mget(cx,cy), mset(cx,cy,n), print(s,x,y,c), pal(from,to), palt(c,t), camera(x,y), fget(n,f), fset(n,f,v).
INPUT: btn(i) held, btnp(i) pressed-this-frame. i: 0 left 1 right 2 up 3 down 4 O 5 X.
MATH: flr ceil abs min max mid sqrt sin cos atan2 sgn rnd srand. (sin/cos take turns 0..1, sin is negated like PICO-8.)
Colours 0..15: 0 black 1 dkblue 2 dkpurple 3 dkgreen 4 brown 5 dkgrey 6 ltgrey 7 white 8 red 9 orange 10 yellow 11 green 12 blue 13 indigo 14 pink 15 peach.
NO host access: no import/eval/fetch/window/document/setTimeout/etc — they are blocked. Pure game logic only.
Keep state in module-level let variables. Reply with ONLY one fenced \`\`\`js code block, no prose.`;

// ── sprite / map AI (clean direct model call — see makerComplete) ─────────────
// These specs are deliberately tiny and format-strict: validated against
// llama-3.2-3b, which reliably emits the grid / DSL when the system prompt is
// THIS and nothing else (the full agent SYSTEM_PROMPT corrupts the output).

const SPRITE_SPEC = `You are a pixel-art tool. Draw ONE 8x8 sprite as a grid of 8 lines, each line exactly 8 characters.
Each character is ONE palette colour, a single hex digit 0-f (NO spaces between them):
0 transparent  1 dark-blue  2 dark-purple  3 dark-green  4 brown  5 dark-grey  6 light-grey  7 white
8 red  9 orange  a yellow  b green  c blue  d indigo  e pink  f peach
Use 0 for empty background pixels. Centre the shape, keep edges transparent.
Make the shape roughly left-right symmetric and solid. Do NOT repeat the same two columns down every row.
EXAMPLE — a red ball:
\`\`\`
00888800
08888880
88888888
88888888
88888888
88888888
08888880
00888800
\`\`\`
EXAMPLE — a red heart:
\`\`\`
08800880
88888888
88888888
88888888
08888880
00888800
00088000
00000000
\`\`\`
EXAMPLE — a green tree:
\`\`\`
000bb000
00bbbb00
0bbbbbb0
bbbbbbbb
0bbbbbb0
00bbbb00
00044000
00044000
\`\`\`
EXAMPLE — a yellow coin:
\`\`\`
00aaaa00
0a9999a0
a99aa99a
a9a99a9a
a9a99a9a
a99aa99a
0a9999a0
00aaaa00
\`\`\`
Now reply with ONLY one fenced code block, exactly 8 lines of 8 hex digits each. No spaces, no prose.`;

/** Lenient 8x8 hex-grid parser. Returns 8 strings of 8 hex chars, or null. */
function parseSprite(text: string): string[] | null {
  const fence = text.match(/```[a-z]*\s*\n?([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  let rows = body.split('\n')
    .map((l) => (l.match(/[0-9a-fA-F]/g) || []).join('').toLowerCase())
    .filter((l) => l.length > 0)
    .map((l) => (l + '00000000').slice(0, 8));
  // Fallback: model crammed everything onto one/few long lines → flatten all
  // hex digits and re-chunk into rows of 8.
  if (rows.length < 8) {
    const all = (body.match(/[0-9a-fA-F]/g) || []).join('').toLowerCase();
    if (all.length >= 32) {
      rows = [];
      for (let i = 0; i < all.length && rows.length < 8; i += 8) {
        rows.push((all.slice(i, i + 8) + '00000000').slice(0, 8));
      }
    }
  }
  if (rows.length === 0) return null;
  rows = rows.slice(0, 8);
  while (rows.length < 8) rows.push('00000000');
  return rows;
}

function mapSpec(sprites: string): string {
  return `You build a tilemap for a tiny 8-bit game. The map is a grid of tiles, columns x=0..127, rows y=0..31.
Each tile holds a sprite id (0 = empty). Available sprite ids you may place: ${sprites}.
Output a short list of commands, ONE per line, inside a single fenced code block. Commands:
  CLEAR                     -> empty the whole map
  FILL x0 y0 x1 y1 id       -> fill a rectangle (inclusive) with sprite id
  SET x y id                -> set one tile
Use small coordinates (the player sees roughly x=0..23, y=0..15). Reply with ONLY the command block, no prose.`;
}

type MapOp =
  | { op: 'clear' }
  | { op: 'fill'; a: number[] }
  | { op: 'set'; a: number[] };

function parseMap(text: string): MapOp[] {
  const fence = text.match(/```[a-z]*\s*\n?([\s\S]*?)```/i);
  const body = (fence ? fence[1] : text).trim();
  const ops: MapOp[] = [];
  for (const raw of body.split('\n')) {
    const l = raw.trim().toUpperCase();
    if (l === 'CLEAR') { ops.push({ op: 'clear' }); continue; }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^FILL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/))) {
      ops.push({ op: 'fill', a: m.slice(1, 6).map(Number) }); continue;
    }
    if ((m = l.match(/^SET\s+(\d+)\s+(\d+)\s+(\d+)$/))) {
      ops.push({ op: 'set', a: m.slice(1, 4).map(Number) }); continue;
    }
  }
  return ops;
}

function applyMapOps(cart: Cart, ops: MapOp[]) {
  for (const op of ops) {
    if (op.op === 'clear') { cart.map.fill(0); continue; }
    if (op.op === 'fill') {
      let [x0, y0, x1, y1, id] = op.a;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (y0 > y1) [y0, y1] = [y1, y0];
      for (let y = Math.max(0, y0); y <= Math.min(MAP_H - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(MAP_W - 1, x1); x++)
          cart.map[y * MAP_W + x] = id & 255;
      continue;
    }
    // set
    const [x, y, id] = op.a;
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) cart.map[y * MAP_W + x] = id & 255;
  }
}

/** Sprite ids that have any non-transparent pixel — what the map AI may place. */
function usedSpriteIds(cart: Cart): number[] {
  const ids: number[] = [];
  for (let n = 0; n < SPRITE_COUNT && ids.length < 24; n++) {
    const sx = (n % SPR_PER_ROW) * SPR_PX, sy = ((n / SPR_PER_ROW) | 0) * SPR_PX;
    let any = false;
    for (let y = 0; y < SPR_PX && !any; y++)
      for (let x = 0; x < SPR_PX; x++)
        if (cart.sheet[(sy + y) * SHEET + (sx + x)] !== 0) { any = true; break; }
    if (any) ids.push(n);
  }
  return ids;
}

interface Props {
  onExit: () => void;
  cartId?: string;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

type Tab = 'run' | 'sprite' | 'map' | 'code' | 'doc';

export default function MakerConsole({ onExit, cartId, modelId, providerMode, providerUserId }: Props) {
  const [editingId, setEditingId] = useState<string | null>(cartId ?? null);

  if (!editingId) {
    return <Library onExit={onExit} onOpen={setEditingId} />;
  }
  return (
    <Editor
      key={editingId}
      cartId={editingId}
      onClose={() => setEditingId(null)}
      modelId={modelId}
      providerMode={providerMode}
      providerUserId={providerUserId}
    />
  );
}

// ── Library (project listing) ──────────────────────────────────────────────
function Library({ onExit, onOpen }: { onExit: () => void; onOpen: (id: string) => void }) {
  const [carts, setCarts] = useState<Cart[]>(() => loadCarts());
  const refresh = () => setCarts(loadCarts());

  const onNew = () => { const c = createCart('untitled'); onOpen(c.id); };
  const onDup = (id: string) => { duplicateCart(id); refresh(); };
  const onDel = (id: string) => { if (confirm('Delete this cart?')) { deleteCart(id); refresh(); } };

  return (
    <div style={page}>
      <div style={bar}>
        <RainbowTitle text="8-BIT MAKER" />
        <span style={{ flex: 1 }} />
        <button style={btnWide} onClick={onNew}><Plus size={15} /> new cart</button>
        <button style={iconBtn} title="exit" onClick={onExit}><Power size={16} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {carts.length === 0 ? (
          <div style={{ opacity: 0.7, textAlign: 'center', marginTop: 40 }}>
            No carts yet. Hit “new cart”, or ask the agent: “open the maker and build me a snake game”.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
            {carts.map((c) => (
              <div key={c.id} style={card}>
                <div
                  style={{ ...thumbBox, cursor: 'pointer' }}
                  onClick={() => onOpen(c.id)}
                  title="edit"
                >
                  {c.thumb
                    ? <img src={c.thumb} alt="" style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 4 }} />
                    : <span style={{ opacity: 0.5, fontSize: 11 }}>no preview</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={miniBtn} title="edit" onClick={() => onOpen(c.id)}><Pencil size={13} /></button>
                  <button style={miniBtn} title="duplicate" onClick={() => onDup(c.id)}><Copy size={13} /></button>
                  <button style={{ ...miniBtn, marginLeft: 'auto', color: DARK }} title="delete" onClick={() => onDel(c.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Ask the model for a short, human commit label describing the saved changes.
// English prompt (agent code stays English); the output is a French one-liner
// shown in the save history. Falls back to the deterministic auto label on any
// failure so a save is never blocked by the model.
async function nameCommit(
  diff: CartDiff,
  opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string },
): Promise<string> {
  const fallback = autoMessage(diff, false);
  try {
    const summary = [
      `code lines added: ${diff.codeAdded}, removed: ${diff.codeRemoved}`,
      `sprites changed: ${diff.spritesChanged}`,
      `map cells changed: ${diff.mapCellsChanged}`,
      `sprite flags changed: ${diff.flagsChanged}`,
      diff.hunks ? `\ncode diff (truncated):\n${diff.hunks.slice(0, 1200)}` : '',
    ].filter(Boolean).join('\n');
    const text = await makerComplete({
      system:
        'You name save commits for a tiny PICO-8-style game maker. Given a diff, reply '
        + 'with ONE short label in FRENCH summarising what changed, like a git commit '
        + 'subject. Max 6 words, lowercase, no quotes, no trailing period, no emoji. '
        + 'Prefer the gameplay/visual intent when obvious (e.g. "ajout du saut du heros", '
        + '"nouvelle map foret", "sprite joueur retouche"). Output the label only.',
      prompt: `Diff:\n${summary}\n\nLabel:`,
      modelId: opts.modelId,
      temperature: 0.3,
      providerMode: opts.providerMode,
      providerUserId: opts.providerUserId,
    });
    const clean = (text || '').trim().split('\n')[0].replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '').trim();
    return clean && clean.length <= 80 ? clean : fallback;
  } catch {
    return fallback;
  }
}

// ── Editor ─────────────────────────────────────────────────────────────────
function Editor({ cartId, onClose, modelId, providerMode, providerUserId }: {
  cartId: string; onClose: () => void;
  modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string;
}) {
  const cartRef = useRef<Cart>(getCart(cartId) || createCart('untitled'));
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [tab, setTab] = useState<Tab>('run');
  const [name, setName] = useState(cartRef.current.name);
  const [dirty, setDirty] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [histTick, setHistTick] = useState(0); // bump to refresh the history list
  const [ver, setVer] = useState(0); // bump to remount panes after a rollback

  const touch = () => { setDirty(true); rerender(); };
  const persist = () => {
    cartRef.current.name = name.trim() || 'untitled';
    saveCart(cartRef.current);
    setDirty(false);
    rerender();
    // Snapshot this save onto the linear history (skips no-op saves), then ask
    // the model for a nicer commit label and patch it in when it resolves.
    const entry = recordSnapshot(cartRef.current);
    if (!entry) return;
    setHistTick((n) => n + 1);
    const id = cartRef.current.id;
    nameCommit(entry.diff, { modelId, providerMode, providerUserId })
      .then((msg) => {
        if (msg && msg !== entry.message) { setEntryMessage(id, entry.id, msg); setHistTick((n) => n + 1); }
      })
      .catch(() => {});
  };

  const onRollback = (entryId: string) => {
    const restored = rollbackTo(cartId, entryId, saveCart);
    if (!restored) return;
    cartRef.current = restored;
    setName(restored.name);
    setDirty(false);
    setHistOpen(false);
    setHistTick((n) => n + 1);
    setVer((v) => v + 1);
    setTab('run');
    rerender();
  };

  const [exporting, setExporting] = useState(false);
  // Bake the cart into a single standalone .html (engine + console overlay
  // inlined) and let the user pick where to drop it. Double-click to play.
  const exportHtml = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      cartRef.current.name = name.trim() || 'untitled';
      const slug = cartName(cartRef.current).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
      const path = await save({ title: 'exporter le jeu (HTML)', defaultPath: `${slug}.html` });
      if (!path) return;
      await writeTextFile(path, cartToHtml(cartRef.current));
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('cart export failed', e);
    } finally {
      setExporting(false);
    }
  };

  // autosave on unmount (also snapshots the final state; no-op saves are skipped)
  useEffect(() => () => { cartRef.current.name = name.trim() || 'untitled'; saveCart(cartRef.current); recordSnapshot(cartRef.current); }, []); // eslint-disable-line

  return (
    <div style={page}>
      <div style={bar}>
        <button style={iconBtn} title="back to library" onClick={() => { persist(); onClose(); }}><ArrowLeft size={16} /></button>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          style={nameInput}
          spellCheck={false}
        />
        <span style={{ flex: 1 }} />
        <button
          style={playBtn(C_PINK, D_RED)}
          title="historique des sauvegardes (rollback)"
          onClick={() => setHistOpen(true)}
        >
          <HistoryIcon size={15} /> histo
        </button>
        <button
          style={{ ...playBtn(C_INDIGO, D_BLUE), opacity: exporting ? 0.55 : 1 }}
          title="exporter en HTML jouable (un seul fichier)"
          onClick={exportHtml}
        >
          <Download size={15} /> {exporting ? '…' : 'export'}
        </button>
        <button style={dirty ? btnWide : { ...btnWide, opacity: 0.5 }} onClick={persist}><Save size={15} /> save</button>
      </div>

      <div style={tabRow}>
        {(['run', 'sprite', 'map', 'code', 'doc'] as Tab[]).map((tk) => {
          const meta = TAB_META[tk];
          const Icon = meta.icon;
          const on = tab === tk;
          return (
            <button
              key={tk}
              onClick={() => setTab(tk)}
              style={{
                ...tabBtn,
                color: on ? '#fff' : INK,
                background: on ? meta.color : '#fff',
                borderColor: meta.color,
                boxShadow: on ? `0 3px 0 ${meta.dark}` : 'none',
                transform: on ? 'translateY(-1px)' : 'none',
              }}
            >
              <Icon size={14} strokeWidth={2.6} /> {meta.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tab === 'run' && <RunPane key={`run-${ver}`} cart={cartRef.current} />}
        {tab === 'sprite' && <SpriteEditor key={`spr-${ver}`} cart={cartRef.current} onEdit={touch} modelId={modelId} providerMode={providerMode} providerUserId={providerUserId} />}
        {tab === 'map' && <MapEditor key={`map-${ver}`} cart={cartRef.current} onEdit={touch} modelId={modelId} providerMode={providerMode} providerUserId={providerUserId} />}
        {tab === 'code' && (
          <CodePane
            key={`code-${ver}`}
            cart={cartRef.current}
            onEdit={touch}
            modelId={modelId}
            providerMode={providerMode}
            providerUserId={providerUserId}
          />
        )}
        {tab === 'doc' && (
          <DocPane
            onLoad={(code) => { cartRef.current.code = code; setDirty(true); persist(); setTab('run'); }}
          />
        )}
        {histOpen && (
          <HistoryPanel cartId={cartId} tick={histTick} onClose={() => setHistOpen(false)} onRollback={onRollback} />
        )}
      </div>
    </div>
  );
}

// ── Save history (github-like, single linear branch, local-first) ────────────
function diffBadges(d: CartDiff): { label: string; color: string }[] {
  const out: { label: string; color: string }[] = [];
  if (d.codeAdded) out.push({ label: `+${d.codeAdded}`, color: C_GREEN });
  if (d.codeRemoved) out.push({ label: `-${d.codeRemoved}`, color: C_RED });
  if (d.spritesChanged) out.push({ label: `${d.spritesChanged} spr`, color: C_ORANGE });
  if (d.mapCellsChanged) out.push({ label: `${d.mapCellsChanged} map`, color: C_BLUE });
  if (d.flagsChanged) out.push({ label: `${d.flagsChanged} flag`, color: C_INDIGO });
  return out;
}

function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'a l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString();
}

function HistoryPanel({ cartId, tick, onClose, onRollback }: {
  cartId: string; tick: number; onClose: () => void; onRollback: (entryId: string) => void;
}) {
  const entries = useMemo<HistoryEntry[]>(() => loadHistory(cartId), [cartId, tick]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 30 }}
      onClick={onClose}
    >
      <div
        style={{ width: 'min(420px, 92%)', height: '100%', background: '#fff', borderLeft: `3px solid ${C_PINK}`, boxShadow: '-6px 0 24px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `2px solid ${MID}` }}>
          <HistoryIcon size={16} color={C_PINK} />
          <span style={{ fontWeight: 800, fontSize: 14 }}>historique des saves</span>
          <span style={{ flex: 1 }} />
          <button style={iconBtn} title="fermer" onClick={onClose}><XIcon size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {entries.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 12, textAlign: 'center', marginTop: 30 }}>
              Aucune sauvegarde pour l’instant. Clique “save” pour creer le premier point.
            </div>
          ) : entries.map((e, i) => {
            const isOpen = open === e.id;
            return (
              <div key={e.id} style={{ borderLeft: `2px solid ${MID}`, marginLeft: 6, paddingLeft: 12, position: 'relative', paddingBottom: 14 }}>
                <span style={{ position: 'absolute', left: -7, top: 3, color: i === 0 ? C_GREEN : C_PINK }}><GitCommit size={13} /></span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{e.message}</span>
                  <span style={{ fontSize: 10, opacity: 0.55, whiteSpace: 'nowrap' }}>{relTime(e.ts)}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                  {diffBadges(e.diff).map((b, k) => (
                    <span key={k} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: b.color, borderRadius: 4, padding: '1px 6px' }}>{b.label}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                  {e.diff.hunks && (
                    <button style={miniLink} onClick={() => setOpen(isOpen ? null : e.id)}>{isOpen ? 'masquer' : 'voir le diff'}</button>
                  )}
                  {i !== 0 && (
                    <button
                      style={{ ...miniLink, color: C_RED }}
                      onClick={() => { if (confirm('Revenir a cette sauvegarde ? (l’etat courant est garde dans l’historique)')) onRollback(e.id); }}
                    >
                      <RotateCcw size={11} style={{ verticalAlign: -1 }} /> restaurer
                    </button>
                  )}
                </div>
                {isOpen && e.diff.hunks && (
                  <pre style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.4, background: '#12131a', color: '#d8dee9', borderRadius: 6, padding: 8, overflowX: 'auto', whiteSpace: 'pre' }}>
                    {e.diff.hunks.split('\n').map((ln, k) => (
                      <div key={k} style={{ color: ln.startsWith('+') ? '#7ee787' : ln.startsWith('-') ? '#ff7b72' : '#d8dee9' }}>{ln}</div>
                    ))}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Run pane ────────────────────────────────────────────────────────────────
function RunPane({ cart }: { cart: Cart }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<CartRuntime | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = () => {
    if (!canvasRef.current) return;
    setErr(null);
    rtRef.current?.stop();
    const rt = new CartRuntime(canvasRef.current, { onError: setErr });
    rt.load(cart);
    rtRef.current = rt;
    // snapshot a thumbnail shortly after first frames
    window.setTimeout(() => { const t = rt.snapshot(); if (t) cart.thumb = t; }, 600);
    canvasRef.current.focus();
  };

  useEffect(() => { start(); return () => rtRef.current?.stop(); }, []); // eslint-disable-line

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 }}>
      <canvas
        ref={canvasRef}
        style={{ width: 'min(60vh, 80vw)', height: 'min(60vh, 80vw)', imageRendering: 'pixelated', background: SCREEN_BG, border: `3px solid ${INK}`, borderRadius: 6, outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={btnWide} onClick={start}><RotateCcw size={14} /> run</button>
        <span style={{ fontSize: 11, opacity: 0.7 }}>arrows/wasd · Z=O · X=X</span>
      </div>
      {err && <div style={{ color: DARK, fontSize: 12, maxWidth: 380, textAlign: 'center' }}>⚠ {err}</div>}
    </div>
  );
}

// ── Sprite editor ────────────────────────────────────────────────────────────
function SpriteEditor({ cart, onEdit, modelId, providerMode, providerUserId }: {
  cart: Cart; onEdit: () => void;
  modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string;
}) {
  const [sel, setSel] = useState(0);
  const [col, setCol] = useState(8);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const cellRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  const sx = (sel % SPR_PER_ROW) * SPR_PX;
  const sy = ((sel / SPR_PER_ROW) | 0) * SPR_PX;

  const drawSheet = () => {
    const cv = sheetRef.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    for (let y = 0; y < SHEET; y++) for (let x = 0; x < SHEET; x++) {
      g.fillStyle = cssColor(cart.sheet[y * SHEET + x]);
      g.fillRect(x, y, 1, 1);
    }
  };
  const drawCell = () => {
    const cv = cellRef.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    const z = cv.width / SPR_PX;
    for (let y = 0; y < SPR_PX; y++) for (let x = 0; x < SPR_PX; x++) {
      g.fillStyle = cssColor(cart.sheet[(sy + y) * SHEET + (sx + x)]);
      g.fillRect(x * z, y * z, z, z);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i <= SPR_PX; i++) {
      g.beginPath(); g.moveTo(i * z, 0); g.lineTo(i * z, cv.width); g.stroke();
      g.beginPath(); g.moveTo(0, i * z); g.lineTo(cv.width, i * z); g.stroke();
    }
  };

  useEffect(() => { drawSheet(); drawCell(); }, []); // eslint-disable-line
  useEffect(() => { drawCell(); }, [sel]); // eslint-disable-line

  const paintAt = (clientX: number, clientY: number) => {
    const cv = cellRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const px = Math.floor(((clientX - r.left) / r.width) * SPR_PX);
    const py = Math.floor(((clientY - r.top) / r.height) * SPR_PX);
    if (px < 0 || py < 0 || px >= SPR_PX || py >= SPR_PX) return;
    cart.sheet[(sy + py) * SHEET + (sx + px)] = col;
    drawCell(); drawSheet(); onEdit();
  };

  const pickSprite = (clientX: number, clientY: number) => {
    const cv = sheetRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const tx = Math.floor(((clientX - r.left) / r.width) * SPR_PER_ROW);
    const ty = Math.floor(((clientY - r.top) / r.height) * SPR_PER_ROW);
    if (tx < 0 || ty < 0 || tx >= SPR_PER_ROW || ty >= SPR_PER_ROW) return;
    setSel(ty * SPR_PER_ROW + tx);
  };

  // AI: draw the selected 8x8 sprite from a text prompt (clean direct call).
  const aiRun = async (p: string): Promise<string> => {
    const text = await makerComplete({
      system: SPRITE_SPEC, prompt: `Draw: ${p}.`,
      modelId, providerMode, providerUserId, temperature: 0.45,
    });
    const rows = parseSprite(text);
    if (!rows) throw new Error('model returned no 8x8 grid');
    for (let py = 0; py < SPR_PX; py++)
      for (let px = 0; px < SPR_PX; px++)
        cart.sheet[(sy + py) * SHEET + (sx + px)] = (parseInt(rows[py][px], 16) || 0) & 15;
    drawCell(); drawSheet(); onEdit();
    return `sprite #${sel} drawn ✓`;
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'auto' }}>
      <AiMiniBar accent={C_PINK} dark={D_RED} placeholder="draw this sprite… e.g. a red heart, a smiling face, a coin" onRun={aiRun} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={panel(C_PINK)}>
          <div style={lblc(C_PINK)}>sprite #{sel}</div>
          <canvas
            ref={cellRef}
            width={256}
            height={256}
            style={{ width: 256, height: 256, imageRendering: 'pixelated', border: `3px solid ${INK}`, borderRadius: 10, cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={(e) => { painting.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); paintAt(e.clientX, e.clientY); }}
            onPointerMove={(e) => { if (painting.current) paintAt(e.clientX, e.clientY); }}
            onPointerUp={() => { painting.current = false; }}
          />
          <Palette col={col} setCol={setCol} />
        </div>
        <div style={panel(C_PINK)}>
          <div style={lblc(C_PINK)}>sheet — click to pick</div>
          <canvas
            ref={sheetRef}
            width={SHEET}
            height={SHEET}
            style={{ width: 256, height: 256, imageRendering: 'pixelated', border: `3px solid ${MID}`, borderRadius: 10, cursor: 'pointer' }}
            onPointerDown={(e) => pickSprite(e.clientX, e.clientY)}
          />
        </div>
      </div>
    </div>
  );
}

function Palette({ col, setCol }: { col: number; setCol: (c: number) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, marginTop: 10, width: 256 }}>
      {Array.from({ length: 16 }, (_, i) => (
        <button
          key={i}
          onClick={() => setCol(i)}
          title={`colour ${i}`}
          style={{ aspectRatio: '1', background: cssColor(i), border: col === i ? `3px solid ${INK}` : '2px solid rgba(0,0,0,0.18)', borderRadius: 8, cursor: 'pointer', transform: col === i ? 'scale(1.12)' : 'none', transition: 'transform 80ms', boxShadow: col === i ? '0 2px 5px rgba(0,0,0,0.25)' : 'none' }}
        />
      ))}
    </div>
  );
}

// ── Map editor ───────────────────────────────────────────────────────────────
const MAP_VIEW_W = 24; // tiles shown
const MAP_VIEW_H = 16;
function MapEditor({ cart, onEdit, modelId, providerMode, providerUserId }: {
  cart: Cart; onEdit: () => void;
  modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string;
}) {
  const [sel, setSel] = useState(1);
  const [ox, setOx] = useState(0);
  const [oy, setOy] = useState(0);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef<0 | 1 | 2>(0); // 0 none, 1 paint, 2 erase

  const drawSprInto = (g: CanvasRenderingContext2D, n: number, dx: number, dy: number, z: number) => {
    const ssx = (n % SPR_PER_ROW) * SPR_PX, ssy = ((n / SPR_PER_ROW) | 0) * SPR_PX;
    for (let y = 0; y < SPR_PX; y++) for (let x = 0; x < SPR_PX; x++) {
      g.fillStyle = cssColor(cart.sheet[(ssy + y) * SHEET + (ssx + x)]);
      g.fillRect(dx + x * z, dy + y * z, z, z);
    }
  };

  const drawMap = () => {
    const cv = mapRef.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    const z = cv.width / (MAP_VIEW_W * SPR_PX);
    g.fillStyle = cssColor(0); g.fillRect(0, 0, cv.width, cv.height);
    for (let j = 0; j < MAP_VIEW_H; j++) for (let i = 0; i < MAP_VIEW_W; i++) {
      const mx = ox + i, my = oy + j;
      if (mx >= MAP_W || my >= MAP_H) continue;
      const n = cart.map[my * MAP_W + mx];
      if (n !== 0) drawSprInto(g, n, i * SPR_PX * z, j * SPR_PX * z, z);
    }
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i <= MAP_VIEW_W; i++) { g.beginPath(); g.moveTo(i * SPR_PX * z, 0); g.lineTo(i * SPR_PX * z, cv.height); g.stroke(); }
    for (let j = 0; j <= MAP_VIEW_H; j++) { g.beginPath(); g.moveTo(0, j * SPR_PX * z); g.lineTo(cv.width, j * SPR_PX * z); g.stroke(); }
  };

  const drawSheet = () => {
    const cv = sheetRef.current; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    for (let y = 0; y < SHEET; y++) for (let x = 0; x < SHEET; x++) {
      g.fillStyle = cssColor(cart.sheet[y * SHEET + x]);
      g.fillRect(x, y, 1, 1);
    }
  };

  useEffect(() => { drawMap(); drawSheet(); }, []); // eslint-disable-line
  useEffect(() => { drawMap(); }, [ox, oy, sel]); // eslint-disable-line

  const paintMap = (clientX: number, clientY: number, mode: 1 | 2) => {
    const cv = mapRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const i = Math.floor(((clientX - r.left) / r.width) * MAP_VIEW_W);
    const j = Math.floor(((clientY - r.top) / r.height) * MAP_VIEW_H);
    const mx = ox + i, my = oy + j;
    if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) return;
    cart.map[my * MAP_W + mx] = mode === 2 ? 0 : sel;
    drawMap(); onEdit();
  };

  const pickSprite = (clientX: number, clientY: number) => {
    const cv = sheetRef.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const tx = Math.floor(((clientX - r.left) / r.width) * SPR_PER_ROW);
    const ty = Math.floor(((clientY - r.top) / r.height) * SPR_PER_ROW);
    if (tx < 0 || ty < 0 || tx >= SPR_PER_ROW || ty >= SPR_PER_ROW) return;
    setSel(ty * SPR_PER_ROW + tx);
  };

  const pan = (dx: number, dy: number) => {
    setOx((v) => Math.max(0, Math.min(MAP_W - MAP_VIEW_W, v + dx)));
    setOy((v) => Math.max(0, Math.min(MAP_H - MAP_VIEW_H, v + dy)));
  };

  // AI: lay down tiles from a text prompt (clean direct call, CLEAR/FILL/SET DSL).
  const aiRun = async (p: string): Promise<string> => {
    const ids = usedSpriteIds(cart);
    if (ids.length === 0) throw new Error('draw a sprite first — no tiles to place');
    const text = await makerComplete({
      system: mapSpec(ids.join(', ')), prompt: `Build: ${p}.`,
      modelId, providerMode, providerUserId, temperature: 0.1,
    });
    const ops = parseMap(text);
    if (ops.length === 0) throw new Error('model returned no map commands');
    applyMapOps(cart, ops);
    setOx(0); setOy(0);
    drawMap(); onEdit();
    return `${ops.length} command${ops.length > 1 ? 's' : ''} applied ✓`;
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'auto' }}>
      <AiMiniBar accent={C_BLUE} dark={D_BLUE} placeholder="build this map… e.g. ground along the bottom with floating platforms" onRun={aiRun} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={panel(C_BLUE)}>
          <div style={lblc(C_BLUE)}>map — left paint · right erase ({ox},{oy})</div>
          <canvas
            ref={mapRef}
            width={MAP_VIEW_W * SPR_PX * 3}
            height={MAP_VIEW_H * SPR_PX * 3}
            style={{ width: MAP_VIEW_W * SPR_PX * 3, maxWidth: '60vw', imageRendering: 'pixelated', border: `3px solid ${INK}`, borderRadius: 10, cursor: 'crosshair', touchAction: 'none' }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => { const m = e.button === 2 ? 2 : 1; painting.current = m; (e.target as HTMLElement).setPointerCapture(e.pointerId); paintMap(e.clientX, e.clientY, m); }}
            onPointerMove={(e) => { if (painting.current) paintMap(e.clientX, e.clientY, painting.current); }}
            onPointerUp={() => { painting.current = 0; }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={miniBtn} onClick={() => pan(-MAP_VIEW_W, 0)}>◀</button>
            <button style={miniBtn} onClick={() => pan(MAP_VIEW_W, 0)}>▶</button>
            <button style={miniBtn} onClick={() => pan(0, -MAP_VIEW_H)}>▲</button>
            <button style={miniBtn} onClick={() => pan(0, MAP_VIEW_H)}>▼</button>
          </div>
        </div>
        <div style={panel(C_BLUE)}>
          <div style={lblc(C_BLUE)}>tile = sprite #{sel}</div>
          <canvas
            ref={sheetRef}
            width={SHEET}
            height={SHEET}
            style={{ width: 256, height: 256, imageRendering: 'pixelated', border: `3px solid ${MID}`, borderRadius: 10, cursor: 'pointer' }}
            onPointerDown={(e) => pickSprite(e.clientX, e.clientY)}
          />
        </div>
      </div>
    </div>
  );
}

// ── AI mini-bar (shared by sprite + map editors) ──────────────────────────────
function AiMiniBar({ accent, dark, placeholder, onRun }: {
  accent: string; dark: string; placeholder: string;
  onRun: (prompt: string) => Promise<string>;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const go = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true); setStatus('thinking…');
    try {
      setStatus(await onRun(p));
    } catch (e: any) {
      setStatus(`error: ${e?.message || e}`);
    }
    setBusy(false);
  };

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      marginBottom: 14, padding: 10, borderRadius: 12,
      background: '#fff', border: `2px solid ${accent}`, boxShadow: `0 3px 0 ${dark}`,
    }}>
      <Wand2 size={16} color={accent} />
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          flex: 1, minWidth: 180, boxSizing: 'border-box', background: SCREEN_BG, color: INK,
          border: `2px solid ${MID}`, borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
          padding: '7px 10px', outline: 'none',
        }}
      />
      <button style={busy ? { ...playBtn(accent, dark), opacity: 0.6 } : playBtn(accent, dark)} onClick={go} disabled={busy}>
        <Wand2 size={14} /> {busy ? 'drawing…' : 'AI draw'}
      </button>
      {status && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, width: '100%' }}>{status}</span>}
    </div>
  );
}

// ── Code editor ───────────────────────────────────────────────────────────────
// Engine API identifiers + JS keywords offered as Tab completions.
const VOCAB: string[] = [
  // callbacks
  '_init', '_update', '_update60', '_draw',
  // graphics
  'cls', 'pset', 'pget', 'line', 'rect', 'rectfill', 'circ', 'circfill',
  'spr', 'sspr', 'map', 'mget', 'mset', 'print', 'palt', 'pal', 'camera', 'fget', 'fset',
  // input
  'btn', 'btnp', 'sfx', 'music',
  // math
  'flr', 'ceil', 'abs', 'min', 'max', 'mid', 'sqrt', 'sin', 'cos', 'atan2', 'sgn', 'rnd', 'srand',
  // keywords
  'function', 'return', 'const', 'let', 'true', 'false', 'else', 'while', 'break', 'continue',
].sort();

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*$/;

// ── Code pane = code editor (2/3) + AI assistant (1/3) ────────────────────────
function CodePane({ cart, onEdit, modelId, providerMode, providerUserId }: {
  cart: Cart; onEdit: () => void;
  modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string;
}) {
  // bump to remount the editor with fresh cart.code after the AI rewrites it
  const [gen, setGen] = useState(0);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div style={{ flex: 2, minWidth: 0, position: 'relative', borderRight: `2px solid ${MID}` }}>
        <CodeEditor key={gen} cart={cart} onEdit={onEdit} />
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <AiPane
          cart={cart}
          onApplied={() => { onEdit(); setGen((n) => n + 1); }}
          modelId={modelId}
          providerMode={providerMode}
          providerUserId={providerUserId}
        />
      </div>
    </div>
  );
}

function CodeEditor({ cart, onEdit }: { cart: Cart; onEdit: () => void }) {
  const [code, setCode] = useState(cart.code);
  const [sug, setSug] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cycle = useRef<{ base: string | null; idx: number }>({ base: null, idx: 0 });

  // Push a new value + restore the caret after React re-renders.
  const apply = (next: string, caret: number) => {
    setCode(next); cart.code = next; onEdit();
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.selectionStart = ta.selectionEnd = caret; }
    });
  };

  const refreshSug = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(WORD_RE);
    const w = m ? m[0] : '';
    setSug(w.length >= 1 ? VOCAB.filter((v) => v.startsWith(w) && v !== w).slice(0, 8) : []);
  };

  const completeWith = (pick: string) => {
    const ta = taRef.current; if (!ta) return;
    const caret = ta.selectionStart;
    const before = code.slice(0, caret);
    const w = (before.match(WORD_RE) || [''])[0];
    const start = caret - w.length;
    const next = code.slice(0, start) + pick + code.slice(ta.selectionEnd);
    cycle.current.base = null;
    setSug([]);
    apply(next, start + pick.length);
    ta.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { setSug([]); cycle.current.base = null; return; }
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const caret = ta.selectionStart;
    const w = (code.slice(0, caret).match(WORD_RE) || [''])[0];
    // (re)start the cycle when the typed word changed since the last Tab.
    if (cycle.current.base == null || !w.startsWith(cycle.current.base) || w === '') {
      cycle.current = { base: w, idx: 0 };
    }
    const base = cycle.current.base || '';
    const matches = base ? VOCAB.filter((v) => v.startsWith(base)) : [];
    if (matches.length === 0) {
      // nothing to complete → indent two spaces
      const next = code.slice(0, caret) + '  ' + code.slice(ta.selectionEnd);
      apply(next, caret + 2);
      return;
    }
    const pick = matches[cycle.current.idx % matches.length];
    cycle.current.idx++;
    const start = caret - w.length;
    const next = code.slice(0, start) + pick + code.slice(ta.selectionEnd);
    apply(next, start + pick.length);
    setSug(matches.filter((v) => v !== pick).slice(0, 8));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, padding: '2px 8px', borderRadius: 4, background: INK, color: SHELL }}>JavaScript</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>moteur 8-bit — _update() &amp; _draw()</span>
      </div>
      <textarea
        ref={taRef}
        value={code}
        spellCheck={false}
        onChange={(e) => { setCode(e.target.value); cart.code = e.target.value; onEdit(); cycle.current.base = null; refreshSug(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onClick={(e) => refreshSug(code, e.currentTarget.selectionStart)}
        onKeyUp={(e) => { if (!['Tab', 'Shift'].includes(e.key)) refreshSug(code, e.currentTarget.selectionStart); }}
        style={{
          flex: 1, width: '100%', resize: 'none', boxSizing: 'border-box',
          background: SCREEN_BG, color: INK, border: `2px solid ${MID}`, borderRadius: 6,
          fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5, padding: 12, outline: 'none',
        }}
      />
      <div style={{ minHeight: 24, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {sug.length > 0 ? (
          <>
            <span style={{ fontSize: 11, opacity: 0.6 }}>Tab:</span>
            {sug.map((s) => (
              <button key={s} style={sugChip} onMouseDown={(e) => { e.preventDefault(); completeWith(s); }}>{s}</button>
            ))}
          </>
        ) : (
          <span style={{ fontSize: 11, opacity: 0.4 }}>type an API name, press Tab to complete / cycle</span>
        )}
      </div>
    </div>
  );
}

// ── AI pane (text-to-cart) ────────────────────────────────────────────────────
function AiPane({ cart, onApplied, modelId, providerMode, providerUserId }: {
  cart: Cart; onApplied: () => void;
  modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const generate = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true); setStatus('thinking…');
    let full = '';
    try {
      const user = `Write a cart for: ${p}\n\nHere is the current cart code (extend or replace it):\n\`\`\`js\n${cart.code}\n\`\`\``;
      for await (const ev of agentStream({
        messages: [{ role: 'user', content: user }],
        modelId,
        providerMode,
        providerUserId,
        toolMode: 'chat_only',
        extraSystemInstructions: AUTHOR_SPEC,
      })) {
        if (ev.type === 'done' && typeof ev.data === 'string') full = ev.data;
        else if (ev.type === 'error') setStatus(`error: ${ev.message || 'failed'}`);
      }
    } catch (e: any) {
      setStatus(`error: ${e?.message || e}`);
      setBusy(false);
      return;
    }
    const code = extractCode(full);
    if (!code) { setStatus('model returned no code block. try again.'); setBusy(false); return; }
    cart.code = code;
    setStatus('applied ✓');
    setBusy(false);
    onApplied();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
      <div style={{ fontSize: 13, opacity: 0.85 }}>
        Describe the game. The model writes the cart code (it can only use the engine API — sandboxed).
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. a snake that grows when it eats yellow dots, speeds up over time, game over on self-collision"
        style={{
          flex: 1, resize: 'none', boxSizing: 'border-box', background: SCREEN_BG, color: INK,
          border: `2px solid ${MID}`, borderRadius: 6, fontFamily: 'monospace', fontSize: 13,
          padding: 12, outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={busy ? { ...btnWide, opacity: 0.6 } : btnWide} onClick={generate} disabled={busy}>
          <Wand2 size={15} /> {busy ? 'generating…' : 'generate'}
        </button>
        {status && <span style={{ fontSize: 12, opacity: 0.8 }}>{status}</span>}
      </div>
    </div>
  );
}

/** Pull the first fenced code block (```js / ```ts / ```), else fall back to whole text. */
function extractCode(text: string): string {
  if (!text) return '';
  const fence = text.match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  // no fence: if it looks like code (has a function), take it raw
  if (/function\s+_(?:init|update|draw)/.test(text)) return text.trim();
  return '';
}

// ── doc tab ─────────────────────────────────────────────────────────────────

const EX_SIDE = `// Vue de cote — plateforme. Fleches gauche/droite, O pour sauter.
let x = 20, y = 90, vy = 0;
let onGround = false;
const GROUND = 110;

function _update() {
  if (btn(0)) x -= 2;
  if (btn(1)) x += 2;
  vy += 0.5;                 // gravite
  y += vy;
  if (y >= GROUND) { y = GROUND; vy = 0; onGround = true; }
  else onGround = false;
  if (btnp(4) && onGround) vy = -7;   // saut sur O
  x = mid(0, x, 120);
}

function _draw() {
  cls(12);                   // ciel bleu
  rectfill(0, GROUND + 8, 127, 127, 3);   // sol vert
  rectfill(x, y, x + 7, y + 7, 8);        // joueur rouge
  print("plateforme", 4, 4, 7);
}
`;

const EX_TOP = `// Vue de dessus — 4 directions. Fleches pour bouger.
let x = 60, y = 60;

function _update() {
  if (btn(0)) x -= 2;
  if (btn(1)) x += 2;
  if (btn(2)) y -= 2;
  if (btn(3)) y += 2;
  x = mid(0, x, 120);
  y = mid(0, y, 120);
}

function _draw() {
  cls(3);                    // herbe
  rectfill(40, 40, 88, 88, 4);   // chemin de terre
  circfill(x + 3, y + 3, 4, 9);  // joueur
  print("vue de dessus", 4, 4, 7);
}
`;

const EX_CAMERA = `// Gestion camera — monde plus grand que l'ecran (256x256).
// La camera suit le joueur, puis on la remet a 0 pour le HUD.
let x = 120, y = 120;
const WORLD = 256;

function _update() {
  if (btn(0)) x -= 2;
  if (btn(1)) x += 2;
  if (btn(2)) y -= 2;
  if (btn(3)) y += 2;
  x = mid(0, x, WORLD - 8);
  y = mid(0, y, WORLD - 8);
}

function _draw() {
  cls(1);
  // centre la camera sur le joueur, bornee au monde
  let cx = mid(0, x - 60, WORLD - 128);
  let cy = mid(0, y - 60, WORLD - 128);
  camera(cx, cy);
  // reperes du monde (grille de points)
  for (let gx = 0; gx < WORLD; gx += 16)
    for (let gy = 0; gy < WORLD; gy += 16)
      pset(gx, gy, 5);
  rectfill(0, 0, 7, 7, 8);              // coin haut-gauche du monde
  rectfill(WORLD - 8, WORLD - 8, WORLD - 1, WORLD - 1, 11);
  rectfill(x, y, x + 7, y + 7, 10);     // joueur
  camera();                              // reset avant le HUD
  print("camera suit le joueur", 4, 4, 7);
}
`;

const EX_COLLECT = `// Jeu simple — ramasse les points. Touche un point = +1 score.
let x = 60, y = 60, score = 0;
let dx = 40, dy = 40;

function _update() {
  if (btn(0)) x -= 2;
  if (btn(1)) x += 2;
  if (btn(2)) y -= 2;
  if (btn(3)) y += 2;
  x = mid(0, x, 120);
  y = mid(0, y, 120);
  // collision simple boite
  if (abs((x + 4) - (dx + 2)) < 6 && abs((y + 4) - (dy + 2)) < 6) {
    score += 1;
    dx = flr(rnd(118)) + 4;
    dy = flr(rnd(108)) + 14;
  }
}

function _draw() {
  cls(0);
  circfill(dx + 2, dy + 2, 3, 10);   // point a ramasser
  rectfill(x, y, x + 7, y + 7, 12);  // joueur
  print("score " + score, 4, 4, 7);
}
`;

const EX_PONG = `// Jeu simple — balle qui rebondit, raquette en bas (gauche/droite).
let bx = 64, by = 30, vx = 2, vy = 2;
let px = 52;

function _update() {
  if (btn(0)) px -= 3;
  if (btn(1)) px += 3;
  px = mid(0, px, 104);
  bx += vx; by += vy;
  if (bx < 2 || bx > 125) vx = -vx;
  if (by < 2) vy = -vy;
  // rebond sur la raquette
  if (by > 116 && by < 122 && bx > px && bx < px + 24) vy = -abs(vy);
  if (by > 127) { bx = 64; by = 30; vy = 2; }  // perdu : reset
}

function _draw() {
  cls(0);
  rectfill(px, 120, px + 24, 124, 11);  // raquette
  circfill(bx, by, 2, 8);               // balle
  print("pong", 4, 4, 7);
}
`;

function DocSection({ title, body, code, onLoad }: { title: string; body: string; code?: string; onLoad: (c: string) => void }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 6px', color: C_INDIGO, fontWeight: 800 }}>{title}</h3>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, opacity: 0.85, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{body}</p>
      {code && (
        <>
          <pre style={{ margin: '0 0 8px', padding: 10, background: 'rgba(0,0,0,0.06)', border: `1px solid ${MID}`, borderRadius: 6, fontSize: 11.5, lineHeight: 1.45, overflowX: 'auto' }}>{code}</pre>
          <button style={btnWide} onClick={() => onLoad(code)}>charger dans l'editeur</button>
        </>
      )}
    </section>
  );
}

function DocPane({ onLoad }: { onLoad: (code: string) => void }) {
  const [sub, setSub] = useState<'guide' | 'api'>('guide');
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['guide', 'api'] as const).map((s) => {
            const on = sub === s;
            const col = s === 'guide' ? C_INDIGO : C_GREEN;
            const dk = s === 'guide' ? D_BLUE : D_GREEN;
            return (
              <button
                key={s}
                onClick={() => setSub(s)}
                style={{
                  ...tabBtn, padding: '6px 18px',
                  color: on ? '#fff' : INK, background: on ? col : '#fff', borderColor: col,
                  boxShadow: on ? `0 3px 0 ${dk}` : 'none', transform: on ? 'translateY(-1px)' : 'none',
                }}
              >
                {s === 'guide' ? 'guide' : 'api'}
              </button>
            );
          })}
        </div>
        {sub === 'api' ? <ApiReference /> : <DocGuide onLoad={onLoad} />}
      </div>
    </div>
  );
}

function DocGuide({ onLoad }: { onLoad: (code: string) => void }) {
  return (
    <>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Documentation — debuter</h2>
        <p style={{ fontSize: 12.5, opacity: 0.75, margin: '0 0 20px' }}>
          Charge un exemple, lance-le dans l'onglet RUN, puis modifie le code dans l'onglet CODE.
        </p>

        <DocSection
          title="Les bases"
          body={`Un cart = du code JavaScript avec deux fonctions appelees par le moteur :
  _update()  ->  60x par seconde, la logique (deplacement, collisions).
  _draw()    ->  chaque image, le dessin (efface puis redessine tout).

Ecran 128x128 pixels, 16 couleurs (index 0..15). Outils de dessin :
  cls(c)                efface l'ecran en couleur c
  pset(x,y,c)           un pixel
  line / rect / rectfill / circ / circfill
  print(txt, x, y, c)   du texte
  spr(n, x, y)          dessine le sprite n (onglet SPRITE)

Entrees (un seul joueur) : btn(b) = bouton tenu, btnp(b) = appui ce frame.
  0 gauche  1 droite  2 haut  3 bas  4 O  5 X

Maths utiles : flr, abs, min, max, mid(lo,v,hi) (clamp), rnd(n), sin, cos.`}
          onLoad={onLoad}
        />

        <DocSection
          title="Exemple — jeu vue de cote (plateforme)"
          body="Gravite + saut. La vitesse verticale vy augmente chaque frame (chute), le saut la met a une valeur negative quand on est au sol."
          code={EX_SIDE}
          onLoad={onLoad}
        />

        <DocSection
          title="Exemple — jeu vue de dessus"
          body="Deplacement libre dans 4 directions. Pas de gravite : haut/bas bougent y directement."
          code={EX_TOP}
          onLoad={onLoad}
        />

        <DocSection
          title="Gestion de la camera"
          body={`camera(x, y) decale tout ce qui est dessine ensuite. Pour suivre le joueur dans un monde plus grand que l'ecran : centre la camera sur lui, bornee aux limites du monde, puis appelle camera() sans argument avant de dessiner le HUD (score, vie) pour le coller a l'ecran.`}
          code={EX_CAMERA}
          onLoad={onLoad}
        />

        <DocSection
          title="Jeu simple — ramasser des points"
          body="Boucle de jeu complete : deplacement, collision boite-a-boite, score, respawn aleatoire de la cible."
          code={EX_COLLECT}
          onLoad={onLoad}
        />

        <DocSection
          title="Jeu simple — pong"
          body="Balle qui rebondit sur les bords et sur une raquette. Inverser vx/vy = rebondir. Sortie en bas = reset."
          code={EX_PONG}
          onLoad={onLoad}
        />
    </>
  );
}

// Full engine API surface, grouped. Signatures match gfx.ts / mathlib.ts /
// cart-worker.ts exactly; descriptions stay French (user-facing UI doc).
type ApiRow = [sig: string, desc: string];
const API_GROUPS: Array<{ title: string; color: string; rows: ApiRow[] }> = [
  {
    title: 'Callbacks', color: C_INDIGO, rows: [
      ['_init()', 'appele une fois au demarrage. Initialise tes variables.'],
      ['_update()', '30x/seconde : toute la logique (deplacements, collisions, score).'],
      ['_update60()', 'variante 60x/seconde. Si presente, remplace _update().'],
      ['_draw()', 'chaque image : dessine la scene (commence souvent par cls()).'],
    ],
  },
  {
    title: 'Graphismes', color: C_GREEN, rows: [
      ['cls(c=0)', 'efface tout l\'ecran avec la couleur c.'],
      ['pset(x,y,c)', 'allume le pixel (x,y).'],
      ['pget(x,y)', 'renvoie l\'index couleur du pixel (x,y).'],
      ['line(x0,y0,x1,y1,c)', 'trace une ligne.'],
      ['rect(x0,y0,x1,y1,c)', 'rectangle vide (contour).'],
      ['rectfill(x0,y0,x1,y1,c)', 'rectangle plein.'],
      ['circ(x,y,r,c)', 'cercle vide de rayon r.'],
      ['circfill(x,y,r,c)', 'cercle plein.'],
      ['print(txt,x,y,c)', 'ecrit du texte (police 4x6).'],
      ['camera(x,y)', 'decale tous les dessins suivants de (-x,-y). Sans argument : remet a zero (pour le HUD).'],
      ['pal(de,vers)', 'remplace la couleur "de" par "vers" au dessin. Sans argument : reinitialise.'],
      ['palt(c,t)', 'rend la couleur c transparente (t=true) ou non. Sans argument : seul 0 transparent.'],
    ],
  },
  {
    title: 'Sprites & Map', color: C_PINK, rows: [
      ['spr(n,x,y,fx,fy)', 'dessine le sprite n (8x8) en (x,y). fx/fy = miroir horizontal/vertical.'],
      ['sspr(sx,sy,sw,sh,dx,dy,dw,dh)', 'dessine une zone de la feuille, etiree vers (dx,dy) en taille dw x dh.'],
      ['map(cx,cy,sx,sy,cw,ch)', 'dessine cw x ch tuiles de la map (depuis la cellule cx,cy) a l\'ecran en (sx,sy).'],
      ['mget(cx,cy)', 'renvoie le n de sprite pose sur la tuile (cx,cy).'],
      ['mset(cx,cy,n)', 'pose le sprite n sur la tuile (cx,cy).'],
      ['fget(n,f)', 'renvoie le flag f du sprite n (ou tous les flags si f omis).'],
      ['fset(n,f,v)', 'definit le flag f du sprite n a v.'],
    ],
  },
  {
    title: 'Entrees', color: C_ORANGE, rows: [
      ['btn(b)', 'vrai tant que le bouton b est tenu.'],
      ['btnp(b)', 'vrai seulement a l\'instant de l\'appui (un seul frame).'],
      ['boutons', '0 gauche · 1 droite · 2 haut · 3 bas · 4 O · 5 X.'],
    ],
  },
  {
    title: 'Maths', color: C_BLUE, rows: [
      ['flr(x) · ceil(x) · abs(x)', 'arrondi bas, arrondi haut, valeur absolue.'],
      ['min(a,b) · max(a,b)', 'plus petit / plus grand.'],
      ['mid(a,b,c)', 'valeur du milieu = clamp (borne une valeur entre deux limites).'],
      ['sqrt(x) · sgn(x)', 'racine carree (negatif -> 0), signe (-1 / 0 / 1).'],
      ['rnd(n=1) · srand(g)', 'aleatoire 0..n ; srand fixe la graine (suite reproductible).'],
      ['sin(t) · cos(t) · atan2(dx,dy)', 'angles en TOURS (0..1), pas en radians.'],
    ],
  },
  {
    title: 'Son (v1 : reserve)', color: C_YELLOW, rows: [
      ['sfx(n)', 'effet sonore — silencieux pour l\'instant.'],
      ['music(n)', 'musique — silencieuse pour l\'instant.'],
    ],
  },
];

// 16 fixed palette colours, with the index you pass to the draw ops.
const PALETTE_NAMES = [
  'transparent', 'bleu nuit', 'violet', 'vert fonce', 'brun', 'gris fonce', 'gris clair', 'blanc',
  'rouge', 'orange', 'jaune', 'vert', 'bleu', 'indigo', 'rose', 'peche',
];

function ApiGroup({ title, color, rows }: { title: string; color: string; rows: ApiRow[] }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px', color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(([sig, desc], i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', padding: '5px 8px', borderRadius: 8, background: i % 2 ? 'transparent' : 'rgba(0,0,0,0.035)' }}>
            <code style={{ fontSize: 12, fontWeight: 800, color: INK, whiteSpace: 'pre-wrap' }}>{sig}</code>
            <span style={{ fontSize: 12, opacity: 0.78, flex: '1 1 240px' }}>{desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApiReference() {
  return (
    <>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>API — reference complete</h2>
      <p style={{ fontSize: 12.5, opacity: 0.75, margin: '0 0 6px' }}>
        Toutes les fonctions du moteur, utilisables directement dans le code du cart.
      </p>
      <p style={{ fontSize: 11.5, opacity: 0.6, margin: '0 0 20px' }}>
        Ecran 128x128 · 16 couleurs (index 0..15) · 256 sprites 8x8 · map 128x32 tuiles. Le parametre c
        est l'index de couleur ci-dessous.
      </p>

      {API_GROUPS.map((g) => <ApiGroup key={g.title} title={g.title} color={g.color} rows={g.rows} />)}

      <section style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px', color: C_PINK, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>Palette (16 couleurs)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
          {PALETTE_NAMES.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 8, background: 'rgba(0,0,0,0.035)' }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: `1px solid ${MID}`, background: i === 0 ? 'transparent' : cssColor(i), backgroundImage: i === 0 ? 'repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%)' : undefined, backgroundSize: i === 0 ? '8px 8px' : undefined }} />
              <code style={{ fontSize: 11.5, fontWeight: 800, color: INK, width: 14 }}>{i.toString(16)}</code>
              <span style={{ fontSize: 11.5, opacity: 0.78 }}>{name}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// Multi-colour wordmark — each glyph a different 8-bit palette colour.
function RainbowTitle({ text }: { text: string }) {
  const cols = [C_RED, C_ORANGE, C_YELLOW, C_GREEN, C_BLUE, C_INDIGO, C_PINK];
  let n = 0;
  return (
    <span style={{ fontWeight: 900, letterSpacing: 1.5, fontSize: 15 }}>
      {text.split('').map((ch, i) => (
        <span key={i} style={{ color: ch === ' ' ? 'transparent' : cols[(n++) % cols.length] }}>{ch}</span>
      ))}
    </span>
  );
}

// ── shared styles ───────────────────────────────────────────────────────────
// Chunky "pressable" filled button — the playground primitive. Bright fill,
// white text, a darker twin as a 3D bottom edge.
function playBtn(color: string, dark: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px',
    border: 'none', borderRadius: 10, background: color, color: '#fff', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
    boxShadow: `0 3px 0 ${dark}`,
  };
}
// A rounded card wrapping each editor canvas, tinted with the tab's accent.
function panel(accent: string): React.CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14,
    background: '#fff', border: `2px solid ${accent}`, boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  };
}
// Bold coloured caption.
function lblc(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color, marginBottom: 4, textTransform: 'uppercase' };
}

const page: React.CSSProperties = { position: 'absolute', inset: 0, background: SHELL, color: INK, display: 'flex', flexDirection: 'column', fontFamily: 'monospace' };
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `3px solid ${C_YELLOW}` };
const tabRow: React.CSSProperties = { display: 'flex', gap: 8, padding: '10px 14px', flexWrap: 'wrap' };
const lbl: React.CSSProperties = { fontSize: 11, opacity: 0.7, marginBottom: 6 };
const iconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: `2px solid ${INK}`, borderRadius: 10, background: '#fff', color: INK, cursor: 'pointer' };
const btnWide: React.CSSProperties = playBtn(C_GREEN, D_GREEN);
const miniBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 30, padding: '0 10px', border: `2px solid ${MID}`, borderRadius: 8, background: '#fff', color: INK, cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const miniLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: INK, cursor: 'pointer', fontSize: 11, fontWeight: 700, textDecoration: 'underline' };
const sugChip: React.CSSProperties = { padding: '3px 10px', border: `2px solid ${C_ORANGE}`, borderRadius: 999, background: '#fff', color: INK, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700 };
const tabBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', border: '2px solid', borderRadius: 999, cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 };
const nameInput: React.CSSProperties = { background: '#fff', border: `2px solid ${C_YELLOW}`, borderRadius: 10, color: INK, fontFamily: 'monospace', fontSize: 14, fontWeight: 700, padding: '6px 10px', maxWidth: 220 };
const card: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: `2px solid ${C_BLUE}`, borderRadius: 14, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' };
const thumbBox: React.CSSProperties = { aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SCREEN_BG, border: `2px solid ${INK}`, borderRadius: 10, overflow: 'hidden' };
