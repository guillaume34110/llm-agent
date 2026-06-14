// RTS « Iron Marsh » — the simulation core. Pure, deterministic, client-owned.
// Everything that is a NUMBER lives here: economy, power, tech gating, build,
// movement, combat, fog, win/loss. The LLM enemy only ever produces an EnemyPlan
// (intent strings); `applyEnemyPlan` translates it into concrete orders bounded by
// what the rules below allow. No model-authored number ever mutates RtsState.

import {
  ALL_BUILDING_ROLES, BUILD_RADIUS, DIFFICULTY_PRESETS, SILO_BASE_CAP,
  SUPERWEAPON_COOLDOWN, hitDamage, isBuildingRole, producerOf, spec, superweaponOf,
} from './data';
import { findPath } from './pathfind';
import { generateMap } from './map';
import type {
  BuildingRole, Difficulty, EnemyPlan, Entity, EntityKind, Faction, Owner,
  RtsState, SidePlayer, Terrain, UnitRole,
} from './types';

// ── Construction ─────────────────────────────────────────────────────────────

export function createGame(
  seed: number,
  playerFaction: Faction,
  difficulty: keyof typeof DIFFICULTY_PRESETS = 'normal',
): RtsState {
  const map = generateMap(seed);
  const diff: Difficulty = { ...DIFFICULTY_PRESETS[difficulty] };
  const enemyFaction: Faction = playerFaction === 'human' ? 'lizard' : 'human';

  const side = (owner: Owner, faction: Faction): SidePlayer => ({
    owner, faction,
    credits: diff.startCredits,
    queue: [],
    superweapons: [],
    plan: owner === 'enemy' ? null : null,
    wastedCredits: 0,
    knownEnemyBase: null,
  });

  const state: RtsState = {
    seed,
    w: map.w, h: map.h,
    terrain: map.terrain,
    ore: map.ore,
    oreMax: map.oreMax,
    entities: {},
    order: [],
    nextId: 1,
    player: side('player', playerFaction),
    enemy: side('enemy', enemyFaction),
    fog: { player: new Uint8Array(map.w * map.h), enemy: new Uint8Array(map.w * map.h) },
    tick: 0,
    winner: null,
    difficulty: diff,
  };

  // Each side starts with an HQ, a power plant, a refinery and one harvester —
  // the minimum to bootstrap the economy loop.
  bootstrapBase(state, 'player', playerFaction, map.playerStart);
  bootstrapBase(state, 'enemy', enemyFaction, map.enemyStart);
  recomputeFog(state);
  return state;
}

function bootstrapBase(state: RtsState, owner: Owner, faction: Faction, at: { x: number; y: number }) {
  const hq = spawnEntity(state, owner, faction, 'hq', at.x, at.y, true);
  hq.buildLeft = 0;
  const pwr = spawnEntity(state, owner, faction, 'power', at.x + 2, at.y, true);
  pwr.buildLeft = 0;
  const ref = spawnEntity(state, owner, faction, 'refinery', at.x, at.y + 2, true);
  ref.buildLeft = 0;
  const hv = spawnEntity(state, owner, faction, 'harvester', at.x + 1, at.y + 3, false);
  hv.order = { type: 'harvest' };
  hv.harvestPhase = 'toOre';
  hv.load = 0;
}

function spawnEntity(
  state: RtsState, owner: Owner, faction: Faction, role: EntityKind,
  x: number, y: number, isBuilding: boolean,
): Entity {
  const s = spec(role, faction);
  const e: Entity = {
    id: state.nextId++,
    owner, faction, role, isBuilding,
    x: isBuilding ? Math.floor(x) : x + 0.5,
    y: isBuilding ? Math.floor(y) : y + 0.5,
    hp: s.hp, maxHp: s.hp,
    order: { type: 'idle' },
    cooldownLeft: 0,
    buildLeft: isBuilding ? s.buildTicks : 0,
  };
  state.entities[e.id] = e;
  state.order.push(e.id);
  return e;
}

// ── Accessors ────────────────────────────────────────────────────────────────

export function sideOf(state: RtsState, owner: Owner): SidePlayer {
  return owner === 'player' ? state.player : state.enemy;
}
function idx(state: RtsState, x: number, y: number) { return Math.floor(y) * state.w + Math.floor(x); }
export function terrainAt(state: RtsState, x: number, y: number): Terrain {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return 'rock';
  return state.terrain[idx(state, x, y)];
}
export function entitiesOf(state: RtsState, owner: Owner): Entity[] {
  return state.order.map(id => state.entities[id]).filter(e => e && e.owner === owner);
}
export function functional(e: Entity): boolean { return e.buildLeft <= 0; }

export function buildingCounts(state: RtsState, owner: Owner): Partial<Record<BuildingRole, number>> {
  const out: Partial<Record<BuildingRole, number>> = {};
  for (const e of entitiesOf(state, owner)) {
    if (e.isBuilding && functional(e)) out[e.role as BuildingRole] = (out[e.role as BuildingRole] || 0) + 1;
  }
  return out;
}
export function unitCounts(state: RtsState, owner: Owner): Partial<Record<UnitRole, number>> {
  const out: Partial<Record<UnitRole, number>> = {};
  for (const e of entitiesOf(state, owner)) {
    if (!e.isBuilding) out[e.role as UnitRole] = (out[e.role as UnitRole] || 0) + 1;
  }
  return out;
}
function hasBuilding(state: RtsState, owner: Owner, role: BuildingRole): boolean {
  return entitiesOf(state, owner).some(e => e.role === role && e.isBuilding && functional(e));
}

