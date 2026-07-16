/**
 * Shipping Line Platform — carrier status mapping (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * The ONE place a carrier's raw status vocabulary is translated into a canonical milestone.
 * ALLOWLIST ONLY — an unrecognised raw status maps to `unmapped` (never guessed, never
 * fuzzy-matched), and the engine refuses to apply an unmapped value. Every carrier table is
 * INTENTIONALLY EMPTY until its official status vocabulary is verified (each future entry
 * must cite the carrier's documentation). The manual provider already speaks canonical.
 */
import { isShippingMilestone, type ShippingMilestone } from "./milestones";

export type CarrierStatusResult =
  | { confidence: "exact"; milestone: ShippingMilestone; note?: string }
  | { confidence: "unmapped"; milestone: null; reason: "unknown_carrier_status" };

export type StatusRule = { milestone: ShippingMilestone; note?: string };

/** Per-carrier raw→canonical tables. EMPTY until each vocabulary is verified (with citation). */
export const CARRIER_STATUS_MAPS: Record<string, Record<string, StatusRule>> = Object.freeze({
  maersk: Object.freeze({}),
  msc: Object.freeze({}),
  "cma-cgm": Object.freeze({}),
  "hapag-lloyd": Object.freeze({}),
  cosco: Object.freeze({}),
  one: Object.freeze({}),
  evergreen: Object.freeze({}),
  aggregator: Object.freeze({}),
});

export function normalizeRawStatus(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

/** Map a carrier's raw status to a canonical milestone. Allowlist only; unknown → unmapped. */
export function mapCarrierStatus(providerCode: string, raw: string): CarrierStatusResult {
  const norm = normalizeRawStatus(raw);
  const table = CARRIER_STATUS_MAPS[providerCode] ?? {};
  const rule = table[norm];
  if (rule) return { confidence: "exact", milestone: rule.milestone, note: rule.note };
  if (providerCode === "manual" && isShippingMilestone(norm)) {
    return { confidence: "exact", milestone: norm as ShippingMilestone };
  }
  return { confidence: "unmapped", milestone: null, reason: "unknown_carrier_status" };
}
