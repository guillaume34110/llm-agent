// Commissions regression — Lots 4 & 5 of the Curious-Expedition fusion (CE2's job
// board + overarching story acts + lodge standing). Between runs the lodge posts
// procedural commissions; accepting one and meeting it on your NEXT victory pays
// Funds/Tickets/Standing, raises your Standing rank (which unlocks harder boards),
// and advances a semi-endless run of story acts. Every number is client-owned
// (state.ts), generation is deterministic & offline, settlement is idempotent per
// run, and the LLM authors nothing here.
//
// Run: npx tsx scripts/test-contracts.ts
import {
  loadHub, clearHub,
  standingTier, storyAct, contractBoard, contractCondText, contractMet,
  acceptContract, abandonContract, refreshBoard, settleContract,
  type Contract,
} from '../src/game/rpg/state';
import type { RpgState } from '../src/game/rpg/types';

// localStorage shim (node has none).
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();
const HUB_KEY = 'monkey.rpg.hub';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// A minimal finished run, enough for contractMet/settleContract.
function makeState(opts: Partial<{
  seed: number; ngPlus: number; gold: number; allAlive: boolean;
  sponsor: string; kinds: string[];
}> = {}): RpgState {
  const kinds = opts.kinds ?? ['village', 'town', 'wild'];
  const order = kinds.map((_, i) => `n${i}`);
  const nodes: Record<string, { kind: string }> = {};
  order.forEach((id, i) => { nodes[id] = { kind: kinds[i] }; });
  const allAlive = opts.allAlive ?? true;
  return {
    seed: opts.seed ?? 100,
    ngPlus: opts.ngPlus ?? 0,
    gold: opts.gold ?? 0,
    party: [{ alive: allAlive }, { alive: true }],
    sponsor: opts.sponsor ? { id: opts.sponsor } : undefined,
    order, nodes,
  } as unknown as RpgState;
}
// Force the persisted hub (bypass run flow) for isolation.
function setHub(patch: Record<string, unknown>) {
  const hub = loadHub();
  localStorage.setItem(HUB_KEY, JSON.stringify({ ...hub, ...patch }));
}

// ── Standing ladder: tiers climb, names, thresholds, caps at 5 ─────────────────
console.log('standing ladder:');
{
  clearHub();
  ok(standingTier(0).tier === 1 && standingTier(0).name === 'Unproven', 'standing 0 → tier 1 Unproven');
  ok(standingTier(4).tier === 2 && standingTier(0).next === 4, 'standing 4 → tier 2, next rung from 0 is 4');
  ok(standingTier(10).tier === 3 && standingTier(20).tier === 4 && standingTier(36).tier === 5, 'thresholds 10/20/36 → tiers 3/4/5');
  ok(standingTier(9999).tier === 5 && standingTier(9999).next === null, 'standing caps at tier 5 (no next)');
  let mono = true; let prev = 0; for (let s = 0; s <= 50; s++) { const t = standingTier(s).tier; if (t < prev) mono = false; prev = t; }
  ok(mono, 'tier is monotone non-decreasing in standing');
}

// ── Story acts: advance every 3 commissions, named then semi-endless ───────────
console.log('\nstory acts:');
{
  ok(storyAct(0).act === 1 && storyAct(0).name === 'The Opening Road', 'fresh save → Act 1 The Opening Road');
  ok(storyAct(2).act === 1 && storyAct(3).act === 2, 'act advances every 3 commissions (3 → Act 2)');
  ok(storyAct(0).into === 0 && storyAct(0).next === 3 && storyAct(4).into === 1, 'within-act progress + next threshold are reported');
  ok(storyAct(12).act === 5 && storyAct(12).name === 'Legends in the Making', '12 → Act 5 (last named)');
  ok(storyAct(15).act === 6 && storyAct(15).name === 'Act 6', 'past the named acts it keeps numbering (semi-endless)');
  let mono = true; let prev = 0; for (let n = 0; n <= 40; n++) { const a = storyAct(n).act; if (a < prev) mono = false; prev = a; }
  ok(mono, 'act number never goes backward');
}

