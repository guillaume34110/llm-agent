import { describe, it, expect } from 'vitest';
import { makeRng } from './dice';
import {
  dieFaces, facePower, rollCombatDie, rollCombatPool,
  enemyDieCount, enemyDieFaces, rollEnemyPool, comboBonus, canAssign, assignDie, rerollUnassigned,
  resolveCombat, poolSpent, pickVictim, PARTY_TARGET,
  type CombatDie, type CombatFace,
} from './combat-dice';
import type { Character, Enemy, StatKey } from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────
function mkChar(over: Partial<Character> & { id: string; stats: Record<StatKey, number> }): Character {
  return {
    name: over.id, className: 'warrior', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true, ...over,
  } as Character;
}
const brute = mkChar({ id: 'brute', stats: { might: 6, agility: 2, wits: 1, spirit: 1 } });
const scout = mkChar({ id: 'scout', stats: { might: 1, agility: 6, wits: 2, spirit: 1 } });
const cleric = mkChar({ id: 'cleric', stats: { might: 1, agility: 1, wits: 2, spirit: 6 } });
const mage = mkChar({ id: 'mage', stats: { might: 1, agility: 1, wits: 6, spirit: 4 } });
const rookie = mkChar({ id: 'rookie', stats: { might: 2, agility: 2, wits: 2, spirit: 2 } });

function mkEnemy(over: Partial<Enemy> & { id: string }): Enemy {
  return { name: over.id, glyph: 'x', hp: 12, maxHp: 12, atk: 4, alive: true, ...over };
}

describe('dieFaces (class-shaped six-face die)', () => {
  it('always ships exactly six faces with at least one sword and one blank', () => {
    for (const c of [brute, scout, cleric, mage, rookie]) {
      const f = dieFaces(c);
      expect(f.length).toBe(6);
      expect(f.filter(x => x === 'sword').length).toBeGreaterThanOrEqual(1);
      expect(f.filter(x => x === 'blank').length).toBeGreaterThanOrEqual(1);
      for (const x of f) expect(['sword', 'shield', 'star', 'blank']).toContain(x);
    }
  });
  it('is deterministic for the same character', () => {
    expect(dieFaces(brute)).toEqual(dieFaces(brute));
  });
  it('shapes the die by stat: a brute carries more swords than a mage', () => {
    const swords = (c: Character) => dieFaces(c).filter(x => x === 'sword').length;
    expect(swords(brute)).toBeGreaterThan(swords(mage));
  });
  it('a caster carries stars a brute does not', () => {
    const stars = (c: Character) => dieFaces(c).filter(x => x === 'star').length;
    expect(stars(mage)).toBeGreaterThan(stars(brute));
  });
  it('a devout carries shields a scout does not', () => {
    const shields = (c: Character) => dieFaces(c).filter(x => x === 'shield').length;
    expect(shields(cleric)).toBeGreaterThan(shields(scout));
  });
});

describe('facePower', () => {
  it('a blank carries no weight', () => {
    expect(facePower(brute, 'blank')).toBe(0);
  });
  it('a sword scales with the best martial stat', () => {
    expect(facePower(brute, 'sword')).toBe(1 + Math.floor(6 / 2));
    expect(facePower(scout, 'sword')).toBe(1 + Math.floor(6 / 2));
  });
  it('a shield scales with spirit/might, a star with wits/spirit', () => {
    expect(facePower(cleric, 'shield')).toBe(1 + Math.floor(6 / 2));
    expect(facePower(mage, 'star')).toBe(1 + Math.floor(6 / 2));
  });
});

describe('rollCombatDie / rollCombatPool', () => {
  it('rolls a legal face and reads its power', () => {
    const rng = makeRng(123);
    const d = rollCombatDie(rng, brute, 0);
    expect(d.memberId).toBe('brute');
    expect(['sword', 'shield', 'star', 'blank']).toContain(d.face);
    expect(d.power).toBe(facePower(brute, d.face));
    expect(d.assignedTo).toBeNull();
  });
  it('rolls one die per LIVING member, skipping the fallen', () => {
    const dead = mkChar({ id: 'dead', stats: { might: 3, agility: 3, wits: 3, spirit: 3 }, alive: false });
    const pool = rollCombatPool([brute, dead, scout], makeRng(7));
    expect(pool.length).toBe(2);
    expect(pool.map(d => d.memberId).sort()).toEqual(['brute', 'scout']);
  });
  it('is deterministic for the same seed', () => {
    expect(rollCombatPool([brute, scout], makeRng(99))).toEqual(rollCombatPool([brute, scout], makeRng(99)));
  });
});

