import { describe, it, expect } from "vitest";
import { resolveTrackingFlags } from "@/lib/tracking/flags";
import { haversineMeters, withinRadius, straightLineProgressPercent } from "@/lib/tracking/geo";
import {
  isValidCoordinate,
  isAcceptableAccuracy,
  validatePosition,
  shouldRecordPosition,
  selectLatestPosition,
  classifyFreshness,
  filterNewByKey,
  DEFAULT_POSITION_THRESHOLDS,
} from "@/lib/tracking/position";
import { detectGeofenceEvents, geofenceDedupKey, type Geofence } from "@/lib/tracking/geofence";
import { isManualUpdateKind, isCustomerSafeByDefault, isTrackingEventType, MANUAL_UPDATE_KINDS } from "@/lib/tracking/events";
import { deriveRealtimeEta } from "@/lib/tracking/eta";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString();

describe("tracking feature flags (dark by default)", () => {
  it("defaults everything to false when nothing is set", () => {
    expect(resolveTrackingFlags({})).toEqual({
      enabled: false, driverMobile: false, portalLive: false, realtime: false, geofence: false,
    });
  });
  it("a sub-flag is inert without the master flag", () => {
    const f = resolveTrackingFlags({ DRIVER_MOBILE_TRACKING_ENABLED: "true", PORTAL_LIVE_TRACKING_ENABLED: "true" });
    expect(f.enabled).toBe(false);
    expect(f.driverMobile).toBe(false);
    expect(f.portalLive).toBe(false);
  });
  it("master + sub-flag together enable the capability", () => {
    const f = resolveTrackingFlags({ TRACKING_ENABLED: "true", DRIVER_MOBILE_TRACKING_ENABLED: "true" });
    expect(f.enabled).toBe(true);
    expect(f.driverMobile).toBe(true);
    expect(f.realtime).toBe(false);
  });
});

describe("geo — haversine / radius / progress", () => {
  it("Dakar → Thiès is ~54 km", () => {
    const d = haversineMeters({ lat: 14.7167, lng: -17.4677 }, { lat: 14.7833, lng: -16.9667 });
    expect(d).toBeGreaterThan(45_000);
    expect(d).toBeLessThan(65_000);
  });
  it("withinRadius respects the radius", () => {
    const port = { lat: 14.6796, lng: -17.4249 };
    expect(withinRadius({ lat: 14.6799, lng: -17.4251 }, port, 500)).toBe(true);
    expect(withinRadius({ lat: 14.7833, lng: -16.9667 }, port, 500)).toBe(false);
  });
  it("straight-line progress is clamped 0..100 and monotonic", () => {
    const o = { lat: 14.7167, lng: -17.4677 };
    const d = { lat: 12.6392, lng: -8.0029 };
    expect(straightLineProgressPercent(o, o, d)).toBe(0);
    expect(straightLineProgressPercent(o, d, d)).toBe(100);
    const mid = straightLineProgressPercent(o, { lat: 13.9, lng: -13.0 }, d);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });
});

describe("position validation (invalid coordinate / timestamp / accuracy)", () => {
  it("accepts a valid WGS84 coordinate, rejects null-island and out-of-range", () => {
    expect(isValidCoordinate(14.7, -17.4)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false); // null island
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  });
  it("accuracy gate: unknown allowed, sane value must be within max", () => {
    expect(isAcceptableAccuracy(null, 500)).toBe(true);
    expect(isAcceptableAccuracy(50, 500)).toBe(true);
    expect(isAcceptableAccuracy(1000, 500)).toBe(false);
    expect(isAcceptableAccuracy(-1, 500)).toBe(false);
  });
  it("validatePosition rejects bad coordinate / timestamp / future / accuracy", () => {
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, recordedAt: iso(-1000) }, NOW).ok).toBe(true);
    expect(validatePosition({ latitude: 0, longitude: 0, recordedAt: iso(-1000) }, NOW)).toEqual({ ok: false, reason: "invalid_coordinate" });
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, recordedAt: "nope" }, NOW)).toEqual({ ok: false, reason: "invalid_timestamp" });
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, recordedAt: iso(10 * 60_000) }, NOW)).toEqual({ ok: false, reason: "future_timestamp" });
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, accuracyMeters: 5000, recordedAt: iso(-1000) }, NOW)).toEqual({ ok: false, reason: "poor_accuracy" });
  });
  it("allows small clock skew on the future check", () => {
    const skewMs = DEFAULT_POSITION_THRESHOLDS.futureSkewSeconds * 1000;
    expect(validatePosition({ latitude: 14.7, longitude: -17.4, recordedAt: iso(skewMs - 1000) }, NOW).ok).toBe(true);
  });
});

