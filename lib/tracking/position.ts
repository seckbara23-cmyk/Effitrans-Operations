/**
 * Position validation, batching & freshness (Phase 3.4) — PURE. No I/O.
 * ---------------------------------------------------------------------------
 * The rules the ingest endpoint and the driver client both apply BEFORE a
 * position is persisted: reject invalid coordinates / timestamps / unusable
 * accuracy; batch so we never write every few seconds (min interval OR min
 * movement); pick the latest for list views; classify staleness so the UI never
 * claims "live" for an old fix. Kept I/O-free so every rule is unit-tested.
 */
import { haversineMeters } from "./geo";
import type { FreshnessState, LatLng } from "./types";

export type PositionThresholds = {
  /** Do not record more often than this many seconds (unless moved enough). */
  minIntervalSeconds: number;
  /** ...or record when the vehicle has moved at least this many metres. */
  minDistanceMeters: number;
  /** Positions worse than this accuracy (metres) are ignored. */
  maxAccuracyMeters: number;
  /** Allow this much clock skew before a future timestamp is rejected. */
  futureSkewSeconds: number;
};

/** Recommended pilot defaults (Deliverable 4). */
export const DEFAULT_POSITION_THRESHOLDS: PositionThresholds = {
  minIntervalSeconds: 60,
  minDistanceMeters: 250,
  maxAccuracyMeters: 500,
  futureSkewSeconds: 120,
};

export type FreshnessThresholds = {
  /** Age <= this (seconds) => "live". */
  liveSeconds: number;
  /** Age <= this (seconds) => "recent"; older => "stale". */
  recentSeconds: number;
};

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  liveSeconds: 120,
  recentSeconds: 900,
};

export type PositionRejectReason =
  | "invalid_coordinate"
  | "invalid_timestamp"
  | "future_timestamp"
  | "poor_accuracy";

/** Valid WGS84 coordinate. Exact (0,0) is rejected as the null-island GPS default. */
export function isValidCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Accuracy gate: unknown accuracy is allowed; a provided value must be sane and <= max. */
export function isAcceptableAccuracy(
  accuracyMeters: number | null | undefined,
  maxMeters: number,
): boolean {
  if (accuracyMeters == null) return true;
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) return false;
  return accuracyMeters <= maxMeters;
}

export type PositionCandidate = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  recordedAt: string;
};

export type ValidatePositionResult = { ok: true } | { ok: false; reason: PositionRejectReason };

/** Full pre-persist validation of a single position against `now`. */
export function validatePosition(
  input: PositionCandidate,
  now: Date,
  thresholds: PositionThresholds = DEFAULT_POSITION_THRESHOLDS,
): ValidatePositionResult {
  if (!isValidCoordinate(input.latitude, input.longitude)) {
    return { ok: false, reason: "invalid_coordinate" };
  }
  const t = new Date(input.recordedAt).getTime();
  if (Number.isNaN(t)) return { ok: false, reason: "invalid_timestamp" };
  if (t > now.getTime() + thresholds.futureSkewSeconds * 1000) {
    return { ok: false, reason: "future_timestamp" };
  }
  if (!isAcceptableAccuracy(input.accuracyMeters, thresholds.maxAccuracyMeters)) {
    return { ok: false, reason: "poor_accuracy" };
  }
  return { ok: true };
}

/**
 * Batching: should this new position be recorded given the last stored one?
 * Record if there is no previous fix, OR enough time has elapsed, OR the vehicle
 * has moved far enough. Prevents high-frequency writes (Deliverable 4).
 */
export function shouldRecordPosition(
  previous: { latitude: number; longitude: number; recordedAt: string } | null,
  next: { latitude: number; longitude: number; recordedAt: string },
  thresholds: PositionThresholds = DEFAULT_POSITION_THRESHOLDS,
): boolean {
  if (!previous) return true;
  const prevT = new Date(previous.recordedAt).getTime();
  const nextT = new Date(next.recordedAt).getTime();
  const elapsedSec = (nextT - prevT) / 1000;
  if (elapsedSec >= thresholds.minIntervalSeconds) return true;
  const from: LatLng = { lat: previous.latitude, lng: previous.longitude };
  const to: LatLng = { lat: next.latitude, lng: next.longitude };
  return haversineMeters(from, to) >= thresholds.minDistanceMeters;
}

/** Latest position by recorded time (list views fetch only the newest). */
export function selectLatestPosition<T extends { recordedAt: string }>(positions: T[]): T | null {
  let latest: T | null = null;
  for (const p of positions) {
    if (!latest || new Date(p.recordedAt).getTime() > new Date(latest.recordedAt).getTime()) {
      latest = p;
    }
  }
  return latest;
}

/** Classify how fresh the last fix is — the UI must not claim "live" for an old one. */
export function classifyFreshness(
  lastRecordedAt: string | null | undefined,
  now: Date,
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessState {
  if (!lastRecordedAt) return "none";
  const t = new Date(lastRecordedAt).getTime();
  if (Number.isNaN(t)) return "none";
  const ageSec = (now.getTime() - t) / 1000;
  if (ageSec <= thresholds.liveSeconds) return "live";
  if (ageSec <= thresholds.recentSeconds) return "recent";
  return "stale";
}

/**
 * Offline replay dedup: drop items whose idempotency key was already applied
 * (server confirmed) and de-duplicate within the batch. Returns the fresh items
 * in order; `seen` is mutated with the accepted keys (Deliverable 19).
 */
export function filterNewByKey<T extends { key: string }>(batch: T[], seen: Set<string>): T[] {
  const out: T[] = [];
  for (const item of batch) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}
