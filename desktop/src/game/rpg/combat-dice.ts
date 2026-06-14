import type {
  Character, Enemy, EnemyTactics, CombatFace, CombatDie, CombatResolution,
} from './types';

// Re-exported so existing importers keep pulling these shapes from the engine.
export type { CombatFace, CombatDie, CombatResolution };

// ── Tactical dice combat (the Curious-Expedition-2 battle model) ─────────────
// CE2 is dice-on-BOTH-sides. Each living member contributes one die whose six
// faces are fixed by their class profile (a brawler's die is mostly swords, a
// cleric's holds shields, a mage's holds stars). The FOES roll too: every living
// foe brings its own one-to-three visible dice (swords + a guard), so the board
// is a symmetric exchange, not a one-sided d20. The player then ASSIGNS each of
// their faces: a sword onto a foe (focus-firing one target stacks a combo bonus),
// a shield onto the party (raising a block wall that soaks the foes' sword dice),
// a star as a wildcard for either. Blanks do nothing but can be re-rolled
// (push-your-luck) at a morale cost. This module is a PURE, seed-driven leaf: it
// rolls both pools and computes the numeric resolution. The caller (state.ts)
// owns every HP mutation, kill, status and win/lose consequence — the LLM never
// sees a die.

// The board key for the literal 'party' block target.
export const PARTY_TARGET = 'party';

// Push-your-luck: re-rolling the leftover (unassigned) dice costs morale, rising
// each push — the same escalation the scene-check pool uses.
export const COMBAT_REROLL_BASE = 6;
export const COMBAT_REROLL_STEP = 4;
export const COMBAT_MAX_REROLLS = 3;

// ── Die faces ────────────────────────────────────────────────────────────────
// A member's six-face die, derived deterministically from their stats. Always
// at least one sword (everyone can swing) and one blank (push-your-luck tension);
// might/agility add swords, spirit adds shields, wits adds stars.
export function dieFaces(c: Character): CombatFace[] {
  const { might, agility, wits, spirit } = c.stats;
  let sword = Math.min(3, 1 + Math.floor((might + agility) / 6)); // 1..3
  let shield = Math.min(2, Math.floor((spirit + Math.floor(might / 2)) / 4)); // 0..2
  let star = Math.min(2, Math.floor((wits + Math.floor(spirit / 2)) / 4)); // 0..2
  // Keep at least one blank face: trim the richest symbol first.
  while (sword + shield + star > 5) {
    if (star > 0) star--; else if (shield > 0) shield--; else sword--;
  }
  const faces: CombatFace[] = [];
  for (let i = 0; i < sword; i++) faces.push('sword');
  for (let i = 0; i < shield; i++) faces.push('shield');
  for (let i = 0; i < star; i++) faces.push('star');
  while (faces.length < 6) faces.push('blank');
  return faces;
}

// The numeric weight a rolled face carries, read off the member's stats. A sword
// swings on the best martial stat, a shield guards on spirit/might, a star (the
// wildcard) channels arcane focus. A blank is inert.
export function facePower(c: Character, face: CombatFace): number {
  switch (face) {
    case 'sword': return 1 + Math.floor(Math.max(c.stats.might, c.stats.agility) / 2);
    case 'shield': return 1 + Math.floor(Math.max(c.stats.spirit, c.stats.might) / 2);
    case 'star': return 1 + Math.floor(Math.max(c.stats.wits, c.stats.spirit) / 2);
    default: return 0;
  }
}

// Roll one member's die: pick a face from their fixed table, read its power.
export function rollCombatDie(rng: () => number, c: Character, idx: number): CombatDie {
  const faces = dieFaces(c);
  const face = faces[Math.floor(rng() * faces.length) % faces.length];
  return { id: `cd-${c.id}-${idx}`, by: c.name, memberId: c.id, face, power: facePower(c, face), assignedTo: null };
}

// Roll the full pool — one die per living member, in roster order.
export function rollCombatPool(party: Character[], rng: () => number): CombatDie[] {
  const dice: CombatDie[] = [];
  let i = 0;
  for (const c of party) {
    if (!c.alive) continue;
    dice.push(rollCombatDie(rng, c, i++));
  }
  return dice;
}

// Push-your-luck: re-roll every UNASSIGNED die (committed dice are locked in).
// Each die's member is looked up so its fixed face table + power stay honest.
// Ids are preserved (the UI re-mounts on a reroll counter, not the id).
export function rerollUnassigned(dice: CombatDie[], party: Character[], rng: () => number): CombatDie[] {
  const byId: Record<string, Character> = {};
  for (const c of party) byId[c.id] = c;
  return dice.map(d => {
    if (d.assignedTo !== null) return d;
    const c = byId[d.memberId];
    if (!c) return d;
    const faces = dieFaces(c);
    const face = faces[Math.floor(rng() * faces.length) % faces.length];
    return { ...d, face, power: facePower(c, face) };
  });
}

