// RTS « Iron Marsh » — static balance tables. THIS is the single source of every
// gameplay number (client-owns-numbers). The LLM never authors anything here.
//
// Ratios are calibrated from the red-alert-design skill: a mainline tank is ~7-9×
// infantry HP; siege has ~1/5 the tank's HP but ~1.5-2× its range; the apex unit
// is ~1.5× a tank plus utility. Human ≈ Allies archetype (lighter/faster/cheaper,
// precise), Lizard ≈ Soviet archetype (heavier/slower/durable, regenerating).

import type {
  ArmorType, BuildingRole, EntityKind, Faction, Spec, UnitRole, Warhead,
} from './types';

// Damage multiplier by warhead vs armour — the counter web. No unit is strictly
// best: small arms shred infantry but bounce off armour; AP cannon kills tanks
// but wastes on infantry; explosive is the area answer; energy is even but only
// the apex/defense carry it.
export const DAMAGE: Record<Warhead, Record<ArmorType, number>> = {
  smallArms: { none: 1.0, light: 0.4, heavy: 0.15, building: 0.2 },
  ap:        { none: 0.4, light: 0.9, heavy: 1.0, building: 0.85 },
  explosive: { none: 1.0, light: 0.75, heavy: 0.5, building: 0.9 },
  energy:    { none: 1.0, light: 1.0, heavy: 0.85, building: 1.0 },
};

// Resolve one hit: base damage × counter multiplier, floored, never negative.
export function hitDamage(warhead: Warhead, baseDamage: number, armor: ArmorType): number {
  return Math.max(0, Math.floor(baseDamage * DAMAGE[warhead][armor]));
}

export const TILE = 24;            // pixels per tile at 1× zoom (render only)
export const TICK_HZ = 12;         // fixed simulation ticks per second
export const SILO_BASE_CAP = 1500; // credit cap with no refinery (starting buffer)
export const BUILD_RADIUS = 5;     // tiles around an owned building you may build in

// Faction flavour names per role (user-facing only; mechanics keyed by role).
const HUMAN_NAMES: Record<EntityKind, string> = {
  hq: 'Command Post', power: 'Power Plant', refinery: 'Ore Refinery',
  barracks: 'Barracks', factory: 'War Factory', tech: 'Tech Center',
  defense: 'Gun Turret',
  harvester: 'Harvester', infantry: 'Rifleman', at: 'Rocketeer',
  tank: 'Medium Tank', siege: 'Artillery', apex: 'Paladin Walker',
};
const LIZARD_NAMES: Record<EntityKind, string> = {
  hq: 'Hive Core', power: 'Bio-Reactor', refinery: 'Biomass Maw',
  barracks: 'Spawning Pit', factory: 'Carapace Forge', tech: 'Gene Vault',
  defense: 'Bio-Spire',
  harvester: 'Reclaimer', infantry: 'Drone', at: 'Spitter',
  tank: 'Saurian Tank', siege: 'Bombardier', apex: 'Saurian Behemoth',
};

// Per-role mechanical spec, shared by both factions. Faction tweaks applied below.
interface RoleSpec extends Omit<Spec, 'faction' | 'name' | 'role'> {}

const BUILDINGS: Record<BuildingRole, RoleSpec> = {
  hq:       { isBuilding: true, cost: 0,    hp: 1000, armor: 'building', buildTicks: 0,   power: 0,    sight: 6, requires: [] },
  power:    { isBuilding: true, cost: 300,  hp: 400,  armor: 'building', buildTicks: 36,  power: 100,  sight: 4, requires: ['hq'] },
  refinery: { isBuilding: true, cost: 1000, hp: 700,  armor: 'building', buildTicks: 72,  power: -30,  sight: 5, requires: ['hq', 'power'], refineryCap: 2000 },
  barracks: { isBuilding: true, cost: 400,  hp: 500,  armor: 'building', buildTicks: 48,  power: -20,  sight: 4, requires: ['hq', 'power'] },
  factory:  { isBuilding: true, cost: 1000, hp: 600,  armor: 'building', buildTicks: 84,  power: -40,  sight: 4, requires: ['hq', 'power', 'barracks'] },
  tech:     { isBuilding: true, cost: 1500, hp: 500,  armor: 'building', buildTicks: 96,  power: -60,  sight: 5, requires: ['hq', 'power', 'factory'] },
  defense:  { isBuilding: true, cost: 600,  hp: 450,  armor: 'building', buildTicks: 48,  power: -50,  sight: 6, requires: ['hq', 'power'], damage: 30, warhead: 'ap', range: 5, cooldown: 9 },
};

const UNITS: Record<UnitRole, RoleSpec> = {
  harvester: { isBuilding: false, cost: 1400, hp: 600, armor: 'heavy', buildTicks: 60, power: 0, sight: 4, requires: ['refinery'], speed: 0.06, capacity: 700 },
  infantry:  { isBuilding: false, cost: 100,  hp: 50,  armor: 'none',  buildTicks: 12, power: 0, sight: 5, requires: ['barracks'], speed: 0.08, damage: 10, warhead: 'smallArms', range: 3, cooldown: 4 },
  at:        { isBuilding: false, cost: 300,  hp: 45,  armor: 'none',  buildTicks: 24, power: 0, sight: 6, requires: ['barracks'], speed: 0.06, damage: 18, warhead: 'ap', range: 5, cooldown: 9 },
  tank:      { isBuilding: false, cost: 800,  hp: 400, armor: 'heavy', buildTicks: 48, power: 0, sight: 5, requires: ['factory'], speed: 0.10, damage: 28, warhead: 'ap', range: 4, cooldown: 8 },
  siege:     { isBuilding: false, cost: 600,  hp: 80,  armor: 'light', buildTicks: 42, power: 0, sight: 6, requires: ['factory'], speed: 0.06, damage: 50, warhead: 'explosive', range: 8, cooldown: 22 },
  apex:      { isBuilding: false, cost: 1700, hp: 600, armor: 'heavy', buildTicks: 96, power: 0, sight: 6, requires: ['tech'], speed: 0.05, damage: 40, warhead: 'energy', range: 5, cooldown: 10 },
};

