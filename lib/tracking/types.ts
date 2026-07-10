/**
 * Tracking shared types (Phase 3.4). Client + server safe (no I/O, no secrets).
 * ---------------------------------------------------------------------------
 * Provider-neutral tracking model. A position/event is EVIDENCE over the
 * authoritative transport lifecycle — never a second status source. The DB
 * column shapes live in lib/db/types.ts; these are the app-facing DTOs + the
 * canonical enums shared by the pure engines, the service, and the UI.
 */

/** Where a position/event came from. Provider sources are seams (not wired yet). */
export type TrackingSource =
  | "manual"
  | "driver_mobile"
  | "vehicle_gps"
  | "carrier_api"
  | "vessel_api"
  | "flight_api";

export const TRACKING_SOURCES: TrackingSource[] = [
  "manual",
  "driver_mobile",
  "vehicle_gps",
  "carrier_api",
  "vessel_api",
  "flight_api",
];

export function isTrackingSource(v: string): v is TrackingSource {
  return (TRACKING_SOURCES as string[]).includes(v);
}

export type TrackingSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

/** The tracking_event.type domain (mirrors the DB CHECK constraint exactly). */
export type TrackingEventType =
  | "TRACKING_STARTED"
  | "PICKUP_CONFIRMED"
  | "DEPARTED"
  | "CHECKPOINT_REACHED"
  | "BORDER_REACHED"
  | "WAREHOUSE_REACHED"
  | "CUSTOMS_STOP"
  | "DELAY_REPORTED"
  | "INCIDENT_REPORTED"
  | "ARRIVED_NEAR_PICKUP"
  | "ARRIVED_NEAR_CHECKPOINT"
  | "ARRIVED_NEAR_DESTINATION"
  | "DELIVERY_ATTEMPTED"
  | "DELIVERED"
  | "TRACKING_STOPPED";

export type LatLng = { lat: number; lng: number };

/** How fresh the last known position is (drives the customer-safe availability label). */
export type FreshnessState = "live" | "recent" | "stale" | "none";

/** A validated position ready to persist (server maps this to a tracking_position row). */
export type TrackingPositionInput = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedKph?: number | null;
  recordedAt: string;
  source: TrackingSource;
};

/** App-facing latest position for a dossier (staff/driver view). */
export type LatestPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedKph: number | null;
  source: TrackingSource;
  recordedAt: string;
  customerVisible: boolean;
};

/** Internal timeline entry (staff view — may carry internal_note). */
export type TrackingEventEntry = {
  id: string;
  type: TrackingEventType;
  source: TrackingSource;
  customerVisible: boolean;
  customerMessage: string | null;
  internalNote: string | null;
  occurredAt: string;
  createdBy: string | null;
};

export type TrackingActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
