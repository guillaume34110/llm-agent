// Monkey Quest — client-owned game model. Every number here is computed and
// mutated by the client (frozen, algorithmic rules). The LLM only authors the
// thematic strings (names, blurbs, narration) at setup and per scene.

export type RpgPhase = 'setup' | 'world' | 'travel' | 'dilemma' | 'rival' | 'scene' | 'dialogue' | 'combat' | 'gameover' | 'victory';

// ── Travel (a journey between two map nodes; takes time, may spring an event) ──
// All numbers/odds are client-owned. The UI animates the party along the road
// for durationMs, then the client applies the rolled outcome (see arriveTravel).
export type TravelEvent = 'none' | 'ambush' | 'hazard' | 'boon' | 'dilemma';

export interface TravelState {
  fromId: string;
  toId: string;
  dist: number;          // normalized road length (0..~0.6)
  durationMs: number;    // how long the leg animates
  event: TravelEvent;
  eventAt: number;       // 0..1 fraction of the leg where the event fires
  hazardKind?: string;   // flavour label for a hazard
  hazardHp?: number;     // HP each member loses to the hazard
  boonKind?: string;     // flavour for a lucky find
  boonGold?: number;     // gold a boon awards
  resolved: boolean;     // the event has been applied
  note: string;          // one-line summary for the overlay/log
}

export type StatKey = 'might' | 'agility' | 'wits' | 'spirit';

// ── Dilemma (a Curious-Expedition-style road choice; client-owned) ───────────
// The road throws a situation with 2-3 approaches, each gated by one stat. The
// CLIENT rolls d20 + the party's best modifier in that stat vs a client-owned DC
// and applies the success/failure consequence. The LLM (or the deterministic
// fallback) only authors the thematic STRINGS — never a number. An option with no
// stat auto-resolves (a sure cost like paying a toll), still client-priced.
export interface DilemmaDelta {
  hp?: number;       // delta to each living member (negative damage floored at 1 HP)
  morale?: number;   // party morale delta
  gold?: number;     // gold delta (clamped ≥0 on spend)
  xp?: number;       // party XP awarded
  text: string;      // narration of this outcome
}

export interface DilemmaOption {
  label: string;       // the approach the player picks (themable string)
  stat?: StatKey;      // which stat is rolled; omitted ⇒ no roll, auto `good`
  dc?: number;         // client-owned target number (present iff stat present)
  good: DilemmaDelta;  // applied on success (or always, for a no-roll option)
  bad?: DilemmaDelta;  // applied on failure (present iff stat present)
}

export interface DilemmaState {
  nodeId: string;          // destination the party lands at once the dilemma closes
  prompt: string;          // the situation the party faces
  options: DilemmaOption[];
  resolved: boolean;       // an option has been chosen + rolled
  chosenIndex?: number;    // which option the player took
  success?: boolean;       // the roll outcome (undefined for a no-roll option)
  roll?: RoundRoll;        // the surfaced d20 (null/undefined for a no-roll option)
  resultText?: string;     // the applied outcome's narration + mechanics
}

// ── Dice pool (the Curious-Expedition signature; client-owned) ───────────────
// A skill check resolved by rolling a POOL of d6 — one themed die per living
// member (plus item dice) — instead of a single hidden d20. Each die "hits" when
// its face + the contributor's stat bonus clears the target; the count of hits is
// compared to `required`. The player may RE-ROLL the misses (push-your-luck) at a
// morale cost that escalates each time. Every face is rolled by the client RNG —
// the LLM never sees a die, only narrates the outcome. Drives `search` checks and
// the stat-gated `dilemma` options; a no-stat dilemma option stays an instant cost.
export type DiceCheckKind = 'dilemma' | 'search';

export interface PoolDie {
  id: string;
  by: string;        // contributor name (member, or an item/trinket)
  stat: StatKey;     // the themed attribute this die rolls
  bonus: number;     // flat add to the face (floor(stat/2), or item bonus)
  face: number;      // last rolled face, 1..6
  hit: boolean;      // face + bonus ≥ POOL_HIT_TARGET
  kept: boolean;     // a hit is locked; only misses are re-rolled
  item?: boolean;    // an item/trinket die (display flavour)
}

