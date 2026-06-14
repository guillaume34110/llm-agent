import { describe, it, expect } from 'vitest';
import { PROV_MAX, clampProv, legProvisionCost } from './provisions';

describe('clampProv', () => {
  it('keeps rations within [0, PROV_MAX] and integral', () => {
    expect(clampProv(-3)).toBe(0);
    expect(clampProv(999)).toBe(PROV_MAX);
    expect(clampProv(4.6)).toBe(5);
  });
});

describe('legProvisionCost', () => {
  it('never costs less than one ration', () => {
    expect(legProvisionCost(0)).toBe(1);
    expect(legProvisionCost(-1)).toBe(1);
  });
  it('rises with road distance (1 + dist*4, rounded)', () => {
    expect(legProvisionCost(0.5)).toBe(3);
    expect(legProvisionCost(1)).toBe(5);
    expect(legProvisionCost(2)).toBe(9);
  });
});
