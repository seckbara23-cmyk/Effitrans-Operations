/**
 * Shipping Line Platform — current-position resolver + AIS position type (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * Containers rarely carry GPS. This resolves the best-available current position with an
 * EXPLICIT source and confidence, and NEVER guesses coordinates:
 *   1. active road GPS fix        → CONFIRMED (the box is on a truck we track)
 *   2. vessel AIS, ONLY IF the container is confirmed loaded on that vessel → INFERRED
 *   3. last carrier milestone with a known port location → CONFIRMED or ESTIMATED
 *   4. otherwise                  → unavailable
 * No interpolation between ports in this phase. `now` injected for deterministic freshness.
 */
import { isValidCoordinate } from "./validators";
import { classifyFreshness, type Freshness } from "./freshness";
import type { TrackingConfidence, TrackingSource } from "./events";

/** A normalized AIS vessel position (no live AIS is called in 7.2A). Coordinates validated. */
export type VesselPosition = {
  imo?: string | null;
  mmsi?: string | null;
  vesselName?: string | null;
  latitude: number;
  longitude: number;
  speedKnots?: number | null;
  courseDegrees?: number | null;
  headingDegrees?: number | null;
  navigationalStatus?: string | null;
  occurredAt: string;
  receivedAt: string;
  sourceProvider: string;
};

export type RoadFix = { latitude: number; longitude: number; occurredAt: string };
export type PortAnchor = { name: string; latitude: number | null; longitude: number | null; occurredAt: string; confirmed: boolean };

export type PositionInputs = {
  roadFix?: RoadFix | null;
  /** Set only when the shipment model confirms this container is aboard this vessel. */
  containerConfirmedOnVessel?: boolean;
  vesselPosition?: VesselPosition | null;
  portAnchor?: PortAnchor | null;
};

export type ResolvedPosition = {
  available: boolean;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  source: TrackingSource;
  confidence: TrackingConfidence;
  occurredAt: string | null;
  freshness: Freshness;
  explanation: string;
};

const NONE: ResolvedPosition = {
  available: false, latitude: null, longitude: null, locationLabel: null,
  source: "SYSTEM", confidence: "ESTIMATED", occurredAt: null, freshness: "UNKNOWN",
  explanation: "Aucune position disponible.",
};

/**
 * Resolve the best current position. Deterministic; returns source, confidence, freshness,
 * and a human explanation so the UI can never render an inferred/stale fix as live.
 */
export function resolveCurrentPosition(inputs: PositionInputs, nowIso: string): ResolvedPosition {
  // 8.4 (truthfulness): source priority must never present OLDER evidence as "current" when
  // NEWER evidence exists in a lower-priority source. A 3-day-old road GPS fix must not mask
  // today's DISCHARGED-at-port milestone. A higher-priority candidate is used only if no other
  // candidate is strictly newer.
  const newestOther = (candidateAt: string, others: (string | null | undefined)[]): boolean =>
    others.some((t) => typeof t === "string" && t > candidateAt);

  // 1. Road GPS wins when present, valid AND not older than the other evidence — the box is
  //    on a truck we directly track.
  if (inputs.roadFix && isValidCoordinate(inputs.roadFix.latitude, inputs.roadFix.longitude)) {
    const fresherElsewhere = newestOther(inputs.roadFix.occurredAt, [
      inputs.containerConfirmedOnVessel ? inputs.vesselPosition?.occurredAt : null,
      inputs.portAnchor?.occurredAt,
    ]);
    if (!fresherElsewhere) {
      return {
        available: true, latitude: inputs.roadFix.latitude, longitude: inputs.roadFix.longitude,
        locationLabel: "Position routière (GPS)", source: "ROAD", confidence: "CONFIRMED",
        occurredAt: inputs.roadFix.occurredAt, freshness: classifyFreshness("ROAD", inputs.roadFix.occurredAt, nowIso),
        explanation: "Position GPS routière confirmée.",
      };
    }
  }

  // 2. Vessel AIS — ONLY if the container is confirmed loaded on that vessel. Inferred.
  //    Same recency rule: a newer port milestone (e.g. DISCHARGED) outranks an older AIS fix.
  if (
    inputs.containerConfirmedOnVessel &&
    inputs.vesselPosition &&
    isValidCoordinate(inputs.vesselPosition.latitude, inputs.vesselPosition.longitude) &&
    !newestOther(inputs.vesselPosition.occurredAt, [inputs.portAnchor?.occurredAt])
  ) {
    const vp = inputs.vesselPosition;
    return {
      available: true, latitude: vp.latitude, longitude: vp.longitude,
      locationLabel: vp.vesselName ? `À bord du ${vp.vesselName}` : "Position du navire (AIS)",
      source: "AIS", confidence: "INFERRED", occurredAt: vp.occurredAt,
      freshness: classifyFreshness("AIS", vp.occurredAt, nowIso),
      explanation: "Position déduite du navire (conteneur confirmé à bord) — non confirmée directement.",
    };
  }

  // 3. Last carrier milestone with a known port location.
  if (inputs.portAnchor) {
    const pa = inputs.portAnchor;
    const hasCoord = pa.latitude != null && pa.longitude != null && isValidCoordinate(pa.latitude, pa.longitude);
    return {
      available: hasCoord,
      latitude: hasCoord ? pa.latitude : null,
      longitude: hasCoord ? pa.longitude : null,
      locationLabel: pa.name,
      source: "PORT",
      confidence: pa.confirmed ? "CONFIRMED" : "ESTIMATED",
      occurredAt: pa.occurredAt,
      freshness: classifyFreshness("PORT", pa.occurredAt, nowIso),
      explanation: pa.confirmed
        ? `Dernière étape connue : ${pa.name}.`
        : `Dernière étape estimée : ${pa.name}.`,
    };
  }

  // 4. Nothing — never guess.
  return NONE;
}