export interface DicePoolState {
  kind: DiceCheckKind;
  stat: StatKey;        // the check's governing attribute
  prompt: string;       // what is being attempted (themable string)
  nodeId: string;       // where the check happens
  danger: number;       // node danger that set `required` (kept for scaling)
  dice: PoolDie[];
  required: number;     // hits needed for a full success
  rerollsUsed: number;
  rerollCost: number;   // morale cost of the NEXT reroll (escalates)
  maxRerolls: number;
  resolved: boolean;    // committed; consequences applied
  outcome?: 'success' | 'partial' | 'fail';
  resultText?: string;  // applied outcome narration + mechanics
  optionIndex?: number; // dilemma only: which option was taken
}

// ── Companion traits (client-owned quirks; Curious-Expedition-style perks) ────
// Each member carries one trait assigned at generation. Most are PARTY-LEVEL and
// presence-based: if any living member has it, the perk applies (state.ts gates
// every effect). `tough` is the lone individual one (baked into maxHp at birth).
// Pure flavour + a single client-owned modifier — the LLM never authors a number.
export type TraitId = 'forager' | 'stalwart' | 'lucky' | 'cheerful' | 'tough' | 'pathfinder' | 'haggler' | 'brave';
export interface CompanionTrait {
  id: TraitId;
  label: string;   // short HUD label
  blurb: string;   // one-line description of the perk
}

// ── Afflictions (sanity escalation; client-owned) ────────────────────────────
// When morale sinks the road preys on the mind: an individual member may catch an
// affliction — a TEMPORARY debuff (one per member) that bites a specific mechanic
// and lifts when spirits recover (rest, or a long stretch of high morale). Pure
// flavour + a single client-owned modifier; the LLM never authors a number.
export type AfflictionId = 'haunted' | 'mutinous' | 'feverish' | 'ravenous' | 'cursed';
export interface Affliction {
  id: AfflictionId;
  label: string;   // short HUD label
  blurb: string;   // one-line description of the malus
}

// ── Trinkets (curios found at map discoveries; client-owned) ─────────────────
// A trinket is a permanent party-level boon carried in the satchel — the reward
// for finding a landmark on the map (see Discovery). PRESENCE-based: hold one and
// its perk applies. Each hooks a single mechanic. Pure flavour + one client-owned
// modifier; the LLM never authors a number.
export type TrinketId =
  | 'idol' | 'charm' | 'talisman' | 'compass' | 'lantern'
  | 'snare' | 'banner' | 'lodestar' | 'aegis' | 'tonic';
export interface Trinket {
  id: TrinketId;
  name: string;    // satchel name
  blurb: string;   // one-line description of the boon
}

// A landmark seeded on a map node at world-build: the party CLAIMS it on arrival,
// granting its trinket once. Curious-Expedition-style point of interest.
export interface Discovery {
  id: string;
  name: string;        // the landmark's name (shown on the map marker)
  blurb: string;       // one-line flavour, surfaced in the log on claim
  trinket: TrinketId;  // the curio it yields
  claimed: boolean;    // becomes true once the party reaches it
}

export interface Character {
  id: string;
  name: string;
  className: string;
  blurb: string;
  isHero: boolean;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  stats: Record<StatKey, number>;
  alive: boolean;
  trait?: CompanionTrait;  // the member's quirk (client-owned perk)
  affliction?: AfflictionId; // a temporary sanity malus caught at low morale (cleared on recovery)
  status?: StatusEffect[]; // active combat conditions (poison from foes, …)
}

export type NodeKind =
  | 'village' | 'town' | 'wild' | 'forest' | 'dungeon' | 'ruin' | 'cave' | 'camp';

// World scale chosen at creation — drives the total number of places generated.
export type MapSize = 'small' | 'medium' | 'large';

// Difficulty chosen at creation — scales foe HP/ATK, XP gain, the post-fight
// breather heal and the goal's recommended level (the farming gate). All numbers
// stay client-owned; difficulty only picks the multipliers.
export type Difficulty = 'easy' | 'normal' | 'hard';

