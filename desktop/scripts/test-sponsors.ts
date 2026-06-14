// Sponsors + lodge shop regression — Lot 2 of the Curious-Expedition fusion (the
// CE2 explorer-club outer loop). Three fixed clubs back your runs: picking one
// folds its boon into the starting kit (scaling with the outfitting tier you bought
// in the lodge), and running its expeditions earns that club's rank xp, which GATES
// the shop. Every number is client-owned (state.ts) and every spend/award is
// idempotent or atomic. The LLM only ever themes a club's NAME.
//
// Run: npx tsx scripts/test-sponsors.ts
import {
  buildWorld, recordReturn, loadHub, clearHub,
  sponsorRank, sponsorBoon, sponsorOffer, buySponsorUpgrade,
  SPONSOR_IDS, SPONSOR_OUTFIT_MAX, SPONSORS,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState } from '../src/game/rpg/types';
import type { SponsorId } from '../src/game/rpg/types';

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
// Grant a club xp directly (bypass runs) so we can test rank-gating in isolation.
function setXp(id: SponsorId, xp: number) {
  const hub = loadHub();
  hub.sponsorXp[id] = xp;
  localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
}

// ── Rank ladder: 1-based tiers at the right thresholds, monotonic, capped name ──
console.log('rank ladder:');
{
  ok(sponsorRank(0).tier === 1 && sponsorRank(0).name === 'Associate', 'xp 0 → Associate (tier 1)');
  ok(sponsorRank(59).tier === 1, 'just under a rung stays put');
  ok(sponsorRank(60).tier === 2 && sponsorRank(60).name === 'Member', 'crossing 60 → Member (tier 2)');
  ok(sponsorRank(1400).tier === 6 && sponsorRank(1400).name === 'Luminary', 'top rank Luminary at 1400');
  ok(sponsorRank(1400).next === null, 'top rank has no next threshold');
  ok(sponsorRank(0).next === 60, 'next threshold surfaced below the top');
  let prev = 0, mono = true;
  for (let x = 0; x <= 3000; x += 23) { const t = sponsorRank(x).tier; if (t < prev) mono = false; prev = t; }
  ok(mono, 'tier never decreases as xp rises');
}

// ── Boon scaling: each archetype boons its own axis, base + per-tier step ──────
console.log('\nboon scaling:');
{
  ok(sponsorBoon('armorers', 0).gold === 15 && sponsorBoon('armorers', 2).gold === 55, 'armorers gold = 15 + 20·tier');
  ok(sponsorBoon('mystics', 0).potions === 1 && sponsorBoon('mystics', 3).potions === 4, 'mystics draughts = 1 + tier');
  ok(sponsorBoon('pathfinders', 0).scout === 1 && sponsorBoon('pathfinders', 4).scout === 5, 'pathfinders survey = 1 + tier');
  // each boon touches exactly one axis (no cross-bleed)
  const a = sponsorBoon('armorers', 4);
  ok(a.potions === 0 && a.scout === 0, 'armorers boon is gold only');
  // tier clamps to the max
  ok(sponsorBoon('mystics', 99).potions === sponsorBoon('mystics', SPONSOR_OUTFIT_MAX).potions, 'tier clamps to SPONSOR_OUTFIT_MAX');
}

// ── Shop offer + buy: rank-gated, funds/tickets deducted, atomic, then maxed ───
console.log('\nshop buy gating:');
{
  clearHub();
  // tier 1 costs 50 funds and needs rank ≥ 1 (Associate) — but no funds yet.
  let off = sponsorOffer(loadHub(), 'armorers');
  ok(off.nextTier === 1 && off.cost.funds === 50, 'first armorers offer is tier 1 for 50 funds');
  ok(!off.affordable, 'cannot afford tier 1 with an empty bank');
  let r = buySponsorUpgrade('armorers');
  ok(!r.ok && r.reason === 'insufficient', 'buying with no funds fails (insufficient)');

  // Fund it; tier 1 needs only rank 1 (always met). Buy succeeds, funds debited.
  let hub = loadHub(); hub.funds = 100; localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
  r = buySponsorUpgrade('armorers');
  ok(r.ok && r.hub.outfits.armorers === 1, 'tier 1 bought, outfit tier bumped to 1');
  ok(r.hub.funds === 50, 'funds debited by 50 (100 → 50)');

  // tier 2 costs 120 (only 50 left) AND needs rank ≥ 2 (60 xp, have 0).
  off = sponsorOffer(loadHub(), 'armorers');
  ok(off.nextTier === 2 && off.rankLocked, 'tier 2 is rank-locked at rank 1');
  r = buySponsorUpgrade('armorers');
  ok(!r.ok && r.reason === 'rank_locked', 'buying a rank-locked tier fails (rank_locked)');

  // Raise rank to 2 and bank enough funds → tier 2 buyable.
  setXp('armorers', 60);
  hub = loadHub(); hub.funds = 200; localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
  r = buySponsorUpgrade('armorers');
  ok(r.ok && r.hub.outfits.armorers === 2 && r.hub.funds === 80, 'tier 2 bought once rank + funds suffice (200 − 120)');
}