// Credit storage cap = base silo buffer + each functional refinery's capacity.
export function creditCap(state: RtsState, owner: Owner): number {
  let cap = SILO_BASE_CAP;
  for (const e of entitiesOf(state, owner)) {
    if (e.role === 'refinery' && functional(e)) cap += spec('refinery', e.faction).refineryCap || 0;
  }
  return cap;
}

// ── Power ────────────────────────────────────────────────────────────────────
// Penalties are applied in escalating order as supply falls short of draw:
// radar first, then base defense goes offline, then production slows. Power never
// destroys anything — it throttles. (See red-alert-design skill.)
export interface PowerStatus {
  supply: number; draw: number; ratio: number;
  radarOn: boolean; defenseOn: boolean; prodSpeed: number;
}
export function powerStatus(state: RtsState, owner: Owner): PowerStatus {
  let supply = 0, draw = 0;
  for (const e of entitiesOf(state, owner)) {
    if (!e.isBuilding || !functional(e)) continue;
    const p = spec(e.role, e.faction).power;
    if (p > 0) supply += p; else draw += -p;
  }
  const ratio = draw === 0 ? Infinity : supply / draw;
  let radarOn = true, defenseOn = true, prodSpeed = 1;
  if (ratio < 1.0) radarOn = false;
  if (ratio < 0.75) defenseOn = false;
  if (ratio < 0.5) prodSpeed = 0.5;
  return { supply, draw, ratio, radarOn, defenseOn, prodSpeed };
}

// ── Tech gating ──────────────────────────────────────────────────────────────
export function canBuild(state: RtsState, owner: Owner, role: EntityKind): { ok: boolean; reason?: string } {
  const side = sideOf(state, owner);
  const s = spec(role, side.faction);
  for (const req of s.requires) {
    if (!hasBuilding(state, owner, req)) return { ok: false, reason: `requires_${req}` };
  }
  if (side.credits < s.cost) return { ok: false, reason: 'insufficient_credits' };
  return { ok: true };
}
// Roles the owner could start building right now (used for the LLM world view).
export function techAvailable(state: RtsState, owner: Owner): EntityKind[] {
  const out: EntityKind[] = [];
  for (const role of [...ALL_BUILDING_ROLES, 'harvester', 'infantry', 'at', 'tank', 'siege', 'apex'] as EntityKind[]) {
    const side = sideOf(state, owner);
    const s = spec(role, side.faction);
    if (s.requires.every(r => hasBuilding(state, owner, r))) out.push(role);
  }
  return out;
}

// ── Player / AI commands ─────────────────────────────────────────────────────

// Queue a unit at its producer building. Cost is deducted up front; cancel refunds.
export function issueBuild(state: RtsState, owner: Owner, role: UnitRole): boolean {
  if (isBuildingRole(role)) return false;
  const chk = canBuild(state, owner, role);
  if (!chk.ok) return false;
  const producer = entitiesOf(state, owner).find(e => e.role === producerOf(role) && functional(e));
  if (!producer) return false;
  const side = sideOf(state, owner);
  const s = spec(role, side.faction);
  side.credits -= s.cost;
  side.queue.push({ role, ticksLeft: s.buildTicks, fromId: producer.id });
  return true;
}

export function cancelBuild(state: RtsState, owner: Owner, queueIndex: number): boolean {
  const side = sideOf(state, owner);
  const job = side.queue[queueIndex];
  if (!job) return false;
  side.credits += spec(job.role, side.faction).cost;
  side.queue.splice(queueIndex, 1);
  return true;
}

// Place a building. Validates terrain, occupancy, build radius and tech/cost.
export function placeBuilding(state: RtsState, owner: Owner, role: BuildingRole, tx: number, ty: number): boolean {
  if (!isBuildingRole(role)) return false;
  tx = Math.floor(tx); ty = Math.floor(ty);
  if (terrainAt(state, tx, ty) !== 'ground') return false;
  if (occupied(state, tx, ty)) return false;
  if (!withinBuildRadius(state, owner, tx, ty)) return false;
  const chk = canBuild(state, owner, role);
  if (!chk.ok) return false;
  const side = sideOf(state, owner);
  side.credits -= spec(role, side.faction).cost;
  spawnEntity(state, owner, side.faction, role, tx, ty, true);
  return true;
}

function occupied(state: RtsState, tx: number, ty: number): boolean {
  return entitiesOf(state, 'player').concat(entitiesOf(state, 'enemy'))
    .some(e => e.isBuilding && Math.floor(e.x) === tx && Math.floor(e.y) === ty);
}
function withinBuildRadius(state: RtsState, owner: Owner, tx: number, ty: number): boolean {
  return entitiesOf(state, owner).some(e =>
    e.isBuilding && functional(e) && Math.hypot(Math.floor(e.x) - tx, Math.floor(e.y) - ty) <= BUILD_RADIUS);
}

export function issueMove(state: RtsState, ids: number[], tx: number, ty: number, attack = false) {
  for (const id of ids) {
    const e = state.entities[id];
    if (!e || e.isBuilding || e.role === 'harvester') continue;
    e.order = attack ? { type: 'attackMove', tx, ty } : { type: 'move', tx, ty };
    e.path = findPath(e.x, e.y, tx, ty, passableFor(state), state.w, state.h) || undefined;
  }
}
export function issueAttackTarget(state: RtsState, ids: number[], targetId: number) {
  for (const id of ids) {
    const e = state.entities[id];
    if (!e || e.isBuilding || e.role === 'harvester') continue;
    e.order = { type: 'attack', targetId };
    e.path = undefined;
  }
}