describe("position batching + latest + freshness", () => {
  it("records only on min interval OR min movement", () => {
    const prev = { latitude: 14.700, longitude: -17.400, recordedAt: iso(0) };
    expect(shouldRecordPosition(null, prev)).toBe(true); // first fix
    // same spot, 10s later -> no
    expect(shouldRecordPosition(prev, { latitude: 14.700, longitude: -17.400, recordedAt: iso(10_000) })).toBe(false);
    // same spot, 61s later -> yes (interval)
    expect(shouldRecordPosition(prev, { latitude: 14.700, longitude: -17.400, recordedAt: iso(61_000) })).toBe(true);
    // moved ~330m, 10s later -> yes (distance)
    expect(shouldRecordPosition(prev, { latitude: 14.703, longitude: -17.400, recordedAt: iso(10_000) })).toBe(true);
    // moved ~55m, 10s later -> no
    expect(shouldRecordPosition(prev, { latitude: 14.7005, longitude: -17.400, recordedAt: iso(10_000) })).toBe(false);
  });
  it("selectLatestPosition picks the newest recorded_at", () => {
    const latest = selectLatestPosition([
      { recordedAt: iso(-3000), id: "a" },
      { recordedAt: iso(-1000), id: "b" },
      { recordedAt: iso(-2000), id: "c" },
    ]);
    expect(latest?.id).toBe("b");
    expect(selectLatestPosition([])).toBeNull();
  });
  it("classifyFreshness: none/live/recent/stale", () => {
    expect(classifyFreshness(null, NOW)).toBe("none");
    expect(classifyFreshness(iso(-30_000), NOW)).toBe("live");
    expect(classifyFreshness(iso(-300_000), NOW)).toBe("recent");
    expect(classifyFreshness(iso(-2_000_000), NOW)).toBe("stale");
  });
  it("offline replay dedup drops already-applied keys", () => {
    const seen = new Set<string>(["k1"]);
    const fresh = filterNewByKey([{ key: "k1" }, { key: "k2" }, { key: "k2" }, { key: "k3" }], seen);
    expect(fresh.map((f) => f.key)).toEqual(["k2", "k3"]);
    expect(seen.has("k2")).toBe(true);
  });
});

describe("geofence idempotency", () => {
  const fences: Geofence[] = [
    { key: "dakar_port", label: "Port de Dakar", center: { lat: 14.6796, lng: -17.4249 }, radiusMeters: 1000, event: "ARRIVED_NEAR_PICKUP" },
    { key: "bamako", label: "Bamako", center: { lat: 12.6392, lng: -8.0029 }, radiusMeters: 1000, event: "ARRIVED_NEAR_DESTINATION" },
  ];
  it("fires once for an entered fence, never again for the same fired key", () => {
    const pos = { lat: 14.6799, lng: -17.4251 };
    const first = detectGeofenceEvents({ fileId: "F1", position: pos, fences, firedDedupKeys: new Set() });
    expect(first).toHaveLength(1);
    expect(first[0].event).toBe("ARRIVED_NEAR_PICKUP");
    expect(first[0].dedupKey).toBe(geofenceDedupKey("F1", "dakar_port", "ARRIVED_NEAR_PICKUP"));
    // Re-evaluate with the fired key present -> nothing new.
    const again = detectGeofenceEvents({ fileId: "F1", position: pos, fences, firedDedupKeys: new Set([first[0].dedupKey]) });
    expect(again).toHaveLength(0);
  });
  it("returns nothing when outside every fence", () => {
    const hits = detectGeofenceEvents({ fileId: "F1", position: { lat: 0.1, lng: 0.1 }, fences, firedDedupKeys: new Set() });
    expect(hits).toHaveLength(0);
  });
});

