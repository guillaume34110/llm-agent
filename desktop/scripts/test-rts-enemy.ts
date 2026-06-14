// RTS enemy-commander regression — the client-owns-numbers / fail-closed invariant.
// A malformed reply must fall back; a plan asking for unaffordable or un-teched units
// must produce NO illegal order and never mutate state with a model-authored number.
// Run: npx tsx scripts/test-rts-enemy.ts

import { validatePlan, fallbackPlan, resolvePlan, summarizeWorld, planVocabulary } from '../src/game/rts/enemy';
import { createGame, applyEnemyPlan, sideOf, entitiesOf, buildingCounts, tick } from '../src/game/rts/state';
import type { EnemyPlan } from '../src/game/rts/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// ── validatePlan: garbage → null, whitelist filtering ────────────────────────
ok(validatePlan('not json at all') === null, 'non-JSON string → null');
ok(validatePlan('{"taunt":"hi"}') === null, 'JSON without a valid stance → null');
ok(validatePlan(null) === null, 'null → null');
ok(validatePlan({ stance: 'banana' }) === null, 'unknown stance → null');

const filtered = validatePlan({
  stance: 'aggress',
  buildPriority: ['tank', 'NONSENSE', 'apex', 42, 'power'],
  targets: ['enemyBase', 'spaceStation', 'enemyHarvester'],
  taunt: 'x'.repeat(500),
})!;
ok(!!filtered, 'valid stance accepted');
ok(filtered.buildPriority.every(r => ['tank', 'apex', 'power'].includes(r)), 'unknown roles filtered out of buildPriority');
ok(!filtered.buildPriority.includes('NONSENSE' as never), 'garbage role dropped');
ok(filtered.targets.length === 2 && !filtered.targets.includes('spaceStation' as never), 'unknown targets filtered');
ok(filtered.taunt.length <= 160, 'taunt clamped to 160 chars');

// ── A model that invents NUMBERS: they must be ignored entirely ───────────────
const s = createGame(555, 'lizard', 'normal'); // player=lizard, enemy=human
const enemyStartCredits = sideOf(s, 'enemy').credits;
const dirty = {
  stance: 'aggress',
  buildPriority: ['tank'],
  targets: ['enemyBase'],
  taunt: 'mine',
  // hostile extra fields a model might emit — must never touch state:
  credits: 999999, hp: 1, cost: 0, damage: 99999, give_me_units: 50,
} as unknown;
const v = validatePlan(dirty)!;
ok(!('credits' in (v as object)), 'EnemyPlan has no credits field (numbers stripped by shape)');
applyEnemyPlan(s, v as EnemyPlan);
ok(sideOf(s, 'enemy').credits <= enemyStartCredits, `enemy credits not inflated by model (${sideOf(s, 'enemy').credits} ≤ ${enemyStartCredits})`);

// ── applyEnemyPlan with an un-teched / unaffordable request → no illegal order ─
const s2 = createGame(556, 'human', 'normal'); // enemy = lizard
const e = sideOf(s2, 'enemy');
e.credits = 50; // can't afford almost anything
const beforeUnits = entitiesOf(s2, 'enemy').filter(x => !x.isBuilding).length;
const beforeBuildings = JSON.stringify(buildingCounts(s2, 'enemy'));
// Ask for an apex (needs tech center we don't have) and a tank (needs factory).
applyEnemyPlan(s2, { stance: 'aggress', buildPriority: ['apex', 'tank'], targets: ['enemyBase'], taunt: '' });
const afterBuildings = JSON.stringify(buildingCounts(s2, 'enemy'));
ok(e.credits >= 0, `credits never go negative (${e.credits})`);
ok(afterBuildings === beforeBuildings, 'no un-teched building appeared');
// no apex/tank queued (un-teched) — queue only holds legal jobs
ok(e.queue.every(j => j.role !== 'apex' && j.role !== 'tank'), 'no un-teched unit entered the build queue');
void beforeUnits;

