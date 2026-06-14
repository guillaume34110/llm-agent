// Pure, stateless presentational widgets for the RPG console — small HUD pieces
// and chips that read only module tokens (rpg-theme), tested game leaves
// (state.ts), sprite helpers and i18n. Extracted from RpgConsole.tsx so the
// monolith shrinks and each widget is reusable. No component-local closure, no
// live-run mutation: every number shown is owned and clamped upstream by
// state.ts. Verbatim moves — behaviour preserved (tsc-gated, no JSX harness).
import React, { useEffect, useRef } from 'react';
import { Heart, Sparkles, Swords } from 'lucide-react';
import type { RpgState, StatusEffect, Character, Scene } from '../game/rpg/types';
import { moraleBand, MORALE_MAX, PROV_MAX, AFFLICTIONS, STATUS_META, xpForLevel } from '../game/rpg/state';
import { PixelSprite } from './PixelSprite';
import { SPRITES, kindSpriteKey, classSpriteKey, spritePalette } from '../game/rpg/sprites';
import { t } from '../i18n/i18n';
import { SCREEN_BG, DARK, INK, MID, PAPER, SPRITE_PALETTE, STATUS_COLOR, STAT_LABEL } from './rpg-theme';

// Framed pixel-art bust of a hero class, on a soft vignette. `ring` marks the
// active/selected portrait.
export function HeroPortrait({ cls, px, ring }: { cls: string; px: number; ring?: boolean }) {
  const key = classSpriteKey(cls);
  return (
    <span className="inline-flex items-center justify-center rounded-lg shrink-0"
      style={{
        background: 'radial-gradient(circle at 50% 36%, #fbfff0, #d4e6ac)',
        padding: Math.max(2, px),
        border: ring ? `2px solid ${PAPER}` : '1px solid rgba(43,32,22,0.28)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 3px rgba(43,32,22,0.3)',
      }}>
      <PixelSprite grid={SPRITES[key]} px={px} palette={spritePalette(key)} />
    </span>
  );
}

// Pixel-art node marker drawn directly as SVG rects (no nested <svg>), so it
// composes cleanly inside the zoomable map. Centred on (cx, cy).
export function MapMarker({ kind, cx, cy, size }: { kind: string; cx: number; cy: number; size: number }) {
  const grid = SPRITES[kindSpriteKey(kind)];
  if (!grid) return null;
  const pal = { ...SPRITE_PALETTE, ...spritePalette(kindSpriteKey(kind)) };
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const rows = grid.length;
  const px = size / Math.max(cols, rows);
  const ox = cx - (cols * px) / 2;
  const oy = cy - (rows * px) / 2;
  const rects: React.ReactElement[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const fill = pal[ch];
      if (!fill) { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      rects.push(<rect key={`${x}-${y}`} x={ox + x * px} y={oy + y * px} width={run * px} height={px} style={{ fill }} />);
      x += run;
    }
  });
  return <g style={{ pointerEvents: 'none' }}>{rects}</g>;
}

// A hint shown when the party is under the goal node's recommended level, so the
// player knows to grind the danger zones before pushing the objective.
export function GoalLevelHint({ state }: { state: RpgState }) {
  const goal = state.nodes[state.quest.goalNodeId];
  const req = goal?.reqLevel;
  if (!req) return null;
  const lvl = Math.max(1, ...state.party.filter(c => c.alive).map(c => c.level));
  if (lvl >= req) return null;
  return (
    <div className="text-[9px] mt-1 flex items-center gap-1" style={{ color: '#7a1f1f' }}>
      <Swords size={10} /> {goal.name}: recommended Lv {req} (party Lv {lvl}) — hunt the danger zones to level up.
    </div>
  );
}

// A compact stat chip for the selection vignettes (hero class, biome, counts).
// Switches palette so it stays legible on both the selected (INK) and idle
// (PAPER) card backgrounds.
export function CardChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="text-[8px] font-bold rounded px-1 py-px whitespace-nowrap"
      style={{ background: on ? MID : DARK, color: on ? INK : PAPER }}>
      {label}
    </span>
  );
}

// A tiny inline compass rose for the map frame.
export function Compass() {
  return (
    <svg width={40} height={40} viewBox="0 0 40 40" style={{ opacity: 0.8 }}>
      <circle cx={20} cy={20} r={17} style={{ fill: SCREEN_BG, stroke: INK }} strokeWidth={1.5} />
      <polygon points="20,5 24,20 20,17 16,20" style={{ fill: '#7a1f1f' }} />
      <polygon points="20,35 16,20 20,23 24,20" style={{ fill: DARK }} />
      <text x={20} y={13} textAnchor="middle" fontSize={7} fontWeight={700} style={{ fill: INK, fontFamily: 'monospace' }}>N</text>
    </svg>
  );
}

