// Combat balance regression — the "I one-shot everyone" fix. Foe HP now scales to
// the party's own damage-per-round and foe attack to danger + party veterancy, so
// a fight lasts a few rounds and costs real HP at every stage of the run instead
// of collapsing into a single volley. This sim drives attack-only fights (a
// conservative lower bound on party output — specials only help) across early/mid/
// late party states and asserts the shape of the result. Every number is computed
// client-side; the LLM authors none of it.
//
// Run: npx tsx scripts/test-combat-balance.ts
import { buildWorld, startCombat, combatRound } from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, Character, StatKey } from '../src/game/rpg/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

function fakeSetup(): RpgSetupResult {
  const loc = (i: number) => ({ name: `Place ${i}`, kind: ['village', 'town', 'wild', 'forest', 'ruin', 'cave'][i % 6], blurb: 'x' });
  return {
    title: 'World', intro: 'intro',
    locations: Array.from({ length: 8 }, (_, i) => loc(i)),
    heroes: [{ className: 'Knight', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}

// Mirror of state.ts statProfile + grantXp leveling, so the sim builds members
// whose stats match what the game actually produces at a given level.
const PROFILES: Record<string, { stats: Record<StatKey, number>; hp: number; key: StatKey }> = {
  warrior: { stats: { might: 5, agility: 3, wits: 2, spirit: 2 }, hp: 32, key: 'might' },
  ranger:  { stats: { might: 2, agility: 5, wits: 3, spirit: 2 }, hp: 26, key: 'agility' },
  mage:    { stats: { might: 2, agility: 2, wits: 5, spirit: 3 }, hp: 20, key: 'wits' },
  cleric:  { stats: { might: 2, agility: 2, wits: 3, spirit: 5 }, hp: 24, key: 'spirit' },
};
const STAT_KEYS: StatKey[] = ['might', 'agility', 'wits', 'spirit'];

function member(arch: keyof typeof PROFILES, level: number, i: number): Character {
  const p = PROFILES[arch];
  const stats = { ...p.stats };
  let maxHp = p.hp;
  for (let L = 2; L <= level; L++) {
    maxHp += 7;
    stats[p.key] += 1;
    if (L % 2 === 0) {
      const sec = STAT_KEYS.filter(s => s !== p.key).sort((a, b) => stats[a] - stats[b])[0];
      stats[sec] += 1;
    }
  }
  return {
    id: `m${i}`, name: `${arch}${i}`, className: arch, blurb: '', isHero: i === 0,
    level, xp: 0, hp: maxHp, maxHp, stats, alive: true,
  };
}

// Build a state with a chosen party at a node of a chosen danger, then run an
// attack-only fight to completion. Returns rounds survived, HP-loss fraction and
// whether the party won. boss=true spawns the phased boss.
interface FightOut { rounds: number; lossFrac: number; win: boolean; wiped: boolean }
function runFight(party: Character[], danger: number, seed: string, boss = false): FightOut {
  const s = buildWorld(fakeSetup(), seed, 0, 'medium');
  s.party = party.map(c => ({ ...c, stats: { ...c.stats } }));
  const node = s.nodes[s.currentNodeId];
  node.danger = danger;
  node.cleared = false;
  const totalHp = s.party.reduce((a, c) => a + c.maxHp, 0);
  let st: RpgState = startCombat(s, s.currentNodeId, boss ? { boss: true } : undefined);
  let rounds = 0;
  // Track the low-water mark of party HP across the fight. The winning round
  // applies a breather heal inside combatRound, so reading only the END HP hides
  // how hurt the party got — sample after every round and keep the minimum.
  let minLiveHp = totalHp;
  while (st.combat && !st.combat.over && rounds < 50) {
    st = combatRound(st, 'attack').state;
    rounds++;
    const live = st.party.reduce((a, c) => a + Math.max(0, c.hp), 0);
    if (live < minLiveHp) minLiveHp = live;
  }
  const win = st.combat?.result === 'win';
  const wiped = !st.party.some(c => c.alive);
  const lossFrac = Math.max(0, Math.min(1, 1 - minLiveHp / totalHp));
  return { rounds, lossFrac, win, wiped };
}

interface Agg { medRounds: number; oneShotShare: number; winRate: number; wipeRate: number; avgLoss: number; }
function sim(party: () => Character[], danger: number, boss = false, n = 300): Agg {
  const rounds: number[] = [];
  let wins = 0, wipes = 0, oneShot = 0, lossSum = 0;
  for (let i = 0; i < n; i++) {
    const o = runFight(party(), danger, `bal-${danger}-${boss}-${i}`, boss);
    rounds.push(o.rounds);
    if (o.win) wins++;
    if (o.wiped) wipes++;
    if (o.rounds <= 1) oneShot++;
    lossSum += o.lossFrac;
  }
  rounds.sort((a, b) => a - b);
  return {
    medRounds: rounds[Math.floor(rounds.length / 2)],
    oneShotShare: oneShot / n,
    winRate: wins / n,
    wipeRate: wipes / n,
    avgLoss: lossSum / n,
  };
}

function report(label: string, a: Agg) {
  console.log(`  · ${label}: medRounds=${a.medRounds} 1-shot=${(a.oneShotShare * 100).toFixed(0)}% win=${(a.winRate * 100).toFixed(0)}% wipe=${(a.wipeRate * 100).toFixed(0)}% avgLoss=${(a.avgLoss * 100).toFixed(0)}%`);
}

console.log('balance — level-appropriate fights are multi-round and cost HP:');
{
  // Early: lone hero, low danger. Should win comfortably but not in one volley.
  const early = sim(() => [member('warrior', 1, 0)], 1);
  report('solo warrior L1 @danger1', early);
  ok(early.medRounds >= 2, 'early fight lasts 2+ rounds (no instant clear)');
  ok(early.oneShotShare < 0.35, 'early fight rarely a one-shot');
  ok(early.winRate > 0.75, 'early fight usually won');
  ok(early.avgLoss > 0.08, 'early fight costs real HP');
}
{
  // Mid: a built trio at moderate danger.
  const mid = sim(() => [member('warrior', 3, 0), member('ranger', 3, 1), member('mage', 3, 2)], 2);
  report('trio L3 @danger2', mid);
  ok(mid.medRounds >= 2 && mid.medRounds <= 6, 'mid fight is 2-6 rounds');
  ok(mid.oneShotShare < 0.25, 'mid fight rarely a one-shot');
  ok(mid.winRate > 0.7, 'mid fight usually won');
  ok(mid.avgLoss > 0.1, 'mid fight costs meaningful HP');
}
{
  // Late: a full band at the deepest danger.
  const late = sim(() => [member('warrior', 6, 0), member('ranger', 6, 1), member('mage', 6, 2), member('cleric', 6, 3)], 3);
  report('full band L6 @danger3', late);
  ok(late.medRounds >= 2 && late.medRounds <= 7, 'late fight is 2-7 rounds');
  ok(late.oneShotShare < 0.2, 'late fight rarely a one-shot');
  ok(late.winRate > 0.65, 'late fight usually won');
}

console.log('balance — danger and under-leveling actually threaten the party:');
{
  // A lone, low-level hero rushing a danger-3 pack should be in real trouble.
  const reckless = sim(() => [member('warrior', 1, 0)], 3);
  report('solo warrior L1 @danger3 (reckless)', reckless);
  ok(reckless.wipeRate > 0.1, 'reckless under-leveled push wipes a real fraction of the time');
  ok(reckless.avgLoss > 0.4, 'reckless push bleeds the party hard');
}

console.log('balance — boss is a slog, not a speed-bump:');
{
  const boss = sim(() => [member('warrior', 5, 0), member('ranger', 5, 1), member('mage', 5, 2), member('cleric', 5, 3)], 3, true, 200);
  report('band L5 vs boss @danger3', boss);
  ok(boss.medRounds >= 5, 'boss fight drags 5+ rounds');
  ok(boss.winRate > 0.5, 'boss fight is winnable for a leveled band');
}

console.log('balance — foe HP tracks party offence (no one-shot at scale):');
{
  // The core invariant: a much stronger party meets proportionally sturdier foes,
  // so the fight length stays bounded instead of collapsing to 1 round.
  const weak = sim(() => [member('warrior', 1, 0)], 2, false, 200);
  const strong = sim(() => [member('warrior', 8, 0)], 2, false, 200);
  report('solo L1 @danger2', weak);
  report('solo L8 @danger2', strong);
  ok(strong.oneShotShare < 0.35, 'an over-leveled solo still does NOT one-shot a scaled foe');
  ok(Math.abs(strong.medRounds - weak.medRounds) <= 2, 'fight length stays bounded across an 8-level gap');
}

console.log(failures === 0 ? '\nALL COMBAT-BALANCE TESTS PASSED' : `\n${failures} COMBAT-BALANCE TEST(S) FAILED`);
process.exit(failures === 0 ? 1 - 1 : 1);
