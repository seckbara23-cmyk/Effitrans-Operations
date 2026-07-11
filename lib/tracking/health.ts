/**
 * Tracking health classification (Phase 3.4C) — PURE, no I/O. No stored field.
 * ---------------------------------------------------------------------------
 * Derives an operational health state for a mission from the tracking session
 * status + the age of the last known position. Computed on read (never stored),
 * with fixed thresholds so it is deterministically testable.
 */
import type { TrackingSessionStatus } from "./types";

export type TrackingHealth = "not_started" | "live" | "stale" | "paused" | "offline" | "completed";

export type HealthThresholds = {
  /** Position age (s) at or under which tracking is "live". */
  liveSeconds: number;
  /** Position age (s) beyond which an ACTIVE mission is "offline" (no signal). */
  offlineSeconds: number;
};

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  liveSeconds: 180, // 3 min
  offlineSeconds: 900, // 15 min
};

export type TrackingHealthInput = {
  /** Session status, or null when no session exists for the transport. */
  sessionStatus: TrackingSessionStatus | null;
  /** recorded_at of the latest known position, or null. */
  lastPositionAt: string | null;
  now: Date;
  thresholds?: HealthThresholds;
};

export function classifyTrackingHealth(input: TrackingHealthInput): TrackingHealth {
  const s = input.sessionStatus;
  if (s === null || s === "CANCELLED") return "not_started";
  if (s === "COMPLETED") return "completed";
  if (s === "PAUSED") return "paused";

  // ACTIVE — classify by last-position age.
  const th = input.thresholds ?? DEFAULT_HEALTH_THRESHOLDS;
  if (!input.lastPositionAt) return "offline"; // active mission, no signal yet
  const t = new Date(input.lastPositionAt).getTime();
  if (Number.isNaN(t)) return "offline";
  const ageSec = (input.now.getTime() - t) / 1000;
  if (ageSec <= th.liveSeconds) return "live";
  if (ageSec <= th.offlineSeconds) return "stale";
  return "offline";
}
