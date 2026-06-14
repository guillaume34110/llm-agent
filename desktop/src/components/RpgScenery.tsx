import React, { useMemo, useState, useEffect } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import { PixelSprite } from './PixelSprite';
import { SPRITES, enemySpriteKey, classSpriteKey, variantTint, spritePalette } from '../game/rpg/sprites';
import { makeRng, seedFrom } from '../game/rpg/dice';
import type { MapNode, Quest } from '../game/rpg/types';

// Tinted to the current theme hue via the --gb-* ramp (styles.css). Keeps the
// Game Boy monochrome look but follows the active theme instead of green.
const INK = 'var(--gb-ink)', DARK = 'var(--gb-dark)', MID = 'var(--gb-mid)', PAPER = 'var(--gb-light)';

// Quest scroll = a UI card in the active theme colours (--gb-* ramp). Only the
// wax seal keeps a fixed warm red as a small accent.
const WAX = '#7a1f1f';

// Item placed in a scene diorama. role drives behaviour:
//   'far'  — distant silhouette (mountains / skyline), faint, slow parallax
//   'back' — static prop (building, tree, rock), faint idle sway
//   'walk' — NPC / critter that patrols left-right (world life)
//   'fx'   — fire / glow that flickers
type Item = {
  key: string;
  x: number;       // left %, 0..100
  scale: number;   // px per sprite-pixel
  role: 'far' | 'back' | 'walk' | 'fx';
  flip?: boolean;
  z?: number;
};

// Palette variants give NPC crowds variety without new sprites. Hue-offset the
// theme accent (same lightness/chroma as the --gb-* ramp) so the crowd reads as
// a few shades of the current theme; one warm variant stays fixed for contrast.
const NPC_TINTS: (Record<string, string> | undefined)[] = [
  undefined,
  { D: 'oklch(46% 0.115 calc(var(--accent-hue) + 28))', M: 'oklch(64% 0.115 calc(var(--accent-hue) + 28))' },
  { D: 'oklch(46% 0.115 calc(var(--accent-hue) - 28))', M: 'oklch(64% 0.115 calc(var(--accent-hue) - 28))' },
  { D: '#7a1f1f', M: '#a85a3a' },
];

// Far silhouettes use a single hazy slate so they read as atmospheric distance
// against the coloured biome skies, not theme-ramp detail.
const FAR_TINT: Record<string, string> = { K: '#6f86a0', D: '#6f86a0', M: '#6f86a0', L: '#6f86a0' };

// Biome-coloured skies & grounds for the scene dioramas. Day biomes get real
// daylight colour; underground / haunted places stay dim so `dark` still reads.
const SCENE_PAINT: Record<string, { sky: string; ground: string }> = {
  village: { sky: '#9cc4e0', ground: '#6f8f4e' },
  town: { sky: '#9cc4e0', ground: '#9a9388' },
  forest: { sky: '#8fb8d8', ground: '#3f7a4a' },
  wild: { sky: '#a8c4d0', ground: '#8a7a52' },
  camp: { sky: '#d8956a', ground: '#5f6b3a' },
  dungeon: { sky: '#241a20', ground: '#3c2f30' },
  cave: { sky: '#1f242c', ground: '#3a4048' },
  ruin: { sky: '#4a4458', ground: '#5d5668' },
};

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Whether the scene is lit (day) or dark (underground / haunted).
function isDark(kind: string) {
  return kind === 'dungeon' || kind === 'cave' || kind === 'ruin';
}