// A dungeon/cave/ruin is a multi-room crawl. Each room is one playable screen
// with a typed challenge; the deepest room is always the boss. Room count scales
// with the chosen MapSize (capped at 15). All numbers stay client-owned.
export type RoomKind = 'combat' | 'trap' | 'treasure' | 'puzzle' | 'rest' | 'boss';

export interface DungeonRoom {
  id: string;
  kind: RoomKind;
  name: string;
  blurb: string;
  cleared: boolean;
  defeatedFoes?: string[];  // ids of foes already slain here — a partial fight leaves survivors standing
  relic?: boolean;          // goal dungeon only: this cache holds the quest artifact (retrieve/both objectives)
}

export interface MapNode {
  id: string;
  name: string;
  kind: NodeKind;
  blurb: string;
  x: number;            // normalized 0..1 position on the world map
  y: number;
  edges: string[];      // neighbouring node ids (bidirectional)
  danger: number;       // 0..3, drives encounter odds + check DC
  discovered: boolean;  // shown on the map (a landmark exists here)
  scouted: boolean;     // its nature is known (kind + danger); else it shows as "?"
  visited: boolean;     // the party has been here
  cleared: boolean;     // its main encounter is resolved
  rooms?: DungeonRoom[];// dungeon/cave/ruin only: the room-by-room crawl
  roomIndex?: number;   // how deep the party has descended (cleared depth)
  reqLevel?: number;    // goal only: recommended hero level (the farming gate)
  farmable?: boolean;   // a cleared open site you can keep hunting for XP/loot
  reputation?: number;  // town/village only: standing with the locals (clears + patronage earn it)
  discovery?: Discovery;// a seeded landmark here, claimed (once) on arrival for a trinket
  defeatedFoes?: string[];// ids of foes already slain at this node — a partial fight leaves survivors standing
  shopSold?: string[];  // settlement only: ids of trade-post goods already bought (drop off the merchant's shelf)
}

// Loot the world drops in treasure rooms and on a boss kill. Potions are
// consumables (used from the satchel); gear permanently boons one member's stat
// the moment it is found. Gold is a running score / token-sink (no cash-out).
export type ItemKind = 'potion' | 'gear' | 'trinket' | 'relic' | 'valuable';

// Cosmetic quality tier, picked client-side from danger/boss. Drives the prefix
// woven into the item name and scales the stat/HP bonus. Pure flavour + numbers.
export type ItemRarity = 'common' | 'fine' | 'masterwork' | 'fabled';

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  heal?: number;        // potion: HP restored when used
  remedy?: boolean;     // potion: clears one ally's affliction instead of healing
  morale?: number;      // potion (cordial): party morale restored instead of healing
  stat?: StatKey;       // gear: which stat it boosts
  bonus?: number;       // gear: amount added
  hp?: number;          // gear (vitality): max-HP boost granted on pickup
  rarity?: ItemRarity;  // gear/potion/valuable: cosmetic tier (also drives the bonus/worth scale)
  ownerId?: string;     // gear: which member wears it (display only)
  trinket?: TrinketId;  // trinket: which curio this is (drives the party-level perk)
  value?: number;       // valuable: gold-equivalent worth (drives haul fame + sale price)
  bulk?: number;        // valuable: satchel weight it occupies (the carry-cap tension)
  trade?: string;       // valuable: trade-good tag (TradeGood); sells dearer where prized
}

// What ends the run in triumph. 'slay' = fell the boss of the goal dungeon (the
// classic finale). 'retrieve' = seize the relic from its cache (you may slip out
// without ever facing the boss). 'both' = claim the relic AND slay the boss. The
// objective is chosen at world-build (client-owned); the relic sits in a flagged
// treasure room of the goal dungeon (see DungeonRoom.relic).
export type QuestObjective = 'slay' | 'retrieve' | 'both';

// The explorer society that backed this expedition (CE2's clubs). Three fixed
// archetypes — their identity (and all numbers: rank xp, boon size, shop prices)
// is client-owned; only their per-world NAME/blurb may be themed by the LLM.
export type SponsorId = 'pathfinders' | 'armorers' | 'mystics';

