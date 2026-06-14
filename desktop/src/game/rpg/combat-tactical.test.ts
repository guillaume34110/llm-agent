import { describe, it, expect } from 'vitest';
import type { RpgSetupResult } from '../../api';
import { buildWorld, startCombat, combatAssign, combatPush, combatCommit, endCombat } from './state';
import { PARTY_TARGET } from './combat-dice';
import type { RpgState } from './types';

// A deterministic world with a small party + a few foe-bearing locations. buildWorld
// is seed-driven, so the same setup always yields the same map/rosters.
function mkSetup(): RpgSetupResult {
  return {
    title: 'The Tactical Proving',
    intro: 'A band tests the new battle board.',
    locations: [
      { name: 'Ruined Gate', kind: 'ruin', blurb: 'A crumbled arch crawling with foes.' },
      { name: 'Wild Hollow', kind: 'wild', blurb: 'Beasts prowl the dark.' },
      { name: 'Old Fort', kind: 'ruin', blurb: 'Bandits hole up here.' },
      { name: 'Deep Lair', kind: 'wild', blurb: 'Something waits below.' },
    ],
    heroes: [
      { className: 'Fighter', blurb: 'A wall of muscle.' },
      { className: 'Ranger', blurb: 'Keen-eyed scout.' },
      { className: 'Cleric', blurb: 'Mends the band.' },
    ],
    quest: { title: 'Clear the gate', desc: 'Drive out the foes.' },
    fallback: false,
  };
}

// Build a world and start a fight on the first node whose roster has living foes.
function mkCombat(): RpgState {
  const world = buildWorld(mkSetup(), 'gritty-fantasy', 0, 'small', 'normal');
  for (const id of Object.keys(world.nodes)) {
    const s = startCombat(world, id);
    if (s.combat && s.combat.enemies.some(e => e.alive)) return s;
  }
  throw new Error('no foe-bearing node found in test world');
}

describe('startCombat rolls the opening tactical round', () => {
  it('seeds a symbol pool (one die per living member) and the foe dice board', () => {
    const s = mkCombat();
    const c = s.combat!;
    expect(c.pool).toBeTruthy();
    expect(c.pool!.length).toBe(s.party.filter(m => m.alive).length);
    expect(c.enemyPool).toBeTruthy();
    // Each living foe rolls one-to-three dice → at least one per living foe.
    expect(c.enemyPool!.length).toBeGreaterThanOrEqual(c.enemies.filter(e => e.alive).length);
    expect(c.enemyPool!.every(d => d.assignedTo === null)).toBe(true);
    expect(c.rerollsUsed).toBe(0);
    expect(c.rerollCost).toBeGreaterThan(0);
    expect(c.maxRerolls).toBeGreaterThan(0);
  });
  it('is deterministic — same setup yields the same party pool', () => {
    const a = mkCombat();
    const b = mkCombat();
    // The party die pool is seeded by the (deterministic) party, so it reproduces.
    expect(a.combat!.pool!.map(d => d.face)).toEqual(b.combat!.pool!.map(d => d.face));
    // The foe board is NOT compared cross-build: node ids are uid-minted, so the
    // foe roster (species → tactics → die lean) is seeded differently each build.
    // True seed determinism of rollEnemyPool is covered in combat-dice.test.ts.
    // Here we only assert the board is well-formed: a foe die per living foe,
    // never pre-assigned, only sword/shield/blank faces.
    const c = a.combat!;
    expect(c.enemyPool!.length).toBeGreaterThanOrEqual(c.enemies.filter(e => e.alive).length);
    expect(c.enemyPool!.every(d => d.assignedTo === null)).toBe(true);
    for (const d of c.enemyPool!) expect(['sword', 'shield', 'blank']).toContain(d.face);
  });
});

describe('combatAssign', () => {
  it('assigns a sword die to a living foe', () => {
    const s = mkCombat();
    const c = s.combat!;
    const foe = c.enemies.find(e => e.alive)!;
    const sword = c.pool!.find(d => d.face === 'sword');
    if (!sword) return; // every die can blank-roll; skip if no sword this seed
    const s2 = combatAssign(s, sword.id, foe.id);
    const moved = s2.combat!.pool!.find(d => d.id === sword.id)!;
    expect(moved.assignedTo).toBe(foe.id);
    expect(s.combat!.pool!.find(d => d.id === sword.id)!.assignedTo).toBeNull(); // prev untouched (pure)
  });
  it('refuses a sword onto the party block (no-op)', () => {
    const s = mkCombat();
    const sword = s.combat!.pool!.find(d => d.face === 'sword');
    if (!sword) return;
    const s2 = combatAssign(s, sword.id, PARTY_TARGET);
    expect(s2.combat!.pool!.find(d => d.id === sword.id)!.assignedTo).toBeNull();
  });
  it('assigns a shield die to the party block', () => {
    const s = mkCombat();
    const shield = s.combat!.pool!.find(d => d.face === 'shield');
    if (!shield) return;
    const s2 = combatAssign(s, shield.id, PARTY_TARGET);
    expect(s2.combat!.pool!.find(d => d.id === shield.id)!.assignedTo).toBe(PARTY_TARGET);
  });
});

