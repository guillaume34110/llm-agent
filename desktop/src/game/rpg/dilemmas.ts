import type { StatKey, DilemmaDelta, DilemmaState, DilemmaOption } from './types';

// ── Dilemmas (Curious-Expedition-style road choices; client-owned numbers) ────
// A frozen table of situations. The base magnitudes below are danger-0 values;
// rollDilemma scales HP/gold/XP and the DC up with the destination's danger. The
// strings are theme-neutral English (the deterministic authoring); an LLM reskin
// can replace them later without touching a single number. An option with no
// `stat` auto-resolves to its `good` outcome (a sure trade like paying a toll).
export interface DilemmaTemplate {
  prompt: string;
  options: Array<{ label: string; stat?: StatKey; dc?: number; good: DilemmaDelta; bad?: DilemmaDelta }>;
}
export const DILEMMAS: DilemmaTemplate[] = [
  {
    prompt: 'A swollen river cuts across the road, its current fast and cold.',
    options: [
      { label: 'Ford it by main strength', stat: 'might', dc: 12,
        good: { morale: 6, xp: 4, text: 'You haul everyone across against the current.' },
        bad: { hp: -5, morale: -6, text: 'The current drags you down; the party scrambles out battered.' } },
      { label: 'Leap the stepping stones', stat: 'agility', dc: 13,
        good: { morale: 8, text: 'Light feet carry you over dry.' },
        bad: { hp: -4, text: 'A stone turns underfoot and you fall in.' } },
      { label: 'Lash together a raft', stat: 'wits', dc: 11,
        good: { morale: 5, xp: 5, text: 'A sturdy raft ferries the band over.' },
        bad: { morale: -8, text: 'The raft breaks apart; hours are lost and spirits sink.' } },
    ],
  },
  {
    prompt: 'A ragged stranger slumps by the roadside, begging for help.',
    options: [
      { label: 'Tend to them', stat: 'spirit', dc: 10,
        good: { morale: 8, xp: 4, text: 'Grateful, they share a traveller’s blessing.' },
        bad: { gold: -15, morale: -4, text: 'It was a ruse — a cutpurse lifts your coin.' } },
      { label: 'Question them first', stat: 'wits', dc: 12,
        good: { gold: 20, text: 'You see through the act and turn it to profit.' },
        bad: { morale: -6, text: 'You misjudge them and leave a friend behind, uneasy.' } },
      { label: 'Walk on by',
        good: { morale: -5, text: 'You pass without a word; the silence weighs on the party.' } },
    ],
  },
  {
    prompt: 'Rough figures block a narrow pass and demand a toll.',
    options: [
      { label: 'Fight through', stat: 'might', dc: 13,
        good: { xp: 6, morale: 6, text: 'Steel settles the matter; the road is yours.' },
        bad: { hp: -6, morale: -6, text: 'The brawl goes badly before you break free.' } },
      { label: 'Talk your way past', stat: 'wits', dc: 12,
        good: { morale: 6, text: 'A clever word and you slip by, coin intact.' },
        bad: { gold: -20, text: 'Words fail; you pay to pass.' } },
      { label: 'Pay the toll',
        good: { gold: -18, morale: -3, text: 'You hand over coin and trudge on.' } },
    ],
  },
  {
    prompt: 'Strange fruit hangs heavy here — some say it heals, some say it sickens.',
    options: [
      { label: 'Pick only the safe fruit', stat: 'wits', dc: 12,
        good: { hp: 6, morale: 4, text: 'You choose well; the party eats and mends.' },
        bad: { hp: -4, text: 'A bad pick — cramps and grumbling.' } },
      { label: 'Trust your gut', stat: 'spirit', dc: 13,
        good: { hp: 8, morale: 6, text: 'Instinct rewards you with a fine meal.' },
        bad: { hp: -5, morale: -4, text: 'Your gut was wrong; the night is rough.' } },
    ],
  },
  {
    prompt: 'A weathered shrine stands at a fork, an empty offering bowl before it.',
    options: [
      { label: 'Leave an offering',
        good: { gold: -12, morale: 8, text: 'You give freely; a quiet calm settles over the band.' } },
      { label: 'Pray in silence', stat: 'spirit', dc: 11,
        good: { morale: 8, xp: 4, text: 'The stillness steadies every heart.' },
        bad: { morale: -3, text: 'The words ring hollow; you move on unmoved.' } },
    ],
  },
  {
    prompt: 'A dim trail branches off — a shortcut, if the woods are kind.',
    options: [
      { label: 'Take the shortcut', stat: 'agility', dc: 13,
        good: { morale: 8, xp: 4, text: 'You slip through quickly, road and time saved.' },
        bad: { hp: -5, morale: -6, text: 'The woods turn hostile; you fight clear, shaken.' } },
      { label: 'Keep to the safe road',
        good: { morale: -4, text: 'The long way is dull and tiring, but safe.' } },
    ],
  },
];

// Scale a danger-0 base delta up with the destination's danger (client-owned).
export function scaleDelta(base: DilemmaDelta, danger: number): DilemmaDelta {
  const m = 1 + danger * 0.5;    // HP / gold / XP grow with the stakes
  const mm = 1 + danger * 0.25;  // morale swings a little harder too
  return {
    text: base.text,
    hp: base.hp != null ? Math.round(base.hp * m) : undefined,
    gold: base.gold != null ? Math.round(base.gold * m) : undefined,
    xp: base.xp != null ? Math.round(base.xp * m) : undefined,
    morale: base.morale != null ? Math.round(base.morale * mm) : undefined,
  };
}

// Pick + scale a concrete dilemma for the leg. The returned options already carry
// their final numbers, so resolveDilemma stays a pure application of them.
export function rollDilemma(rng: () => number, nodeId: string, danger: number): DilemmaState {
  const t = DILEMMAS[Math.floor(rng() * DILEMMAS.length)];
  const options: DilemmaOption[] = t.options.map(o => ({
    label: o.label,
    stat: o.stat,
    dc: o.dc != null ? o.dc + danger : undefined,
    good: scaleDelta(o.good, danger),
    bad: o.bad ? scaleDelta(o.bad, danger) : undefined,
  }));
  return { nodeId, prompt: t.prompt, options, resolved: false };
}