export interface Quest {
  title: string;
  desc: string;
  done: boolean;
  goalNodeId: string;        // the goal dungeon — its boss and/or its relic decide victory
  objective: QuestObjective; // which condition(s) win the run
  relicName?: string;        // retrieve/both: the artifact to seize (themable string)
  relicClaimed?: boolean;    // retrieve/both: the relic is in the satchel
}

// A scene is the interactive moment at the current node. The client decides the
// legal action tags; the LLM fills narration + button labels for those tags.
export type ActionTag =
  | 'search' | 'talk' | 'rest' | 'look' | 'fight' | 'recruit' | 'quest' | 'leave' | 'hunt' | 'provision';

export interface SceneChoice {
  label: string;
  tag: ActionTag;
}

export interface Scene {
  nodeId: string;
  narration: string;    // the latest GM beat (kept for back-compat)
  log?: string[];       // running GM transcript at this place (oldest first, newest last)
  choices: SceneChoice[];
  busy: boolean;        // a request to the GM is in flight
  fallback: boolean;    // the last narration came from the deterministic fallback
}

// ── Dialogue (free-text talk with an NPC; the world can shift, never the trame) ──
// The player types freely; the LLM voices one NPC and may pick a single effect
// token. The CLIENT computes every consequence and forbids any change to the
// main quest goal or node order — the scenario thread stays intact, only its
// surroundings evolve (new leads, revealed places, healing, an ally, danger intel).
export type DialogueEffect = 'none' | 'reveal' | 'rumor' | 'heal' | 'recruit' | 'warn';

export interface DialogueTurn {
  who: 'player' | 'npc' | 'system'; // 'system' = a client note about an applied effect
  text: string;
}

export interface DialogueState {
  nodeId: string;
  npcName: string;
  npcRole: string;
  history: DialogueTurn[];
  busy: boolean;        // a reply request is in flight
  over: boolean;        // the NPC (or player) ended the conversation
  fallback: boolean;    // the last reply came from the deterministic fallback
}

// How a foe "plays" — a closed enum so the LLM (or the bestiary) can author a
// thematic personality ONCE at spawn time, never per round. The pure combat
// engine maps each archetype deterministically to a die-face lean (how the foe
// rolls) and a target policy (whom its swords seek), so the foe makes visible,
// instant tactical decisions with zero combat latency. Unknown → 'trickster'
// (safe default: balanced dice, random target). The LLM never emits a number.
export type EnemyTactics = 'aggressor' | 'defender' | 'skirmisher' | 'brute' | 'trickster';

// A visible foe in the dedicated battle view. Numbers are client-owned.
export interface Enemy {
  id: string;
  name: string;
  glyph: string;
  hp: number;
  maxHp: number;
  atk: number;
  alive: boolean;
  tactics?: EnemyTactics;  // its battle personality (dice lean + target policy); default 'trickster'
  bossPhase?: number;     // boss only: current phase (1-based)
  bossMaxPhase?: number;  // boss only: total phases before it truly dies
  status?: StatusEffect[]; // active combat conditions (burn/bleed/stun, …)
}

// ── Combat status effects (Curious-Expedition-style; client-owned) ────────────
// A timed condition on a fighter, applied by class specials, critical hits, or
// venomous foes. DoTs (burn/bleed/poison) bleed HP at the start of each round;
// stun makes a foe skip its turn. Every number is computed and clamped client-
// side — the LLM only narrates the result, never authors a status or its damage.
export type StatusId = 'burn' | 'bleed' | 'poison' | 'stun';
export interface StatusEffect {
  id: StatusId;
  rounds: number;   // turns remaining (decremented each round; dropped at 0)
  power: number;    // HP lost per tick for a DoT (stun ignores this)
}

export type CombatAction = 'attack' | 'defend' | 'flee' | 'special';

// ── Tactical dice combat (the Curious-Expedition-2 battle model) ─────────────
// A round is fought with a SYMBOL dice pool, not a hidden d20. The engine that
// rolls, assigns and resolves these lives in combat-dice.ts (a pure leaf); these
// are the shapes it trades in, hoisted here so CombatState can hold them.
export type CombatFace = 'sword' | 'shield' | 'star' | 'blank';

