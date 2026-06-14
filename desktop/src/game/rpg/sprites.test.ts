import { describe, it, expect } from 'vitest';
import { SPRITES, SPRITE_PALETTES, peopleSpriteKey, clubSpriteKey, spritePalette, classSpriteKey } from './sprites';
import { PEOPLES } from './peoples';
import { SPONSOR_IDS } from './meta';

const PEOPLE_KEYS = PEOPLES.map(p => `people_${p.id}`);
const CLUB_KEYS = SPONSOR_IDS.map(id => `club_${id}`);

describe('people emblem sprites (CE2 destination board heraldry)', () => {
  it('ships one shield per catalogued people', () => {
    for (const k of PEOPLE_KEYS) {
      expect(SPRITES[k], `missing sprite ${k}`).toBeDefined();
    }
  });
  it('every shield is a rectangular 14x14 grid of known palette chars', () => {
    for (const k of PEOPLE_KEYS) {
      const grid = SPRITES[k];
      expect(grid.length).toBe(14);
      for (const row of grid) {
        expect(row.length).toBe(14);
        expect(/^[.KDMLR]+$/.test(row), `bad char in ${k}: "${row}"`).toBe(true);
      }
    }
  });
  it('every shield carries a full colour palette so it pops on every theme', () => {
    for (const k of PEOPLE_KEYS) {
      const pal = SPRITE_PALETTES[k];
      expect(pal, `missing palette ${k}`).toBeDefined();
      expect(pal.K).toBeTruthy();
      expect(pal.D).toBeTruthy();
      expect(pal.M).toBeTruthy();
      expect(pal.L).toBeTruthy();
    }
  });
  it('shields are visually distinct — no two cultures share the same motif rows', () => {
    const motifs = PEOPLE_KEYS.map(k => SPRITES[k].slice(3, 6).join('|'));
    expect(new Set(motifs).size).toBe(motifs.length);
  });
  it('shields are visually distinct — no two cultures share the same palette', () => {
    const sigs = PEOPLE_KEYS.map(k => JSON.stringify(SPRITE_PALETTES[k]));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});

describe('club crest sprites (hub heraldry)', () => {
  it('ships one crest per explorer club', () => {
    for (const k of CLUB_KEYS) {
      expect(SPRITES[k], `missing sprite ${k}`).toBeDefined();
      expect(SPRITE_PALETTES[k], `missing palette ${k}`).toBeDefined();
    }
  });
  it('every crest is a rectangular 14x14 grid of known palette chars', () => {
    for (const k of CLUB_KEYS) {
      const grid = SPRITES[k];
      expect(grid.length).toBe(14);
      for (const row of grid) {
        expect(row.length).toBe(14);
        expect(/^[.KDMLR]+$/.test(row), `bad char in ${k}: "${row}"`).toBe(true);
      }
    }
  });
  it('crests are visually distinct — no two clubs share motif rows or palette', () => {
    const motifs = CLUB_KEYS.map(k => SPRITES[k].slice(3, 6).join('|'));
    expect(new Set(motifs).size).toBe(motifs.length);
    const sigs = CLUB_KEYS.map(k => JSON.stringify(SPRITE_PALETTES[k]));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
  it('club crests never collide with a people shield', () => {
    for (const ck of CLUB_KEYS) expect(PEOPLE_KEYS).not.toContain(ck);
  });
});

describe('clubSpriteKey', () => {
  it('resolves every club to its own crest', () => {
    for (const id of SPONSOR_IDS) {
      const k = clubSpriteKey(id);
      expect(k).toBe(`club_${id}`);
      expect(spritePalette(k)).toBeDefined();
    }
  });
  it('falls back to a banner for an unknown club (no crash)', () => {
    const k = clubSpriteKey('freemasons');
    expect(SPRITES[k]).toBeDefined();
    expect(k).toBe('prop_banner');
  });
});

const HERO_KEYS = [
  'hero_warrior', 'hero_ranger', 'hero_mage', 'hero_cleric', 'hero_paladin',
  'hero_barbarian', 'hero_necromancer', 'hero_rogue', 'hero_druid', 'hero_monk', 'hero_bard',
];

describe('hero sprites (playable-character diversity)', () => {
  it('ships a sprite + full palette for every hero key', () => {
    for (const k of HERO_KEYS) {
      expect(SPRITES[k], `missing sprite ${k}`).toBeDefined();
      const pal = SPRITE_PALETTES[k];
      expect(pal, `missing palette ${k}`).toBeDefined();
      expect(pal.K && pal.D && pal.M && pal.L).toBeTruthy();
    }
  });
  it('every hero sprite uses only known palette chars', () => {
    for (const k of HERO_KEYS) {
      for (const row of SPRITES[k]) {
        expect(/^[.KDMLR]*$/.test(row), `bad char in ${k}: "${row}"`).toBe(true);
      }
    }
  });
  it('the eleven silhouettes are visually distinct (no shared body rows)', () => {
    const motifs = HERO_KEYS.map(k => SPRITES[k].slice(6, 11).join('|'));
    expect(new Set(motifs).size).toBe(motifs.length);
  });
});

describe('classSpriteKey', () => {
  it('fans distinct archetypes onto their own silhouette', () => {
    expect(classSpriteKey('Rogue')).toBe('hero_rogue');
    expect(classSpriteKey('assassin')).toBe('hero_rogue');
    expect(classSpriteKey('Ranger')).toBe('hero_ranger');
    expect(classSpriteKey('scout')).toBe('hero_ranger');
    expect(classSpriteKey('Druid')).toBe('hero_druid');
    expect(classSpriteKey('shaman')).toBe('hero_druid');
    expect(classSpriteKey('Monk')).toBe('hero_monk');
    expect(classSpriteKey('Bard')).toBe('hero_bard');
    expect(classSpriteKey('minstrel')).toBe('hero_bard');
    expect(classSpriteKey('Cleric')).toBe('hero_cleric');
    expect(classSpriteKey('priest')).toBe('hero_cleric');
  });
  it('rogue and ranger no longer collapse to the same silhouette', () => {
    expect(classSpriteKey('rogue')).not.toBe(classSpriteKey('ranger'));
  });
  it('druid, monk and bard each split off the cleric silhouette', () => {
    const cleric = classSpriteKey('cleric');
    expect(classSpriteKey('druid')).not.toBe(cleric);
    expect(classSpriteKey('monk')).not.toBe(cleric);
    expect(classSpriteKey('bard')).not.toBe(cleric);
  });
  it('falls back to the warrior silhouette for an unknown class (no crash)', () => {
    const k = classSpriteKey('chronomancer');
    expect(SPRITES[k]).toBeDefined();
    expect(k).toBe('hero_warrior');
  });
});

describe('peopleSpriteKey', () => {
  it('resolves every catalogued people to its own shield', () => {
    for (const p of PEOPLES) {
      const k = peopleSpriteKey(p.id);
      expect(k).toBe(`people_${p.id}`);
      expect(spritePalette(k)).toBeDefined();
    }
  });
  it('falls back to a villager for an unknown id (no crash)', () => {
    const k = peopleSpriteKey('atlantis');
    expect(SPRITES[k]).toBeDefined();
    expect(k).toBe('npc_villager');
  });
});