// ── Premium top tier costs Tickets, not Funds ─────────────────────────────────
console.log('\npremium (tickets) tier:');
{
  clearHub();
  setXp('mystics', 1400);                 // max rank so nothing is rank-locked
  let hub = loadHub(); hub.funds = 9999; hub.outfits.mystics = 3; // sitting at tier 3
  localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
  const off = sponsorOffer(loadHub(), 'mystics');
  ok(off.nextTier === SPONSOR_OUTFIT_MAX && off.cost.tickets === 2 && off.cost.funds === undefined, 'top tier is a 2-ticket premium');
  ok(!off.affordable, 'cannot buy the premium with 0 tickets even when rich in funds');
  let r = buySponsorUpgrade('mystics');
  ok(!r.ok && r.reason === 'insufficient', 'premium needs tickets, not funds');
  hub = loadHub(); hub.tickets = 3; localStorage.setItem('monkey.rpg.hub', JSON.stringify(hub));
  r = buySponsorUpgrade('mystics');
  ok(r.ok && r.hub.outfits.mystics === SPONSOR_OUTFIT_MAX && r.hub.tickets === 1, 'premium bought with tickets (3 − 2)');
  // now maxed
  const off2 = sponsorOffer(loadHub(), 'mystics');
  ok(off2.nextTier === null, 'a maxed club offers nothing further');
  r = buySponsorUpgrade('mystics');
  ok(!r.ok && r.reason === 'maxed', 'buying past the max fails (maxed)');
}

// ── The boon is actually folded into the built world ──────────────────────────
console.log('\nboon applied at world-build:');
{
  const gold = buildWorld(fakeSetup(), 'g', 0, 'medium', 'normal', undefined, { id: 'armorers', tier: 2 });
  ok(gold.gold === 55, 'an armorers-2 run starts with the staked gold (55)');
  ok(gold.sponsor?.id === 'armorers', 'the run is tagged with its sponsor');

  const myst = buildWorld(fakeSetup(), 'm', 0, 'medium', 'normal', undefined, { id: 'mystics', tier: 1 });
  ok(myst.inventory.filter(i => i.kind === 'potion').length === 2, 'a mystics-1 run starts with 2 warding draughts');

  const path0 = buildWorld(fakeSetup(), 'p', 0, 'medium', 'normal');                       // unsponsored
  const path = buildWorld(fakeSetup(), 'p', 0, 'medium', 'normal', undefined, { id: 'pathfinders', tier: 2 });
  const seen0 = path0.order.filter(id => path0.nodes[id].discovered).length;
  const seen = path.order.filter(id => path.nodes[id].discovered).length;
  ok(seen > seen0, `pathfinders survey reveals extra sites at the outset (${seen0} → ${seen})`);
  ok(path.sponsor?.id === 'pathfinders', 'the survey run is tagged pathfinders');

  // An unsponsored run is unchanged (gold 0, empty satchel, no tag).
  ok(path0.gold === 0 && path0.inventory.length === 0 && path0.sponsor === undefined, 'an unsponsored run gets no boon and no tag');

  // A themed name overrides the default; a blank one falls back.
  const themed = buildWorld(fakeSetup(), 't', 0, 'medium', 'normal', undefined, { id: 'armorers', tier: 0, name: 'The Brass Syndicate' });
  ok(themed.sponsor?.name === 'The Brass Syndicate', 'a themed sponsor name is carried');
  ok(buildWorld(fakeSetup(), 't', 0, 'medium', 'normal', undefined, { id: 'armorers', tier: 0, name: '  ' }).sponsor?.name === SPONSORS.armorers.name, 'a blank themed name falls back to the default');
}

// ── recordReturn credits the backing club's rank xp, idempotently ─────────────
console.log('\nreturn credits club xp:');
{
  clearHub();
  const win = buildWorld(fakeSetup(), 'w1', 0, 'medium', 'normal', undefined, { id: 'pathfinders', tier: 0 });
  win.gold = 100;
  const h1 = recordReturn(win, 'victory');         // 40 (win) + 10 (gold/10) + 0 (ng) = 50
  ok(h1.sponsorXp.pathfinders === 50, 'a sponsored win credits xp (40 + gold/10)');
  ok(h1.sponsorXp.armorers === 0 && h1.sponsorXp.mystics === 0, 'only the backing club is credited');
  const h1b = recordReturn(win, 'victory');        // same run id → no double-credit
  ok(h1b.sponsorXp.pathfinders === 50, 'a re-bank of the same run credits no extra xp');

  // A different (defeat) outcome of the same world is a distinct, bankable event.
  const h2 = recordReturn(win, 'defeat');          // 10 (defeat) + 10 (gold) = 20
  ok(h2.sponsorXp.pathfinders === 70, 'a distinct outcome credits again (50 + 20)');

  // An unsponsored run credits no club.
  clearHub();
  const un = buildWorld(fakeSetup(), 'u1', 0, 'medium', 'normal');
  un.gold = 50;
  const hu = recordReturn(un, 'victory');
  ok(hu.sponsorXp.pathfinders === 0 && hu.sponsorXp.armorers === 0 && hu.sponsorXp.mystics === 0, 'an unsponsored run credits no club');
  ok(hu.funds === 50, 'but its gold still banks into funds');
}

// ── persistence round-trips the new maps; old blobs default cleanly ───────────
console.log('\npersistence:');
{
  clearHub();
  ok(SPONSOR_IDS.every(id => loadHub().sponsorXp[id] === 0 && loadHub().outfits[id] === 0), 'fresh hub zeroes every club');
  // an old blob without the sponsor maps loads with zeroed defaults
  localStorage.setItem('monkey.rpg.hub', JSON.stringify({ funds: 5, tickets: 1, expeditions: 2, victories: 1, bestNgPlus: 0, banked: [] }));
  const h = loadHub();
  ok(h.funds === 5 && SPONSOR_IDS.every(id => h.sponsorXp[id] === 0 && h.outfits[id] === 0), 'a pre-lot-2 hub blob backfills sponsor maps to zero');
}

if (failures) {
  console.error(`\nSPONSORS: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nSPONSORS: all good ✓');
