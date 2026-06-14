import type { MapNode, NodeKind, Enemy, EnemyTactics, RpgState } from './types';
import { makeRng, seedFrom } from './dice';
import { diffOf, type DiffParams } from './difficulty';
import { partyDamagePerRound, partyAvgLevel } from './party-stats';
import { uid } from './ids';

// ── Bestiary (foe rosters + bosses; pure builders, client owns every number) ──

// Each species carries a battle personality (its tactics archetype). It's a
// thematic authoring choice — golems brute, specters trickster, sentinels defend
// — that the pure engine turns into dice lean + target policy. Closed enum, so
// it can later be LLM-authored per species without touching the math.
export interface EnemyTemplate { name: string; glyph: string; tac: EnemyTactics; }

export const ENEMY_TABLE: Record<NodeKind, EnemyTemplate[]> = {
  dungeon: [
    { name: 'Skeleton', glyph: '☠', tac: 'aggressor' }, { name: 'Wraith', glyph: '👁', tac: 'trickster' }, { name: 'Crypt Guardian', glyph: '⚰', tac: 'defender' },
    { name: 'Bone Golem', glyph: '🗿', tac: 'brute' }, { name: 'Death Cultist', glyph: '🕯', tac: 'skirmisher' }, { name: 'Skull Mimic', glyph: '📦', tac: 'trickster' },
    { name: 'Lich', glyph: '🧙', tac: 'trickster' }, { name: 'Grave Wight', glyph: '🦴', tac: 'aggressor' },
  ],
  cave: [
    { name: 'Cave Lurker', glyph: '◔', tac: 'skirmisher' }, { name: 'Giant Spider', glyph: '🕷', tac: 'aggressor' }, { name: 'Troll', glyph: '👹', tac: 'brute' },
    { name: 'Cave Serpent', glyph: '🐍', tac: 'skirmisher' }, { name: 'Rock Golem', glyph: '🗿', tac: 'brute' }, { name: 'Lurking Mimic', glyph: '📦', tac: 'trickster' },
    { name: 'Bat Swarm', glyph: '🦇', tac: 'skirmisher' }, { name: 'Cave Bear', glyph: '🐻', tac: 'brute' },
  ],
  ruin: [
    { name: 'Animated Statue', glyph: '⌖', tac: 'defender' }, { name: 'Cursed Sentinel', glyph: '☗', tac: 'defender' }, { name: 'Specter', glyph: '👁', tac: 'trickster' },
    { name: 'Stone Golem', glyph: '🗿', tac: 'brute' }, { name: 'Ruin Cultist', glyph: '🕯', tac: 'skirmisher' }, { name: 'Coiled Naga', glyph: '🐍', tac: 'aggressor' },
    { name: 'Gargoyle', glyph: '🦇', tac: 'defender' }, { name: 'Dust Revenant', glyph: '👻', tac: 'aggressor' },
  ],
  forest: [
    { name: 'Dire Wolf', glyph: '🐺', tac: 'aggressor' }, { name: 'Bandit', glyph: '🗡', tac: 'skirmisher' }, { name: 'Treant', glyph: '♣', tac: 'brute' },
    { name: 'Forest Viper', glyph: '🐍', tac: 'skirmisher' }, { name: 'Woodland Imp', glyph: '😈', tac: 'trickster' },
    { name: 'Bramble Bear', glyph: '🐻', tac: 'brute' }, { name: 'Poacher', glyph: '🏹', tac: 'skirmisher' }, { name: 'Boar', glyph: '🐗', tac: 'aggressor' },
  ],
  wild: [
    { name: 'Raider', glyph: '🗡', tac: 'aggressor' }, { name: 'Wild Beast', glyph: '🐗', tac: 'brute' }, { name: 'Marauder', glyph: '⚔', tac: 'aggressor' },
    { name: 'Marsh Serpent', glyph: '🐍', tac: 'skirmisher' }, { name: 'Bog Imp', glyph: '😈', tac: 'trickster' },
    { name: 'Harpy', glyph: '🦅', tac: 'skirmisher' }, { name: 'Ogre', glyph: '👹', tac: 'brute' }, { name: 'Jackal Pack', glyph: '🐺', tac: 'aggressor' },
  ],
  town: [
    { name: 'Thug', glyph: '🗡', tac: 'aggressor' }, { name: 'Cutpurse', glyph: '🥷', tac: 'skirmisher' }, { name: 'Street Mimic', glyph: '📦', tac: 'trickster' },
    { name: 'Enforcer', glyph: '🛡', tac: 'defender' }, { name: 'Brawler', glyph: '👊', tac: 'brute' },
  ],
  village: [
    { name: 'Brigand', glyph: '🗡', tac: 'aggressor' }, { name: 'Mad Dog', glyph: '🐕', tac: 'aggressor' }, { name: 'Hedge Imp', glyph: '😈', tac: 'trickster' },
    { name: 'Rabble', glyph: '🔱', tac: 'brute' }, { name: 'Sneak Thief', glyph: '🥷', tac: 'skirmisher' },
  ],
  camp: [
    { name: 'Ambusher', glyph: '🗡', tac: 'skirmisher' }, { name: 'Scavenger', glyph: '🐀', tac: 'trickster' }, { name: 'Camp Cultist', glyph: '🕯', tac: 'defender' },
    { name: 'Deserter', glyph: '⚔', tac: 'aggressor' }, { name: 'Looter', glyph: '🎒', tac: 'skirmisher' },
  ],
};

