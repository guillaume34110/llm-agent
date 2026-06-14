// RTS « Iron Marsh » — pure type definitions for the simulation.
//
// CLIENT-OWNS-NUMBERS invariant: every number that touches game state (hp,
// damage, costs, build times, resource ticks, fog, pathing, win/loss) is
// computed and clamped here in TS. The LLM enemy commander only ever emits an
// `EnemyPlan` (strategic intent + flavour strings) which is validated and
// translated into concrete, bounded orders. No LLM-authored number ever reaches
// RtsState.

export type Faction = 'human' | 'lizard';
export type Owner = 'player' | 'enemy';

// Terrain a tile is made of. Only `ground` and `ore` are passable by land units;
// buildings may only be placed on `ground`.
export type Terrain = 'ground' | 'water' | 'rock' | 'ore';

// Shared mechanical roles. Each faction skins these with its own id/name in the
// catalog (data.ts) but the mechanics are keyed by role so balance stays
// archetype-symmetric (Human ≈ Allies, Lizard ≈ Soviets).
export type BuildingRole =
  | 'hq'        // construction yard — root of the build radius
  | 'power'     // power plant — supplies power
  | 'refinery'  // economy: harvesters unload here; raises credit cap
  | 'barracks'  // infantry production
  | 'factory'   // vehicle production
  | 'tech'      // tech center — gates apex unit + superweapon
  | 'defense';  // base defense turret (consumes power, fires when powered)

export type UnitRole =
  | 'harvester' // economy lifeline; unarmed
  | 'infantry'  // cheap anti-infantry chaff
  | 'at'        // anti-armour / anti-air soldier; fragile
  | 'tank'      // mainline armour
  | 'siege'     // long range, fragile, slow reload (artillery / V2)
  | 'apex';     // superunit (Paladin / Behemoth)

export type EntityKind = BuildingRole | UnitRole;

export type ArmorType = 'none' | 'light' | 'heavy' | 'building';
export type Warhead = 'smallArms' | 'ap' | 'explosive' | 'energy';

// A catalog entry: the static spec for one buildable thing (data.ts).
export interface Spec {
  role: EntityKind;
  faction: Faction;
  name: string;            // thematic, user-facing only
  isBuilding: boolean;
  cost: number;            // credits
  hp: number;
  armor: ArmorType;
  buildTicks: number;      // production / construction time
  power: number;           // >0 supplies, <0 consumes
  sight: number;           // tiles
  requires: BuildingRole[]; // tech prerequisites (owner must have these built)
  // combat (omitted for unarmed things like harvester / power)
  damage?: number;
  warhead?: Warhead;
  range?: number;          // weapon range in tiles
  cooldown?: number;       // ticks between shots
  speed?: number;          // tiles per tick (0 / undefined for buildings)
  // economy (harvester only)
  capacity?: number;       // ore units carried per trip
  // building only
  refineryCap?: number;    // credit storage this refinery adds
}

export type EntityOrder =
  | { type: 'idle' }
  | { type: 'move'; tx: number; ty: number }
  | { type: 'attackMove'; tx: number; ty: number }
  | { type: 'attack'; targetId: number }
  | { type: 'harvest' }; // harvester autonomous loop

export interface Entity {
  id: number;
  owner: Owner;
  faction: Faction;
  role: EntityKind;
  isBuilding: boolean;
  x: number;               // tile coords (float for units, int center for buildings)
  y: number;
  hp: number;
  maxHp: number;
  order: EntityOrder;
  path?: Array<{ x: number; y: number }>; // current route (tile centers), units only
  cooldownLeft: number;    // ticks until weapon ready
  // building construction
  buildLeft: number;       // ticks until functional (0 = ready)
  // harvester state
  load?: number;           // ore currently carried
  harvestPhase?: 'toOre' | 'mining' | 'toRefinery';
  // enemy AI: this unit is a scout peeling ahead of the army to find the base
  scouting?: boolean;
}

// A queued unit being produced at a building.
export interface BuildJob {
  role: UnitRole;
  ticksLeft: number;
  fromId: number;          // production building id
}

export interface SuperweaponState {
  role: 'orbitalStrike' | 'sporeBloom' | 'hiveSurge';
  cooldownLeft: number;    // ticks until ready (0 = ready)
}

export interface SidePlayer {
  owner: Owner;
  faction: Faction;
  credits: number;
  queue: BuildJob[];
  superweapons: SuperweaponState[];
  // standing AI intent (enemy only); player leaves this null
  plan: EnemyPlan | null;
  wastedCredits: number;   // credits lost to overflowing the cap (raiding signal)
  // enemy only: last position where the foe base was actually seen. Persists through
  // fog so the army keeps pressing the base after it loses vision. null until scouted.
  knownEnemyBase?: { x: number; y: number } | null;
}

export interface RtsState {
  seed: number;
  w: number;               // grid width in tiles
  h: number;               // grid height in tiles
  terrain: Terrain[];      // length w*h
  ore: number[];           // remaining ore per tile (0 where none); length w*h
  oreMax: number[];        // original/regen cap per ore tile; fields slowly regrow toward this
  entities: Record<number, Entity>;
  order: number[];         // stable entity id list for deterministic iteration
  nextId: number;
  player: SidePlayer;
  enemy: SidePlayer;
  fog: { player: Uint8Array; enemy: Uint8Array }; // 0 unseen, 1 explored, 2 visible
  tick: number;
  winner: Owner | null;
  difficulty: Difficulty;
}

export interface Difficulty {
  startCredits: number;
  harvestRate: number;     // ore mined per mining tick
  buildSpeedMul: number;   // enemy production speed multiplier
  replanEverySec: number;  // how often the enemy re-asks the LLM
}

// ── The LLM enemy commander contract ────────────────────────────────────────
// The ONLY thing the model emits. Validated against the catalog whitelist before
// it is ever applied; numbers it might hallucinate are ignored — the client
// decides what is affordable / buildable / reachable.
export type Stance = 'aggress' | 'turtle' | 'expand' | 'raid' | 'tech';
export type EnemyTarget = 'enemyHarvester' | 'enemyPower' | 'enemyBase' | 'enemyArmy';

export interface EnemyPlan {
  stance: Stance;
  buildPriority: EntityKind[]; // ordered list of roles to build, whitelist-checked
  targets: EnemyTarget[];      // what the army should hit, in order of preference
  taunt: string;               // flavour only, shown in the UI
}

// Compact, fog-limited view handed to the LLM (no perfect information).
export interface RtsWorldView {
  myFaction: Faction;
  myCredits: number;
  myPower: { supply: number; draw: number };
  myBuildings: Partial<Record<BuildingRole, number>>; // counts
  myUnits: Partial<Record<UnitRole, number>>;
  myArmyCount: number;                  // total combat units I field (harvesters excluded)
  creditsFull: boolean;                 // bank near cap / overflowing — SPEND, don't hoard
  enemyBaseFound: boolean;              // I have located the human base (scouted or remembered)
  techAvailable: EntityKind[];          // what I could build right now
  scoutedEnemy: {                       // only what the fog currently reveals
    buildings: Partial<Record<BuildingRole, number>>;
    units: Partial<Record<UnitRole, number>>;
  };
  superweaponReady: boolean;
  lastTaunt?: string;
}