// ── Board generation: deterministic, 3 slots, tier-bounded, refresh re-rolls ───
console.log('\nboard generation:');
{
  clearHub();
  const b1 = contractBoard(loadHub());
  const b2 = contractBoard(loadHub());
  ok(b1.length === 3, 'the board posts three commissions');
  ok(JSON.stringify(b1) === JSON.stringify(b2), 'the same hub yields the same board (deterministic)');
  ok(b1[0].tier === 1, 'slot 0 is always an accessible tier-1 commission');
  ok(b1.every(c => c.tier >= 1 && c.tier <= standingTier(loadHub().standing).tier), 'every commission is within the standing tier cap');
  ok(b1.every(c => !!c.name && !!c.blurb && !!contractCondText(c.cond)), 'every commission has a name, blurb and readable condition');
  ok(b1.every(c => c.reward.funds > 0 && c.reward.standing >= 1), 'every commission pays funds + standing');
  // a higher standing widens the tier range
  setHub({ standing: 36 });
  const hi = contractBoard(loadHub());
  ok(hi.some(c => c.tier > 1), 'a high standing posts commissions above tier 1');
  // refresh re-rolls the board (bumps the seed)
  clearHub();
  const before = contractBoard(loadHub());
  refreshBoard();
  const after = contractBoard(loadHub());
  ok(JSON.stringify(before) !== JSON.stringify(after), 'refreshing the board posts a different set');
}

// ── Accept / abandon: one active at a time, snapshotted ────────────────────────
console.log('\naccept / abandon:');
{
  clearHub();
  const board = contractBoard(loadHub());
  const r = acceptContract(board[1].id);
  ok(r.ok && r.hub.activeContract?.id === board[1].id, 'accepting a commission makes it active');
  // a second accept while one is active is rejected
  const r2 = acceptContract(board[0].id);
  ok(!r2.ok && r2.reason === 'already_active', 'cannot accept a second commission while one is active');
  ok(loadHub().activeContract?.id === board[1].id, 'the original commission stays active after a rejected accept');
  // accepting an id not on the board fails
  abandonContract();
  const r3 = acceptContract('c:999:9');
  ok(!r3.ok && r3.reason === 'not_found', 'an off-board id cannot be accepted');
  // abandon clears it
  acceptContract(board[0].id);
  ok(!!loadHub().activeContract, 'a commission is active before abandon');
  const h = abandonContract();
  ok(h.activeContract === null && loadHub().activeContract === null, 'abandon clears the active commission');
  // the snapshot survives a board re-roll
  acceptContract(contractBoard(loadHub())[0].id);
  const snap = loadHub().activeContract!;
  refreshBoard();
  ok(JSON.stringify(loadHub().activeContract) === JSON.stringify(snap), 'an accepted commission is a snapshot — a board re-roll cannot change the deal');
}

// ── contractMet: each condition kind checked against a finished run ─────────────
console.log('\ncondition checks:');
{
  const c = (cond: Contract['cond']): Contract => ({ id: 'x', name: 'n', blurb: 'b', cond, reward: { funds: 1, tickets: 0, standing: 1 }, tier: 1 });
  ok(contractMet(c({ k: 'win' }), makeState()), 'win: any victory satisfies it');
  ok(contractMet(c({ k: 'ngplus', n: 2 }), makeState({ ngPlus: 3 })) && !contractMet(c({ k: 'ngplus', n: 2 }), makeState({ ngPlus: 1 })), 'ngplus: needs the run at/over the depth');
  ok(contractMet(c({ k: 'gold', n: 100 }), makeState({ gold: 120 })) && !contractMet(c({ k: 'gold', n: 100 }), makeState({ gold: 80 })), 'gold: needs the final purse over the threshold');
  ok(contractMet(c({ k: 'flawless' }), makeState({ allAlive: true })) && !contractMet(c({ k: 'flawless' }), makeState({ allAlive: false })), 'flawless: needs the whole party alive');
  ok(contractMet(c({ k: 'sponsored', id: 'armorers' }), makeState({ sponsor: 'armorers' })) && !contractMet(c({ k: 'sponsored', id: 'armorers' }), makeState({ sponsor: 'mystics' })), 'sponsored: needs the run backed by that club');
  ok(contractMet(c({ k: 'biome', kind: 'ruin' }), makeState({ kinds: ['village', 'ruin'] })) && !contractMet(c({ k: 'biome', kind: 'ruin' }), makeState({ kinds: ['village', 'town'] })), 'biome: needs the run to cross that terrain');
}

