import type { RpgSetupHero } from '../../api';
import type { Character, StatKey } from './types';
import { uid } from './ids';
import { pickRng } from './dice';
import { TRAITS, TRAIT_IDS, TOUGH_HP } from './traits';

// ── Character generation (client-owned stats) ───────────────────────────────

export const NAMES = [
  'Aldric', 'Bryn', 'Cael', 'Dara', 'Eira', 'Finn', 'Gwen', 'Hale', 'Isa',
  'Joran', 'Ket', 'Lyra', 'Mira', 'Nox', 'Orin', 'Perl', 'Rune', 'Sora',
  'Tarn', 'Vesh', 'Wren', 'Yara', 'Zeph',
];

export const STAT_KEYS: StatKey[] = ['might', 'agility', 'wits', 'spirit'];

// Derive a stat profile from the class name keyword. Pure heuristic — the LLM
// only supplied the label, the client decides the numbers.
export function statProfile(className: string): { stats: Record<StatKey, number>; hp: number; key: StatKey } {
  const c = className.toLowerCase();
  const base: Record<StatKey, number> = { might: 2, agility: 2, wits: 2, spirit: 2 };
  let key: StatKey = 'might';
  let hp = 24;
  if (/warrior|knight|fighter|barbarian|soldier|guard|brute|paladin/.test(c)) {
    base.might = 5; base.agility = 3; hp = 32; key = 'might';
  } else if (/ranger|rogue|hunter|scout|thief|archer|assassin|duelist/.test(c)) {
    base.agility = 5; base.wits = 3; hp = 26; key = 'agility';
  } else if (/mage|wizard|sorcer|witch|warlock|arcan|elementalist/.test(c)) {
    base.wits = 5; base.spirit = 3; hp = 20; key = 'wits';
  } else if (/cleric|priest|druid|bard|monk|shaman|healer|oracle/.test(c)) {
    base.spirit = 5; base.wits = 3; hp = 24; key = 'spirit';
  } else {
    base.might = 4; base.agility = 3; base.wits = 3; base.spirit = 3; key = 'might';
  }
  return { stats: base, hp, key };
}

// `rng` drives the trait roll; omit it (legacy callers) for a trait-less member.
// A `tough` member is born with TOUGH_HP extra max HP (the only stat a trait moves).
export function makeCharacter(opt: RpgSetupHero, name: string, isHero: boolean, rng?: () => number): Character {
  const p = statProfile(opt.className);
  const trait = rng ? TRAITS[pickRng(rng, TRAIT_IDS)] : undefined;
  const bonusHp = trait?.id === 'tough' ? TOUGH_HP : 0;
  return {
    id: uid(isHero ? 'hero' : 'ally'),
    name,
    className: opt.className,
    blurb: opt.blurb,
    isHero,
    level: 1,
    xp: 0,
    hp: p.hp + bonusHp,
    maxHp: p.hp + bonusHp,
    stats: { ...p.stats },
    alive: true,
    trait,
  };
}

export function statMod(c: Character, key: StatKey): number {
  return c.stats[key];
}

// What it costs, in gold pieces, to HIRE the next companion at a settlement.
// Scales with the recruit's raw power and how big the band already is — the
// fourth blade is dearer than the second. Client-owned (never the LLM): the
// purse is checked and debited here. The "convinced for free" path — winning an
// NPC over in dialogue — bypasses this entirely (see applyDialogueEffect).
export function recruitCost(ally: Character, partySize: number): number {
  const statSum = ally.stats.might + ally.stats.agility + ally.stats.wits + ally.stats.spirit;
  const base = 40 + statSum * 5 + (ally.level - 1) * 25;
  const sizeMul = 1 + Math.max(0, partySize - 1) * 0.5; // ×1.0 / ×1.5 / ×2.0 for the 2nd/3rd/4th
  return Math.round((base * sizeMul) / 5) * 5; // whole, clean gold pieces
}
