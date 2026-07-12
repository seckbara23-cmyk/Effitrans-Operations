/**
 * Driver operational event / delay / incident kinds (Phase 3.4C-3) — PURE.
 * ---------------------------------------------------------------------------
 * Language-free enums + guards for the driver-recordable events, delay
 * categories, incident categories, incident severities, and the photo MIME
 * allow-list. Copy lives in i18n. Delay/incident metadata is stored in
 * tracking_event.detail (jsonb); customer-safe vs internal text stay separate.
 */
import type { TrackingEventType } from "@/lib/tracking/types";

/** Operational events a driver may record (subset of the tracking_event domain). */
export const DRIVER_EVENT_KINDS: TrackingEventType[] = [
  "PICKUP_CONFIRMED",
  "DEPARTED",
  "CHECKPOINT_REACHED",
  "BORDER_REACHED",
  "WAREHOUSE_REACHED",
  "ARRIVED_NEAR_DESTINATION",
  "DELIVERY_ATTEMPTED",
];
export function isDriverEventKind(v: string): v is TrackingEventType {
  return (DRIVER_EVENT_KINDS as string[]).includes(v);
}

export type DelayCategory =
  | "traffic"
  | "breakdown"
  | "road_closure"
  | "checkpoint"
  | "customs_delay"
  | "weather"
  | "incorrect_address"
  | "client_unavailable"
  | "other";
export const DELAY_CATEGORIES: DelayCategory[] = [
  "traffic",
  "breakdown",
  "road_closure",
  "checkpoint",
  "customs_delay",
  "weather",
  "incorrect_address",
  "client_unavailable",
  "other",
];
export function isDelayCategory(v: string): v is DelayCategory {
  return (DELAY_CATEGORIES as string[]).includes(v);
}

export type IncidentCategory =
  | "accident"
  | "cargo_damage"
  | "security"
  | "breakdown"
  | "delivery_refusal"
  | "missing_cargo"
  | "other";
export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  "accident",
  "cargo_damage",
  "security",
  "breakdown",
  "delivery_refusal",
  "missing_cargo",
  "other",
];
export function isIncidentCategory(v: string): v is IncidentCategory {
  return (INCIDENT_CATEGORIES as string[]).includes(v);
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export const INCIDENT_SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];
export function isIncidentSeverity(v: string): v is IncidentSeverity {
  return (INCIDENT_SEVERITIES as string[]).includes(v);
}

/** Photo/POD upload kinds → document_type code. */
export type EvidenceKind = "pickup" | "cargo" | "seal" | "incident" | "delivery" | "signature" | "pod";
export const EVIDENCE_TYPE_CODE: Record<EvidenceKind, string> = {
  pickup: "PICKUP_PHOTO",
  cargo: "CARGO_PHOTO",
  seal: "SEAL_PHOTO",
  incident: "INCIDENT_PHOTO",
  delivery: "DELIVERY_PHOTO",
  signature: "DRIVER_SIGNATURE",
  pod: "DELIVERY_NOTE",
};
export function isEvidenceKind(v: string): v is EvidenceKind {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_TYPE_CODE, v);
}

/** Dedup window for repeated delay submissions (double-tap / retry safe). */
export const DELAY_DEDUP_WINDOW_MS = 600_000; // 10 minutes
/** One delay per (transport, category) per time bucket — the unique dedup_key. */
export function delayDedupKey(transportId: string, category: string, nowMs: number): string {
  return `delay:${transportId}:${category}:${Math.floor(nowMs / DELAY_DEDUP_WINDOW_MS)}`;
}
/** One DELIVERED evidence event per transport. */
export function deliveredDedupKey(transportId: string): string {
  return `delivered:${transportId}`;
}

/** Photos are image-only; a POD may also be a PDF. */
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png"];
export function isAllowedEvidenceMime(kind: EvidenceKind, mime: string | null | undefined): boolean {
  const m = (mime ?? "").toLowerCase();
  if (kind === "pod") return PHOTO_MIME_TYPES.includes(m) || m === "application/pdf";
  return PHOTO_MIME_TYPES.includes(m);
}
