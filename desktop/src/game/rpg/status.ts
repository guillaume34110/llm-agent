import type { StatusId, StatusEffect } from './types';

// ── Combat status effects (client-owned timed conditions) ────────────────────
// `dot` = bleeds HP each round; `lethal` = that bleed can drop the holder (foe
// burns/bleeds out; party poison is non-lethal, floored at 1 like a hazard).
export const STATUS_META: Record<StatusId, { label: string; dot: boolean; lethal: boolean }> = {
  burn:   { label: 'Burn',   dot: true,  lethal: true },
  bleed:  { label: 'Bleed',  dot: true,  lethal: true },
  poison: { label: 'Poison', dot: true,  lethal: false },
  stun:   { label: 'Stun',   dot: false, lethal: false },
};

// Apply (or refresh) a status: re-applying keeps the LONGER duration and the
// STRONGER tick, so it never weakens an existing condition and never stacks into
// a runaway DoT. One entry per id. Pure client-owned numbers.
export function addStatus(holder: { status?: StatusEffect[] }, id: StatusId, rounds: number, power: number): void {
  const list = holder.status ?? (holder.status = []);
  const cur = list.find(s => s.id === id);
  if (cur) { cur.rounds = Math.max(cur.rounds, rounds); cur.power = Math.max(cur.power, power); }
  else list.push({ id, rounds, power });
}

export function hasStatus(holder: { status?: StatusEffect[] }, id: StatusId): boolean {
  return !!holder.status?.some(s => s.id === id && s.rounds > 0);
}

// Tick every status on one holder: a DoT bleeds its HP, then every status loses a
// round and the spent ones are dropped. `floorAt1` keeps a non-lethal DoT (party
// poison) from ever downing a member outright. Pushes one log line per damaging
// tick. Returns total HP lost this tick. No RNG — fully deterministic.
export function tickStatuses(holder: { hp: number; name: string; status?: StatusEffect[] }, lines: string[], floorAt1: boolean): number {
  const list = holder.status;
  if (!list || list.length === 0) return 0;
  let lost = 0;
  for (const s of list) {
    if (s.rounds <= 0) continue;
    const meta = STATUS_META[s.id];
    if (meta.dot && s.power > 0) {
      let dmg = s.power;
      if (floorAt1) dmg = Math.min(dmg, Math.max(0, holder.hp - 1));
      if (dmg > 0) {
        holder.hp -= dmg; lost += dmg;
        lines.push(`${holder.name} suffers ${dmg} ${meta.label.toLowerCase()} damage.`);
      }
    }
    s.rounds -= 1;
  }
  holder.status = list.filter(s => s.rounds > 0);
  return lost;
}