function passableFor(state: RtsState): (x: number, y: number) => boolean {
  const blocked = new Set<number>();
  for (const e of state.order.map(id => state.entities[id])) {
    if (e && e.isBuilding) blocked.add(Math.floor(e.y) * state.w + Math.floor(e.x));
  }
  return (x: number, y: number) => {
    const t = terrainAt(state, x, y);
    if (t === 'water' || t === 'rock') return false;
    return !blocked.has(Math.floor(y) * state.w + Math.floor(x));
  };
}

// ── The tick: advance the simulation one fixed step ──────────────────────────

export function tick(state: RtsState): RtsState {
  if (state.winner) return state;
  state.tick++;
  stepEconomy(state);
  stepConstruction(state, 'player');
  stepConstruction(state, 'enemy');
  stepProduction(state, 'player');
  stepProduction(state, 'enemy');
  stepMovement(state);
  stepCombat(state);
  resolveCollisions(state);   // no unit overlap, no unit standing inside a building
  stepSuperweapons(state);
  enemyStandingBehavior(state);
  cleanupDead(state);
  recomputeFog(state);
  rememberPlayerBase(state);  // commit any base sighting to memory (fresh fog)
  stepEnemyScouting(state);   // peel scouts ahead until the base is found
  checkWin(state);
  return state;
}

// Ore regrows slowly toward its original cap so fields don't strip bare in a minute,
// but ONLY on tiles that still hold ore — once a tile is fully mined out it stays
// barren. Keeps long games supplied without making income infinite. ~6 ore/sec/tile.
const ORE_REGEN_PER_TICK = 0.5;

function stepEconomy(state: RtsState) {
  const rate = state.difficulty.harvestRate;
  for (const e of state.order.map(id => state.entities[id])) {
    if (!e || e.role !== 'harvester' || e.order.type !== 'harvest') continue;
    runHarvester(state, e, rate);
  }
  // Regrow partially-mined veins (every 4th tick to stay cheap).
  if (state.tick % 4 === 0) {
    const ore = state.ore, max = state.oreMax;
    for (let i = 0; i < ore.length; i++) {
      if (ore[i] > 0 && ore[i] < max[i]) ore[i] = Math.min(max[i], ore[i] + ORE_REGEN_PER_TICK * 4);
    }
  }
}

function runHarvester(state: RtsState, e: Entity, rate: number) {
  const cap = spec('harvester', e.faction).capacity || 700;
  if (e.harvestPhase === 'toOre') {
    if (e.load && e.load >= cap) { e.harvestPhase = 'toRefinery'; e.path = undefined; return; }
    const ore = nearestFreeOre(state, e);
    if (!ore) return; // no ore reachable; idle in place
    if (Math.hypot(ore.x + 0.5 - e.x, ore.y + 0.5 - e.y) <= 1.5) {
      e.harvestPhase = 'mining'; e.path = undefined;
    } else {
      if (!e.path || e.path.length === 0) e.path = findPath(e.x, e.y, ore.x, ore.y, passableFor(state), state.w, state.h) || undefined;
      advanceAlongPath(state, e, spec('harvester', e.faction).speed || 0.06);
    }
  } else if (e.harvestPhase === 'mining') {
    const ore = nearestOre(state, e.x, e.y);
    e.load = e.load || 0;
    if (!ore || e.load >= cap) { e.harvestPhase = 'toRefinery'; e.path = undefined; return; }
    const i = ore.y * state.w + ore.x;
    const got = Math.min(rate, state.ore[i], cap - e.load);
    state.ore[i] -= got; e.load += got;
    if (state.ore[i] <= 0) state.terrain[i] = 'ground';
  } else { // toRefinery
    const ref = nearestRefinery(state, e);
    if (!ref) return;
    if (Math.hypot(ref.x - e.x, ref.y - e.y) <= 2) {
      const side = sideOf(state, e.owner);
      const cap2 = creditCap(state, e.owner);
      const room = Math.max(0, cap2 - side.credits);
      const stored = Math.min(room, e.load || 0);
      side.credits += stored;
      side.wastedCredits += (e.load || 0) - stored;
      e.load = 0; e.harvestPhase = 'toOre'; e.path = undefined;
    } else {
      if (!e.path || e.path.length === 0) e.path = findPath(e.x, e.y, Math.floor(ref.x), Math.floor(ref.y), passableFor(state), state.w, state.h) || undefined;
      advanceAlongPath(state, e, spec('harvester', e.faction).speed || 0.06);
    }
  }
}

