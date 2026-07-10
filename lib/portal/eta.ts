/**
 * Conservative portal ETA engine v1 (Phase 3.3A — Deliverable 8) — PURE. No AI.
 * ---------------------------------------------------------------------------
 * Derives an estimated delivery date from EXISTING stored data only, in a strict
 * priority order, and NEVER fabricates a date:
 *   1. explicit scheduled delivery date (transport.delivery_planned)
 *   2. transport ETA (shipment.eta)
 *   3. a coarse operational estimate — ONLY when a real pickup timestamp exists
 *      (pickup_actual + a documented conservative transit buffer)
 *   4. unknown (with a customer-safe reason)
 * `basis` names the source so the UI can explain the estimate; `confidence`
 * reflects how grounded it is. No SLA thresholds or internal detail are exposed.
 */
import type { PortalStageKey } from "./progress-map";

export type EtaConfidence = "low" | "medium" | "high";
export type EtaBasis = "delivered" | "scheduled_delivery" | "transport_eta" | "operational_estimate" | "unknown";

export type PortalEta = {
  estimatedDate: string | null;
  confidence: EtaConfidence;
  confidencePercent: number;
  basis: EtaBasis;
  delayDays: number;
};

const DAY = 86_400_000;
/** Conservative transit buffer applied ONLY to a real pickup timestamp (grounded, not fabricated). */
const TRANSIT_BUFFER_DAYS = 7;
const CONF_PCT: Record<EtaConfidence, number> = { high: 90, medium: 70, low: 40 };

function daysPast(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const diff = now.getTime() - t;
  return diff > 0 ? Math.floor(diff / DAY) : 0;
}

export type EtaInput = {
  deliveredActual: string | null;
  scheduledDelivery: string | null;
  transportEta: string | null;
  pickupActual: string | null;
  currentStageKey: PortalStageKey | null;
  now: Date;
};

export function derivePortalEta(input: EtaInput): PortalEta {
  const mk = (estimatedDate: string | null, confidence: EtaConfidence, basis: EtaBasis, delivered = false): PortalEta => ({
    estimatedDate,
    confidence,
    confidencePercent: CONF_PCT[confidence],
    basis,
    delayDays: !delivered && estimatedDate ? daysPast(estimatedDate, input.now) : 0,
  });

  if (input.deliveredActual) return mk(input.deliveredActual, "high", "delivered", true);

  // 1. explicit scheduled delivery date — most authoritative.
  if (isValid(input.scheduledDelivery)) {
    const late = daysPast(input.scheduledDelivery!, input.now) > 0;
    return mk(input.scheduledDelivery, late ? "medium" : "high", "scheduled_delivery");
  }

  // 2. transport ETA field.
  if (isValid(input.transportEta)) {
    return mk(input.transportEta, "medium", "transport_eta");
  }

  // 3. coarse operational estimate — ONLY grounded in a real pickup timestamp.
  if (isValid(input.pickupActual)) {
    const est = new Date(new Date(input.pickupActual!).getTime() + TRANSIT_BUFFER_DAYS * DAY).toISOString();
    return mk(est, "low", "operational_estimate");
  }

  // 4. unknown — never invent a date.
  return { estimatedDate: null, confidence: "low", confidencePercent: 0, basis: "unknown", delayDays: 0 };
}

function isValid(iso: string | null | undefined): iso is string {
  return typeof iso === "string" && iso.length > 0 && !Number.isNaN(new Date(iso).getTime());
}