describe('combatPush (push your luck)', () => {
  it('re-rolls leftovers, spends escalating morale, locks assigned dice', () => {
    const s = mkCombat();
    // Lock the first assignable die so we can prove it survives the reroll.
    const lockable = s.combat!.pool!.find(d => d.face !== 'blank');
    const foe = s.combat!.enemies.find(e => e.alive)!;
    let s1 = s;
    let lockedId: string | null = null;
    if (lockable) {
      const target = lockable.face === 'shield' ? PARTY_TARGET : foe.id;
      s1 = combatAssign(s, lockable.id, target);
      lockedId = lockable.id;
    }
    const moraleBefore = s1.morale;
    const costFirst = s1.combat!.rerollCost!;
    const s2 = combatPush(s1);
    expect(s2.morale).toBe(moraleBefore - costFirst);
    expect(s2.combat!.rerollsUsed).toBe(1);
    expect(s2.combat!.rerollCost).toBeGreaterThan(costFirst); // escalates
    if (lockedId) {
      // The committed die kept its assignment across the reroll.
      expect(s2.combat!.pool!.find(d => d.id === lockedId)!.assignedTo).not.toBeNull();
    }
  });
  it('stops re-rolling once the budget is spent (no-op past maxRerolls)', () => {
    let s = mkCombat();
    const max = s.combat!.maxRerolls!;
    for (let i = 0; i < max; i++) s = combatPush(s);
    const spent = s.combat!.rerollsUsed;
    const after = combatPush(s);
    expect(after.combat!.rerollsUsed).toBe(spent);
    expect(after.morale).toBe(s.morale); // no further morale spent
  });
});

describe('combatCommit', () => {
  it('advances the round and rolls a fresh pool while the fight continues', () => {
    const s = mkCombat();
    const round0 = s.combat!.round;
    const r = combatCommit(s);
    if (r.state.combat) {
      // Fight still going: round advanced, a fresh pool + foe board were rolled.
      expect(r.state.combat.round).toBe(round0 + 1);
      expect(r.state.combat.pool).toBeTruthy();
      expect(r.state.combat.lastResolution).toBeTruthy();
      expect(r.state.combat.rerollsUsed).toBe(0); // counters reset for the new round
    }
  });
  it('lands assigned sword damage on the focused foe', () => {
    // Drive rounds, always focus-firing the first foe, until it takes a hit.
    let s = mkCombat();
    let dealt = false;
    for (let round = 0; round < 8 && s.combat && !s.combat.over; round++) {
      const c = s.combat!;
      const foe = c.enemies.find(e => e.alive)!;
      const hpBefore = foe.hp;
      // Assign every sword/star to the foe, every shield to the block.
      for (const d of c.pool!) {
        if (d.face === 'sword' || d.face === 'star') s = combatAssign(s, d.id, foe.id);
        else if (d.face === 'shield') s = combatAssign(s, d.id, PARTY_TARGET);
      }
      const r = combatCommit(s);
      s = r.state;
      const foeAfter = s.combat?.enemies.find(e => e.id === foe.id);
      if (!foeAfter || foeAfter.hp < hpBefore || !foeAfter.alive) { dealt = true; break; }
    }
    expect(dealt).toBe(true);
  });
  it('is a no-op once combat is over', () => {
    const s = mkCombat();
    s.combat!.over = true;
    s.combat!.result = 'win';
    const r = combatCommit(s);
    expect(r.summary).toBe('');
    expect(r.state.combat!.round).toBe(s.combat!.round);
  });
  it('reaches a win and runs the shared victory pipeline (node/quest credit intact)', () => {
    // Cripple the foes so a single committed round wins, then assert the win path
    // cleared the node (the same consequence the legacy combatRound applies).
    const s = mkCombat();
    const c = s.combat!;
    // Collapse to a single fragile foe with no guard, then force a lethal die onto
    // it — removes all seed luck so the win path is exercised deterministically.
    const foe = c.enemies.find(e => e.alive)!;
    for (const e of c.enemies) if (e.id !== foe.id) e.alive = false;
    foe.hp = 1; foe.maxHp = 1; foe.bossMaxPhase = undefined;
    c.enemyPool = []; // strip the foe board so no guard soaks the killing blow
    c.pool![0] = { ...c.pool![0], face: 'sword', power: 50, assignedTo: foe.id };
    const r = combatCommit(s);
    expect(r.state.combat!.over).toBe(true);
    expect(r.state.combat!.result).toBe('win');
    const node = r.state.nodes[r.state.combat!.nodeId];
    // A non-farm win clears its node (or its room for a crawl) — victory pipeline ran.
    const room = r.state.combat!.roomId ? (node.rooms || []).find(rm => rm.id === r.state.combat!.roomId) : null;
    expect(room ? room.cleared : node.cleared).toBe(true);
    // endCombat still transitions cleanly afterwards.
    const ended = endCombat(r.state);
    expect(ended.combat).toBeNull();
  });
});