// ── settleContract: pays out, advances story, idempotent, win-only ─────────────
console.log('\nsettlement:');
{
  clearHub();
  // accept a win-condition commission so any victory settles it
  const winC: Contract = { id: 'c:1:0', name: 'Bring It Home', blurb: 'b', cond: { k: 'win' }, reward: { funds: 55, tickets: 1, standing: 1 }, tier: 1 };
  setHub({ activeContract: winC, funds: 10, tickets: 0, standing: 0, contractsFulfilled: 0, boardSeed: 1 });
  const state = makeState({ seed: 7, ngPlus: 0 });
  const r = settleContract(state, 'victory');
  ok(r.settled && r.contract?.id === 'c:1:0', 'a met commission settles on victory');
  const h = loadHub();
  ok(h.funds === 65 && h.tickets === 1 && h.standing === 1, 'the reward is banked (funds +55, tickets +1, standing +1)');
  ok(h.contractsFulfilled === 1 && h.activeContract === null, 'the commission is cleared and the lifetime counter ticks');
  ok(h.boardSeed === 2, 'a fresh board is rolled after fulfilment');
  // idempotent: settling the same run+contract again pays nothing
  setHub({ activeContract: winC });   // pretend it somehow re-appears
  const r2 = settleContract(state, 'victory');
  ok(!r2.settled && loadHub().funds === 65, 'settling the same run+commission twice pays nothing (idempotent)');

  // a defeat never settles
  clearHub();
  setHub({ activeContract: winC, funds: 0 });
  const rd = settleContract(makeState({ seed: 8 }), 'defeat');
  ok(!rd.settled && loadHub().funds === 0 && loadHub().activeContract !== null, 'a defeat does not settle the commission');

  // an unmet condition does not settle
  clearHub();
  const goldC: Contract = { id: 'c:2:0', name: 'Rich', blurb: 'b', cond: { k: 'gold', n: 500 }, reward: { funds: 99, tickets: 0, standing: 3 }, tier: 3 };
  setHub({ activeContract: goldC, funds: 0 });
  const ru = settleContract(makeState({ seed: 9, gold: 100 }), 'victory');
  ok(!ru.settled && loadHub().funds === 0 && loadHub().activeContract !== null, 'a victory that misses the condition does not settle');

  // act advance is reported across a settle
  clearHub();
  setHub({ activeContract: winC, contractsFulfilled: 2 });   // this fulfilment is the 3rd → Act 2
  const ra = settleContract(makeState({ seed: 11 }), 'victory');
  ok(ra.settled && ra.actBefore === 1 && ra.actAfter === 2, 'settlement reports the act turning (Act 1 → Act 2 on the 3rd commission)');
}

// ── persistence: fresh hub has the new fields; old blobs backfill; tamper-safe ──
console.log('\npersistence:');
{
  clearHub();
  const h = loadHub();
  ok(h.standing === 0 && h.contractsFulfilled === 0 && h.boardSeed === 1 && h.activeContract === null && Array.isArray(h.contractRuns), 'a fresh hub has the lot-4/5 fields defaulted');
  // a pre-lot-4 blob backfills
  localStorage.setItem(HUB_KEY, JSON.stringify({ funds: 5, tickets: 1, expeditions: 2, victories: 1, bestNgPlus: 0, banked: [], sponsorXp: {}, outfits: {}, perks: [], perkRuns: [] }));
  const h2 = loadHub();
  ok(h2.funds === 5 && h2.standing === 0 && h2.activeContract === null && h2.boardSeed === 1, 'a pre-lot-4 hub blob backfills standing/board/contract fields');
  // a tampered activeContract is dropped
  localStorage.setItem(HUB_KEY, JSON.stringify({ activeContract: { id: 'x', name: 'n', blurb: 'b', cond: { k: 'bogus' }, reward: {}, tier: 1 } }));
  ok(loadHub().activeContract === null, 'an activeContract with an unknown condition is dropped on load');
  // a valid persisted activeContract round-trips, with reward clamped
  localStorage.setItem(HUB_KEY, JSON.stringify({ activeContract: { id: 'c:1:0', name: 'n', blurb: 'b', cond: { k: 'win' }, reward: { funds: 99999, tickets: -3, standing: 2 }, tier: 1 } }));
  const h3 = loadHub();
  ok(h3.activeContract?.id === 'c:1:0' && h3.activeContract.reward.funds === 1000 && h3.activeContract.reward.tickets === 0, 'a valid activeContract round-trips with its reward clamped');
  // tampered contractRuns drop non-strings
  localStorage.setItem(HUB_KEY, JSON.stringify({ contractRuns: ['ok', 5, null, 'ok2'] }));
  ok(loadHub().contractRuns.length === 2, 'non-string contractRun ids are dropped on load');
}

if (failures) {
  console.error(`\nCONTRACTS: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nCONTRACTS: all good ✓');