function nearestOre(state: RtsState, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let ty = 0; ty < state.h; ty++) for (let tx = 0; tx < state.w; tx++) {
    const i = ty * state.w + tx;
    if (state.ore[i] > 0) {
      const d = Math.hypot(tx - x, ty - y);
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    }
  }
  return best;
}
// Like nearestOre but spreads harvesters out: skips ore tiles another harvester is
// already working (within ~1.2 tiles) so a fresh harvester picks the next vein instead
// of piling onto an occupied one. Falls back to plain nearest if every tile is taken.
function nearestFreeOre(state: RtsState, self: Entity): { x: number; y: number } | null {
  const others = state.order
    .map(id => state.entities[id])
    .filter(o => o && o.role === 'harvester' && o.id !== self.id && o.owner === self.owner);
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let ty = 0; ty < state.h; ty++) for (let tx = 0; tx < state.w; tx++) {
    const i = ty * state.w + tx;
    if (state.ore[i] <= 0) continue;
    if (others.some(o => Math.hypot(tx + 0.5 - o.x, ty + 0.5 - o.y) < 1.2)) continue; // taken
    const d = Math.hypot(tx - self.x, ty - self.y);
    if (d < bd) { bd = d; best = { x: tx, y: ty }; }
  }
  return best || nearestOre(state, self.x, self.y);
}
function nearestRefinery(state: RtsState, e: Entity): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const r of entitiesOf(state, e.owner)) {
    if (r.role !== 'refinery' || !functional(r)) continue;
    const d = Math.hypot(r.x - e.x, r.y - e.y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

// Buildings placed by the player/AI spawn at full buildLeft and must finish
// constructing before they count as `functional` (satisfy tech, train units, etc).
// Without this they'd stay forever non-functional and block all dependents.
function stepConstruction(state: RtsState, owner: Owner) {
  const mul = owner === 'enemy' ? state.difficulty.buildSpeedMul : 1;
  for (const e of entitiesOf(state, owner)) {
    if (e.isBuilding && e.buildLeft > 0) e.buildLeft = Math.max(0, e.buildLeft - mul);
  }
}

function stepProduction(state: RtsState, owner: Owner) {
  const side = sideOf(state, owner);
  if (side.queue.length === 0) return;
  let speed = powerStatus(state, owner).prodSpeed;
  if (owner === 'enemy') speed *= state.difficulty.buildSpeedMul;
  const job = side.queue[0];
  job.ticksLeft -= speed;
  if (job.ticksLeft <= 0) {
    const producer = state.entities[job.fromId];
    const at = producer && functional(producer) ? producer : entitiesOf(state, owner).find(b => b.role === producerOf(job.role) && functional(b));
    if (at) {
      const spot = freeSpotNear(state, Math.floor(at.x), Math.floor(at.y));
      const u = spawnEntity(state, owner, side.faction, job.role, spot.x, spot.y, false);
      if (job.role === 'harvester') { u.order = { type: 'harvest' }; u.harvestPhase = 'toOre'; u.load = 0; }
    }
    side.queue.shift();
  }
}

function freeSpotNear(state: RtsState, x: number, y: number): { x: number; y: number } {
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      const t = terrainAt(state, nx, ny);
      if (t === 'ground' || t === 'ore') return { x: nx, y: ny };
    }
  }
  return { x, y };
}

function stepMovement(state: RtsState) {
  for (const e of state.order.map(id => state.entities[id])) {
    if (!e || e.isBuilding || e.role === 'harvester') continue;
    if (e.order.type === 'move' || e.order.type === 'attackMove') {
      const o = e.order as { tx: number; ty: number };
      // Re-path if we have none or a building rose onto our route (stale path).
      if (!e.path || e.path.length === 0 || isBuildingTile(state, e.path[0].x, e.path[0].y)) {
        e.path = findPath(e.x, e.y, o.tx, o.ty, passableFor(state), state.w, state.h) || undefined;
      }
      const arrived = advanceAlongPath(state, e, spec(e.role, e.faction).speed || 0.08);
      if (arrived) e.order = { type: 'idle' };
    }
  }
}

// True when (x,y) sits on a building footprint — used to forbid land units from
// ever stepping onto / through a structure, even if their cached path is stale.
function isBuildingTile(state: RtsState, x: number, y: number): boolean {
  const fx = Math.floor(x), fy = Math.floor(y);
  for (const id of state.order) {
    const b = state.entities[id];
    if (b && b.isBuilding && Math.floor(b.x) === fx && Math.floor(b.y) === fy) return true;
  }
  return false;
}

// Move an entity one tick toward the head of its path; returns true when the path
// is exhausted (arrived). Mutates e.x/e.y/e.path. Refuses to enter a building tile:
// if the next step would land on a structure (stale path), it drops the path so the
// caller re-routes rather than clipping through the building.
function advanceAlongPath(state: RtsState, e: Entity, speed: number): boolean {
  if (!e.path || e.path.length === 0) return true;
  const wp = e.path[0];
  const dx = wp.x - e.x, dy = wp.y - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    if (isBuildingTile(state, wp.x, wp.y)) { e.path = undefined; return true; }
    e.x = wp.x; e.y = wp.y; e.path.shift(); return e.path.length === 0;
  }
  const nx = e.x + (dx / d) * speed, ny = e.y + (dy / d) * speed;
  if (isBuildingTile(state, nx, ny)) { e.path = undefined; return false; }
  e.x = nx; e.y = ny;
  return false;
}