// One labelled meter row of the expedition ledger (provisions, morale, …). `pct`
// is clamped to [0,1]; the caller owns colour + glyph.
export function LedgerBar({ label, glyph, pct, color }: { label: string; glyph: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1 mb-0.5">
      <span className="text-[8px] w-3 text-center shrink-0" style={{ color }}>{glyph}</span>
      <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.14)' }}>
        <div className="h-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`, background: color, transition: 'width .3s' }} />
      </div>
      <span className="text-[8px] w-14 truncate shrink-0" style={{ opacity: 0.8 }}>{label}</span>
    </div>
  );
}

// The scrolling GM narration column — newest beat at full opacity, prior beats
// faded, auto-scrolled to the bottom. Falls back to a single `narration` string
// when a scene has no log yet.
export function NarrationLog({ scene, narration }: { scene: Scene | null; narration: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const log = scene?.log && scene.log.length ? scene.log : (narration ? [narration] : []);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log.length, scene?.busy]);
  return (
    <div ref={ref} className="flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: 132 }}>
      {log.map((beat, i) => (
        <p key={i} className="text-[11px] leading-snug" style={{ opacity: i === log.length - 1 ? 1 : 0.55 }}>
          {i < log.length - 1 && <span style={{ opacity: 0.4 }}>· </span>}{beat}
        </p>
      ))}
      {scene?.busy && <span className="text-[11px]" style={{ opacity: 0.6 }}>The GM is narrating…</span>}
    </div>
  );
}

// Active status-effect badges (burn/bleed/poison/stun…) for a combatant. Hides
// when nothing is ticking. `dot` effects append their remaining round count.
export function StatusChips({ status }: { status?: StatusEffect[] }) {
  const live = (status || []).filter(s => s.rounds > 0);
  if (live.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
      {live.map(s => (
        <span key={s.id} title={`${STATUS_META[s.id].label} · ${s.rounds} round(s)`}
          className="text-[7px] font-bold rounded px-0.5 leading-[11px]"
          style={{ background: STATUS_COLOR[s.id] || '#5a5f43', color: '#e8f8c8' }}>
          {STATUS_META[s.id].label[0]}{STATUS_META[s.id].dot ? s.rounds : ''}
        </span>
      ))}
    </div>
  );
}

// A single attribute meter (might/agility/wits/spirit) on a character card.
export function StatBar({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] w-6" style={{ opacity: 0.8 }}>{STAT_LABEL[k] || k}</span>
      <div className="flex-1 h-1.5 rounded" style={{ background: '#5a5f43' }}>
        <div className="h-1.5 rounded" style={{ width: `${Math.min(100, v * 12)}%`, background: DARK }} />
      </div>
      <span className="text-[8px] w-3 text-right font-bold">{v}</span>
    </div>
  );
}

// Party morale gauge — colour + label track the band the engine reads from
// (high≥70 / steady≥40 / low≥20 / breaking). Pure display; the number is owned
// and clamped by state.ts.
export function MoraleBar({ morale }: { morale: number }) {
  const band = moraleBand(morale);
  const pct = Math.max(0, Math.min(100, Math.round((morale / MORALE_MAX) * 100)));
  const tint = band === 'high' ? '#2f6b2f' : band === 'steady' ? INK : band === 'low' ? '#9a6a1f' : '#7a1f1f';
  const label = band === 'high' ? t('rpg.morale.high') : band === 'steady' ? t('rpg.morale.steady') : band === 'low' ? t('rpg.morale.low') : t('rpg.morale.breaking');
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-bold flex items-center gap-1" style={{ opacity: 0.85 }}>
          <Sparkles size={10} /> {t('rpg.party.morale')}
        </span>
        <span className="text-[10px] font-bold" style={{ color: tint }}>{label} · {Math.round(morale)}</span>
      </div>
      <div className="h-2 rounded overflow-hidden" style={{ background: PAPER }}>
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: tint }} />
      </div>
      {band === 'breaking' && (
        <div className="text-[8px] mt-0.5" style={{ color: '#7a1f1f' }}>
          {t('rpg.morale.failing')}
        </div>
      )}
    </div>
  );
}

