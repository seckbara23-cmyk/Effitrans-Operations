/**
 * Tracking activation audit — the architecture guards.
 * ---------------------------------------------------------------------------
 * The audit's finding is that the tracking spine is COMPLETE and EMPTY: every
 * marker on the aggregated map today is a seeded port or airport, not a position.
 *
 * The risk that follows is specific. Someone activating tracking will be tempted
 * to (a) render a reference location as though it were a live position, or
 * (b) let a provider stub answer with a fabricated coordinate rather than
 * "not configured". Both would make the map lie, which is worse than an empty map.
 *
 * These guards defend the properties the audit relies on. They assert
 * ARCHITECTURE, never row counts — production data is expected to change, and
 * that is the point of the roadmap.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";
import { resolveTrackingFlags } from "@/lib/tracking/flags";
import { isValidCoordinate, classifyFreshness } from "@/lib/tracking/position";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FLEET_MAP = "lib/executive/readers/fleet-map.ts";
const PROJECTION = "lib/shipping/intelligence/map-projection.ts";

// ===========================================================================
describe("a reference location is never dressed up as a position", () => {
  it("port and airport markers carry no status, freshness, confidence or source", () => {
    // This is what makes the current map honest while the spine is empty.
    const s = code(FLEET_MAP);
    for (const kind of ['kind: "port"', 'kind: "airport"']) {
      const i = s.indexOf(kind);
      expect(i, kind).toBeGreaterThan(-1);
      const marker = s.slice(i, i + 260);
      for (const nulled of ["status: null", "freshness: null", "confidence: null", "source: null", "occurredAt: null"]) {
        expect(marker, `${kind} → ${nulled}`).toContain(nulled);
      }
    }
  });

  it("the projection keeps the marker kinds distinct", () => {
    const s = code(PROJECTION);
    expect(s).toContain('kind: "origin" | "destination" | "port" | "current" | "milestone"');
    // Only a resolved position becomes `current`; a reference point cannot.
    expect(s).toContain("currentPosition?: MapMarker");
  });

  it("a projection with only endpoints yields NO current position", () => {
    const p = buildShipmentMapProjection({
      origin: { latitude: 31.233, longitude: 121.483, label: "Shanghai" },
      destination: { latitude: 14.683, longitude: -17.417, label: "Dakar" },
    });
    expect(p.origin).toBeDefined();
    expect(p.destination).toBeDefined();
    expect(p.currentPosition).toBeUndefined();
    expect(p.bounds).toBeDefined();
  });
});

// ===========================================================================
describe("the map stays provider-neutral", () => {
  it("the projection imports no mapping library", () => {
    const s = read(PROJECTION);
    expect(s).not.toMatch(/from ["']leaflet|from ["']react-leaflet|mapbox|google.*maps/i);
    // The header wraps; match within a line.
    expect(s).toContain("It imports NO mapping");
  });

  it("provider adapters refuse rather than fabricate", () => {
    // An unconfigured provider must answer not_configured/unsupported — never a
    // coordinate. A fabricated position is the one failure mode a map cannot
    // survive.
    const p = code("lib/shipping/intelligence/provider.ts");
    expect(p).toContain('"not_configured"');
    expect(p).toContain('"unsupported"');
    expect(p).not.toMatch(/latitude:\s*-?\d+\.\d+/);
  });
});

// ===========================================================================
describe("the safety rails the roadmap depends on", () => {
  it("tracking is dark unless the master flag is on", () => {
    expect(resolveTrackingFlags({}).enabled).toBe(false);
    // A sub-flag alone is inert.
    const subOnly = resolveTrackingFlags({ DRIVER_MOBILE_TRACKING_ENABLED: "true" });
    expect(subOnly.enabled).toBe(false);
    expect(subOnly.driverMobile).toBe(false);
  });

  it("impossible coordinates are rejected, including 0,0-adjacent nonsense", () => {
    expect(isValidCoordinate(14.683, -17.417)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  });

  it("freshness is computed, not assumed", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    const fresh = classifyFreshness(new Date(now.getTime() - 60_000).toISOString(), now);
    const old = classifyFreshness(new Date(now.getTime() - 30 * 24 * 3600_000).toISOString(), now);
    expect(fresh).not.toBe(old);
  });

  it("the aggregated map refuses without transport:read", () => {
    expect(code(FLEET_MAP)).toContain("transport:read requis pour la carte agrégée.");
  });

  it("the audit is on the record", () => {
    const doc = read("docs/tracking/tracking-activation-audit.md");
    expect(doc).toContain("The tracking system is built");
    expect(doc).toContain("seeded reference location");
    expect(doc).toContain("TRACK-1");
  });
});
