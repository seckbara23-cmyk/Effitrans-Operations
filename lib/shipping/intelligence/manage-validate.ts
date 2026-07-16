/**
 * Shipping Line Platform — management validation (Phase 7.2B). PURE, total.
 * ---------------------------------------------------------------------------
 * Safe validators for the operator management surfaces (carrier URL, voyage chronology,
 * route sequence/continuity). Reuses the 7.2A identifier validators; adds nothing that
 * invents data. All functions are total (never throw).
 */
import { isValidUnlocode } from "./validators";

/** A safe, http(s)-only URL (or null/empty). Rejects javascript:, data:, and malformed URLs. */
export function isSafeUrl(raw: string | null | undefined): boolean {
  if (!raw) return true; // empty is allowed (optional field)
  const v = raw.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export type VoyageDates = {
  plannedDeparture?: string | null;
  plannedArrival?: string | null;
  actualDeparture?: string | null;
  actualArrival?: string | null;
};

export type ChronoResult = { ok: true } | { ok: false; reason: string };

/** Arrival cannot precede departure (planned or actual), unless the caller flags a
 *  deliberate historical correction (`allowCorrection`). */
export function validateVoyageChronology(d: VoyageDates, allowCorrection = false): ChronoResult {
  const before = (a?: string | null, b?: string | null): boolean => {
    if (!a || !b) return false;
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    return Number.isFinite(ta) && Number.isFinite(tb) && tb < ta;
  };
  if (allowCorrection) return { ok: true };
  if (before(d.plannedDeparture, d.plannedArrival)) return { ok: false, reason: "planned_arrival_before_departure" };
  if (before(d.actualDeparture, d.actualArrival)) return { ok: false, reason: "actual_arrival_before_departure" };
  return { ok: true };
}

export type LegForValidation = { sequence: number; originPortId: string | null; destinationPortId: string | null };
export type RouteValidation = { ok: boolean; duplicateSequence: boolean; discontinuities: number[] };

/**
 * Validate a planned route: sequences must be unique; a "discontinuity" is a leg whose
 * origin port differs from the previous leg's destination (a warning, not a hard error —
 * transshipments and gaps are legitimate). Returns the sequences AFTER which a gap occurs.
 */
export function validateRoute(legs: LegForValidation[]): RouteValidation {
  const sorted = [...legs].sort((a, b) => a.sequence - b.sequence);
  const seqs = sorted.map((l) => l.sequence);
  const duplicateSequence = new Set(seqs).size !== seqs.length;
  const discontinuities: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    if (prev.destinationPortId && cur.originPortId && prev.destinationPortId !== cur.originPortId) {
      discontinuities.push(prev.sequence);
    }
  }
  return { ok: !duplicateSequence, duplicateSequence, discontinuities };
}

/** A booking/BL reference is a non-empty trimmed string within a sane length, or null. */
export function normalizeReference(raw: string | null | undefined, max = 64): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  return v.slice(0, max);
}

/** UN/LOCODE for a port record — reuses the 7.2A validator; empty is allowed (unmapped port). */
export function isValidPortUnlocode(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  return isValidUnlocode(raw);
}
