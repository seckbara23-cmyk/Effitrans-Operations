/**
 * Air Cargo — tracking event vocabulary (Phase 7.3A). PURE. REUSES the generic event helpers
 * (fingerprint / dedupe / sort) from the shipping layer — no duplicate tracking engine. Only
 * the air EVENT VOCABULARY and the air row mapper are air-specific.
 */
import { AIR_MILESTONES, type AirMilestone } from "./milestones";
import { eventFingerprint, dedupeEvents, sortEvents, type TrackingSource, type TrackingConfidence } from "@/lib/shipping/intelligence/events";

export { eventFingerprint, dedupeEvents, sortEvents };
export type { TrackingSource, TrackingConfidence };

export const AIR_EVENTS = [...AIR_MILESTONES, "POSITION_UPDATE", "ETA_UPDATE"] as const;
export type AirEvent = (typeof AIR_EVENTS)[number];

export function isAirEvent(v: string): v is AirEvent {
  return (AIR_EVENTS as readonly string[]).includes(v);
}
export function airEventIsMilestone(e: AirEvent): e is AirMilestone {
  return (AIR_MILESTONES as readonly string[]).includes(e);
}

export type AirTrackingEvent = {
  id: string; tenantId: string; shipmentId: string; uldId?: string | null;
  eventType: AirEvent; occurredAt: string; receivedAt: string; source: TrackingSource;
  providerCode: string; confidence: TrackingConfidence;
  location?: { name?: string | null; iata?: string | null; latitude?: number | null; longitude?: number | null } | null;
  flightNumber?: string | null; description?: string | null; fingerprint: string;
};

export type AirEventRow = {
  id: string; tenant_id: string; shipment_id: string; uld_id: string | null; event_type: string;
  occurred_at: string; received_at: string; source: string; provider_code: string; confidence: string;
  location_name: string | null; location_iata: string | null; latitude: number | null; longitude: number | null;
  flight_number: string | null; description: string | null; fingerprint: string;
};

export function rowToAirEvent(r: AirEventRow): AirTrackingEvent {
  return {
    id: r.id, tenantId: r.tenant_id, shipmentId: r.shipment_id, uldId: r.uld_id,
    eventType: r.event_type as AirEvent, occurredAt: r.occurred_at, receivedAt: r.received_at,
    source: r.source as TrackingSource, providerCode: r.provider_code, confidence: r.confidence as TrackingConfidence,
    location: { name: r.location_name, iata: r.location_iata, latitude: r.latitude, longitude: r.longitude },
    flightNumber: r.flight_number, description: r.description, fingerprint: r.fingerprint,
  };
}

/** The most recent milestone event (by occurrence), ignoring position/ETA updates. */
export function latestAirMilestoneEvent(events: AirTrackingEvent[]): AirTrackingEvent | null {
  const ms = sortEvents(events.filter((e) => airEventIsMilestone(e.eventType)));
  return ms.length ? ms[ms.length - 1] : null;
}
