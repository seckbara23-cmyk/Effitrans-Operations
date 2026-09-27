/**
 * UAT-DRIVER-LIVE-TRACKING-06A — the live-map read model exposes the rest of
 * the recorded fix.
 * ---------------------------------------------------------------------------
 * WHAT THIS SLICE IS. `tracking_position` has stored `heading_degrees`,
 * `speed_kph` and `accuracy_meters` since migration 20260710000002, and
 * `listLiveMissions` selected only `latitude, longitude, recorded_at`. The
 * columns were written on every real fix and then dropped on the floor at the
 * read. This widens the projection and the shape — nothing else.
 *
 * WHAT IT IS NOT. No marker animation, no vehicle icon, no rotation, no polling
 * or threshold change, no schema change, no write of any kind. Those are 06B/06C
 * and are deliberately absent.
 *
 * THE RULE THAT MATTERS. These three fields are metadata belonging to ONE real
 * recorded row. Nothing may derive, smooth, estimate or back-fill them, and a
 * row that carries none must report null — never 0. On the 2026-09-27 road
 * session only 4 of 12 fixes carried a heading (Android reports none while
 * stationary), so "absent" is the ordinary case, not an edge case.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { optionalNumber, type LiveMissionPoint } from "@/lib/tracking/live-model";
import { classifyTrackingHealth } from "@/lib/tracking/health";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const service = read("lib/tracking/live-service.ts");

/**
 * The read model's own mapping, exercised exactly as `listLiveMissions` writes
 * it. Kept in step with the service by test 09, which asserts the service still
 * maps through `optionalNumber` rather than coercing.
 */
const toPoint = (row: {
  latitude: unknown;
  longitude: unknown;
  recorded_at: string;
  heading_degrees?: unknown;
  speed_kph?: unknown;
  accuracy_meters?: unknown;
}): LiveMissionPoint => ({
  lat: Number(row.latitude),
  lng: Number(row.longitude),
  at: row.recorded_at,
  headingDegrees: optionalNumber(row.heading_degrees),
  speedKph: optionalNumber(row.speed_kph),
  accuracyMeters: optionalNumber(row.accuracy_meters),
});

const ROW = {
  latitude: 14.7,
  longitude: -17.45,
  recorded_at: "2026-09-27T21:37:25.000Z",
  heading_degrees: 329,
  speed_kph: 9.7,
  accuracy_meters: 3,
};

describe("06A — the newest fix carries its own metadata", () => {
  it("01 — heading is exposed when the device reported one", () => {
    expect(toPoint(ROW).headingDegrees).toBe(329);
  });

  it("02 — speed is exposed when the device reported one", () => {
    expect(toPoint(ROW).speedKph).toBe(9.7);
  });

  it("03 — accuracy is exposed when the device reported one", () => {
    expect(toPoint(ROW).accuracyMeters).toBe(3);
  });

  it("04 — ⚠ a missing heading is NULL, never 0 (0 would read as due north)", () => {
    // The real road session: 8 of 12 fixes had no heading at all.
    const p = toPoint({ ...ROW, heading_degrees: null });
    expect(p.headingDegrees).toBeNull();
    expect(p.headingDegrees).not.toBe(0);
  });

  it("05 — ⚠ a missing speed is NULL, never 0 (0 would read as stopped)", () => {
    const p = toPoint({ ...ROW, speed_kph: null });
    expect(p.speedKph).toBeNull();
    expect(p.speedKph).not.toBe(0);
  });

  it("06 — a missing accuracy is NULL, never 0 (0 would read as perfect)", () => {
    const p = toPoint({ ...ROW, accuracy_meters: null });
    expect(p.accuracyMeters).toBeNull();
    expect(p.accuracyMeters).not.toBe(0);
  });

  it("07 — a genuine zero is preserved: stationary is a fact, absent is not", () => {
    // `speed_kph = 0` was recorded 4 times on the road session. It must survive
    // as 0 — the null rule above must not swallow a real reading.
    const p = toPoint({ ...ROW, speed_kph: 0, heading_degrees: 0 });
    expect(p.speedKph).toBe(0);
    expect(p.headingDegrees).toBe(0);
  });

  it("08 — undefined, empty and non-finite are all unknown", () => {
    expect(optionalNumber(undefined)).toBeNull();
    expect(optionalNumber("")).toBeNull();
    expect(optionalNumber(Number.NaN)).toBeNull();
    expect(optionalNumber(Infinity)).toBeNull();
    // PostgREST may hand a `double precision` back as a string.
    expect(optionalNumber("12.5")).toBe(12.5);
    expect(optionalNumber("abc")).toBeNull();
  });
});

