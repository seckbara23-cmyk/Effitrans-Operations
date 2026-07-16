/**
 * Shipping Line Platform — canonical ocean milestone lifecycle (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * Provider-neutral, and DISTINCT from the internal operational file workflow
 * (lib/files/*) and the customs lifecycle (lib/customs/*). Ocean logistics is
 * event-driven, not a rigid line: transshipments loop, cargo rolls, holds happen,
 * carriers issue corrections. So we validate what is genuinely impossible (leaving a
 * terminal state, completing before delivery) while CLASSIFYING the rest — advance /
 * repeat / regress(correction) / exception / cancel — rather than forbidding it.
 */
export const SHIPPING_MILESTONES = [
  "BOOKING_CREATED", "BOOKING_CONFIRMED", "EMPTY_RELEASED", "GATE_IN", "LOADED",
  "VESSEL_DEPARTED", "IN_TRANSIT", "TRANSSHIPMENT_ARRIVED", "TRANSSHIPMENT_DEPARTED",
  "VESSEL_ARRIVED", "DISCHARGED", "CUSTOMS_PROCESSING", "CUSTOMS_RELEASED",
  "AVAILABLE_FOR_PICKUP", "GATE_OUT", "DELIVERED", "EMPTY_RETURNED", "COMPLETED",
  "CANCELLED", "EXCEPTION",
] as const;
export type ShippingMilestone = (typeof SHIPPING_MILESTONES)[number];

/** The happy-path progress order (for sorting / "furthest reached"). EXCEPTION/CANCELLED
 *  are off the line and share index -1. Not a claim that every shipment is linear. */
const PROGRESS: ShippingMilestone[] = [
  "BOOKING_CREATED", "BOOKING_CONFIRMED", "EMPTY_RELEASED", "GATE_IN", "LOADED",
  "VESSEL_DEPARTED", "IN_TRANSIT", "TRANSSHIPMENT_ARRIVED", "TRANSSHIPMENT_DEPARTED",
  "VESSEL_ARRIVED", "DISCHARGED", "CUSTOMS_PROCESSING", "CUSTOMS_RELEASED",
  "AVAILABLE_FOR_PICKUP", "GATE_OUT", "DELIVERED", "EMPTY_RETURNED", "COMPLETED",
];

export type MilestoneCategory = "shipment" | "container" | "vessel" | "customs" | "delivery" | "control";

/** Which operational dimension a milestone reports on (a shipment milestone ≠ a container
 *  milestone ≠ a vessel milestone). */
export const MILESTONE_CATEGORY: Record<ShippingMilestone, MilestoneCategory> = {
  BOOKING_CREATED: "shipment", BOOKING_CONFIRMED: "shipment", IN_TRANSIT: "shipment",
  EMPTY_RELEASED: "container", GATE_IN: "container", LOADED: "container",
  DISCHARGED: "container", AVAILABLE_FOR_PICKUP: "container", GATE_OUT: "container", EMPTY_RETURNED: "container",
  VESSEL_DEPARTED: "vessel", TRANSSHIPMENT_ARRIVED: "vessel", TRANSSHIPMENT_DEPARTED: "vessel", VESSEL_ARRIVED: "vessel",
  CUSTOMS_PROCESSING: "customs", CUSTOMS_RELEASED: "customs",
  DELIVERED: "delivery",
  COMPLETED: "control", CANCELLED: "control", EXCEPTION: "control",
};

export function isShippingMilestone(v: string): v is ShippingMilestone {
  return (SHIPPING_MILESTONES as readonly string[]).includes(v);
}

/** COMPLETED and CANCELLED are terminal. EXCEPTION is a resolvable hold, NOT terminal. */
export function isTerminalMilestone(m: ShippingMilestone): boolean {
  return m === "COMPLETED" || m === "CANCELLED";
}

export function milestoneProgress(m: ShippingMilestone): number {
  return PROGRESS.indexOf(m);
}

export type MilestoneApplyKind = "advance" | "repeat" | "regress" | "exception" | "cancel" | "complete" | "invalid";

export type MilestoneApplyResult =
  | { ok: true; kind: Exclude<MilestoneApplyKind, "invalid"> }
  | { ok: false; kind: "invalid"; reason: string };

/**
 * Classify applying `next` to a shipment currently at `current`. Rejects only the
 * genuinely-impossible; everything else is allowed but CLASSIFIED so the caller (and the
 * timeline) can distinguish real progress from a carrier correction.
 */
export function classifyMilestone(current: ShippingMilestone, next: ShippingMilestone): MilestoneApplyResult {
  if (isTerminalMilestone(current)) return { ok: false, kind: "invalid", reason: "terminal" };
  if (next === "CANCELLED") return { ok: true, kind: "cancel" };
  if (next === "EXCEPTION") return { ok: true, kind: "exception" };
  if (current === "EXCEPTION") {
    // A hold is resolved by moving to any real milestone (resume where the shipment is).
    return next === "COMPLETED" ? { ok: false, kind: "invalid", reason: "complete_requires_delivery" } : { ok: true, kind: "advance" };
  }
  if (next === "COMPLETED") {
    return current === "DELIVERED" || current === "EMPTY_RETURNED"
      ? { ok: true, kind: "complete" }
      : { ok: false, kind: "invalid", reason: "complete_requires_delivery" };
  }
  const cur = milestoneProgress(current);
  const nxt = milestoneProgress(next);
  if (nxt > cur) return { ok: true, kind: "advance" };
  if (nxt === cur) return { ok: true, kind: "repeat" };
  return { ok: true, kind: "regress" }; // carrier correction / re-sequencing — allowed, flagged
}

const LABEL_FR: Record<ShippingMilestone, string> = {
  BOOKING_CREATED: "Réservation créée", BOOKING_CONFIRMED: "Réservation confirmée",
  EMPTY_RELEASED: "Conteneur vide libéré", GATE_IN: "Entrée terminal", LOADED: "Chargé",
  VESSEL_DEPARTED: "Navire parti", IN_TRANSIT: "En transit",
  TRANSSHIPMENT_ARRIVED: "Transbordement — arrivée", TRANSSHIPMENT_DEPARTED: "Transbordement — départ",
  VESSEL_ARRIVED: "Navire arrivé", DISCHARGED: "Déchargé",
  CUSTOMS_PROCESSING: "Dédouanement en cours", CUSTOMS_RELEASED: "Mainlevée douane",
  AVAILABLE_FOR_PICKUP: "Disponible à l'enlèvement", GATE_OUT: "Sortie terminal",
  DELIVERED: "Livré", EMPTY_RETURNED: "Vide restitué", COMPLETED: "Clôturé",
  CANCELLED: "Annulé", EXCEPTION: "Exception",
};
export function milestoneLabel(m: ShippingMilestone): string {
  return LABEL_FR[m] ?? m;
}