describe("event classification (manual vs customer-safe)", () => {
  it("manual update kinds exclude DELIVERED (lifecycle stays authoritative)", () => {
    expect(isManualUpdateKind("DEPARTED")).toBe(true);
    expect(isManualUpdateKind("DELIVERED")).toBe(false);
    expect(isManualUpdateKind("NONSENSE")).toBe(false);
    expect(MANUAL_UPDATE_KINDS).not.toContain("DELIVERED");
  });
  it("customer-safe defaults hide internal event types", () => {
    expect(isCustomerSafeByDefault("DEPARTED")).toBe(true);
    expect(isCustomerSafeByDefault("DELIVERED")).toBe(true);
    expect(isCustomerSafeByDefault("INCIDENT_REPORTED")).toBe(false);
    expect(isCustomerSafeByDefault("CUSTOMS_STOP")).toBe(false);
    expect(isCustomerSafeByDefault("WAREHOUSE_REACHED")).toBe(false);
  });
  it("isTrackingEventType guards the domain", () => {
    expect(isTrackingEventType("BORDER_REACHED")).toBe(true);
    expect(isTrackingEventType("FLYING")).toBe(false);
  });
});

describe("ETA v2 — realtime confidence degradation, never fabricates", () => {
  const base = { scheduledDelivery: null, transportEta: null, pickupActual: null, deliveredActual: null, currentStageKey: null, livePositionAt: null, now: NOW };

  it("no grounded date => unavailable, even with a live position", () => {
    const e = deriveRealtimeEta({ ...base, livePositionAt: iso(-30_000) });
    expect(e.estimatedArrival).toBeNull();
    expect(e.basis).toBe("unavailable");
    expect(e.confidencePercent).toBe(0);
  });
  it("transport ETA with no live position keeps medium confidence", () => {
    const e = deriveRealtimeEta({ ...base, transportEta: "2026-07-12T00:00:00.000Z" });
    expect(e.basis).toBe("transport_eta");
    expect(e.confidence).toBe("medium");
    expect(e.estimatedArrival).toBe("2026-07-12T00:00:00.000Z");
  });
  it("a FRESH live position switches basis to live_position (still not high)", () => {
    const e = deriveRealtimeEta({ ...base, transportEta: "2026-07-12T00:00:00.000Z", livePositionAt: iso(-30_000) });
    expect(e.basis).toBe("live_position");
    expect(e.confidence).toBe("medium");
  });
  it("a STALE live position degrades confidence + last_known_position", () => {
    const e = deriveRealtimeEta({ ...base, transportEta: "2026-07-12T00:00:00.000Z", livePositionAt: iso(-2_000_000) });
    expect(e.basis).toBe("last_known_position");
    expect(e.confidence).toBe("low");
  });
  it("a single GPS point cannot claim high confidence off a scheduled date", () => {
    const e = deriveRealtimeEta({ ...base, scheduledDelivery: "2026-07-12T00:00:00.000Z", livePositionAt: iso(-30_000) });
    expect(e.confidence).toBe("medium"); // capped down from high
    expect(e.basis).toBe("live_position");
  });
  it("delivered => actual arrival, high confidence, no delay", () => {
    const e = deriveRealtimeEta({ ...base, deliveredActual: "2026-07-09T09:00:00.000Z" });
    expect(e.estimatedArrival).toBe("2026-07-09T09:00:00.000Z");
    expect(e.confidence).toBe("high");
    expect(e.delayMinutes).toBe(0);
  });
});
