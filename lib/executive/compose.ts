/**
 * Executive Intelligence — pure composition (Phase 7.7). PURE, no I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * Turns the outputs of the EXISTING module readers into the executive projection. This file
 * contains NO domain calculation: it normalizes, merges, ranks and formats facts the authoritative
 * engines already produced. If a number is not in an input, it is null — never derived here.
 *
 * SEVERITY IS NORMALIZED, NEVER INVENTED. Two alert vocabularies already exist:
 *   - the Command Center / shipping / air queues: "critical" | "warning" | "info"  (lib/logistics/compose)
 *   - the analytics executive alerts:             "RED" | "AMBER" | "GREEN"        (lib/analytics/executive)
 * The executive queue groups by Critical/High/Medium/Low, so each incoming token is mapped through
 * ONE fixed, documented table below. The executive layer never scores an alert, never promotes one,
 * and never assigns a level to an alert whose own engine did not classify it.
 */
import type { MapMarker, ShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";
import type { TrackingConfidence, TrackingSource } from "@/lib/shipping/intelligence/events";
import type { Freshness } from "@/lib/shipping/intelligence/freshness";
import type {
  ExecutiveAlert, ExecutiveAlertLevel, ExecutiveKpi, ExecutiveMap, ExecutiveMapMarker, ExecutiveTimelineEntry,
} from "./types";
import { ALERT_LEVELS } from "./types";

// ---------------------------------------------------------------- severity normalization ----

/**
 * The ONLY mapping from an existing engine's severity token to the executive queue's level.
 * Every entry is 1:1 and lossless-by-intent; an unknown token is NOT guessed (see normalizeSeverity).
 */
export const SEVERITY_MAP: Record<string, ExecutiveAlertLevel> = {
  // lib/logistics/compose — AttentionSeverity (Command Center, shipping + air queues)
  critical: "critical",
  warning: "high",
  info: "medium",
  // lib/analytics/executive — AlertLevel (health/collections/blocked alerts)
  RED: "critical",
  AMBER: "high",
  GREEN: "low",
};

/**
 * Normalize a severity token an engine already assigned. An UNKNOWN token is mapped to "medium"
 * and reported by `isKnownSeverity` — we neither drop the alert (silently losing a real signal)
 * nor promote it to critical (inventing urgency the source never claimed).
 */
export function normalizeSeverity(token: string): ExecutiveAlertLevel {
  return SEVERITY_MAP[token] ?? "medium";
}

export function isKnownSeverity(token: string): boolean {
  return token in SEVERITY_MAP;
}

const LEVEL_RANK: Record<ExecutiveAlertLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Merge every module's alerts into ONE priority queue: dedupe on (origin, reference, reason),
 * order by normalized level then by age (oldest first within a level), and bound the result.
 * Stable and honest — no fabricated items, no re-scoring.
 */
export function mergeExecutiveAlerts(alerts: ExecutiveAlert[], cap = 40): ExecutiveAlert[] {
  const seen = new Set<string>();
  const deduped: ExecutiveAlert[] = [];
  for (const a of alerts) {
    const key = `${a.origin}|${a.reference ?? ""}|${a.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }
  deduped.sort((a, b) => {
    const l = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (l !== 0) return l;
    const at = a.occurredAt ?? "";
    const bt = b.occurredAt ?? "";
    if (at && bt) return at < bt ? -1 : at > bt ? 1 : 0; // oldest first within a level
    if (at) return -1;
    if (bt) return 1;
    return 0;
  });
  return deduped.slice(0, cap);
}

/** Count the consolidated queue by level (all four keys always present — 0 is a real count here). */
export function countAlertsByLevel(alerts: ExecutiveAlert[]): Record<ExecutiveAlertLevel, number> {
  const out = { critical: 0, high: 0, medium: 0, low: 0 } as Record<ExecutiveAlertLevel, number>;
  for (const a of alerts) out[a.level] += 1;
  return out;
}

export { ALERT_LEVELS };

// ---------------------------------------------------------------- timeline ----

/**
 * Merge module events into one chronological executive timeline: newest first, deduped on
 * (origin, reference, title, at), bounded. There is NO executive event store — these entries are
 * projections of rows the owning modules already keep.
 */
export function mergeTimeline(entries: ExecutiveTimelineEntry[], cap = 30): ExecutiveTimelineEntry[] {
  const seen = new Set<string>();
  const deduped: ExecutiveTimelineEntry[] = [];
  for (const e of entries) {
    if (!e.at) continue; // never place an undated event on a timeline
    const key = `${e.origin}|${e.reference ?? ""}|${e.title}|${e.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  deduped.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first
  return deduped.slice(0, cap);
}

// ---------------------------------------------------------------- map ----

/** Bounds over real markers only. Returns null for an empty set (never a default viewport). */
export function markerBounds(markers: ExecutiveMapMarker[]): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  if (markers.length === 0) return null;
  let minLat = markers[0].latitude, maxLat = markers[0].latitude;
  let minLon = markers[0].longitude, maxLon = markers[0].longitude;
  for (const m of markers) {
    if (m.latitude < minLat) minLat = m.latitude;
    if (m.latitude > maxLat) maxLat = m.latitude;
    if (m.longitude < minLon) minLon = m.longitude;
    if (m.longitude > maxLon) maxLon = m.longitude;
  }
  return { minLat, minLon, maxLat, maxLon };
}

/**
 * Adapt the aggregate executive map to the EXISTING shared projection contract so the SAME Leaflet
 * renderer (components/shipping/shipment-map[-loader]) draws it. No second mapping engine, no
 * second marker vocabulary: status/freshness/confidence/source ride through unchanged.
 *
 * The one lossy step is deliberate and cosmetic: the shared renderer's marker `kind` vocabulary is
 * origin|destination|port|current|milestone, so every MOVING asset (ship/aircraft/road) maps to
 * "current" and every PLACE (port/airport) to "port". The executive kind stays in the label so the
 * distinction is still visible to the reader.
 */
export function toShipmentProjection(map: ExecutiveMap): ShipmentMapProjection {
  const KIND_PREFIX: Record<ExecutiveMapMarker["kind"], string> = {
    ship: "🚢", aircraft: "✈️", road: "🚚", port: "⚓", airport: "🛫", warehouse: "🏭", customs_office: "🏛️",
  };
  const markers: MapMarker[] = map.markers.map((m) => ({
    latitude: m.latitude,
    longitude: m.longitude,
    label: `${KIND_PREFIX[m.kind] ?? ""} ${m.label}${m.reference && m.reference !== m.label ? ` (${m.reference})` : ""}`.trim(),
    kind: m.kind === "port" || m.kind === "airport" ? "port" : "current",
    source: (m.source as TrackingSource) ?? undefined,
    confidence: (m.confidence as TrackingConfidence) ?? undefined,
    freshness: (m.freshness as Freshness) ?? undefined,
    occurredAt: m.occurredAt,
  }));
  return {
    plannedRoute: [],
    actualTrack: [],
    milestones: markers,
    bounds: map.bounds ?? undefined,
    warnings: map.warnings,
  };
}

// ---------------------------------------------------------------- formatting ----

const NBSP = " ";

/** Format a figure for display. A null value ALWAYS renders as the unavailable dash — never 0. */
export function formatKpi(value: number | null, unit: ExecutiveKpi["unit"], currency = "XOF"): string | null {
  if (value == null) return null;
  switch (unit) {
    case "currency":
      return `${Math.round(value).toLocaleString("fr-FR")}${NBSP}${currency}`;
    case "days":
      return `${round1(value)}${NBSP}j`;
    case "percent":
      return `${round1(value)}${NBSP}%`;
    case "ms":
      return `${Math.round(value)}${NBSP}ms`;
    case "count":
    default:
      return value.toLocaleString("fr-FR");
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Build a traceable KPI. `value === null` ⇒ display null ⇒ the UI shows "non disponible". */
export function kpi(
  key: string, label: string, value: number | null,
  source: ExecutiveKpi["source"], href: string,
  unit: ExecutiveKpi["unit"] = "count", currency = "XOF",
): ExecutiveKpi {
  return { key, label, value, display: formatKpi(value, unit, currency), unit, source, href };
}

/** Success rate over the copilot's own audit aggregates. Null when there is no traffic — a rate
 *  over zero requests is not 0 %, it is unknown. */
export function successRate(answered: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((answered / total) * 1000) / 10;
}
