import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Power, RotateCcw, Crosshair } from 'lucide-react';
import { api } from '../api';
import {
  createGame, tick, sideOf, creditCap, powerStatus, entitiesOf, terrainAt,
  issueBuild, placeBuilding, issueMove, issueAttackTarget, cancelBuild, applyEnemyPlan,
  fireSuperweapon, serialize, deserialize, canBuild, visibleTo,
} from '../game/rts/state';
import { summarizeWorld, fallbackPlan, resolvePlan, planVocabulary } from '../game/rts/enemy';
import {
  spec, TICK_HZ, ALL_BUILDING_ROLES, ALL_UNIT_ROLES, DIFFICULTY_PRESETS, isBuildingRole,
  roleDesc, requirementNames,
} from '../game/rts/data';
import { drawSprite } from '../game/rts/sprites';
import type {
  RtsState, Faction, BuildingRole, UnitRole, EntityKind, Entity,
} from '../game/rts/types';

// Theme-tinted DMG ramp (see ChessConsole) plus a few literal terrain hues so the
// battlefield reads at a glance regardless of theme.
const SHELL = 'var(--gb-shell)';
const SCREEN_BG = 'var(--gb-screen)';
const INK = 'var(--gb-ink)';
const MID = 'var(--gb-mid)';
const C_GROUND = '#3b4a32';
const C_WATER = '#26415a';
const C_ROCK = '#2a2622';
const C_ORE = '#b89030';

const RT = 24;                 // render pixels per tile (x4-ish zoom for readable sprites)
const SAVE_KEY = 'monkey:rts:v1';

interface Props {
  onExit: () => void;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

function loadSaved(): RtsState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return deserialize(raw);
  } catch { return null; }
}

