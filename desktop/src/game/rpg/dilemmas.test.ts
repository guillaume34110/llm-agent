import { describe, it, expect } from 'vitest';
import { DILEMMAS, scaleDelta, rollDilemma } from './dilemmas';
import type { DilemmaDelta } from './types';

// A deterministic rng that hands back a fixed queue, then 0 forever.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

describe('DILEMMAS table', () => {
  it('is non-empty and every entry is well-formed', () => {
    expect(DILEMMAS.length).toBeGreaterThan(0);
    for (const t of DILEMMAS) {
      expect(typeof t.prompt).toBe('string');
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.options.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('every option has a good outcome with narration', () => {
    for (const t of DILEMMAS) for (const o of t.options) {
      expect(typeof o.label).toBe('string');
      expect(o.good).toBeDefined();
      expect(typeof o.good.text).toBe('string');
      expect(o.good.text.length).toBeGreaterThan(0);
    }
  });
  it('a dc and a bad outcome ride together with a stat (and never without one)', () => {
    for (const t of DILEMMAS) for (const o of t.options) {
      if (o.stat) {
        expect(o.dc).toBeTypeOf('number'); // a roll needs a target
        expect(o.bad).toBeDefined();        // ...and a failure branch
      } else {
        expect(o.dc).toBeUndefined();       // no roll ⇒ no target
        expect(o.bad).toBeUndefined();      // ...and a sure outcome
      }
    }
  });
});

describe('scaleDelta', () => {
  it('grows hp/gold/xp by 1+danger*0.5 and morale by 1+danger*0.25 (rounded)', () => {
    const base: DilemmaDelta = { hp: -5, gold: 20, xp: 4, morale: 8, text: 'x' };
    const out = scaleDelta(base, 2);            // m=2, mm=1.5
    expect(out.hp).toBe(-10);                   // round(-5*2)
    expect(out.gold).toBe(40);                  // round(20*2)
    expect(out.xp).toBe(8);                     // round(4*2)
    expect(out.morale).toBe(12);                // round(8*1.5)
    expect(out.text).toBe('x');                 // narration passes through
  });
  it('is identity at danger 0', () => {
    const base: DilemmaDelta = { hp: -5, gold: 20, morale: 8, text: 'y' };
    expect(scaleDelta(base, 0)).toEqual({ hp: -5, gold: 20, xp: undefined, morale: 8, text: 'y' });
  });
  it('rounds fractional results', () => {
    const out = scaleDelta({ gold: 15, text: 't' }, 1); // 15*1.5 = 22.5 → 23
    expect(out.gold).toBe(23);
  });
  it('leaves absent fields undefined (no phantom zeros)', () => {
    const out = scaleDelta({ morale: 4, text: 't' }, 3);
    expect(out.hp).toBeUndefined();
    expect(out.gold).toBeUndefined();
    expect(out.xp).toBeUndefined();
    expect(out.morale).toBe(7); // round(4*1.75)
  });
});

describe('rollDilemma', () => {
  it('picks a template by the first roll and tags it with the node id', () => {
    const d = rollDilemma(rngOf(0), 'node-7', 0); // floor(0*len)=0 → first template
    expect(d.nodeId).toBe('node-7');
    expect(d.prompt).toBe(DILEMMAS[0].prompt);
    expect(d.resolved).toBe(false);
    expect(d.options.length).toBe(DILEMMAS[0].options.length);
  });
  it('adds danger to each stat option dc and scales its outcomes', () => {
    const danger = 2;
    const d = rollDilemma(rngOf(0), 'n', danger);
    const tmpl = DILEMMAS[0];
    d.options.forEach((o, i) => {
      const src = tmpl.options[i];
      if (src.dc != null) expect(o.dc).toBe(src.dc + danger);
      else expect(o.dc).toBeUndefined();
      expect(o.good).toEqual(scaleDelta(src.good, danger));
      if (src.bad) expect(o.bad).toEqual(scaleDelta(src.bad, danger));
      else expect(o.bad).toBeUndefined();
    });
  });
  it('at danger 0 the options carry the template numbers unchanged', () => {
    const d = rollDilemma(rngOf(0.999), 'n', 0); // last template
    const tmpl = DILEMMAS[DILEMMAS.length - 1];
    expect(d.prompt).toBe(tmpl.prompt);
    d.options.forEach((o, i) => {
      expect(o.dc).toBe(tmpl.options[i].dc);
    });
  });
});