// Boss epithet woven onto the deepest foe of a node (was always "X Lord"). Picked
// deterministically per node so a given crypt always crowns the same tyrant.
export const BOSS_TITLES = ['Lord', 'Tyrant', 'Overlord', 'the Ancient', 'the Dread', 'Warlord', 'the Eternal', 'the Cruel', 'the Fell', 'the Undying', 'the Grim', 'Despot'];

// The SINGLE foe roster for an open node — the same Enemy[] used to draw the scene
// (place + enemies in one view) and to fight there. Deterministic per node (stable
// ids), so the band you see is exactly the band you fight, and foes already slain
// (node.defeatedFoes) drop out — a partial fight leaves the survivors in the scene.
export function nodeRoster(node: MapNode, state: RpgState): Enemy[] {
  if (node.danger <= 0 || node.cleared) return [];
  const dead = new Set(node.defeatedFoes || []);
  const all = makeEnemies(node, makeRng(seedFrom(`foes:${node.id}:${node.kind}`)), diffOf(state), state, `foe:${node.id}`);
  return all.filter(e => !dead.has(e.id));
}

export function makeEnemies(node: MapNode, rng: () => number, diff: DiffParams, state: RpgState, idPrefix?: string): Enemy[] {
  const pool = ENEMY_TABLE[node.kind] || ENEMY_TABLE.wild;
  const danger = Math.max(1, node.danger);
  // Every foe acts each round, so count is the deadliest lever — denser packs on
  // dangerous ground.
  const count = danger >= 3 ? 3 : danger >= 2 ? 2 : 1;
  // The pack's total bulk = how many rounds of the party's OWN damage it soaks.
  // This is the fix for one-shotting: foe HP tracks the party's offence, so a
  // veteran band meets sturdier foes instead of deleting them. A built party
  // still wins (factor < 1, and leveling buys survivability via maxHp), but a
  // fight now lasts a few rounds and costs real HP. Client-owned; LLM sees none.
  const dpr = partyDamagePerRound(state);
  const rounds = 1.7 + danger * 0.5;              // low danger dies fast, high danger drags
  const totalHp = Math.max(count * 5, Math.round(dpr * rounds * 0.9 * diff.hp));
  const avgLvl = partyAvgLevel(state);
  const enemies: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const t = pool[Math.floor(rng() * pool.length)];
    // Split the bulk across the pack, with jitter so they aren't identical clones.
    const hp = Math.max(4, Math.round((totalHp / count) * (0.85 + rng() * 0.3)));
    enemies.push({
      // Stable, deterministic id when a prefix is given (a node/room roster) so the
      // foe you SEE is the foe you FIGHT and a slain one stays slain across redraws.
      id: idPrefix ? `${idPrefix}:${i}` : uid('foe'),
      name: count > 1 ? `${t.name} ${i + 1}` : t.name,
      glyph: t.glyph,
      hp,
      maxHp: hp,
      // Hits scale with danger + party veterancy so chip damage stays threatening
      // (a level-6 band shrugs off a 2-damage poke; a danger-3 brute must bite).
      atk: Math.max(1, Math.round((2 + danger * 1.6 + avgLvl * 0.6) * diff.atk)),
      alive: true,
      tactics: t.tac,
    });
  }
  return enemies;
}

// A boss: one powerful foe that rises through several phases before it truly
// dies. Scales with node danger and the New Game+ tier. Client owns every number.
// Foes too small to crown as a boss (their sprites read as trash mobs).
export const BOSS_EXCLUDE = /mimic|imp|rat|cutpurse|scavenger|dog/i;

export function makeBoss(node: MapNode, rng: () => number, ngPlus: number, diff: DiffParams, state: RpgState, idPrefix?: string): Enemy[] {
  const pool = ENEMY_TABLE[node.kind] || ENEMY_TABLE.wild;
  // Crown an imposing foe (skip trash mobs); deterministic per node so a given
  // crypt always has the same boss species.
  const worthy = pool.filter(t => !BOSS_EXCLUDE.test(t.name));
  const candidates = worthy.length ? worthy : pool;
  const t = candidates[seedFrom(`bossfoe:${node.id}`) % candidates.length];
  // A multi-phase climax that, like every foe, scales to the party's offence so
  // it can't be deleted in one volley. Each phase restores 0.6× its HP (see
  // killOrPhase), so the TOTAL damage to kill it is hp·(1+0.6+0.36…). We size the
  // first phase so that total equals a long slog of the party's own damage.
  const phases = node.danger >= 3 ? 3 : 2;
  const phaseSum = phases >= 3 ? 1.96 : 1.6;      // Σ 0.6^k over the phases
  const dpr = partyDamagePerRound(state);
  const targetRounds = 4 + node.danger * 0.6 + (phases - 2) + ngPlus * 0.5;
  const hp = Math.max(12, Math.round((dpr * targetRounds * diff.hp) / phaseSum));
  const avgLvl = partyAvgLevel(state);
  const title = BOSS_TITLES[seedFrom(`boss:${node.id}`) % BOSS_TITLES.length];
  // A boss commands the board: passive archetypes (defender/skirmisher/trickster)
  // are promoted to 'brute' so the climax hits hard instead of turtling.
  const bossTac: EnemyTactics = t.tac === 'aggressor' || t.tac === 'brute' ? t.tac : 'brute';
  return [{
    id: idPrefix ? `${idPrefix}:boss` : uid('boss'), name: `${t.name} ${title}`, glyph: t.glyph,
    hp, maxHp: hp,
    atk: Math.max(2, Math.round((3 + node.danger * 1.8 + avgLvl * 0.7 + ngPlus) * diff.atk)), alive: true,
    tactics: bossTac,
    bossPhase: 1, bossMaxPhase: phases,
  }];
}