export interface CombatDie {
  id: string;
  by: string;          // contributor name (display)
  memberId: string;    // which party member (or foe) rolled it
  face: CombatFace;
  power: number;        // magnitude this face carries (0 for a blank)
  assignedTo: string | null; // enemy id | 'party' | null (foe dice never assign)
}

export interface CombatResolution {
  enemyDamage: Record<string, number>;            // damage dealt to each foe id
  memberDamage: { memberId: string; amount: number }[]; // hits landed on the party
  partyBlock: number;   // total block the party raised this round
  incoming: number;     // total foe attack value before block
  mitigated: number;    // how much of `incoming` the block soaked
}

// The headline d20 of the last round — surfaced so the UI can throw a visible
// die and the GM can pronounce on a critical. Pure display; the client already
// applied every consequence. null when the round had no d20 (defend/special).
export interface RoundRoll {
  value: number;        // the natural d20 face (1..20)
  total: number;        // face + modifier
  dc: number;
  success: boolean;
  crit: boolean;        // natural 20
  fumble: boolean;      // natural 1
  by: string;           // who rolled (member name)
  round: number;        // the combat round this die belongs to (re-trigger key)
}

export interface CombatState {
  nodeId: string;
  enemies: Enemy[];
  round: number;
  log: string[];        // round-by-round mechanics + narration (newest last)
  targetId: string | null;
  defending: boolean;   // party braced this round
  specialCd: number;    // rounds until the hero's signature move is ready (0 = ready)
  busy: boolean;        // a narration request is in flight
  over: boolean;
  result: 'win' | 'lose' | 'flee' | null;
  roomId?: string | null; // dungeon crawl: which room this fight clears (null = whole node)
  farm?: boolean;         // a repeatable hunt in a cleared farmable site (XP/loot, no clear)
  intervention?: 'boon' | 'bane' | null; // GM rubber-band that fired entering this fight
  lastRoll?: RoundRoll | null; // headline d20 of the last round (drives the dice cam)
  // ── Tactical (CE2) round ───────────────────────────────────────────────────
  // The current round's rolled symbol pool + the foes' own rolled dice (the
  // symmetric enemy board), plus push-your-luck bookkeeping. Both pools roll fresh
  // at the top of each round; the player assigns their dice, optionally pushes
  // their luck (re-rolls the leftovers for morale), then commits to resolve both
  // sides at once. Null in the legacy d20 path / between fights.
  pool?: CombatDie[] | null;
  enemyPool?: CombatDie[] | null;
  rerollsUsed?: number;
  rerollCost?: number;       // morale cost of the NEXT push (escalates)
  maxRerolls?: number;
  lastResolution?: CombatResolution | null; // the just-committed round's numbers (UI flashes it)
}

// A finished hero kept after a victory — persisted client-side under a separate
// key from the active save. The player may summon one as the start of a new run,
// carrying their level and stats forward (the "vignette de depart" veterans).
export interface VeteranRecord {
  char: Character;
  theme: string;
  title: string;     // the run they cleared
  ngPlus: number;    // the tier they cleared it at
  savedAt: number;   // epoch ms
}

// ── Rivals / challengers (Curious-Expedition-style competing expeditions) ─────
// A rival band races the party to the same goal. They advance a full leg every
// time the PARTY travels, and a HALF leg when the party lingers (camps, or pushes
// deeper into a dungeon) — time presses everywhere except at the goal site itself,
// so the final crawl stays winnable. Reach the goal before the party and the run
// is lost — the prize is taken. Crossing paths springs an encounter (race /
// sabotage / parley, plus one disposition-flavoured tactic). All numbers are
// client-owned; the LLM never authors a rival's progress or roll.
export type RivalDisposition = 'rival' | 'cutthroat' | 'genial';