// Build a deterministic diorama for a node. Same node id → same scene, so the
// world stays stable across re-renders and reloads (replayable).
function compose(node: MapNode): { items: Item[]; dark: boolean; ground: string[] } {
  const rng = makeRng(seedFrom(`scene:${node.id}:${node.kind}`));
  const dark = isDark(node.kind);
  const items: Item[] = [];
  const far = (key: string, x: number, scale = 4, flip?: boolean) =>
    items.push({ key, x, scale, role: 'far', flip, z: 0 });
  const back = (key: string, x: number, scale = 4, flip?: boolean) =>
    items.push({ key, x, scale, role: 'back', flip, z: 1 });
  const walk = (key: string, x: number, scale = 4, flip?: boolean) =>
    items.push({ key, x, scale, role: 'walk', flip, z: 3 });
  const fx = (key: string, x: number, scale = 4) =>
    items.push({ key, x, scale, role: 'fx', z: 2 });

  // Distant skyline behind outdoor scenes for depth.
  if (!dark) {
    far('prop_mountain', 4 + rng() * 8, 3.5, rng() > 0.5);
    far('prop_mountain', 58 + rng() * 16, 3, rng() > 0.5);
  }

  // Ground-litter tiles scattered along the floor (biome texture).
  const ground: string[] = [];

  switch (node.kind) {
    case 'town': {
      back('prop_tower', 6, 5);
      back('prop_house', 34, 4);
      back('prop_house', 60, 4, true);
      back('prop_banner', 86, 4);
      back('prop_statue', 50, 3);
      ground.push('map_cobble', 'map_cobble');
      const crowd = ['npc_merchant', 'npc_guard', 'npc_villager', 'npc_child', 'npc_elder'];
      const n = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) walk(pick(rng, crowd), 12 + i * 18 + rng() * 8, 3, rng() > 0.5);
      break;
    }
    case 'village': {
      back('prop_house', 10, 4);
      back('prop_well', 42, 4);
      back('prop_house', 68, 4, true);
      back('prop_bush', 88, 3);
      if (rng() > 0.4) fx('prop_fire', 52, 3);
      ground.push('map_grass', 'map_grass');
      const crowd = ['npc_villager', 'npc_elder', 'npc_child', 'npc_villager'];
      const n = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) walk(pick(rng, crowd), 20 + i * 22 + rng() * 6, 3, rng() > 0.5);
      break;
    }
    case 'camp': {
      fx('prop_fire', 46, 4);
      back('prop_tent', 16, 4);
      back('prop_pine', 80, 4, true);
      back('prop_barrel', 66, 3);
      back('prop_rock', 8, 3);
      ground.push('map_grass', 'map_rock');
      walk('npc_guard', 30, 3);
      walk('npc_villager', 60, 3, true);
      break;
    }
    case 'forest': {
      back('prop_tree', 4, 5);
      back('prop_pine', 26, 5, true);
      back('prop_tree', 52, 4);
      back('prop_pine', 80, 5);
      back('prop_mushroom', 40, 3);
      back('prop_bush', 64, 3, true);
      ground.push('map_grass', 'map_tree', 'map_pine');
      if (rng() > 0.5) walk('foe_wolf', 44, 3, true);
      break;
    }
    case 'wild': {
      back('prop_rock', 10, 4);
      back('prop_signpost', 36, 3);
      back('prop_cactus', 58, 4);
      back('prop_rock', 80, 5, true);
      ground.push('map_rock', 'map_grass');
      if (rng() > 0.5) walk('foe_wolf', 50, 3);
      break;
    }
    case 'dungeon': {
      back('prop_pillar', 10, 4);
      back('prop_tomb', 42, 4);
      back('prop_pillar', 76, 4, true);
      back('prop_chest', 60, 3);
      fx('prop_fire', 28, 2);
      ground.push('map_bone', 'map_crack');
      walk('foe_skeleton', 58, 3, true);
      break;
    }
    case 'cave': {
      back('prop_stalagmite', 8, 4);
      back('prop_crystal', 36, 4);
      back('prop_rock', 72, 5, true);
      back('prop_stalagmite', 88, 3, true);
      fx('prop_fire', 52, 2);
      ground.push('map_rock', 'map_crack');
      walk('foe_bat', 24, 3);
      walk('foe_spider', 64, 3, true);
      break;
    }
    case 'ruin': {
      back('prop_pillar', 8, 5);
      back('prop_statue', 38, 3);
      back('prop_tomb', 60, 4);
      back('prop_pillar', 84, 5, true);
      ground.push('map_rubble', 'map_rock');
      walk('foe_ghost', 52, 3, true);
      break;
    }
    default: {
      back('prop_rock', 30, 4);
      back('prop_pine', 60, 4);
      ground.push('map_grass');
    }
  }
  return { items, dark, ground };
}

