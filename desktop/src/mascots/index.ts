import type { FamilyId, MascotEntry } from './types';
import { BOTANICAL_POOL } from './botanical';
import { FELINE_POOL } from './feline';
import { CANINE_POOL } from './canine';
import { PRIMATE_POOL } from './primate';
import { EQUID_POOL } from './equid';
import { MEGAFAUNA_POOL } from './megafauna';
import { RODENT_POOL } from './rodent';
import { URSINE_POOL } from './ursine';
import { AVIAN_POOL } from './avian';
import { REPTILE_POOL } from './reptile';
import { MYTHIC_POOL } from './mythic';
import { MARINE_POOL } from './marine';
import { SHELL_POOL } from './shell';
import { INSECT_POOL } from './insect';
export { getFamilyForAnimal } from './families';
export type { FamilyId, MascotEntry } from './types';

const FAMILY_POOLS: Record<FamilyId, MascotEntry[]> = {
  botanical: [],
  feline: FELINE_POOL,
  canine: CANINE_POOL,
  primate: PRIMATE_POOL,
  equid: EQUID_POOL,
  megafauna: MEGAFAUNA_POOL,
  rodent: RODENT_POOL,
  ursine: URSINE_POOL,
  avian: AVIAN_POOL,
  reptile: REPTILE_POOL,
  mythic: MYTHIC_POOL,
  marine: MARINE_POOL,
  shell: SHELL_POOL,
  insect: INSECT_POOL,
};

export function getMascotPool(family: FamilyId): MascotEntry[] {
  return [...BOTANICAL_POOL, ...FAMILY_POOLS[family]];
}

export function pickMascotsWeighted(pool: MascotEntry[], count: number, rng: () => number): MascotEntry[] {
  const out: MascotEntry[] = [];
  const totalW = pool.reduce((s, m) => s + (m.weight ?? 1), 0);
  for (let i = 0; i < count; i++) {
    let r = rng() * totalW;
    for (const entry of pool) {
      r -= entry.weight ?? 1;
      if (r <= 0) { out.push(entry); break; }
    }
  }
  return out;
}