export interface Rival {
  id: string;
  name: string;
  glyph: string;             // single-char map marker
  blurb: string;             // one-line flavour (who they are)
  path: string[];            // spawn → goal node ids (precomputed shortest route)
  progress: number;          // 0..1 along the path toward the goal
  pace: number;              // progress gained per party travel leg (difficulty-scaled)
  nodeId: string;            // current node (derived from progress along path)
  disposition: RivalDisposition;
  met: boolean;              // the party has crossed paths at least once
  hindered: number;          // legs of slowed pace remaining (from a successful sabotage)
  arrived: boolean;          // reached the goal — won the race (run lost for the player)
  nemesis?: boolean;         // a returning foe from a past defeat (hub-persisted grudge)
}

// A face-to-face meeting when the party lands where a rival stands. Reuses the
// d20-check model: each option may be stat-gated, the CLIENT rolls and applies the
// consequence (hinder the rival, gain intel, or lose ground). The LLM authors no
// number — only, optionally, the thematic strings (handled at runtime).
export type RivalTactic = 'race' | 'sabotage' | 'parley' | 'trade' | 'standoff' | 'wager';
export interface RivalOption {
  label: string;
  tactic: RivalTactic;
  stat?: StatKey;   // stat-gated tactics roll; race/trade auto-resolve
  dc?: number;      // client-owned target (present iff stat present)
}
export interface RivalEncounterState {
  rivalId: string;
  nodeId: string;          // where the meeting happens
  prompt: string;          // the situation
  options: RivalOption[];
  resolved: boolean;
  chosenIndex?: number;
  success?: boolean;       // the roll outcome (undefined for the no-roll race option)
  roll?: RoundRoll;        // surfaced d20 (undefined for the no-roll option)
  resultText?: string;     // applied outcome narration + mechanics
}

export interface RpgState {
  version: 1;
  phase: RpgPhase;
  difficulty: Difficulty;
  theme: string;
  title: string;
  intro: string;
  seed: number;
  step: number;         // monotonically increasing; re-derives the RNG stream
  quest: Quest;
  nodes: Record<string, MapNode>;
  order: string[];      // stable node ordering for layout/links
  party: Character[];   // hero first, up to 4 total
  recruitPool: Character[]; // companions the world can still offer
  inventory: Item[];    // shared satchel: potions + found gear (client-owned)
  gold: number;         // running treasure score (no cash-out, token-sink only)
  ngPlus: number;       // New Game+ tier: 0 = first run, +1 each cleared world
  currentNodeId: string;
  log: string[];        // running narrative + mechanics log (newest last)
  rumors: string[];     // side-leads gathered through dialogue (the trame's branches)
  scene: Scene | null;
  dialogue: DialogueState | null;
  combat: CombatState | null;
  travel: TravelState | null;
  dilemma: DilemmaState | null;  // an active road choice awaiting the player
  rivals: Rival[];               // competing expeditions racing to the goal (may be empty)
  rivalEncounter: RivalEncounterState | null; // an active rival meeting awaiting the player
  dicePool: DicePoolState | null; // an active dice-pool check awaiting roll/commit
  // Party morale (the expedition's collective resolve, 0..100). Drains with hard
  // travel and losses, restored by rest and reaching safe towns. Low morale tilts
  // the road toward danger and can make a companion desert. Client-owned.
  morale: number;
  // The society that sponsored this run (CE2 club). Set at world-build from the
  // player's pick; its boon was already folded into starting gold/provisions/satchel.
  // Carried so the return can credit the right club's rank xp. Optional: a run can
  // be unsponsored (older saves, or no pick).
  sponsor?: { id: SponsorId; name: string };
  // The world's native people, pinned at world-build (CE2 regional economy). When the
  // run was launched from a destination that fixed its locals, this is that people's id;
  // otherwise it's the deterministic per-seed roll, pinned so every consumer (barter,
  // rapport, loot premium, starting standing, scene flavour) agrees on one culture. A
  // pre-feature save lacks it → resolvers fall back to peopleOf(seed) = the same people
  // that save always had (forward-compat, no drift). Client-owned; never the server's.
  peopleId?: string;
  // Provisions (rations carried, 0..PROV_MAX). Each travel leg eats some, scaled by
  // distance. Bought with gold at villages/towns. Running out on the road starves
  // the party — extra HP loss + morale drain. Client-owned (numbers in state.ts).
  provisions: number;
}