// ── Enemy dice (the symmetric CE2 foe board) ─────────────────────────────────
// The foes don't just telegraph one number — they roll their own visible pool.
// Each living foe contributes one-to-three dice (tougher foes crowd the board)
// whose faces lean aggressive (swords) but carry a guard (shield) and the odd
// blank. A swung sword is an incoming attack (resolved through the party's block
// wall); a rolled shield is that foe's guard (soaking the party's swords aimed at
// it). Foes have no wildcard. All seed-driven; the caller owns every HP mutation.

// How many dice a foe brings: tougher (higher-atk) foes put more dice on the board.
export function enemyDieCount(e: Enemy): number {
  return Math.max(1, Math.min(3, 1 + Math.floor(e.atk / 5)));
}

// A foe's fixed six-face die. Mostly swords, one guard, blanks for variance; a
// badly wounded foe (under 35% hp) trades a sword face for a second shield — the
// same turtle reflex the old intent had, now expressed on the die. Its tactics
// archetype leans the face mix (the foe's "decision" on how to roll): aggressors
// and brutes pack an extra sword, defenders trade a sword for a guard, skirmishers
// drop a sword for blanks (hit-and-run variance). Trickster keeps the baseline.
export function enemyDieFaces(e: Enemy): CombatFace[] {
  let sword = Math.max(2, Math.min(4, 2 + Math.floor(e.atk / 4))); // 2..4
  let shield = 1;
  const tac: EnemyTactics = e.tactics || 'trickster';
  if (tac === 'aggressor' || tac === 'brute') sword = Math.min(5, sword + 1);
  else if (tac === 'defender') { shield += 1; sword = Math.max(1, sword - 1); }
  else if (tac === 'skirmisher') sword = Math.max(1, sword - 1);
  if (e.hp < e.maxHp * 0.35 && sword > 1) { sword--; shield++; }   // wounded → guard up
  const faces: CombatFace[] = [];
  for (let i = 0; i < sword; i++) faces.push('sword');
  for (let i = 0; i < shield; i++) faces.push('shield');
  while (faces.length < 6) faces.push('blank');
  return faces.slice(0, 6);
}

// Face weight for a foe: a sword bites for ~atk SPLIT across its dice (so a multi-
// die boss totals about atk per round, not atk×3); a shield soaks a slice of its
// own atk. Blank is inert.
export function enemyFacePower(e: Enemy, face: CombatFace): number {
  const cnt = enemyDieCount(e);
  switch (face) {
    case 'sword': return Math.max(1, Math.ceil((e.atk + 1) / cnt));
    case 'shield': return 1 + Math.ceil(e.atk / 4);
    default: return 0;
  }
}

// Roll one of a foe's dice: pick a face from its fixed table, read its power.
export function rollEnemyDie(rng: () => number, e: Enemy, idx: number): CombatDie {
  const faces = enemyDieFaces(e);
  const face = faces[Math.floor(rng() * faces.length) % faces.length];
  return { id: `ed-${e.id}-${idx}`, by: e.name, memberId: e.id, face, power: enemyFacePower(e, face), assignedTo: null };
}

// Roll every living foe's dice into one visible pool (the foe board). Reuses the
// CombatDie shape (memberId = the foe's id); foe dice never carry an assignment —
// their faces ARE their plan.
export function rollEnemyPool(enemies: Enemy[], rng: () => number): CombatDie[] {
  const dice: CombatDie[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const n = enemyDieCount(e);
    for (let i = 0; i < n; i++) dice.push(rollEnemyDie(rng, e, i));
  }
  return dice;
}

// ── Assignment ───────────────────────────────────────────────────────────────
// Focus-fire reward: piling swords on ONE foe lands a heavier blow. Two swords =
// heavy (+2), three or more = crushing (+(n-1)*2). A lone sword gets nothing.
export function comboBonus(swordCount: number): number {
  if (swordCount >= 3) return (swordCount - 1) * 2;
  if (swordCount === 2) return 2;
  return 0;
}

// Is this die legal on this target? Blanks never assign; shields guard the party;
// swords strike a (living) foe; a star is the wildcard for either side. Passing
// null (unassign) is always legal.
export function canAssign(die: CombatDie, target: string | null, enemyIds: string[]): boolean {
  if (die.face === 'blank') return false;
  if (target === null) return true;
  if (target === PARTY_TARGET) return die.face === 'shield' || die.face === 'star';
  if (!enemyIds.includes(target)) return false;
  return die.face === 'sword' || die.face === 'star';
}