describe('enemy dice (the symmetric foe board)', () => {
  it('a tougher foe crowds the board with more dice (1..3)', () => {
    expect(enemyDieCount(mkEnemy({ id: 'a', atk: 3 }))).toBe(1);
    expect(enemyDieCount(mkEnemy({ id: 'b', atk: 7 }))).toBe(2);
    expect(enemyDieCount(mkEnemy({ id: 'c', atk: 99 }))).toBe(3); // clamped
  });
  it('a foe die ships six faces, sword/shield/blank only (no wildcard)', () => {
    const f = enemyDieFaces(mkEnemy({ id: 'a', atk: 8 }));
    expect(f.length).toBe(6);
    expect(f.filter(x => x === 'sword').length).toBeGreaterThanOrEqual(1);
    for (const x of f) expect(['sword', 'shield', 'blank']).toContain(x);
    expect(f).not.toContain('star');
  });
  it('a wounded foe turtles — trades a sword face for a guard', () => {
    const shields = (e: typeof hale) => enemyDieFaces(e).filter(x => x === 'shield').length;
    const hale = mkEnemy({ id: 'h', atk: 8, hp: 12, maxHp: 12 });
    const hurt = mkEnemy({ id: 'h', atk: 8, hp: 2, maxHp: 12 });
    expect(shields(hurt)).toBeGreaterThan(shields(hale));
  });
  it('rolls a pool for living foes only, tagged by foe id, never assigned', () => {
    const foes = [mkEnemy({ id: 'a', atk: 4 }), mkEnemy({ id: 'b', alive: false }), mkEnemy({ id: 'c', atk: 12 })];
    const pool = rollEnemyPool(foes, makeRng(3));
    expect(pool.every(d => d.memberId !== 'b')).toBe(true); // the fallen roll nothing
    expect(pool.every(d => d.assignedTo === null)).toBe(true);
    for (const d of pool) expect(['sword', 'shield', 'blank']).toContain(d.face);
    // the brawnier foe contributes more dice than the weakling
    expect(pool.filter(d => d.memberId === 'c').length).toBeGreaterThan(pool.filter(d => d.memberId === 'a').length);
  });
  it('is deterministic for the same seed', () => {
    const foes = [mkEnemy({ id: 'a', atk: 6 })];
    expect(rollEnemyPool(foes, makeRng(9))).toEqual(rollEnemyPool(foes, makeRng(9)));
  });
});

describe('comboBonus (focus-fire reward)', () => {
  it('rewards stacking swords on one foe', () => {
    expect(comboBonus(0)).toBe(0);
    expect(comboBonus(1)).toBe(0);
    expect(comboBonus(2)).toBe(2);
    expect(comboBonus(3)).toBe(4);
    expect(comboBonus(4)).toBe(6);
  });
});

describe('canAssign / assignDie', () => {
  const ids = ['e1', 'e2'];
  const sword: CombatDie = { id: 's', by: 'b', memberId: 'b', face: 'sword', power: 4, assignedTo: null };
  const shield: CombatDie = { id: 'h', by: 'c', memberId: 'c', face: 'shield', power: 3, assignedTo: null };
  const star: CombatDie = { id: 't', by: 'm', memberId: 'm', face: 'star', power: 4, assignedTo: null };
  const blank: CombatDie = { id: 'z', by: 'r', memberId: 'r', face: 'blank', power: 0, assignedTo: null };

  it('a blank can never be assigned', () => {
    expect(canAssign(blank, 'e1', ids)).toBe(false);
    expect(canAssign(blank, PARTY_TARGET, ids)).toBe(false);
  });
  it('a sword strikes a living foe, never the party', () => {
    expect(canAssign(sword, 'e1', ids)).toBe(true);
    expect(canAssign(sword, PARTY_TARGET, ids)).toBe(false);
    expect(canAssign(sword, 'ghost', ids)).toBe(false);
  });
  it('a shield guards the party, never a foe', () => {
    expect(canAssign(shield, PARTY_TARGET, ids)).toBe(true);
    expect(canAssign(shield, 'e1', ids)).toBe(false);
  });
  it('a star is the wildcard — either side', () => {
    expect(canAssign(star, 'e2', ids)).toBe(true);
    expect(canAssign(star, PARTY_TARGET, ids)).toBe(true);
  });
  it('unassign (null) is always legal', () => {
    expect(canAssign(sword, null, ids)).toBe(true);
  });
  it('assignDie is pure and only mutates the legal target die', () => {
    const pool = [sword, shield, blank];
    const next = assignDie(pool, 's', 'e1', ids);
    expect(next).not.toBe(pool);
    expect(next.find(d => d.id === 's')!.assignedTo).toBe('e1');
    expect(pool.find(d => d.id === 's')!.assignedTo).toBeNull(); // original untouched
  });
  it('assignDie no-ops an illegal target', () => {
    const pool = [shield];
    const next = assignDie(pool, 'h', 'e1', ids); // shield can't hit a foe
    expect(next[0].assignedTo).toBeNull();
  });
});

