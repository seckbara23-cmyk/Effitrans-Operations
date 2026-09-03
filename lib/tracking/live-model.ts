/**
 * TMS-2 — the live-map read model and its KPIs. PURE (no I/O, no auth), so
 * every rule is unit-testable without a React server environment.
 *
 * Kept apart from live-service.ts on purpose: that module resolves permissions
 * and talks to the database, and importing it into a test drags the whole auth
 * chain along. The shapes and the arithmetic belong here; the queries there.
 */
import type { TrackingHealth } from "./health";
import type { MissionLeg, TrackingSessionStatus } from "./types";

export type LiveMissionPoint = { lat: number; lng: number; at: string };

export type LiveMission = {
  transportId: string;
  fileId: string;
  fileNumber: string;
  /** Free-text plate for an external vehicle; the fleet registration when bound. */
  vehicleLabel: string | null;
  driverName: string | null;
  transportStatus: string;
  sessionStatus: TrackingSessionStatus;
  leg: MissionLeg;
  health: TrackingHealth;
  lastPosition: LiveMissionPoint | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  /** Point A. Null when the business has not defined one (see TMS2-R1). */
  returnLocation: string | null;
  returnPoint: { lat: number; lng: number } | null;
  returnStartedAt: string | null;
};

export type LiveTrackingKpis = {
  tracked: number;
  outbound: number;
  returning: number;
  staleOrOffline: number;
  endedToday: number;
};

/**
 * KPIs derived from the live set — PURE over the rows above, so nothing is
 * fabricated when no tracking exists: an empty fleet yields zeros, not blanks
 * and not invented activity.
 */
export function summarizeLiveMissions(missions: readonly LiveMission[], endedToday = 0): LiveTrackingKpis {
  return {
    tracked: missions.length,
    outbound: missions.filter((m) => m.leg === "OUTBOUND").length,
    returning: missions.filter((m) => m.leg === "RETURN").length,
    staleOrOffline: missions.filter((m) => m.health === "stale" || m.health === "offline").length,
    endedToday,
  };
}

// ─────────────────────────── TMS-2D — the always-on map ────────────────────

/**
 * THE DEFAULT OPERATIONAL VIEW — SENEGAL. A camera position, NOT a business fact.
 *
 * TMS-2D §3/§3A asked for the safest EXISTING default. The repository has none:
 * there is no configured Effitrans base, no transport depot, and the two
 * geocoded registries (`ocean_port`, `air_airport`) are empty in production, so
 * nothing authoritative can be read. What the platform does establish is the
 * country of operation — `Africa/Dakar` is the tenant timezone default and the
 * mail footer reads « Dakar, Sénégal ».
 *
 * So the map opens on SENEGAL AS A WHOLE, not on Dakar: the ruling is explicit
 * that missions may run anywhere in the country, and framing the capital would
 * quietly imply otherwise. The bounds below are the national extent.
 *
 * This is deliberately NOT:
 *   • a base or depot,          • a return point (TMS2-R1 is still open),
 *   • a mission location,       • anything a calculation may read.
 *
 * It is only where the camera looks. A test pins that nothing outside the map
 * layer reads it, and that no mission marker is ever derived from it.
 */
export const SENEGAL_VIEW = {
  /** National extent [west, south, east, north] — the operational workspace. */
  bounds: [-17.63, 12.29, -11.34, 16.70] as const,
  /** Camera fallback if bounds cannot be applied. */
  lat: 14.5,
  lng: -14.5,
  zoom: 6.4,
  /** A genuine 3D camera: WebGL pitch and bearing, never a CSS illusion. */
  pitch: 45,
  bearing: -8,
  labelFr: "Vue par défaut — Sénégal. Aucune position n'est affichée.",
} as const;

/** Kept as the previous name so existing readers/tests resolve to one source. */
export const FALLBACK_MAP_VIEW = SENEGAL_VIEW;

/**
 * Geographic context only — the basemap labels these; the platform never
 * creates a marker, a mission or a position at any of them. Listed so a
 * reviewer can confirm they are context and not seeded data.
 */
export const SENEGAL_CONTEXT_CITIES: readonly string[] = [
  "Dakar", "Thiès", "Saint-Louis", "Kaolack", "Tambacounda", "Ziguinchor",
] as const;

export type MapView =
  | { kind: "observed"; points: { lat: number; lng: number }[] }
  | { kind: "fallback"; lat: number; lng: number; zoom: number };

/**
 * How to frame the map: on what was actually observed, or — when nothing has
 * been, and only then — on the fallback viewport. Pure, so the rule is testable
 * without a browser.
 */
export function mapViewFor(
  missions: readonly LiveMission[],
  route: readonly LiveMissionPoint[] = [],
): MapView {
  const points: { lat: number; lng: number }[] = [];
  for (const m of missions) {
    if (m.lastPosition) points.push({ lat: m.lastPosition.lat, lng: m.lastPosition.lng });
    if (m.returnPoint) points.push(m.returnPoint);
  }
  for (const p of route) points.push({ lat: p.lat, lng: p.lng });
  if (points.length === 0) {
    return { kind: "fallback", lat: SENEGAL_VIEW.lat, lng: SENEGAL_VIEW.lng, zoom: SENEGAL_VIEW.zoom };
  }
  return { kind: "observed", points };
}

/**
 * Route geometry is only ever OBSERVED geometry (TMS-2 invariant, restated
 * because TMS-2D makes the map permanent and the temptation grows):
 *   0 fixes → nothing;  1 fix → a marker, never a line;  2+ → the observed path.
 * No interpolation, no road snapping, no shortest path dressed as movement.
 */
export function canDrawRoute(route: readonly LiveMissionPoint[]): boolean {
  return route.length >= 2;
}

/** Legend entries — text and shape, never colour alone (TMS-2D §7). */
export const MAP_LEGEND_FR: readonly { key: string; labelFr: string; shape: string }[] = [
  { key: "OUTBOUND", labelFr: "En livraison", shape: "cercle plein" },
  { key: "RETURN", labelFr: "En retour", shape: "carré sombre" },
  { key: "stale", labelFr: "Signal ancien", shape: "anneau orange" },
  { key: "offline", labelFr: "Signal perdu", shape: "anneau rouge" },
  { key: "returnPoint", labelFr: "Point de retour", shape: "carré" },
] as const;
