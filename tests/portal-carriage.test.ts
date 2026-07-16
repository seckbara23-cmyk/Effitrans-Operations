/**
 * Phase 7.5A — portal ocean/air carriage view. The read is server-only (RLS + admin clients),
 * so it is verified structurally: it enforces ownership via the RLS user-context client, REUSES
 * the shared map + position engines (no duplicate map logic), exposes only customer-safe fields,
 * and the additive migration adds portal RLS with no new permission/table. The shared map
 * projection's warning/marker behaviour is also exercised directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("shared map projection is reused for the portal (not re-implemented)", () => {
  it("emits a warning + no current marker when there is no mappable position", () => {
    const p = buildShipmentMapProjection({ milestoneMarkers: [] });
    expect(p.currentPosition).toBeUndefined();
    expect(p.warnings.some((w) => /position/i.test(w))).toBe(true);
    expect(p.bounds).toBeUndefined();
  });
  it("places a current marker + bounds when a confirmed position is provided", () => {
    const p = buildShipmentMapProjection({
      current: { available: true, latitude: 14.67, longitude: -17.43, source: "CARRIER", confidence: "CONFIRMED", freshness: "LIVE", occurredAt: "2026-07-17T00:00:00Z", locationLabel: "Dakar", explanation: "test" },
      milestoneMarkers: [{ milestone: "VESSEL_ARRIVED" as never, latitude: 14.7, longitude: -17.4, occurredAt: "2026-07-16T00:00:00Z" }],
    });
    expect(p.currentPosition?.kind).toBe("current");
    expect(p.milestones).toHaveLength(1);
    expect(p.bounds).toBeDefined();
  });
});

describe("carriage read: server-only, RLS-owned, reuses engines, customer-safe", () => {
  const src = code("../lib/portal/carriage.ts");
  it("is server-only and proves ownership via the RLS user-context client", () => {
    expect(read("../lib/portal/carriage.ts")).toContain('import "server-only"');
    expect(src).toContain("getCurrentPortalUser(");
    expect(src).toContain("getServerSupabaseClient(");     // RLS ownership boundary
    expect(src).toContain('.eq("file_id", fileId)');
  });
  it("reuses the shared map + position engines instead of duplicating map logic", () => {
    expect(src).toContain("buildShipmentMapProjection(");
    expect(src).toContain("resolveCurrentPosition(");
    expect(src).toContain("resolveAirPosition(");
    expect(src).not.toMatch(/buildMapPoints|map-points/); // not the legacy portal map
  });
  it("projects only customer-safe fields (no internal ids / provider refs / staff identity)", () => {
    // The select lists must not pull internal-only columns into the portal surface.
    expect(src).not.toMatch(/provider_code|created_by|fingerprint|review_note|account_manager/);
    expect(src).toContain("references");
    expect(src).toContain("hasGeo");
  });
});

describe("migration is additive and the page consolidates onto the shared map", () => {
  it("adds portal_can_read_shipment + portal SELECT policies; no new table/permission/grant", () => {
    const mig = read("../supabase/migrations/20260717000001_portal_ocean_air_visibility.sql");
    expect(mig).toContain("function public.portal_can_read_shipment");
    expect(mig).toContain("ocean_container_portal_select");
    expect(mig).toContain("air_awb_portal_select");
    expect(mig).toMatch(/cu\.status = 'ACTIVE'/);
    expect(mig).not.toMatch(/create table/i);
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).not.toMatch(/create policy .*for (insert|update|delete)/i); // read-only
  });
  it("the tracking page renders the SHARED map loader (with a road/no-geo fallback)", () => {
    const page = read("../app/portal/(app)/files/[id]/page.tsx");
    expect(page).toContain("ShipmentMapLoader");
    expect(page).toContain("getPortalCarriage");
    expect(page).toContain("CarriagePanel");
    expect(page).toContain("carriage?.hasGeo"); // shared map when geo available, fallback otherwise
  });
});
