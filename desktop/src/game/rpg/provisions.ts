// ── Provisions (rations carried, 0..PROV_MAX; client-owned) ──────────────────
// The expedition's food. Every travel leg consumes some (longer roads eat more);
// rations are restocked with gold at villages/towns. Running out mid-leg starves
// the party: extra HP loss (never lethal — floored at 1) plus a morale hit.
export const PROV_MAX = 12;
export const PROV_COST = 3; // gold per ration at a settlement
export function clampProv(n: number): number {
  return Math.max(0, Math.min(PROV_MAX, Math.round(n)));
}
// Rations a leg of road-distance `dist` eats (≥1; longer legs cost more).
export function legProvisionCost(dist: number): number {
  return Math.max(1, Math.round(1 + dist * 4));
}