export default function RtsConsole({ onExit, modelId, providerMode, providerUserId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<RtsState | null>(loadSaved());
  const [hasGame, setHasGame] = useState(!!stateRef.current);

  // UI mirror state, refreshed at a few Hz from the sim (the canvas redraws on rAF).
  const [, setUiTick] = useState(0);
  const selectedRef = useRef<Set<number>>(new Set());
  const camRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const ghostRef = useRef<BuildingRole | null>(null);
  const [ghost, setGhost] = useState<BuildingRole | null>(null);
  const superTargetRef = useRef(false);
  const [superArming, setSuperArming] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; cur: { x: number; y: number } } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  // enemy brain bookkeeping
  const lastApplyRef = useRef(0);
  const lastReplanRef = useRef(0);
  const replanInFlight = useRef(false);

  // ── New game / setup overlay ────────────────────────────────────────────────
  const startGame = useCallback((faction: Faction, difficulty: keyof typeof DIFFICULTY_PRESETS) => {
    const seed = Math.floor(Math.random() * 1e9);
    const s = createGame(seed, faction, difficulty);
    s.enemy.plan = fallbackPlan(s, 'enemy');
    stateRef.current = s;
    selectedRef.current = new Set();
    // Centre camera on the player's start.
    const hq = entitiesOf(s, 'player').find(e => e.role === 'hq');
    if (hq) camRef.current = { x: Math.max(0, hq.x - 12), y: Math.max(0, hq.y - 10) };
    lastApplyRef.current = 0; lastReplanRef.current = 0;
    setHasGame(true);
    setUiTick(n => n + 1);
  }, []);

  // Centre camera once on a restored game.
  useEffect(() => {
    const s = stateRef.current;
    if (s && hasGame) {
      const hq = entitiesOf(s, 'player').find(e => e.role === 'hq');
      if (hq) camRef.current = { x: Math.max(0, hq.x - 12), y: Math.max(0, hq.y - 10) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Enemy commander (LLM) refresh — async, never blocks the sim ──────────────
  const doReplan = useCallback(async () => {
    const s = stateRef.current;
    if (!s || replanInFlight.current || s.winner) return;
    replanInFlight.current = true;
    try {
      const view = summarizeWorld(s, 'enemy');
      const vocab = planVocabulary();
      const res = await api.rtsEnemyPlan(view, vocab, { modelId, providerMode, providerUserId });
      const resolved = resolvePlan(s, res.plan, 'enemy');
      s.enemy.plan = resolved.plan;
    } catch {
      // keep the standing plan; deterministic behaviour continues
      if (!s.enemy.plan) s.enemy.plan = fallbackPlan(s, 'enemy');
    } finally {
      replanInFlight.current = false;
    }
  }, [modelId, providerMode, providerUserId]);

  // ── Main loop: fixed sim tick + rAF render ──────────────────────────────────
  useEffect(() => {
    if (!hasGame) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const STEP = 1000 / TICK_HZ;

    const frame = (now: number) => {
      const s = stateRef.current;
      if (!s) { raf = requestAnimationFrame(frame); return; }
      acc += now - last; last = now;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        if (!s.winner) {
          tick(s);
          driveEnemyBrain(s);
        }
        acc -= STEP; steps++;
      }
      panFromKeys(s);
      render(s);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGame]);

  function driveEnemyBrain(s: RtsState) {
    if (!s.enemy.plan) s.enemy.plan = fallbackPlan(s, 'enemy');
    // Act on the standing plan every ~2.5s (cheap, deterministic).
    if (s.tick - lastApplyRef.current >= Math.floor(TICK_HZ * 2.5)) {
      applyEnemyPlan(s, s.enemy.plan ?? fallbackPlan(s, 'enemy'));
      lastApplyRef.current = s.tick;
    }
    // Re-ask the LLM on its cadence.
    const period = Math.max(8, s.difficulty.replanEverySec) * TICK_HZ;
    if (s.tick - lastReplanRef.current >= period) {
      lastReplanRef.current = s.tick;
      void doReplan();
    }
  }

  // ── UI mirror refresh + periodic save ───────────────────────────────────────
  useEffect(() => {
    if (!hasGame) return;
    const ui = setInterval(() => setUiTick(n => n + 1), 200);
    const save = setInterval(() => {
      const s = stateRef.current;
      if (s) { try { localStorage.setItem(SAVE_KEY, serialize(s)); } catch { /* ignore */ } }
    }, 4000);
    return () => { clearInterval(ui); clearInterval(save); };
  }, [hasGame]);

  // Save on unmount too.
  useEffect(() => () => {
    const s = stateRef.current;
    if (s) { try { localStorage.setItem(SAVE_KEY, serialize(s)); } catch { /* ignore */ } }
  }, []);

  // ── Keyboard camera pan ─────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => keysRef.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  function panFromKeys(s: RtsState) {
    const k = keysRef.current;
    const cam = camRef.current;
    const sp = 0.5;
    if (k.has('arrowleft') || k.has('a')) cam.x -= sp;
    if (k.has('arrowright') || k.has('d')) cam.x += sp;
    if (k.has('arrowup') || k.has('w')) cam.y -= sp;
    if (k.has('arrowdown') || k.has('s')) cam.y += sp;
    const cv = canvasRef.current;
    const viewW = cv ? cv.width / RT : 30;
    const viewH = cv ? cv.height / RT : 24;
    cam.x = Math.max(0, Math.min(s.w - viewW, cam.x));
    cam.y = Math.max(0, Math.min(s.h - viewH, cam.y));
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  function screenToTile(px: number, py: number): { x: number; y: number } {
    const cam = camRef.current;
    return { x: cam.x + px / RT, y: cam.y + py / RT };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function render(s: RtsState) {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // Resize to container.
    const parent = cv.parentElement;
    if (parent && (cv.width !== parent.clientWidth || cv.height !== parent.clientHeight)) {
      cv.width = parent.clientWidth; cv.height = parent.clientHeight;
    }
    const cam = camRef.current;
    const cols = Math.ceil(cv.width / RT) + 1;
    const rows = Math.ceil(cv.height / RT) + 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cv.width, cv.height);

    const x0 = Math.floor(cam.x), y0 = Math.floor(cam.y);
    const offX = (cam.x - x0) * RT, offY = (cam.y - y0) * RT;

    // Terrain + fog.
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const tx = x0 + rx, ty = y0 + ry;
        if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) continue;
        const fog = s.fog.player[ty * s.w + tx];
        if (fog === 0) continue; // unseen → stays black
        const t = terrainAt(s, tx, ty);
        ctx.fillStyle = t === 'water' ? C_WATER : t === 'rock' ? C_ROCK : t === 'ore' ? C_ORE : C_GROUND;
        const px = rx * RT - offX, py = ry * RT - offY;
        ctx.fillRect(px, py, RT, RT);
        if (fog === 1) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(px, py, RT, RT); } // explored dim
      }
    }

    // Entities. Player always; enemy only where currently visible.
    const now = performance.now();
    const drawEntity = (e: Entity) => {
      if (e.owner === 'enemy' && !visibleTo(s, 'player', e.x, e.y)) return;
      const px = (e.x - cam.x) * RT, py = (e.y - cam.y) * RT;
      if (px < -2 * RT || py < -2 * RT || px > cv.width + 2 * RT || py > cv.height + 2 * RT) return;
      const S = e.isBuilding ? RT * 2.0 : RT * 1.5;
      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(px, py + S * 0.42, S * 0.32, S * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(Math.round(px - S / 2), Math.round(py - S / 2));
      ctx.globalAlpha = e.buildLeft > 0 ? 0.5 : 1;
      ctx.imageSmoothingEnabled = false;
      drawSprite(ctx, e.role, e.faction, e.owner, S, now);
      ctx.globalAlpha = 1;
      ctx.restore();
      // build progress ring for buildings still under construction
      if (e.isBuilding && e.buildLeft > 0) {
        const tot = Math.max(1, spec(e.role, e.faction).buildTicks);
        const frac = 1 - e.buildLeft / tot;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(px, py, S * 0.45, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      // selection ring
      if (selectedRef.current.has(e.id)) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.strokeRect(px - S * 0.5, py - S * 0.5, S, S);
      }
      // hp bar (damaged only)
      if (e.hp < e.maxHp) {
        const w = S * 0.8, h = 3;
        ctx.fillStyle = '#400'; ctx.fillRect(px - w / 2, py - S * 0.6, w, h);
        ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#5d5' : '#d55';
        ctx.fillRect(px - w / 2, py - S * 0.6, w * (e.hp / e.maxHp), h);
      }
    };
    // buildings first, then units on top
    for (const e of entitiesOf(s, 'player').concat(entitiesOf(s, 'enemy'))) if (e.isBuilding) drawEntity(e);
    for (const e of entitiesOf(s, 'player').concat(entitiesOf(s, 'enemy'))) if (!e.isBuilding) drawEntity(e);

    // Box-select rectangle.
    const d = dragRef.current;
    if (d) {
      const x = Math.min(d.sx, d.cur.x), y = Math.min(d.sy, d.cur.y);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, Math.abs(d.cur.x - d.sx), Math.abs(d.cur.y - d.sy));
    }
  }

  // ── Mouse input ─────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((ev: React.MouseEvent) => {
    const s = stateRef.current; if (!s) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const tile = screenToTile(px, py);

    // Superweapon targeting takes priority.
    if (superTargetRef.current && ev.button === 0) {
      fireSuperweapon(s, 'player', Math.floor(tile.x), Math.floor(tile.y));
      superTargetRef.current = false; setSuperArming(false);
      return;
    }
    // Building placement.
    if (ghostRef.current && ev.button === 0) {
      const okp = placeBuilding(s, 'player', ghostRef.current, Math.floor(tile.x), Math.floor(tile.y));
      if (okp) { ghostRef.current = null; setGhost(null); }
      return;
    }
    if (ev.button === 0) {
      dragRef.current = { sx: px, sy: py, cur: { x: px, y: py } };
    } else if (ev.button === 2) {
      // Right-click: command selected units.
      ev.preventDefault();
      commandSelected(s, tile.x, tile.y);
    }
  }, []);

  const onMouseMove = useCallback((ev: React.MouseEvent) => {
    const d = dragRef.current; if (!d) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    d.cur = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }, []);

  const onMouseUp = useCallback((ev: React.MouseEvent) => {
    const s = stateRef.current; const d = dragRef.current;
    if (!s || !d) return;
    dragRef.current = null;
    const moved = Math.hypot(d.cur.x - d.sx, d.cur.y - d.sy);
    const add = ev.shiftKey;
    if (!add) selectedRef.current.clear();
    if (moved < 5) {
      // single click select
      const t = screenToTile(d.sx, d.sy);
      const e = pickEntity(s, t.x, t.y);
      if (e && e.owner === 'player' && !e.isBuilding) selectedRef.current.add(e.id);
    } else {
      // box select player units
      const a = screenToTile(Math.min(d.sx, d.cur.x), Math.min(d.sy, d.cur.y));
      const b = screenToTile(Math.max(d.sx, d.cur.x), Math.max(d.sy, d.cur.y));
      for (const e of entitiesOf(s, 'player')) {
        if (e.isBuilding) continue;
        if (e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y) selectedRef.current.add(e.id);
      }
    }
    setUiTick(n => n + 1);
  }, []);

  function commandSelected(s: RtsState, tx: number, ty: number) {
    const ids = [...selectedRef.current];
    if (ids.length === 0) return;
    const tgt = pickEntity(s, tx, ty);
    if (tgt && tgt.owner === 'enemy' && visibleTo(s, 'player', tgt.x, tgt.y)) {
      issueAttackTarget(s, ids, tgt.id);
    } else {
      issueMove(s, ids, Math.floor(tx), Math.floor(ty), true); // attack-move by default
    }
  }

  function pickEntity(s: RtsState, tx: number, ty: number): Entity | null {
    let best: Entity | null = null, bd = 0.9;
    for (const e of entitiesOf(s, 'player').concat(entitiesOf(s, 'enemy'))) {
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ── Build button handlers ───────────────────────────────────────────────────
  const onBuild = useCallback((role: EntityKind) => {
    const s = stateRef.current; if (!s) return;
    if (isBuildingRole(role)) {
      ghostRef.current = role; setGhost(role);
    } else {
      issueBuild(s, 'player', role as UnitRole);
      setUiTick(n => n + 1);
    }
  }, []);

  const onCancelJob = useCallback((i: number) => {
    const s = stateRef.current; if (!s) return;
    cancelBuild(s, 'player', i); setUiTick(n => n + 1);
  }, []);

  const armSuper = useCallback(() => {
    superTargetRef.current = true; setSuperArming(true);
  }, []);

  // ── Setup overlay ───────────────────────────────────────────────────────────
  if (!hasGame) {
    return <SetupOverlay onStart={startGame} onExit={onExit} />;
  }

  const s = stateRef.current!;
  const pwr = powerStatus(s, 'player');
  const cap = creditCap(s, 'player');
  const credits = Math.min(sideOf(s, 'player').credits, cap);
  const superReady = sideOf(s, 'player').superweapons.some(w => w.cooldownLeft <= 0);
  const queue = sideOf(s, 'player').queue;
  const enemyTaunt = sideOf(s, 'enemy').plan?.taunt || '';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      className="flex flex-1 overflow-hidden" style={{ background: SHELL }}
    >
      {/* Battlefield */}
      <div className="relative flex-1 min-h-0" style={{ background: '#000' }}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{ cursor: ghost || superArming ? 'crosshair' : 'default' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* top bar */}
        <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-3 py-1.5"
          style={{ color: INK, background: 'rgba(0,0,0,0.35)', fontFamily: 'monospace' }}>
          <span className="text-[10px] font-bold tracking-[0.2em]" style={{ color: '#cfe' }}>MONKEY · IRON MARSH</span>
          <div className="flex items-center gap-2">
            <button onClick={() => { localStorage.removeItem(SAVE_KEY); setHasGame(false); }}
              title="New game" className="flex items-center justify-center rounded"
              style={{ background: MID, color: INK, width: 24, height: 24 }}>
              <RotateCcw size={14} />
            </button>
            <button onClick={onExit} title="Power off" className="flex items-center justify-center rounded"
              style={{ background: '#7a1f1f', color: '#f0d0d0', width: 24, height: 24 }}>
              <Power size={14} />
            </button>
          </div>
        </div>
        {/* taunt / winner */}
        {enemyTaunt && !s.winner && (
          <div className="absolute left-1/2 top-9 -translate-x-1/2 rounded px-3 py-1 text-[11px]"
            style={{ background: 'rgba(120,30,40,0.8)', color: '#fdd', fontFamily: 'monospace', maxWidth: '70%' }}>
            ☡ {enemyTaunt}
          </div>
        )}
        {s.winner && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
            <div className="text-center" style={{ fontFamily: 'monospace', color: '#fff' }}>
              <div className="text-2xl font-bold tracking-widest">
                {s.winner === 'player' ? 'VICTORY' : 'DEFEAT'}
              </div>
              <button onClick={() => { localStorage.removeItem(SAVE_KEY); setHasGame(false); }}
                className="mt-3 rounded px-4 py-1.5 text-xs" style={{ background: MID, color: INK }}>
                NEW BATTLE
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="flex w-44 flex-col gap-2 overflow-y-auto p-2"
        style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
        <div className="rounded px-2 py-1 text-[11px]" style={{ background: SCREEN_BG }}>
          <div className="flex justify-between"><span>CREDITS</span><span>{credits}/{cap}</span></div>
          <div className="mt-1 flex justify-between text-[10px]">
            <span>POWER</span><span>{pwr.supply}/{pwr.draw}</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded" style={{ background: '#333' }}>
            <div style={{
              width: `${Math.min(100, pwr.draw === 0 ? 100 : (pwr.supply / pwr.draw) * 100)}%`,
              height: '100%',
              background: pwr.ratio >= 1 ? '#5d5' : pwr.ratio >= 0.5 ? '#dd5' : '#d55',
            }} />
          </div>
          {!pwr.radarOn && <div className="text-[9px]" style={{ color: '#d55' }}>LOW POWER</div>}
        </div>

        <BuildGroup label="BUILD" roles={ALL_BUILDING_ROLES} faction={s.player.faction}
          state={s} active={ghost} onBuild={onBuild} />
        <BuildGroup label="TRAIN" roles={ALL_UNIT_ROLES} faction={s.player.faction}
          state={s} active={null} onBuild={onBuild} />

        {queue.length > 0 && (
          <div className="rounded px-2 py-1 text-[10px]" style={{ background: SCREEN_BG }}>
            <div className="mb-1 font-bold">QUEUE</div>
            {queue.map((j, i) => (
              <button key={i} onClick={() => onCancelJob(i)} className="flex w-full justify-between hover:opacity-70">
                <span>{spec(j.role, s.player.faction).name}</span>
                <span>{Math.max(0, Math.ceil(j.ticksLeft / TICK_HZ))}s ✕</span>
              </button>
            ))}
          </div>
        )}

        {superReady && (
          <button onClick={armSuper} className="flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-bold"
            style={{ background: superArming ? '#d55' : '#7a4', color: INK }}>
            <Crosshair size={13} /> {superArming ? 'PICK TARGET' : 'SUPERWEAPON'}
          </button>
        )}

        <div className="mt-auto text-[9px] opacity-60">
          drag=select · R-click=move/attack · WASD=pan
        </div>
      </div>
    </motion.div>
  );
}

// A small static sprite preview for the build/train buttons (the "UI sprites").
function SpriteIcon({ role, faction, owner = 'player', px = 28 }: {
  role: EntityKind; faction: Faction; owner?: 'player' | 'enemy'; px?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    drawSprite(ctx, role, faction, owner, cv.width, 0);
  }, [role, faction, owner, px]);
  return <canvas ref={ref} width={px} height={px} style={{ imageRendering: 'pixelated' }} />;
}

