import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimationControls } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Power, RotateCcw, Map as MapIcon, Heart, Sparkles, Swords, Users, Globe, Dices, ScrollText } from 'lucide-react';
import { api } from '../api';
import type { RpgSetupResult } from '../api';
import type { RpgState, MapNode, NodeKind, MapSize, Difficulty, ActionTag, Character, VeteranRecord, CombatDie, CombatFace } from '../game/rpg/types';
import {
  buildWorld, beginTravel, arriveTravel, mapDimensions, applyAction, legalTags, sceneContext, currentNode, nodeRoster, sceneNpc, recruitCost,
  saveState, loadState, clearSave,
  startCombat, endCombat, setCombatTarget, combatContext,
  combatAssign, combatPush, combatCommit, PARTY_TARGET, COMBAT_MAX_REROLLS,
  startDialogue, endDialogue, appendDialogue, applyDialogueEffect, dialogueContext, legalEffects,
  nodeRooms, currentRoom, roomRoster, roomContext, resolveRoom, advanceRoom, usePotion, newGamePlus,
  loadVeterans, saveVeterans, clearVeterans,
  loadWorlds, saveWorld, deleteWorld, type CustomWorld,
  moraleBand, MORALE_MAX, PROV_MAX, AFFLICTIONS,
  provPriceAt, recruitPriceAt, settlementRep, repTier,
  resolveDilemma, closeDilemma,
  resolveRival, closeRival,
  startSearchCheck, rerollDicePool, commitDicePool, closeDicePool, poolHits,
  recordRun, loadLogbook, clearLogbook, type Logbook,
  recordReturn, renownTier, loadHub, type HubState,
  loadCampaign, clearCampaign, startCampaign, campaignProgress, campaignRace,
  recordChapter, buildCampaignWorld, CAMPAIGN_GOAL_FAME, type Campaign, type CampaignChapter,
  SPONSORS, SPONSOR_IDS, sponsorRank, sponsorBoon, loyaltyBoon, CLUB_RECRUITS, sponsorOffer, buySponsorUpgrade,
  PERKS, perkOffer, perkRunId, canClaimPerk, claimPerk, type PerkDef,
  contractBoard, contractCondText, standingTier, storyAct,
  acceptContract, abandonContract, refreshBoard, settleContract, type Contract,
  donateToCrown, CROWN_DONATION_STEP, CROWN_FAME_PER_DONATION, lodgeHasActions,
  seasonStandings, type SeasonRow,
  destinationBoard, type Destination,
  STATUS_META, xpForLevel, islandShape, insideIsland,
  objectiveLabel, questSatisfied, contractProgress, raceTracker,
  satchelCap, satchelBulk, satchelValue, sellValuable, teamSynergy,
  canBarter, merchantStock, barter, tradeInValue, prizedBy, type StockEntry,
  featuredExhibit,
  rapportBonus, peopleFor, peopleById, localCraft, TRADE_LABEL,
} from '../game/rpg/state';
import type { Item, DungeonRoom, StatusEffect, SponsorId, Scene } from '../game/rpg/types';
import { hexToPixel, pixelToHex, hexCorners, hexesCovering, revealedKeys, hexKey, hexNeighbours, type Hex } from '../game/rpg/hexmap';
import { terrainAt, NODE_TERRAIN, type Terrain } from '../game/rpg/terrain';
import { PixelSprite } from './PixelSprite';
import { SceneDiorama, QuestScroll, type SceneActionDef, type DioramaHero, type DioramaFoe } from './RpgScenery';
import { SPRITES, kindSpriteKey, classSpriteKey, spritePalette, peopleSpriteKey, clubSpriteKey } from '../game/rpg/sprites';
import { makeRng, seedFrom } from '../game/rpg/dice';
import { getLocale, subscribeLocale, t, type Locale } from '../i18n/i18n';
import { updatePreferences } from '../preferences/preferences-service';

import { SHELL, SCREEN_BG, DARK, INK, MID, PAPER, KIND_GLYPH, SPRITE_PALETTE, STATUS_COLOR, STAT_LABEL, POOL_STAT_LABEL } from './rpg-theme';
import { HeroPortrait, MapMarker, GoalLevelHint, CardChip, Compass, LedgerBar, NarrationLog, StatusChips, StatBar, MoraleBar, ProvisionsBar, CharacterCard } from './RpgWidgets';

// Predefined scenarios. `name` is the theme string handed to the generator; the
// rest drives the selection vignette (decor scene + hero avatar + one-line brief)
// so the player picks a world by its look, not just a label.
type Scenario = { id: string; name: string; brief: string; decor: NodeKind; hero: string };
const SCENARIOS: Scenario[] = [
  { id: 'darkfantasy', name: 'Dark fantasy',    brief: 'Cursed realm — the undead stir in the crypts.',     decor: 'dungeon', hero: 'Warrior' },
  { id: 'pirate',      name: 'Pirate isles',    brief: 'Salt, rum and buried gold across the reefs.',        decor: 'camp',    hero: 'Ranger'  },
  { id: 'cyberpunk',   name: 'Cyberpunk noir',  brief: 'Neon rain, corp secrets, back-alley deals.',         decor: 'town',    hero: 'Rogue'   },
  { id: 'victorian',   name: 'Haunted Victorian', brief: 'Gaslit streets and a manor that screams.',         decor: 'ruin',    hero: 'Cleric'  },
  { id: 'frozen',      name: 'Frozen north',    brief: 'Ice, wolves and a sleeping ancient.',                decor: 'wild',    hero: 'Ranger'  },
  { id: 'desert',      name: 'Desert ruins',    brief: 'Sun-bleached tombs hide a buried god.',              decor: 'ruin',    hero: 'Mage'    },
  { id: 'fae',         name: 'Enchanted forest', brief: 'Fae paths twist — nothing is as it seems.',         decor: 'forest',  hero: 'Druid'   },
  { id: 'volcanic',    name: 'Volcanic depths', brief: 'Lava caverns and forge-cult zealots.',               decor: 'cave',    hero: 'Warrior' },
  { id: 'steppe',      name: 'Steppe horde',    brief: 'Open plains, war drums on the horizon.',             decor: 'camp',    hero: 'Warrior' },
  { id: 'academy',     name: 'Arcane academy',  brief: 'Spires of magic, a forbidden experiment.',           decor: 'town',    hero: 'Mage'    },
  { id: 'sunken',      name: 'Sunken temple',   brief: 'Drowned halls and a serpent cult below.',            decor: 'cave',    hero: 'Cleric'  },
  { id: 'plague',      name: 'Plague city',     brief: 'Quarantined slums — a cure worth killing for.',      decor: 'village', hero: 'Rogue'   },
];

const SETUP_LOCALES: Array<[Locale, string]> = [
  ['fr', 'Français'], ['en', 'English'],
];

// Build a throwaway map node so the diorama can render a scenario's decor as a
// preview thumbnail (deterministic per scenario id).
function vignetteNode(s: Scenario): MapNode {
  return {
    id: `vig:${s.id}`, name: s.name, kind: s.decor, blurb: s.brief,
    x: 0.5, y: 0.5, edges: [], danger: 0, discovered: true, scouted: true, visited: false, cleared: false,
  };
}

interface Props {
  onExit: () => void;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

export default function RpgConsole({ onExit, modelId, providerMode, providerUserId }: Props) {
  // Lazy-init from the persisted save so the adventure survives a tab switch,
  // a console close/reopen, or an app restart — never reset on remount.
  const [state, setState] = useState<RpgState | null>(() => loadState());
  const [booting, setBooting] = useState(true);
  const [showParty, setShowParty] = useState(false);
  // The expedition logbook (Fame + past runs) — a light cross-run record, always
  // reachable. Re-read on open so a just-finished run shows up.
  const [showLog, setShowLog] = useState(false);
  const [logbook, setLogbook] = useState<Logbook>(() => loadLogbook());
  // The lodge's persistent meta-state (Funds, Tickets, lifetime stats). Renown is
  // derived from the logbook's Fame, so it stays a single authority.
  const [hub, setHub] = useState<HubState>(() => loadHub());
  // Lights the top-bar stars button when the Lodge holds something to act on
  // (affordable outfit, an open commission with none running, or a payable tribute).
  const lodgeAlert = useMemo(() => lodgeHasActions(hub), [hub]);
  const openLog = useCallback(() => { setLogbook(loadLogbook()); setHub(loadHub()); setShowLog(true); }, []);
  // Track the active UI locale so every GM/NPC request asks the model to narrate
  // in the player's language (the LLM output is the bulk of what they read).
  const [locale, setLoc] = useState<Locale>(() => getLocale());
  useEffect(() => subscribeLocale(() => setLoc(getLocale())), []);
  const llmOpts = useMemo(() => ({ modelId, providerMode, providerUserId, lang: locale }), [modelId, providerMode, providerUserId, locale]);

  // Setup-view local state (before a world exists).
  const [theme, setTheme] = useState('Dark fantasy');
  const [generating, setGenerating] = useState(false);
  const [setup, setSetup] = useState<RpgSetupResult | null>(null);
  // Two-step creation wizard: 'world' = pick/generate a world vignette, 'hero' =
  // pick the hero, world size & difficulty for the generated world.
  const [setupStep, setSetupStep] = useState<'world' | 'hero'>('world');
  const [heroIndex, setHeroIndex] = useState(0);
  // Explorer-first (CE2): the class archetype picked on the main screen BEFORE a
  // destination. When the world generates, the rolled hero matching this class
  // is pre-selected (a summoned veteran overrides the roll entirely).
  const [preferredClass, setPreferredClass] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState<MapSize>('medium');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [hasSave, setHasSave] = useState(() => !!loadState());
  // Finished heroes kept from past victories — summonable as the start of a run.
  const [veterans, setVeterans] = useState<VeteranRecord[]>(() => loadVeterans());
  const [vetId, setVetId] = useState<string | null>(null); // selected veteran's char id
  // Player-conjured worlds kept as deletable selection vignettes (free text → card).
  const [worlds, setWorlds] = useState<CustomWorld[]>(() => loadWorlds());
  // The explorer club backing the next run (CE2's outer-loop spine). Picking one
  // folds its boon into the starting kit and earns its rank xp on return; null =
  // an unbacked, independent expedition. Reset whenever a fresh world is chosen.
  const [sponsorId, setSponsorId] = useState<SponsorId | null>(null);
  // The one persistent adventure (CE2 outer arc). Chosen explorer + difficulty are
  // locked here at creation; the band, satchel and fame persist across every
  // expedition. null = no adventure yet (show the creation screen).
  const [campaign, setCampaign] = useState<Campaign | null>(() => loadCampaign());
  // Plays the short opening animation right after a saga is created (item #2).
  const [intro, setIntro] = useState(false);
  // Buy a lodge outfit upgrade — re-reads + deducts atomically in state.ts, then
  // refreshes the hub so the chip, shop and boon preview all reflect the spend.
  const buyUpgrade = useCallback((id: SponsorId) => {
    const r = buySponsorUpgrade(id);
    if (r.ok) setHub(r.hub);
    return r;
  }, []);
  // Commission board (lots 4 & 5): accept a single active commission, drop it, or
  // re-roll the board. Each helper re-reads + persists in state.ts; we just refresh
  // the hub so the Lodge, the Standing meter and the active-commission chip update.
  const onAcceptContract = useCallback((id: string) => { const r = acceptContract(id); if (r.ok) setHub(r.hub); return r; }, []);
  const onAbandonContract = useCallback(() => { setHub(abandonContract()); }, []);
  const onRefreshBoard = useCallback(() => { setHub(refreshBoard()); }, []);
  // Tribute to the Crown: convert banked Funds into Fame (state.ts owns the
  // rate and the clamps); refresh both authorities so Renown moves on screen.
  const onDonate = useCallback(() => {
    const r = donateToCrown();
    if (r.ok) { setHub(r.hub); setLogbook(r.logbook); }
    return r;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1100);
    return () => clearTimeout(t);
  }, []);

  // Persist on every state change so the adventure survives a power-off — except
  // on death. Permadeath: a fallen party ends the run for good, so we wipe the
  // save the moment it happens. The GAME OVER screen stays (in-memory state), but
  // the only way forward is a fresh adventure from the selection screen — closing
  // and reopening the console can never resume a dead run.
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'gameover') { clearSave(); setHasSave(false); }
    else saveState(state);
  }, [state]);

  // Pre-select the rolled hero that matches the explorer class picked on the
  // main screen (sprite-key match so "Scout" satisfies a Ranger pick). Falls
  // back to the first hero when nothing matches or nothing was picked.
  const matchHero = useCallback((heroes: RpgSetupResult['heroes']): number => {
    if (!preferredClass) return 0;
    const want = classSpriteKey(preferredClass);
    const idx = heroes.findIndex(h => classSpriteKey(h.className) === want);
    return idx >= 0 ? idx : 0;
  }, [preferredClass]);

  // Open a fresh adventure: lock in the chosen explorer + difficulty, then the
  // picker takes over (no more hero/size screens — those are campaign-fixed).
  const onStartCampaign = useCallback((leadClass: string, leadEpithet: string, diff: Difficulty) => {
    const c = startCampaign(leadClass, leadEpithet, diff);
    setCampaign(c);
    setPreferredClass(leadClass);
    setDifficulty(diff);
    setSetup(null);
    setIntro(true); // play the opening animation before the picker
  }, []);

  // Pick the hero matching a campaign's lead archetype from a freshly rolled world.
  const matchLead = useCallback((heroes: RpgSetupResult['heroes'], leadClass: string): number => {
    const want = classSpriteKey(leadClass);
    const idx = heroes.findIndex(h => classSpriteKey(h.className) === want);
    return idx >= 0 ? idx : 0;
  }, []);

  // `themeArg` lets a destination card hand its own theme line straight to the
  // generator. In campaign mode the world is built and entered IMMEDIATELY — no
  // hero pick, no size/difficulty screen: the band, difficulty and large scale are
  // all campaign-fixed, and the persistent party is transplanted in.
  const generate = useCallback(async (themeArg?: string, peopleId?: string) => {
    // Guard: the bare `onClick={generate}` paths hand a MouseEvent, not a theme.
    const th = typeof themeArg === 'string' ? themeArg : theme;
    // A destination card pins its locals (CE2 economy board); the manual/preset
    // paths pass nothing, so worldgen falls back to its per-seed roll unchanged.
    const pid = typeof peopleId === 'string' ? peopleId : undefined;
    setGenerating(true);
    try {
      const res = await api.rpgSetup(th, llmOpts);
      const c = campaign ?? loadCampaign();
      if (!c) { setSetup(res); setHeroIndex(matchHero(res.heroes)); setSetupStep('hero'); return; }
      const heroIdx = c.party.length ? 0 : matchLead(res.heroes, c.leadClass);
      const sponsor = sponsorId
        ? { id: sponsorId, tier: hub.outfits[sponsorId] || 0, rank: sponsorRank(hub.sponsorXp[sponsorId] || 0).tier, name: res.sponsors?.find(s => s.archetype === sponsorId)?.name }
        : undefined;
      const world = buildCampaignWorld(res, th, heroIdx, c, sponsor, hub.perks, pid);
      setState(world);
    } catch {
      setSetup(null);
    } finally {
      setGenerating(false);
    }
  }, [theme, llmOpts, matchHero, matchLead, campaign, sponsorId, hub]);

  // Finish the adventure for good (goal reached) or after a wipe — clear it and
  // drop back to the creation screen for a fresh saga.
  const onRestartCampaign = useCallback(() => {
    clearCampaign();
    clearSave();
    setCampaign(null);
    setState(null);
    setSetup(null);
    setSetupStep('world');
    setHasSave(false);
    setSponsorId(null);
    setVetId(null);
    setVeterans(loadVeterans());
  }, []);

  const forgetVeterans = useCallback(() => {
    clearVeterans();
    setVeterans([]);
    setVetId(null);
  }, []);

  const resume = useCallback(() => {
    const s = loadState();
    if (s) setState(s);
  }, []);

  // Top-bar "New adventure": drop the active run and return to the campaign's
  // expedition picker (the campaign itself — band, fame, chronicle — persists).
  // With no campaign yet it just refreshes the creation screen.
  const reset = useCallback(() => {
    clearSave();
    setState(null);
    setSetup(null);
    setSetupStep('world');
    setHasSave(false);
    setVeterans(loadVeterans()); // surface heroes a just-won run may have saved
    setVetId(null);
    setSponsorId(null);
    setCampaign(loadCampaign());
    setLogbook(loadLogbook()); // refresh the Lodge banner with the run just banked
    setHub(loadHub());
  }, []);

  // Continue the campaign after an expedition: bank the run into the campaign,
  // then return to the picker for the next chapter (the band already carried over).
  const onContinueCampaign = useCallback(() => {
    setCampaign(loadCampaign());
    reset();
  }, [reset]);

  // Top-bar ↺: same "new adventure" reset, but guarded by a confirm while a run is
  // live so an accidental tap can't discard the expedition (the chronicle, the
  // band and the satchel are gone for good). No active run → reset is harmless.
  const onNewAdventure = useCallback(() => {
    if (state && !confirm(t('rpg.confirm.leave'))) return;
    reset();
  }, [reset, state]);

  // New Game+: forge a fresh world (new setup from the same theme) and carry the
  // veteran party, their satchel and gold into it, one tier harder.
  const [ngLoading, setNgLoading] = useState(false);
  const startNewGamePlus = useCallback(async () => {
    setNgLoading(true);
    try {
      const cur = loadState();
      const th = cur?.theme || theme;
      const res = await api.rpgSetup(th, llmOpts);
      setState(prev => prev ? newGamePlus(prev, res, th, 0, mapSize) : prev);
    } catch { /* keep the end screen on failure */ }
    finally { setNgLoading(false); }
  }, [theme, llmOpts, mapSize]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rpg-journal flex flex-1 flex-col overflow-hidden"
      style={{ background: SHELL }}
    >
        {/* Console top bar — embossed journal cover band */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ color: INK, borderBottom: '1px solid rgba(43,32,22,0.22)', boxShadow: 'inset 0 -2px 0 rgba(255,255,255,0.25)' }}>
          <span className="text-[11px] font-bold tracking-[0.2em]" style={{ fontFamily: 'monospace', textShadow: '0 1px 0 rgba(255,255,255,0.4)' }}>
            <span style={{ color: '#7a5a1f' }}>✦</span> MONKEY · QUEST
          </span>
          <div className="flex items-center gap-2">
            {state && (
              <button onClick={() => setShowParty(true)} title={t('rpg.hdr.party')}
                className="flex items-center justify-center rounded-md" style={{ background: MID, color: INK, width: 26, height: 26, border: `1px solid ${INK}`, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18), 0 1px 2px rgba(43,32,22,0.25)' }}>
                <Users size={15} />
              </button>
            )}
            <motion.button onClick={openLog}
              title={lodgeAlert ? t('rpg.lodge.alert') : t('rpg.lodge.logbookFame')}
              className="flex items-center justify-center rounded-md"
              animate={lodgeAlert
                ? { scale: [1, 1.12, 1], boxShadow: ['0 0 0 0 rgba(214,158,46,0.55)', '0 0 0 5px rgba(214,158,46,0)', '0 0 0 0 rgba(214,158,46,0)'] }
                : { scale: 1, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18), 0 1px 2px rgba(43,32,22,0.25)' }}
              transition={lodgeAlert ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
              style={{ background: lodgeAlert ? '#d69e2e' : MID, color: lodgeAlert ? '#3a2a08' : INK, width: 26, height: 26, border: `1px solid ${lodgeAlert ? '#8a6516' : INK}` }}>
              <Sparkles size={15} />
            </motion.button>
            <button onClick={onNewAdventure} title={t('rpg.hdr.newAdventure')}
              className="flex items-center justify-center rounded-md" style={{ background: MID, color: INK, width: 26, height: 26, border: `1px solid ${INK}`, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18), 0 1px 2px rgba(43,32,22,0.25)' }}>
              <RotateCcw size={15} />
            </button>
            <button onClick={onExit} title={t('rpg.hdr.powerOff')}
              className="flex items-center justify-center rounded-md" style={{ background: '#7a1f1f', color: '#f0d0d0', width: 26, height: 26, border: '1px solid #4a1010', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.3), 0 1px 2px rgba(43,32,22,0.25)' }}>
              <Power size={15} />
            </button>
          </div>
        </div>

        {/* Screen — inset like a journal page in its cover; views scroll if taller */}
        <div className="relative flex-1 min-h-0 overflow-auto"
          style={{ background: SCREEN_BG, margin: '6px 8px 8px', borderRadius: 10, border: `2px solid ${INK}`, boxShadow: 'inset 0 2px 8px rgba(43,32,22,0.28)' }}>
            {/* No saga yet → the creation screen: pick the lead explorer +
                difficulty once (item #1, #7). World size is always large; no more
                hero/size screen after generation. */}
            {!state && !campaign && (
              <CreationView onStart={onStartCampaign} hasSave={hasSave} resume={resume} />
            )}
            {/* Opening animation, played once right after a saga is born (#2). */}
            {!state && campaign && intro && (
              <CampaignIntro campaign={campaign} onDone={() => setIntro(false)} />
            )}
            {/* A saga is underway, between expeditions → the expedition picker:
                campaign banner + race scaled to the goal + chronicle + finish/
                abandon, then the destination board. No worlds list (#4), no
                size/difficulty/hero screen (#7). */}
            {!state && campaign && !intro && (
              <ExpeditionPicker
                campaign={campaign}
                theme={theme} setTheme={setTheme} generate={generate} generating={generating}
                hasSave={hasSave} resume={resume}
                hub={hub} openLodge={openLog}
                sponsorId={sponsorId} setSponsorId={setSponsorId}
                onRestart={onRestartCampaign}
              />
            )}
            {state && (state.phase === 'world') && (
              <MapView state={state} onTravel={(id) => setState(s => s ? beginTravel(s, id) : s)} />
            )}
            {/* Travel: the party walks the road for a beat; an en-route event may
                fire before they arrive. Map shows behind a dim veil. */}
            {state && (state.phase === 'travel') && state.travel && (
              <>
                <MapView state={state} onTravel={() => {}} />
                <TravelOverlay state={state} setState={setState} />
              </>
            )}
            {state && (state.phase === 'scene') && (
              nodeRooms(currentNode(state))
                ? <DungeonScene state={state} setState={setState} llmOpts={llmOpts} />
                : <SceneView state={state} setState={setState} llmOpts={llmOpts} />
            )}
            {/* Dilemma: a road choice fired on arrival; map dims behind it. */}
            {state && (state.phase === 'dilemma') && state.dilemma && (
              <>
                <MapView state={state} onTravel={() => {}} />
                <div className="absolute inset-0 overflow-auto" style={{ background: 'rgba(43,32,22,0.82)' }}>
                  <DilemmaView state={state} setState={setState} />
                </div>
              </>
            )}
            {/* Rival encounter: a competing expedition met on the road; map dims behind it. */}
            {state && (state.phase === 'rival') && state.rivalEncounter && (
              <>
                <MapView state={state} onTravel={() => {}} />
                <div className="absolute inset-0 overflow-auto" style={{ background: 'rgba(43,32,22,0.82)' }}>
                  <RivalView state={state} setState={setState} />
                </div>
              </>
            )}
            {state && (state.phase === 'dialogue') && (
              <DialogueView state={state} setState={setState} llmOpts={llmOpts} />
            )}
            {/* Combat has no phase/screen of its own: it is staged INLINE on the
                scene/dungeon screen — the diorama hosts the fight (useCombatStage)
                and CombatPanel swaps in below the board. Never a separate screen. */}
            {state && (state.phase === 'victory' || state.phase === 'gameover') && (
              <EndView state={state} onReset={reset} llmOpts={llmOpts}
                onNewGamePlus={startNewGamePlus} ngLoading={ngLoading}
                campaign={campaign} onContinueCampaign={onContinueCampaign} onRestartCampaign={onRestartCampaign} />
            )}

            {/* Party / heroes roster overlay */}
            {state && showParty && (
              <PartyView state={state} setState={setState} onClose={() => setShowParty(false)} />
            )}

            {/* Logbook & Fame overlay — past expeditions, newest first */}
            {showLog && (
              <LogbookView logbook={logbook} hub={hub} onBuy={buyUpgrade}
                onAcceptContract={onAcceptContract} onAbandonContract={onAbandonContract} onRefreshBoard={onRefreshBoard}
                onClear={() => { clearLogbook(); setLogbook(loadLogbook()); }}
                onClose={() => setShowLog(false)} />
            )}

            {/* Juice: transient feedback (discoveries, cracked minds, levels, coin)
                floated over the live run — pure echo of the client-owned log. */}
            {state && !booting && <JuiceLayer state={state} />}

            {/* Power-on sweep */}
            {booting && (
              <motion.div className="absolute inset-0" style={{ background: INK, pointerEvents: 'none' }}
                initial={{ scaleY: 1, opacity: 1 }} animate={{ scaleY: 0, opacity: [1, 1, 0.8, 0] }}
                transition={{ duration: 0.9, ease: 'easeInOut' }} />
            )}
        </div>

        {/* Status + caption strip */}
        <div className="px-4 py-2.5" style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
          <div className="text-center text-[11px] font-bold tracking-wider" style={{ minHeight: 16 }}>
            {booting ? t('rpg.powerOn') : state ? statusLine(state) : setupStep === 'hero' ? t('rpg.outfit') : t('rpg.hall')}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span>{state ? state.title : t('rpg.newGame')}</span>
            <span>{modelId ? t('rpg.gmLlm') : t('rpg.gmOffline')}</span>
          </div>
        </div>
    </motion.div>
  );
}

function statusLine(s: RpgState): string {
  if (s.phase === 'victory') return t('rpg.status.victory');
  if (s.phase === 'gameover') return t('rpg.status.gameover');
  const alive = s.party.filter(c => c.alive).length;
  const party = t('rpg.status.party', { alive, total: s.party.length });
  const mor = t('rpg.status.morale', { n: Math.round(s.morale ?? 100) });
  const food = t('rpg.status.food', { n: s.provisions ?? PROV_MAX, max: PROV_MAX });
  if (s.phase === 'world') return `${t('rpg.status.worldMap')} · ${party} · ${mor} · ${food} · ${s.difficulty.toUpperCase()}`;
  if (s.phase === 'travel' && s.travel) return t('rpg.status.onRoad', { dest: s.nodes[s.travel.toId].name.toUpperCase() });
  if (s.phase === 'dilemma') return `${t('rpg.status.crossroads')} · ${mor}`;
  if (s.phase === 'rival') return `${t('rpg.status.rival')} · ${mor}`;
  if (s.phase === 'combat') {
    const foes = s.combat?.enemies.filter(e => e.alive).length || 0;
    return t('rpg.status.battle', { round: s.combat?.round || 1, foes });
  }
  if (s.phase === 'dialogue' && s.dialogue) {
    return t('rpg.status.talking', { npc: s.dialogue.npcName.toUpperCase() });
  }
  return `${currentNode(s).name.toUpperCase()} · ${party} · ${mor} · ${food}`;
}

// ── Setup ────────────────────────────────────────────────────────────────────

// Language picker on the world-selection screen — sets the global locale so the
// generated world (and the rest of the app) speaks the player's language.
function SetupLanguagePicker() {
  const [locale, setLoc] = useState<Locale>(() => getLocale());
  useEffect(() => subscribeLocale(() => setLoc(getLocale())), []);
  return (
    <label className="flex items-center gap-1.5 text-[10px] font-bold cursor-pointer" style={{ color: INK }}>
      <Globe size={13} />
      <select value={locale} onChange={e => updatePreferences({ locale: e.target.value as Locale })}
        className="rounded px-1.5 py-1 text-[10px] font-bold outline-none cursor-pointer"
        style={{ background: PAPER, color: INK, border: `2px solid ${DARK}` }}>
        {SETUP_LOCALES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
    </label>
  );
}

const MAP_SIZES: { id: MapSize; label: string; hint: string }[] = [
  { id: 'small', label: 'Small', hint: 'a short tale' },
  { id: 'medium', label: 'Medium', hint: 'a full quest' },
  { id: 'large', label: 'Large', hint: 'a sprawling saga' },
];

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'forgiving · rush it' },
  { id: 'normal', label: 'Normal', hint: 'fair · skill counts' },
  { id: 'hard', label: 'Hard', hint: 'brutal · farm first' },
];

// Throwaway map node so the diorama can preview a custom world's decor.
function customVignetteNode(w: CustomWorld): MapNode {
  return {
    id: `vig:${w.id}`, name: w.setup.title, kind: w.decor, blurb: w.setup.quest.title,
    x: 0.5, y: 0.5, edges: [], danger: 0, discovered: true, scouted: true, visited: false, cleared: false,
  };
}

// Same, for a destination offer on the expedition board.
function destVignetteNode(d: Destination): MapNode {
  return {
    id: `vig:${d.id}`, name: d.name, kind: d.decor, blurb: d.hook,
    x: 0.5, y: 0.5, edges: [], danger: 0, discovered: true, scouted: true, visited: false, cleared: false,
  };
}

// Destination economy intel (CE2 regional economy): who lives here, what they
// pay a premium FOR (carry that haul), and which shop kind they make cheaply.
// Pure read-off of the pinned people — the player picks the run by its buyers,
// not blind. Names stay thematic (client-owned flavour); labels localise.
function DestEconomy({ d, on, t }: { d: Destination; on: boolean; t: typeof import('../i18n/i18n').t }) {
  const p = peopleById(d.peopleId);
  if (!p) return null;
  const emblem = peopleSpriteKey(p.id);
  return (
    <div className="text-[8px] leading-tight mt-0.5 flex items-start gap-1"
         style={{ color: on ? PAPER : '#3f6a3f', opacity: on ? 0.95 : 1 }}
         title={t('rpg.dest.economyTitle', { people: p.name })}>
      <PixelSprite grid={SPRITES[emblem]} palette={spritePalette(emblem)} px={1.5}
                   className="shrink-0 mt-px rounded-sm" title={p.name} />
      <span>{t('rpg.dest.economy', { people: p.name, buys: TRADE_LABEL[p.prize], makes: t('rpg.craft.' + p.craft) })}</span>
    </div>
  );
}

// The signature hue of a destination's people — drives the card's colour accent
// so the board reads as a spread of distinct cultures at a glance (CE2 colour).
function peopleAccent(peopleId: string): string {
  return spritePalette(peopleSpriteKey(peopleId))?.M || MID;
}

// The explorer roster offered on the main screen (CE2: pick WHO leads before
// anything else). Fixed archetypes — each maps to a distinct hero sprite; the
// generated world's matching hero is pre-selected at the outfitting step.
const EXPLORER_ARCHETYPES: { name: string; epithet: string }[] = [
  { name: 'Warrior', epithet: 'steel and grit' },
  { name: 'Ranger', epithet: 'eyes on the trail' },
  { name: 'Mage', epithet: 'forbidden lore' },
  { name: 'Cleric', epithet: 'faith that mends' },
  { name: 'Paladin', epithet: 'oath and shield' },
  { name: 'Necromancer', epithet: 'speaks with the dead' },
];

// ── Adventure creation (CE2 outer loop) ──────────────────────────────────────
// The one screen shown before any saga exists. The explorer and difficulty are
// chosen here, ONCE, and sealed for the whole adventure (item #1, #7). World size
// is always large; there is no per-world hero/size screen anymore.
function CreationView(props: {
  onStart: (leadClass: string, leadEpithet: string, diff: Difficulty) => void;
  hasSave: boolean; resume: () => void;
}) {
  const { onStart, hasSave, resume } = props;
  const [lead, setLead] = useState<string>(EXPLORER_ARCHETYPES[0].name);
  const [diff, setDiff] = useState<Difficulty>('normal');
  const ep = EXPLORER_ARCHETYPES.find(a => a.name === lead) || EXPLORER_ARCHETYPES[0];
  return (
    <div className="p-4" style={{ color: INK, fontFamily: 'monospace' }}>
      {hasSave && (
        <button onClick={resume} className="w-full mb-3 rounded-md py-2 text-[12px] font-bold"
          style={{ background: INK, color: PAPER }}>
          {t('rpg.continue.saved')}
        </button>
      )}
      <div className="flex items-center justify-between mb-1">
        <div className="text-[13px] font-bold">{t('rpg.setup.newAdventure')}</div>
        <SetupLanguagePicker />
      </div>
      <div className="text-[10px] leading-snug mb-3" style={{ opacity: 0.8 }}>
        {t('rpg.setup.chooseLead')}
      </div>

      <div className="text-[12px] font-bold mb-1.5">{t('rpg.setup.yourExplorer')}</div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {EXPLORER_ARCHETYPES.map(a => {
          const on = lead === a.name;
          return (
            <button key={a.name} onClick={() => setLead(a.name)} className="rounded p-1.5 text-left"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
              <div className="flex justify-center mb-0.5">
                <HeroPortrait cls={a.name} px={2} />
              </div>
              <div className="text-[10px] font-bold text-center">{a.name}</div>
              <div className="text-[8px] leading-tight text-center" style={{ opacity: 0.8 }}>{a.epithet}</div>
            </button>
          );
        })}
      </div>

      <div className="text-[12px] font-bold mb-1.5">{t('rpg.setup.difficultyStep')}</div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {DIFFICULTIES.map(d => {
          const on = diff === d.id;
          return (
            <button key={d.id} onClick={() => setDiff(d.id)} className="rounded p-1.5 text-center"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
              <div className="text-[11px] font-bold">{t('rpg.diff.' + d.id)}</div>
              <div className="text-[9px] leading-tight" style={{ opacity: 0.85 }}>{t('rpg.diff.' + d.id + '.hint')}</div>
              <div className="text-[8px] mt-0.5" style={{ opacity: 0.7 }}>{t('rpg.setup.goalFame', { n: CAMPAIGN_GOAL_FAME[d.id] })}</div>
            </button>
          );
        })}
      </div>
      <div className="text-[9px] mb-3" style={{ opacity: 0.7 }}>
        {t('rpg.setup.everyWorldLarge')}
      </div>

      <button onClick={() => onStart(ep.name, ep.epithet, diff)}
        className="w-full rounded-md py-2.5 text-[13px] font-bold" style={{ background: DARK, color: PAPER }}>
        {t('rpg.setup.beginAdventure')}
      </button>
    </div>
  );
}

// The short opening animation, played once when a saga is born (item #2). Tap to
// skip; it auto-dismisses to the expedition picker.
function CampaignIntro({ campaign, onDone }: { campaign: Campaign; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3400); return () => clearTimeout(t); }, [onDone]);
  const lines = [
    t('rpg.intro.newSaga'),
    `${campaign.leadClass} — ${campaign.leadEpithet}`,
    t('rpg.intro.bringGlory', { n: campaign.goalFame }),
  ];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6"
      style={{ background: INK, color: PAPER, fontFamily: 'monospace', cursor: 'pointer' }} onClick={onDone}>
      <motion.div initial={{ scale: 0.5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}>
        <HeroPortrait cls={campaign.leadClass} px={5} ring />
      </motion.div>
      {lines.map((l, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 + i * 0.55, duration: 0.5 }}
          className={i === 0 ? 'text-[15px] font-bold tracking-[0.2em] text-center' : 'text-[11px] text-center'}
          style={{ opacity: i === 0 ? 1 : 0.85 }}>
          {l}
        </motion.div>
      ))}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 2.4 }} className="text-[9px] mt-2">
        {t('rpg.intro.tapSkip')}
      </motion.div>
    </div>
  );
}

