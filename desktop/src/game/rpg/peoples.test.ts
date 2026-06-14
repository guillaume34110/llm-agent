import { describe, it, expect } from 'vitest';
import { PEOPLES, peopleOf, peopleById, peopleFor, peopleFlavor, peopleStanding, prizedBy, localCraft } from './peoples';
import { REP_MIN, REP_MAX } from './reputation';

describe('peopleOf', () => {
  it('is deterministic per world seed (one people per expedition)', () => {
    expect(peopleOf(12345)).toBe(peopleOf(12345));
    expect(peopleOf(999)).toBe(peopleOf(999));
  });
  it('always returns a member of the closed catalogue', () => {
    for (let s = 0; s < 200; s++) expect(PEOPLES).toContain(peopleOf(s));
  });
  it('spreads across more than one culture over many seeds', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) seen.add(peopleOf(s).id);
    expect(seen.size).toBeGreaterThan(1);
  });
  it('every catalogue entry carries the persona fields the LLM needs', () => {
    for (const p of PEOPLES) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.manner.length).toBeGreaterThan(0);
      expect(p.prizes.length).toBeGreaterThan(0);
      expect(p.greeting.length).toBeGreaterThan(0);
    }
  });
});

describe('peopleStanding', () => {
  it('is deterministic and matches the chosen people', () => {
    expect(peopleStanding(777)).toBe(peopleOf(777).standing);
  });
  it('every entry stays inside the reputation band', () => {
    for (const p of PEOPLES) {
      expect(p.standing).toBeGreaterThanOrEqual(REP_MIN);
      expect(p.standing).toBeLessThanOrEqual(REP_MAX);
    }
  });
  it('stays modest enough that no people starts reviled or honored', () => {
    // Starting standing should colour prices subtly, not slam the tier extremes
    // a fresh run has not earned yet (repTier: reviled <=-8, honored >=32).
    for (const p of PEOPLES) {
      expect(p.standing).toBeGreaterThan(-8);
      expect(p.standing).toBeLessThan(32);
    }
  });
});

describe('peopleFlavor', () => {
  it('names the people and weaves in their manner and prizes', () => {
    const p = peopleOf(42);
    const line = peopleFlavor(42);
    expect(line).toContain(p.name);
    expect(line).toContain(p.manner);
    expect(line).toContain(p.prizes);
  });
});

describe('peopleById', () => {
  it('resolves every catalogue id to its own entry', () => {
    for (const p of PEOPLES) expect(peopleById(p.id)).toBe(p);
  });
  it('returns undefined for an unknown id', () => {
    expect(peopleById('atlanteans')).toBeUndefined();
    expect(peopleById('')).toBeUndefined();
  });
});

describe('peopleFor (forced peopleId, CE2 destination economy)', () => {
  it('honours a valid forced id over the seed roll', () => {
    // Pick a people the seed would NOT have rolled, prove the force wins.
    const rolled = peopleOf(12345);
    const forced = PEOPLES.find(p => p.id !== rolled.id)!;
    expect(peopleFor(12345, forced.id)).toBe(forced);
  });
  it('falls back to the per-seed roll when id is absent (non-regression)', () => {
    // Omitting the argument must reproduce exactly the pre-feature behaviour.
    for (let s = 0; s < 50; s++) expect(peopleFor(s)).toBe(peopleOf(s));
  });
  it('falls back to the per-seed roll when id is unknown (old/garbage save)', () => {
    expect(peopleFor(777, 'atlanteans')).toBe(peopleOf(777));
    expect(peopleFor(777, '')).toBe(peopleOf(777));
  });
});

describe('prizedBy / localCraft (optional peopleId routes through peopleFor)', () => {
  it('matches the seed roll when no id is given (non-regression)', () => {
    for (let s = 0; s < 50; s++) {
      expect(prizedBy(s)).toBe(peopleOf(s).prize);
      expect(localCraft(s)).toBe(peopleOf(s).craft);
      expect(peopleStanding(s)).toBe(peopleOf(s).standing);
    }
  });
  it('reads the forced people when an id is given', () => {
    const forced = PEOPLES.find(p => p.id !== peopleOf(5).id)!;
    expect(prizedBy(5, forced.id)).toBe(forced.prize);
    expect(localCraft(5, forced.id)).toBe(forced.craft);
    expect(peopleStanding(5, forced.id)).toBe(forced.standing);
  });
});