// Turn canBuild's machine reason into a one-line player-facing hint.
function lockReason(reason: string | undefined, role: EntityKind, faction: Faction): string {
  if (!reason) return '';
  if (reason === 'insufficient_credits') return 'Not enough credits';
  if (reason.startsWith('requires_')) {
    const reqs = requirementNames(role, faction);
    return `Build first: ${reqs.join(', ')}`;
  }
  return reason;
}

function BuildGroup({ label, roles, faction, state, active, onBuild }: {
  label: string; roles: EntityKind[]; faction: Faction; state: RtsState;
  active: BuildingRole | null; onBuild: (r: EntityKind) => void;
}) {
  return (
    <div className="rounded px-1.5 py-1" style={{ background: SCREEN_BG }}>
      <div className="mb-1 px-0.5 text-[10px] font-bold">{label}</div>
      <div className="flex flex-col gap-1">
        {roles.filter(r => r !== 'hq').map(r => {
          const sp = spec(r, faction);
          const chk = canBuild(state, 'player', r);
          const enabled = chk.ok;
          const isActive = active === r;
          const hint = lockReason(chk.reason, r, faction);
          return (
            <button key={r} disabled={!enabled} onClick={() => onBuild(r)}
              title={`${sp.name} — ${sp.cost} credits\n${roleDesc(r)}${hint ? `\n⚠ ${hint}` : ''}`}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left"
              style={{
                background: isActive ? '#7a4' : enabled ? MID : '#3a3a3a',
                color: INK, opacity: enabled ? 1 : 0.55,
              }}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                style={{ background: 'rgba(0,0,0,0.25)' }}>
                <SpriteIcon role={r} faction={faction} px={26} />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[10px] font-bold">{sp.name}</span>
                <span className="text-[9px] opacity-80">
                  {sp.cost}{!enabled && hint ? ` · ${hint}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SetupOverlay({ onStart, onExit }: {
  onStart: (f: Faction, d: keyof typeof DIFFICULTY_PRESETS) => void; onExit: () => void;
}) {
  const [faction, setFaction] = useState<Faction>('human');
  const [diff, setDiff] = useState<keyof typeof DIFFICULTY_PRESETS>('normal');
  const FACTIONS: Array<{ id: Faction; name: string; blurb: string }> = [
    { id: 'human', name: 'HUMAN', blurb: 'Light, fast, precise. Orbital Strike.' },
    { id: 'lizard', name: 'LIZARD', blurb: 'Heavy, durable, brutal. Spore Bloom.' },
  ];
  const DIFFS: Array<keyof typeof DIFFICULTY_PRESETS> = ['easy', 'normal', 'hard'];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6"
      style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
      <div className="text-xl font-bold tracking-[0.3em]">IRON MARSH</div>
      <div className="text-[11px] opacity-70">An LLM commands the enemy. Choose your side.</div>
      <div className="flex gap-3">
        {FACTIONS.map(f => (
          <button key={f.id} onClick={() => setFaction(f.id)}
            className="flex w-44 flex-col items-center rounded p-3 text-center"
            style={{ background: faction === f.id ? '#7a4' : MID, color: INK }}>
            <div className="mb-2 flex h-20 w-full items-center justify-center rounded"
              style={{ background: faction === f.id ? 'rgba(0,0,0,0.28)' : SCREEN_BG }}>
              <FactionSprite faction={f.id} />
            </div>
            <div className="text-sm font-bold">{f.name}</div>
            <div className="mt-1 text-[10px] opacity-80">{f.blurb}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span>DIFFICULTY:</span>
        {DIFFS.map(d => (
          <button key={d} onClick={() => setDiff(d)}
            className="rounded px-3 py-1 uppercase"
            style={{ background: diff === d ? '#7a4' : MID, color: INK }}>{d}</button>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={() => onStart(faction, diff)}
          className="rounded px-6 py-2 text-sm font-bold" style={{ background: '#7a4', color: INK }}>
          DEPLOY
        </button>
        <button onClick={onExit}
          className="rounded px-4 py-2 text-sm" style={{ background: '#7a1f1f', color: '#f0d0d0' }}>
          EXIT
        </button>
      </div>
    </div>
  );
}

// ── Animated faction mascot for the setup cards ──────────────────────────────
// Shows the faction's basic infantry at a big x4-ish scale, idle-animated via the
// shared sprite set so the cards match the in-game look exactly. Pure cosmetic.
function FactionSprite({ faction }: { faction: Faction }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let raf = 0;
    const W = cv.width, H = cv.height;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(W / 2, H - 8, W * 0.3, 5, 0, 0, Math.PI * 2); ctx.fill();
      drawSprite(ctx, 'infantry', faction, 'player', W, now);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [faction]);
  return <canvas ref={ref} width={64} height={64} style={{ imageRendering: 'pixelated' }} />;
}
