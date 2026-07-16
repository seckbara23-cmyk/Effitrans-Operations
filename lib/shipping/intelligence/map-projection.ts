/**
 * Shipping Line Platform — map-ready projection (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * A provider-neutral projection any mapping library can consume. It imports NO mapping
 * library (see docs/shipping/map-provider-decision.md) so the domain stays testable and
 * the map provider can change without touching business logic. Every marker carries source,
 * confidence, and freshness; stale positions raise a warning so the UI never renders them
 * as live.
 */
import type { ResolvedPosition } from "./position";
import { isStaleFreshness, type Freshness } from "./freshness";
import { milestoneLabel, type ShippingMilestone } from "./milestones";
import type { TrackingConfidence, TrackingSource } from "./events";

export type MapPoint = { latitude: number; longitude: number; label?: string };
export type MapMarker = {
  latitude: number;
  longitude: number;
  label: string;
  kind: "origin" | "destination" | "port" | "current" | "milestone";
  source?: TrackingSource;
  confidence?: TrackingConfidence;
  freshness?: Freshness;
  occurredAt?: string | null;
};
export type MapBounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };

export type ShipmentMapProjection = {
  origin?: MapPoint;
  destination?: MapPoint;
  plannedRoute: MapPoint[];
  actualTrack: MapPoint[];
  currentPosition?: MapMarker;
  milestones: MapMarker[];
  bounds?: MapBounds;
  warnings: string[];
};

export type MilestoneMarkerInput = { milestone: ShippingMilestone; latitude: number | null; longitude: number | null; occurredAt?: string | null };

export type ProjectionInputs = {
  origin?: MapPoint | null;
  destination?: MapPoint | null;
  plannedRoute?: MapPoint[];
  actualTrack?: MapPoint[];
  current?: ResolvedPosition | null;
  milestoneMarkers?: MilestoneMarkerInput[];
};

function computeBounds(points: MapPoint[]): MapBounds | undefined {
  if (points.length === 0) return undefined;
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  return { minLat, minLon, maxLat, maxLon };
}

/** Build the provider-neutral projection. PURE — coordinates already validated upstream. */
export function buildShipmentMapProjection(inputs: ProjectionInputs): ShipmentMapProjection {
  const warnings: string[] = [];
  const all: MapPoint[] = [];
  const push = (p?: MapPoint | null) => { if (p) all.push(p); };

  const origin = inputs.origin ?? undefined;
  const destination = inputs.destination ?? undefined;
  push(origin); push(destination);

  const plannedRoute = inputs.plannedRoute ?? [];
  const actualTrack = inputs.actualTrack ?? [];
  plannedRoute.forEach(push);
  actualTrack.forEach(push);

  const milestones: MapMarker[] = (inputs.milestoneMarkers ?? [])
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => {
      const marker: MapMarker = {
        latitude: m.latitude as number,
        longitude: m.longitude as number,
        label: milestoneLabel(m.milestone),
        kind: "milestone",
        occurredAt: m.occurredAt ?? null,
      };
      all.push({ latitude: marker.latitude, longitude: marker.longitude });
      return marker;
    });

  let currentPosition: MapMarker | undefined;
  if (inputs.current && inputs.current.available && inputs.current.latitude != null && inputs.current.longitude != null) {
    const c = inputs.current;
    currentPosition = {
      latitude: c.latitude as number,
      longitude: c.longitude as number,
      label: c.locationLabel ?? "Position actuelle",
      kind: "current",
      source: c.source,
      confidence: c.confidence,
      freshness: c.freshness,
      occurredAt: c.occurredAt,
    };
    all.push({ latitude: currentPosition.latitude, longitude: currentPosition.longitude });
    if (isStaleFreshness(c.freshness)) warnings.push("La position actuelle n'est pas récente — ne pas la considérer comme temps réel.");
    if (c.confidence === "INFERRED") warnings.push("Position déduite (non confirmée directement).");
    if (c.confidence === "ESTIMATED") warnings.push("Position estimée.");
  } else {
    warnings.push("Aucune position cartographiable disponible.");
  }

  return {
    origin, destination,
    plannedRoute, actualTrack,
    currentPosition,
    milestones,
    bounds: computeBounds(all),
    warnings,
  };
}
