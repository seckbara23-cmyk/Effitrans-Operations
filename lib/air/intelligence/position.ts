/**
 * Air Cargo — current-position resolver (Phase 7.3A). PURE. Reuses the shared ResolvedPosition
 * CONTRACT + the freshness engine; air-specific resolution rules (airport anchor → aircraft
 * position → manual → unavailable). Never guesses coordinates.
 */
import { isValidCoordinate } from "@/lib/shipping/intelligence/validators";
import { classifyFreshness, type Freshness } from "@/lib/shipping/intelligence/freshness";
import type { ResolvedPosition } from "@/lib/shipping/intelligence/position";
import type { FlightPosition } from "./domain";

export type ManualFix = { latitude: number; longitude: number; occurredAt: string };
export type AirportAnchor = { name: string; latitude: number | null; longitude: number | null; occurredAt: string; confirmed: boolean };

export type AirPositionInputs = {
  manualFix?: ManualFix | null;
  /** Set only when the shipment model confirms the cargo is aboard this flight. */
  cargoConfirmedOnFlight?: boolean;
  flightPosition?: FlightPosition | null;
  airportAnchor?: AirportAnchor | null;
};

const NONE: ResolvedPosition = {
  available: false, latitude: null, longitude: null, locationLabel: null,
  source: "SYSTEM", confidence: "ESTIMATED", occurredAt: null, freshness: "UNKNOWN",
  explanation: "Aucune position disponible.",
};

function fr(source: Parameters<typeof classifyFreshness>[0], at: string, now: string): Freshness {
  return classifyFreshness(source, at, now);
}

export function resolveAirPosition(inputs: AirPositionInputs, nowIso: string): ResolvedPosition {
  // 1. Manual confirmed fix.
  if (inputs.manualFix && isValidCoordinate(inputs.manualFix.latitude, inputs.manualFix.longitude)) {
    return { available: true, latitude: inputs.manualFix.latitude, longitude: inputs.manualFix.longitude, locationLabel: "Position saisie", source: "MANUAL", confidence: "MANUAL", occurredAt: inputs.manualFix.occurredAt, freshness: fr("MANUAL", inputs.manualFix.occurredAt, nowIso), explanation: "Position saisie manuellement." };
  }
  // 2. Aircraft position — ONLY if the cargo is confirmed aboard that flight. Inferred.
  if (inputs.cargoConfirmedOnFlight && inputs.flightPosition && isValidCoordinate(inputs.flightPosition.latitude, inputs.flightPosition.longitude)) {
    const fp = inputs.flightPosition;
    return { available: true, latitude: fp.latitude, longitude: fp.longitude, locationLabel: fp.flightNumber ? `À bord du vol ${fp.flightNumber}` : "Position de l'aéronef", source: "AIS", confidence: "INFERRED", occurredAt: fp.occurredAt, freshness: fr("AIS", fp.occurredAt, nowIso), explanation: "Position déduite de l'aéronef (fret confirmé à bord) — non confirmée directement." };
  }
  // 3. Last airport event.
  if (inputs.airportAnchor) {
    const a = inputs.airportAnchor;
    const hasCoord = a.latitude != null && a.longitude != null && isValidCoordinate(a.latitude, a.longitude);
    return { available: hasCoord, latitude: hasCoord ? a.latitude : null, longitude: hasCoord ? a.longitude : null, locationLabel: a.name, source: "PORT", confidence: a.confirmed ? "CONFIRMED" : "ESTIMATED", occurredAt: a.occurredAt, freshness: fr("PORT", a.occurredAt, nowIso), explanation: a.confirmed ? `Dernier aéroport connu : ${a.name}.` : `Dernier aéroport estimé : ${a.name}.` };
  }
  return NONE;
}