function ItemView({ it, onClick }: { it: Item; onClick?: () => void }) {
  const grid = SPRITES[it.key];
  if (!grid) return null;
  const tint = it.role === 'far'
    ? FAR_TINT
    : it.role === 'walk' && it.key.startsWith('npc_')
      ? { ...spritePalette(it.key), ...NPC_TINTS[seedFrom(it.key + it.x) % NPC_TINTS.length] }
      : spritePalette(it.key);
  const sprite = <PixelSprite grid={grid} px={it.scale} palette={tint} flip={it.flip} />;
  const click = onClick ? (e: React.MouseEvent) => { e.stopPropagation(); onClick(); } : undefined;
  const interactive: React.CSSProperties = onClick ? { cursor: 'pointer', pointerEvents: 'auto' } : {};

  // Far silhouettes sit on the horizon line and are faded back.
  if (it.role === 'far') {
    return (
      <motion.div
        style={{ position: 'absolute', left: `${it.x}%`, bottom: '40%', zIndex: 0, opacity: 0.42 }}
        animate={{ x: [0, 4, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      >
        {sprite}
      </motion.div>
    );
  }

  const base: React.CSSProperties = {
    position: 'absolute',
    left: `${it.x}%`,
    bottom: 6,
    zIndex: it.z ?? 1,
    transformOrigin: 'bottom center',
    ...interactive,
  };

  if (it.role === 'walk') {
    // Patrol horizontally + a small step bob — the "world life".
    return (
      <motion.div
        style={base} onClick={click}
        animate={{ x: [0, 26, 0, -8, 0], y: [0, -1, 0, -1, 0] }}
        transition={{ duration: 6 + (it.x % 5), repeat: Infinity, ease: 'easeInOut' }}
      >
        {sprite}
      </motion.div>
    );
  }
  if (it.role === 'fx') {
    return (
      <motion.div
        style={base} onClick={click}
        animate={{ scaleY: [1, 1.12, 0.94, 1.08, 1], opacity: [1, 0.85, 1, 0.9, 1] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {sprite}
      </motion.div>
    );
  }
  // Static prop with a barely-there sway so the scene never feels frozen.
  return (
    <motion.div
      style={base} onClick={click}
      animate={{ rotate: [0, 0.6, 0, -0.6, 0] }}
      transition={{ duration: 5 + (it.x % 4), repeat: Infinity, ease: 'easeInOut' }}
    >
      {sprite}
    </motion.div>
  );
}

// A clickable actor/structure in the scene opens a bubble of contextual actions.
export type SceneActionDef = { label: string; tag: string };
export type DioramaHero = { id?: string; name: string; className: string; level: number; hp: number; maxHp: number; alive: boolean };
// A live combat enemy, rendered on the diorama in place of the plain `foes` name
// list: it carries its own HP, threat tier and alive flag so the fight plays out
// on the scene itself (Curious-Expedition style) rather than a separate screen.
export type DioramaFoe = { id: string; name: string; hp: number; maxHp: number; alive: boolean; threat: number };
type PickKind = 'hero' | 'npc' | 'foe' | 'building';

// Settlement structures the party can step into.
const BUILDING_KEYS = new Set(['prop_house', 'prop_tower', 'prop_tent']);
// Fallen heroes are drawn flat-grey so they still occupy the line, visibly down.
const DEAD_TINT: Record<string, string> = { K: '#5a564e', D: '#8a857a', M: '#9a958c', L: '#b5b0a5' };

function npcRoleSprite(role: string): string {
  const r = role.toLowerCase();
  if (/merchant|innkeep|trader/.test(r)) return 'npc_merchant';
  if (/guard|watch|soldier/.test(r)) return 'npc_guard';
  if (/elder|old/.test(r)) return 'npc_elder';
  if (/child/.test(r)) return 'npc_child';
  return 'npc_villager';
}

// A living, *interactive* scene band — the drawn "place" is the screen's hero
// element. Heroes carry their own data (name, level, HP) floating above the
// skin; NPCs and foes are labelled and clickable. Clicking an actor or an open
// building opens a small bubble of contextual actions, so the whole turn happens
// on the diorama itself (no separate command grid).
//   foes      — enemy names lurking here (right side, facing the party)
//   party     — the heroes with live data (left side, facing the foes)
//   npc       — the settlement speaker, if anyone is around
//   enterable — whether buildings here can be stepped into
//   actions   — the action buttons each target's bubble offers (+ always-on ground chips)
//   onAction  — fired with an action tag when a bubble button is pressed
export function SceneDiorama({
  node, height = 110, foes, party, npc, enterable, actions, onAction, variant = 0,
  combatFoes, targetId, onFoeClick, partyLungeKey = 0, foeLungeKey = 0,
  flashHeroIds, flashFoeIds,
}: {
  node: MapNode;
  height?: number | string;
  foes?: string[];
  party?: DioramaHero[];
  npc?: { name: string; role: string } | null;
  enterable?: boolean;
  actions?: Partial<Record<PickKind | 'ground', SceneActionDef[]>>;
  onAction?: (tag: string) => void;
  variant?: number; // deeper sub-screen index: re-scatters litter + dims the air
  // ── Combat overlay (optional) ─ when `combatFoes` is supplied the diorama
  // becomes the battlefield: foes carry live HP + a target ring, and the two
  // bumped keys trigger a melee lunge (party→foes / foes→party).
  combatFoes?: DioramaFoe[];
  targetId?: string;
  onFoeClick?: (id: string) => void;
  partyLungeKey?: number;
  foeLungeKey?: number;
  flashHeroIds?: string[];
  flashFoeIds?: string[];
}) {
  const composed = useMemo(() => compose(node), [node.id, node.kind]);
  // Melee lunge: the whole party row shoves toward the foes (and vice-versa) when
  // its key bumps, while each actor keeps its own idle bob underneath.
  const partyCtl = useAnimationControls();
  const foeCtl = useAnimationControls();
  useEffect(() => { if (partyLungeKey) void partyCtl.start({ x: [0, 16, 0], transition: { duration: 0.3, ease: 'easeOut' } }); }, [partyLungeKey, partyCtl]);
  useEffect(() => { if (foeLungeKey) void foeCtl.start({ x: [0, -16, 0], transition: { duration: 0.3, ease: 'easeOut' } }); }, [foeLungeKey, foeCtl]);
  const HIT_FILTER = 'brightness(1.7) saturate(3) sepia(0.5) hue-rotate(-35deg)';
  const { dark, ground } = composed;
  // When real foes are present, drop the decorative ambient critters so the
  // scene reads as "these are the enemies", not random wildlife.
  const items = ((foes && foes.length) || (combatFoes && combatFoes.length))
    ? composed.items.filter(it => !it.key.startsWith('foe_'))
    : composed.items;
  const paint = SCENE_PAINT[node.kind];
  const sky = paint?.sky ?? (dark ? INK : MID);
  const groundCol = paint?.ground ?? (dark ? 'oklch(22% 0.115 var(--accent-hue))' : DARK);
  const orb = dark ? '#dfe2f0' : '#f5d76e'; // moon vs sun
  // Sky brightens toward the horizon, ground darkens toward the viewer — cheap
  // aerial perspective that makes the flat two-band diorama read as depth.
  const horizon = `color-mix(in oklab, ${sky} ${dark ? 80 : 58}%, white)`;
  const groundDeep = `color-mix(in oklab, ${groundCol} 70%, black)`;

  // Night sky dressing (dark biomes): a deterministic scatter of twinkling stars.
  const stars = useMemo(() => {
    if (!dark) return [] as Array<{ left: number; top: number; s: number; d: number }>;
    const rng = makeRng(seedFrom(`stars:${node.id}`));
    return Array.from({ length: 9 }, () => ({
      left: 2 + rng() * 94, top: 4 + rng() * 38, s: rng() > 0.7 ? 2 : 1, d: 1.6 + rng() * 2.4,
    }));
  }, [node.id, dark]);
  // Day sky dressing: a bird or two gliding across (deterministic per node).
  const birds = useMemo(() => {
    if (dark) return [] as Array<{ top: number; dur: number; delay: number }>;
    const rng = makeRng(seedFrom(`birds:${node.id}`));
    const n = rng() > 0.45 ? (rng() > 0.75 ? 2 : 1) : 0;
    return Array.from({ length: n }, (_, i) => ({
      top: 10 + rng() * 22, dur: 14 + rng() * 8, delay: i * 5 + rng() * 4,
    }));
  }, [node.id, dark]);

  // Which actor's action bubble is open (anchored at x%, left-based).
  const [sel, setSel] = useState<{ kind: PickKind; x: number; title: string } | null>(null);
  React.useEffect(() => { setSel(null); }, [node.id]);
  const open = (kind: PickKind, x: number, title: string) => setSel({ kind, x, title });
  const selActions = sel ? (actions?.[sel.kind] ?? []) : [];
  const groundActions = actions?.ground ?? [];

  // Deterministic floor-litter scatter from the biome ground tiles — re-seeded
  // per sub-screen so each deeper area looks like a distinct room.
  const litter = useMemo(() => {
    if (!ground.length) return [] as Array<{ key: string; left: number; px: number }>;
    const rng = makeRng(seedFrom(`floor:${node.id}:${variant}`));
    const n = 5 + Math.floor(rng() * 4);
    return Array.from({ length: n }, () => ({
      key: ground[Math.floor(rng() * ground.length)],
      left: rng() * 96,
      px: 2 + rng() * 1.5,
    }));
  }, [node.id, ground, variant]);

  return (
    <div
      style={{
        position: 'relative',
        height,
        borderRadius: 8,
        overflow: 'hidden',
        border: `3px solid ${INK}`,
        background: `linear-gradient(180deg, ${sky} 0%, ${horizon} 57%, ${groundCol} 58%, ${groundDeep} 100%)`,
        boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.18), inset 0 -14px 22px rgba(0,0,0,0.16)',
      }}
    >
      {/* night stars (dark biomes only) */}
      {stars.map((st, i) => (
        <motion.div key={`st${i}`}
          style={{ position: 'absolute', left: `${st.left}%`, top: `${st.top}%`, width: st.s, height: st.s, background: '#e8ecf6', borderRadius: '50%' }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: st.d, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* celestial body + soft halo */}
      <div
        style={{
          position: 'absolute', top: 2, right: 8, width: 36, height: 36, borderRadius: '50%',
          background: `radial-gradient(circle, ${dark ? 'rgba(223,226,240,0.35)' : 'rgba(245,216,110,0.5)'} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 18,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: dark ? orb : `radial-gradient(circle at 38% 34%, #fbeaa6, ${orb})`,
          boxShadow: dark ? '0 0 6px rgba(255,255,255,0.45)' : '0 0 10px rgba(245,216,110,0.8)',
        }}
      />
      {/* gliding birds (day biomes only) */}
      {birds.map((b, i) => (
        <motion.div key={`bd${i}`}
          style={{ position: 'absolute', top: `${b.top}%`, left: 0, opacity: 0.75, pointerEvents: 'none' }}
          initial={{ x: '-10%' }}
          animate={{ x: ['-10%', '105%'], y: [0, -6, 2, -4, 0] }}
          transition={{ duration: b.dur, delay: b.delay, repeat: Infinity, ease: 'linear' }}
        >
          <PixelSprite grid={SPRITES.crit_bird} px={2} palette={{ K: '#3a4150', D: '#3a4150', M: '#3a4150', L: '#3a4150' }} />
        </motion.div>
      ))}
      {/* drifting clouds / mist — two layers at different speeds for parallax */}
      <motion.div
        style={{
          position: 'absolute',
          top: 22,
          width: 40,
          height: 8,
          borderRadius: 6,
          background: dark ? DARK : '#ffffff',
          opacity: dark ? 0.5 : 0.65,
        }}
        animate={{ x: ['-15%', '120%'] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        style={{
          position: 'absolute',
          top: 10,
          width: 26,
          height: 6,
          borderRadius: 5,
          background: dark ? DARK : '#ffffff',
          opacity: dark ? 0.35 : 0.45,
        }}
        animate={{ x: ['-12%', '125%'] }}
        transition={{ duration: 34, delay: 6, repeat: Infinity, ease: 'linear' }}
      />
      {/* ground texture line */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: '58%', height: 2, background: INK, opacity: 0.4 }} />
      {/* floor litter (biome tiles) */}
      {litter.map((l, i) => (
        <div key={`f${i}`} style={{ position: 'absolute', left: `${l.left}%`, bottom: 2, opacity: 0.5, zIndex: 1 }}>
          <PixelSprite grid={SPRITES[l.key]} px={l.px} />
        </div>
      ))}
      {items.map((it, i) => (
        <ItemView key={i} it={it}
          onClick={enterable && BUILDING_KEYS.has(it.key) ? () => open('building', it.x + 3, 'Building') : undefined} />
      ))}

      {/* Deeper areas grow darker — a veil over the scene (not the bubbles). */}
      {variant > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: Math.min(0.42, variant * 0.18), pointerEvents: 'none', zIndex: 6 }} />
      )}

      {/* Heroes — left side, facing right, each carrying its own data plate. The
          whole row sits in a lunge group so it can shove toward the foes in a
          fight; each hero keeps its own idle bob and flashes when struck. */}
      <motion.div animate={partyCtl} style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
        {(party || []).slice(0, 4).map((h, i) => {
          const left = 5 + i * 11;
          const hpPct = h.maxHp ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
          const hit = !!(h.id && flashHeroIds?.includes(h.id));
          return (
            <motion.div key={h.id || `hero-${i}`}
              onClick={h.alive ? () => open('hero', left + 4, h.name) : undefined}
              style={{ position: 'absolute', left: `${left}%`, bottom: 6, transformOrigin: 'bottom center', cursor: h.alive ? 'pointer' : 'default', opacity: h.alive ? 1 : 0.5, pointerEvents: h.alive ? 'auto' : 'none' }}
              animate={{ y: h.alive ? [0, -1.5, 0] : 0 }}
              transition={{ duration: 2.4 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}>
              {/* floating data: name + level, an HP bar, current/max */}
              <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                <div style={{ fontSize: 7, fontWeight: 700, color: PAPER, background: INK, borderRadius: 2, padding: '0 3px', fontFamily: 'monospace' }}>{h.name} L{h.level}</div>
                <div style={{ width: 24, height: 3, background: DARK, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpPct > 0.3 ? PAPER : '#e06666' }} />
                </div>
                <div style={{ fontSize: 6, color: INK, fontFamily: 'monospace', opacity: 0.8 }}>{Math.max(0, h.hp)}/{h.maxHp}</div>
              </div>
              <div style={{ filter: hit ? HIT_FILTER : undefined, transition: 'filter 0.08s' }}>
                <PixelSprite grid={SPRITES[classSpriteKey(h.className)]} px={3.4} palette={h.alive ? spritePalette(classSpriteKey(h.className)) : DEAD_TINT} />
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* NPC — the settlement speaker, labelled and clickable to talk. */}
      {npc && (
        <motion.div
          onClick={() => open('npc', 42, npc.name)}
          style={{ position: 'absolute', left: '38%', bottom: 6, zIndex: 5, transformOrigin: 'bottom center', cursor: 'pointer' }}
          animate={{ y: [0, -1.5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
          <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 2, fontSize: 7, fontWeight: 700, color: INK, background: PAPER, border: `1px solid ${INK}`, borderRadius: 2, padding: '0 3px', whiteSpace: 'nowrap', fontFamily: 'monospace', pointerEvents: 'none' }}>{npc.name}</div>
          <PixelSprite grid={SPRITES[npcRoleSprite(npc.role)]} px={3.4} palette={spritePalette(npcRoleSprite(npc.role))} />
        </motion.div>
      )}

      {/* Foes during a fight — live combat enemies with HP bars, threat stars and
          a clickable target ring. Rendered in a lunge group so the whole pack can
          surge at the party. Falls back to the plain name plates outside combat. */}
      {combatFoes ? (
        <motion.div animate={foeCtl} style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
          {combatFoes.slice(0, 4).map((f, i) => {
            const rightPct = 5 + i * 12;
            const hpPct = f.maxHp ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 0;
            const targeted = targetId === f.id && f.alive;
            const hit = !!flashFoeIds?.includes(f.id);
            return (
              <motion.div key={f.id}
                onClick={f.alive ? () => onFoeClick?.(f.id) : undefined}
                style={{ position: 'absolute', right: `${rightPct}%`, bottom: 6, transformOrigin: 'bottom center', cursor: f.alive ? 'pointer' : 'default', opacity: f.alive ? 1 : 0.55, pointerEvents: f.alive ? 'auto' : 'none' }}
                animate={{ y: f.alive ? [0, -2, 0] : 0 }}
                transition={{ duration: 1.8 + i * 0.25, repeat: Infinity, ease: 'easeInOut' }}>
                {/* name plate + threat stars, then an HP bar */}
                <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 7, fontWeight: 700, color: PAPER, background: '#7a1f1f', borderRadius: 2, padding: '0 3px', fontFamily: 'monospace' }}>{f.name}{f.threat > 0 ? ` ${'★'.repeat(Math.min(5, f.threat))}` : ''}</div>
                  <div style={{ width: 26, height: 3, background: DARK, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpPct > 0.3 ? '#e0a060' : '#e06666' }} />
                  </div>
                </div>
                <div style={{
                  filter: hit ? HIT_FILTER : (f.alive ? undefined : 'grayscale(1)'),
                  transform: f.alive ? undefined : 'rotate(8deg)',
                  transition: 'filter 0.08s',
                  outline: targeted ? '2px solid #7a1f1f' : undefined,
                  outlineOffset: 2, borderRadius: 2,
                }}>
                  <PixelSprite grid={SPRITES[enemySpriteKey(f.name)]} px={3.4} flip palette={f.alive ? { ...spritePalette(enemySpriteKey(f.name)), ...variantTint(`${f.name}:${i}`) } : DEAD_TINT} />
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      ) : (foes || []).slice(0, 4).map((name, i) => {
        const rightPct = 5 + i * 12;
        const leftApprox = 100 - rightPct - 6;
        return (
          <motion.div key={`foe-${i}`}
            onClick={() => open('foe', leftApprox, name)}
            style={{ position: 'absolute', right: `${rightPct}%`, bottom: 6, zIndex: 5, transformOrigin: 'bottom center', cursor: 'pointer' }}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 1.8 + i * 0.25, repeat: Infinity, ease: 'easeInOut' }}>
            <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 2, fontSize: 7, fontWeight: 700, color: PAPER, background: '#7a1f1f', borderRadius: 2, padding: '0 3px', whiteSpace: 'nowrap', fontFamily: 'monospace', pointerEvents: 'none' }}>{name}</div>
            <PixelSprite grid={SPRITES[enemySpriteKey(name)]} px={3.4} flip palette={{ ...spritePalette(enemySpriteKey(name)), ...variantTint(`${name}:${i}`) }} />
          </motion.div>
        );
      })}

      {/* Ground chips — place-wide actions (look around / search), always on. */}
      {groundActions.length > 0 && (
        <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 7, display: 'flex', gap: 4 }}>
          {groundActions.map((a, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); onAction?.(a.tag); }}
              style={{ fontSize: 8, fontWeight: 700, background: INK, color: PAPER, border: 'none', borderRadius: 3, padding: '2px 5px', cursor: 'pointer', fontFamily: 'monospace', opacity: 0.9 }}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Action bubble — opened by clicking an actor or an open building. */}
      {sel && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 8 }} onClick={() => setSel(null)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: `${Math.max(16, Math.min(84, sel.x))}%`, bottom: '46%',
              transform: 'translateX(-50%)', zIndex: 9, minWidth: 96, maxWidth: 168,
              background: PAPER, color: INK, border: `2px solid ${INK}`, borderRadius: 6, padding: 6,
              boxShadow: '0 3px 8px rgba(0,0,0,0.35)', fontFamily: 'monospace',
            }}>
            <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 4, paddingBottom: 3, borderBottom: `1px solid ${MID}` }}>{sel.title}</div>
            {selActions.length ? selActions.map((a, i) => (
              <button key={i} onClick={() => { onAction?.(a.tag); setSel(null); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 9, fontWeight: 700, background: INK, color: PAPER, border: 'none', borderRadius: 3, padding: '4px 6px', marginTop: i ? 4 : 0, cursor: 'pointer' }}>
                {a.label}
              </button>
            )) : <div style={{ fontSize: 8, opacity: 0.6 }}>Nothing to do here.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Quest objective rendered as a small scroll-style UI card. Uses the active
// theme colours (--gb-* ramp) — the rolled top/bottom edges and a wax seal give
// the scroll silhouette without locking it to a parchment hue.
export function QuestScroll({ quest, goalName }: { quest: Quest; goalName?: string }) {
  return (
    <div style={{ position: 'relative', padding: '4px 0' }}>
      {/* rolled top */}
      <div style={{ height: 6, margin: '0 6px', borderRadius: '6px 6px 2px 2px', background: MID, boxShadow: 'inset 0 2px 0 rgba(0,0,0,0.18)' }} />
      <div
        style={{
          position: 'relative',
          background: `linear-gradient(180deg, ${PAPER}, color-mix(in oklab, ${PAPER} 82%, #c9a96a))`,
          border: `2px solid ${MID}`,
          color: INK,
          padding: '7px 10px 8px',
          boxShadow: 'inset 0 0 14px rgba(0,0,0,0.12), 0 2px 6px rgba(43,32,22,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.18em', opacity: 0.7, fontWeight: 700 }}>✦ QUEST</span>
          {quest.done && (
            <span style={{ fontSize: 8, fontWeight: 700, background: WAX, color: PAPER, borderRadius: 3, padding: '0 4px' }}>
              COMPLETE
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.15 }}>{quest.title}</div>
        <div style={{ fontSize: 10, lineHeight: 1.3, marginTop: 2, opacity: 0.92 }}>{quest.desc}</div>
        {(() => {
          // Objective shape decides the win line: slay the master, retrieve the relic,
          // or both. The relic-bearing objectives show a claimed/uncaught badge.
          const obj = quest.objective || 'slay';
          const relic = quest.relicName || 'the relic';
          const goalAt = goalName ? ` at ${goalName}` : '';
          const line = obj === 'retrieve'
            ? `Retrieve ${relic}${goalAt}`
            : obj === 'both'
              ? `Retrieve ${relic} and slay the master${goalAt}`
              : `Reach & clear ${goalName || 'the goal'}`;
          return (
            <div style={{ fontSize: 9, marginTop: 4, opacity: 0.85, fontStyle: 'italic' }}>
              ▸ Objective: {line}
              {obj !== 'slay' && (
                <span style={{ fontStyle: 'normal', fontWeight: 700, marginLeft: 4, color: quest.relicClaimed ? '#2f6b2f' : '#7a1f1f' }}>
                  {quest.relicClaimed ? '★ relic in hand' : '☆ relic not yet found'}
                </span>
              )}
            </div>
          );
        })()}
        {/* wax seal */}
        <div
          style={{
            position: 'absolute', right: 8, bottom: 6, width: 16, height: 16, borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #a83a3a, ${WAX})`,
            boxShadow: '0 1px 2px rgba(0,0,0,0.35)', border: '1px solid #5a1414',
          }}
        />
      </div>
      {/* rolled bottom */}
      <div style={{ height: 6, margin: '0 6px', borderRadius: '2px 2px 6px 6px', background: MID, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18)' }} />
    </div>
  );
}

// Enemy sprite for the combat view (keyword → sprite, falls back to bandit).
// `seed` recolours per-instance so duplicate foes (Skeleton 1/2…) read distinct.
export function EnemySprite({ name, px = 3, flip, seed }: { name: string; px?: number; flip?: boolean; seed?: string }) {
  const grid = SPRITES[enemySpriteKey(name)];
  if (!grid) return null;
  const palette = { ...spritePalette(enemySpriteKey(name)), ...(seed ? variantTint(seed) : undefined) };
  return <PixelSprite grid={grid} px={px} flip={flip} palette={palette} title={name} />;
}
