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

/**
 * 8.4 (section O) — freshness measures AGE, not liveness. The class name LIVE is a code
 * contract (age within the per-source threshold); the USER-FACING label must never imply
 * real-time carrier data — a 1-hour-old MANUAL entry classifies LIVE by age. "En direct" is
 * reserved for a future provider whose contract defines real-time data; until then the label
 * is age-language, always shown next to the SOURCE.
 */
const LABEL_FR: Record<Freshness, string> = {
  LIVE: "À jour", RECENT: "Récent", STALE: "Ancien", VERY_STALE: "Très ancien", UNKNOWN: "Inconnu",
};
export function freshnessLabel(f: Freshness): string {
  return LABEL_FR[f];
}

/**
 * 8.4 — French age text for a position timestamp: « il y a 2 h », « il y a 3 j »,
 * « à l'instant ». Pure; now injected. Every position surface shows AGE next to source.
 */
export function ageLabelFr(occurredAt: string | null | undefined, nowIso: string): string | null {
  if (!occurredAt) return null;
  const t = new Date(occurredAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null;
  const ms = now - t;
  if (ms < 0) return "à l'instant";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