function stepCombat(state: RtsState) {
  for (const e of state.order.map(id => state.entities[id])) {
    if (!e) continue;
    if (e.cooldownLeft > 0) e.cooldownLeft--;
    const s = spec(e.role, e.faction);
    if (s.damage == null || s.range == null) continue;          // unarmed
    if (e.isBuilding) {
      if (!functional(e)) continue;
      if (e.role === 'defense' && !powerStatus(state, e.owner).defenseOn) continue; // low power
    }
    // resolve / acquire target
    let target: Entity | null = null;
    if (e.order.type === 'attack') {
      const t = state.entities[(e.order as { targetId: number }).targetId];
      if (t && t.owner !== e.owner) target = t;
    }
    const aggressive = e.isBuilding || e.order.type === 'idle' || e.order.type === 'attackMove' || e.order.type === 'attack';
    if (!target && aggressive) target = acquire(state, e, s.sight);
    if (!target) continue;
    const dist = Math.hypot(target.x - e.x, target.y - e.y);
    if (dist <= (s.range || 0)) {
      if (e.cooldownLeft <= 0) {
        target.hp = Math.max(0, target.hp - hitDamage(s.warhead!, s.damage!, spec(target.role, target.faction).armor));
        e.cooldownLeft = s.cooldown || 6;
      }
    } else if (!e.isBuilding && (e.order.type === 'idle' || e.order.type === 'attackMove' || e.order.type === 'attack')) {
      // chase: refresh path toward the target periodically
      if (!e.path || e.path.length === 0 || state.tick % 6 === 0) {
        e.path = findPath(e.x, e.y, Math.floor(target.x), Math.floor(target.y), passableFor(state), state.w, state.h) || undefined;
      }
      advanceAlongPath(state, e, spec(e.role, e.faction).speed || 0.08);
    }
  }
}

function acquire(state: RtsState, e: Entity, sight: number): Entity | null {
  let best: Entity | null = null, bd = Infinity;
  for (const t of state.order.map(id => state.entities[id])) {
    if (!t || t.owner === e.owner || !functional(t)) continue;
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d <= sight && d < bd) { bd = d; best = t; }
  }
  return best;
}

function cleanupDead(state: RtsState) {
  const dead = state.order.filter(id => state.entities[id] && state.entities[id].hp <= 0);
  for (const id of dead) { delete state.entities[id]; }
  if (dead.length) state.order = state.order.filter(id => state.entities[id]);
}

// ── Collision resolution (soft separation) ───────────────────────────────────
// Units occupy space: a relaxation pass pushes any two overlapping units apart and
// ejects anything that ended up on a building footprint or impassable terrain. This
// is what stops units stacking on the same tile or sliding through structures, while
// staying cheap and deterministic (id-ordered, single pass per tick).
const UNIT_RADIUS = 0.42;
const MIN_SEP = UNIT_RADIUS * 2; // minimum centre-to-centre distance

function resolveCollisions(state: RtsState): void {
  const tilePassable = (x: number, y: number): boolean => {
    const t = terrainAt(state, x, y);
    if (t === 'water' || t === 'rock') return false;
    return !isBuildingTile(state, x, y);
  };
  const shift = (e: Entity, dx: number, dy: number) => {
    // Move on each axis only if the destination tile stays passable; clamp to map.
    if (tilePassable(e.x + dx, e.y)) e.x = Math.max(0.5, Math.min(state.w - 0.5, e.x + dx));
    if (tilePassable(e.x, e.y + dy)) e.y = Math.max(0.5, Math.min(state.h - 0.5, e.y + dy));
  };

  const units: Entity[] = [];
  const bumpers: Entity[] = []; // units that separate from each other (harvesters phase through)
  for (const id of state.order) {
    const e = state.entities[id];
    if (!e || e.isBuilding) continue;
    units.push(e);
    if (e.role !== 'harvester') bumpers.push(e);
  }

  // 1) Pairwise separation — push overlapping units apart by half the overlap each.
  //    Harvesters are EXCLUDED: economy units phase through one another so they never
  //    deadlock in traffic at the ore field or the refinery. Combat units still
  //    occupy space and refuse to stack.
  for (let a = 0; a < bumpers.length; a++) {
    for (let b = a + 1; b < bumpers.length; b++) {
      const ua = bumpers[a], ub = bumpers[b];
      let dx = ub.x - ua.x, dy = ub.y - ua.y;
      let d = Math.hypot(dx, dy);
      if (d >= MIN_SEP) continue;
      if (d < 1e-4) { // exact stack: deterministic nudge derived from ids
        dx = ((ua.id * 13 + 7) % 7) - 3;
        dy = ((ub.id * 11 + 5) % 7) - 3;
        d = Math.hypot(dx, dy) || 1;
      }
      const push = (MIN_SEP - d) / 2;
      const ox = (dx / d) * push, oy = (dy / d) * push;
      shift(ua, -ox, -oy);
      shift(ub, ox, oy);
    }
  }

  // 2) Eject any unit that still sits on a building / impassable tile.
  for (const u of units) {
    if (tilePassable(u.x, u.y)) continue;
    outer: for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = Math.floor(u.x) + dx + 0.5, ny = Math.floor(u.y) + dy + 0.5;
        if (tilePassable(nx, ny)) { u.x = nx; u.y = ny; break outer; }
      }
    }
  }
}

// ── Fog of war (per side) ────────────────────────────────────────────────────
function recomputeFog(state: RtsState) {
  for (const owner of ['player', 'enemy'] as Owner[]) {
    const fog = state.fog[owner];
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1; // visible -> explored
    for (const e of entitiesOf(state, owner)) {
      const sight = Math.ceil(spec(e.role, e.faction).sight);
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      for (let dy = -sight; dy <= sight; dy++) for (let dx = -sight; dx <= sight; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= state.w || y >= state.h) continue;
        if (Math.hypot(dx, dy) <= sight) fog[y * state.w + x] = 2;
      }
    }
  }
}
export function visibleTo(state: RtsState, owner: Owner, x: number, y: number): boolean {
  return state.fog[owner][idx(state, x, y)] === 2;
}