// Between expeditions: the campaign hub. Shows the lead band, the fame bar scaled
// to the goal (the single scale, item #3), the rival race against that same goal,
// the chronicle so far, finish/abandon controls, then the destination board that
// launches the next chapter (item #4: no saved-worlds list; #7: no size/hero step).
function ExpeditionPicker(props: {
  campaign: Campaign;
  theme: string; setTheme: (t: string) => void; generate: (themeArg?: string, peopleId?: string) => void; generating: boolean;
  hasSave: boolean; resume: () => void;
  hub: HubState; openLodge: () => void;
  sponsorId: SponsorId | null; setSponsorId: (id: SponsorId | null) => void;
  onRestart: () => void;
}) {
  const { campaign, theme, setTheme, generate, generating, hasSave, resume, hub, openLodge, sponsorId, setSponsorId, onRestart } = props;
  const [sel, setSel] = useState<{ kind: 'preset' | 'dest'; id: string } | null>(null);
  const dests = destinationBoard(hub, 6);
  const { rows, goal } = campaignRace(campaign);
  const pct = Math.round(campaignProgress(campaign) * 100);
  const bandSize = Math.max(1, campaign.party.length);
  // What the Exposition headlines THIS chapter — haul this category home for a
  // fame premium (mirrors the banking bonus in recordChapter, same seed+chapter).
  const featuredGood = t('rpg.trade.' + featuredExhibit(campaign.startedAt, campaign.chapter));
  return (
    <div className="p-4" style={{ color: INK, fontFamily: 'monospace' }}>
      {hasSave && (
        <button onClick={resume} className="w-full mb-3 rounded-md py-2 text-[12px] font-bold"
          style={{ background: INK, color: PAPER }}>
          {t('rpg.continue.resume')}
        </button>
      )}

      {/* Campaign banner — lead, chapter, fame toward the finish-line (the scale). */}
      <div className="mb-3 rounded-md px-2.5 py-2" style={{ background: INK, color: PAPER, border: `2px solid ${DARK}` }}>
        <div className="flex items-center gap-2">
          <HeroPortrait cls={campaign.leadClass} px={2.5} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold truncate">{campaign.leadClass} · {campaign.leadEpithet}</div>
            <div className="text-[8px]" style={{ opacity: 0.8 }}>
              {t('rpg.exp.chapterLine', { n: campaign.chapter, diff: campaign.difficulty.toUpperCase(), size: bandSize })}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold">{campaign.fame} / {goal}</div>
            <div className="text-[8px]" style={{ opacity: 0.8 }}>{t('rpg.setup.fameToGlory')}</div>
          </div>
        </div>
        <div className="mt-1.5 h-2 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}
          title={t('rpg.exp.pctFinish', { pct })}>
          <div className="h-full" style={{ width: `${pct}%`, background: campaign.done ? '#d9b65c' : '#9ad14e' }} />
        </div>
        {campaign.done && (
          <div className="text-[9px] font-bold mt-1" style={{ color: '#d9b65c' }}>
            {t('rpg.exp.finishReached')}
          </div>
        )}
      </div>

      {/* The Exposition's featured gallery this chapter — tells the player what
          treasure to bring home for the banking premium (CE2's Exposition loop). */}
      <div className="mb-3 rounded-md px-2.5 py-1.5" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
        <div className="text-[9px] font-bold" style={{ color: '#7a5a1f' }}>
          {t('rpg.exp.featured', { good: featuredGood })}
        </div>
        <div className="text-[8px] mt-0.5" style={{ opacity: 0.75 }}>
          {t('rpg.exp.featuredHint', { good: featuredGood })}
        </div>
      </div>

      {/* The Great Race — every bar scaled to the shared goal. */}
      <div className="mb-3 rounded-md p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
        <div className="text-[9px] font-bold mb-1" style={{ color: '#7a5a1f' }}>{t('rpg.race.toGoal', { goal })}</div>
        {rows.map(r => (
          <div key={r.name} className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-bold w-3 text-right shrink-0" style={{ opacity: 0.7 }}>{r.rank}</span>
            <span className="text-[9px] w-3 text-center shrink-0" style={{ color: r.you ? INK : '#7a5a1f' }}>{r.glyph}</span>
            <span className="text-[9px] w-20 truncate shrink-0"
              style={{ color: INK, fontWeight: r.you ? 700 : 500, opacity: r.you ? 1 : 0.85 }}>{r.name}</span>
            <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.12)' }}>
              <div className="h-full" style={{ width: `${Math.round((r.fame / goal) * 100)}%`, background: r.you ? INK : '#b08a3e' }} />
            </div>
            <span className="text-[9px] w-10 text-right shrink-0" style={{ opacity: 0.8 }}>{r.fame}</span>
          </div>
        ))}
      </div>

      {/* The chronicle — every chapter so far, newest first (item #3). */}
      {campaign.chronicle.length > 0 && (
        <div className="mb-3 rounded-md p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
          <div className="text-[9px] font-bold mb-1" style={{ color: '#7a5a1f' }}>{t('rpg.exp.chronicle')}</div>
          {campaign.chronicle.slice(0, 6).map(ch => (
            <div key={ch.n} className="flex items-center gap-1.5 text-[9px] mb-0.5">
              <span className="font-bold w-8 shrink-0">{t('rpg.exp.chAbbr', { n: ch.n })}</span>
              <span className="shrink-0" title={ch.outcome}>{ch.outcome === 'victory' ? '✦' : ch.outcome === 'fled' ? '↩' : '☠'}</span>
              <span className="flex-1 truncate" style={{ opacity: 0.85 }}>{ch.title}</span>
              <span className="shrink-0" style={{ opacity: 0.7 }}>+{ch.fameEarned}</span>
            </div>
          ))}
        </div>
      )}

      {/* Triumph CTAs (goal reached): end the saga or roll straight into a new one.
          The mid-saga "abandon" is NOT here — it lives discreetly at the bottom. */}
      {campaign.done && (
        <div className="flex gap-1.5 mb-3">
          <button onClick={onRestart} className="flex-1 rounded-md py-2 text-[11px] font-bold" style={{ background: '#d9b65c', color: INK }}>
            {t('rpg.chapter.triumph')}
          </button>
          <button onClick={() => { if (confirm(t('rpg.confirm.abandon'))) onRestart(); }}
            className="flex-1 rounded-md py-2 text-[11px] font-bold" style={{ background: MID, color: INK, border: `2px solid ${DARK}` }}>
            {t('rpg.end.startNewSaga')}
          </button>
        </div>
      )}

      {/* WHERE chapter N goes — the procedural destination board. */}
      <div className="text-[12px] font-bold mb-1.5">{t('rpg.chapter.where', { n: campaign.chapter })}</div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {dests.map(d => {
          const on = sel?.kind === 'dest' && sel.id === d.id;
          return (
            <button key={d.id} onClick={() => { setSel({ kind: 'dest', id: d.id }); setTheme(d.theme); }}
              className="text-left rounded-lg overflow-hidden relative"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, outline: on ? `3px solid ${INK}` : 'none', outlineOffset: 1, borderLeft: `4px solid ${peopleAccent(d.peopleId)}` }}>
              <SceneDiorama node={destVignetteNode(d)} />
              <div className="px-1.5 py-1">
                <div className="text-[9px] font-bold leading-tight">{d.name}</div>
                <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.8 }}>{d.hook}</div>
                <DestEconomy d={d} on={on} t={t} />
                {on && (
                  <span role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); if (!generating) generate(d.theme, d.peopleId); }}
                    className="mt-1 flex flex-col items-stretch gap-1 rounded-md px-1 py-1 text-[9px] font-bold cursor-pointer"
                    style={{ background: generating ? MID : PAPER, color: INK }}>
                    <span className="text-center">{generating ? t('rpg.btn.conjuring') : t('rpg.btn.mountExpedition')}</span>
                    {generating && <span className="rpg-conjure-bar" />}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Back this chapter with an explorer club (optional). */}
      <div className="text-[11px] font-bold mb-1">{t('rpg.pick.backClubChapter')} <span style={{ opacity: 0.6 }}>{t('rpg.pick.optional')}</span></div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {SPONSOR_IDS.map(id => {
          const def = SPONSORS[id];
          const tier = hub.outfits[id] || 0;
          const boon = sponsorBoon(id, tier);
          const on = sponsorId === id;
          return (
            <button key={id} onClick={() => setSponsorId(on ? null : id)} className="rounded p-1.5 text-left"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
              <PixelSprite grid={SPRITES[clubSpriteKey(id)]} palette={spritePalette(clubSpriteKey(id))} px={2}
                           className="mb-0.5 rounded-sm" title={def.name} />
              <div className="text-[9px] font-bold leading-tight truncate" title={def.name}>{def.name}</div>
              <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.85 }}>{boon.label}</div>
              <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.7 }}>
                {t('rpg.sponsor.favours', { good: t('rpg.trade.' + def.favours) })}
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={openLodge} className="w-full rounded-md py-1.5 text-[10px] font-bold"
        style={{ background: PAPER, color: INK, border: `2px solid ${DARK}` }}>
        {t('rpg.lodge.fameFundsClubs')}
      </button>

      {/* Mid-saga abandon — deliberately discreet, parked at the very bottom so it
          is never a button you reach for by reflex (it forfeits everything). */}
      {!campaign.done && (
        <button onClick={() => { if (confirm(t('rpg.confirm.abandon'))) onRestart(); }}
          className="w-full mt-4 py-1 text-[9px]"
          style={{ background: 'transparent', color: INK, opacity: 0.45, textDecoration: 'underline' }}>
          {t('rpg.chapter.abandonSaga')}
        </button>
      )}
    </div>
  );
}

