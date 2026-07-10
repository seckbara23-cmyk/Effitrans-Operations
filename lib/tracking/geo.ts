/**
 * Geospatial helpers (Phase 3.4) — PURE, client + server safe. No I/O.
 * ---------------------------------------------------------------------------
 * Straight-line (great-circle) distance ONLY, used for internal fallback
 * calculations (batching thresholds, geofence radius checks, a coarse
 * progress-along-route estimate). This is explicitly APPROXIMATE — it is not a
 * road route. Real routing is a replaceable seam (OpenRouteService / Mapbox /
 * fleet provider) introduced only with approval; nothing here hard-codes a
 * provider or calls a paid API.
 */
import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Is `point` within `radiusMeters` of `center`? */
export function withinRadius(point: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}

/**
 * Coarse straight-line progress (0..100) of `current` along origin→destination,
 * by the ratio of covered distance to total. APPROXIMATE — clamped, and only
 * meaningful when both endpoints are known. Never used to drive workflow state.
 */
export function straightLineProgressPercent(origin: LatLng, current: LatLng, destination: LatLng): number {
  const total = haversineMeters(origin, destination);
  if (total <= 0) return 0;
  const covered = haversineMeters(origin, current);
  const pct = (covered / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
