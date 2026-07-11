/**
 * Driver position batch validation (Phase 3.4C) — PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Validates a batch of driver-submitted positions before persistence: bounded
 * size, valid coordinates/timestamps (reuses lib/tracking/position), no missing
 * idempotency key, in-batch dedup, and no excessive historical replay. Trusted
 * associations (tenant/file/transport/driver) are NEVER taken from the client —
 * the endpoint derives them from the session. Deterministic (fixed `now`).
 */
import { validatePosition, DEFAULT_POSITION_THRESHOLDS, type PositionThresholds } from "@/lib/tracking/position";

export const MAX_POSITION_BATCH = 200;
/** Reject positions older than this (excessive historical replay). */
export const MAX_POSITION_AGE_SECONDS = 86_400; // 24h

export type RawDriverPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedKph?: number | null;
  recordedAt: string;
  idempotencyKey: string;
};

export type BatchValidation = {
  tooLarge: boolean;
  accepted: RawDriverPosition[];
  rejected: { idempotencyKey: string; reason: string }[];
};

export function validatePositionBatch(
  positions: RawDriverPosition[],
  now: Date,
  thresholds: PositionThresholds = DEFAULT_POSITION_THRESHOLDS,
): BatchValidation {
  const tooLarge = positions.length > MAX_POSITION_BATCH;
  const rejected: { idempotencyKey: string; reason: string }[] = [];
  const accepted: RawDriverPosition[] = [];
  const seen = new Set<string>();

  for (const p of positions.slice(0, MAX_POSITION_BATCH)) {
    const key = typeof p?.idempotencyKey === "string" ? p.idempotencyKey.trim() : "";
    if (!key) {
      rejected.push({ idempotencyKey: "", reason: "missing_idempotency_key" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ idempotencyKey: key, reason: "duplicate_in_batch" });
      continue;
    }
    const check = validatePosition({ latitude: p.latitude, longitude: p.longitude, accuracyMeters: p.accuracyMeters, recordedAt: p.recordedAt }, now, thresholds);
    if (!check.ok) {
      rejected.push({ idempotencyKey: key, reason: check.reason });
      continue;
    }
    const ageSec = (now.getTime() - new Date(p.recordedAt).getTime()) / 1000;
    if (ageSec > MAX_POSITION_AGE_SECONDS) {
      rejected.push({ idempotencyKey: key, reason: "too_old" });
      continue;
    }
    seen.add(key);
    accepted.push(p);
  }
  return { tooLarge, accepted, rejected };
}
