/**
 * UAT-DRIVER-LIVE-TRACKING-06B — a vehicle that moves truthfully.
 * ---------------------------------------------------------------------------
 * WHAT THE S24 ROAD UAT SHOWED. End-to-end tracking works: real fixes reach
 * production and appear on the Operations map. But the mission was a generic
 * green dot, and each new fix TELEPORTED it, because the marker effect removed
 * every marker and rebuilt it on every 30 s refresh.
 *
 * WHAT THIS SLICE CHANGES: presentation only. A vehicle glyph, a restrained
 * green halo while the signal is genuinely live, rotation from the RECORDED
 * course, and a short glide between two recorded fixes.
 *
 * THE LINE THAT MUST NOT BE CROSSED. `tracking_position` stays the authority.
 * The two endpoints of every glide are two recorded rows; no frame is persisted,
 * transmitted or offered as history; no course is derived from coordinates; and
 * an absent reading never becomes zero. The measured road data is why the last
 * point matters: only 4 of 12 fixes carried a heading, because Android reports
 * none while stationary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MARKER_EASE_MS,
  MARKER_SNAP_ABOVE_METERS,
  easeInOutQuad,
  frameAt,
  recordedHeading,
  rotationFor,
  shouldEase,
} from "@/lib/tracking/marker-motion";
import { MAP_LEGEND_FR } from "@/lib/tracking/live-model";
import { LIVE_REFRESH_MS } from "@/components/transport/live-refresh";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const mapRaw = read("components/transport/live-map.tsx");
const map = strip(mapRaw);
const motion = strip(read("lib/tracking/marker-motion.ts"));

const A = { lat: 14.7, lng: -17.45 };

describe("06B — heading comes from the device, or not at all", () => {
  it("01 — a recorded heading is consumed", () => {
    expect(recordedHeading(329)).toBe(329);
    expect(rotationFor(329, null)).toEqual({ degrees: 329, fromCurrentFix: true });
  });

  it("02 — ⚠ an absent heading NEVER becomes 0° / north", () => {
    expect(recordedHeading(null)).toBeNull();
    expect(recordedHeading(undefined)).toBeNull();
    // With nothing ever recorded, there is no orientation claim at all.
    expect(rotationFor(null, null)).toEqual({ degrees: null, fromCurrentFix: false });
    expect(rotationFor(undefined, null).degrees).not.toBe(0);
  });

  it("03 — absence holds the last course the DEVICE reported, and says so", () => {
    // The smallest truthful answer: the vehicle has not turned to face north, it
    // has stopped reporting. `fromCurrentFix:false` lets the label admit that.
    const r = rotationFor(null, 139);
    expect(r).toEqual({ degrees: 139, fromCurrentFix: false });
  });

  it("04 — a genuine 0° is a real course and survives", () => {
    expect(recordedHeading(0)).toBe(0);
    expect(rotationFor(0, 200)).toEqual({ degrees: 0, fromCurrentFix: true });
  });

  it("05 — nonsense is unknown, not clamped into a direction", () => {
    for (const bad of [Number.NaN, Infinity, -1, 360, 999]) {
      expect(recordedHeading(bad), String(bad)).toBeNull();
    }
  });

  it("06 — ⚠ NO heading is derived from coordinates anywhere in this slice", () => {
    // Anchored on DERIVATION, not on the word "bearing": the map legitimately
    // sets `bearing` on the MapLibre CAMERA (SENEGAL_VIEW.bearing), which is the
    // operator's viewpoint and has nothing to do with a vehicle's course. A
    // blanket ban would have failed for the wrong reason and taught nothing.
    for (const forbidden of [
      "atan2",
      "computeHeading",
      "courseBetween",
      "bearingBetween",
      "bearingFrom",
      "headingFrom",
      "snapToRoad",
    ]) {
      expect(motion.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
      expect(map.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The only heading the map may rotate by is one that arrived on the fix.
    expect(map).toContain("rotationFor(p.headingDegrees");
  });

  it("07 — the map rotates ONLY from a current recorded fix", () => {
    expect(map).toContain("rotationFor(p.headingDegrees, entry?.heading ?? null)");
    expect(map).toContain("if (rotation.fromCurrentFix && rotation.degrees !== null)");
    expect(map).toContain("entry.marker.setRotation(rotation.degrees)");
  });
});

describe("06B — the transition is presentation, and lands on the fact", () => {
  it("08 — a glide ends EXACTLY on the recorded point", () => {
    const B = { lat: 14.75, lng: -17.4 };
    expect(frameAt(A, B, 1)).toEqual(B);
    expect(frameAt(A, B, 1.5)).toEqual(B);
    expect(frameAt(A, B, 0)).toEqual(A);
  });

  it("09 — intermediate frames lie between the two recorded fixes, and nowhere else", () => {
    const B = { lat: 14.75, lng: -17.4 };
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const f = frameAt(A, B, t);
      expect(f.lat).toBeGreaterThan(A.lat);
      expect(f.lat).toBeLessThan(B.lat);
      expect(f.lng).toBeGreaterThan(A.lng);
      expect(f.lng).toBeLessThan(B.lng);
    }
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
  });

  it("10 — a gap too large to have been observed SNAPS; it is not animated", () => {
    const near = { lat: 14.705, lng: -17.45 }; // ~550 m
    const far = { lat: 15.7, lng: -17.45 }; // ~111 km
    expect(shouldEase(A, near)).toBe(true);
    expect(shouldEase(A, far)).toBe(false);
    expect(MARKER_SNAP_ABOVE_METERS).toBeGreaterThan(250); // the persistence threshold
  });

  it("11 — first appearance is placed, never flown in; and reduced motion is honoured", () => {
    expect(shouldEase(null, A)).toBe(false);
    expect(shouldEase(A, { lat: 14.705, lng: -17.45 }, { reducedMotion: true })).toBe(false);
    expect(shouldEase(A, A)).toBe(false); // nothing moved
    expect(map).toContain("prefersReducedMotion()");
  });

  it("12 — the glide is far shorter than the refresh cadence, so nothing races", () => {
    expect(MARKER_EASE_MS).toBeLessThan(LIVE_REFRESH_MS / 5);
    expect(LIVE_REFRESH_MS).toBe(30_000); // cadence NOT changed by 06B
  });

  it("13 — a new fix is told from a re-render of the same one", () => {
    // Without this the marker would re-glide from scratch every 30 s refresh.
    expect(map).toContain("if (p.at === entry.fixAt) continue;");
  });
});

describe("06B — nothing becomes data", () => {
  it("14 — no write, no API call, no persistence from the map or the motion rules", () => {
    // `.delete(` is deliberately NOT banned on the map: the marker registry is a
    // JS `Map` and `reg.delete(id)` drops a departed mission's marker. Banning it
    // outright would forbid correct cleanup while catching no database write.
    // What is banned is anything that could reach a table or the network.
    for (const w of [".insert(", ".update(", ".upsert(", ".rpc(", "fetch(", "sendBeacon", "XMLHttpRequest"]) {
      expect(map, `map must not ${w}`).not.toContain(w);
      expect(motion, `motion rules must not ${w}`).not.toContain(w);
    }
    // No client, no table, no server action reachable from either module.
    for (const reach of ["supabase", "getAdminSupabaseClient", 'from("', "server-only", "use server"]) {
      expect(map.toLowerCase(), `map must not reach ${reach}`).not.toContain(reach.toLowerCase());
      expect(motion.toLowerCase(), `motion must not reach ${reach}`).not.toContain(reach.toLowerCase());
    }
  });

  it("15 — the motion module is PURE: no DOM, no map, no server", () => {
    expect(motion).not.toContain("document.");
    expect(motion).not.toContain("maplibregl");
    expect(motion).not.toContain("server-only");
  });

  it("16 — no synthetic position row shape is constructed anywhere", () => {
    for (const shape of ["tracking_position", "idempotencyKey", "recorded_at:", "trackingSessionId"]) {
      expect(map, shape).not.toContain(shape);
      expect(motion, shape).not.toContain(shape);
    }
  });

  it("17 — the ratified no-interpolation statement still stands in the source", () => {
    // The route remains raw recorded fixes; the glide is a marker effect, and the
    // code may not even NAME interpolation (tms-2d bans it in stripped source).
    expect(mapRaw).toContain("No interpolation,");
    for (const banned of ["interpolat", "snapToRoad", "directions", "getRoute("]) {
      expect(map.toLowerCase(), banned).not.toContain(banned.toLowerCase());
    }
    expect(map).toContain("(route ?? []).map((p) => [p.lng, p.lat])");
  });
});

describe("06B — the vehicle, and the states that must survive it", () => {
  it("18 — the live mission is a VEHICLE, not the old plain dot", () => {
    expect(map).toContain("CAR_GLYPH");
    expect(mapRaw).toContain("<svg");
    // The old marker was a bare 20px coloured div with no glyph inside.
    expect(map).not.toContain("height:20px;width:20px;border-radius:");
  });

  it("19 — a restrained green halo marks live, and ONLY live", () => {
    expect(map).toContain('const glow = m.health === "live"');
    // stale/offline must not glow: a truck nobody has heard from cannot look healthy.
    expect(map).toContain('m.health === "live" ? ",0 0 0 7px rgba(16,185,129,.28)" : ""');
  });

  it("20 — health rings and wording are untouched: stale amber, offline red", () => {
    expect(map).toContain('stale: "#f59e0b"');
    expect(map).toContain('offline: "#dc2626"');
    expect(map).toContain('stale: "Signal ancien"');
    expect(map).toContain('offline: "Signal perdu"');
    // Health is still computed elsewhere from the session and the fix's age.
    expect(map).not.toContain("speedKph >");
  });

  it("21 — shape still distinguishes the return leg, and the label still speaks", () => {
    expect(map).toContain('const square = m.leg === "RETURN";');
    expect(map).toContain('el.setAttribute("role", "img")');
    expect(map).toContain("aria-label");
    // The orientation is described in words too, including when it is unknown.
    expect(map).toContain('"cap inconnu"');
    expect(map).toContain("dernier cap connu");
  });

  it("22 — the legend still names the four ruled states, and says 'véhicule'", () => {
    const labels = MAP_LEGEND_FR.map((l) => l.labelFr);
    for (const s of ["En livraison", "En retour", "Signal ancien", "Signal perdu"]) {
      expect(labels, s).toContain(s);
    }
    const shapes = MAP_LEGEND_FR.map((l) => l.shape);
    expect(new Set(shapes).size).toBeGreaterThan(1);
    expect(shapes.some((s) => s.includes("véhicule"))).toBe(true);
  });

  it("23 — markers persist across refreshes instead of being rebuilt", () => {
    // The teleport's real cause: remove-all / recreate-all on every refresh.
    expect(map).not.toContain("markersRef.current.forEach((mk) => mk.remove());\n    markersRef.current = located.map");
    expect(map).toContain("const reg = markersRef.current;");
    expect(map).toContain("reg.get(m.transportId)");
    expect(map).toContain("cancelAnimationFrame");
  });

  it("24 — 06A's optional readings stay optional where surfaced", () => {
    // Speed and accuracy are shown only when the device reported them; `line()`
    // omits a null, so absence is never rendered as 0 km/h or perfect accuracy.
    expect(map).toContain("m.lastPosition?.speedKph != null");
    expect(map).toContain("m.lastPosition?.accuracyMeters != null");
    expect(map).toContain('line("Vitesse relevée", speed)');
    expect(map).toContain('line("Précision", accuracy)');
    expect(map).toContain("value ? `<div>");
  });
});