// ── Economy safety net: applyEnemyPlan keeps ≥2 harvesters even if LLM ignores it
const s3 = createGame(557, 'human', 'normal');
const e3 = sideOf(s3, 'enemy');
e3.credits = 100000;
// LLM plan that only wants power, never harvesters:
applyEnemyPlan(s3, { stance: 'turtle', buildPriority: ['power'], targets: [], taunt: '' });
const harvQueuedOrOwned = (s3.enemy.queue.filter(j => j.role === 'harvester').length)
  + entitiesOf(s3, 'enemy').filter(x => x.role === 'harvester').length;
ok(harvQueuedOrOwned >= 2, `enemy maintains ≥2 harvesters (have/queued ${harvQueuedOrOwned})`);

// ── Coherent build order: no useless square block of redundant buildings ─────
// Drive a full opening with rich credits + ticks; the engine must follow doctrine
// (one structure at a time, caps respected) regardless of what the LLM spams.
const s4 = createGame(558, 'human', 'normal'); // enemy = lizard
const e4 = sideOf(s4, 'enemy');
e4.credits = 100000;
// A pathological plan: nothing but barracks, every call.
for (let i = 0; i < 4000; i++) {
  if (i % 40 === 0) applyEnemyPlan(s4, { stance: 'aggress', buildPriority: ['barracks', 'barracks', 'barracks'], targets: ['enemyBase'], taunt: '' });
  tick(s4);
  e4.credits = 100000; // never starve — isolate the count logic
}
const bc4 = buildingCounts(s4, 'enemy');
ok((bc4.barracks || 0) <= 1, `caps barracks at 1 despite spam (have ${bc4.barracks || 0})`);
ok((bc4.power || 0) >= 1, 'still built power first (economy doctrine)');
ok((bc4.refinery || 0) >= 1, 'still built a refinery despite barracks-only plan');
// No structure is ever skipped into a packed square: min pairwise gap ≥ 1 tile.
const bldgs = entitiesOf(s4, 'enemy').filter(x => x.isBuilding);
let minGap = Infinity;
for (let a = 0; a < bldgs.length; a++) for (let c = a + 1; c < bldgs.length; c++) {
  minGap = Math.min(minGap, Math.hypot(Math.floor(bldgs[a].x) - Math.floor(bldgs[c].x), Math.floor(bldgs[a].y) - Math.floor(bldgs[c].y)));
}
ok(minGap >= 1, `buildings never overlap (min gap ${minGap.toFixed(2)})`);

// fallbackPlan + resolvePlan: always a usable plan ─────────────────────────
const fb = fallbackPlan(s3, 'enemy');
ok(fb.buildPriority.length > 0, 'fallbackPlan always yields a build priority');
ok(planVocabulary().stances.includes(fb.stance), 'fallback stance is in the vocabulary');

const r1 = resolvePlan(s3, 'total garbage', 'enemy');
ok(r1.fallback === true && r1.plan.buildPriority.length > 0, 'resolvePlan(garbage) → fallback plan, usable');
const r2 = resolvePlan(s3, { stance: 'raid', buildPriority: ['tank'], targets: ['enemyHarvester'], taunt: 'hiss' }, 'enemy');
ok(r2.fallback === false && r2.plan.stance === 'raid', 'resolvePlan(valid) → keeps model plan');
const r3 = resolvePlan(s3, { stance: 'tech' }, 'enemy'); // valid stance, empty body
ok(r3.fallback === false && r3.plan.stance === 'tech' && r3.plan.buildPriority.length > 0,
  'resolvePlan(stance only) → keeps stance, fills body from fallback');

// ── summarizeWorld is fog-limited: no enemy info leaks at game start ──────────
const view = summarizeWorld(s3, 'enemy');
const scouted = Object.keys(view.scoutedEnemy.buildings).length + Object.keys(view.scoutedEnemy.units).length;
ok(scouted === 0, 'at game start the enemy has scouted nothing (fog-limited view)');
ok(view.myCredits <= 100000 + 10000, 'reported credits are the clamped value');
ok(typeof view.myFaction === 'string', 'world view reports own faction');

console.log(failures === 0 ? '\nENEMY OK' : `\nENEMY FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
