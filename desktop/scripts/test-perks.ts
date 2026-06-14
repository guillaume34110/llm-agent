// Perks regression — Lot 3 of the Curious-Expedition fusion (CE2's one-reward-per-
// expedition + fame-gated unlocks). A VICTORY lets the lodge offer the perks your
// Renown has unlocked that you don't own yet; you keep one. Owned perks fold a small,
// bounded bonus into every future run's starting kit. Every number is client-owned
// (state.ts), the claim is idempotent per run, and the LLM authors nothing here.
//
// Run: npx tsx scripts/test-perks.ts
import {
  buildWorld, loadHub, clearHub,
  renownTier, perkEffects, perkOffer, perkRunId, canClaimPerk, claimPerk,
  PERKS, PERK_IDS,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
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
    heroes: [{ className: 'Knight', blurb: 'b' }, { className: 'Scout', blurb: 'b' }, { className: 'Sage', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}
// Force the persisted perk set directly (bypass the claim flow) for isolation.
function setPerks(perks: string[]) {
  const hub = loadHub();
  hub.perks = perks;
  localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
}

// ── Catalogue sanity: every perk is renown-gated and touches one bounded axis ──
console.log('catalogue:');
{
  ok(PERK_IDS.length === Object.keys(PERKS).length && PERK_IDS.length >= 6, 'PERK_IDS mirrors the catalogue (≥6 perks)');
  ok(PERK_IDS.every(id => PERKS[id].renown >= 0), 'every perk has a renown gate');
  ok(PERK_IDS.every(id => { const e = PERKS[id].effect; return (e.gold || 0) + (e.potions || 0) + (e.scout || 0) + (e.hp || 0) > 0; }), 'every perk grants something');
  // there exist perks gated above Novice (so renown actually unlocks content)
  ok(PERK_IDS.some(id => PERKS[id].renown >= 1), 'some perks are locked behind higher renown');
}

// ── perkEffects: sums owned perks, bounded by the caps ─────────────────────────
console.log('\neffects aggregation:');
{
  ok(perkEffects([]).gold === 0 && perkEffects([]).potions === 0 && perkEffects([]).scout === 0 && perkEffects([]).hp === 0, 'no perks → zero bonus');
  // two gold perks stack
  const g = perkEffects(['prospector', 'treasurer']);   // 25 + 50
  ok(g.gold === 75, 'gold perks stack (25 + 50 = 75)');
  // unknown ids are ignored
  ok(perkEffects(['prospector', 'bogus']).gold === 25, 'unknown perk ids are ignored');
  // the aggregate is capped (own every perk → each axis clamps to its cap)
  const all = perkEffects(PERK_IDS);
  ok(all.gold <= 150 && all.potions <= 4 && all.scout <= 3 && all.hp <= 12, 'owning every perk clamps each axis to its cap');
  // a single perk is a single axis (no cross-bleed)
  const c = perkEffects(['cartographer']);
  ok(c.scout === 1 && c.gold === 0 && c.potions === 0 && c.hp === 0, 'a survey perk touches only the scout axis');
}

// ── perkOffer: renown-gated, excludes owned, sorted by gate ────────────────────
console.log('\noffer gating:');
{
  clearHub();
  // at fame 0 (Novice, tier 0) only the renown-0 perks are offered
  const off0 = perkOffer(loadHub(), 0);
  ok(off0.length > 0 && off0.every(p => p.renown === 0), 'at Novice only renown-0 perks are offered');
  // a higher renown unlocks more
  const offHi = perkOffer(loadHub(), 9999);
  ok(offHi.length > off0.length, 'higher renown unlocks more perks');
  ok(offHi.length === PERK_IDS.length, 'with nothing owned, max renown offers the whole catalogue');
  // sorted by gate ascending
  let sorted = true; for (let i = 1; i < offHi.length; i++) if (offHi[i].renown < offHi[i - 1].renown) sorted = false;
  ok(sorted, 'offers are sorted by renown gate ascending');
  // owned perks drop out of the offer
  setPerks(off0.map(p => p.id));
  const offAfter = perkOffer(loadHub(), 0);
  ok(offAfter.length === 0, 'owned perks are no longer offered');
}

// ── claimPerk: one per run, atomic, renown-checked ────────────────────────────
console.log('\nclaim flow:');
{
  clearHub();
  const runId = 'run:1:0:victory';
  const offer = perkOffer(loadHub(), 0);
  const first = offer[0].id;
  ok(canClaimPerk(loadHub(), runId), 'a fresh run can claim a perk');

  let r = claimPerk(runId, first, 0);
  ok(r.ok && r.hub.perks.includes(first), 'claiming a valid perk adds it to the hub');
  ok(r.hub.perkRuns.includes(runId), 'the run id is recorded so it cannot pay out twice');
  ok(!canClaimPerk(r.hub, runId), 'that run can no longer claim');

  // a second claim on the same run is rejected (idempotent guard)
  const second = perkOffer(loadHub(), 0).find(p => p.id !== first);
  if (second) {
    r = claimPerk(runId, second.id, 0);
    ok(!r.ok && r.reason === 'already_claimed', 'a second claim on the same run is rejected');
    ok(!loadHub().perks.includes(second.id), 'nothing is granted on the rejected claim');
  } else {
    ok(true, '(only one renown-0 perk free — skipping double-claim variant)');
  }

  // can't claim a perk above your renown
  clearHub();
  const locked = PERK_IDS.map(id => PERKS[id]).find(p => p.renown >= 1)!;
  r = claimPerk('run:2:0:victory', locked.id, 0);   // fame 0 → renown tier 0
  ok(!r.ok && r.reason === 'rank_locked', 'a perk above your renown cannot be claimed');

  // can't claim an unknown perk
  r = claimPerk('run:3:0:victory', 'bogus', 9999);
  ok(!r.ok && r.reason === 'unknown_perk', 'an unknown perk id is rejected');

  // can't claim one already owned (on a different run)
  clearHub();
  claimPerk('run:4:0:victory', first, 0);
  r = claimPerk('run:5:0:victory', first, 0);
  ok(!r.ok && r.reason === 'owned', 'a perk already owned is rejected on a new run');
}

// ── perkRunId mirrors the logbook/return scheme (victory only) ─────────────────
console.log('\nrun id scheme:');
{
  const s = { seed: 42, ngPlus: 3 } as RpgState;
  ok(perkRunId(s) === 'run:42:3:victory', 'perkRunId keys on seed + ngPlus + victory');
}

// ── Perks are actually folded into the built world ────────────────────────────
console.log('\neffects applied at world-build:');
{
  const base = buildWorld(fakeSetup(), 'w', 0);                              // no perks
  const gold = buildWorld(fakeSetup(), 'w', 0, 'medium', 'normal', undefined, undefined, ['prospector']);
  ok(base.gold === 0 && gold.gold === 25, 'a gold perk stakes starting gold (0 → 25)');

  const pot = buildWorld(fakeSetup(), 'w', 0, 'medium', 'normal', undefined, undefined, ['alchemist']);
  ok(pot.inventory.filter(i => i.kind === 'potion').length === 2, 'a draught perk seeds 2 warding draughts');

  const hp = buildWorld(fakeSetup(), 'w', 0, 'medium', 'normal', undefined, undefined, ['ironhide']);
  ok(hp.party[0].maxHp === base.party[0].maxHp + 6 && hp.party[0].hp === hp.party[0].maxHp, 'an HP perk raises the lead explorer\'s max HP (+6), fully healed');

  const baseSeen = base.order.filter(id => base.nodes[id].discovered).length;
  const scout = buildWorld(fakeSetup(), 'w', 0, 'medium', 'normal', undefined, undefined, ['pathwise']);
  const scoutSeen = scout.order.filter(id => scout.nodes[id].discovered).length;
  ok(scoutSeen > baseSeen, `a survey perk reveals extra sites (${baseSeen} → ${scoutSeen})`);

  // perks + a sponsor boon stack on the same starting kit
  const both = buildWorld(fakeSetup(), 'w', 0, 'medium', 'normal', undefined, { id: 'armorers', tier: 0 }, ['prospector']);
  ok(both.gold === 15 + 25, 'a sponsor boon and a perk stack (15 + 25 = 40 gold)');
}

// ── persistence: fresh hub has the new fields; pre-lot-3 blobs backfill ────────
console.log('\npersistence:');
{
  clearHub();
  const h = loadHub();
  ok(Array.isArray(h.perks) && h.perks.length === 0 && Array.isArray(h.perkRuns) && h.perkRuns.length === 0, 'a fresh hub has empty perks + perkRuns');
  // a pre-lot-3 blob (no perk fields) backfills to empty
  localStorage.setItem('monkey.rpg.hub', JSON.stringify({ funds: 7, tickets: 2, expeditions: 3, victories: 2, bestNgPlus: 1, banked: [], sponsorXp: {}, outfits: {} }));
  const h2 = loadHub();
  ok(h2.funds === 7 && h2.perks.length === 0 && h2.perkRuns.length === 0, 'a pre-lot-3 hub blob backfills perks + perkRuns to empty');
  // a tampered perks array drops non-string / unknown ids
  localStorage.setItem('monkey.rpg.hub', JSON.stringify({ perks: ['prospector', 42, 'bogus', 'ironhide'], perkRuns: ['r1', 5] }));
  const h3 = loadHub();
  ok(h3.perks.length === 2 && h3.perks.includes('prospector') && h3.perks.includes('ironhide'), 'unknown / non-string perk ids are dropped on load');
  ok(h3.perkRuns.length === 1 && h3.perkRuns[0] === 'r1', 'non-string perkRun ids are dropped on load');
}

if (failures) {
  console.error(`\nPERKS: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPERKS: all good ✓');