describe('resolveCombat', () => {
  const foes = [mkEnemy({ id: 'e1', atk: 4 }), mkEnemy({ id: 'e2', atk: 6 })];
  const party = [brute, cleric];

  function die(face: CombatFace, power: number, assignedTo: string | null, id = `${face}-${power}-${assignedTo}`): CombatDie {
    return { id, by: 'x', memberId: 'brute', face, power, assignedTo };
  }
  // A foe-rolled die: tagged by the foe id (memberId), never assigned.
  function edie(face: CombatFace, power: number, enemyId: string, id = `${enemyId}-${face}-${power}`): CombatDie {
    return { id, by: 'foe', memberId: enemyId, face, power, assignedTo: null };
  }

  it('sums swords plus combo on a focused foe with no guard on the board', () => {
    const dice = [die('sword', 4, 'e1', 'a'), die('sword', 3, 'e1', 'b')];
    const res = resolveCombat(dice, foes, [edie('sword', 4, 'e1'), edie('sword', 6, 'e2')], party, makeRng(1));
    expect(res.enemyDamage['e1']).toBe(4 + 3 + comboBonus(2)); // 9 (its rolled die is a sword, not a guard)
    expect(res.enemyDamage['e2']).toBe(0);
  });
  it("a foe's rolled shield dice soak the damage aimed at it", () => {
    const dice = [die('sword', 5, 'e2', 'a')];
    const res = resolveCombat(dice, foes, [edie('shield', 3, 'e2')], party, makeRng(1));
    expect(res.enemyDamage['e2']).toBe(2); // 5 - 3 guard
  });
  it('party shields raise a block wall that soaks the foes\' sword dice', () => {
    const dice = [die('shield', 10, PARTY_TARGET, 'a')];
    const res = resolveCombat(dice, foes, [edie('sword', 4, 'e1')], party, makeRng(1));
    expect(res.partyBlock).toBe(10);
    expect(res.memberDamage).toEqual([]); // fully soaked
    expect(res.mitigated).toBe(4);
  });
  it('overflow past the block wall lands on a living member', () => {
    const dice = [die('shield', 3, PARTY_TARGET, 'a')];
    const res = resolveCombat(dice, foes, [edie('sword', 7, 'e1')], party, makeRng(1));
    expect(res.incoming).toBe(7);
    expect(res.memberDamage.length).toBe(1);
    expect(res.memberDamage[0].amount).toBe(4); // 7 - 3
    expect(['brute', 'cleric']).toContain(res.memberDamage[0].memberId);
  });
  it('a star assigned to the party counts as block; to a foe counts as damage', () => {
    const block = resolveCombat([die('star', 5, PARTY_TARGET, 'a')], foes, [edie('sword', 5, 'e1')], party, makeRng(1));
    expect(block.partyBlock).toBe(5);
    const hit = resolveCombat([die('star', 5, 'e1', 'a')], foes, [edie('sword', 5, 'e1')], party, makeRng(1));
    expect(hit.enemyDamage['e1']).toBe(5); // that foe rolled a sword, not a guard → no mitigation
  });
  it('blank foe dice neither attack nor guard', () => {
    const dice = [die('sword', 5, 'e1', 'a')];
    const res = resolveCombat(dice, foes, [edie('blank', 0, 'e1')], party, makeRng(1));
    expect(res.enemyDamage['e1']).toBe(5); // no guard
    expect(res.incoming).toBe(0);          // no attack
  });
  it('is deterministic for the same seed', () => {
    const dice = [die('shield', 2, PARTY_TARGET, 'a')];
    expect(resolveCombat(dice, foes, [edie('sword', 9, 'e1')], party, makeRng(42)))
      .toEqual(resolveCombat(dice, foes, [edie('sword', 9, 'e1')], party, makeRng(42)));
  });
  it("a foe's overflow follows its target policy (aggressor executes the weakest)", () => {
    const wounded = mkChar({ id: 'wounded', stats: { might: 1, agility: 1, wits: 1, spirit: 1 }, hp: 2, maxHp: 30 });
    const hardy = mkChar({ id: 'hardy', stats: { might: 1, agility: 1, wits: 1, spirit: 1 }, hp: 28, maxHp: 30 });
    const aggrFoe = [mkEnemy({ id: 'e1', atk: 4, tactics: 'aggressor' })];
    const res = resolveCombat([], aggrFoe, [edie('sword', 9, 'e1')], [wounded, hardy], makeRng(1));
    expect(res.memberDamage.length).toBe(1);
    expect(res.memberDamage[0].memberId).toBe('wounded'); // not random — the weakest, every time
  });
});

