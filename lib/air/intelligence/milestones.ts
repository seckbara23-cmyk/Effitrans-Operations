/**
 * Air Cargo — canonical milestone lifecycle (Phase 7.3A). PURE. Sibling of the ocean
 * milestone model (same architecture): event-driven, classify rather than force a rail;
 * validate only the impossible (leaving a terminal state). DELIVERED / CANCELLED terminal;
 * EXCEPTION is a resolvable hold.
 */
export const AIR_MILESTONES = [
  "BOOKED", "ACCEPTED", "SECURITY", "READY_FOR_FLIGHT", "LOADED", "DEPARTED", "ARRIVED",
  "TRANSFER", "CUSTOMS", "RELEASED", "DELIVERED", "EXCEPTION", "CANCELLED",
] as const;
export type AirMilestone = (typeof AIR_MILESTONES)[number];

const PROGRESS: AirMilestone[] = [
  "BOOKED", "ACCEPTED", "SECURITY", "READY_FOR_FLIGHT", "LOADED", "DEPARTED", "TRANSFER", "ARRIVED",
  "CUSTOMS", "RELEASED", "DELIVERED",
];

export type AirMilestoneCategory = "shipment" | "security" | "handling" | "flight" | "customs" | "delivery" | "control";
export const AIR_MILESTONE_CATEGORY: Record<AirMilestone, AirMilestoneCategory> = {
  BOOKED: "shipment", ACCEPTED: "shipment", SECURITY: "security", READY_FOR_FLIGHT: "handling", LOADED: "handling",
  DEPARTED: "flight", TRANSFER: "flight", ARRIVED: "flight", CUSTOMS: "customs", RELEASED: "customs",
  DELIVERED: "delivery", EXCEPTION: "control", CANCELLED: "control",
};

export function isAirMilestone(v: string): v is AirMilestone {
  return (AIR_MILESTONES as readonly string[]).includes(v);
}
export function isTerminalAirMilestone(m: AirMilestone): boolean {
  return m === "DELIVERED" || m === "CANCELLED";
}
export function airMilestoneProgress(m: AirMilestone): number {
  return PROGRESS.indexOf(m);
}

export type AirApplyKind = "advance" | "repeat" | "regress" | "exception" | "cancel" | "invalid";
export type AirApplyResult = { ok: true; kind: Exclude<AirApplyKind, "invalid"> } | { ok: false; kind: "invalid"; reason: string };

export function classifyAirMilestone(current: AirMilestone, next: AirMilestone): AirApplyResult {
  if (isTerminalAirMilestone(current)) return { ok: false, kind: "invalid", reason: "terminal" };
  if (next === "CANCELLED") return { ok: true, kind: "cancel" };
  if (next === "EXCEPTION") return { ok: true, kind: "exception" };
  if (current === "EXCEPTION") return { ok: true, kind: "advance" };
  const cur = airMilestoneProgress(current), nxt = airMilestoneProgress(next);
  if (nxt > cur) return { ok: true, kind: "advance" };
  if (nxt === cur) return { ok: true, kind: "repeat" };
  return { ok: true, kind: "regress" };
}

const LABEL_FR: Record<AirMilestone, string> = {
  BOOKED: "Réservé", ACCEPTED: "Accepté", SECURITY: "Sûreté", READY_FOR_FLIGHT: "Prêt au vol", LOADED: "Chargé",
  DEPARTED: "Décollé", ARRIVED: "Atterri", TRANSFER: "Transfert", CUSTOMS: "Dédouanement", RELEASED: "Mainlevée",
  DELIVERED: "Livré", EXCEPTION: "Exception", CANCELLED: "Annulé",
};
export function airMilestoneLabel(m: AirMilestone): string {
  return LABEL_FR[m] ?? m;
}
