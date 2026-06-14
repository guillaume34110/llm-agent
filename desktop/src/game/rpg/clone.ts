import type { RpgState } from './types';

// Deep-enough clone of the run state so a reducer can mutate freely without
// touching the caller's object (React state must stay immutable). Every nested
// array/record the reducers touch is copied; primitives ride the shallow spread.
export function clone(state: RpgState): RpgState {
  return {
    ...state,
    quest: { ...state.quest },
    nodes: Object.fromEntries(Object.entries(state.nodes).map(([k, v]) => [k, {
      ...v, edges: [...v.edges], rooms: v.rooms ? v.rooms.map(r => ({ ...r })) : v.rooms,
      discovery: v.discovery ? { ...v.discovery } : v.discovery,
    }])),
    order: [...state.order],
    party: state.party.map(c => ({ ...c, stats: { ...c.stats }, status: c.status ? c.status.map(s => ({ ...s })) : c.status })),
    recruitPool: state.recruitPool.map(c => ({ ...c, stats: { ...c.stats } })),
    inventory: (state.inventory || []).map(i => ({ ...i })),
    log: [...state.log],
    rumors: [...(state.rumors || [])],
    scene: state.scene ? { ...state.scene, choices: [...state.scene.choices] } : null,
    dialogue: state.dialogue ? { ...state.dialogue, history: [...state.dialogue.history] } : null,
    combat: state.combat
      ? { ...state.combat, enemies: state.combat.enemies.map(e => ({ ...e, status: e.status ? e.status.map(s => ({ ...s })) : e.status })), log: [...state.combat.log] }
      : null,
    dilemma: state.dilemma
      ? { ...state.dilemma, options: state.dilemma.options.map(o => ({ ...o, good: { ...o.good }, bad: o.bad ? { ...o.bad } : undefined })) }
      : null,
    rivals: (state.rivals || []).map(r => ({ ...r, path: [...r.path] })),
    rivalEncounter: state.rivalEncounter
      ? { ...state.rivalEncounter, options: state.rivalEncounter.options.map(o => ({ ...o })), roll: state.rivalEncounter.roll ? { ...state.rivalEncounter.roll } : undefined }
      : null,
  };
}