function checkWin(state: RtsState) {
  const pAlive = entitiesOf(state, 'player').some(e => e.isBuilding);
  const eAlive = entitiesOf(state, 'enemy').some(e => e.isBuilding);
  if (!eAlive) state.winner = 'player';
  else if (!pAlive) state.winner = 'enemy';
}

// ── Superweapons ─────────────────────────────────────────────────────────────
function stepSuperweapons(state: RtsState) {
  for (const owner of ['player', 'enemy'] as Owner[]) {
    const side = sideOf(state, owner);
    if (hasBuilding(state, owner, 'tech') && side.superweapons.length === 0) {
      side.superweapons.push({ role: superweaponOf(side.faction), cooldownLeft: SUPERWEAPON_COOLDOWN });
    }
    for (const sw of side.superweapons) if (sw.cooldownLeft > 0) sw.cooldownLeft--;
  }
}

// Fire the offensive superweapon at a tile (area delete). Player-driven; the enemy
// triggers it via applyEnemyPlan when ready and a juicy target is scouted.
export function fireSuperweapon(state: RtsState, owner: Owner, tx: number, ty: number): boolean {
  const side = sideOf(state, owner);
  const sw = side.superweapons.find(s => s.cooldownLeft <= 0);
  if (!sw) return false;
  const radius = 3, dmg = 600;
  for (const e of entitiesOf(state, owner === 'player' ? 'enemy' : 'player')) {
    if (Math.hypot(e.x - tx, e.y - ty) <= radius) {
      e.hp = Math.max(0, e.hp - hitDamage('explosive', dmg, spec(e.role, e.faction).armor));
    }
  }
  sw.cooldownLeft = SUPERWEAPON_COOLDOWN;
  cleanupDead(state);
  return true;
}

// ── Enemy commander: applying the validated LLM plan ─────────────────────────
// `applyEnemyPlan` is the ONLY place the LLM's intent touches the world, and it
// does so strictly through the same rule-checked commands a player uses. Anything
// unaffordable / un-teched / unreachable is silently skipped. This is the
// client-owns-numbers guarantee for the AI side.

export function applyEnemyPlan(state: RtsState, plan: EnemyPlan): void {
  const owner: Owner = 'enemy';
  const side = sideOf(state, owner);
  side.plan = plan;

  // 1) Economy safety net the LLM cannot override: scale harvesters to refineries
  //    (2 minimum, +1 per refinery, capped at 4) so the income line never dries up.
  const refineries = buildingCounts(state, owner).refinery || 0;
  const wantHarv = Math.min(4, 2 + refineries);
  const haveHarv = unitCounts(state, owner).harvester || 0;
  if (haveHarv < wantHarv && canBuild(state, owner, 'harvester').ok) issueBuild(state, owner, 'harvester');

  // 2) Build ONE structure following a fixed RA1 doctrine (economy → power → tech →
  //    defense), one at a time. The LLM's stance only tilts the targets/caps; the
  //    client decides what and how many — that's why it no longer spams a useless
  //    square block of redundant buildings.
  const next = nextEnemyStructure(state, plan);
  if (next) {
    const spot = enemyBuildSpot(state, owner, next);
    if (spot) placeBuilding(state, owner, next, spot.x, spot.y);
  }

  // 3) Train army from the plan's unit priority, with a small queue cap so credits
  //    are left over for structures and harvesters.
  trainEnemyArmy(state, plan);

  // 4) Army orders from stance + targets (best-effort, fog-limited).
  commandEnemyArmy(state, plan);

  // 5) Superweapon if ready and the player base has actually been seen (a mere
  //    guess is not enough to nuke — only confirmed intel).
  if (plan.stance === 'aggress' || plan.targets.includes('enemyBase')) {
    const ready = side.superweapons.some(s => s.cooldownLeft <= 0);
    if (ready) {
      const tgt = confirmedPlayerAnchor(state);
      if (tgt) fireSuperweapon(state, owner, tgt.x, tgt.y);
    }
  }
}

// Count buildings of every role INCLUDING those still under construction, so the
// doctrine doesn't re-place a structure that is already on its way up.
function allBuildingCounts(state: RtsState, owner: Owner): Partial<Record<BuildingRole, number>> {
  const out: Partial<Record<BuildingRole, number>> = {};
  for (const e of entitiesOf(state, owner)) {
    if (e.isBuilding) out[e.role as BuildingRole] = (out[e.role as BuildingRole] || 0) + 1;
  }
  return out;
}

// The deterministic enemy build order. Returns the single next structure to place,
// or null if nothing is needed/affordable. Mirrors a sane RA1 opening: never more
// than one structure rising at a time; power kept ahead of draw; one tech path up;
// defenses scaled to stance.
function nextEnemyStructure(state: RtsState, plan: EnemyPlan): BuildingRole | null {
  const owner: Owner = 'enemy';
  // One structure at a time — this alone kills the packed-square spam.
  const constructing = entitiesOf(state, owner).some(e => e.isBuilding && e.buildLeft > 0);
  if (constructing) return null;

  const b = allBuildingCounts(state, owner);
  const ps = powerStatus(state, owner);
  const can = (r: BuildingRole) => canBuild(state, owner, r).ok;
  const turtle = plan.stance === 'turtle';

  // 1) Power: keep supply comfortably ahead of draw (target ratio 1.3).
  if ((((b.power || 0) === 0) || ps.ratio < 1.3) && can('power')) return 'power';
  // 2) First refinery — the economy backbone.
  if ((b.refinery || 0) < 1 && can('refinery')) return 'refinery';
  // 3) Barracks — gates infantry and the war factory.
  if ((b.barracks || 0) < 1 && can('barracks')) return 'barracks';
  // 4) Second refinery for a steady income before committing to vehicles.
  if ((b.refinery || 0) < 2 && can('refinery')) return 'refinery';
  // 5) War factory — vehicles.
  if ((b.factory || 0) < 1 && can('factory')) return 'factory';
  // 6) Tech center — elite walker + superweapon (one only).
  if ((b.tech || 0) < 1 && can('tech')) return 'tech';
  // 7) Defenses, scaled by stance (turtle fortifies, aggress barely bothers).
  const defCap = turtle ? 4 : plan.stance === 'aggress' ? 1 : 2;
  if ((b.defense || 0) < defCap && can('defense')) return 'defense';
  // 8) A third refinery if rich and capped out elsewhere.
  if ((b.refinery || 0) < 3 && sideOf(state, owner).credits > 3000 && can('refinery')) return 'refinery';
  return null;
}

