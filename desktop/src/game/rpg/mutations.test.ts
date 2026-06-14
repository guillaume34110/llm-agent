import { describe, it, expect } from 'vitest';
import { claimDiscovery, damageParty, grantXp, applyDilemmaDelta } from './mutations';
import { makeTrinket, AEGIS_WARD } from './trinkets';
import type { RpgState, Character, MapNode, DilemmaDelta } from './types';

// A delta carries narration text in the type; tests only care about the numbers,
// so this fills in the required `text` field.
function d(partial: Partial<DilemmaDelta>): DilemmaDelta {
  return { text: '', ...partial };
}

function ch(partial: Partial<Character> = {}): Character {
  return {
    id: 'c1', name: 'Hero', className: 'warrior',
    stats: { might: 5, agility: 3, wits: 2, spirit: 2 },
    hp: 30, maxHp: 30, level: 1, xp: 0, alive: true,
    ...partial,
  } as Character;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return {
    party: [ch()], inventory: [], log: [],
    gold: 0, morale: 60, difficulty: 'normal',
    ...partial,
  } as unknown as RpgState;
}

describe('damageParty', () => {
  it('spills onto the front-most living member first', () => {
    const a = ch({ id: 'a', name: 'A', hp: 10 });
    const b = ch({ id: 'b', name: 'B', hp: 5 });
    const s = state({ party: [a, b] });
    const out = damageParty(s, 12);
    expect(a.hp).toBe(0);
    expect(a.alive).toBe(false);
    expect(b.hp).toBe(3);
    expect(out).toBe('A falls, B takes 2');
  });
  it('stops once the damage is spent (rear stays untouched)', () => {
    const a = ch({ id: 'a', name: 'A', hp: 10 });
    const b = ch({ id: 'b', name: 'B', hp: 5 });
    damageParty(state({ party: [a, b] }), 3);
    expect(a.hp).toBe(7);
    expect(b.hp).toBe(5);
  });
  it('skips the downed', () => {
    const dead = ch({ id: 'd', name: 'D', hp: 0, alive: false });
    const live = ch({ id: 'l', name: 'L', hp: 8 });
    const out = damageParty(state({ party: [dead, live] }), 3);
    expect(out).toBe('L takes 3');
    expect(live.hp).toBe(5);
  });
  it('a Bulwark Charm soaks AEGIS_WARD off the blow', () => {
    const a = ch({ id: 'a', name: 'A', hp: 10 });
    const s = state({ party: [a], inventory: [makeTrinket('aegis')] as never });
    damageParty(s, 5);
    expect(a.hp).toBe(10 - (5 - AEGIS_WARD));
  });
  it('a blow no larger than the ward is fully absorbed', () => {
    const a = ch({ id: 'a', name: 'A', hp: 10 });
    const s = state({ party: [a], inventory: [makeTrinket('aegis')] as never });
    const out = damageParty(s, AEGIS_WARD);
    expect(a.hp).toBe(10);
    expect(out).toBe('');
  });
});

describe('grantXp', () => {
  it('banks XP below the threshold without levelling', () => {
    const c = ch({ level: 1, xp: 0 });
    const note = grantXp(state({ party: [c] }), 10); // xpForLevel(1)=20
    expect(c.xp).toBe(10);
    expect(c.level).toBe(1);
    expect(note).toBe('');
  });
  it('levels up, fattens HP, bumps the primary stat, and fully heals', () => {
    const c = ch({ level: 1, xp: 0, maxHp: 30, hp: 4, stats: { might: 5, agility: 3, wits: 2, spirit: 2 } });
    const note = grantXp(state({ party: [c] }), 25); // 25 ≥ 20 → level 2, carry 5
    expect(c.level).toBe(2);
    expect(c.xp).toBe(5);
    expect(c.maxHp).toBe(37);
    expect(c.hp).toBe(37);            // a level-up is a full heal
    expect(c.stats.might).toBe(6);    // primary stat creeps up
    // level 2 is even → the lowest secondary stat also bumps
    expect(c.stats.wits + c.stats.spirit).toBe(2 + 2 + 1);
    expect(note).toContain('reaches level 2');
  });
  it('scales the award by difficulty (easy ×1.35, ceil)', () => {
    const c = ch({ xp: 0 });
    grantXp(state({ party: [c], difficulty: 'easy' }), 10); // ceil(13.5)=14
    expect(c.xp).toBe(14);
  });
  it('ignores the dead', () => {
    const dead = ch({ alive: false, xp: 0 });
    grantXp(state({ party: [dead] }), 100);
    expect(dead.xp).toBe(0);
  });
});

describe('claimDiscovery', () => {
  function node(discovery?: MapNode['discovery']): MapNode {
    return { id: 'n', name: 'N', kind: 'ruin', blurb: '', edges: [], discovered: true, scouted: true, visited: true, cleared: false, danger: 1, x: 0, y: 0, discovery } as MapNode;
  }
  it('grants the trinket once and logs the find', () => {
    const s = state();
    const n = node({ trinket: 'idol', blurb: 'A glimmer.', claimed: false } as MapNode['discovery']);
    claimDiscovery(s, n);
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0].trinket).toBe('idol');
    expect(n.discovery!.claimed).toBe(true);
    expect(s.log[0]).toContain('Discovery');
  });
  it('is idempotent — a claimed discovery yields nothing more', () => {
    const s = state();
    const n = node({ trinket: 'charm', blurb: 'x', claimed: true } as MapNode['discovery']);
    claimDiscovery(s, n);
    expect(s.inventory).toHaveLength(0);
  });
  it('is a no-op on a node with no discovery', () => {
    const s = state();
    claimDiscovery(s, node(undefined));
    expect(s.inventory).toHaveLength(0);
  });
});

describe('applyDilemmaDelta', () => {
  it('clamps a gold spend to what the party carries', () => {
    const s = state({ gold: 5 });
    const out = applyDilemmaDelta(s, d({ gold: -10 }));
    expect(s.gold).toBe(0);
    expect(out).toContain('-5 gold');
  });
  it('adds gold', () => {
    const s = state({ gold: 5 });
    applyDilemmaDelta(s, d({ gold: 10 }));
    expect(s.gold).toBe(15);
  });
  it('a negative HP delta floors each member at 1 (never lethal)', () => {
    const c = ch({ hp: 3 });
    const out = applyDilemmaDelta(state({ party: [c] }), d({ hp: -10 }));
    expect(c.hp).toBe(1);
    expect(c.alive).toBe(true);
    expect(out).toContain('-10 HP each');
  });
  it('a positive HP delta caps at maxHp', () => {
    const c = ch({ hp: 28, maxHp: 30 });
    applyDilemmaDelta(state({ party: [c] }), d({ hp: 10 }));
    expect(c.hp).toBe(30);
  });
  it('returns an empty string for an empty delta', () => {
    expect(applyDilemmaDelta(state(), d({}))).toBe('');
  });
  it('bundles gold + xp into one bracketed summary', () => {
    const c = ch({ xp: 0 });
    const out = applyDilemmaDelta(state({ party: [c], gold: 0 }), d({ gold: 5, xp: 30 }));
    expect(out.startsWith(' [')).toBe(true);
    expect(out).toContain('+5 gold');
    expect(out).toContain('reaches level');
  });
});
