import { describe, it, expect } from 'vitest';
import { STATUS_META, addStatus, hasStatus, tickStatuses } from './status';
import type { StatusEffect, StatusId } from './types';

function holder(hp = 20, status: StatusEffect[] = []) {
  return { hp, name: 'Hero', status };
}

describe('STATUS_META', () => {
  it('marks DoTs and lethality consistently', () => {
    expect(STATUS_META.burn).toEqual({ label: 'Burn', dot: true, lethal: true });
    expect(STATUS_META.bleed).toEqual({ label: 'Bleed', dot: true, lethal: true });
    expect(STATUS_META.poison).toEqual({ label: 'Poison', dot: true, lethal: false });
    expect(STATUS_META.stun).toEqual({ label: 'Stun', dot: false, lethal: false });
  });
});

describe('addStatus', () => {
  it('adds a fresh status', () => {
    const h = holder();
    addStatus(h, 'burn', 3, 2);
    expect(h.status).toEqual([{ id: 'burn', rounds: 3, power: 2 }]);
  });

  it('lazily creates the status array', () => {
    const h: { status?: StatusEffect[] } = {};
    addStatus(h, 'bleed', 2, 1);
    expect(h.status).toEqual([{ id: 'bleed', rounds: 2, power: 1 }]);
  });

  it('refreshing keeps the LONGER duration and STRONGER power', () => {
    const h = holder();
    addStatus(h, 'poison', 5, 1);
    addStatus(h, 'poison', 2, 4); // shorter but stronger
    expect(h.status).toEqual([{ id: 'poison', rounds: 5, power: 4 }]);
  });

  it('never stacks a second entry for the same id', () => {
    const h = holder();
    addStatus(h, 'burn', 1, 1);
    addStatus(h, 'burn', 1, 1);
    expect(h.status!.filter(s => s.id === 'burn').length).toBe(1);
  });
});

describe('hasStatus', () => {
  it('is true only while rounds remain', () => {
    const h = holder(20, [{ id: 'stun', rounds: 1, power: 0 }]);
    expect(hasStatus(h, 'stun')).toBe(true);
  });
  it('is false for a spent or absent status', () => {
    const h = holder(20, [{ id: 'stun', rounds: 0, power: 0 }]);
    expect(hasStatus(h, 'stun')).toBe(false);
    expect(hasStatus(h, 'burn')).toBe(false);
    expect(hasStatus({}, 'burn')).toBe(false);
  });
});

describe('tickStatuses', () => {
  it('returns 0 and logs nothing with no statuses', () => {
    const lines: string[] = [];
    expect(tickStatuses(holder(), lines, false)).toBe(0);
    expect(lines).toEqual([]);
  });

  it('a DoT bleeds power HP and logs one line', () => {
    const h = holder(20, [{ id: 'bleed', rounds: 2, power: 3 }]);
    const lines: string[] = [];
    const lost = tickStatuses(h, lines, false);
    expect(lost).toBe(3);
    expect(h.hp).toBe(17);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('bleed damage');
  });

  it('decrements rounds and drops spent statuses', () => {
    const h = holder(20, [{ id: 'burn', rounds: 1, power: 2 }, { id: 'stun', rounds: 2, power: 0 }]);
    tickStatuses(h, [], false);
    expect(h.status).toEqual([{ id: 'stun', rounds: 1, power: 0 }]);
  });

  it('a non-DoT status (stun) inflicts no damage but still counts down', () => {
    const h = holder(20, [{ id: 'stun', rounds: 2, power: 5 }]);
    const lost = tickStatuses(h, [], false);
    expect(lost).toBe(0);
    expect(h.hp).toBe(20);
    expect(h.status![0].rounds).toBe(1);
  });

  it('floorAt1 keeps a non-lethal DoT from downing the holder', () => {
    const h = holder(2, [{ id: 'poison', rounds: 1, power: 9 }]);
    const lost = tickStatuses(h, [], true);
    expect(h.hp).toBe(1);    // floored, never below 1
    expect(lost).toBe(1);
  });

  it('without floorAt1 a lethal DoT can drop the holder below 1', () => {
    const h = holder(2, [{ id: 'burn', rounds: 1, power: 9 }]);
    tickStatuses(h, [], false);
    expect(h.hp).toBe(-7);
  });

  it('is deterministic — same input, same result', () => {
    const mk = () => holder(20, [{ id: 'bleed', rounds: 3, power: 2 }, { id: 'poison', rounds: 3, power: 1 }]);
    const a = mk(); const la: string[] = []; const lostA = tickStatuses(a, la, false);
    const b = mk(); const lb: string[] = []; const lostB = tickStatuses(b, lb, false);
    expect(lostA).toBe(lostB);
    expect(a.hp).toBe(b.hp);
    expect(la).toEqual(lb);
  });

  it('skips a status already at zero rounds', () => {
    const h = holder(20, [{ id: 'burn', rounds: 0, power: 5 } as StatusEffect]);
    const lost = tickStatuses(h, [], false);
    expect(lost).toBe(0);
    expect(h.hp).toBe(20);
    expect(h.status).toEqual([]);
  });
});

// Exhaustiveness guard: every StatusId has metadata.
describe('coverage', () => {
  it('STATUS_META has an entry per StatusId used in tests', () => {
    const ids: StatusId[] = ['burn', 'bleed', 'poison', 'stun'];
    for (const id of ids) expect(STATUS_META[id]).toBeDefined();
  });
});
