/**
 * Shipping Line Platform — canonical tracking event model (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * Every carrier / AIS / port / customs / manual update normalizes into ONE immutable
 * canonical event. `occurredAt` (when it happened) is kept separate from `receivedAt`
 * (when we learned it). A deterministic fingerprint drives deduplication. Confidence is
 * explicit and never upgraded: an INFERRED event is never presented as CONFIRMED.
 */
import { SHIPPING_MILESTONES, type ShippingMilestone } from "./milestones";

export const TRACKING_SOURCES = ["CARRIER", "AIS", "PORT", "TERMINAL", "CUSTOMS", "ROAD", "MANUAL", "SYSTEM"] as const;
export type TrackingSource = (typeof TRACKING_SOURCES)[number];

export const TRACKING_CONFIDENCES = ["CONFIRMED", "INFERRED", "MANUAL", "ESTIMATED"] as const;
export type TrackingConfidence = (typeof TRACKING_CONFIDENCES)[number];

/**
 * 8.4 (sections M/O) — human labels for source and confidence. ONE definition, French,
 * safe for BOTH staff and portal surfaces (never a raw enum in the UI, never liveness
 * language, never an operator identity). « saisie manuelle » satisfies the required
 * « Source : saisie manuelle » display; nothing here may ever read « Confirmé par le
 * transporteur » unless the source IS a provider (CARRIER/AIS) — and none is connected.
 */
export const SOURCE_LABEL_FR: Record<TrackingSource, string> = {
  CARRIER: "Transporteur", AIS: "Signal AIS", PORT: "Escale portuaire", TERMINAL: "Terminal",
  CUSTOMS: "Douane", ROAD: "GPS routier", MANUAL: "Saisie manuelle", SYSTEM: "Système",
};
export function sourceLabelFr(s: string): string {
  return (SOURCE_LABEL_FR as Record<string, string>)[s] ?? s;
}

export const CONFIDENCE_LABEL_FR: Record<TrackingConfidence, string> = {
  CONFIRMED: "Confirmée", INFERRED: "Déduite", MANUAL: "Saisie manuelle", ESTIMATED: "Estimée",
};
export function confidenceLabelFr(c: string): string {
  return (CONFIDENCE_LABEL_FR as Record<string, string>)[c] ?? c;
}

/** Canonical event vocabulary: every milestone, plus non-milestone position/ETA updates. */
export const CANONICAL_SHIPPING_EVENTS = [...SHIPPING_MILESTONES, "POSITION_UPDATE", "ETA_UPDATE"] as const;
export type CanonicalShippingEvent = (typeof CANONICAL_SHIPPING_EVENTS)[number];

export function isCanonicalEvent(v: string): v is CanonicalShippingEvent {
  return (CANONICAL_SHIPPING_EVENTS as readonly string[]).includes(v);
}
export function eventIsMilestone(e: CanonicalShippingEvent): e is ShippingMilestone {
  return (SHIPPING_MILESTONES as readonly string[]).includes(e);
}

export type EventLocation = { name?: string | null; unlocode?: string | null; latitude?: number | null; longitude?: number | null };
export type EventVessel = { imo?: string | null; mmsi?: string | null; name?: string | null; voyageReference?: string | null };

export type ShippingTrackingEvent = {
  id: string;
  tenantId: string;
  shipmentId: string;
  containerId?: string | null;
  eventType: CanonicalShippingEvent;
  occurredAt: string;
  receivedAt: string;
  source: TrackingSource;
  providerCode: string;
  confidence: TrackingConfidence;
  location?: EventLocation | null;
  vessel?: EventVessel | null;
  description?: string | null;
  fingerprint: string;
};

/** The fields a caller provides; id/receivedAt/fingerprint are derived by normalize. */
export type TrackingEventInput = {
  tenantId: string;
  shipmentId: string;
  containerId?: string | null;
  eventType: CanonicalShippingEvent;
  occurredAt: string;
  receivedAt?: string;
  source: TrackingSource;
  providerCode: string;
  confidence: TrackingConfidence;
  location?: EventLocation | null;
  vessel?: EventVessel | null;
  description?: string | null;
};

/**
 * Deterministic dedup key: same shipment + container + type + occurredAt + location →
 * same event, regardless of when/where it was received or which provider re-reported it.
 * A stable fingerprint means the same carrier event delivered twice is stored once.
 */
export function eventFingerprint(e: {
  shipmentId: string;
  containerId?: string | null;
  eventType: string;
  occurredAt: string;
  location?: EventLocation | null;
}): string {
  const loc = e.location?.unlocode ?? e.location?.name ?? (e.location?.latitude != null ? `${e.location.latitude},${e.location.longitude}` : "");
  return [e.shipmentId, e.containerId ?? "", e.eventType, e.occurredAt, loc].join("|");
}

/** Normalize raw input into a canonical event (fills receivedAt + fingerprint). PURE:
 *  id and receivedAt are injected so the function is deterministic and testable. */
export function normalizeTrackingEvent(input: TrackingEventInput, id: string, receivedAt: string): ShippingTrackingEvent {
  return {
    id,
    tenantId: input.tenantId,
    shipmentId: input.shipmentId,
    containerId: input.containerId ?? null,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? receivedAt,
    source: input.source,
    providerCode: input.providerCode,
    confidence: input.confidence,
    location: input.location ?? null,
    vessel: input.vessel ?? null,
    description: input.description ?? null,
    fingerprint: eventFingerprint(input),
  };
}

/** Remove duplicates by fingerprint, keeping the FIRST occurrence. Immutable. */
export function dedupeEvents<T extends { fingerprint: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    if (seen.has(e.fingerprint)) continue;
    seen.add(e.fingerprint);
    out.push(e);
  }
  return out;
}

/** Chronological order by occurredAt, then receivedAt (stable, out-of-order safe). Immutable. */
export function sortEvents<T extends { occurredAt: string; receivedAt: string }>(events: T[]): T[] {
  return [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0,
  );
}

/** The most recent milestone event (by occurrence), ignoring position/ETA updates. */
export function latestMilestoneEvent(events: ShippingTrackingEvent[]): ShippingTrackingEvent | null {
  const milestones = sortEvents(events.filter((e) => eventIsMilestone(e.eventType)));
  return milestones.length ? milestones[milestones.length - 1] : null;
}