function SetupView(props: {
  step: 'world' | 'hero'; onBackToWorlds: () => void;
  theme: string; setTheme: (t: string) => void; generate: (themeArg?: string, peopleId?: string) => void; generating: boolean;
  setup: RpgSetupResult | null; heroIndex: number; setHeroIndex: (i: number) => void;
  mapSize: MapSize; setMapSize: (s: MapSize) => void;
  difficulty: Difficulty; setDifficulty: (d: Difficulty) => void;
  veterans: VeteranRecord[]; vetId: string | null; setVetId: (id: string | null) => void; forgetVeterans: () => void;
  worlds: CustomWorld[]; pickWorld: (w: CustomWorld) => void; removeWorld: (id: string) => void;
  startAdventure: () => void; hasSave: boolean; resume: () => void;
  hub: HubState; fame: number; openLodge: () => void;
  sponsorId: SponsorId | null; setSponsorId: (id: SponsorId | null) => void;
  preferredClass: string | null; setPreferredClass: (c: string | null) => void;
  onDonate: () => { ok: boolean; fameGained: number };
}) {
  const { step, onBackToWorlds, theme, setTheme, generate, generating, setup, heroIndex, setHeroIndex, mapSize, setMapSize,
    difficulty, setDifficulty, veterans, vetId, setVetId, forgetVeterans,
    worlds, pickWorld, removeWorld, startAdventure, hasSave, resume, hub, fame, openLodge,
    sponsorId, setSponsorId, preferredClass, setPreferredClass, onDonate } = props;

  // Which world vignette is currently picked — drives the in-card Generate / Play
  // button that appears inside the selected card (the two-tap create flow).
  const [sel, setSel] = useState<{ kind: 'preset' | 'world' | 'dest'; id: string } | null>(null);
  // Transient court feedback after a tribute lands (+fame flash on the banner).
  const [tribute, setTribute] = useState<number | null>(null);
  useEffect(() => {
    if (tribute === null) return;
    const t = setTimeout(() => setTribute(null), 2600);
    return () => clearTimeout(t);
  }, [tribute]);

  // ── Step 2: the chosen world is generated; pick hero, size & difficulty ──
  if (step === 'hero' && setup) {
    return (
      <div className="p-4" style={{ color: INK, fontFamily: 'monospace' }}>
        <button onClick={onBackToWorlds}
          className="mb-3 rounded-md px-2.5 py-1.5 text-[11px] font-bold"
          style={{ background: MID, color: INK }}>
          {t('rpg.pick.backToWorlds')}
        </button>
        <div className="text-[13px] font-bold">{setup.title}</div>
          <div className="text-[10px] leading-snug mb-2" style={{ opacity: 0.85 }}>{setup.intro}</div>
          <div className="text-[10px] mb-2 rounded px-2 py-1" style={{ background: PAPER }}>
            <span className="font-bold">{t('rpg.pick.quest')}</span> {setup.quest.title} — {setup.quest.desc}
          </div>
          <div className="text-[11px] font-bold mb-1">{t('rpg.pick.hero')}</div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {setup.heroes.map((h, i) => (
              <button key={i} onClick={() => setHeroIndex(i)}
                className="rounded p-1.5 text-left"
                style={{ background: heroIndex === i ? INK : PAPER, color: heroIndex === i ? PAPER : INK, border: `2px solid ${DARK}` }}>
                <div className="flex justify-center mb-0.5">
                  <HeroPortrait cls={h.className} px={3} />
                </div>
                <div className="text-[11px] font-bold">{h.className}</div>
                <div className="text-[9px] leading-tight" style={{ opacity: 0.85 }}>{h.blurb}</div>
              </button>
            ))}
          </div>
          <div className="text-[11px] font-bold mb-1">{t('rpg.pick.worldSize')}</div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {MAP_SIZES.map(s => (
              <button key={s.id} onClick={() => setMapSize(s.id)}
                className="rounded p-1.5 text-center"
                style={{ background: mapSize === s.id ? INK : PAPER, color: mapSize === s.id ? PAPER : INK, border: `2px solid ${DARK}` }}>
                <div className="text-[11px] font-bold">{t('rpg.size.' + s.id)}</div>
                <div className="text-[9px] leading-tight" style={{ opacity: 0.85 }}>{t('rpg.size.' + s.id + '.hint')}</div>
              </button>
            ))}
          </div>
          <div className="text-[11px] font-bold mb-1">{t('rpg.pick.difficulty')}</div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {DIFFICULTIES.map(d => (
              <button key={d.id} onClick={() => setDifficulty(d.id)}
                className="rounded p-1.5 text-center"
                style={{ background: difficulty === d.id ? INK : PAPER, color: difficulty === d.id ? PAPER : INK, border: `2px solid ${DARK}` }}>
                <div className="text-[11px] font-bold">{t('rpg.diff.' + d.id)}</div>
                <div className="text-[9px] leading-tight" style={{ opacity: 0.85 }}>{t('rpg.diff.' + d.id + '.hint')}</div>
              </button>
            ))}
          </div>
          {/* The explorer picked back in the hall — a veteran replaces the rolled
              hero outright; an archetype just pre-selects the matching roll. */}
          {(vetId || preferredClass) && (() => {
            const vet = vetId ? veterans.find(v => v.char.id === vetId) : undefined;
            const cls = vet ? vet.char.className : (preferredClass || 'Hero');
            return (
              <div className="text-[10px] mb-3 rounded px-2 py-1.5 flex items-center gap-1.5" style={{ background: PAPER }}>
                <PixelSprite grid={SPRITES[classSpriteKey(cls)]} px={2} palette={spritePalette(classSpriteKey(cls))} />
                <span>
                  <span className="font-bold">{t('rpg.pick.explorer')}</span>{' '}
                  {vet
                    ? t('rpg.pick.vetExplorer', { name: vet.char.name, lvl: vet.char.level, cls: vet.char.className })
                    : t('rpg.pick.archExplorer', { cls: preferredClass || '' })}
                </span>
              </div>
            );
          })()}
          {/* Sponsor — back the run with an explorer club for a starting boon and
              its rank xp on return. Boon scales with the tier outfitted in the
              lodge. Optional: tap again to go unbacked. Names are LLM-themed to the
              world when the model minted them, else the house default. */}
          <div className="text-[11px] font-bold mb-1">{t('rpg.pick.backClubRun')} <span style={{ opacity: 0.6 }}>{t('rpg.pick.optional')}</span></div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {SPONSOR_IDS.map(id => {
              const def = SPONSORS[id];
              const tier = hub.outfits[id] || 0;
              const boon = sponsorBoon(id, tier);
              const themed = setup.sponsors?.find(s => s.archetype === id)?.name;
              const on = sponsorId === id;
              return (
                <button key={id} onClick={() => setSponsorId(on ? null : id)}
                  className="rounded p-1.5 text-left"
                  style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
                  <PixelSprite grid={SPRITES[clubSpriteKey(id)]} palette={spritePalette(clubSpriteKey(id))} px={2}
                           className="mb-0.5 rounded-sm" title={def.name} />
                  <div className="text-[9px] font-bold leading-tight truncate" title={themed || def.name}>{themed || def.name}</div>
                  <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.85 }}>{boon.label}</div>
                  <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.7 }}>
                    {t('rpg.sponsor.favours', { good: t('rpg.trade.' + def.favours) })}
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={startAdventure}
            className="w-full rounded-md py-2 text-[13px] font-bold"
            style={{ background: DARK, color: PAPER }}>
            {t('rpg.pick.beginAdventure')}
          </button>
          {setup.fallback && (
            <div className="text-[9px] mt-1 text-center" style={{ opacity: 0.6 }}>{t('rpg.setup.offlineWorld')}</div>
          )}
      </div>
    );
  }

  // ── Step 1: the Expedition Hall (CE2 main screen) ───────────────────────────
  // Reading order mirrors the outer loop: WHO leads (explorer first), the King's
  // Court (donate brought-back treasure → renown, story act), the Great Race
  // (season standings against rival explorers), then WHERE the expedition goes
  // (procedural destination board, mixed with preset tales and the player's own
  // conjured worlds — never replacing them). Every number is client-owned.
  const rk = renownTier(fame);
  const act = storyAct(hub.contractsFulfilled);
  const standings = seasonStandings(hub, fame);
  const dests = destinationBoard(hub);
  const topFame = Math.max(1, ...standings.map(s => s.fame));
  const canTribute = hub.funds >= CROWN_DONATION_STEP;
  return (
    <div className="p-4" style={{ color: INK, fontFamily: 'monospace' }}>
      {hasSave && (
        <button onClick={resume} className="w-full mb-3 rounded-md py-2 text-[12px] font-bold"
          style={{ background: INK, color: PAPER }}>
          {t('rpg.continue.saved')}
        </button>
      )}

      {/* The King's Court — renown, story act, treasury, and the tribute that
          turns brought-back treasure into fame (the race score). */}
      <div className="mb-3 rounded-md px-2.5 py-2" style={{ background: INK, color: PAPER, border: `2px solid ${DARK}` }}>
        <div className="flex items-center justify-between gap-2">
          <button onClick={openLodge} className="flex items-center gap-2 min-w-0 text-left">
            <span style={{ fontSize: 16, color: '#d9b65c' }}>♕</span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold truncate">
                {rk.name}{rk.stars > 0 ? ` ${'★'.repeat(Math.min(rk.stars, 5))}` : ''} {t('rpg.crown.ofCrown')}
              </div>
              <div className="text-[8px] truncate" style={{ opacity: 0.8 }}>
                {t('rpg.crown.actLine', { a: act.act, name: act.name, n: hub.expeditions, exp: hub.expeditions === 1 ? t('rpg.w.expedition') : t('rpg.w.expeditions') })}
              </div>
            </div>
          </button>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold mb-1">
              <span title={t('rpg.hud.funds')}>◈ {hub.funds}</span>
              <span title={t('rpg.hud.tickets')} style={{ marginLeft: 6 }}>✦ {hub.tickets}</span>
            </div>
            <button onClick={() => { const r = onDonate(); if (r.ok) setTribute(r.fameGained); }}
              disabled={!canTribute}
              className="rounded px-1.5 py-0.5 text-[8px] font-bold"
              style={{ background: canTribute ? '#d9b65c' : MID, color: INK, opacity: canTribute ? 1 : 0.55 }}>
              {t('rpg.crown.tribute', { step: CROWN_DONATION_STEP, fame: CROWN_FAME_PER_DONATION })}
            </button>
          </div>
        </div>
        {tribute !== null && (
          <div className="text-[9px] font-bold mt-1" style={{ color: '#d9b65c' }}>
            {t('rpg.crown.applause', { n: tribute })}
          </div>
        )}
        {rk.next !== null && (
          <div className="mt-1.5 h-1.5 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}
            title={t('rpg.crown.nextRenownTitle', { fame, next: rk.next })}>
            <div className="h-full" style={{ width: `${Math.min(100, Math.round((fame / Math.max(1, rk.next)) * 100))}%`, background: '#d9b65c' }} />
          </div>
        )}
      </div>

      {/* 1 · the explorer — picked before anything else (CE2 character-first). */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[12px] font-bold">{t('rpg.setup.yourExplorer')}</div>
        <SetupLanguagePicker />
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {EXPLORER_ARCHETYPES.map(a => {
          const on = !vetId && preferredClass === a.name;
          return (
            <button key={a.name} onClick={() => { setVetId(null); setPreferredClass(on ? null : a.name); }}
              className="rounded p-1.5 text-left"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
              <div className="flex justify-center mb-0.5">
                <HeroPortrait cls={a.name} px={2} />
              </div>
              <div className="text-[10px] font-bold text-center">{a.name}</div>
              <div className="text-[8px] leading-tight text-center" style={{ opacity: 0.8 }}>{a.epithet}</div>
            </button>
          );
        })}
      </div>
      {veterans.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-bold" style={{ opacity: 0.85 }}>{t('rpg.crown.summonVet')}</div>
            <button onClick={forgetVeterans} className="text-[9px] font-bold" style={{ opacity: 0.6 }}>{t('rpg.setup.forgetAll')}</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {veterans.map(v => {
              const on = vetId === v.char.id;
              return (
                <button key={v.char.id} onClick={() => { setPreferredClass(null); setVetId(on ? null : v.char.id); }}
                  className="rounded p-1.5 text-left flex items-center gap-1.5"
                  style={{ background: on ? INK : PAPER, color: on ? PAPER : INK, border: `2px solid ${DARK}` }}>
                  <HeroPortrait cls={v.char.className} px={2} />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold truncate">{v.char.name} · L{v.char.level}</div>
                    <div className="text-[8px] leading-tight truncate" style={{ opacity: 0.85 }}>
                      {v.char.className}{v.ngPlus > 0 ? ` · NG+${v.ngPlus}` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The Great Race — the season's fame standings against rival explorers.
          Rivals advance deterministically with each return (seasonStandings). */}
      <div className="mb-3 rounded-md p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
        <div className="text-[9px] font-bold mb-1" style={{ color: '#7a5a1f' }}>{t('rpg.race.standings')}</div>
        {standings.map(r => (
          <div key={r.name} className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-bold w-3 text-right shrink-0" style={{ opacity: 0.7 }}>{r.rank}</span>
            <span className="text-[9px] w-3 text-center shrink-0"
              style={{ color: r.nemesis ? '#7a1f1f' : r.you ? INK : '#7a5a1f' }}>{r.glyph}</span>
            <span className="text-[9px] w-24 truncate shrink-0"
              style={{ color: r.nemesis ? '#7a1f1f' : INK, fontWeight: r.you ? 700 : 500, opacity: r.you ? 1 : 0.85 }}>
              {r.name}{r.nemesis ? ' ☠' : ''}
            </span>
            <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.12)' }}>
              <div className="h-full" style={{
                width: `${Math.round((r.fame / topFame) * 100)}%`,
                background: r.you ? INK : r.nemesis ? '#7a1f1f' : '#b08a3e',
              }} />
            </div>
            <span className="text-[9px] w-10 text-right shrink-0" style={{ opacity: 0.8 }}>{r.fame}</span>
          </div>
        ))}
        <div className="text-[8px] mt-1" style={{ opacity: 0.7 }}>
          {t('rpg.race.rivalsAdvance')}
        </div>
      </div>

      {/* Active commission reminder — what this next run is chasing (lots 4 & 5). */}
      {hub.activeContract && (
        <button onClick={openLodge}
          className="w-full mb-3 rounded-md px-2.5 py-1.5 text-left"
          style={{ background: PAPER, color: INK, border: `2px solid #7a5a1f` }}>
          <div className="text-[9px] font-bold flex items-center gap-1" style={{ color: '#7a5a1f' }}>
            {t('rpg.crown.commission', { name: hub.activeContract.name })}
          </div>
          <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.75 }}>
            {contractCondText(hub.activeContract.cond)}
          </div>
        </button>
      )}

      {/* 2 · WHERE the expedition goes — the procedural destination board. The
          pick shapes the generated world (theme line, biome, size, difficulty). */}
      <div className="text-[12px] font-bold mb-1.5">{t('rpg.crown.whereGo')}</div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {dests.map(d => {
          const on = sel?.kind === 'dest' && sel.id === d.id;
          return (
            <button key={d.id} onClick={() => { setSel({ kind: 'dest', id: d.id }); setTheme(d.theme); }}
              className="text-left rounded-lg overflow-hidden relative"
              style={{ background: on ? INK : PAPER, color: on ? PAPER : INK,
                outline: on ? `3px solid ${INK}` : 'none', outlineOffset: 1, borderLeft: `4px solid ${peopleAccent(d.peopleId)}` }}>
              <SceneDiorama node={destVignetteNode(d)} />
              <div className="px-1.5 py-1">
                <div className="text-[9px] font-bold leading-tight">{d.name}</div>
                <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.8 }}>{d.hook}</div>
                <DestEconomy d={d} on={on} t={t} />
                <div className="flex flex-wrap gap-1 mt-1">
                  <CardChip label={d.size} on={on} />
                  <CardChip label={d.difficulty} on={on} />
                </div>
                {on && (
                  <span role="button" tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (generating) return;
                      setMapSize(d.size); setDifficulty(d.difficulty); generate(d.theme, d.peopleId);
                    }}
                    className="mt-1 flex flex-col items-stretch gap-1 rounded-md px-1 py-1 text-[9px] font-bold cursor-pointer"
                    style={{ background: generating ? MID : PAPER, color: INK }}>
                    <span className="text-center">{generating ? t('rpg.btn.conjuring') : t('rpg.btn.mountExpedition')}</span>
                    {generating && <span className="rpg-conjure-bar" />}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-[11px] font-bold mb-1" style={{ opacity: 0.85 }}>{t('rpg.setup.classicTale')}</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {SCENARIOS.map(s => {
          const on = sel?.kind === 'preset' && sel.id === s.id;
          return (
            <button key={s.id} onClick={() => { setSel({ kind: 'preset', id: s.id }); setTheme(s.name); }}
              className="text-left rounded-lg overflow-hidden relative"
              style={{
                background: on ? INK : PAPER, color: on ? PAPER : INK,
                outline: on ? `3px solid ${INK}` : 'none', outlineOffset: 1,
              }}>
              <div className="relative">
                <SceneDiorama node={vignetteNode(s)} />
                <div className="absolute" style={{ left: 6, bottom: 10, zIndex: 6 }}>
                  <PixelSprite grid={SPRITES[classSpriteKey(s.hero)]} px={3} palette={spritePalette(classSpriteKey(s.hero))} />
                </div>
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-bold">{s.name}</div>
                <div className="text-[9px] leading-tight" style={{ opacity: 0.85 }}>{s.brief}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <CardChip label={s.hero} on={on} />
                  <CardChip label={s.decor} on={on} />
                </div>
                {on && (
                  <span
                    role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); if (!generating) generate(); }}
                    className="mt-1.5 flex flex-col items-stretch gap-1 rounded-md px-2 py-1.5 text-[11px] font-bold cursor-pointer"
                    style={{ background: generating ? MID : PAPER, color: INK }}>
                    <span className="text-center">{generating ? t('rpg.btn.conjuring') : t('rpg.btn.generate')}</span>
                    {generating && <span className="rpg-conjure-bar" />}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {worlds.length > 0 && (
        <>
          <div className="text-[11px] font-bold mb-1" style={{ opacity: 0.85 }}>{t('rpg.setup.conjuredWorlds')}</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {worlds.map(w => {
              const on = sel?.kind === 'world' && sel.id === w.id;
              const hero = w.setup.heroes[0]?.className || 'Hero';
              return (
                <button key={w.id} onClick={() => setSel({ kind: 'world', id: w.id })}
                  className="text-left rounded-lg overflow-hidden relative"
                  style={{
                    background: on ? INK : PAPER, color: on ? PAPER : INK,
                    outline: on ? `3px solid ${INK}` : 'none', outlineOffset: 1,
                  }}>
                  <div className="relative">
                    <SceneDiorama node={customVignetteNode(w)} />
                    <div className="absolute" style={{ left: 6, bottom: 10, zIndex: 6 }}>
                      <PixelSprite grid={SPRITES[classSpriteKey(hero)]} px={3} palette={spritePalette(classSpriteKey(hero))} />
                    </div>
                    <span
                      role="button" tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); removeWorld(w.id); }}
                      title={t('rpg.crown.deleteWorld')}
                      className="absolute flex items-center justify-center rounded-full text-[12px] font-bold cursor-pointer"
                      style={{ right: 4, top: 4, zIndex: 7, width: 18, height: 18, background: '#7a1f1f', color: PAPER }}>
                      ×
                    </span>
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="text-[11px] font-bold truncate">{w.setup.title}</div>
                    <div className="text-[9px] leading-tight truncate" style={{ opacity: 0.85 }}>{w.setup.quest.title}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <CardChip label={hero} on={on} />
                      <CardChip label={t('rpg.crown.sites', { n: w.setup.locations.length })} on={on} />
                      <CardChip label={t('rpg.crown.heroesCount', { n: w.setup.heroes.length })} on={on} />
                    </div>
                    {on && (
                      <span
                        role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); pickWorld(w); }}
                        className="mt-1.5 flex items-center justify-center rounded-md py-1.5 text-[11px] font-bold cursor-pointer"
                        style={{ background: PAPER, color: INK }}>
                        {t('rpg.crown.enterWorld')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <input value={theme} onChange={e => { setTheme(e.target.value); setSel(null); }}
        placeholder={t('rpg.crown.themePlaceholder')}
        className="w-full rounded px-2 py-1.5 text-[12px] mb-2 outline-none"
        style={{ background: PAPER, color: INK, border: `2px solid ${DARK}` }} />
      <button onClick={() => generate()} disabled={generating || !theme.trim()}
        className="w-full flex flex-col items-stretch gap-1 rounded-md py-2 px-2 text-[12px] font-bold mb-1"
        style={{ background: generating || !theme.trim() ? MID : INK, color: generating ? INK : PAPER, opacity: !generating && !theme.trim() ? 0.7 : 1 }}>
        <span className="text-center">{generating ? t('rpg.btn.conjuring') : t('rpg.btn.generateWorld')}</span>
        {generating && <span className="rpg-conjure-bar" />}
      </button>
    </div>
  );
}

// ── World map ─────────────────────────────────────────────────────────────────

// The world map is FULL COLOUR — the Game Boy ramp (--gb-*) is reserved for UI
// chrome (medallions, name plates, frame, compass, overlays), never the terrain.
// Each node kind paints a vivid flat territory colour; `icons` is a small motif
// pool drawn sparse and crisp inside the region (coloured via ICON_RAMP below).
// Ten distinct CE2-grade grounds — each a clearly different hue + its own motif
// sprites. A tile's terrain comes from the climate field (terrain.ts); a place's
// own tile + ring is pinned to its matched ground (NODE_TERRAIN). This is the
// tile diversity: sea + fog + these ten = twelve distinct tile looks, ≥ CE2.
const TERRAIN_PAINT: Record<Terrain, { fill: string; icons: string[]; density: number }> = {
  grass:    { fill: 'oklch(81% 0.13 134)',  icons: ['map_grass', 'map_flower', 'map_grass'], density: 0.4  },
  forest:   { fill: 'oklch(56% 0.13 150)',  icons: ['map_pine', 'map_tree', 'map_tree'],     density: 0.85 },
  jungle:   { fill: 'oklch(47% 0.15 158)',  icons: ['map_tree', 'map_reed', 'map_tree'],     density: 0.95 },
  savanna:  { fill: 'oklch(79% 0.12 108)',  icons: ['map_grass', 'map_hill', 'map_reed'],    density: 0.5  },
  desert:   { fill: 'oklch(87% 0.10 82)',   icons: ['map_dune', 'map_dune', 'map_rock'],     density: 0.55 },
  marsh:    { fill: 'oklch(58% 0.07 176)',  icons: ['map_reed', 'map_water', 'map_reed'],    density: 0.7  },
  hills:    { fill: 'oklch(68% 0.09 112)',  icons: ['map_hill', 'map_rock', 'map_hill'],     density: 0.7  },
  mountain: { fill: 'oklch(61% 0.02 255)',  icons: ['map_mountain', 'map_rock'],             density: 0.9  },
  snow:     { fill: 'oklch(93% 0.015 230)', icons: ['map_snow', 'map_mountain'],             density: 0.7  },
  badlands: { fill: 'oklch(60% 0.10 46)',   icons: ['map_rock', 'map_crack', 'map_rubble'],  density: 0.6  },
};

// A real 4-shade colour ramp per map motif (K darkest → L lightest, R accent),
// so trees are green, peaks are snow-capped grey, dunes are sand, etc. — proper
// colour, not the GB ink ramp. Keyed by sprite name; unknown keys fall back.
const ICON_RAMP: Record<string, Record<string, string>> = {
  map_tree:     { K: 'oklch(34% 0.10 150)', D: 'oklch(45% 0.13 150)', M: 'oklch(56% 0.15 148)', L: 'oklch(68% 0.16 140)', R: 'oklch(40% 0.08 60)' },
  map_pine:     { K: 'oklch(30% 0.09 160)', D: 'oklch(40% 0.12 158)', M: 'oklch(50% 0.14 155)', L: 'oklch(62% 0.15 150)', R: 'oklch(38% 0.08 60)' },
  map_grass:    { K: 'oklch(52% 0.13 140)', D: 'oklch(62% 0.15 138)', M: 'oklch(72% 0.16 135)', L: 'oklch(82% 0.15 130)', R: 'oklch(72% 0.16 135)' },
  map_reed:     { K: 'oklch(55% 0.12 110)', D: 'oklch(66% 0.14 108)', M: 'oklch(76% 0.15 105)', L: 'oklch(85% 0.14 100)', R: 'oklch(76% 0.15 105)' },
  map_flower:   { K: 'oklch(55% 0.13 140)', D: 'oklch(70% 0.15 135)', M: 'oklch(72% 0.18 20)',  L: 'oklch(84% 0.16 350)', R: 'oklch(72% 0.18 20)' },
  map_rock:     { K: 'oklch(42% 0.02 250)', D: 'oklch(54% 0.02 250)', M: 'oklch(66% 0.02 250)', L: 'oklch(78% 0.02 250)', R: 'oklch(55% 0.05 60)' },
  map_hill:     { K: 'oklch(48% 0.06 120)', D: 'oklch(58% 0.08 115)', M: 'oklch(68% 0.09 110)', L: 'oklch(78% 0.08 105)', R: 'oklch(60% 0.08 110)' },
  map_mountain: { K: 'oklch(40% 0.02 260)', D: 'oklch(54% 0.02 258)', M: 'oklch(70% 0.015 255)', L: 'oklch(93% 0.01 250)', R: 'oklch(60% 0.03 60)' },
  map_snow:     { K: 'oklch(80% 0.02 230)', D: 'oklch(88% 0.015 225)', M: 'oklch(94% 0.01 220)', L: 'oklch(99% 0.005 220)', R: 'oklch(90% 0.01 220)' },
  map_dune:     { K: 'oklch(68% 0.08 80)',  D: 'oklch(76% 0.10 78)',  M: 'oklch(84% 0.11 75)',  L: 'oklch(90% 0.09 72)',  R: 'oklch(80% 0.10 75)' },
  map_cobble:   { K: 'oklch(45% 0.02 60)',  D: 'oklch(57% 0.025 60)', M: 'oklch(68% 0.03 65)',  L: 'oklch(80% 0.03 70)',  R: 'oklch(60% 0.05 60)' },
  map_rubble:   { K: 'oklch(42% 0.03 60)',  D: 'oklch(54% 0.04 65)',  M: 'oklch(66% 0.045 70)', L: 'oklch(78% 0.045 72)', R: 'oklch(58% 0.06 60)' },
  map_bone:     { K: 'oklch(70% 0.03 85)',  D: 'oklch(80% 0.035 88)', M: 'oklch(88% 0.03 90)',  L: 'oklch(95% 0.02 92)',  R: 'oklch(85% 0.03 90)' },
  map_crack:    { K: 'oklch(28% 0.05 25)',  D: 'oklch(38% 0.08 25)',  M: 'oklch(32% 0.05 300)', L: 'oklch(46% 0.07 300)', R: 'oklch(48% 0.18 25)' },
  map_water:    { K: 'oklch(45% 0.10 235)', D: 'oklch(55% 0.11 233)', M: 'oklch(66% 0.10 230)', L: 'oklch(78% 0.08 225)', R: 'oklch(66% 0.10 230)' },
};
const ICON_FALLBACK: Record<string, string> = { K: INK, D: DARK, M: MID, L: PAPER, R: '#7a1f1f' };

function spriteRects(grid: string[], ox: number, oy: number, px: number, pal: Record<string, string>, k: string) {
  const out: React.ReactElement[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const fill = pal[ch];
      if (!fill) { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      out.push(<rect key={`${k}-${x}-${y}`} x={ox + x * px} y={oy + y * px} width={run * px} height={px} style={{ fill }} />);
      x += run;
    }
  });
  return out;
}

// ── Painted-board terrain: a Curious-Expedition hex-tile board ────────────────
// The map reads like a tabletop board: a sea surrounds one organic landmass,
// laid out as a hex grid (see ./game/rpg/hexmap). Each tile takes the biome of
// its nearest discovered place and is veiled by parchment fog until exploration
// reaches it — fog clears in a small radius around every found place and along
// the charted roads. No procedural noise: tiling, biomes and fog are all
// deterministic from the world seed and the discovered-node set.

type Pt = [number, number];

// The coastline of the organic island, drawn from the SAME irregular shape the
// scatter confines places to (state.islandShape) — so the land the renderer
// paints and the land the places sit on are one and the same: no medallion on
// water. An irregular, non-elliptic rim sampled finely, joined by quadratic arcs
// through the edge midpoints so the outline is closed and fair.
function islandPath(seed: number, W: number, H: number): string {
  const profile = islandShape(seed);
  const cx = W / 2, cy = H / 2, rx = W * 0.5, ry = H * 0.5, N = 96;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rad = profile(a);                     // fraction of the half-extent, irregular per angle
    pts.push([cx + Math.cos(a) * rx * rad, cy + Math.sin(a) * ry * rad]);
  }
  const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[N - 1], pts[0]);
  let d = `M ${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 0; i < N; i++) {
    const cur = pts[i], m = mid(cur, pts[(i + 1) % N]);
    d += ` Q ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + ' Z';
}

// Tile size (centre-to-corner) scales with the canvas so the board keeps roughly
// the same tile COUNT (~a CE2 screenful) regardless of world size. Shared by the
// renderer and any consumer that needs to map a node to its hex.
function tileSize(W: number, H: number): number {
  return Math.max(18, Math.min(W, H) / 13);
}
// Parchment fog colour for a not-yet-charted tile.
const FOG_FILL = 'oklch(84% 0.045 88)';
const SEA_FILL = 'oklch(55% 0.12 235)';
const SEA_FILL_DEEP = 'oklch(48% 0.11 240)';

function TerrainLayer({ nodes, order, seed, W, H }: { nodes: Record<string, MapNode>; order: string[]; seed: number; W: number; H: number }) {
  // Unique element ids (clip/filter) per instance — several MapView copies can
  // mount with the same seed (world / scene / combat), so ids must not clash.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  // Geometry tracks the discovered-node set (id + flag + kind), so it belongs in
  // the memo key — tiles, biomes and fog all rebuild when discovery changes.
  const discSig = order.map(id => `${id}:${nodes[id].discovered ? 1 : 0}:${nodes[id].kind}`).join(',');
  return useMemo(() => {
    const fId = (s: string) => `${s}-${uid}`;
    const seen = order.map(id => nodes[id]).filter(n => n.discovered);
    const island = islandPath(seed || 1, W, H);
    const size = tileSize(W, H);

    // CE2-style hex board: every tile takes the biome of its nearest discovered
    // place and is veiled by fog until exploration reaches it. Fog clears in a
    // radius-2 disc around each found place and along the charted roads between
    // them (so the path you've walked stays lit, tile by tile).
    const nodeHexes: Hex[] = seen.map(n => pixelToHex({ x: n.x * W, y: n.y * H }, size));
    // A place pins its own tile + ring to the ground that matches its kind, so a
    // forest village reads on forest, a crypt on stone — the rest is pure climate.
    const poiTerrain = new Map<string, Terrain>();
    seen.forEach((n, i) => {
      const t = NODE_TERRAIN[n.kind];
      for (const ring of hexNeighbours(nodeHexes[i])) if (!poiTerrain.has(hexKey(ring))) poiTerrain.set(hexKey(ring), t);
    });
    seen.forEach((n, i) => poiTerrain.set(hexKey(nodeHexes[i]), NODE_TERRAIN[n.kind]));
    const corridorHexes: Hex[] = [];
    for (const n of seen) {
      for (const e of n.edges) {
        const m = nodes[e];
        if (!m || !m.discovered || m.id <= n.id) continue;     // dedupe each pair once
        const ax = n.x * W, ay = n.y * H, bx = m.x * W, by = m.y * H;
        const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / size));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          corridorHexes.push(pixelToHex({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t }, size));
        }
      }
    }
    const reveal = revealedKeys([...nodeHexes, ...corridorHexes], 2);
    const corridorLit = revealedKeys(corridorHexes, 1);   // a thinner reveal along roads

    const tiles = hexesCovering(W, H, size, 1);
    const tilePolys: React.ReactElement[] = [];
    const motifs: React.ReactElement[] = [];
    for (const h of tiles) {
      const c = hexToPixel(h, size);
      const k = hexKey(h);
      const revealed = reveal.has(k) || corridorLit.has(k);
      const land = insideIsland(c.x, c.y, seed || 1, W, H);
      // 2% inset so the tile seams read as a faint grid (CE2's tiled look).
      const pts = hexCorners(c, size * 0.97).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const terr: Terrain | null = land ? (poiTerrain.get(k) ?? terrainAt(h, seed || 1)) : null;
      let fill: string;
      if (!revealed) fill = FOG_FILL;
      else if (!terr) fill = SEA_FILL;
      else fill = TERRAIN_PAINT[terr].fill;
      tilePolys.push(
        <polygon key={`tl-${k}`} points={pts} style={{ fill }}
          stroke={revealed ? 'oklch(34% 0.04 70)' : 'oklch(70% 0.03 88)'}
          strokeWidth={revealed ? 0.6 : 0.4} strokeOpacity={revealed ? 0.5 : 0.7} strokeLinejoin="round" />
      );

      // One sparse biome motif on a fraction of the revealed LAND tiles — sprite
      // centred on the tile, coloured by its own ramp. Deterministic per tile.
      if (revealed && terr) {
        const paint = TERRAIN_PAINT[terr];
        const hsh = seedFrom(`tile:${seed}:${k}`);
        if (hsh % 100 < paint.density * 60) {
          const iconKey = paint.icons[hsh % paint.icons.length];
          const grid = SPRITES[iconKey];
          if (grid) {
            const gw = grid.reduce((m, row) => Math.max(m, row.length), 0), gh = grid.length;
            const px = size / Math.max(gw, gh) * 0.78;
            motifs.push(<g key={`mf-${k}`} opacity={0.92}>{spriteRects(grid, c.x - gw * px / 2, c.y - gh * px / 2, px, ICON_RAMP[iconKey] || ICON_FALLBACK, `mf${k}`)}</g>);
          }
        }
      }
    }

    return (
      <g style={{ pointerEvents: 'none' }}>
        <defs>
          <clipPath id={fId('land')}><path d={island} /></clipPath>
        </defs>

        {/* deep sea base + faint swell behind the tiles */}
        <rect x={0} y={0} width={W} height={H} style={{ fill: SEA_FILL_DEEP }} />
        {Array.from({ length: Math.ceil(H / 26) }).map((_, i) => (
          <line key={`wv-${i}`} x1={0} y1={i * 26 + 13} x2={W} y2={i * 26 + 13} strokeWidth={1} opacity={0.1} strokeDasharray="2 11" style={{ stroke: 'oklch(80% 0.08 230)' }} />
        ))}

        {/* the hex board: biome / sea / fog tiles, then sparse biome motifs */}
        {tilePolys}
        {motifs}

        {/* coastline — dark shore line + a pale surf highlight over the tiles */}
        <path d={island} fill="none" strokeWidth={2.2} strokeLinejoin="round" opacity={0.7} style={{ stroke: 'oklch(34% 0.06 70)' }} />
        <path d={island} fill="none" strokeWidth={1} strokeLinejoin="round" opacity={0.4} style={{ stroke: 'oklch(90% 0.06 90)' }} />
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discSig, seed, W, H, uid]);
}

// Gentle curved road between two map points — a deterministic perpendicular bow
// so roads look hand-drawn, not like a wiring diagram.
function roadPath(ax: number, ay: number, bx: number, by: number, key: string): string {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const off = ((seedFrom(key) % 100) / 100 - 0.5) * Math.min(34, len * 0.16);
  return `M ${ax} ${ay} Q ${mx + nx * off} ${my + ny * off} ${bx} ${by}`;
}

// Tiny creature sprite, centred on the origin so it can ride a motion path.
function critterRects(key: string, px: number, flip: boolean) {
  const grid = SPRITES[key];
  if (!grid) return null;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const rows = grid.length;
  const inner = spriteRects(grid, -(cols * px) / 2, -(rows * px) / 2, px, SPRITE_PALETTE, 'c-' + key);
  return flip ? <g transform="scale(-1,1)">{inner}</g> : <g>{inner}</g>;
}

const ROAD_CRITTERS = ['crit_traveler', 'crit_cart', 'crit_horse'];
const WILD_CRITTERS: Record<string, string[]> = {
  forest: ['crit_deer', 'crit_rabbit', 'crit_bird', 'crit_boar'],
  wild: ['crit_boar', 'crit_snake', 'crit_rabbit', 'crit_bird'],
  village: ['crit_rat', 'crit_bird', 'crit_rabbit'],
  town: ['crit_rat', 'crit_bird'],
  camp: ['crit_rabbit', 'crit_bird', 'crit_rat'],
  ruin: ['crit_bat', 'crit_rat'],
  cave: ['crit_bat'],
  dungeon: ['crit_bat'],
};

// Little signs of life on the map: a capped subset of roads carries travellers
// drifting city-to-city, and a few discovered places get a wild creature roaming
// a small loop in its biome's flavour. Deterministic per road/node so they stay
// put, and count-capped so the map never gets busy.
function MapCritters({ roads, nodes, order, W, H }: {
  roads: { key: string; d: string }[];
  nodes: Record<string, MapNode>;
  order: string[];
  W: number;
  H: number;
}) {
  const travelers = roads
    .filter(r => seedFrom('trav:' + r.key) % 3 === 0)
    .slice(0, 5)
    .map(r => {
      const s = seedFrom('trav:' + r.key);
      return {
        key: 'tr-' + r.key,
        d: r.d,
        sprite: ROAD_CRITTERS[s % ROAD_CRITTERS.length],
        reverse: (s >> 3) % 2 === 0,
        dur: 16 + (s % 14),
        delay: s % 6,
      };
    });

  const roamers = order
    .map(id => nodes[id])
    .filter(n => n.discovered)
    .flatMap(n => {
      const s = seedFrom('roam:' + n.id);
      if (s % 5 >= 2) return [];
      const cx = n.x * W, cy = n.y * H;
      const pool = WILD_CRITTERS[n.kind] || WILD_CRITTERS.wild;
      const ox = cx + ((s % 2) ? 24 : -24), oy = cy - 16;
      return [{
        key: 'rm-' + n.id,
        d: `M ${ox - 11} ${oy} q 11 -7 22 0 q -11 7 -22 0`,
        sprite: pool[s % pool.length],
        reverse: (s >> 2) % 2 === 0,
        dur: 12 + (s % 10),
        delay: s % 5,
      }];
    })
    .slice(0, 6);

  const all = [...travelers, ...roamers];
  return (
    <g style={{ pointerEvents: 'none' }}>
      {all.map(c => (
        <g key={c.key} opacity={0.9}>
          {critterRects(c.sprite, 1.4, c.reverse)}
          <animateMotion path={c.d} dur={`${c.dur}s`} begin={`${c.delay}s`}
            repeatCount="indefinite" rotate="0"
            keyPoints={c.reverse ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
        </g>
      ))}
    </g>
  );
}

// Remembers each world's map framing (zoom + pan) so leaving the map (travel,
// scene, combat…) and coming back lands on the exact same view. Keyed by world
// seed; module-scoped so it survives MapView unmount/remount across phases.
const MAP_TRANSFORM_CACHE = new Map<string, { scale: number; x: number; y: number }>();

function MapView({ state, onTravel }: { state: RpgState; onTravel: (id: string) => void }) {
  // The map grows physically with the world: more places → more pixels, so the
  // medallions keep a roughly constant on-screen spacing (no more cramming).
  const { W, H } = mapDimensions(state.order.length);
  const cur = state.currentNodeId;
  const reachable = new Set(state.nodes[cur].edges);

  // Fit the base zoom to *this* viewport, not a hardcoded width (which left wide
  // screens absurdly zoomed-out). minScale = this fit, so the player can never
  // zoom out past the whole map — that keeps the pan bounds hugging the map
  // instead of floating in empty margins. We measure before mounting the
  // pan/zoom layer so the initial scale is right on first paint.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ready = box.w > 0 && box.h > 0;
  const fit = ready ? Math.min(box.w / W, box.h / H) : Math.min(1, 360 / W);
  const seedKey = String(state.seed);
  const cached = MAP_TRANSFORM_CACHE.get(seedKey);

  // Build the discovered road network once, reused for drawing and critters.
  const roads: { key: string; d: string; live: boolean }[] = [];
  const drawn = new Set<string>();
  for (const id of state.order) {
    for (const nb of state.nodes[id].edges) {
      const key = [id, nb].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const a = state.nodes[id], b = state.nodes[nb];
      if (!a.discovered || !b.discovered) continue;
      roads.push({ key, d: roadPath(a.x * W, a.y * H, b.x * W, b.y * H, key), live: id === cur || nb === cur });
    }
  }

  return (
    <div ref={boxRef} className="relative h-full" style={{ minHeight: 360, background: SCREEN_BG }}>
      {ready && (
      <TransformWrapper
        key={`${state.seed}:${W}x${H}`}
        minScale={fit}
        maxScale={Math.max(fit * 6, 4)}
        initialScale={cached?.scale ?? fit}
        initialPositionX={cached?.x}
        initialPositionY={cached?.y}
        centerOnInit={!cached}
        limitToBounds
        doubleClick={{ mode: 'zoomIn' }}
        onTransform={(_r, s) => MAP_TRANSFORM_CACHE.set(seedKey, { scale: s.scale, x: s.positionX, y: s.positionY })}
      >
        {/* content is the natural-sized svg (W×H) so the pan bounds wrap the
            actual map, not the viewport */}
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
            <defs>
              {/* soft vignette so the map edges sink into the frame */}
              <radialGradient id="mapVignette" cx="50%" cy="48%" r="68%">
                <stop offset="55%" stopColor={INK} stopOpacity={0} />
                <stop offset="100%" stopColor={INK} stopOpacity={0.34} />
              </radialGradient>
            </defs>

            {/* generated terrain — biomes grown from discovered nodes */}
            <TerrainLayer nodes={state.nodes} order={state.order} seed={state.seed} W={W} H={H} />
            <rect x={0} y={0} width={W} height={H} style={{ fill: 'url(#mapVignette)', pointerEvents: 'none' }} />

            {/* roads — casing + lighter surface + dashed centerline; lit when
                they lead out of the current place */}
            {roads.map(({ key, d, live }) => (
              <g key={key} style={{ pointerEvents: 'none' }}>
                <path d={d} fill="none" strokeLinecap="round" strokeWidth={live ? 8 : 6} opacity={0.5} style={{ stroke: INK }} />
                <path d={d} fill="none" strokeLinecap="round" strokeWidth={live ? 4.5 : 3} opacity={live ? 1 : 0.8} style={{ stroke: live ? PAPER : MID }} />
                <path d={d} fill="none" strokeLinecap="round" strokeWidth={1} strokeDasharray="1 6" opacity={0.7} style={{ stroke: DARK }} />
              </g>
            ))}

            {/* tiny moving creatures — road traffic + wild fauna */}
            <MapCritters roads={roads} nodes={state.nodes} order={state.order} W={W} H={H} />

            {/* nodes — medallions with name plates */}
            {state.order.map(id => {
              const n = state.nodes[id];
              if (!n.discovered) return null;
              const isCur = id === cur;
              const canGo = reachable.has(id);
              const isGoal = id === state.quest.goalNodeId;
              const known = n.scouted !== false;   // unscouted places show as "?" until visited/scouted
              const cx = n.x * W, cy = n.y * H;
              const r = isCur ? 19 : 16;
              const ring = isGoal ? '#7a1f1f' : isCur ? INK : DARK;
              const plateW = known ? Math.max(34, n.name.length * 5.2 + 10) : 22;
              const tip = known
                ? `${n.name} — ${n.cleared ? 'cleared' : n.danger > 0 ? `danger ${n.danger}` : 'safe'}${isCur ? ' · you are here' : canGo ? ' · tap to travel' : ''}`
                : 'Unknown — travel here or Look around to scout it';
              return (
                <g key={id} onClick={() => canGo && onTravel(id)} style={{ cursor: canGo ? 'pointer' : 'default' }}>
                  <title>{tip}</title>
                  {/* travel pulse on the current location */}
                  {isCur && (
                    <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={2} style={{ stroke: INK }}>
                      <animate attributeName="r" values={`${r};${r + 9};${r}`} dur="2.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.55;0;0.55" dur="2.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* slow red beacon on the goal so the finish line always draws the eye */}
                  {isGoal && !isCur && (
                    <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={2} style={{ stroke: '#7a1f1f' }}>
                      <animate attributeName="r" values={`${r};${r + 7};${r}`} dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.4;0;0.4" dur="3s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* drop shadow + medallion */}
                  <circle cx={cx} cy={cy + 1.5} r={r} style={{ fill: INK, opacity: 0.25 }} />
                  <circle cx={cx} cy={cy} r={r} strokeWidth={isCur ? 3.5 : 2.5}
                    style={{ fill: n.cleared ? MID : PAPER, stroke: ring }} />
                  <circle cx={cx} cy={cy} r={r - 3} fill="none" strokeWidth={1} style={{ stroke: INK, opacity: 0.22 }} />
                  {known
                    ? <MapMarker kind={n.kind} cx={cx} cy={cy} size={isCur ? 28 : 24} />
                    : <text x={cx} y={cy + (isCur ? 7 : 6)} textAnchor="middle" fontSize={isCur ? 20 : 17} fontWeight={700} style={{ fill: DARK, pointerEvents: 'none' }}>?</text>}

                  {/* goal pennant */}
                  {isGoal && (
                    <g style={{ pointerEvents: 'none' }}>
                      <line x1={cx + r - 2} y1={cy - r + 2} x2={cx + r - 2} y2={cy - r - 11} strokeWidth={1.5} style={{ stroke: INK }} />
                      <polygon points={`${cx + r - 2},${cy - r - 11} ${cx + r + 8},${cy - r - 8} ${cx + r - 2},${cy - r - 5}`} style={{ fill: '#7a1f1f' }} />
                    </g>
                  )}
                  {/* danger pips — hidden until the place is scouted */}
                  {known && n.danger > 0 && !n.cleared && (
                    <g style={{ pointerEvents: 'none' }}>
                      {Array.from({ length: n.danger }).map((_, i) => (
                        <circle key={i} cx={cx - r + 4 + i * 6} cy={cy - r} r={2.4} style={{ fill: '#7a1f1f', stroke: PAPER }} strokeWidth={0.6} />
                      ))}
                    </g>
                  )}
                  {/* cleared check */}
                  {n.cleared && (
                    <text x={cx + r - 3} y={cy - r + 6} fontSize={11} fontWeight={700} style={{ fill: INK, pointerEvents: 'none' }}>✓</text>
                  )}

                  {/* name plate */}
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={cx - plateW / 2} y={cy + r + 3} width={plateW} height={13} rx={3}
                      style={{ fill: INK, opacity: canGo || isCur ? 0.92 : 0.6 }} />
                    <text x={cx} y={cy + r + 12} textAnchor="middle" fontSize={8.5}
                      fontWeight={canGo || isCur ? 700 : 500}
                      style={{ fill: PAPER, fontFamily: 'monospace' }}>
                      {known ? n.name : '?'}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* rival expeditions — a marker on the node they currently occupy, shown
                once that node is discovered. The goal pennant already flags the finish. */}
            {(state.rivals || []).filter(rv => !rv.arrived && state.nodes[rv.nodeId]?.discovered).map(rv => {
              const n = state.nodes[rv.nodeId];
              const cx = n.x * W, cy = n.y * H;
              return (
                <g key={rv.id} style={{ pointerEvents: 'none' }}>
                  <title>{`${rv.name} — rival expedition (${Math.round(rv.progress * 100)}% to the prize)`}</title>
                  <circle cx={cx + 14} cy={cy - 14} r={8} style={{ fill: '#7a1f1f', stroke: PAPER }} strokeWidth={1.4} />
                  <text x={cx + 14} y={cy - 10.5} textAnchor="middle" fontSize={9} fontWeight={700}
                    style={{ fill: PAPER, fontFamily: 'monospace' }}>{rv.glyph}</text>
                </g>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
      )}

      {/* fixed map ornaments (outside the pan/zoom layer) */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 0 3px ${DARK}, inset 0 0 0 6px ${SCREEN_BG}, inset 0 0 0 7px ${INK}` }} />
      <div className="absolute top-2 right-2 pointer-events-none"><Compass /></div>
      <div className="absolute bottom-1.5 left-2 flex items-center gap-1 text-[9px] rounded px-1.5 py-0.5"
        style={{ color: PAPER, background: INK, opacity: 0.85, fontFamily: 'monospace' }}>
        <MapIcon size={11} /> drag to pan · scroll/pinch to zoom · tap a linked place to travel
      </div>
      <ExpeditionLedger state={state} />
    </div>
  );
}

// ── Expedition Ledger ─────────────────────────────────────────────────────────
// In-run "global adventure management" overlay (CE2 outer-loop visibility while
// you explore): the current objective + whether it's fulfilled, live progress on
// the active commission, the race standings against rival expeditions, and the
// story act. Collapsible, layered over the map. Pure presentation — every number
// comes from client helpers (questSatisfied / contractProgress / raceTracker /
// storyAct); nothing here is authored by the model.
function ExpeditionLedger({ state }: { state: RpgState }) {
  const [open, setOpen] = useState(false);
  const hub = loadHub();
  const objMet = questSatisfied(state);
  const race = raceTracker(state);
  const act = storyAct(hub.contractsFulfilled);
  const contract = hub.activeContract;
  const cp = contract ? contractProgress(contract, state) : null;
  const liveRivals = race.rivals.filter(r => !r.arrived);
  const topRival = liveRivals.reduce((m, r) => Math.max(m, r.pct), 0);
  const ahead = race.party >= topRival;

  if (!open) {
    // Collapsed: still a live race readout, not a bare button — the player must
    // never lose sight of the rivals' progress (CE2 race pressure, lot C).
    const chasing = liveRivals.slice().sort((a, b) => b.pct - a.pct).slice(0, 2);
    return (
      <button onClick={() => setOpen(true)}
        className="absolute top-2 left-2 rounded px-2 py-1 text-left"
        style={{ background: INK, color: PAPER, opacity: 0.92, fontFamily: 'monospace',
          pointerEvents: 'auto', width: 148 }}>
        <div className="flex items-center gap-1.5 text-[9px] font-bold">
          <ScrollText size={11} /> LEDGER
          {liveRivals.length > 0 && (
            <span style={{ color: ahead ? 'oklch(78% 0.16 145)' : '#e8a0a0' }}>
              {ahead ? '▲ leading' : '▼ behind'}
            </span>
          )}
        </div>
        {liveRivals.length > 0 && (
          <div className="mt-1">
            {[{ glyph: '◉', pct: race.party, color: PAPER, nem: false },
              ...chasing.map(r => ({ glyph: r.glyph, pct: r.pct, color: r.nemesis ? '#e8a0a0' : '#d9b65c', nem: r.nemesis }))]
              .map((row, i) => (
                <div key={i} className="flex items-center gap-1 mb-0.5">
                  <span className="text-[8px] w-3 text-center shrink-0" style={{ color: row.color }}>{row.glyph}</span>
                  <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}>
                    <div className="h-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, row.pct)) * 100)}%`, background: row.color, transition: 'width .3s' }} />
                  </div>
                </div>
              ))}
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="absolute top-2 left-2 rounded-md p-2.5"
      style={{ background: SCREEN_BG, color: INK, border: `2px solid ${INK}`,
        width: 226, maxWidth: '72%', fontFamily: 'monospace',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)', pointerEvents: 'auto', zIndex: 5 }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-bold flex items-center gap-1"><ScrollText size={11} /> EXPEDITION LEDGER</div>
        <button onClick={() => setOpen(false)} className="text-[11px] leading-none px-1" style={{ opacity: 0.7 }}>✕</button>
      </div>

      <div className="rounded px-2 py-1 mb-1.5" style={{ background: PAPER }}>
        <div className="text-[8px] font-bold" style={{ color: MID }}>OBJECTIVE</div>
        <div className="text-[9px] leading-tight">{objectiveLabel(state.quest)}</div>
        <div className="text-[8px] mt-0.5 font-bold" style={{ color: objMet ? 'oklch(50% 0.13 145)' : '#7a5a1f' }}>
          {objMet ? '✓ ready — reach the goal to claim it' : '… not yet fulfilled'}
        </div>
      </div>

      {liveRivals.length > 0 && (
        <div className="rounded px-2 py-1 mb-1.5" style={{ background: PAPER }}>
          <div className="text-[8px] font-bold mb-0.5" style={{ color: MID }}>THE RACE</div>
          <LedgerBar label="You" glyph="◉" pct={race.party} color={INK} />
          {liveRivals.slice(0, 3).map((r, i) => (
            <LedgerBar key={i} label={r.name} glyph={r.glyph} pct={r.pct}
              color={r.nemesis ? '#7a1f1f' : '#7a5a1f'} />
          ))}
        </div>
      )}

      {contract && cp && (
        <div className="rounded px-2 py-1 mb-1.5" style={{ background: PAPER, border: '1px solid #7a5a1f' }}>
          <div className="text-[8px] font-bold flex items-center justify-between" style={{ color: '#7a5a1f' }}>
            <span className="truncate">◆ {contract.name}</span>
            {cp.met && <span>✓</span>}
          </div>
          <div className="text-[8px] leading-tight" style={{ opacity: 0.8 }}>{cp.label}</div>
          <div className="text-[9px] font-bold mt-0.5">{cp.detail}</div>
        </div>
      )}

      <div className="text-[8px] leading-tight" style={{ opacity: 0.75 }}>
        <span className="font-bold">{t('rpg.w.act')} {act.act} · {act.name}</span> {t('rpg.crown.thisAct', { into: act.into, step: act.step })}
      </div>
    </div>
  );
}

// ── Travel overlay ────────────────────────────────────────────────────────────
// Plays out a journey: the party walks a road for travel.durationMs while a
// progress bar fills; the rolled en-route event reveals at travel.eventAt, then
// the client commits the arrival (arriveTravel). Pure presentation — every
// number was decided in beginTravel.
function TravelOverlay({ state, setState }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
}) {
  const t = state.travel!;
  const from = state.nodes[t.fromId];
  const to = state.nodes[t.toId];
  const hero = state.party[0];
  const [p, setP] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const e = Math.min(1, (now - start) / t.durationMs);
      setP(e);
      if (e < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(
      () => setState(s => (s && s.phase === 'travel') ? arriveTravel(s) : s),
      t.durationMs + 140,
    );
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.fromId, t.toId, t.durationMs]);

  const revealed = p >= t.eventAt && t.event !== 'none';
  const evColor = t.event === 'boon' ? 'oklch(62% 0.13 145)'
    : t.event === 'ambush' ? '#7a1f1f'
    : t.event === 'hazard' ? 'oklch(58% 0.15 50)'
    : INK;

  return (
    <div className="absolute inset-0 flex items-center justify-center px-5"
      style={{ background: 'rgba(43,32,22,0.72)', fontFamily: 'monospace' }}>
      <div className="w-full max-w-[300px] rounded-lg p-3.5"
        style={{ background: PAPER, color: INK, border: `3px solid ${INK}` }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider mb-1">
          <MapIcon size={13} /> ON THE ROAD
        </div>
        <div className="text-[10px] mb-3" style={{ opacity: 0.8 }}>
          {from.name} → <span className="font-bold">{to.name}</span>
        </div>

        {/* the walked road with the party trudging along it */}
        <div className="relative mb-2.5" style={{ height: 34 }}>
          <div className="absolute left-0 right-0" style={{ top: 24, height: 4, borderRadius: 2, background: MID }} />
          <div className="absolute left-0" style={{ top: 24, height: 4, width: `${p * 100}%`, borderRadius: 2, background: INK }} />
          {/* en-route event marker (lights up when reached) */}
          <div className="absolute" style={{ left: `${t.eventAt * 100}%`, top: 18, transform: 'translateX(-50%)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 9, background: revealed ? evColor : MID, border: `1px solid ${INK}` }} />
          </div>
          {/* start + destination pins */}
          <div className="absolute" style={{ left: 0, top: 19, width: 10, height: 10, borderRadius: 9, background: PAPER, border: `2px solid ${INK}` }} />
          <div className="absolute" style={{ right: 0, top: 19, width: 10, height: 10, borderRadius: 9, background: '#7a1f1f', border: `2px solid ${INK}` }} />
          {/* the party sprite walking the line */}
          <div className="absolute" style={{ left: `${p * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
            <PixelSprite grid={SPRITES[classSpriteKey(hero?.className || 'Hero')]} px={2} palette={spritePalette(classSpriteKey(hero?.className || 'Hero'))} />
          </div>
        </div>

        {/* flavour line: neutral until the event reveals */}
        <div className="text-[10px] leading-snug min-h-[26px]"
          style={{ color: revealed ? evColor : INK, fontWeight: revealed ? 700 : 400 }}>
          {revealed ? t.note : `The party sets out for ${to.name}…`}
        </div>
      </div>
    </div>
  );
}

// ── Dilemma ───────────────────────────────────────────────────────────────────
// A Curious-Expedition-style road choice. The player picks an approach; the
// client (state.ts) rolls the d20 and applies the consequence. This view only
// renders strings + the surfaced die — it never computes an outcome.
// ── Dice pool (the CE-style visible pool) ───────────────────────────────────
// One themed die per living member (+ item dice). The player tallies hits vs the
// required count, may push their luck (reroll the misses at a morale cost), then
// commits. Every face is rolled client-side in state.ts; this only renders + wires
// the buttons. Shared by the dilemma and the scene `search`.
// ── Juice layer ────────────────────────────────────────────────────────────────
// Transient, purely-cosmetic feedback over a live run. Watches the client-owned
// log tail (plus gold/morale) and floats a toast or a delta chip when something
// lands — a discovery, a cracked mind, a recovery, a desertion, a level, coin
// won/lost. It NEVER computes or mutates a number; it only echoes what state.ts
// already wrote (client-owns-numbers stays intact).
type Toast = { id: number; icon: string; text: string; color: string };

// Map a freshly-written log line to a toast badge, or null to stay quiet (most
// lines are routine and shouldn't pop). Keyed off the exact phrasings state.ts
// emits — see tickAfflictions / claimDiscovery / maybeDesert / leveling.
function classifyLogLine(line: string): { icon: string; color: string } | null {
  if (line.startsWith('Discovery —')) return { icon: '✦', color: '#3a2d6b' };
  if (line.startsWith('The strain tells:')) return { icon: '☠', color: '#7a1f1f' };
  if (line.startsWith('Spirits lift:')) return { icon: '✦', color: '#2f6b2f' };
  if (line.startsWith('Morale breaks:')) return { icon: '⚑', color: '#7a1f1f' };
  if (/reaches level \d/.test(line)) return { icon: '★', color: '#9a6a1f' };
  return null;
}

let toastSeq = 0;

function JuiceLayer({ state }: { state: RpgState }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Baselines from the last settle — seeded to the present so history never replays.
  const seenLen = useRef<number>(state.log.length);
  const lastGold = useRef<number>(state.gold || 0);
  const lastMorale = useRef<number>(state.morale ?? 0);

  useEffect(() => {
    const fresh: Toast[] = [];
    // High-signal events written since the last render.
    for (const l of state.log.slice(seenLen.current)) {
      const c = classifyLogLine(l);
      if (c) fresh.push({ id: ++toastSeq, icon: c.icon, color: c.color, text: l.length > 64 ? l.slice(0, 63) + '…' : l });
    }
    seenLen.current = state.log.length;
    // Coin swing — always worth a chip.
    const g = state.gold || 0;
    if (g !== lastGold.current) {
      const d = g - lastGold.current;
      fresh.push({ id: ++toastSeq, icon: d > 0 ? '＋' : '－', color: d > 0 ? '#9a6a1f' : '#7a1f1f', text: `${d > 0 ? '+' : ''}${d} gold` });
    }
    lastGold.current = g;
    // Morale only on a notable single-step swing — travel nudges it constantly.
    const m = state.morale ?? 0;
    if (Math.abs(m - lastMorale.current) >= 8) {
      const d = Math.round(m - lastMorale.current);
      fresh.push({ id: ++toastSeq, icon: '♥', color: d > 0 ? '#2f6b2f' : '#7a1f1f', text: `${d > 0 ? '+' : ''}${d} morale` });
    }
    lastMorale.current = m;

    if (fresh.length === 0) return;
    setToasts(prev => [...prev, ...fresh].slice(-5));
    const ids = fresh.map(t => t.id);
    setTimeout(() => setToasts(prev => prev.filter(t => !ids.includes(t.id))), 2600);
  }, [state]);

  return (
    <div className="absolute top-2 left-1/2 z-30 flex flex-col items-center gap-1"
      style={{ transform: 'translateX(-50%)', pointerEvents: 'none' }}>
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id}
            initial={{ opacity: 0, y: 14, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="rounded-full px-2.5 py-1 text-[10px] font-bold flex items-center gap-1.5 whitespace-nowrap"
            style={{ background: t.color, color: PAPER, border: '1px solid rgba(0,0,0,0.35)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)' }}>
            <span className="text-[11px] leading-none">{t.icon}</span>{t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function DicePoolOverlay({ state, setState, onContinue }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  onContinue: () => void;
}) {
  const p = state.dicePool!;
  const hits = poolHits(p);
  const canReroll = !p.resolved && p.rerollsUsed < p.maxRerolls
    && p.dice.some(die => !die.kept) && state.morale >= p.rerollCost;
  const outColor = p.outcome === 'success' ? '#2f6b2f' : p.outcome === 'partial' ? '#7a5a1f' : '#7a1f1f';
  return (
    <motion.div className="p-3 max-w-md mx-auto"
      style={{ color: PAPER, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="text-[11px] font-bold tracking-wider mb-2 flex items-center gap-1" style={{ opacity: 0.8 }}>
        <Dices size={12} /> DICE POOL · {POOL_STAT_LABEL[p.stat]}
      </div>
      <div className="rounded p-2.5 mb-2 text-[12px] leading-snug" style={{ background: 'rgba(0,0,0,0.25)' }}>
        {p.prompt}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2 justify-center">
        {p.dice.map(die => (
          // A banked hit holds its place; a miss re-tumbles on every reroll (its
          // key folds in rerollsUsed so it re-mounts and rolls again). Hits flash
          // a soft green glow — pure feedback, the face/bonus are state-owned.
          <motion.div key={die.kept ? die.id : `${die.id}-${p.rerollsUsed}`}
            initial={{ scale: 0.3, rotate: -150 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 16 }}
            className="flex flex-col items-center justify-center rounded font-bold relative"
            style={{
              width: 40, height: 44,
              background: die.hit ? '#2f6b2f' : '#7a1f1f', color: PAPER,
              border: die.item ? `2px dashed ${PAPER}` : `2px solid rgba(0,0,0,0.3)`,
              opacity: die.kept && !die.hit ? 0.6 : 1,
              boxShadow: die.hit ? '0 0 9px rgba(155,226,155,0.75)' : 'none',
            }}
            title={`${die.by}: ${die.face}${die.bonus ? `+${die.bonus}` : ''}${die.hit ? ' ✓' : ''}`}>
            <span className="text-[16px] leading-none">{die.face}</span>
            <span className="text-[7px] leading-none mt-0.5" style={{ opacity: 0.85 }}>
              {die.bonus ? `+${die.bonus}` : ''}{die.kept && die.hit ? ' ✓' : ''}
            </span>
          </motion.div>
        ))}
      </div>
      {/* Counter pops each time the hit tally changes (keyed on `hits`). */}
      <motion.div key={hits} initial={{ scale: 1.45 }} animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18 }}
        className="text-center text-[11px] font-bold mb-2"
        style={{ color: hits >= p.required ? '#9be29b' : PAPER }}>
        {hits} / {p.required} hits {hits >= p.required ? '— cleared' : 'needed'}
      </motion.div>

      {!p.resolved && (
        <div className="flex flex-col gap-1.5">
          <button onClick={() => setState(s => s ? rerollDicePool(s) : s)} disabled={!canReroll}
            className="rounded px-2.5 py-2 text-[11px] font-bold transition-colors"
            style={{ background: canReroll ? PAPER : 'rgba(255,255,255,0.25)', color: INK, opacity: canReroll ? 1 : 0.6 }}>
            Push your luck — reroll misses (−{p.rerollCost} morale · {p.rerollsUsed}/{p.maxRerolls})
          </button>
          <button onClick={() => setState(s => s ? commitDicePool(s) : s)}
            className="rounded px-2.5 py-2 text-[11px] font-bold self-stretch" style={{ background: '#2f6b2f', color: PAPER }}>
            Commit ({hits} hit{hits === 1 ? '' : 's'})
          </button>
        </div>
      )}

      {p.resolved && (
        <div className="flex flex-col gap-3">
          <div className="rounded p-2.5 text-[11px] leading-snug" style={{ background: outColor, color: PAPER }}>
            {p.resultText}
          </div>
          <button onClick={onContinue}
            className="rounded px-3 py-2 text-[11px] font-bold self-end" style={{ background: PAPER, color: INK }}>
            Continue →
          </button>
        </div>
      )}
    </motion.div>
  );
}

function DilemmaView({ state, setState }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
}) {
  // A stat-gated approach opens a visible dice pool; drive it to completion here.
  if (state.dicePool) {
    return <DicePoolOverlay state={state} setState={setState}
      onContinue={() => setState(s => s ? closeDicePool(s) : s)} />;
  }
  const d = state.dilemma!;
  const STAT_LABEL: Record<string, string> = { might: 'MIGHT', agility: 'AGILITY', wits: 'WITS', spirit: 'SPIRIT' };
  return (
    <motion.div className="p-3 max-w-md mx-auto"
      style={{ color: PAPER, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="text-[11px] font-bold tracking-wider mb-2 flex items-center gap-1" style={{ opacity: 0.8 }}>
        <Swords size={12} /> CROSSROADS
      </div>
      <div className="rounded p-2.5 mb-3 text-[12px] leading-snug" style={{ background: 'rgba(0,0,0,0.25)' }}>
        {d.prompt}
      </div>

      {!d.resolved && (
        <div className="flex flex-col gap-1.5">
          {d.options.map((o, i) => (
            <button key={i} onClick={() => setState(s => s ? resolveDilemma(s, i) : s)}
              className="text-left rounded px-2.5 py-2 text-[11px] font-bold transition-colors"
              style={{ background: PAPER, color: INK }}>
              <div className="flex items-center justify-between gap-2">
                <span>{o.label}</span>
                {o.stat
                  ? <span className="text-[9px] font-bold shrink-0" style={{ opacity: 0.7 }}>{STAT_LABEL[o.stat]} · DC {o.dc}</span>
                  : <span className="text-[9px] font-bold shrink-0" style={{ opacity: 0.7 }}>sure thing</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {d.resolved && (
        <div className="flex flex-col gap-3">
          {d.roll && (
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded font-bold text-[18px]"
                style={{ width: 44, height: 44, background: d.success ? '#2f6b2f' : '#7a1f1f', color: PAPER }}>
                {d.roll.value}
              </div>
              <div className="text-[10px] leading-tight">
                <div className="font-bold">{d.roll.by} rolls {d.roll.value}{d.roll.crit ? ' — critical!' : d.roll.fumble ? ' — fumble!' : ''}</div>
                <div style={{ opacity: 0.8 }}>{d.roll.total} vs DC {d.roll.dc} · {d.success ? 'SUCCESS' : 'FAILURE'}</div>
              </div>
            </div>
          )}
          <div className="rounded p-2.5 text-[11px] leading-snug" style={{ background: 'rgba(0,0,0,0.25)' }}>
            {d.resultText}
          </div>
          <button onClick={() => setState(s => s ? closeDilemma(s) : s)}
            className="rounded px-3 py-2 text-[11px] font-bold self-end" style={{ background: PAPER, color: INK }}>
            Continue →
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Rival encounter ───────────────────────────────────────────────────────────
// A competing expedition blocks the road. Modeled on the dilemma overlay: pick a
// tactic (press on / sabotage / parley), the client rolls, then dismiss.
function RivalView({ state, setState }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
}) {
  const e = state.rivalEncounter!;
  const rival = state.rivals.find(r => r.id === e.rivalId);
  const STAT_LABEL: Record<string, string> = { might: 'MIGHT', agility: 'AGILITY', wits: 'WITS', spirit: 'SPIRIT' };
  const pct = rival ? Math.round(rival.progress * 100) : 0;
  return (
    <motion.div className="p-3 max-w-md mx-auto"
      style={{ color: PAPER, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="text-[11px] font-bold tracking-wider mb-2 flex items-center gap-1" style={{ opacity: 0.8 }}>
        <Swords size={12} /> RIVAL EXPEDITION {rival ? <span style={{ opacity: 0.7 }}>· {rival.glyph} {rival.name}</span> : null}
      </div>
      {rival && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[9px] mb-0.5" style={{ opacity: 0.8 }}>
            <span>their race to the prize</span><span>{pct}%</span>
          </div>
          <div className="rounded h-1.5 overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#7a1f1f' }} />
          </div>
        </div>
      )}
      <div className="rounded p-2.5 mb-3 text-[12px] leading-snug" style={{ background: 'rgba(0,0,0,0.25)' }}>
        {e.prompt}
      </div>

      {!e.resolved && (
        <div className="flex flex-col gap-1.5">
          {e.options.map((o, i) => (
            <button key={i} onClick={() => setState(s => s ? resolveRival(s, i) : s)}
              className="text-left rounded px-2.5 py-2 text-[11px] font-bold transition-colors"
              style={{ background: PAPER, color: INK }}>
              <div className="flex items-center justify-between gap-2">
                <span>{o.label}</span>
                {o.stat
                  ? <span className="text-[9px] font-bold shrink-0" style={{ opacity: 0.7 }}>{STAT_LABEL[o.stat]} · DC {o.dc}</span>
                  : <span className="text-[9px] font-bold shrink-0" style={{ opacity: 0.7 }}>no roll</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {e.resolved && (
        <div className="flex flex-col gap-3">
          {e.roll && (
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded font-bold text-[18px]"
                style={{ width: 44, height: 44, background: e.success ? '#2f6b2f' : '#7a1f1f', color: PAPER }}>
                {e.roll.value}
              </div>
              <div className="text-[10px] leading-tight">
                <div className="font-bold">{e.roll.by} rolls {e.roll.value}{e.roll.crit ? ' — critical!' : e.roll.fumble ? ' — fumble!' : ''}</div>
                <div style={{ opacity: 0.8 }}>{e.roll.total} vs DC {e.roll.dc} · {e.success ? 'SUCCESS' : 'FAILURE'}</div>
              </div>
            </div>
          )}
          <div className="rounded p-2.5 text-[11px] leading-snug" style={{ background: 'rgba(0,0,0,0.25)' }}>
            {e.resultText}
          </div>
          <button onClick={() => setState(s => s ? closeRival(s) : s)}
            className="rounded px-3 py-2 text-[11px] font-bold self-end" style={{ background: PAPER, color: INK }}>
            Continue →
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────────

// Append a GM beat to the running scene transcript instead of replacing it, so
// the narration accumulates as a journal (newest last). Keeps the latest in
// `narration` for back-compat, de-dupes immediate repeats, and caps growth so a
// long stay at one place can't grow the log unbounded.
const SCENE_LOG_CAP = 40;
function pushSceneNarration(scene: Scene, text: string): Scene {
  const t = (text || '').trim();
  const base = scene.log ?? (scene.narration ? [scene.narration] : []);
  const log = [...base];
  if (t && log[log.length - 1] !== t) log.push(t);
  return { ...scene, narration: t || scene.narration, log: log.slice(-SCENE_LOG_CAP) };
}

function SceneView({ state, setState, llmOpts }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  llmOpts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string };
}) {
  const node = currentNode(state);
  const fetchedFor = useRef<string>('');

  const fetchScene = useCallback(async (s: RpgState) => {
    const n = currentNode(s);
    const tags = legalTags(s, n);
    setState(prev => prev && prev.scene ? { ...prev, scene: { ...prev.scene, busy: true } } : prev);
    try {
      const res = await api.rpgScene(sceneContext(s, n), tags, s.theme, llmOpts);
      const allowed = new Set<string>(tags);
      const choices = res.choices
        .filter(c => allowed.has(c.tag))
        .map(c => ({ label: c.label, tag: c.tag as ActionTag }));
      setState(prev => {
        if (!prev || !prev.scene) return prev;
        return { ...prev, scene: { ...pushSceneNarration(prev.scene, res.narration), choices, busy: false, fallback: res.fallback } };
      });
    } catch {
      setState(prev => prev && prev.scene ? { ...prev, scene: { ...prev.scene, busy: false } } : prev);
    }
  }, [llmOpts, setState]);

  // Fetch GM narration once per node arrival.
  useEffect(() => {
    if (fetchedFor.current !== node.id) {
      fetchedFor.current = node.id;
      void fetchScene(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const choose = useCallback(async (tag: ActionTag) => {
    if (tag === 'leave') {
      setState(prev => prev ? { ...prev, phase: 'world', scene: null } : prev);
      return;
    }
    if (tag === 'fight') {
      // Hand off to the dedicated battle view (visible enemies).
      setState(prev => prev ? startCombat(prev, prev.currentNodeId) : prev);
      return;
    }
    if (tag === 'hunt') {
      // Repeatable XP/loot grind in a cleared farmable site (no re-clear).
      setState(prev => prev ? startCombat(prev, prev.currentNodeId, { farm: true }) : prev);
      return;
    }
    if (tag === 'talk') {
      // Open a free-text conversation instead of an abstract skill check.
      setState(prev => prev ? startDialogue(prev, prev.currentNodeId) : prev);
      return;
    }
    if (tag === 'search') {
      // Open the visible dice pool instead of a hidden single-d20 check.
      setState(prev => prev ? startSearchCheck(prev, currentNode(prev)) : prev);
      return;
    }
    // Client resolves the mechanic, then asks the GM to narrate the outcome.
    let outcome = '';
    let nextState: RpgState | null = null;
    setState(prev => {
      if (!prev) return prev;
      const r = applyAction(prev, tag, currentNode(prev));
      outcome = r.outcome;
      nextState = r.state;
      return { ...r.state, scene: r.state.scene ? { ...r.state.scene, busy: true } : r.state.scene };
    });
    if (!nextState) return;
    const ns = nextState as RpgState;
    if (ns.phase === 'victory' || ns.phase === 'gameover') return;
    try {
      const res = await api.rpgResolve(`${tag} at ${currentNode(ns).name}`, outcome, ns.theme, llmOpts);
      setState(prev => prev && prev.scene
        ? { ...prev, scene: { ...pushSceneNarration(prev.scene, res.narration), busy: true } }
        : prev);
    } catch { /* keep mechanical outcome */ }
    // Refresh choices for the updated situation.
    setState(prev => { if (prev) void fetchScene(prev); return prev; });
  }, [llmOpts, setState, fetchScene]);

  // Screens within one place: an outdoor depth (area) for crawl-like nodes, plus
  // "stepping inside" a building. Both reset when the party leaves the node.
  const areaLabels = SCENE_AREAS[node.kind] ?? null;
  const areaCount = areaLabels ? areaLabels.length : 1;
  const [inside, setInside] = useState(false);
  const [area, setArea] = useState(0);
  const [trading, setTrading] = useState(false); // trade-post overlay open
  const dir = useRef(1); // slide direction for the screen transition
  useEffect(() => { setInside(false); setArea(0); setTrading(false); dir.current = 1; }, [node.id]);
  const lastArea = area >= areaCount - 1;
  const goArea = (next: number) => {
    const clamped = Math.max(0, Math.min(areaCount - 1, next));
    dir.current = clamped > area ? 1 : -1;
    setArea(clamped);
  };
  const onAction = useCallback((tag: string) => {
    if (tag === 'enter') { dir.current = 1; setInside(true); return; }
    void choose(tag as ActionTag);
  }, [choose]);

  // Dismiss a committed search pool, then ask the GM to narrate the find.
  const dpContinue = useCallback(async () => {
    const pool = state.dicePool;
    const result = pool?.resultText || '';
    setState(s => s ? closeDicePool(s) : s);
    if (pool?.kind === 'search' && result) {
      try {
        const res = await api.rpgResolve(`search at ${node.name}`, result, state.theme, llmOpts);
        setState(prev => prev && prev.scene ? { ...prev, scene: pushSceneNarration(prev.scene, res.narration) } : prev);
      } catch { /* keep mechanical outcome */ }
      setState(prev => { if (prev) void fetchScene(prev); return prev; });
    }
  }, [state, node, llmOpts, setState, fetchScene]);

  // When an inline fight ends we're back on the same node (no arrival fires), so
  // pull fresh GM narration for the changed situation (survivors / cleared ground).
  const wasInCombat = useRef(false);
  useEffect(() => {
    if (state.combat) { wasInCombat.current = true; return; }
    if (wasInCombat.current) {
      wasInCombat.current = false;
      if (state.phase === 'scene') void fetchScene(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.combat]);

  // Combat is staged INLINE on this very scene — same screen, same diorama; the
  // foes step onto the board and the controls swap in below. No battle screen.
  const stage = useCombatStage(state, setState, llmOpts);
  const inCombat = !!state.combat;

  const scene = state.scene;
  const goalName = state.nodes[state.quest.goalNodeId]?.name;
  // The place description is *materialized* in the diorama, never printed. The
  // narration strip carries only the GM's story; if the model echoes the raw
  // situation prompt (or returns nothing) we show no text rather than the blurb.
  const rawNarration = scene?.narration?.trim();
  const looksLikeContext = !!rawNarration && /^place:/i.test(rawNarration);
  const narration = !rawNarration || looksLikeContext ? '' : rawNarration;
  // The foes lurking here + the live party + the local speaker, so the whole
  // turn is played *on the diorama* — actors carry their data and their actions.
  const foes = nodeRoster(node, state).map(e => e.name);
  const heroes = state.party.map(c => ({
    name: c.name, className: c.className, level: c.level, hp: c.hp, maxHp: c.maxHp, alive: c.alive,
  }));
  // Foes wait in the deepest area; the speaker + buildings sit at the surface.
  // During a fight the static dressing yields to the live combat row.
  const showFoes = inCombat ? [] : (lastArea ? foes : []);
  const npc = inCombat || inside || area > 0 ? null : sceneNpc(node);
  const enterable = !inCombat && (node.kind === 'town' || node.kind === 'village') && area === 0;
  const locked = node.danger > 0 && !node.cleared; // enemy ground must be cleared
  // Canonical place commands, routed to the right actor's bubble instead of a
  // flat grid: ground chips = look/search, hero bubble = ready weapon/rest/quest,
  // NPC bubble = talk/recruit ("look for someone to talk" = clicking the NPC),
  // foe bubble = attack, building bubble = step inside.
  const tags = legalTags(state, node);
  const mk = (cond: boolean, label: string, tag: string): SceneActionDef[] => (cond ? [{ label, tag }] : []);
  // Hiring a companion costs gold (the price is shown up front); the free path is
  // to win them over in dialogue instead.
  const hireCost = state.recruitPool.length > 0 ? recruitPriceAt(node, state.recruitPool[0], state.party.length) : 0;
  const recruitLabel = state.gold >= hireCost ? t('rpg.act.hire', { n: hireCost }) : t('rpg.act.hireShort', { n: hireCost });
  const sceneActions: Partial<Record<'hero' | 'npc' | 'foe' | 'building' | 'ground', SceneActionDef[]>> = {
    ground: [...mk(tags.includes('look'), t('rpg.act.look'), 'look'), ...mk(tags.includes('search'), t('rpg.act.search'), 'search')],
    hero: [...mk(tags.includes('fight'), t('rpg.act.fight'), 'fight'), ...mk(tags.includes('hunt'), t('rpg.act.hunt'), 'hunt'), ...mk(tags.includes('rest'), t('rpg.act.rest'), 'rest'), ...mk(tags.includes('quest'), t('rpg.act.quest'), 'quest')],
    npc: [...mk(tags.includes('talk'), t('rpg.act.talk'), 'talk'), ...mk(tags.includes('recruit'), recruitLabel, 'recruit')],
    foe: [{ label: t('rpg.cbt.attack'), tag: 'fight' }],
    building: [{ label: t('rpg.act.enter'), tag: 'enter' }, ...mk(tags.includes('rest'), t('rpg.act.rest'), 'rest'),
               ...mk(tags.includes('provision'), t('rpg.act.buyFood', { n: provPriceAt(node) }), 'provision')],
  };
  // A search opens a visible dice pool that takes over the scene until resolved.
  if (state.dicePool) {
    return (
      <div className="p-3 flex flex-col justify-center" style={{ color: INK, fontFamily: 'monospace', height: '100%', minHeight: 360 }}>
        <DicePoolOverlay state={state} setState={setState} onContinue={dpContinue} />
      </div>
    );
  }
  // The trade post takes over the scene — buy goods with gold and/or carried
  // valuables (troc). Reachable only from inside a settlement.
  if (trading && canBarter(node)) {
    return <TradePostPanel state={state} setState={setState} nodeId={node.id} onClose={() => setTrading(false)} />;
  }
  return (
    <div className="p-3 flex flex-col" style={{ color: INK, fontFamily: 'monospace', height: '100%', minHeight: 360 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-bold">
          {KIND_GLYPH[node.kind]} {node.name}
          {inside ? t('rpg.scene.inside') : areaCount > 1 ? ` · ${areaLabels![area]}` : ''}
        </span>
        {inCombat && (
          <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#7a1f1f' }}>
            <Swords size={11} /> {t('rpg.scene.battle')}
          </span>
        )}
        {!inCombat && !inside && lastArea && node.danger > 0 && !node.cleared && (
          <span className="flex items-center gap-1 text-[10px]" style={{ color: '#7a1f1f' }}>
            <Swords size={11} /> {t('rpg.scene.danger', { n: node.danger })}
          </span>
        )}
        {(node.kind === 'town' || node.kind === 'village') && (() => {
          const ppl = peopleFor(state.seed, state.peopleId);
          const emblem = peopleSpriteKey(ppl.id);
          return (
            <span className="flex items-center gap-1 text-[10px]" style={{ opacity: 0.85 }} title={ppl.name}>
              <PixelSprite grid={SPRITES[emblem]} palette={spritePalette(emblem)} px={1.5}
                           className="shrink-0 rounded-sm" title={ppl.name} />
              <span className="truncate" style={{ maxWidth: 96 }}>{ppl.name}</span>
            </span>
          );
        })()}
        {(node.kind === 'town' || node.kind === 'village') && (
          <span className="text-[10px]" style={{ opacity: 0.75 }}
            title={t('rpg.scene.standingTitle', { rep: settlementRep(node) })}>
            {repTier(settlementRep(node))}
          </span>
        )}
        {(node.kind === 'town' || node.kind === 'village') && rapportBonus(peopleFor(state.seed, state.peopleId).id) > 0 && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#3f6a3f' }}
            title={t('rpg.scene.rapportTitle', { n: rapportBonus(peopleFor(state.seed, state.peopleId).id) })}>
            <Sparkles size={10} /> {t('rpg.scene.rapport')}
          </span>
        )}
      </div>

      {/* The place — drawn, the hero element and the whole control surface:
          biome + props + heroes (with data) + foes + NPC, all clickable. Screens
          (deeper areas / building interiors) slide in for an immersive move. */}
      <motion.div animate={stage.shake} className="relative flex-1 min-h-0 mb-2" style={{ minHeight: 150 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={inside && !inCombat ? 'int' : `area${area}`} className="absolute inset-0"
            initial={{ x: dir.current * 36, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir.current * -36, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}>
            {inside && !inCombat ? (
              <InteriorPanel node={node}
                onTalk={() => choose('talk')}
                onRest={tags.includes('rest') ? () => choose('rest') : undefined}
                onTrade={canBarter(node) ? () => setTrading(true) : undefined}
                onLeave={() => { dir.current = -1; setInside(false); }} />
            ) : (
              <SceneDiorama node={node} height="100%" foes={showFoes} party={heroes}
                npc={npc} enterable={enterable}
                actions={inCombat ? {} : sceneActions} onAction={onAction} variant={area}
                combatFoes={stage.dioramaFoes}
                targetId={state.combat?.targetId || undefined}
                onFoeClick={stage.pickTarget}
                partyLungeKey={stage.partyLunge}
                foeLungeKey={stage.foeLunge}
                flashHeroIds={stage.flashHeroes}
                flashFoeIds={stage.flashFoes} />
            )}
          </motion.div>
        </AnimatePresence>
        {/* Deeper / back chevrons for multi-screen places (frozen during a fight). */}
        {!inCombat && !inside && area > 0 && (
          <button onClick={() => goArea(area - 1)} title={t('rpg.nav.goBack')} style={sceneNavBtn('left')}>◂</button>
        )}
        {!inCombat && !inside && areaCount > 1 && !lastArea && (
          <button onClick={() => goArea(area + 1)} title={t('rpg.nav.goDeeper')} style={sceneNavBtn('right')}>▸</button>
        )}
      </motion.div>

      {inCombat ? (
        /* The fight's controls take the scroll's place — same screen throughout. */
        <CombatPanel state={state} stage={stage} />
      ) : (
        <>
          {/* Quest objective — parchment scroll */}
          <div className="mb-2">
            <QuestScroll quest={state.quest} goalName={goalName} />
            <GoalLevelHint state={state} />
          </div>

          {/* Narration — a running GM transcript beneath the drawn place; beats
              accumulate (newest last) instead of replacing each other. */}
          {(scene?.busy || (scene?.log && scene.log.length) || narration) && (
            <div className="rounded p-2 mb-2" style={{ background: PAPER }}>
              <NarrationLog scene={scene} narration={narration} />
              {scene && !scene.busy && scene.fallback && (
                <span className="block text-[8px] mt-1" style={{ opacity: 0.5 }}>{t('rpg.scene.offlineNarration')}</span>
              )}
            </div>
          )}

          {/* Only the map exit stays a button — every other action lives on the scene.
              Enemy ground locks the exit until the place is cleared. */}
          <button onClick={() => { if (!locked) choose('leave'); }} disabled={locked}
            className="rounded px-2 py-1.5 text-[10px] font-bold flex items-center gap-1 justify-center"
            style={{ background: locked ? MID : DARK, color: PAPER, opacity: locked ? 0.75 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>
            {locked
              ? <><Swords size={11} /> {t('rpg.dng.defeatToLeave')}</>
              : <><MapIcon size={11} /> {t('rpg.dng.backToMap')}</>}
          </button>
        </>
      )}
    </div>
  );
}

// ── Dungeon crawl (typed-room screens) ──────────────────────────────────────
// A dungeon/cave/ruin is played room by room: each room is one screen with a
// typed challenge (combat / trap / treasure / puzzle / rest / boss). The party
// descends; the deepest room is always the boss. The GM narrates every room and
// every outcome, but the CLIENT owns the dice, HP, loot and clears. Leaving is
// gated until the dungeon is cleared (its boss is down).
// tag stays stable (drives game logic); the label key is resolved reactively at
// the use site so locale switches re-render it.
const ROOM_VERB: Record<string, { key: string; tag: string }> = {
  treasure: { key: 'rpg.act.open', tag: 'open' },
  trap: { key: 'rpg.act.cross', tag: 'cross' },
  puzzle: { key: 'rpg.act.solve', tag: 'solve' },
  rest: { key: 'rpg.act.camp', tag: 'rest' },
};

function DungeonScene({ state, setState, llmOpts }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  llmOpts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string };
}) {
  const node = currentNode(state);
  const rooms = nodeRooms(node)!;
  const total = rooms.length;
  const idx = Math.min(total - 1, Math.max(0, node.roomIndex ?? 0)); // live depth
  const [view, setView] = useState(idx);                            // browsed room
  const dir = useRef(1);
  const fetchedFor = useRef('');

  // Snap the browse cursor back to the live depth whenever it advances or we move.
  useEffect(() => { setView(idx); }, [idx, node.id]);

  // GM narrates a room once on arrival (only the live, uncleared room).
  const fetchRoom = useCallback(async (s: RpgState, prompt: string) => {
    const n = currentNode(s);
    const r = currentRoom(n);
    if (!r) return;
    setState(prev => prev && prev.scene ? { ...prev, scene: { ...prev.scene, busy: true } } : prev);
    try {
      const res = await api.rpgResolve(roomContext(s, n, r), prompt, s.theme, llmOpts);
      setState(prev => prev && prev.scene
        ? { ...prev, scene: { ...pushSceneNarration(prev.scene, res.narration), busy: false, fallback: res.fallback } }
        : prev);
    } catch {
      setState(prev => prev && prev.scene ? { ...prev, scene: { ...prev.scene, busy: false } } : prev);
    }
  }, [llmOpts, setState]);

  useEffect(() => {
    const key = `${node.id}:${idx}`;
    if (fetchedFor.current !== key && !rooms[idx].cleared) {
      fetchedFor.current = key;
      void fetchRoom(state, `You enter ${rooms[idx].name}. ${rooms[idx].blurb}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, idx]);

  // Resolve a non-combat room, then have the GM narrate the mechanical outcome.
  const resolveCurrent = useCallback(async () => {
    let outcome = '';
    let next: RpgState | null = null;
    setState(prev => {
      if (!prev) return prev;
      const r = resolveRoom(prev, prev.currentNodeId);
      outcome = r.outcome;
      next = r.state;
      return { ...r.state, scene: r.state.scene ? { ...r.state.scene, busy: true } : r.state.scene };
    });
    if (!next) return;
    const ns = next as RpgState;
    if (ns.phase === 'gameover' || !outcome) return;
    await fetchRoom(ns, outcome);
  }, [setState, fetchRoom]);

  const onAction = useCallback((tag: string) => {
    if (tag === 'fight') {
      setState(prev => prev ? startCombat(prev, prev.currentNodeId, { roomId: currentRoom(currentNode(prev))?.id }) : prev);
      return;
    }
    if (tag === 'boss') {
      setState(prev => prev ? startCombat(prev, prev.currentNodeId, { roomId: currentRoom(currentNode(prev))?.id, boss: true }) : prev);
      return;
    }
    void resolveCurrent();
  }, [setState, resolveCurrent]);

  const descend = useCallback(() => {
    dir.current = 1;
    fetchedFor.current = ''; // force GM narration of the next room
    setState(prev => prev ? advanceRoom(prev, prev.currentNodeId) : prev);
  }, [setState]);

  // A fight ends back in the same room (no descent fired): re-narrate the live
  // room for the changed situation (survivors after a flee; nothing if it cleared).
  const wasInCombat = useRef(false);
  useEffect(() => {
    if (state.combat) { wasInCombat.current = true; return; }
    if (wasInCombat.current) {
      wasInCombat.current = false;
      const r = currentRoom(currentNode(state));
      if (state.phase === 'scene' && r && !r.cleared) void fetchRoom(state, `The dust settles in ${r.name}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.combat]);

  // Combat is staged INLINE on the dungeon room — same screen, same diorama;
  // the controls swap in below while the fight is live. No battle screen.
  const stage = useCombatStage(state, setState, llmOpts);
  const inCombat = !!state.combat;

  const goView = (next: number) => {
    const clamped = Math.max(0, Math.min(idx, next));
    dir.current = clamped > view ? 1 : -1;
    setView(clamped);
  };

  const room = rooms[view];
  const atDepth = view === idx;        // the live room (where actions happen)
  const cleared = room.cleared;
  const isLast = idx >= total - 1;
  // Exit is gated on the FLOOR you stand on, not the whole dungeon: once the live
  // room is cleared you may retreat to the map, even mid-descent (item #8). A
  // mid-fight / uncleared live floor still pins you in place.
  const liveCleared = rooms[idx].cleared;
  const locked = !liveCleared;
  const leaveDungeon = () => setState(prev => prev ? { ...prev, phase: 'world', scene: null } : prev);

  const scene = state.scene;
  const rawNarration = scene?.narration?.trim();
  const looksLikeContext = !!rawNarration && /^dungeon:/i.test(rawNarration);
  const narration = !rawNarration || looksLikeContext ? '' : rawNarration;

  const heroes = state.party.map(c => ({
    name: c.name, className: c.className, level: c.level, hp: c.hp, maxHp: c.maxHp, alive: c.alive,
  }));
  const foes = inCombat ? [] : roomRoster(node, room, state).map(e => e.name);
  const goalName = state.nodes[state.quest.goalNodeId]?.name;

  // The room's single interaction, routed onto the diorama. Only the live,
  // uncleared room is interactive; browsed (cleared) rooms are read-only.
  const actions: Partial<Record<'hero' | 'npc' | 'foe' | 'building' | 'ground', SceneActionDef[]>> = {};
  if (atDepth && !cleared && !inCombat) {
    if (room.kind === 'boss') actions.foe = [{ label: t('rpg.act.boss'), tag: 'boss' }];
    else if (room.kind === 'combat') actions.foe = [{ label: t('rpg.cbt.attack'), tag: 'fight' }];
    else if (ROOM_VERB[room.kind]) actions.ground = [{ label: t(ROOM_VERB[room.kind].key), tag: ROOM_VERB[room.kind].tag }];
  }

  return (
    <div className="p-3 flex flex-col" style={{ color: INK, fontFamily: 'monospace', height: '100%', minHeight: 360 }}>
      {/* Header — dungeon + room + depth */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-bold">
          {KIND_GLYPH[node.kind]} {node.name} · {room.name}
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: inCombat || room.kind === 'boss' ? '#7a1f1f' : INK }}>
          {inCombat || room.kind === 'boss' ? <Swords size={11} /> : null} {inCombat ? t('rpg.scene.battle') + ' · ' : ''}{t('rpg.dng.room', { n: view + 1, total })}
        </span>
      </div>

      {/* The room — drawn screen with the live party + any foes; slides on descent */}
      <motion.div animate={stage.shake} className="relative flex-1 min-h-0 mb-2" style={{ minHeight: 150 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${node.id}:${view}`} className="absolute inset-0"
            initial={{ x: dir.current * 36, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir.current * -36, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}>
            <SceneDiorama node={node} height="100%" foes={foes} party={heroes}
              actions={actions} onAction={onAction} variant={view}
              combatFoes={stage.dioramaFoes}
              targetId={state.combat?.targetId || undefined}
              onFoeClick={stage.pickTarget}
              partyLungeKey={stage.partyLunge}
              foeLungeKey={stage.foeLunge}
              flashHeroIds={stage.flashHeroes}
              flashFoeIds={stage.flashFoes} />
          </motion.div>
        </AnimatePresence>
        {/* Look back at cleared rooms / step forward to the live room (frozen mid-fight). */}
        {!inCombat && view > 0 && (
          <button onClick={() => goView(view - 1)} title={t('rpg.nav.lookBack')} style={sceneNavBtn('left')}>◂</button>
        )}
        {!inCombat && view < idx && (
          <button onClick={() => goView(view + 1)} title={t('rpg.nav.forward')} style={sceneNavBtn('right')}>▸</button>
        )}
      </motion.div>

      {inCombat ? (
        /* The fight's controls take the scroll's place — same room throughout. */
        <CombatPanel state={state} stage={stage} />
      ) : (
        <>
          {/* Quest objective */}
          <div className="mb-2">
            <QuestScroll quest={state.quest} goalName={goalName} />
            <GoalLevelHint state={state} />
          </div>

          {/* GM narration transcript — beats accumulate (newest last). */}
          {(scene?.busy || (scene?.log && scene.log.length) || narration) && (
            <div className="rounded p-2 mb-2" style={{ background: PAPER }}>
              <NarrationLog scene={scene} narration={narration} />
              {scene && !scene.busy && scene.fallback && (
                <span className="block text-[8px] mt-1" style={{ opacity: 0.5 }}>{t('rpg.scene.offlineNarration')}</span>
              )}
            </div>
          )}

          {/* Progression: descend when the live room is clear; else leave once the
              whole dungeon is done. A cleared, non-final room shows the way down. */}
          {atDepth && cleared && !isLast ? (
            // Floor cleared, more below: descend OR retreat to the map (item #8).
            <div className="flex gap-1.5">
              <button onClick={descend}
                className="flex-1 rounded px-2 py-1.5 text-[11px] font-bold flex items-center gap-1 justify-center"
                style={{ background: INK, color: PAPER }}>
                {t('rpg.dng.descend')}
              </button>
              <button onClick={leaveDungeon}
                className="flex-1 rounded px-2 py-1.5 text-[10px] font-bold flex items-center gap-1 justify-center"
                style={{ background: DARK, color: PAPER }}>
                <MapIcon size={11} /> {t('rpg.dng.retreatToMap')}
              </button>
            </div>
          ) : (
            <button onClick={() => { if (!locked) leaveDungeon(); }}
              disabled={locked}
              className="rounded px-2 py-1.5 text-[10px] font-bold flex items-center gap-1 justify-center"
              style={{ background: locked ? MID : DARK, color: PAPER, opacity: locked ? 0.75 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>
              {locked
                ? <><Swords size={11} /> {t('rpg.dng.clearFloor')}</>
                : node.cleared
                  ? <><MapIcon size={11} /> {t('rpg.dng.leaveDungeon')}</>
                  : <><MapIcon size={11} /> {t('rpg.dng.retreatToMap')}</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Multi-screen places get edge chevrons to move deeper / back, immersive.
function sceneNavBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', [side]: 6, transform: 'translateY(-50%)', zIndex: 10,
    width: 26, height: 40, borderRadius: 6, border: `2px solid ${PAPER}`, background: INK, color: PAPER,
    fontSize: 16, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

// Some places are deeper than one screen: a little crawl whose danger waits in
// the final chamber. Friendly nodes stay single-screen (buildings aside).
const SCENE_AREAS: Partial<Record<NodeKind, string[]>> = {
  dungeon: ['Entrance', 'Halls', 'Depths'],
  cave: ['Mouth', 'Hollow'],
  ruin: ['Courtyard', 'Inner ruin'],
};

// A stepped-into building: a keeper to talk to, a hearth to rest at, a way out.
function InteriorPanel({ node, onTalk, onRest, onTrade, onLeave }: {
  node: MapNode; onTalk: () => void; onRest?: () => void; onTrade?: () => void; onLeave: () => void;
}) {
  const keeperRole = node.kind === 'town' ? 'innkeeper' : 'elder';
  const btn: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, background: INK, color: PAPER, border: 'none',
    borderRadius: 3, padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace', textAlign: 'left',
  };
  return (
    <div style={{
      position: 'relative', height: '100%', borderRadius: 8, overflow: 'hidden',
      border: `3px solid ${INK}`,
      background: `linear-gradient(${INK} 0%, ${INK} 60%, ${DARK} 60%, ${DARK} 100%)`,
      boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.18)',
    }}>
      {/* hanging lamp */}
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 12, height: 12, borderRadius: '50%', background: PAPER, boxShadow: '0 0 10px rgba(255,255,255,0.5)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '60%', height: 2, background: '#000', opacity: 0.4 }} />
      {/* keeper */}
      <div style={{ position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontSize: 7, fontWeight: 700, color: INK, background: PAPER, border: `1px solid ${INK}`, borderRadius: 2, padding: '0 3px', marginBottom: 2, fontFamily: 'monospace' }}>{t('rpg.role.' + keeperRole)}</div>
        <PixelSprite grid={SPRITES[roleSprite(keeperRole)]} px={4} palette={spritePalette(roleSprite(keeperRole))} />
      </div>
      {/* actions */}
      <div style={{ position: 'absolute', left: 6, bottom: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={onTalk} style={btn}>{t('rpg.act.talk')}</button>
        {onTrade && <button onClick={onTrade} style={btn}>{t('rpg.trade.open')}</button>}
        {onRest && <button onClick={onRest} style={btn}>{t('rpg.int.rest')}</button>}
        <button onClick={onLeave} style={{ ...btn, background: DARK }}>{t('rpg.int.stepOutside')}</button>
      </div>
    </div>
  );
}

// ── Trade post (CE2 barter: buy goods with gold and/or carried valuables) ────────

const RARITY_COLOR: Record<string, string> = {
  common: '#6b6b6b', fine: '#2f6b2f', masterwork: '#3a4a7a', fabled: '#7a3a6b',
};

function TradePostPanel({ state, setState, nodeId, onClose }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  nodeId: string;
  onClose: () => void;
}) {
  const node = state.nodes[nodeId];
  // The valuables the party can put toward a purchase, and which are toggled on.
  const valuables = (state.inventory || []).filter(i => i.kind === 'valuable');
  const [offer, setOffer] = useState<string[]>([]);
  const [note, setNote] = useState('');
  // Live, client-owned numbers: stock, the troc credit, the net cost per good.
  const stock = node ? merchantStock(node, state) : [];
  const offered = valuables.filter(v => offer.includes(v.id));
  const prize = prizedBy(state.seed, state.peopleId);   // the trade good these locals covet (premium trade-in)
  const credit = offered.reduce((s, it) => s + tradeInValue(it, node, prize), 0);
  const toggle = (id: string) => setOffer(o => o.includes(id) ? o.filter(x => x !== id) : [...o, id]);
  const onBuy = (entry: StockEntry) => {
    const r = barter(state, nodeId, entry.item.id, offer);
    setNote(r.note);
    if (r.ok) { setState(prev => (prev ? r.state : prev)); setOffer([]); }
  };
  return (
    <motion.div className="absolute inset-0 z-10 overflow-auto p-3"
      style={{ background: SCREEN_BG, color: INK, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold flex items-center gap-1">
          <ScrollText size={13} /> {t('rpg.trade.title')}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#7a5a1f' }}>
            <Sparkles size={11} /> {t('rpg.inv.gold', { n: state.gold || 0 })}
          </span>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ background: INK, color: PAPER }}>
            {t('rpg.lodge.close')}
          </button>
        </span>
      </div>

      {/* Regional economy — what these locals make themselves sells cheaper here. */}
      <div className="text-[9px] mb-1.5 flex items-center gap-1" style={{ color: '#3f6a3f' }}>
        <Sparkles size={10} /> {t('rpg.trade.localCraft', { kind: t('rpg.craft.' + localCraft(state.seed, state.peopleId)) })}
      </div>

      {/* Goods on the shelf — pay net of any troc credit; greyed if unaffordable. */}
      <div className="text-[11px] font-bold mb-1">{t('rpg.trade.goods')}</div>
      <div className="flex flex-col gap-1.5 mb-3">
        {stock.length === 0 && (
          <div className="text-[9px]" style={{ opacity: 0.55 }}>{t('rpg.trade.empty')}</div>
        )}
        {stock.map(entry => {
          const net = Math.max(0, entry.price - credit);
          const afford = (state.gold || 0) >= net;
          const rc = RARITY_COLOR[entry.item.rarity ?? 'common'] ?? RARITY_COLOR.common;
          return (
            <div key={entry.item.id} className="rounded px-2 py-1.5" style={{ background: PAPER, borderLeft: `3px solid ${rc}` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] min-w-0">
                  <b>{entry.item.name}</b>
                  <span style={{ opacity: 0.7 }}> · {entry.item.desc}</span>
                </span>
                <button onClick={() => afford && onBuy(entry)} disabled={!afford}
                  className="rounded px-2 py-0.5 text-[9px] font-bold shrink-0"
                  style={{ background: afford ? INK : DARK, color: PAPER, opacity: afford ? 1 : 0.5, cursor: afford ? 'pointer' : 'not-allowed' }}
                  title={afford ? '' : t('rpg.trade.short')}>
                  {net === 0 ? t('rpg.trade.buyFree') : t('rpg.trade.buy', { n: net })}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Troc — toggle carried valuables to credit them toward the next purchase
          (at the same worth a sale would fetch). Surplus is returned as change. */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold">{t('rpg.trade.troc')}</span>
        {credit > 0 && (
          <span className="text-[9px] font-bold" style={{ color: '#2f6b2f' }}>{t('rpg.trade.credit', { n: credit })}</span>
        )}
      </div>
      <div className="flex flex-col gap-1 mb-2">
        {valuables.length === 0 && (
          <div className="text-[9px]" style={{ opacity: 0.55 }}>{t('rpg.trade.noValuables')}</div>
        )}
        {valuables.map(v => {
          const on = offer.includes(v.id);
          return (
            <button key={v.id} onClick={() => toggle(v.id)}
              className="flex items-center justify-between rounded px-2 py-1 text-left"
              style={{ background: on ? '#7a5a1f' : PAPER, color: on ? PAPER : INK, border: `2px solid ${on ? '#7a5a1f' : 'transparent'}` }}>
              <span className="text-[10px] min-w-0"><b>{v.name}</b><span style={{ opacity: 0.7 }}> · {v.desc}</span></span>
              <span className="text-[9px] font-bold shrink-0 ml-2">{tradeInValue(v, node, prize)}</span>
            </button>
          );
        })}
      </div>

      {note && <div className="text-[9px] rounded px-2 py-1" style={{ background: PAPER, opacity: 0.85 }}>{note}</div>}
    </motion.div>
  );
}

// ── Dialogue (free-text talk with an NPC; the world can shift) ───────────────────

// NPC role → portrait sprite.
function roleSprite(role: string): string {
  const r = role.toLowerCase();
  if (/merchant|innkeep|trader/.test(r)) return 'npc_merchant';
  if (/guard|watch|soldier/.test(r)) return 'npc_guard';
  if (/elder|old/.test(r)) return 'npc_elder';
  if (/healer|priest/.test(r)) return 'npc_cleric' in SPRITES ? 'npc_cleric' : 'npc_elder';
  return 'npc_villager';
}

const EFFECT_LABEL: Record<string, string> = {
  reveal: 'a place revealed', rumor: 'a new lead', heal: 'wounds tended',
  recruit: 'an ally joined', warn: 'danger forewarned',
};

function DialogueView({ state, setState, llmOpts }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  llmOpts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string };
}) {
  const d = state.dialogue!;
  const node = state.nodes[d.nodeId];
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [d.history.length, d.busy]);

  const leave = useCallback(() => {
    setState(prev => prev ? endDialogue(prev) : prev);
  }, [setState]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || d.busy || d.over) return;
    setInput('');
    const effects = legalEffects(state, node);
    const ctx = dialogueContext(state);
    const history = [
      ...d.history.filter(t => t.who !== 'system').map(t => ({ who: t.who, text: t.text })),
      { who: 'player', text: msg },
    ];
    // Append the player's line + mark the NPC as thinking.
    setState(prev => {
      if (!prev || !prev.dialogue) return prev;
      const s = appendDialogue(prev, { who: 'player', text: msg });
      return { ...s, dialogue: { ...s.dialogue!, busy: true } };
    });
    try {
      const res = await api.rpgDialogue(
        { context: ctx, npcName: d.npcName, npcRole: d.npcRole, history, playerMessage: msg, allowedEffects: effects, theme: state.theme },
        llmOpts,
      );
      setState(prev => {
        if (!prev || !prev.dialogue) return prev;
        let s = appendDialogue(prev, { who: 'npc', text: res.reply });
        s = { ...s, dialogue: { ...s.dialogue!, busy: false, fallback: res.fallback } };
        // The client applies the (constrained) world-effect itself.
        s = applyDialogueEffect(s, res.effect, res.reply).state;
        // Guard against a 3B model slamming `end:true` on the very first reply —
        // a one-shot kill makes the chat feel broken. Only honor a natural close
        // once the player has actually had a back-and-forth (>=2 of their lines).
        const playerTurns = s.dialogue ? s.dialogue.history.filter(t => t.who === 'player').length : 0;
        if (res.end && playerTurns >= 2 && s.dialogue) s = { ...s, dialogue: { ...s.dialogue, over: true } };
        return s;
      });
    } catch {
      setState(prev => prev && prev.dialogue ? { ...prev, dialogue: { ...prev.dialogue, busy: false } } : prev);
    }
  }, [input, d, node, state, llmOpts, setState]);

  return (
    <div className="p-3 flex flex-col" style={{ color: INK, fontFamily: 'monospace', height: '100%', minHeight: 360 }}>
      {/* NPC header */}
      <div className="flex items-center gap-2 mb-2 rounded p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
        <PixelSprite grid={SPRITES[roleSprite(d.npcRole)] || SPRITES.npc_villager} px={3} palette={spritePalette(roleSprite(d.npcRole)) || spritePalette('npc_villager')} />
        <div className="leading-tight">
          <div className="text-[12px] font-bold">{d.npcName}</div>
          <div className="text-[9px]" style={{ opacity: 0.8 }}>{d.npcRole} · {node.name}</div>
        </div>
      </div>

      {/* Conversation transcript */}
      <div ref={logRef} className="flex-1 overflow-auto rounded p-2 text-[11px] leading-snug mb-2"
        style={{ background: SCREEN_BG, minHeight: 130 }}>
        {d.history.map((t, i) => {
          if (t.who === 'system') {
            return <div key={i} className="text-[9px] my-1 text-center" style={{ opacity: 0.7, fontStyle: 'italic' }}>— {t.text} —</div>;
          }
          const mine = t.who === 'player';
          return (
            <div key={i} className="mb-1 flex" style={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <span className="rounded px-2 py-1 inline-block" style={{
                maxWidth: '85%',
                background: mine ? INK : PAPER,
                color: mine ? PAPER : INK,
                border: mine ? 'none' : `1px solid ${DARK}`,
              }}>
                {!mine && <b className="text-[9px] block" style={{ opacity: 0.7 }}>{d.npcName}</b>}
                {t.text}
              </span>
            </div>
          );
        })}
        {d.busy && <div className="text-[10px]" style={{ opacity: 0.6 }}>{t('rpg.talk.thinking', { npc: d.npcName })}</div>}
      </div>

      {/* Input row */}
      {d.over ? (
        <button onClick={leave} className="w-full rounded-md py-2 text-[12px] font-bold" style={{ background: INK, color: PAPER }}>
          {t('rpg.talk.end')}
        </button>
      ) : (
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
            disabled={d.busy}
            placeholder={t('rpg.talk.sayPlaceholder', { npc: d.npcName })}
            className="flex-1 rounded px-2 py-1.5 text-[12px] outline-none"
            style={{ background: PAPER, color: INK, border: `2px solid ${DARK}`, opacity: d.busy ? 0.6 : 1 }}
          />
          <button onClick={() => void send()} disabled={d.busy || !input.trim()}
            className="rounded px-3 text-[11px] font-bold"
            style={{ background: DARK, color: PAPER, opacity: d.busy || !input.trim() ? 0.5 : 1 }}>
            {t('rpg.talk.say')}
          </button>
          <button onClick={leave} title={t('rpg.talk.leaveTitle')}
            className="rounded px-2 text-[11px] font-bold" style={{ background: MID, color: INK }}>
            {t('rpg.talk.leaveBtn')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Combat (overlaid on the world: visible enemies + the CE2 tactical dice board) ──

// ── Inline combat staging ── the battle never leaves the scene screen: this hook
// drives the diorama's combat plumbing (lunges, flashes, board shake, targeting)
// plus the deterministic round engine; CombatPanel below renders the controls in
// the spot where the quest scroll usually sits. No separate battle screen exists.
function useCombatStage(state: RpgState, setState: React.Dispatch<React.SetStateAction<RpgState | null>>, llmOpts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string }) {
  const c = state.combat;

  // Fight juice: when a foe takes damage the party row lunges + the struck foe
  // flashes + the whole board shakes; when a hero takes damage the foe row lunges
  // back + the hero flashes. Reads client-owned HP, mutates nothing.
  const shake = useAnimationControls();
  const [partyLunge, setPartyLunge] = useState(0);
  const [foeLunge, setFoeLunge] = useState(0);
  const [flashFoes, setFlashFoes] = useState<string[]>([]);
  const [flashHeroes, setFlashHeroes] = useState<string[]>([]);
  const prevFoe = useRef<Record<string, number>>({});
  const prevHero = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!c) { prevFoe.current = {}; return; }
    const struck = c.enemies.filter(e => { const p = prevFoe.current[e.id]; return p !== undefined && e.hp < p; }).map(e => e.id);
    c.enemies.forEach(e => { prevFoe.current[e.id] = e.hp; });
    if (!struck.length) return;
    void shake.start({ x: [0, -5, 5, -3, 3, 0], transition: { duration: 0.3 } });
    setPartyLunge(k => k + 1);
    setFlashFoes(struck);
    const t = setTimeout(() => setFlashFoes([]), 320);
    return () => clearTimeout(t);
  }, [c?.enemies, shake]);

  useEffect(() => {
    // Track HP outside combat too (so entering a fight has a clean baseline) but
    // only flash while a fight is live — trap/travel damage must not lunge.
    const struck = state.party.filter(m => { const p = prevHero.current[m.id]; return p !== undefined && m.hp < p; }).map(m => m.id);
    state.party.forEach(m => { prevHero.current[m.id] = m.hp; });
    if (!struck.length || !c) return;
    setFoeLunge(k => k + 1);
    setFlashHeroes(struck);
    const t = setTimeout(() => setFlashHeroes([]), 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.party]);

  const pickTarget = useCallback((id: string) => {
    setState(prev => prev ? setCombatTarget(prev, id) : prev);
  }, [setState]);

  // ── Tactical (CE2) round controls ──────────────────────────────────────────
  // Assign one rolled die to a foe / the party block / back to the tray, and push
  // your luck (re-roll the leftovers for morale). Both are synchronous + pure.
  const assign = useCallback((dieId: string, target: string | null) => {
    setState(prev => prev ? combatAssign(prev, dieId, target) : prev);
  }, [setState]);

  const push = useCallback(() => {
    setState(prev => prev ? combatPush(prev) : prev);
  }, [setState]);

  // Commit the assigned pool: resolve the round (client-owned numbers), then layer
  // best-effort GM narration on top — same plumbing as the legacy `act`.
  const commit = useCallback(async () => {
    let summary = '';
    let snapshot: RpgState | null = null;
    setState(prev => {
      if (!prev || !prev.combat || prev.combat.over) return prev;
      const r = combatCommit(prev);
      summary = r.summary;
      snapshot = r.state;
      return { ...r.state, combat: r.state.combat ? { ...r.state.combat, busy: true } : r.state.combat };
    });
    const ns = snapshot as RpgState | null;
    if (!ns || !summary) {
      setState(prev => prev && prev.combat ? { ...prev, combat: { ...prev.combat, busy: false } } : prev);
      return;
    }
    try {
      const res = await api.rpgResolve(combatContext(ns), summary, ns.theme, llmOpts);
      if (res && !res.fallback && res.narration) {
        setState(prev => prev && prev.combat
          ? { ...prev, combat: { ...prev.combat, log: [...prev.combat.log, `» ${res.narration}`], busy: false } }
          : prev);
        return;
      }
    } catch { /* keep mechanical log */ }
    setState(prev => prev && prev.combat ? { ...prev, combat: { ...prev.combat, busy: false } } : prev);
  }, [llmOpts, setState]);

  const finish = useCallback(() => {
    setState(prev => prev ? endCombat(prev) : prev);
  }, [setState]);

  // Live foes for the diorama's combat row (undefined when no fight is on).
  const dioramaFoes: DioramaFoe[] | undefined = c ? c.enemies.map(e => ({
    id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, alive: e.alive, threat: Math.max(1, Math.round(e.atk / 2)),
  })) : undefined;

  return { c, shake, partyLunge, foeLunge, flashFoes, flashHeroes, pickTarget, assign, push, commit, finish, dioramaFoes };
}

// ── Tactical (CE2) battle board glyphs ───────────────────────────────────────
// Each rolled die shows a coloured SYMBOL face: a sword strikes a foe, a shield
// guards the party, a star is the wildcard, a blank is inert. The palette makes
// the board read at a glance (red = offence, blue = defence, gold = wild).
const FACE_GLYPH: Record<CombatFace, string> = { sword: '⚔', shield: '🛡', star: '✶', blank: '·' };
const FACE_COLOR: Record<CombatFace, string> = { sword: '#7a1f1f', shield: '#1f4f7a', star: '#9a6a1f', blank: '#5a5f43' };

// One rolled die rendered as a tappable chip. Selected dice glow; assigned dice
// dim slightly (they sit on a target until committed); blanks are inert.
function DieChip({ die, selected, onClick }: { die: CombatDie; selected: boolean; onClick: () => void }) {
  const col = FACE_COLOR[die.face];
  const inert = die.face === 'blank';
  return (
    <button
      onClick={onClick}
      disabled={inert}
      title={`${die.by} · ${die.face}${die.power ? ` (${die.power})` : ''}`}
      className="relative rounded-md flex flex-col items-center justify-center"
      style={{
        width: 38, height: 42,
        background: die.assignedTo ? '#e9e4cf' : PAPER,
        border: `2px solid ${selected ? '#9a6a1f' : col}`,
        boxShadow: selected ? `0 0 0 2px #9a6a1f55` : 'none',
        opacity: inert ? 0.5 : die.assignedTo ? 0.78 : 1,
        cursor: inert ? 'default' : 'pointer',
      }}>
      <span style={{ fontSize: 16, lineHeight: 1, color: col }}>{FACE_GLYPH[die.face]}</span>
      {die.power > 0 && <span className="text-[8px] font-bold" style={{ color: INK }}>{die.power}</span>}
    </button>
  );
}

// A foe's own rolled dice for the coming round — the symmetric enemy board. Each
// chip is read-only (foes don't get assigned): a red sword is an attack it will
// swing, a blue shield is a guard it raised. The player reads this and answers
// with their own pool. Blanks are dropped (the foe fumbled that die).
function FoeDice({ dice }: { dice: CombatDie[] }) {
  const shown = dice.filter(d => d.face !== 'blank');
  if (shown.length === 0) {
    return <span className="text-[8px]" style={{ opacity: 0.5 }}>·</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap justify-center">
      {shown.map(d => (
        <span key={d.id} className="inline-flex items-center rounded px-0.5 text-[9px] font-bold"
          style={{ background: FACE_COLOR[d.face], color: PAPER }}>
          {FACE_GLYPH[d.face]}{d.power}
        </span>
      ))}
    </span>
  );
}

// The combat controls strip, rendered in the scene's bottom panel (replacing the
// quest scroll + narration while the fight is live). The CE2 tactical board: tap a
// rolled die, then tap a foe (to strike) or the GUARD slot (to block); push your
// luck to re-roll the leftovers; commit to resolve. Pure display + dispatch.
function CombatPanel({ state, stage }: { state: RpgState; stage: ReturnType<typeof useCombatStage> }) {
  const { c, assign, push, commit, finish } = stage;
  const logRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);

  // Keep the log scrolled to the newest line.
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [c?.log.length, c?.busy]);

  if (!c) return null;
  const busy = c.busy;
  const pool = c.pool || [];
  const enemyPool = c.enemyPool || [];
  const foeDiceOf = (id: string) => enemyPool.filter(d => d.memberId === id);
  const livingFoes = c.enemies.filter(e => e.alive);
  const resultLabel = c.result === 'win' ? t('rpg.cbt.win') : c.result === 'lose' ? t('rpg.cbt.lose') : t('rpg.cbt.escaped');

  // Live preview of the block wall vs the foes' total incoming swing (their swords).
  const blockNow = pool.filter(d => d.assignedTo === PARTY_TARGET).reduce((n, d) => n + d.power, 0);
  const incoming = enemyPool.filter(d => d.face === 'sword').reduce((n, d) => n + d.power, 0);

  const selDie = sel ? pool.find(d => d.id === sel) || null : null;
  const canPush = !busy && (c.rerollsUsed ?? 0) < (c.maxRerolls ?? COMBAT_MAX_REROLLS)
    && pool.some(d => d.assignedTo === null && d.face !== 'blank');
  const pushCost = c.rerollCost ?? 0;

  // Tap a tray die to select/deselect; tap an assigned die to send it back.
  const tapDie = (d: CombatDie) => {
    if (busy || d.face === 'blank') return;
    if (d.assignedTo) { assign(d.id, null); if (sel === d.id) setSel(null); return; }
    setSel(prev => (prev === d.id ? null : d.id));
  };
  // Tap a target while a die is selected → assign it there (engine guards legality).
  const tapTarget = (target: string) => {
    if (busy || !selDie) return;
    assign(selDie.id, target);
    setSel(null);
  };

  return (
    <div className="flex flex-col" style={{ color: INK, fontFamily: 'monospace' }}>
      {/* Party HP */}
      <div className="flex flex-wrap gap-1.5 mb-2 justify-center">
        {state.party.map(m => (
          <div key={m.id} className="rounded px-1.5 py-0.5 text-[9px] flex flex-col items-center"
            style={{ background: m.alive ? PAPER : '#9a9a7a', opacity: m.alive ? 1 : 0.5, border: `1px solid ${DARK}` }}>
            <span className="flex items-center gap-1"><Heart size={9} style={{ fill: INK }} /> {m.name} {Math.max(0, m.hp)}/{m.maxHp}</span>
            {m.alive && <StatusChips status={m.status} />}
          </div>
        ))}
      </div>

      {/* GM rubber-band: a boon (heal + potion for an out-matched party) or a bane
          (a buffed boss for a steam-roller) that fired entering this fight. */}
      {c.intervention && (
        <div className="rounded px-2 py-1 mb-2 text-[10px] font-bold flex items-center gap-1"
          style={{ background: c.intervention === 'boon' ? '#1f4f7a' : '#7a1f1f', color: PAPER }}>
          <Sparkles size={11} />
          {c.intervention === 'boon' ? t('rpg.gm.boon') : t('rpg.gm.bane')}
        </div>
      )}

      {/* Round log — bounded strip beneath the diorama, not a full screen */}
      <div ref={logRef} className="overflow-auto rounded p-2 text-[10px] leading-snug mb-2"
        style={{ background: PAPER, minHeight: 48, maxHeight: 96 }}>
        {c.log.map((l, i) => (
          <div key={i} style={{ opacity: l.startsWith('»') ? 1 : 0.85, fontStyle: l.startsWith('»') ? 'italic' : 'normal' }}>{l}</div>
        ))}
        {busy && <div style={{ opacity: 0.6 }}>{t('rpg.gm.narrating')}</div>}
      </div>

      {/* Actions */}
      {c.over ? (
        <div>
          <div className="text-center text-[14px] font-bold mb-1.5"
            style={{ color: c.result === 'lose' ? '#7a1f1f' : INK }}>{resultLabel}</div>
          <button onClick={finish} className="w-full rounded-md py-2 text-[12px] font-bold"
            style={{ background: INK, color: PAPER }}>{t('rpg.cbt.continue')}</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* The foe board — each foe shows its own rolled dice (⚔ attacks, 🛡 guard).
              Tap a foe (with a sword/star selected) to strike past its guard. */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {livingFoes.map(e => {
              const armable = !!selDie && (selDie.face === 'sword' || selDie.face === 'star');
              return (
                <button key={e.id} disabled={busy || !armable} onClick={() => tapTarget(e.id)}
                  className="rounded px-1.5 py-1 text-[9px] font-bold flex flex-col items-center gap-0.5"
                  style={{
                    background: PAPER, border: `2px solid ${armable ? '#7a1f1f' : DARK}`,
                    opacity: busy ? 0.5 : armable ? 1 : 0.8, cursor: armable ? 'pointer' : 'default',
                  }}>
                  <span className="flex items-center gap-1">{e.name} <span style={{ opacity: 0.7 }}>{Math.max(0, e.hp)}/{e.maxHp}</span></span>
                  <span className="text-[7px] uppercase tracking-wide" style={{ opacity: 0.6 }}>{t('rpg.tactics.' + (e.tactics || 'trickster'))}</span>
                  <FoeDice dice={foeDiceOf(e.id)} />
                </button>
              );
            })}
          </div>

          {/* Guard slot — tap (with a shield/star selected) to raise the block wall. */}
          {(() => {
            const guardable = !!selDie && (selDie.face === 'shield' || selDie.face === 'star');
            const ok = blockNow >= incoming && incoming > 0;
            return (
              <button disabled={busy || !guardable} onClick={() => tapTarget(PARTY_TARGET)}
                className="rounded px-2 py-1 text-[10px] font-bold flex items-center justify-center gap-1.5"
                style={{
                  background: guardable ? '#1f4f7a' : MID, color: guardable ? PAPER : INK,
                  border: `2px solid ${guardable ? '#1f4f7a' : DARK}`,
                  opacity: busy ? 0.5 : 1, cursor: guardable ? 'pointer' : 'default',
                }}>
                🛡 {t('rpg.cbt.guard')} <span style={{ color: guardable ? PAPER : (ok ? '#1f6a3a' : '#7a1f1f') }}>{blockNow}/{incoming}</span>
              </button>
            );
          })()}

          {/* The rolled dice tray. */}
          <div className="flex flex-wrap gap-1.5 justify-center rounded p-1.5" style={{ background: '#00000010' }}>
            {pool.length === 0
              ? <span className="text-[9px]" style={{ opacity: 0.6 }}>{t('rpg.cbt.noDice')}</span>
              : pool.map(d => <DieChip key={d.id} die={d} selected={sel === d.id} onClick={() => tapDie(d)} />)}
          </div>
          <div className="text-center text-[8px]" style={{ opacity: 0.6 }}>{t('rpg.cbt.assignHint')}</div>

          {/* Push your luck + commit. */}
          <div className="grid grid-cols-2 gap-1.5">
            <button disabled={!canPush} onClick={push}
              className="rounded px-2 py-1.5 text-[11px] font-bold flex items-center justify-center gap-1"
              style={{ background: canPush ? '#9a6a1f' : '#5a5f43', color: PAPER, opacity: canPush ? 1 : 0.5 }}>
              <Dices size={12} /> {t('rpg.cbt.push')} <span className="text-[9px]">−{pushCost}</span>
            </button>
            <button disabled={busy} onClick={commit}
              className="rounded px-2 py-1.5 text-[11px] font-bold flex items-center justify-center gap-1"
              style={{ background: '#7a1f1f', color: PAPER, opacity: busy ? 0.5 : 1 }}>
              <Swords size={12} /> {t('rpg.cbt.commit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Party / heroes management (roster, sheets, recruits) ────────────────────────



// The expedition logbook: a running Fame total + a scroll of past runs (newest
// first). Pure display of client-owned records; nothing here touches a live run.
// The Lodge: the persistent home ABOVE adventure creation (CE2's Paris outer
// loop). Surfaces the career that ties isolated runs together — Renown rank
// (derived from cumulative Fame), the Funds/Tickets banks, lifetime tallies —
// then the run-by-run logbook below. Pure display of client-owned records.
function LogbookView({ logbook, hub, onBuy, onAcceptContract, onAbandonContract, onRefreshBoard, onClear, onClose }: {
  logbook: Logbook;
  hub: HubState;
  onBuy: (id: SponsorId) => { ok: boolean; reason?: string };
  onAcceptContract: (id: string) => { ok: boolean; reason?: string };
  onAbandonContract: () => void;
  onRefreshBoard: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const entries = logbook.entries || [];
  const fame = logbook.fame || 0;
  const rk = renownTier(fame);
  // Lodge standing + the running story act (lots 4 & 5), both derived in state.ts.
  const st = standingTier(hub.standing);
  const act = storyAct(hub.contractsFulfilled);
  const board = contractBoard(hub);
  const active = hub.activeContract;
  // Progress to the next rung/star: how far this rung has come (clamped 0..1).
  const rungAt = rk.next != null
    ? (rk.tier < 7 ? [0, 150, 400, 800, 1500, 2600, 4200, 6500][rk.tier] : 6500 + rk.stars * 3000)
    : fame;
  const span = rk.next != null ? Math.max(1, rk.next - rungAt) : 1;
  const pct = rk.next != null ? Math.max(0, Math.min(1, (fame - rungAt) / span)) : 1;
  const winRate = hub.expeditions > 0 ? Math.round((hub.victories / hub.expeditions) * 100) : 0;
  return (
    <motion.div className="absolute inset-0 z-10 overflow-auto p-3"
      style={{ background: SCREEN_BG, color: INK, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold flex items-center gap-1">
          <Sparkles size={13} /> {t('rpg.lodge.title')}
        </span>
        <button onClick={onClose} className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ background: INK, color: PAPER }}>
          {t('rpg.lodge.close')}
        </button>
      </div>
      {/* Renown rank + progress to the next step (climbs forever) */}
      <div className="rounded p-2.5 mb-2" style={{ background: PAPER }}>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[9px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.renown')}</span>
          <span className="text-[8px]" style={{ opacity: 0.6 }}>
            {rk.next != null ? t('rpg.lodge.nextAt', { n: rk.next }) : ''}
          </span>
        </div>
        <div className="text-[18px] font-bold" style={{ color: '#3a4a7a' }}>
          {rk.name}{rk.stars > 0 ? ' ' + '★'.repeat(Math.min(rk.stars, 5)) + (rk.stars > 5 ? `×${rk.stars}` : '') : ''}
        </div>
        <div className="mt-1 h-[6px] rounded-full overflow-hidden" style={{ background: SCREEN_BG }}>
          <div className="h-full" style={{ width: `${Math.round(pct * 100)}%`, background: '#3a4a7a' }} />
        </div>
      </div>
      {/* The two banks + lifetime record */}
      <div className="grid grid-cols-3 gap-2 mb-2 text-center">
        <div className="rounded p-1.5" style={{ background: PAPER }}>
          <div className="text-[8px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.funds')}</div>
          <div className="text-[15px] font-bold" style={{ color: '#7a5a1f' }}>{hub.funds}</div>
        </div>
        <div className="rounded p-1.5" style={{ background: PAPER }}>
          <div className="text-[8px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.tickets')}</div>
          <div className="text-[15px] font-bold" style={{ color: '#2f6b2f' }}>{hub.tickets}</div>
        </div>
        <div className="rounded p-1.5" style={{ background: PAPER }}>
          <div className="text-[8px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.winRate')}</div>
          <div className="text-[15px] font-bold">{winRate}%</div>
        </div>
      </div>
      <div className="rounded p-2 mb-3 text-center" style={{ background: PAPER }}>
        <div className="text-[9px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.totalFame')}</div>
        <div className="text-[22px] font-bold" style={{ color: '#7a5a1f' }}>✦ {fame}</div>
        <div className="text-[8px]" style={{ opacity: 0.6 }}>
          {hub.victories}/{hub.expeditions} {t('rpg.w.won')}{hub.bestNgPlus > 0 ? ` · ${t('rpg.w.best')} NG+${hub.bestNgPlus}` : ''} · {entries.length} {t('rpg.w.logged')}
        </div>
      </div>
      {/* Outfitters — the lodge shop. Each club's rank (earned by running its
          expeditions) gates its tiers; you pay Funds (or Tickets for the top tier)
          to deepen its boon. All numbers + the buy are client-owned (state.ts). */}
      <div className="text-[11px] font-bold mb-1 flex items-center gap-1">
        <Swords size={12} /> {t('rpg.lodge.outfitters')}
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        {SPONSOR_IDS.map(id => {
          const def = SPONSORS[id];
          const xp = hub.sponsorXp[id] || 0;
          const rank = sponsorRank(xp);
          const tier = hub.outfits[id] || 0;
          const off = sponsorOffer(hub, id);
          const loyal = loyaltyBoon(id, rank.tier);   // earned-rank dividend (empty below Member)
          const pct = rank.next != null ? Math.max(0, Math.min(1, xp / rank.next)) : 1;
          const costTxt = off.cost.funds != null ? `◈ ${off.cost.funds}` : off.cost.tickets != null ? `✦ ${off.cost.tickets}` : '';
          return (
            <div key={id} className="rounded p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold flex items-center gap-1 min-w-0">
                  <PixelSprite grid={SPRITES[clubSpriteKey(id)]} palette={spritePalette(clubSpriteKey(id))} px={1.5}
                               className="shrink-0 rounded-sm" title={def.name} />
                  <span className="truncate">{def.name}</span>
                </span>
                <span className="text-[8px] font-bold shrink-0" style={{ color: '#3a4a7a' }}>
                  {rank.name} · {t('rpg.lodge.tier')} {tier}/{4}
                </span>
              </div>
              <div className="h-[5px] rounded-full overflow-hidden mb-1" style={{ background: SCREEN_BG }}>
                <div className="h-full" style={{ width: `${Math.round(pct * 100)}%`, background: '#3a4a7a' }} />
              </div>
              <div className="text-[8px] mb-1" style={{ opacity: 0.7 }}>
                ✦{xp} {t('rpg.w.clubXp')}{rank.next != null ? ` · ${t('rpg.w.nextRankAt')} ✦${rank.next}` : ` · ${t('rpg.w.topRank')}`}
              </div>
              {loyal.label && (
                <div className="text-[8px] font-bold mb-1 flex items-center gap-1" style={{ color: '#3a4a7a' }}
                     title={t('rpg.lodge.loyaltyTitle')}>
                  <Sparkles size={9} /> {t('rpg.lodge.loyalty', { boon: loyal.label })}
                </div>
              )}
              {/* Club stable (CE2 rank-gated recruits): unlocked ones will lead the
                  hire pool of runs sponsored by this club; locked ones show the rank
                  to reach. Access, not free power — still hired or won in dialogue. */}
              <div className="mb-1 flex flex-col gap-0.5" title={t('rpg.lodge.stableTitle')}>
                {CLUB_RECRUITS[id].map((rec, i) => {
                  const open = rank.tier >= rec.rankReq;
                  return (
                    <div key={i} className="text-[8px] flex items-center gap-1"
                         style={{ color: open ? INK : DARK, opacity: open ? 1 : 0.55 }}>
                      <Users size={8} className="shrink-0" />
                      <b className="truncate">{rec.className}</b>
                      <span className="truncate" style={{ opacity: 0.8 }}>— {open ? rec.epithet : t('rpg.lodge.stableLocked', { rank: rec.rankReq })}</span>
                    </div>
                  );
                })}
              </div>
              {off.nextTier == null ? (
                <div className="text-[9px] font-bold text-center rounded py-1" style={{ background: SCREEN_BG, opacity: 0.75 }}>
                  {t('rpg.lodge.fullyOutfitted')}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[8px] min-w-0" style={{ opacity: 0.85 }}>
                    {t('rpg.lodge.next')} <b>{off.preview?.label}</b>
                  </span>
                  <button
                    onClick={() => { if (off.affordable) onBuy(id); }}
                    disabled={!off.affordable}
                    className="rounded px-2 py-0.5 text-[9px] font-bold shrink-0"
                    title={off.rankLocked ? t('rpg.lodge.rankLockedTitle') : off.affordable ? '' : t('rpg.lodge.notEnough')}
                    style={{
                      background: off.affordable ? INK : DARK, color: PAPER,
                      opacity: off.affordable ? 1 : 0.5, cursor: off.affordable ? 'pointer' : 'not-allowed',
                    }}>
                    {off.rankLocked ? t('rpg.lodge.rankLow') : t('rpg.lodge.buy', { cost: costTxt })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Perks — one earned per victory (renown-gated), a permanent boon folded into
          every future run's starting kit. Pure display; the claim happens on the end
          screen. All effects are client-owned & bounded (state.ts). */}
      <div className="text-[11px] font-bold mb-1 flex items-center gap-1">
        <Sparkles size={12} /> {t('rpg.lodge.perks')}
      </div>
      <div className="mb-3">
        {hub.perks.length === 0 ? (
          <div className="text-[9px] rounded p-2" style={{ background: PAPER, opacity: 0.7 }}>
            {t('rpg.lodge.noPerks')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {hub.perks.map(pid => {
              const p = PERKS[pid];
              if (!p) return null;
              return (
                <div key={pid} className="rounded p-1.5" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
                  <div className="text-[10px] font-bold flex items-center gap-1">
                    <span style={{ color: '#5a3a7a' }}>{p.glyph}</span>
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.7 }}>{p.blurb}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Commissions — the lodge's job board (lots 4 & 5). Accept ONE standing
          commission; your next victory that meets it pays Funds/Tickets and raises
          your Standing, which unlocks harder boards and advances the campaign's
          story acts. The board is generated procedurally & deterministically in
          state.ts (offline, no LLM); accept/abandon/refresh are all free. */}
      <div className="text-[11px] font-bold mb-1 flex items-center gap-1">
        <MapIcon size={12} /> {t('rpg.lodge.commissions')}
      </div>
      {/* Standing rank + current act narrative */}
      <div className="rounded p-2 mb-2" style={{ background: PAPER }}>
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-[9px]" style={{ opacity: 0.7 }}>{t('rpg.lodge.lodgeStanding')}</span>
          <span className="text-[8px]" style={{ opacity: 0.6 }}>
            {st.next != null ? `${t('rpg.w.nextRankAt')} ${st.next}` : t('rpg.w.topRank')}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-bold" style={{ color: '#7a5a1f' }}>{st.name}</span>
          <span className="text-[9px] font-bold" style={{ opacity: 0.7 }}>◆ {hub.standing}</span>
        </div>
        <div className="mt-1.5 pt-1.5 text-[9px]" style={{ borderTop: `1px solid ${SCREEN_BG}` }}>
          <span className="font-bold" style={{ color: '#3a4a7a' }}>{t('rpg.w.act')} {act.act} · {act.name}</span>
          <div className="text-[8px] leading-tight mt-0.5" style={{ opacity: 0.7 }}>{act.blurb}</div>
          <div className="text-[8px] mt-0.5" style={{ opacity: 0.6 }}>
            {act.into}/{act.step} {t('rpg.w.commissionsAct')} · {hub.contractsFulfilled} {t('rpg.w.fulfilled')}
          </div>
        </div>
      </div>
      {/* The active commission (if one is accepted) */}
      {active && (
        <div className="rounded p-2 mb-2" style={{ background: PAPER, border: `2px solid #7a5a1f` }}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-bold flex items-center gap-1">
              <span style={{ color: '#7a5a1f' }}>◆</span> {active.name}
            </span>
            <span className="text-[8px] rounded px-1 font-bold" style={{ background: '#7a5a1f', color: PAPER }}>{t('rpg.lodge.accepted')}</span>
          </div>
          <div className="text-[8px] leading-tight mb-1.5" style={{ opacity: 0.75 }}>{active.blurb}</div>
          <button onClick={onAbandonContract} className="rounded px-2 py-0.5 text-[8px] font-bold" style={{ background: DARK, color: PAPER }}>
            {t('rpg.lodge.abandon')}
          </button>
        </div>
      )}
      {/* The open board (offers you can pick up when nothing is active) */}
      <div className="flex flex-col gap-1.5 mb-1">
        {board.map(c => {
          const taken = !!active;
          const isActive = active?.id === c.id;
          return (
            <div key={c.id} className="rounded p-2" style={{ background: PAPER, border: `2px solid ${DARK}`, opacity: taken && !isActive ? 0.5 : 1 }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold truncate">{c.name}</span>
                <span className="text-[8px] font-bold shrink-0" style={{ color: '#3a4a7a' }}>{'★'.repeat(c.tier)}</span>
              </div>
              <div className="text-[8px] leading-tight mb-1.5" style={{ opacity: 0.75 }}>{contractCondText(c.cond)}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[8px] font-bold" style={{ color: '#7a5a1f' }}>
                  ◈{c.reward.funds}{c.reward.tickets > 0 ? ` ✦${c.reward.tickets}` : ''} · ◆+{c.reward.standing}
                </span>
                <button
                  onClick={() => { if (!taken) onAcceptContract(c.id); }}
                  disabled={taken}
                  className="rounded px-2 py-0.5 text-[9px] font-bold shrink-0"
                  title={taken ? t('rpg.lodge.commissionTakenTitle') : ''}
                  style={{ background: taken ? DARK : INK, color: PAPER, opacity: taken ? 0.5 : 1, cursor: taken ? 'not-allowed' : 'pointer' }}>
                  {isActive ? t('rpg.lodge.active') : t('rpg.lodge.accept')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={onRefreshBoard} className="w-full rounded px-2 py-1 text-[9px] font-bold mb-3" style={{ background: MID, color: INK }}>
        {t('rpg.lodge.postNew')}
      </button>
      {entries.length === 0 ? (
        <div className="text-[10px] text-center" style={{ opacity: 0.6 }}>
          {t('rpg.lodge.noExpeditions')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(e => (
            <div key={e.id} className="rounded p-2" style={{ background: PAPER, border: `2px solid ${DARK}` }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-bold">{e.title}</span>
                <span className="text-[8px] rounded px-1 font-bold"
                  style={{ background: e.outcome === 'victory' ? '#2f6b2f' : '#7a1f1f', color: PAPER }}>
                  {e.outcome === 'victory' ? t('rpg.lodge.victory') : t('rpg.lodge.defeat')}
                </span>
              </div>
              <div className="text-[8px] mb-1" style={{ opacity: 0.75 }}>
                ✦ {e.fame} {t('rpg.w.fame')} · {e.party.length} {e.party.length === 1 ? t('rpg.w.hero') : t('rpg.w.heroes')} · {t('rpg.w.levelAbbr')}{e.heroLevel}
                {e.ngPlus > 0 ? ` · NG+${e.ngPlus}` : ''}
              </div>
              {e.highlights.length > 0 && (
                <div className="text-[8px] leading-tight" style={{ opacity: 0.65 }}>
                  {e.highlights.join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <button onClick={onClear} className="mt-3 rounded px-2 py-1 text-[9px] font-bold" style={{ background: DARK, color: PAPER }}>
          {t('rpg.lodge.clearLogbook')}
        </button>
      )}
    </motion.div>
  );
}

function PartyView({ state, setState, onClose }: {
  state: RpgState;
  setState: React.Dispatch<React.SetStateAction<RpgState | null>>;
  onClose: () => void;
}) {
  const inventory = state.inventory || [];
  const onUse = (itemId: string) => setState(prev => (prev ? usePotion(prev, itemId).state : prev));
  // Selling a valuable needs a settlement under the party's feet.
  const here = currentNode(state);
  const atTown = here.kind === 'town' || here.kind === 'village';
  const onSell = (itemId: string) => setState(prev => (prev ? sellValuable(prev, itemId, here.id).state : prev));
  const cap = satchelCap(state);
  const bulk = satchelBulk(state);
  const haul = satchelValue(state);
  const syn = teamSynergy(state);
  return (
    <motion.div className="absolute inset-0 z-10 overflow-auto p-3"
      style={{ background: SCREEN_BG, color: INK, fontFamily: 'monospace' }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold flex items-center gap-1">
          <Users size={13} /> {t('rpg.party.title', { n: state.party.length })}
        </span>
        <button onClick={onClose} className="rounded px-2 py-0.5 text-[10px] font-bold" style={{ background: INK, color: PAPER }}>
          {t('rpg.lodge.close')}
        </button>
      </div>
      {/* Morale — the party's collective resolve. Drains on the road, restored by
          rest and safe towns; if it breaks, a companion may desert. */}
      <MoraleBar morale={state.morale ?? 100} />
      {/* Provisions — rations for the road; empty on a leg starves the party. */}
      <ProvisionsBar provisions={state.provisions ?? PROV_MAX} />
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {state.party.map(c => <CharacterCard key={c.id} c={c} />)}
      </div>

      {/* Team synergy — the composition edge that rides on every blow in combat. */}
      <div className="rounded px-2 py-1 mb-3 text-[9px]" style={{ background: PAPER }}>
        <span className="font-bold" style={{ opacity: 0.85 }}>
          {t('rpg.party.synergy', { n: syn.bonus })}
        </span>
        <span style={{ opacity: 0.7 }}>
          {syn.parts.length ? ' · ' + syn.parts.join(' · ') : t('rpg.party.loneBand')}
        </span>
      </div>

      {/* Satchel — shared loot: potions (usable), gear (worn boon), valuables (the
          haul → fame, sellable at towns) + gold. Valuables carry weight (the cap). */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold flex items-center gap-1" style={{ opacity: 0.85 }}>
          {t('rpg.party.satchel')} <span style={{ opacity: 0.7 }}>{t('rpg.party.load', { b: bulk, c: cap })}</span>
        </span>
        <span className="text-[10px] font-bold flex items-center gap-2" style={{ opacity: 0.85 }}>
          {haul > 0 && <span title={t('rpg.inv.haulTitle')}>{t('rpg.inv.haul', { n: haul })}</span>}
          <span className="flex items-center gap-1"><Sparkles size={11} /> {t('rpg.inv.gold', { n: state.gold || 0 })}</span>
        </span>
      </div>
      {/* Carry-load bar — full means a richer find bumps a lesser one (CE2 tension). */}
      <div className="h-1 rounded mb-1.5 overflow-hidden" style={{ background: '#0003' }}>
        <div className="h-full" style={{ width: `${Math.min(100, (bulk / cap) * 100)}%`, background: bulk >= cap ? '#b4541f' : '#7a5a1f' }} />
      </div>
      <div className="flex flex-col gap-1 mb-3">
        {inventory.length === 0 && (
          <div className="text-[9px]" style={{ opacity: 0.55 }}>{t('rpg.satchel.empty')}</div>
        )}
        {inventory.map(it => (
          <div key={it.id} className="flex items-center justify-between rounded px-2 py-1" style={{ background: PAPER }}>
            <span className="text-[10px]">
              <b>{it.name}</b>
              <span style={{ opacity: 0.7 }}> · {it.desc}</span>
            </span>
            {it.kind === 'potion' && (
              <button onClick={() => onUse(it.id)}
                className="rounded px-2 py-0.5 text-[9px] font-bold shrink-0 ml-2" style={{ background: INK, color: PAPER }}>
                {t('rpg.inv.use')}
              </button>
            )}
            {it.kind === 'trinket' && (
              <span className="rounded px-1.5 py-0.5 text-[8px] font-bold shrink-0 ml-2"
                style={{ background: '#3a2d6b', color: PAPER }} title={t('rpg.inv.curioTitle')}>
                {t('rpg.inv.curio')}
              </span>
            )}
            {it.kind === 'relic' && (
              <span className="rounded px-1.5 py-0.5 text-[8px] font-bold shrink-0 ml-2"
                style={{ background: '#7a5a1f', color: PAPER }} title={t('rpg.inv.relicTitle')}>
                {t('rpg.inv.relic')}
              </span>
            )}
            {it.kind === 'valuable' && (
              atTown ? (
                <button onClick={() => onSell(it.id)}
                  className="rounded px-2 py-0.5 text-[9px] font-bold shrink-0 ml-2" style={{ background: '#7a5a1f', color: PAPER }}
                  title={t('rpg.inv.sellTitle', { n: it.value ?? 0 })}>
                  {t('rpg.inv.sell', { n: it.value ?? 0 })}
                </button>
              ) : (
                <span className="rounded px-1.5 py-0.5 text-[8px] font-bold shrink-0 ml-2"
                  style={{ background: '#7a5a1f', color: PAPER }} title={t('rpg.inv.valuableTitle')}>
                  {t('rpg.inv.haul', { n: it.value ?? 0 })}
                </span>
              )
            )}
          </div>
        ))}
      </div>
      {state.recruitPool.length > 0 && (
        <>
          <div className="text-[10px] font-bold mb-1" style={{ opacity: 0.85 }}>
            {t('rpg.party.recruitHeader')}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {state.recruitPool.map((c, i) => {
              // Hired one at a time off the front of the pool, so the i-th joins
              // when the party is i larger — price it accordingly.
              const cost = recruitCost(c, state.party.length + i);
              return <CharacterCard key={c.id} c={c} recruit cost={cost} afford={(state.gold || 0) >= cost} />;
            })}
          </div>
        </>
      )}
      {state.recruitPool.length === 0 && state.party.length >= 4 && (
        <div className="text-[9px] text-center" style={{ opacity: 0.6 }}>{t('rpg.party.full')}</div>
      )}
    </motion.div>
  );
}

// ── End screen ────────────────────────────────────────────────────────────────

function EndView({ state, onReset, llmOpts, onNewGamePlus, ngLoading, campaign, onContinueCampaign, onRestartCampaign }: {
  state: RpgState;
  onReset: () => void;
  llmOpts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string };
  onNewGamePlus: () => void;
  ngLoading: boolean;
  campaign: Campaign | null;
  onContinueCampaign: () => void;
  onRestartCampaign: () => void;
}) {
  const win = state.phase === 'victory';
  // A defeat with the party still standing means a rival expedition reached the
  // prize first — a lost race, not a wipe. Tailor the closing line accordingly.
  const rivalWon = !win && state.party.some(c => c.alive);
  const winner = rivalWon ? (state.rivals || []).find(r => r.arrived) : undefined;
  // The GM closes the tale: one epilogue, authored once on victory. The client
  // hands it the finished party + quest; the LLM only writes the closing lines.
  const [epilogue, setEpilogue] = useState('');
  const [epiBusy, setEpiBusy] = useState(win);
  const fetched = useRef(false);
  // Bank this run into the logbook (both outcomes) once, and surface the Fame it
  // earned + the new running total. recordRun is idempotent per run, so a remount
  // can't double-bank — the ref just spares a redundant write.
  const [fame, setFame] = useState<{ earned: number; total: number } | null>(null);
  // The lodge banks the same run: gold → Funds, milestone Tickets, lifetime
  // counters, and the Renown rank derived from the new Fame total. Both writes
  // are idempotent per run, so a remount can't double-bank.
  const [hub, setHub] = useState<{ state: HubState; goldBanked: number; ticketsEarned: number } | null>(null);
  // CE2's one-perk-per-expedition: on a win the lodge offers the perks the new Fame
  // total has unlocked that aren't owned yet; the player keeps one. Idempotent per
  // run via the hub's perkRuns guard.
  const [perkPick, setPerkPick] = useState<{ runId: string; options: PerkDef[]; total: number } | null>(null);
  const [claimedPerk, setClaimedPerk] = useState<PerkDef | null>(null);
  // The active commission settles here on a win that meets it (lots 4 & 5):
  // Funds/Tickets/Standing paid out, the story advances. Idempotent per run via the
  // hub's contractRuns guard (a remount can't double-pay).
  const [contractDone, setContractDone] = useState<{ contract: Contract; actBefore: number; actAfter: number } | null>(null);
  // The campaign banks this chapter too: fame toward the goal, the chronicle entry,
  // and the surviving band carried forward. Idempotent (recordChapter guards on the
  // last chronicle entry), so a remount can't double-bank.
  const [campAfter, setCampAfter] = useState<Campaign | null>(null);
  const banked = useRef(false);
  useEffect(() => {
    if (banked.current) return;
    banked.current = true;
    if (campaign) setCampAfter(recordChapter(campaign, state, win ? 'victory' : 'defeat'));
    const before = loadLogbook().fame;
    const after = recordRun(state, win ? 'victory' : 'defeat');
    setFame({ earned: after.fame - before, total: after.fame });
    const hubBefore = loadHub();
    const hubAfter = recordReturn(state, win ? 'victory' : 'defeat');
    setHub({
      state: hubAfter,
      goldBanked: hubAfter.funds - hubBefore.funds,
      ticketsEarned: hubAfter.tickets - hubBefore.tickets,
    });
    if (win) {
      const runId = perkRunId(state);
      if (canClaimPerk(hubAfter, runId)) {
        const options = perkOffer(hubAfter, after.fame);
        if (options.length) setPerkPick({ runId, options, total: after.fame });
      }
      // Settle the active commission (reads the post-return hub, pays out, advances
      // the story). Reflect the new banks in the displayed hub.
      const sr = settleContract(state, 'victory');
      if (sr.settled && sr.contract) {
        setHub(h => h ? { ...h, state: sr.hub } : h);
        setContractDone({ contract: sr.contract, actBefore: sr.actBefore, actAfter: sr.actAfter });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onClaimPerk = useCallback((p: PerkDef) => {
    if (!perkPick) return;
    const r = claimPerk(perkPick.runId, p.id, perkPick.total);
    if (r.ok) {
      setHub(h => h ? { ...h, state: r.hub } : h);
      setClaimedPerk(p);
      setPerkPick(null);
    }
  }, [perkPick]);
  useEffect(() => {
    if (!win || fetched.current) return;
    fetched.current = true;
    // Keep the surviving heroes — they become summonable in the start vignette.
    saveVeterans(state);
    const survivors = state.party.filter(c => c.alive).map(c => `${c.name} (L${c.level})`).join(', ');
    const ctx = `The quest "${state.quest.title}" is won. Heroes: ${survivors}. Gold gathered: ${state.gold || 0}.`;
    (async () => {
      try {
        const res = await api.rpgResolve(ctx, 'Write a short triumphant epilogue closing the adventure.', state.theme, llmOpts);
        setEpilogue(res.narration);
      } catch { /* leave the static victory line */ }
      finally { setEpiBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="p-6 flex flex-col items-center justify-center text-center" style={{ color: INK, fontFamily: 'monospace', height: '100%', minHeight: 360 }}>
      <div className="text-[28px] font-bold mb-2">{win ? t('rpg.end.victory') : rivalWon ? t('rpg.end.outraced') : t('rpg.end.gameover')}</div>
      <div className="text-[12px] mb-1">{state.title}</div>
      <div className="text-[10px] mb-3" style={{ opacity: 0.8, maxWidth: 360 }}>
        {win
          ? t('rpg.end.completed', { title: state.quest.title })
          : rivalWon
            ? t('rpg.end.rivalReached', { name: winner ? winner.name : t('rpg.end.aRival'), q: state.quest.title })
            : t('rpg.end.partyFallen')}
      </div>
      {rivalWon && winner && (
        <div className="text-[10px] mb-3 font-bold" style={{ color: '#7a1f1f', maxWidth: 360 }}>
          {winner.nemesis
            ? t('rpg.end.grudge', { name: winner.name })
            : t('rpg.end.haunt', { name: winner.name })}
        </div>
      )}
      {win && (epiBusy || epilogue) && (
        <div className="rounded p-2.5 text-[11px] leading-snug mb-4" style={{ background: PAPER, maxWidth: 380 }}>
          {epiBusy ? <span style={{ opacity: 0.6 }}>{t('rpg.gm.epilogue')}</span> : epilogue}
        </div>
      )}
      <div className="text-[10px] mb-3" style={{ opacity: 0.7 }}>
        {state.party.map(c => `${c.name} L${c.level}`).join(' · ')}
        {state.ngPlus > 0 ? ` · NG+${state.ngPlus}` : ''}
      </div>
      {fame && (
        <div className="rounded px-3 py-1.5 mb-2 text-[11px] font-bold flex items-center gap-2"
          style={{ background: PAPER }}>
          <span style={{ color: '#7a5a1f' }}>{t('rpg.end.fameEarned', { n: fame.earned })}</span>
          <span style={{ opacity: 0.6 }}>{t('rpg.end.fameTotal', { n: fame.total })}</span>
        </div>
      )}
      {hub && fame && (() => {
        const rk = renownTier(fame.total);
        return (
          <div className="rounded px-3 py-1.5 mb-4 text-[10px] flex flex-col items-center gap-1"
            style={{ background: PAPER, maxWidth: 360 }}>
            <div className="font-bold flex items-center gap-1.5">
              <span style={{ color: '#3a4a7a' }}>{t('rpg.end.renown')}</span>
              <span>{rk.name}{rk.stars > 0 ? ' ' + '★'.repeat(Math.min(rk.stars, 5)) : ''}</span>
              {rk.next != null && <span style={{ opacity: 0.5 }}>{t('rpg.end.nextAt', { n: rk.next })}</span>}
            </div>
            <div className="flex items-center gap-3" style={{ opacity: 0.85 }}>
              <span>{t('rpg.hud.funds')} {hub.state.funds}{hub.goldBanked > 0 ? ` (+${hub.goldBanked})` : ''}</span>
              <span>{t('rpg.hud.tickets')} {hub.state.tickets}{hub.ticketsEarned > 0 ? ` (+${hub.ticketsEarned})` : ''}</span>
            </div>
            <div style={{ opacity: 0.55 }}>{t('rpg.end.expeditionsWon', { v: hub.state.victories, e: hub.state.expeditions })}</div>
            {(() => {
              // Where this return leaves you in the season's Great Race — the
              // rivals advanced too (seasonStandings moves with hub.expeditions).
              const rows = seasonStandings(hub.state, fame.total);
              const me = rows.find(r => r.you);
              if (!me) return null;
              const leader = rows[0];
              return (
                <div className="font-bold" style={{ color: me.rank === 1 ? '#7a5a1f' : '#3a4a7a' }}>
                  {t('rpg.end.greatRace', { r: me.rank, n: rows.length })}
                  {me.rank > 1 ? t('rpg.end.leaderLeads', { name: leader.name, by: leader.fame - me.fame }) : t('rpg.end.youLead')}
                </div>
              );
            })()}
          </div>
        );
      })()}
      {win && perkPick && (
        <div className="rounded p-3 mb-4 w-full" style={{ background: PAPER, maxWidth: 400 }}>
          <div className="text-[11px] font-bold mb-2" style={{ color: '#5a3a7a' }}>{t('rpg.end.choosePerk')}</div>
          <div className="text-[9px] mb-2.5" style={{ opacity: 0.6 }}>{t('rpg.end.oneReward')}</div>
          <div className="grid grid-cols-2 gap-2">
            {perkPick.options.slice(0, 4).map(p => (
              <button key={p.id} onClick={() => onClaimPerk(p)}
                className="rounded p-2 text-left" style={{ background: '#fff', border: `1px solid ${INK}33` }}>
                <div className="text-[11px] font-bold flex items-center gap-1.5">
                  <span style={{ color: '#5a3a7a' }}>{p.glyph}</span>{p.name}
                </div>
                <div className="text-[9px] leading-snug mt-0.5" style={{ opacity: 0.7 }}>{p.blurb}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {win && claimedPerk && (
        <div className="rounded px-3 py-1.5 mb-4 text-[11px] font-bold flex items-center gap-1.5"
          style={{ background: PAPER }}>
          <span style={{ color: '#5a3a7a' }}>{t('rpg.end.perk')}</span>
          <span>{t('rpg.end.perkEarned', { glyph: claimedPerk.glyph, name: claimedPerk.name })}</span>
        </div>
      )}
      {win && contractDone && (
        <div className="rounded p-2.5 mb-4 text-[10px] flex flex-col items-center gap-1" style={{ background: PAPER, maxWidth: 360 }}>
          <div className="font-bold flex items-center gap-1.5">
            <span style={{ color: '#7a5a1f' }}>{t('rpg.end.commissionFulfilled')}</span>
          </div>
          <div style={{ opacity: 0.85 }}>{contractDone.contract.name}</div>
          <div className="font-bold" style={{ color: '#7a5a1f' }}>
            ◈+{contractDone.contract.reward.funds}
            {contractDone.contract.reward.tickets > 0 ? ` ✦+${contractDone.contract.reward.tickets}` : ''}
            {' '}· ◆ {t('rpg.end.standing')} +{contractDone.contract.reward.standing}
          </div>
          {contractDone.actAfter > contractDone.actBefore && (
            <div className="font-bold mt-0.5" style={{ color: '#3a4a7a' }}>
              {t('rpg.end.storyTurns', { n: contractDone.actAfter, name: storyAct((contractDone.actAfter - 1) * 3).name })}
            </div>
          )}
        </div>
      )}
      {/* Campaign progress — the chapter banked into the saga, the fame bar scaled
          to the goal (the single scale), and the band carried forward. */}
      {campAfter && (() => {
        const pct = Math.round(campaignProgress(campAfter) * 100);
        const carried = campAfter.party.length;
        return (
          <div className="rounded p-2.5 mb-4 w-full text-[10px] flex flex-col gap-1.5" style={{ background: PAPER, maxWidth: 380 }}>
            <div className="font-bold flex items-center justify-between">
              <span style={{ color: '#7a5a1f' }}>{t('rpg.end.chapterChronicled', { n: campAfter.chapter - 1 })}</span>
              <span style={{ opacity: 0.8 }}>{t('rpg.end.fameGoal', { f: campAfter.fame, g: campAfter.goalFame })}</span>
            </div>
            <div className="h-2 rounded-sm overflow-hidden" style={{ background: 'rgba(0,0,0,0.12)' }}>
              <div className="h-full" style={{ width: `${pct}%`, background: campAfter.done ? '#d9b65c' : '#9ad14e' }} />
            </div>
            <div style={{ opacity: 0.75 }}>
              {campAfter.failed
                ? t('rpg.end.bandNoMore')
                : campAfter.done
                  ? t('rpg.end.finishLine')
                  : carried > 0
                    ? (carried === 1 ? t('rpg.end.companionCarry1', { n: carried }) : t('rpg.end.companionsCarryN', { n: carried }))
                    : t('rpg.end.trailGoesOn')}
            </div>
          </div>
        );
      })()}
      <div className="flex flex-col gap-2 items-center">
        {/* Campaign mode owns carry + escalation, so it replaces NG+ with a plain
            "next chapter" that returns to the picker (party already persisted). */}
        {campAfter ? (
          <>
            {campAfter.done && (
              <button onClick={onRestartCampaign}
                className="rounded-md py-2 px-6 text-[12px] font-bold" style={{ background: '#d9b65c', color: INK }}>
                {t('rpg.chapter.triumph')}
              </button>
            )}
            {!campAfter.failed && !campAfter.done && (
              <button onClick={onContinueCampaign}
                className="rounded-md py-2 px-6 text-[12px] font-bold" style={{ background: INK, color: PAPER }}>
                {t('rpg.end.nextExpedition')}
              </button>
            )}
            <button onClick={onRestartCampaign} className="rounded-md py-1.5 px-6 text-[11px] font-bold"
              style={{ background: campAfter.failed ? INK : DARK, color: PAPER }}>
              {campAfter.done ? t('rpg.end.startNewSaga') : campAfter.failed ? t('rpg.end.newAdventure') : t('rpg.end.abandonSaga')}
            </button>
          </>
        ) : (
          <>
            {win && (
              <button onClick={onNewGamePlus} disabled={ngLoading}
                className="rounded-md py-2 px-6 text-[12px] font-bold" style={{ background: INK, color: PAPER, opacity: ngLoading ? 0.7 : 1, cursor: ngLoading ? 'wait' : 'pointer' }}>
                {ngLoading ? t('rpg.end.forgingHarder') : t('rpg.end.newGamePlus')}
              </button>
            )}
            <button onClick={onReset} className="rounded-md py-1.5 px-6 text-[11px] font-bold" style={{ background: win ? DARK : INK, color: PAPER }}>
              {t('rpg.end.newAdventure')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
