/**
 * Geofence arrival detection (Phase 3.4) — PURE. No I/O.
 * ---------------------------------------------------------------------------
 * Conservative geofences over VETTED coordinates only (pickup, port, customs,
 * warehouse, border, destination). Detection is IDEMPOTENT: the caller supplies
 * the set of already-fired dedup keys (persisted as tracking_event.dedup_key,
 * which has a unique index as the race-proof backstop), so re-evaluating the
 * same position yields no new events. A geofence event may SUGGEST the next
 * action but never mutates workflow — arrival at the destination geofence still
 * requires an explicit delivery confirmation (Deliverable 11).
 */
import { withinRadius } from "./geo";
import type { LatLng, TrackingEventType } from "./types";

export type Geofence = {
  key: string;
  label: string;
  center: LatLng;
  radiusMeters: number;
  event: TrackingEventType;
};

export type GeofenceHit = {
  fenceKey: string;
  label: string;
  event: TrackingEventType;
  dedupKey: string;
};

/** Stable idempotency key: one arrival event per (dossier, fence, event). */
export function geofenceDedupKey(fileId: string, fenceKey: string, event: TrackingEventType): string {
  return `geofence:${fileId}:${fenceKey}:${event}`;
}

/**
 * Which geofences does this position newly enter? Skips fences already fired
 * (idempotent). Only vetted fences with a positive radius are considered.
 */
export function detectGeofenceEvents(input: {
  fileId: string;
  position: LatLng;
  fences: Geofence[];
  firedDedupKeys: Set<string>;
}): GeofenceHit[] {
  const hits: GeofenceHit[] = [];
  for (const fence of input.fences) {
    if (fence.radiusMeters <= 0) continue;
    if (!withinRadius(input.position, fence.center, fence.radiusMeters)) continue;
    const dedupKey = geofenceDedupKey(input.fileId, fence.key, fence.event);
    if (input.firedDedupKeys.has(dedupKey)) continue;
    hits.push({ fenceKey: fence.key, label: fence.label, event: fence.event, dedupKey });
  }
  return hits;
}
