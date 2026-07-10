/**
 * Tracking event metadata (Phase 3.4) — PURE, language-free (like
 * lib/customer-notify/events.ts). Customer-facing copy lives in i18n; this
 * module only classifies event types: which are recordable as MANUAL ops
 * updates, and which are CUSTOMER-SAFE by default. A default is just the initial
 * customer_visible value — staff always decide per event, and internal-only
 * detail (internal_note) is never derived into customer view.
 */
import type { TrackingEventType } from "./types";

export const TRACKING_EVENT_TYPES: TrackingEventType[] = [
  "TRACKING_STARTED",
  "PICKUP_CONFIRMED",
  "DEPARTED",
  "CHECKPOINT_REACHED",
  "BORDER_REACHED",
  "WAREHOUSE_REACHED",
  "CUSTOMS_STOP",
  "DELAY_REPORTED",
  "INCIDENT_REPORTED",
  "ARRIVED_NEAR_PICKUP",
  "ARRIVED_NEAR_CHECKPOINT",
  "ARRIVED_NEAR_DESTINATION",
  "DELIVERY_ATTEMPTED",
  "DELIVERED",
  "TRACKING_STOPPED",
];

export function isTrackingEventType(v: string): v is TrackingEventType {
  return (TRACKING_EVENT_TYPES as string[]).includes(v);
}

/**
 * Event types an operator may record as a MANUAL update (Deliverable 16).
 * DELIVERED is deliberately EXCLUDED — delivery stays the existing transport
 * lifecycle transition (no second delivery workflow, DEC-A02); a manual
 * "arrived" is ARRIVED_NEAR_DESTINATION (evidence only).
 */
export const MANUAL_UPDATE_KINDS: TrackingEventType[] = [
  "DEPARTED",
  "CHECKPOINT_REACHED",
  "BORDER_REACHED",
  "WAREHOUSE_REACHED",
  "ARRIVED_NEAR_DESTINATION",
  "DELAY_REPORTED",
];

export function isManualUpdateKind(v: string): v is TrackingEventType {
  return (MANUAL_UPDATE_KINDS as string[]).includes(v);
}

/**
 * Which event types are customer-safe by DEFAULT (initial customer_visible).
 * Internal-only by default: system/session events, warehouse stops, customs
 * stops, incidents, and pickup/checkpoint geofence pings — none should surface
 * to a client without a deliberate opt-in and a customer-safe message.
 */
const CUSTOMER_SAFE_DEFAULT = new Set<TrackingEventType>([
  "PICKUP_CONFIRMED",
  "DEPARTED",
  "CHECKPOINT_REACHED",
  "BORDER_REACHED",
  "DELAY_REPORTED",
  "ARRIVED_NEAR_DESTINATION",
  "DELIVERY_ATTEMPTED",
  "DELIVERED",
]);

export function isCustomerSafeByDefault(type: TrackingEventType): boolean {
  return CUSTOMER_SAFE_DEFAULT.has(type);
}