// Faction asymmetry: Human slightly faster/cheaper precision; Lizard tougher and
// slower with cheaper apex (brute force). Applied as small multipliers so the
// counter web stays intact.
function factionTune(role: EntityKind, base: RoleSpec, faction: Faction): RoleSpec {
  const s: RoleSpec = { ...base, requires: [...base.requires] };
  if (faction === 'lizard') {
    s.hp = Math.round(s.hp * 1.2);                          // tougher
    if (s.speed) s.speed = Math.round(s.speed * 0.85 * 1000) / 1000; // slower
    if (role === 'apex') s.cost = Math.round(s.cost * 0.9); // brute apex cheaper
  } else {
    if (s.speed) s.speed = Math.round(s.speed * 1.1 * 1000) / 1000;  // faster
    if (role === 'tank' || role === 'siege') s.cost = Math.round(s.cost * 0.95);
  }
  return s;
}

const ROLE_BASE: Record<EntityKind, RoleSpec> = { ...BUILDINGS, ...UNITS };

const NAMES: Record<Faction, Record<EntityKind, string>> = {
  human: HUMAN_NAMES,
  lizard: LIZARD_NAMES,
};

// Short, plain-English explanation of what each role does — shown in build tooltips
// so a first-time player understands the tech tree without a manual.
const ROLE_DESC: Record<EntityKind, string> = {
  hq: 'Command center. Sets your build radius. If it falls, you lose.',
  power: 'Generates power. Without enough, production slows and turrets/radar shut off.',
  refinery: 'Refines ore into credits and stores them. Comes with a Harvester.',
  barracks: 'Trains infantry — Riflemen and Rocketeers.',
  factory: 'Builds vehicles — tanks, artillery, walkers. Requires a Barracks.',
  tech: 'Unlocks the elite walker and your superweapon. Requires a War Factory.',
  defense: 'Automated turret. Fires on any enemy that comes in range.',
  harvester: 'Collects ore and hauls it back to a refinery. Your whole economy.',
  infantry: 'Cheap, fast anti-infantry. Shreds enemy soldiers, useless vs armor.',
  at: 'Anti-tank rockets. Strong vs vehicles and buildings, very fragile.',
  tank: 'Main battle tank. Tough all-rounder, your front line.',
  siege: 'Long-range artillery. Huge damage but slow and paper-thin — keep it behind.',
  apex: 'Elite walker. Expensive heavy hitter, needs a Tech Center.',
};
export function roleDesc(role: EntityKind): string { return ROLE_DESC[role]; }

// Names of the prerequisite buildings for a role, in this faction's flavour — used to
// tell the player exactly what to build first when a button is locked.
export function requirementNames(role: EntityKind, faction: Faction): string[] {
  return ROLE_BASE[role].requires.map(r => NAMES[faction][r]);
}

// Public accessor: the fully resolved spec for a role+faction.
export function spec(role: EntityKind, faction: Faction): Spec {
  const base = factionTune(role, ROLE_BASE[role], faction);
  return { ...base, role, faction, name: NAMES[faction][role] };
}

export const ALL_BUILDING_ROLES: BuildingRole[] = ['hq', 'power', 'refinery', 'barracks', 'factory', 'tech', 'defense'];
export const ALL_UNIT_ROLES: UnitRole[] = ['harvester', 'infantry', 'at', 'tank', 'siege', 'apex'];
export const ALL_ROLES: EntityKind[] = [...ALL_BUILDING_ROLES, ...ALL_UNIT_ROLES];

export function isBuildingRole(r: EntityKind): r is BuildingRole {
  return (ALL_BUILDING_ROLES as string[]).includes(r);
}

// Which production building a unit comes out of.
export function producerOf(role: UnitRole): BuildingRole {
  if (role === 'harvester') return 'refinery';
  if (role === 'infantry' || role === 'at') return 'barracks';
  return 'factory'; // tank, siege, apex
}

// Superweapon a faction's tech center unlocks.
export function superweaponOf(faction: Faction): 'orbitalStrike' | 'sporeBloom' {
  return faction === 'human' ? 'orbitalStrike' : 'sporeBloom';
}
export const SUPERWEAPON_COOLDOWN = TICK_HZ * 180; // 3 minutes

export const DIFFICULTY_PRESETS = {
  easy:   { startCredits: 4000, harvestRate: 8,  buildSpeedMul: 0.8, replanEverySec: 25 },
  normal: { startCredits: 3000, harvestRate: 10, buildSpeedMul: 1.0, replanEverySec: 20 },
  hard:   { startCredits: 5000, harvestRate: 14, buildSpeedMul: 1.3, replanEverySec: 15 },
} as const;
