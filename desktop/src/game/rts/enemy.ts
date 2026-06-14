// RTS « Iron Marsh » — the LLM enemy commander glue. Three pure functions:
//
//   summarizeWorld  → a compact, FOG-LIMITED snapshot handed to the model (it never
//                     sees the whole map, only what its own units currently reveal).
//   validatePlan    → parse + whitelist-check a raw model reply into an EnemyPlan, or
//                     null if anything is off. Numbers the model invents are ignored.
//   fallbackPlan    → a deterministic plan used when the model is missing / garbles
//                     its reply, so the AI never stalls (fail-closed).
//
// This is the boundary that enforces client-owns-numbers on the enemy side: the LLM
// only ever produces strategic INTENT (stances, role names, target categories,
// taunt); state.applyEnemyPlan translates that through the same rule-checked commands
// a human player uses. No model-authored number reaches RtsState.

import { ALL_ROLES } from './data';
import {
  buildingCounts, creditCap, entitiesOf, powerStatus, sideOf, techAvailable,
  unitCounts, visibleTo,
} from './state';
import type {
  EnemyPlan, EnemyTarget, EntityKind, Owner, RtsState, RtsWorldView, Stance,
} from './types';

const STANCES: Stance[] = ['aggress', 'turtle', 'expand', 'raid', 'tech'];
const TARGETS: EnemyTarget[] = ['enemyHarvester', 'enemyPower', 'enemyBase', 'enemyArmy'];

// ── World view (fog-limited) ─────────────────────────────────────────────────
export function summarizeWorld(state: RtsState, owner: Owner = 'enemy'): RtsWorldView {
  const side = sideOf(state, owner);
  const foe: Owner = owner === 'enemy' ? 'player' : 'enemy';
  const pwr = powerStatus(state, owner);

  // Only the foe entities currently inside our fog are reported (no perfect info).
  const scoutedBuildings: RtsWorldView['scoutedEnemy']['buildings'] = {};
  const scoutedUnits: RtsWorldView['scoutedEnemy']['units'] = {};
  for (const e of entitiesOf(state, foe)) {
    if (!visibleTo(state, owner, e.x, e.y)) continue;
    if (e.isBuilding) scoutedBuildings[e.role as keyof typeof scoutedBuildings] =
      (scoutedBuildings[e.role as keyof typeof scoutedBuildings] || 0) + 1;
    else scoutedUnits[e.role as keyof typeof scoutedUnits] =
      (scoutedUnits[e.role as keyof typeof scoutedUnits] || 0) + 1;
  }

  const u = unitCounts(state, owner);
  const armyCount = (u.infantry || 0) + (u.at || 0) + (u.tank || 0) + (u.siege || 0) + (u.apex || 0);
  const cap = creditCap(state, owner);
  const baseFound = !!side.knownEnemyBase
    || Object.keys(scoutedBuildings).length > 0; // any scouted enemy structure = base located

  return {
    myFaction: side.faction,
    myCredits: Math.min(side.credits, cap),
    myPower: { supply: pwr.supply, draw: pwr.draw },
    myBuildings: buildingCounts(state, owner),
    myUnits: u,
    myArmyCount: armyCount,
    creditsFull: side.credits >= cap * 0.9,
    enemyBaseFound: baseFound,
    techAvailable: techAvailable(state, owner),
    scoutedEnemy: { buildings: scoutedBuildings, units: scoutedUnits },
    superweaponReady: side.superweapons.some(s => s.cooldownLeft <= 0),
    lastTaunt: side.plan?.taunt,
  };
}

// ── Validation (whitelist + parse, fail-closed) ──────────────────────────────
// `raw` may be an already-parsed object (from the sidecar) or a JSON string. Any
// unknown stance/role/target is dropped; an empty/garbage result returns null so the
// caller can substitute the deterministic fallback.
export function validatePlan(raw: unknown): EnemyPlan | null {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;

  const stance = STANCES.includes(obj.stance as Stance) ? (obj.stance as Stance) : null;
  if (!stance) return null; // stance is mandatory; without it the plan is meaningless

  const buildPriority = Array.isArray(obj.buildPriority)
    ? (obj.buildPriority as unknown[]).filter((r): r is EntityKind => ALL_ROLES.includes(r as EntityKind))
    : [];
  const targets = Array.isArray(obj.targets)
    ? (obj.targets as unknown[]).filter((t): t is EnemyTarget => TARGETS.includes(t as EnemyTarget))
    : [];
  const taunt = typeof obj.taunt === 'string' ? obj.taunt.slice(0, 160) : '';

  return { stance, buildPriority, targets, taunt };
}

// ── Deterministic fallback ───────────────────────────────────────────────────
// Reads the world and picks a sane next build + stance from rules alone — no model.
// Used on LLM failure AND as the seed plan at game start. Guarantees the enemy always
// has SOMETHING legal to do.
export function fallbackPlan(state: RtsState, owner: Owner = 'enemy'): EnemyPlan {
  const b = buildingCounts(state, owner);
  const u = unitCounts(state, owner);
  const view = summarizeWorld(state, owner);
  const priority: EntityKind[] = [];

  // 1) Keep the economy alive: power, then refinery, then a second harvester.
  if ((b.power || 0) < 2) priority.push('power');
  if ((b.refinery || 0) < 1) priority.push('refinery');
  if ((u.harvester || 0) < 2) priority.push('harvester');
  // 2) Stand up production.
  if ((b.barracks || 0) < 1) priority.push('barracks');
  if ((b.factory || 0) < 1) priority.push('factory');
  if ((b.defense || 0) < 1) priority.push('defense');
  // 3) Tech up, then build an army.
  if ((b.tech || 0) < 1) priority.push('tech');
  priority.push('tank', 'infantry', 'at', 'apex');

  // Keep only what's currently teched, but always leave at least one item so the
  // commander never goes idle.
  const teched = priority.filter(r => view.techAvailable.includes(r));
  const buildPriority: EntityKind[] = teched.length ? teched : ['power'];

  // Stance: turtle while we have no army; otherwise press the player.
  const army = (u.infantry || 0) + (u.at || 0) + (u.tank || 0) + (u.siege || 0) + (u.apex || 0);
  const seesPlayer = Object.keys(view.scoutedEnemy.buildings).length + Object.keys(view.scoutedEnemy.units).length > 0;
  const stance: Stance = army >= 4 ? (seesPlayer ? 'aggress' : 'expand') : 'turtle';
  const targets: EnemyTarget[] = ['enemyBase', 'enemyHarvester'];

  return { stance, buildPriority, targets, taunt: '' };
}

// Build the strict whitelist payload the sidecar prompt should constrain the model
// to. Centralised here so prompt + validation share one source of truth.
export function planVocabulary(): { stances: Stance[]; roles: EntityKind[]; targets: EnemyTarget[] } {
  return { stances: STANCES, roles: ALL_ROLES, targets: TARGETS };
}

// Convenience: turn a (possibly bad) model reply into a guaranteed-valid plan.
export function resolvePlan(state: RtsState, raw: unknown, owner: Owner = 'enemy'): { plan: EnemyPlan; fallback: boolean } {
  const v = validatePlan(raw);
  if (v && (v.buildPriority.length || v.targets.length)) return { plan: v, fallback: false };
  // Valid stance but empty body → keep the model's stance/taunt, fill the body.
  if (v) {
    const fb = fallbackPlan(state, owner);
    return { plan: { ...fb, stance: v.stance, taunt: v.taunt || fb.taunt }, fallback: false };
  }
  return { plan: fallbackPlan(state, owner), fallback: true };
}
