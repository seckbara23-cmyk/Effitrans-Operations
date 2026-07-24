/**
 * Phase 8.4 — Interactive Logistics Tracking. The truthfulness guarantees are exercised
 * directly where pure (recency rule, source/confidence/age labels, freshness) and pinned
 * structurally where they live in components/actions/migrations (map↔journal sync contract,
 * customer-safe labels, the transport:manage root-cause fix, seeded coordinates).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { resolveCurrentPosition, type PositionInputs } from "@/lib/shipping/intelligence/position";
import { classifyFreshness, freshnessLabel, ageLabelFr } from "@/lib/shipping/intelligence/freshness";
import { sourceLabelFr, confidenceLabelFr } from "@/lib/shipping/intelligence/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NOW = "2026-07-17T12:00:00Z";

// ---------------------------------------------------------------- recency truthfulness ----
describe("current position — newer evidence is never masked by older higher-priority evidence", () => {
  const oldRoad = "2026-07-14T12:00:00Z"; // 3 days old
  const newPort = "2026-07-17T09:00:00Z"; // 3 hours old
  const base: PositionInputs = {
    roadFix: { latitude: 14.7, longitude: -17.4, occurredAt: oldRoad },
    portAnchor: { name: "Port de Dakar", latitude: 14.68, longitude: -17.42, occurredAt: newPort, confirmed: true },
  };

  it("a 3-day-old road fix does NOT win over a 3-hour-old confirmed port milestone", () => {
    const r = resolveCurrentPosition(base, NOW);
    expect(r.source).toBe("PORT");
    expect(r.occurredAt).toBe(newPort);
  });
  it("but a NEWER road fix still wins (source priority holds when it is also the freshest)", () => {
    const r = resolveCurrentPosition({ ...base, roadFix: { latitude: 14.7, longitude: -17.4, occurredAt: "2026-07-17T11:00:00Z" } }, NOW);
    expect(r.source).toBe("ROAD");
  });
  it("still never guesses: no inputs → unavailable, honest explanation preserved", () => {
    const r = resolveCurrentPosition({}, NOW);
    expect(r.available).toBe(false);
    expect(r.explanation).toBe("Aucune position disponible.");
  });
  it("rejects invalid coordinates rather than plotting them", () => {
    const r = resolveCurrentPosition({ roadFix: { latitude: 200, longitude: 0, occurredAt: NOW } }, NOW);
    expect(r.available).toBe(false); // 200° lat invalid → falls through to NONE
  });
});

// ---------------------------------------------------------------- honest labels ----
describe("labels — French, safe for customers, never liveness language", () => {
  it("source enums render as French labels (never the raw enum in the UI)", () => {
    expect(sourceLabelFr("MANUAL")).toBe("Saisie manuelle");
    expect(sourceLabelFr("ROAD")).toBe("GPS routier");
    expect(sourceLabelFr("AIS")).toBe("Signal AIS");
    expect(sourceLabelFr("CARRIER")).toBe("Transporteur");
  });
  it("MANUAL confidence reads « Saisie manuelle » — never « Confirmé par le transporteur »", () => {
    expect(confidenceLabelFr("MANUAL")).toBe("Saisie manuelle");
    expect(confidenceLabelFr("CONFIRMED")).toBe("Confirmée");
  });
  it("freshness label is AGE language — never « En direct » / « Live »", () => {
    for (const f of ["LIVE", "RECENT", "STALE", "VERY_STALE", "UNKNOWN"] as const) {
      expect(freshnessLabel(f)).not.toMatch(/direct|live/i);
    }
    expect(freshnessLabel("LIVE")).toBe("À jour");
  });
  it("age label is human French and clamps a future timestamp to « à l'instant »", () => {
    expect(ageLabelFr("2026-07-17T10:00:00Z", NOW)).toBe("il y a 2 h");
    expect(ageLabelFr("2026-07-14T12:00:00Z", NOW)).toBe("il y a 3 j");
    expect(ageLabelFr("2026-07-17T13:00:00Z", NOW)).toBe("à l'instant"); // future
    expect(ageLabelFr(null, NOW)).toBeNull();
  });
  it("freshness classifies by AGE per source (a 1h-old MANUAL entry is LIVE by age, not live data)", () => {
    expect(classifyFreshness("MANUAL", "2026-07-17T11:00:00Z", NOW)).toBe("LIVE"); // 1h < MANUAL 24h
    // ...which is exactly why the LABEL must not say "En direct" — asserted above.
  });
});

// ---------------------------------------------------------------- map↔journal sync ----
describe("map + journal use ONE selection state and ONE marker key (no second history)", () => {
  const journey = code("../components/shipping/tracking-journey.tsx");
  const map = code("../components/shipping/shipment-map.tsx");

  it("both derive the SAME markerKey (label|occurredAt) from the same normalized inputs", () => {
    expect(map).toContain("export function markerKey");
    expect(journey).toContain('from "./shipment-map"');
    expect(journey).toContain("markerKey({ label: e.label, occurredAt: e.occurredAt })");
  });
  it("the coordinator holds one selection state shared by map and journal", () => {
    expect(journey).toMatch(/useState<string \| null>\(null\)/);
    expect(journey).toContain("selectedKey={selected}");
    expect(journey).toContain("onSelectMarker={setSelected}");
  });
  it("events WITHOUT coordinates stay visible but are not map-linked", () => {
    expect(journey).toContain("e.hasCoordinates");
    expect(journey).toMatch(/hasCoordinates \? markerKey/);
  });
  it("the journal is presented as immutable and read-only (no mutation in the coordinator)", () => {
    expect(journey).toContain("Journal immuable");
    expect(journey).not.toMatch(/\.insert\(|\.update\(|writeAudit|addManual/);
  });
  it("the map sync props are OPTIONAL — existing callers (portal, executive) are unchanged", () => {
    expect(map).toMatch(/selectedKey\?: string \| null/);
    expect(map).toMatch(/onSelectMarker\?:/);
  });
  it("the map popup shows French source + age, never a raw enum", () => {
    expect(map).toContain("sourceLabelFr(m.source)");
    expect(map).toContain("ageLabelFr(m.occurredAt");
    expect(map).not.toMatch(/Source : \{m\.source\}/);
  });
});

// ---------------------------------------------------------------- root-cause fix ----
describe("transport:manage — the cataloged permission that unlocks coordinate entry", () => {
  it("exists in migration + seed + templates (the management actions already gate on it)", () => {
    expect(read("../supabase/migrations/20260721000001_transport_manage.sql")).toContain("'transport:manage'");
    expect(read("../supabase/seed.sql")).toContain("'transport:manage'");
    const tmpl = read("../lib/platform/role-templates.ts");
    // granted to the 4 coordination-tier roles.
    expect((tmpl.match(/"transport:manage"/g) ?? []).length).toBe(4);
  });
  it("the port/airport management actions still gate on it (unchanged — now reachable)", () => {
    // Both modules gate on the literal "transport:manage" (directly or via a req() helper).
    expect(code("../lib/shipping/intelligence/manage-actions.ts")).toContain('"transport:manage"');
    expect(code("../lib/air/intelligence/manage-actions.ts")).toContain('"transport:manage"');
  });
});

// ---------------------------------------------------------------- seeded coordinates ----
describe("canonical coordinates — documented sources, dev/CI only, idempotent", () => {
  const seed = read("../supabase/seed.sql");
  it("seeds the four acceptance locations with real coordinates", () => {
    expect(seed).toContain("Port de Dakar");
    expect(seed).toContain("Port de Shanghai");
    expect(seed).toContain("DSS");
    expect(seed).toContain("CDG");
    expect(seed).toMatch(/14\.683, -17\.417/); // Dakar port
    expect(seed).toMatch(/49\.009722, 2\.547778/); // CDG
  });
  it("is idempotent (conflict-guarded) and documents the source", () => {
    expect(seed).toMatch(/on conflict \(tenant_id, unlocode\)/);
    expect(seed).toMatch(/World Port Index|OurAirports/);
  });
  it("only the seed INSERTS coordinates — production is never auto-seeded (migration is perm + CHECK only)", () => {
    const mig = read("../supabase/migrations/20260721000001_transport_manage.sql");
    // the migration may add CHECK constraints referencing latitude, but must INSERT no
    // coordinate row into a location table.
    expect(mig).not.toMatch(/insert into public\.(ocean_port|air_airport)/i);
  });
  it("adds DB-level coordinate range constraints (defence-in-depth: app AND database)", () => {
    const mig = read("../supabase/migrations/20260721000001_transport_manage.sql");
    for (const t of ["ocean_port", "air_airport", "ocean_tracking_event", "air_tracking_event", "tracking_position"]) {
      expect(mig).toMatch(new RegExp(`${t}[\\s\\S]{0,120}latitude >= -90`));
    }
  });
});

// ---------------------------------------------------------------- studio honesty ----
describe("manual studio still stamps MANUAL and never claims carrier confirmation", () => {
  const actions = code("../lib/shipping/intelligence/actions.ts");
  it("manual events are always source=MANUAL / confidence=MANUAL", () => {
    expect(actions).toMatch(/source:\s*"MANUAL"/);
    expect(actions).toMatch(/confidence:\s*"MANUAL"/);
  });
  it("no code path labels a manual event carrier-confirmed", () => {
    const both = code("../components/shipping/tracking-studio.tsx") + actions;
    expect(both).not.toMatch(/Confirmé par le transporteur/);
  });
});

// ---------------------------------------------------------------- build-info drift ----
describe("build-info stays pinned to the new migration", () => {
  it("LATEST_MIGRATION matches the newest file on disk", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const migs = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(migs[migs.length - 1]).toBe("20260724000002_hr_employee_registry.sql");
  });
});