// Queue combat units following the model's priority, leaving a reserve for
// structures. Capped queue depth so the AI doesn't dump its whole bank on troops.
function trainEnemyArmy(state: RtsState, plan: EnemyPlan): void {
  const owner: Owner = 'enemy';
  const side = sideOf(state, owner);
  if (side.queue.length >= 2) return; // let the economy breathe

  const wanted = plan.buildPriority.filter(r => !isBuildingRole(r) && r !== 'harvester') as UnitRole[];
  const ladder: UnitRole[] = wanted.length ? wanted : ['infantry', 'at', 'tank'];
  for (const role of ladder) {
    if (issueBuild(state, owner, role)) return;
  }
  // Fallback: train the cheapest combat unit we can actually afford+tech.
  for (const role of ['infantry', 'at', 'tank', 'siege', 'apex'] as UnitRole[]) {
    if (issueBuild(state, owner, role)) return;
  }
}

// Pick a build tile that SPREADS structures instead of packing them in a square.
// Candidates = free ground inside the build radius; score rewards a 2-3 tile gap
// from existing buildings (anti-square) with a mild pull back toward the base so
// it stays cohesive. Defenses instead bias toward the scouted player (forward wall).
function enemyBuildSpot(state: RtsState, owner: Owner, role: BuildingRole): { x: number; y: number } | null {
  const mine = entitiesOf(state, owner).filter(e => e.isBuilding);
  const base = mine.find(e => e.role === 'hq');
  if (!base) return null;
  const bx = Math.floor(base.x), by = Math.floor(base.y);
  const toward = role === 'defense' ? scoutedPlayerAnchor(state) : null;

  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let dy = -BUILD_RADIUS; dy <= BUILD_RADIUS; dy++) {
    for (let dx = -BUILD_RADIUS; dx <= BUILD_RADIUS; dx++) {
      const x = bx + dx, y = by + dy;
      if (terrainAt(state, x, y) !== 'ground') continue;
      if (occupied(state, x, y)) continue;
      if (!withinBuildRadius(state, owner, x, y)) continue;
      let nearest = Infinity;
      for (const e of mine) nearest = Math.min(nearest, Math.hypot(Math.floor(e.x) - x, Math.floor(e.y) - y));
      let score = Math.min(nearest, 3); // reward spacing, but only up to ~3 tiles
      if (toward) score -= Math.hypot(toward.x - x, toward.y - y) * 0.15; // pull defenses forward
      else score -= Math.hypot(bx - x, by - y) * 0.02; // keep the base cohesive
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

// Translate stance + targets into a rally point and march the idle army there.
// Scouts are excluded — they keep exploring on their own until the base is found.
function commandEnemyArmy(state: RtsState, plan: EnemyPlan): void {
  const army = entitiesOf(state, 'enemy').filter(e => !e.isBuilding && e.role !== 'harvester' && !e.scouting);
  if (army.length === 0) return;
  const base = entitiesOf(state, 'enemy').find(e => e.role === 'hq');

  if (plan.stance === 'turtle' || plan.stance === 'tech') {
    if (base) issueMove(state, army.map(a => a.id), Math.floor(base.x), Math.floor(base.y), false);
    return;
  }
  // Prefer a specific scouted sub-target, else march on the base (seen, remembered,
  // or — failing both — the guessed enemy corner so the army always advances).
  let anchor: { x: number; y: number } | null = null;
  if (plan.targets.includes('enemyHarvester')) anchor = scoutedPlayerRole(state, 'harvester');
  else if (plan.targets.includes('enemyPower')) anchor = scoutedPlayerRole(state, 'power');
  anchor = anchor || enemyTargetAnchor(state);
  if (!anchor) return;
  // raid/expand send a fraction; aggress sends everyone.
  const portion = plan.stance === 'aggress' ? army : army.slice(0, Math.max(1, Math.floor(army.length * 0.6)));
  issueMove(state, portion.map(a => a.id), anchor.x, anchor.y, true);
}

// The base location the enemy may legally TARGET with intel it actually has: a tile
// currently in fog, or the last place the base was seen. null if never sighted.
function confirmedPlayerAnchor(state: RtsState): { x: number; y: number } | null {
  return scoutedPlayerAnchor(state) || state.enemy.knownEnemyBase || null;
}
// Where to MARCH: confirmed intel if any, otherwise a deterministic guess (the
// mirror of our own HQ, since starts sit in opposite corners). The guess lets the
// army push toward the base and reveal it instead of sitting blind.
function enemyTargetAnchor(state: RtsState): { x: number; y: number } | null {
  return confirmedPlayerAnchor(state) || guessedPlayerBase(state);
}
function guessedPlayerBase(state: RtsState): { x: number; y: number } | null {
  const hq = entitiesOf(state, 'enemy').find(e => e.role === 'hq');
  if (!hq) return null;
  return { x: (state.w - 1) - Math.floor(hq.x), y: (state.h - 1) - Math.floor(hq.y) };
}
// Commit a base sighting to memory so the army keeps pressing it through the fog.
// Once known, scouts are released back into the main army.
function rememberPlayerBase(state: RtsState): void {
  const seen = scoutedPlayerRole(state, 'hq') || scoutedPlayerRole(state, 'refinery');
  if (seen) {
    state.enemy.knownEnemyBase = seen;
    for (const e of entitiesOf(state, 'enemy')) if (e.scouting) e.scouting = false;
  }
}

// Last-known player position the enemy may legally target (must be fog-visible).
function scoutedPlayerAnchor(state: RtsState): { x: number; y: number } | null {
  return scoutedPlayerRole(state, 'hq') || scoutedPlayerRole(state, 'refinery') || scoutedAny(state);
}
function scoutedPlayerRole(state: RtsState, role: EntityKind): { x: number; y: number } | null {
  for (const e of entitiesOf(state, 'player')) {
    if (e.role === role && visibleTo(state, 'enemy', e.x, e.y)) return { x: Math.floor(e.x), y: Math.floor(e.y) };
  }
  return null;
}
function scoutedAny(state: RtsState): { x: number; y: number } | null {
  for (const e of entitiesOf(state, 'player')) {
    if (visibleTo(state, 'enemy', e.x, e.y)) return { x: Math.floor(e.x), y: Math.floor(e.y) };
  }
  return null;
}

// Between LLM calls, keep enemy units pressing the base so the AI attacks often and
// doesn't go limp. ~once per second: as soon as a small force has massed, march every
// idle combat unit on the base (seen, remembered, or guessed). Scouts excluded.
const ENEMY_ATTACK_MIN = 3;   // troops needed before the standing army commits to a push
const ENEMY_ALL_IN = 12;      // once this many have massed, throw EVERYTHING at the base
function enemyStandingBehavior(state: RtsState): void {
  const plan = state.enemy.plan;
  if (!plan || state.tick % 12 !== 0) return; // ~once per second
  const army = entitiesOf(state, 'enemy').filter(e => !e.isBuilding && e.role !== 'harvester' && !e.scouting);

  // OVERFLOW ALL-IN: when too many units have stockpiled, commit the WHOLE army at the
  // base — even out of a holding stance. A standing army that just sits is wasted; a big
  // ball that never attacks is the worst outcome. This is the "too many units → smash"
  // safety valve on top of whatever the LLM picked.
  if (army.length >= ENEMY_ALL_IN) {
    const anchor = enemyTargetAnchor(state);
    if (anchor) issueMove(state, army.map(a => a.id), anchor.x, anchor.y, true);
    return;
  }

  if (plan.stance === 'turtle' || plan.stance === 'tech') return; // hold
  if (army.length < ENEMY_ATTACK_MIN) return; // wait until a force has massed
  const idle = army.filter(e => e.order.type === 'idle');
  if (idle.length === 0) return;
  const anchor = enemyTargetAnchor(state);
  if (anchor) issueMove(state, idle.map(a => a.id), anchor.x, anchor.y, true);
}

// Until the base is found, peel up to two cheap soldiers off as scouts and send them
// toward the guessed enemy corner, revealing fog on the way. Found base → rememberPlayerBase
// clears the scouting flag and they rejoin the army. Keeps idle scouts moving.
const MAX_SCOUTS = 2;
function stepEnemyScouting(state: RtsState): void {
  if (state.tick % 12 !== 0) return;            // ~once per second
  if (state.enemy.knownEnemyBase) return;       // base already found → army takes over
  const guess = guessedPlayerBase(state);
  if (!guess) return;
  const soldiers = entitiesOf(state, 'enemy').filter(e => !e.isBuilding && e.role !== 'harvester');
  const scouts = soldiers.filter(e => e.scouting);
  // Keep existing scouts marching toward the guess if they idled out.
  for (const sc of scouts) if (sc.order.type === 'idle') issueMove(state, [sc.id], guess.x, guess.y, true);
  // Promote the cheapest available soldiers up to the scout cap.
  if (scouts.length >= MAX_SCOUTS) return;
  const free = soldiers
    .filter(e => !e.scouting)
    .sort((a, b) => spec(a.role, a.faction).cost - spec(b.role, b.faction).cost);
  for (const e of free) {
    if (scouts.length >= MAX_SCOUTS) break;
    e.scouting = true;
    scouts.push(e);
    issueMove(state, [e.id], guess.x, guess.y, true);
  }
}

// ── Save / load (localStorage; no server involvement — local-first) ──────────
export function serialize(state: RtsState): string {
  return JSON.stringify({
    ...state,
    fog: { player: Array.from(state.fog.player), enemy: Array.from(state.fog.enemy) },
  });
}
export function deserialize(json: string): RtsState {
  const o = JSON.parse(json);
  o.fog = { player: Uint8Array.from(o.fog.player), enemy: Uint8Array.from(o.fog.enemy) };
  if (!Array.isArray(o.oreMax)) o.oreMax = (o.ore as number[]).slice(); // legacy saves
  return o as RtsState;
}
