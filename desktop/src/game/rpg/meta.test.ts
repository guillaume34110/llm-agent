import { describe, it, expect, beforeEach } from 'vitest';
import {
  renownTier, loadHub, recordReturn, clearHub,
  sponsorRank, sponsorBoon, loyaltyBoon, sponsorOffer, buySponsorUpgrade, SPONSOR_OUTFIT_MAX,
  sponsorHaulXp, SPONSORS,
  perkEffects, perkOffer, claimPerk, canClaimPerk, perkRunId, PERKS,
  startCampaign, recordChapter, campaignProgress, campaignGoalFame, loadCampaign,
  standingTier, storyAct,
  contractMet, contractProgress, contractBoard, acceptContract, abandonContract,
  refreshBoard, settleContract,
  donateToCrown, CROWN_DONATION_STEP, CROWN_FAME_PER_DONATION,
  seasonStandings, destinationBoard,
  unlockedRecruits, CLUB_RECRUITS,
  type Contract,
} from './meta';
import { rapportBonus, RAPPORT_STEP } from './rapport';
import { peopleOf, peopleById } from './peoples';
import { statProfile } from './character';
import type { RpgState, Character } from './types';

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

function ch(partial: Partial<Character> = {}): Character {
  return {
    id: 'c' + Math.random(), name: 'C', className: 'Knight', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return {
    seed: 1, ngPlus: 0, gold: 0, title: 'The Run', theme: 'jungle',
    party: [ch()], nodes: {}, order: [], inventory: [], rivals: [],
    quest: { title: 'Slay', goalNodeId: 'g', objective: 'slay' },
    ...partial,
  } as unknown as RpgState;
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('renownTier (client-owned ladder + open-ended stars)', () => {
  it('starts at Novice and climbs the named rungs', () => {
    expect(renownTier(0).name).toBe('Novice');
    expect(renownTier(0).tier).toBe(0);
    expect(renownTier(150).name).toBe('Wayfarer');
    expect(renownTier(149).name).toBe('Novice');
    expect(renownTier(6500).name).toBe('Legend');
  });
  it('clamps negatives and surfaces the next threshold below the top', () => {
    expect(renownTier(-99).name).toBe('Novice');
    expect(renownTier(0).next).toBe(150);
  });
  it('counts stars past the top rung with an always-present next star', () => {
    const a = renownTier(6500);
    expect(a.stars).toBe(0);
    const b = renownTier(6500 + 3000);
    expect(b.stars).toBe(1);
    expect(b.next).toBe(6500 + 2 * 3000);
  });
});

describe('sponsorRank (per-club xp ladder)', () => {
  it('maps xp to 1-based tiers at the fixed thresholds', () => {
    expect(sponsorRank(0).tier).toBe(1);
    expect(sponsorRank(0).name).toBe('Associate');
    expect(sponsorRank(59).tier).toBe(1);
    expect(sponsorRank(60).tier).toBe(2);
    expect(sponsorRank(1400).tier).toBe(6);
    expect(sponsorRank(1400).next).toBeNull();
  });
});

describe('sponsorBoon (bounded per-axis nudge)', () => {
  it('boons the club-specific axis and clamps tier to the cap', () => {
    expect(sponsorBoon('armorers', 0).gold).toBe(15);
    expect(sponsorBoon('armorers', 1).gold).toBe(35);
    expect(sponsorBoon('pathfinders', 2).scout).toBe(3);
    expect(sponsorBoon('mystics', 1).potions).toBe(2);
    // tier overflow clamps to SPONSOR_OUTFIT_MAX
    expect(sponsorBoon('armorers', 99).gold).toBe(sponsorBoon('armorers', SPONSOR_OUTFIT_MAX).gold);
  });
});

describe('loyaltyBoon (earned-rank dividend, club-axis, bounded)', () => {
  it('pays nothing at Associate (rank 1) — the dividend is earned, not free', () => {
    for (const id of ['pathfinders', 'armorers', 'mystics'] as const) {
      const b = loyaltyBoon(id, 1);
      expect(b.gold + b.potions + b.scout).toBe(0);
      expect(b.label).toBe('');
    }
  });
  it('deepens the SAME axis the club already boons', () => {
    expect(loyaltyBoon('armorers', 6).gold).toBe(50);      // 10 × (6-1)
    expect(loyaltyBoon('armorers', 6).potions).toBe(0);
    expect(loyaltyBoon('armorers', 6).scout).toBe(0);
    expect(loyaltyBoon('pathfinders', 6).scout).toBe(2);   // floor(5/2)
    expect(loyaltyBoon('mystics', 6).potions).toBe(2);
  });
  it('grows monotonically with rank and stays bounded at Luminary', () => {
    let prev = -1;
    for (let r = 1; r <= 6; r++) {
      const g = loyaltyBoon('armorers', r).gold;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    // out-of-range ranks clamp to the [1,6] band (no overflow past Luminary)
    expect(loyaltyBoon('armorers', 99).gold).toBe(loyaltyBoon('armorers', 6).gold);
    expect(loyaltyBoon('armorers', 0).gold).toBe(loyaltyBoon('armorers', 1).gold);
  });
});

describe('unlockedRecruits (CE2 rank-gated club stable)', () => {
  it('opens nothing below the first gate — a fresh club is access-locked', () => {
    for (const id of ['pathfinders', 'armorers', 'mystics'] as const) {
      expect(unlockedRecruits(id, 1)).toEqual([]);   // Associate sees the stable but locked
    }
  });
  it('opens the first recruit at tier 2, both by tier 4, the capstone at tier 6', () => {
    for (const id of ['pathfinders', 'armorers', 'mystics'] as const) {
      expect(unlockedRecruits(id, 2).length).toBe(1);
      expect(unlockedRecruits(id, 3).length).toBe(1);
      expect(unlockedRecruits(id, 4).length).toBe(2);
      expect(unlockedRecruits(id, 5).length).toBe(2);   // Director still waits on the capstone
      expect(unlockedRecruits(id, 6).length).toBe(3);   // Luminary opens the signature recruit
    }
  });
  it('is monotonic in rank and never exceeds the club roster', () => {
    for (const id of ['pathfinders', 'armorers', 'mystics'] as const) {
      let prev = 0;
      for (let r = 1; r <= 6; r++) {
        const n = unlockedRecruits(id, r).length;
        expect(n).toBeGreaterThanOrEqual(prev);
        expect(n).toBeLessThanOrEqual(CLUB_RECRUITS[id].length);
        prev = n;
      }
    }
  });
  it('every recruit carries a class keyword that yields a real stat profile', () => {
    for (const id of ['pathfinders', 'armorers', 'mystics'] as const) {
      for (const rec of CLUB_RECRUITS[id]) {
        expect(rec.className.length).toBeGreaterThan(0);
        expect(rec.epithet.length).toBeGreaterThan(0);
        // the class label must hit a non-default branch (a focused stat >= 5)
        const p = statProfile(rec.className);
        expect(Math.max(p.stats.might, p.stats.agility, p.stats.wits, p.stats.spirit)).toBe(5);
      }
    }
  });
  it('out-of-range rank clamps (no negative, no overflow past the roster)', () => {
    expect(unlockedRecruits('armorers', 0)).toEqual([]);
    expect(unlockedRecruits('armorers', 99).length).toBe(CLUB_RECRUITS['armorers'].length);
  });
});

describe('sponsorOffer / buySponsorUpgrade (rank + funds gating)', () => {
  it('blocks the first upgrade when funds are short even if rank ok', () => {
    const hub = loadHub();
    const offer = sponsorOffer(hub, 'armorers');
    expect(offer.nextTier).toBe(1);
    expect(offer.rankLocked).toBe(false); // tier1 needs rank>=1, default is 1
    expect(offer.affordable).toBe(false); // 0 funds < 50
    const res = buySponsorUpgrade('armorers');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('insufficient');
  });
  it('buys a tier when rank and funds allow, deducting funds atomically', () => {
    const hub = loadHub();
    localStorage.setItem('monkey.rpg.hub', JSON.stringify({ ...hub, funds: 200, sponsorXp: { pathfinders: 0, armorers: 60, mystics: 0 } }));
    const res = buySponsorUpgrade('armorers');
    expect(res.ok).toBe(true);
    expect(res.hub.outfits.armorers).toBe(1);
    expect(res.hub.funds).toBe(150);
    expect(loadHub().outfits.armorers).toBe(1); // persisted
  });
  it('blocks when club rank is below the tier', () => {
    const hub = loadHub();
    // funds enough for tier2 (120) but rank still Associate (tier1) → rank_locked for tier2
    localStorage.setItem('monkey.rpg.hub', JSON.stringify({ ...hub, funds: 999, outfits: { pathfinders: 0, armorers: 1, mystics: 0 }, sponsorXp: { pathfinders: 0, armorers: 0, mystics: 0 } }));
    const res = buySponsorUpgrade('armorers');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rank_locked');
  });
});

describe('perkEffects (aggregate cap)', () => {
  it('sums owned perks and clamps each axis to PERK_CAP', () => {
    const all = Object.keys(PERKS);
    const e = perkEffects(all);
    expect(e.gold).toBeLessThanOrEqual(150);
    expect(e.potions).toBeLessThanOrEqual(4);
    expect(e.scout).toBeLessThanOrEqual(3);
    expect(e.hp).toBeLessThanOrEqual(12);
    expect(e.standing).toBeLessThanOrEqual(8);
  });
  it('ignores unknown ids', () => {
    expect(perkEffects(['nope', 'prospector'])).toEqual({ gold: 25, potions: 0, scout: 0, hp: 0, standing: 0 });
  });
  it('sums the Good Reputation perks into a starting-standing bonus', () => {
    expect(perkEffects(['envoy']).standing).toBe(3);
    expect(perkEffects(['envoy', 'diplomat']).standing).toBe(8);  // 3 + 5, within cap
  });
});

describe('perkOffer / claimPerk (renown-gated, idempotent)', () => {
  it('offers only renown-unlocked, unowned perks', () => {
    const hub = loadHub();
    const offerLow = perkOffer(hub, 0);
    expect(offerLow.every(p => p.renown === 0)).toBe(true);
    const offerHigh = perkOffer(hub, 6500);
    expect(offerHigh.length).toBeGreaterThan(offerLow.length);
  });
  it('claimPerk is idempotent per run id and rejects locked perks', () => {
    const rid = perkRunId(state({ seed: 7 }));
    expect(canClaimPerk(loadHub(), rid)).toBe(true);
    const first = claimPerk(rid, 'prospector', 9999);
    expect(first.ok).toBe(true);
    expect(first.hub.perks).toContain('prospector');
    // same run can't claim again
    const second = claimPerk(rid, 'herbalist', 9999);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_claimed');
    // a different run can't claim a perk above its renown
    const rid2 = perkRunId(state({ seed: 8 }));
    const locked = claimPerk(rid2, 'ironhide', 0);
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe('rank_locked');
  });
});

describe('sponsorHaulXp (club rewards its favoured haul)', () => {
  it('counts only valuables of the sponsor favoured category, at 1 xp per 20 worth', () => {
    const fav = SPONSORS.armorers.favours;   // 'craftwork'
    const inv = [
      { id: 'a', kind: 'valuable', name: 'A', value: 200, trade: fav },         // 200/20 = 10
      { id: 'b', kind: 'valuable', name: 'B', value: 100, trade: 'gems' },       // not favoured
      { id: 'c', kind: 'gear', name: 'C', value: 999 },                          // not a valuable
    ];
    expect(sponsorHaulXp(state({ inventory: inv as never }), 'armorers')).toBe(10);
  });
  it('a different club earns nothing from a haul it does not favour', () => {
    const inv = [{ id: 'a', kind: 'valuable', name: 'A', value: 200, trade: SPONSORS.armorers.favours }];
    expect(sponsorHaulXp(state({ inventory: inv as never }), 'mystics')).toBe(0);
  });
  it('a wiped band brings nothing home (parity with the fame haul rule)', () => {
    const fav = SPONSORS.armorers.favours;
    const inv = [{ id: 'a', kind: 'valuable', name: 'A', value: 200, trade: fav }];
    const dead = state({ party: [ch({ alive: false })], inventory: inv as never });
    expect(sponsorHaulXp(dead, 'armorers')).toBe(0);
  });
  it('no favoured haul → no bonus', () => {
    expect(sponsorHaulXp(state({}), 'pathfinders')).toBe(0);
  });
});

describe('recordReturn (idempotent banking + tickets + sponsorXp + nemesis)', () => {
  it('banks once and is idempotent on remount', () => {
    const s = state({ seed: 3, gold: 40 });
    const a = recordReturn(s, 'victory');
    expect(a.expeditions).toBe(1);
    expect(a.victories).toBe(1);
    expect(a.funds).toBe(40);
    expect(a.tickets).toBe(1); // +1 victory
    const b = recordReturn(s, 'victory');
    expect(b.expeditions).toBe(1); // no double-bank
    expect(b.funds).toBe(40);
  });
  it('awards a ticket for a new NG+ depth', () => {
    const a = recordReturn(state({ seed: 5, ngPlus: 2 }), 'defeat');
    expect(a.tickets).toBe(1); // defeat gives no win ticket, but new depth does
    expect(a.bestNgPlus).toBe(2);
  });
  it('credits sponsor xp only for the backing club', () => {
    const s = state({ seed: 9, gold: 100, sponsor: { id: 'mystics', name: 'X' } as never });
    const hub = recordReturn(s, 'victory');
    expect(hub.sponsorXp.mystics).toBeGreaterThan(0);
    expect(hub.sponsorXp.armorers).toBe(0);
  });
  it('the backing club pays extra for the haul it favours', () => {
    const fav = SPONSORS.mystics.favours;   // 'relics'
    const inv = [{ id: 'v', kind: 'valuable', name: 'Idol', value: 200, trade: fav }];
    const plain = recordReturn(state({ seed: 21, gold: 100, sponsor: { id: 'mystics', name: 'X' } as never }), 'victory');
    clearHub();   // isolate: recordReturn is idempotent per run + accumulates into the hub
    const laden = recordReturn(state({ seed: 22, gold: 100, sponsor: { id: 'mystics', name: 'X' } as never, inventory: inv as never }), 'victory');
    expect(laden.sponsorXp.mystics).toBeGreaterThan(plain.sponsorXp.mystics);
  });
  it('mints a nemesis on a defeat where a rival arrived, clears it on a settling win', () => {
    const lost = recordReturn(state({ seed: 11, rivals: [{ name: 'Vex', glyph: '☠', arrived: true } as never] }), 'defeat');
    expect(lost.nemesis?.name).toBe('Vex');
    expect(lost.nemesis?.wins).toBe(1);
    const won = recordReturn(state({ seed: 12, rivals: [{ name: 'Vex', glyph: '☠', nemesis: true } as never] }), 'victory');
    expect(won.nemesis).toBeNull();
  });
  it('banks rapport with the world people on return, warming the next welcome', () => {
    const seed = 31;
    const pid = peopleOf(seed).id;
    expect(rapportBonus(pid)).toBe(0);
    // settlements spanning a clear goodwill spread → a persistent floor
    const nodes = {
      a: { id: 'a', reputation: 2 } as never,
      b: { id: 'b', reputation: 2 + RAPPORT_STEP * 3 } as never,
    };
    recordReturn(state({ seed, nodes: nodes as never }), 'victory');
    expect(rapportBonus(pid)).toBe(3);
  });
});

describe('loadHub coercion', () => {
  it('returns the empty hub on corrupt storage', () => {
    store.set('monkey.rpg.hub', '{garbage');
    const hub = loadHub();
    expect(hub.funds).toBe(0);
    expect(hub.perks).toEqual([]);
  });
  it('clamps a tampered sponsor map to the known ids and outfit cap', () => {
    store.set('monkey.rpg.hub', JSON.stringify({ outfits: { armorers: 99, ghost: 5 }, perks: ['prospector', 'fake'] }));
    const hub = loadHub();
    expect(hub.outfits.armorers).toBe(SPONSOR_OUTFIT_MAX);
    expect((hub.outfits as Record<string, number>).ghost).toBeUndefined();
    expect(hub.perks).toEqual(['prospector']); // unknown perk dropped
  });
  it('clearHub wipes it', () => {
    recordReturn(state({ seed: 1, gold: 99 }), 'victory');
    clearHub();
    expect(loadHub().funds).toBe(0);
  });
});

describe('campaign outer loop', () => {
  it('startCampaign locks difficulty and derives the goal', () => {
    const c = startCampaign('Warrior', 'the Bold', 'hard');
    expect(c.goalFame).toBe(campaignGoalFame('hard'));
    expect(c.chapter).toBe(1);
    expect(loadCampaign()?.leadClass).toBe('Warrior');
  });
  it('recordChapter accrues fame, advances the chapter, and is remount-safe', () => {
    let c = startCampaign('Warrior', '', 'normal');
    const s = state({ seed: 1, party: [ch({ alive: true })] });
    c = recordChapter(c, s, 'victory');
    expect(c.chapter).toBe(2);
    expect(c.fame).toBeGreaterThan(0);
    // remount before the chapter counter advanced (chronicle already tops with this
    // chapter+title+theme) → the guard no-ops, no double-bank.
    const probe = { ...c, chapter: 1 };
    const again = recordChapter(probe, s, 'victory');
    expect(again.fame).toBe(c.fame);
    expect(again.chronicle.length).toBe(c.chronicle.length);
  });
  it('a total wipe fails the campaign', () => {
    let c = startCampaign('Warrior', '', 'easy');
    c = recordChapter(c, state({ party: [ch({ alive: false })] }), 'defeat');
    expect(c.failed).toBe(true);
  });
  it('campaignProgress is clamped to 0..1', () => {
    const c = startCampaign('Warrior', '', 'normal');
    expect(campaignProgress(c)).toBe(0);
    expect(campaignProgress({ ...c, fame: c.goalFame * 2 })).toBe(1);
  });
});

describe('standingTier + storyAct', () => {
  it('maps standing to named tiers', () => {
    expect(standingTier(0).name).toBe('Unproven');
    expect(standingTier(4).name).toBe('Trusted');
    expect(standingTier(36).name).toBe('Exalted');
    expect(standingTier(36).next).toBeNull();
  });
  it('advances an act every 3 fulfilled commissions, then numbers forever', () => {
    expect(storyAct(0).act).toBe(1);
    expect(storyAct(3).act).toBe(2);
    expect(storyAct(99).name).toMatch(/^Act \d+$/);
  });
});

describe('contracts', () => {
  it('contractMet checks each condition shape', () => {
    const win: Contract = { id: 'c', name: 'n', blurb: '', cond: { k: 'win' }, reward: { funds: 1, tickets: 0, standing: 1 }, tier: 1 };
    expect(contractMet(win, state())).toBe(true);
    const gold: Contract = { ...win, cond: { k: 'gold', n: 100 } };
    expect(contractMet(gold, state({ gold: 50 }))).toBe(false);
    expect(contractMet(gold, state({ gold: 150 }))).toBe(true);
    const flawless: Contract = { ...win, cond: { k: 'flawless' } };
    expect(contractMet(flawless, state({ party: [ch({ alive: true }), ch({ alive: false })] }))).toBe(false);
    const biome: Contract = { ...win, cond: { k: 'biome', kind: 'cave' } };
    expect(contractMet(biome, state({ order: ['n1'], nodes: { n1: { kind: 'cave' } } as never }))).toBe(true);
  });
  it('contractProgress resolves a win to the live questSatisfied', () => {
    const win: Contract = { id: 'c', name: 'n', blurb: '', cond: { k: 'win' }, reward: { funds: 1, tickets: 0, standing: 1 }, tier: 1 };
    const notYet = contractProgress(win, state({ nodes: { g: { cleared: false } } as never }));
    expect(notYet.met).toBe(false);
    const done = contractProgress(win, state({ nodes: { g: { cleared: true } } as never }));
    expect(done.met).toBe(true);
  });
  it('contractBoard is deterministic for a given boardSeed', () => {
    const hub = loadHub();
    const a = contractBoard(hub).map(c => c.id);
    const b = contractBoard(hub).map(c => c.id);
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
  });
  it('accept → settle pays out once and clears, idempotent on remount', () => {
    const board = contractBoard(loadHub());
    const winnable = board.find(c => c.cond.k === 'win') || board[0];
    const acc = acceptContract(winnable.id);
    expect(acc.ok).toBe(true);
    expect(acc.hub.activeContract?.id).toBe(winnable.id);
    // settle against a victory that meets the condition
    const s = state({ seed: 50, gold: 9999, party: [ch({ alive: true })], order: ['n1'], nodes: { n1: { kind: 'cave' } } as never });
    const settled = settleContract(s, 'victory');
    if (winnable.cond.k === 'win') {
      expect(settled.settled).toBe(true);
      expect(settled.hub.activeContract).toBeNull();
      expect(settled.hub.contractsFulfilled).toBe(1);
      // remount → no double pay
      const again = settleContract(s, 'victory');
      expect(again.settled).toBe(false);
    }
  });
  it('abandonContract and refreshBoard are free and mutate the right field', () => {
    const board = contractBoard(loadHub());
    acceptContract(board[0].id);
    expect(abandonContract().activeContract).toBeNull();
    const before = loadHub().boardSeed;
    expect(refreshBoard().boardSeed).toBe(before + 1);
  });
  it('a defeat never settles', () => {
    const board = contractBoard(loadHub());
    acceptContract(board[0].id);
    expect(settleContract(state({ seed: 1 }), 'defeat').settled).toBe(false);
  });
});

describe('donateToCrown (funds → fame faucet)', () => {
  it('refuses below the tribute step', () => {
    const res = donateToCrown();
    expect(res.ok).toBe(false);
    expect(res.fameGained).toBe(0);
  });
  it('converts a fixed step of funds into fame', () => {
    const hub = loadHub();
    localStorage.setItem('monkey.rpg.hub', JSON.stringify({ ...hub, funds: CROWN_DONATION_STEP }));
    const res = donateToCrown();
    expect(res.ok).toBe(true);
    expect(res.hub.funds).toBe(0);
    expect(res.fameGained).toBe(CROWN_FAME_PER_DONATION);
    expect(res.logbook.fame).toBe(CROWN_FAME_PER_DONATION);
  });
});

describe('seasonStandings + destinationBoard', () => {
  it('ranks the player among rivals, leader first', () => {
    const rows = seasonStandings(loadHub(), 0);
    expect(rows.some(r => r.you)).toBe(true);
    expect(rows[0].rank).toBe(1);
    // ranks are contiguous 1..n
    rows.forEach((r, i) => expect(r.rank).toBe(i + 1));
  });
  it('parks the nemesis above the player', () => {
    const hub = { ...loadHub(), nemesis: { name: 'Vex', glyph: '☠', wins: 2 } };
    const rows = seasonStandings(hub, 100);
    const nem = rows.find(r => r.nemesis);
    const you = rows.find(r => r.you)!;
    expect(nem).toBeDefined();
    expect(nem!.fame).toBeGreaterThan(you.fame);
  });
  it('destinationBoard is deterministic and yields distinct decors', () => {
    const hub = loadHub();
    const a = destinationBoard(hub).map(d => d.id);
    const b = destinationBoard(hub).map(d => d.id);
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
  });
  it('pins a resolvable people on every destination (economy board)', () => {
    const hub = loadHub();
    for (const d of destinationBoard(hub, 6)) {
      expect(d.peopleId.length).toBeGreaterThan(0);
      expect(peopleById(d.peopleId)).toBeDefined();
    }
  });
  it('biases toward distinct peoples across the first offers', () => {
    // The slot-skip biases away from repeats; a 3-card board should show >1 land.
    const hub = loadHub();
    const ids = new Set(destinationBoard(hub).map(d => d.peopleId));
    expect(ids.size).toBeGreaterThan(1);
  });
});
