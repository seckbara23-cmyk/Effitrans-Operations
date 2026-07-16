/**
 * Shipping Line Platform — data freshness (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * How OLD a datum is, classified against SOURCE-specific thresholds (an AIS fix ages fast;
 * a carrier "vessel departed" milestone stays meaningful for days). Orthogonal to
 * confidence. `now` is injected so the function is deterministic and testable. Defaults are
 * documented in docs/shipping/tracking-confidence-and-freshness.md.
 */
import type { TrackingSource } from "./events";

export const FRESHNESS = ["LIVE", "RECENT", "STALE", "VERY_STALE", "UNKNOWN"] as const;
export type Freshness = (typeof FRESHNESS)[number];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Per-source [live, recent, stale] upper bounds in ms; beyond `stale` ⇒ VERY_STALE. */
const THRESHOLDS: Record<TrackingSource, [number, number, number]> = {
  ROAD: [15 * MIN, 2 * HOUR, 12 * HOUR],
  AIS: [2 * HOUR, 6 * HOUR, 24 * HOUR],
  CARRIER: [12 * HOUR, 48 * HOUR, 7 * DAY],
  PORT: [12 * HOUR, 48 * HOUR, 7 * DAY],
  TERMINAL: [12 * HOUR, 48 * HOUR, 7 * DAY],
  CUSTOMS: [24 * HOUR, 72 * HOUR, 14 * DAY],
  MANUAL: [24 * HOUR, 7 * DAY, 30 * DAY],
  SYSTEM: [1 * HOUR, 6 * HOUR, 24 * HOUR],
};

export function classifyFreshness(source: TrackingSource, occurredAt: string | null | undefined, nowIso: string): Freshness {
  if (!occurredAt) return "UNKNOWN";
  const t = new Date(occurredAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(now)) return "UNKNOWN";
  const age = now - t;
  if (age < 0) return "LIVE"; // clock skew / future-dated → treat as live, never stale
  const [live, recent, stale] = THRESHOLDS[source] ?? THRESHOLDS.SYSTEM;
  if (age <= live) return "LIVE";
  if (age <= recent) return "RECENT";
  if (age <= stale) return "STALE";
  return "VERY_STALE";
}

/** A datum old enough to warn on (or with no timestamp). */
export function isStaleFreshness(f: Freshness): boolean {
  return f === "STALE" || f === "VERY_STALE" || f === "UNKNOWN";
}

const LABEL_FR: Record<Freshness, string> = {
  LIVE: "En direct", RECENT: "Récent", STALE: "Ancien", VERY_STALE: "Très ancien", UNKNOWN: "Inconnu",
};
export function freshnessLabel(f: Freshness): string {
  return LABEL_FR[f];
}