// Pure: return a new pool with one die's target changed (no-op if illegal).
export function assignDie(dice: CombatDie[], dieId: string, target: string | null, enemyIds: string[]): CombatDie[] {
  return dice.map(d => {
    if (d.id !== dieId) return d;
    if (!canAssign(d, target, enemyIds)) return d;
    return { ...d, assignedTo: target };
  });
}

// ── Target policy (the foe's visible per-round decision) ─────────────────────
// Whom a foe's sword seeks, by archetype. PURE + deterministic (ties resolve to
// the first living member in roster order); only the trickster spends rng, so a
// fixed-policy foe never perturbs the seed stream. Aggressors execute the weakest
// (lowest hp), skirmishers knife the frailest (lowest maxHp backliner), brutes
// crash the toughest (highest maxHp wall), defenders answer the biggest threat
// (most martial = might+agility), tricksters strike at random.
export function pickVictim(tactics: EnemyTactics, living: Character[], rng: () => number): Character | null {
  if (living.length === 0) return null;
  switch (tactics) {
    case 'aggressor': return living.reduce((a, b) => b.hp < a.hp ? b : a);
    case 'skirmisher': return living.reduce((a, b) => b.maxHp < a.maxHp ? b : a);
    case 'brute': return living.reduce((a, b) => b.maxHp > a.maxHp ? b : a);
    case 'defender': {
      const threat = (m: Character) => m.stats.might + m.stats.agility;
      return living.reduce((a, b) => threat(b) > threat(a) ? b : a);
    }
    case 'trickster':
    default: return living[Math.floor(rng() * living.length) % living.length];
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────
// Resolve a committed round, simultaneously — both pools clash. The party's
// swords/stars damage the foes they were assigned to (combo bonus per foe, minus
// that foe's own rolled GUARD = its shield dice); the party's shields/stars raise
// a block wall that soaks the foes' rolled SWORD dice in order, the overflow
// landing on random living members. PURE — returns numbers only; the caller
// applies them to HP and decides kills.
export function resolveCombat(
  dice: CombatDie[],
  enemies: Enemy[],
  enemyDice: CombatDie[],
  party: Character[],
  rng: () => number,
): CombatResolution {
  const living = enemies.filter(e => e.alive);
  const livingIds = living.map(e => e.id);

  // Party block wall — shields and party-assigned stars.
  let partyBlock = 0;
  for (const d of dice) {
    if (d.assignedTo === PARTY_TARGET) partyBlock += d.power;
  }

  // Each foe's guard is the sum of its own rolled shield dice.
  const guardOf: Record<string, number> = {};
  for (const ed of enemyDice) {
    if (ed.face === 'shield') guardOf[ed.memberId] = (guardOf[ed.memberId] || 0) + ed.power;
  }

  // Damage per foe: stacked party swords/stars, combo bonus, minus the foe's guard.
  const enemyDamage: Record<string, number> = {};
  for (const id of livingIds) {
    const onFoe = dice.filter(d => d.assignedTo === id);
    if (onFoe.length === 0) { enemyDamage[id] = 0; continue; }
    const raw = onFoe.reduce((n, d) => n + d.power, 0) + comboBonus(onFoe.length);
    enemyDamage[id] = Math.max(0, raw - (guardOf[id] || 0));
  }

  // Each foe's tactics drive whom its swords seek (its visible per-round decision).
  const tacticsOf: Record<string, EnemyTactics> = {};
  for (const e of enemies) tacticsOf[e.id] = e.tactics || 'trickster';

  // Foe sword dice are incoming attacks: each resolves through the shared block
  // wall, the overflow striking the member its foe's target policy picks.
  let block = partyBlock;
  let incoming = 0;
  const memberDamage: { memberId: string; amount: number }[] = [];
  for (const ed of enemyDice) {
    if (ed.face !== 'sword') continue;
    incoming += ed.power;
    const net = Math.max(0, ed.power - block);
    block = Math.max(0, block - ed.power);
    if (net <= 0) continue;
    const targets = party.filter(m => m.alive);
    if (targets.length === 0) continue;
    const victim = pickVictim(tacticsOf[ed.memberId] || 'trickster', targets, rng) || targets[0];
    memberDamage.push({ memberId: victim.id, amount: net });
  }
  const mitigated = incoming - memberDamage.reduce((n, m) => n + m.amount, 0);

  return { enemyDamage, memberDamage, partyBlock, incoming, mitigated };
}

// Convenience: are all dice either assigned or blank (nothing useful left to do)?
export function poolSpent(dice: CombatDie[]): boolean {
  return dice.every(d => d.assignedTo !== null || d.face === 'blank');
}