describe("enemy tactics (the foe's authored battle personality)", () => {
  const swords = (f: CombatFace[]) => f.filter(x => x === 'sword').length;
  const shields = (f: CombatFace[]) => f.filter(x => x === 'shield').length;
  const blanks = (f: CombatFace[]) => f.filter(x => x === 'blank').length;

  it('aggressor/brute pack an extra sword; a defender trades a sword for a guard', () => {
    const base = enemyDieFaces(mkEnemy({ id: 'b', atk: 8 }));                       // trickster default
    const aggr = enemyDieFaces(mkEnemy({ id: 'a', atk: 8, tactics: 'aggressor' }));
    const def = enemyDieFaces(mkEnemy({ id: 'd', atk: 8, tactics: 'defender' }));
    expect(swords(aggr)).toBeGreaterThan(swords(base));
    expect(shields(def)).toBeGreaterThan(shields(base));
    expect(swords(def)).toBeLessThan(swords(base));
  });
  it('a skirmisher drops a sword for blanks (hit-and-run variance)', () => {
    const base = enemyDieFaces(mkEnemy({ id: 'b', atk: 8 }));
    const skn = enemyDieFaces(mkEnemy({ id: 's', atk: 8, tactics: 'skirmisher' }));
    expect(blanks(skn)).toBeGreaterThan(blanks(base));
  });

  const lowHp = mkChar({ id: 'lowHp', stats: { might: 1, agility: 1, wits: 1, spirit: 1 }, hp: 3, maxHp: 30 });
  const squishy = mkChar({ id: 'squishy', stats: { might: 1, agility: 1, wits: 1, spirit: 1 }, hp: 20, maxHp: 8 });
  const tank = mkChar({ id: 'tank', stats: { might: 1, agility: 1, wits: 1, spirit: 1 }, hp: 25, maxHp: 50 });
  const warrior = mkChar({ id: 'warrior', stats: { might: 7, agility: 6, wits: 1, spirit: 1 }, hp: 22, maxHp: 22 });
  const living = [lowHp, squishy, tank, warrior];

  it('routes each archetype to its rightful target', () => {
    const rng = makeRng(1);
    expect(pickVictim('aggressor', living, rng)!.id).toBe('lowHp');    // weakest hp
    expect(pickVictim('skirmisher', living, rng)!.id).toBe('squishy'); // frailest maxHp
    expect(pickVictim('brute', living, rng)!.id).toBe('tank');         // toughest maxHp
    expect(pickVictim('defender', living, rng)!.id).toBe('warrior');   // biggest threat (might+agility)
  });
  it('trickster picks a living member; an empty party yields null', () => {
    expect(living.map(m => m.id)).toContain(pickVictim('trickster', living, makeRng(2))!.id);
    expect(pickVictim('aggressor', [], makeRng(1))).toBeNull();
  });
});

describe('rerollUnassigned (push-your-luck)', () => {
  it('locks assigned dice and re-rolls only the leftovers', () => {
    const dice: CombatDie[] = [
      { id: 'cd-brute-0', by: 'brute', memberId: 'brute', face: 'sword', power: 4, assignedTo: 'e1' },
      { id: 'cd-scout-1', by: 'scout', memberId: 'scout', face: 'blank', power: 0, assignedTo: null },
    ];
    const next = rerollUnassigned(dice, [brute, scout], makeRng(5));
    expect(next[0]).toEqual(dice[0]); // assigned → untouched
    // The leftover keeps its id but its face/power are freshly read from the member's table.
    expect(next[1].id).toBe('cd-scout-1');
    expect(dieFaces(scout)).toContain(next[1].face);
    expect(next[1].power).toBe(facePower(scout, next[1].face));
  });
  it('leaves a die whose member vanished untouched (no crash)', () => {
    const dice: CombatDie[] = [{ id: 'x', by: 'ghost', memberId: 'ghost', face: 'sword', power: 3, assignedTo: null }];
    expect(rerollUnassigned(dice, [brute], makeRng(1))).toEqual(dice);
  });
});

describe('poolSpent', () => {
  it('is true when every die is assigned or blank', () => {
    const dice: CombatDie[] = [
      { id: '1', by: 'x', memberId: 'm', face: 'sword', power: 3, assignedTo: 'e1' },
      { id: '2', by: 'x', memberId: 'm', face: 'blank', power: 0, assignedTo: null },
    ];
    expect(poolSpent(dice)).toBe(true);
  });
  it('is false while a usable die is still unassigned', () => {
    const dice: CombatDie[] = [{ id: '1', by: 'x', memberId: 'm', face: 'sword', power: 3, assignedTo: null }];
    expect(poolSpent(dice)).toBe(false);
  });
});