describe("06A — the widening, and only the widening", () => {
  it("09 — the service selects the three columns and maps them null-safely", () => {
    expect(service).toContain("heading_degrees, speed_kph, accuracy_meters");
    expect(service).toContain("headingDegrees: optionalNumber(p.heading_degrees)");
    expect(service).toContain("speedKph: optionalNumber(p.speed_kph)");
    expect(service).toContain("accuracyMeters: optionalNumber(p.accuracy_meters)");
    // The coercion the null rule exists to prevent. Anchored on the object-literal
    // form (`: Number(...)`), because `optionalNumber(p.x)` legitimately CONTAINS
    // the substring `Number(p.x)` — a bare-substring ban here could never pass,
    // which is a test that guards nothing.
    expect(service).not.toMatch(/:\s*Number\(p\.heading_degrees\)/);
    expect(service).not.toMatch(/:\s*Number\(p\.speed_kph\)/);
    expect(service).not.toMatch(/:\s*Number\(p\.accuracy_meters\)/);
  });

  it("10 — lat, lng and at are untouched, and `at` is still the DEVICE instant", () => {
    const p = toPoint(ROW);
    expect(p.lat).toBe(14.7);
    expect(p.lng).toBe(-17.45);
    expect(p.at).toBe("2026-09-27T21:37:25.000Z");
    // recorded_at (device), never received_at (server).
    expect(service).toContain("at: p.recorded_at");
    expect(service).not.toContain("at: p.received_at");
  });

  it("11 — newest-fix semantics are unchanged: one row per mission, first wins", () => {
    // The bounded window is `last_position_at` per session, NOT a global scan.
    expect(service).toContain(".in(\"recorded_at\", lastInstants)");
    expect(service).toContain("if (!p.transport_id || latest.has(p.transport_id)) continue;");
    expect(service).toContain("lastPosition: latest.get(s.transport_id as string) ?? null");
  });

  it("12 — the live read model still writes NOTHING", () => {
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(service, `live read model must not ${w}`).not.toContain(w);
    }
  });

  it("13 — nothing derives or back-fills the three fields", () => {
    // No trigonometry, no smoothing, no bearing computation in the read model:
    // that would manufacture a fact the row does not contain.
    for (const forbidden of ["Math.atan2", "bearingBetween", "computeHeading", "smooth", "estimate"]) {
      expect(service.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("14 — health still comes from the session and the fix's AGE, not from speed", () => {
    // Widening the point must not let movement masquerade as signal health.
    const now = new Date("2026-09-27T22:00:00Z");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: "2026-09-27T21:58:00Z", now })).toBe("live");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: "2026-09-27T21:50:00Z", now })).toBe("stale");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: "2026-09-27T21:00:00Z", now })).toBe("offline");
    expect(classifyTrackingHealth({ sessionStatus: "ACTIVE", lastPositionAt: null, now })).toBe("offline");
    expect(service).not.toContain("speedKph > ");
  });

  it("15 — 06A itself still touches no rendering", () => {
    // SUPERSEDED IN PART, deliberately. This asserted that the map contained no
    // `requestAnimationFrame`, no `setRotation`, no `<svg>` and still recreated
    // its markers — i.e. that 06A had shipped the read model WITHOUT the
    // presentation work. TRACKING-06B is exactly that presentation work, so
    // those four assertions have done their job and are now false by design;
    // `tracking-06b-marker.test.ts` owns the rendering contract from here.
    //
    // What remains 06A's to guard is that the READ MODEL still contains no
    // rendering concern of its own.
    const model = read("lib/tracking/live-model.ts");
    for (const rendering of ["requestAnimationFrame", "setRotation", "<svg", "maplibre"]) {
      expect(model.toLowerCase(), `${rendering} is not the read model's business`).not.toContain(
        rendering.toLowerCase(),
      );
    }
    expect(service).not.toContain("requestAnimationFrame");
  });
});