// Provisions gauge — rations carried (0..PROV_MAX). Each leg eats some; an empty
// satchel on the road starves the party. Pure display; the number is owned by
// state.ts. Tints amber when low, red when empty.
export function ProvisionsBar({ provisions }: { provisions: number }) {
  const p = Math.max(0, Math.min(PROV_MAX, Math.round(provisions)));
  const pct = Math.round((p / PROV_MAX) * 100);
  const tint = p === 0 ? '#7a1f1f' : p <= 2 ? '#9a6a1f' : '#2f6b2f';
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-bold flex items-center gap-1" style={{ opacity: 0.85 }}>
          <Heart size={10} style={{ fill: INK }} /> {t('rpg.party.provisions')}
        </span>
        <span className="text-[10px] font-bold" style={{ color: tint }}>{p}/{PROV_MAX}</span>
      </div>
      <div className="h-2 rounded overflow-hidden" style={{ background: PAPER }}>
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: tint }} />
      </div>
      {p === 0 && (
        <div className="text-[8px] mt-0.5" style={{ color: '#7a1f1f' }}>
          {t('rpg.prov.empty')}
        </div>
      )}
    </div>
  );
}

// A full character card: portrait, class/level, trait + affliction badges, HP/XP
// bars (hidden for recruit previews) and the four attribute meters. In recruit
// mode it adds the blurb and the hire cost (red when unaffordable).
export function CharacterCard({ c, recruit, cost, afford }: { c: Character; recruit?: boolean; cost?: number; afford?: boolean }) {
  const xpNeed = xpForLevel(c.level);
  return (
    <div className="rounded p-2" style={{ background: recruit ? SCREEN_BG : PAPER, border: `2px solid ${DARK}` }}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="flex items-center gap-1.5">
          <PixelSprite grid={SPRITES[classSpriteKey(c.className)]} px={2} palette={spritePalette(classSpriteKey(c.className))}
            style={{ opacity: c.alive ? 1 : 0.4, filter: c.alive ? undefined : 'grayscale(1)' }} />
          <span className="text-[11px] font-bold">{c.name}</span>
        </span>
        <span className="text-[8px] rounded px-1" style={{ background: c.isHero ? '#7a1f1f' : DARK, color: PAPER }}>
          {c.isHero ? t('rpg.card.hero') : recruit ? t('rpg.card.recruit') : t('rpg.card.ally')}
        </span>
      </div>
      <div className="text-[9px] mb-1" style={{ opacity: 0.85 }}>{c.className} · {t('rpg.w.levelAbbr')}{c.level}{c.alive ? '' : t('rpg.card.down')}</div>
      {c.trait && (
        <div className="text-[8px] mb-1 mr-1 inline-block rounded px-1 font-bold" title={c.trait.blurb}
          style={{ background: DARK, color: PAPER }}>
          ★ {c.trait.label}
        </div>
      )}
      {c.alive && c.affliction && (
        <div className="text-[8px] mb-1 inline-block rounded px-1 font-bold" title={AFFLICTIONS[c.affliction].blurb}
          style={{ background: '#7a1f1f', color: PAPER }}>
          ☠ {AFFLICTIONS[c.affliction].label}
        </div>
      )}
      {!recruit && (
        <>
          <div className="flex items-center gap-1 mb-0.5">
            <Heart size={8} style={{ fill: INK }} />
            <div className="flex-1 h-1.5 rounded" style={{ background: '#5a5f43' }}>
              <div className="h-1.5 rounded" style={{ width: `${Math.max(0, Math.round((c.hp / c.maxHp) * 100))}%`, background: '#7a1f1f' }} />
            </div>
            <span className="text-[8px] w-9 text-right">{Math.max(0, c.hp)}/{c.maxHp}</span>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <Sparkles size={8} />
            <div className="flex-1 h-1.5 rounded" style={{ background: '#5a5f43' }}>
              <div className="h-1.5 rounded" style={{ width: `${Math.min(100, Math.round((c.xp / xpNeed) * 100))}%`, background: MID }} />
            </div>
            <span className="text-[8px] w-9 text-right">{c.xp}/{xpNeed}</span>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {Object.entries(c.stats).map(([k, v]) => <StatBar key={k} k={k} v={v} />)}
      </div>
      {recruit && <div className="text-[8px] mt-1 leading-tight" style={{ opacity: 0.8 }}>{c.blurb}</div>}
      {recruit && typeof cost === 'number' && (
        <div className="flex items-center gap-1 mt-1 text-[8px] font-bold"
          style={{ color: afford ? INK : '#7a1f1f' }}>
          <Sparkles size={8} /> {t('rpg.card.hire', { n: cost })}{afford ? '' : t('rpg.card.short')}
        </div>
      )}
    </div>
  );
}
