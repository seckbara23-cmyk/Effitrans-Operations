/**
 * Phase 7.2B — Shipping operations: management validation, tracking studio, actions,
 * services, Leaflet map, console. Pure logic exercised directly; server-only + client
 * modules verified structurally (no-jsdom). No live carrier/AIS is claimed.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isSafeUrl, validateVoyageChronology, validateRoute, normalizeReference, isValidPortUnlocode } from "@/lib/shipping/intelligence/manage-validate";
import { previewManualEvent } from "@/lib/shipping/intelligence/studio";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NOW = "2026-07-16T12:00:00Z";

// ---------------------------------------------------------------- management validation ----
describe("management validation (pure)", () => {
  it("safe URL: http/https only", () => {
    expect(isSafeUrl("https://maersk.com")).toBe(true);
    expect(isSafeUrl("http://x.io")).toBe(true);
    expect(isSafeUrl("")).toBe(true);
    expect(isSafeUrl(null)).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("ftp://x")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
  it("voyage chronology: arrival cannot precede departure unless corrected", () => {
    expect(validateVoyageChronology({ plannedDeparture: "2026-07-10", plannedArrival: "2026-07-20" }).ok).toBe(true);
    expect(validateVoyageChronology({ plannedDeparture: "2026-07-20", plannedArrival: "2026-07-10" })).toMatchObject({ ok: false, reason: "planned_arrival_before_departure" });
    expect(validateVoyageChronology({ actualDeparture: "2026-07-20", actualArrival: "2026-07-10" })).toMatchObject({ ok: false, reason: "actual_arrival_before_departure" });
    expect(validateVoyageChronology({ plannedDeparture: "2026-07-20", plannedArrival: "2026-07-10" }, true).ok).toBe(true); // correction allowed
  });
  it("route: duplicate sequence fails; disconnected legs are warned not blocked", () => {
    expect(validateRoute([{ sequence: 1, originPortId: "A", destinationPortId: "B" }, { sequence: 1, originPortId: "B", destinationPortId: "C" }]).duplicateSequence).toBe(true);
    const disc = validateRoute([{ sequence: 1, originPortId: "A", destinationPortId: "B" }, { sequence: 2, originPortId: "X", destinationPortId: "C" }]);
    expect(disc.ok).toBe(true); // discontinuity is a warning, not an error
    expect(disc.discontinuities).toEqual([1]);
    const cont = validateRoute([{ sequence: 1, originPortId: "A", destinationPortId: "B" }, { sequence: 2, originPortId: "B", destinationPortId: "C" }]);
    expect(cont.discontinuities).toEqual([]);
  });
  it("references + UN/LOCODE", () => {
    expect(normalizeReference("  BK-123  ")).toBe("BK-123");
    expect(normalizeReference("")).toBeNull();
    expect(isValidPortUnlocode("SNDKR")).toBe(true);
    expect(isValidPortUnlocode("")).toBe(true); // empty allowed (unmapped)
    expect(isValidPortUnlocode("BAD1")).toBe(false);
  });
});

// ---------------------------------------------------------------- studio preview ----
describe("manual tracking studio preview (reuses milestone classifier)", () => {
  it("advance / regression-requires-confirmation / exception / terminal", () => {
    expect(previewManualEvent("LOADED", "VESSEL_DEPARTED", NOW, null)).toMatchObject({ kind: "advance", ok: true, requiresConfirmation: false });
    expect(previewManualEvent("DISCHARGED", "VESSEL_ARRIVED", NOW, null)).toMatchObject({ kind: "regress", ok: true, requiresConfirmation: true });
    expect(previewManualEvent("IN_TRANSIT", "EXCEPTION", NOW, null)).toMatchObject({ kind: "exception", ok: true });
    expect(previewManualEvent("COMPLETED", "LOADED", NOW, null)).toMatchObject({ kind: "invalid", ok: false, reason: "terminal" });
    expect(previewManualEvent("IN_TRANSIT", "COMPLETED", NOW, null)).toMatchObject({ ok: false, reason: "complete_requires_delivery" });
  });
  it("position / eta events never change the milestone; unknown is invalid", () => {
    expect(previewManualEvent("IN_TRANSIT", "POSITION_UPDATE", NOW, null).kind).toBe("position");
    expect(previewManualEvent("IN_TRANSIT", "ETA_UPDATE", NOW, null).kind).toBe("eta");
    expect(previewManualEvent("IN_TRANSIT", "NONSENSE", NOW, null)).toMatchObject({ kind: "invalid", ok: false });
  });
  it("flags an out-of-order timestamp", () => {
    expect(previewManualEvent("LOADED", "VESSEL_DEPARTED", "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z").outOfOrder).toBe(true);
    expect(previewManualEvent("LOADED", "VESSEL_DEPARTED", "2026-07-11T00:00:00Z", "2026-07-10T00:00:00Z").outOfOrder).toBe(false);
  });
});

// ---------------------------------------------------------------- management actions (structural) ----
describe("management actions enforce the safety invariants", () => {
  const src = code("../lib/shipping/intelligence/manage-actions.ts");
  it("server module; tenant+actor from session; reference mgmt on transport:manage, edits on transport:update", () => {
    expect(read("../lib/shipping/intelligence/manage-actions.ts")).toContain('"use server"');
    expect(src).toContain("assertPermission");
    expect(src).toContain('"transport:manage"');
    expect(src).toContain('"transport:update"');
    expect(src).not.toMatch(/shipping:[a-z]+|vessel:[a-z]+|carrier:[a-z]+/);
  });
  it("verifies every relationship id belongs to the tenant (no cross-tenant injection)", () => {
    expect(src).toContain("inTenant(");
    expect(src).toContain('.eq("tenant_id", user.tenantId)');
  });
  it("validates URL / UN/LOCODE / coordinate / ISO 6346 / IMO / MMSI / chronology", () => {
    for (const v of ["isSafeUrl", "isValidPortUnlocode", "isValidCoordinate", "normalizeContainerNumber", "isValidIMO", "isValidMMSI", "validateVoyageChronology"]) expect(src).toContain(v);
  });
  it("reassignment requires confirmation, rejects conflict, and NEVER deletes tracking history", () => {
    expect(src).toContain("confirmation_required");
    expect(src).toContain("conflict_on_target");
    expect(src).not.toMatch(/from\("ocean_tracking_event"\)[\s\S]*?\.delete\(/);
  });
  it("no destructive delete of reference data (retire via active=false)", () => {
    expect(src).not.toMatch(/from\("ocean_carrier"\)\.delete/);
    expect(src).not.toMatch(/from\("ocean_port"\)\.delete/);
    expect(src).not.toMatch(/from\("ocean_vessel"\)\.delete/);
  });
  it("audit carries no coordinates", () => {
    expect(src).not.toMatch(/after:\s*\{[^}]*latitude/);
  });
});

// ---------------------------------------------------------------- management service (structural) ----
describe("management reads are scoped, paginated, provider-free", () => {
  const src = code("../lib/shipping/intelligence/manage-service.ts");
  it("server-only, transport:read gate, tenant-filtered, SQL-paginated", () => {
    expect(src).toContain('import "server-only"');
    expect(src).toContain('assertPermission("transport:read")');
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain(".range(from, from + size)");
  });
  it("no provider call; reuses pure alert contracts", () => {
    expect(src).not.toContain("ShippingEngine");
    expect(src).not.toContain(".refreshTracking(");
    expect(src).toContain("deriveShipmentAlerts(");
  });
});

// ---------------------------------------------------------------- Leaflet map (structural) ----
describe("Leaflet is only a renderer over the projection", () => {
  it("the map component consumes ShipmentMapProjection and holds NO domain logic", () => {
    const map = read("../components/shipping/shipment-map.tsx");
    expect(map).toContain('"use client"');
    expect(map).toContain("ShipmentMapProjection");
    expect(map).not.toContain("resolveCurrentPosition");
    expect(map).not.toContain("classifyMilestone");
    expect(map).not.toContain("getOceanShipmentDetail");
    expect(map).not.toContain("getAdminSupabaseClient");
  });
  it("defaults to OSM via a public tile-url override — never an embedded key", () => {
    const map = read("../components/shipping/shipment-map.tsx");
    expect(map).toContain("NEXT_PUBLIC_MAP_TILE_URL");
    expect(map).toContain("openstreetmap.org");
    expect(map).not.toMatch(/access_token|apiKey|api_key/i);
  });
  it("map popups expose only safe operational fields (no ids/PII)", () => {
    const map = read("../components/shipping/shipment-map.tsx");
    expect(map).not.toMatch(/m\.(id|shipmentId|containerId|tenantId)/);
  });
  it("the map is lazy-loaded (Leaflet stays off server + non-map pages)", () => {
    const loader = read("../components/shipping/shipment-map-loader.tsx");
    expect(loader).toContain("dynamic(");
    expect(loader).toContain("ssr: false");
  });
  it("NO pure domain module imports a mapping library", () => {
    for (const f of ["map-projection", "position", "milestones", "events", "eta", "freshness", "dashboard", "alerts"]) {
      expect(read(`../lib/shipping/intelligence/${f}.ts`)).not.toMatch(/from "leaflet"|react-leaflet/);
    }
  });
});

// ---------------------------------------------------------------- studio + detail + client safety ----
describe("studio + detail + client bundle safety", () => {
  it("the studio uses the pure preview and requires confirmation for corrections", () => {
    const s = read("../components/shipping/tracking-studio.tsx");
    expect(s).toContain('"use client"');
    expect(s).toContain("previewManualEvent(");
    expect(s).toContain("confirmCorrection");
  });
  it("the detail page links customs (read-only) and reuses the existing document system", () => {
    const p = read("../app/shipping/shipments/[shipmentId]/page.tsx");
    expect(p).toContain("listDocuments(");
    expect(p).toContain("/customs/intelligence");
    expect(p).toContain("ShipmentMapLoader");
  });
  it("client components ship no service role / secret", () => {
    for (const f of ["../components/shipping/management-forms.tsx", "../components/shipping/tracking-studio.tsx", "../components/shipping/shipment-ops-panel.tsx", "../components/shipping/shipment-map.tsx"]) {
      const src = read(f).toLowerCase();
      for (const secret of ["service_role", "getadminsupabaseclient", "supabase_service"]) expect(src, `${f}::${secret}`).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------- boundary + regression ----
describe("7.2B stays an honest internal increment", () => {
  it("the migration is additive (active/notes), no new table/permission/grant", () => {
    const mig = read("../supabase/migrations/20260716000005_shipping_operations.sql");
    expect(mig).toContain("add column if not exists active");
    expect(mig).not.toMatch(/create table/i);
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).not.toMatch(/create policy/i);
  });
  it("no live carrier/AIS call is introduced (no fetch/axios in shipping lib)", () => {
    for (const f of ["manage-actions", "manage-service", "actions", "service"]) {
      expect(read(`../lib/shipping/intelligence/${f}.ts`)).not.toMatch(/\bfetch\(|axios|https?:\/\/[a-z]/i);
    }
  });
  it("still NO public tracking route", () => {
    for (const p of ["../app/track", "../app/public/track", "../app/t"]) expect(existsSync(fileURLToPath(new URL(p, import.meta.url)))).toBe(false);
  });
  it("the shipping RLS test proves reference-table isolation too", () => {
    const t = read("../supabase/tests/rls_shipping_test.sql");
    expect(t).toContain("ocean_carrier");
  });
});
