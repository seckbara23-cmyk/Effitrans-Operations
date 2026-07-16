/**
 * Phase 7.2A — Shipping Line Platform foundation. Pure logic exercised directly; server-only
 * modules (service, actions, customs-link) and the console verified structurally (no-jsdom
 * convention). No live carrier/AIS integration is claimed — the boundary is tested honestly.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isValidContainerNumber, isValidIMO, isValidMMSI, isValidUnlocode, isValidCoordinate, normalizeContainerNumber } from "@/lib/shipping/intelligence/validators";
import { SHIPPING_MILESTONES, classifyMilestone, isTerminalMilestone, milestoneProgress, MILESTONE_CATEGORY } from "@/lib/shipping/intelligence/milestones";
import { normalizeTrackingEvent, eventFingerprint, dedupeEvents, sortEvents, latestMilestoneEvent, isCanonicalEvent, type ShippingTrackingEvent } from "@/lib/shipping/intelligence/events";
import { classifyFreshness, isStaleFreshness } from "@/lib/shipping/intelligence/freshness";
import { resolveCurrentPosition } from "@/lib/shipping/intelligence/position";
import { applyEta, detectEtaChange, defaultEtaConfidence, isCarrierConfirmedEta } from "@/lib/shipping/intelligence/eta";
import { buildShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";
import { buildShippingDashboard, type DashboardShipmentRow } from "@/lib/shipping/intelligence/dashboard";
import { deriveShipmentAlerts } from "@/lib/shipping/intelligence/alerts";
import { ManualShippingProvider, CarrierStubProvider, AisStubProvider, ShippingEngine, resolveShippingProvider, SHIPPING_PROVIDERS, type ShippingProvider, type VesselPositionProvider } from "@/lib/shipping/intelligence/provider";
import { mapCarrierStatus, CARRIER_STATUS_MAPS } from "@/lib/shipping/intelligence/status-map";
import { deriveShippingProviderConfig, deriveAisConfig, CARRIER_READINESS_CHECKLIST } from "@/lib/shipping/intelligence/config";
import { rowToOceanShipment, rowToContainer } from "@/lib/shipping/intelligence/persistence";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NOW = "2026-07-16T12:00:00Z";

// ---------------------------------------------------------------- validators ----
describe("identifier validators (distinct types, total)", () => {
  it("ISO 6346 container numbers", () => {
    expect(isValidContainerNumber("CSQU3054383")).toBe(true);
    expect(isValidContainerNumber("CSQU3054384")).toBe(false); // wrong check digit
    expect(isValidContainerNumber("ABC1234567")).toBe(false); // 4th char not U/J/Z
    expect(normalizeContainerNumber("csqu 305438 3")).toBe("CSQU3054383");
  });
  it("IMO vs MMSI are different identifier types", () => {
    expect(isValidIMO("9074729")).toBe(true);
    expect(isValidIMO("IMO9074729")).toBe(true);
    expect(isValidIMO("9074728")).toBe(false);
    expect(isValidMMSI("227006760")).toBe(true);
    expect(isValidMMSI("9074729")).toBe(false); // 7 digits, not a valid MMSI
  });
  it("UN/LOCODE + coordinates", () => {
    expect(isValidUnlocode("SNDKR")).toBe(true);
    expect(isValidUnlocode("US")).toBe(false);
    expect(isValidCoordinate(14.68, -17.42)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false); // null island
    expect(isValidCoordinate(200, 0)).toBe(false);
    expect(isValidCoordinate(NaN, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------- milestones ----
describe("canonical ocean milestones (event-driven, not rigid)", () => {
  it("has the 20 canonical milestones with categories", () => {
    expect(SHIPPING_MILESTONES).toHaveLength(20);
    expect(MILESTONE_CATEGORY.VESSEL_DEPARTED).toBe("vessel");
    expect(MILESTONE_CATEGORY.CUSTOMS_RELEASED).toBe("customs");
    expect(MILESTONE_CATEGORY.DELIVERED).toBe("delivery");
  });
  it("classifies advance / regress(correction) / repeat", () => {
    expect(classifyMilestone("LOADED", "VESSEL_DEPARTED")).toEqual({ ok: true, kind: "advance" });
    expect(classifyMilestone("VESSEL_ARRIVED", "DISCHARGED")).toEqual({ ok: true, kind: "advance" });
    expect(classifyMilestone("DISCHARGED", "VESSEL_ARRIVED")).toEqual({ ok: true, kind: "regress" }); // carrier correction allowed
    expect(classifyMilestone("IN_TRANSIT", "IN_TRANSIT")).toEqual({ ok: true, kind: "repeat" });
  });
  it("exceptions/cancels reachable; terminal + complete-before-delivery rejected", () => {
    expect(classifyMilestone("IN_TRANSIT", "EXCEPTION")).toEqual({ ok: true, kind: "exception" });
    expect(classifyMilestone("EXCEPTION", "IN_TRANSIT")).toEqual({ ok: true, kind: "advance" }); // hold resolves
    expect(classifyMilestone("IN_TRANSIT", "CANCELLED")).toEqual({ ok: true, kind: "cancel" });
    expect(classifyMilestone("DELIVERED", "COMPLETED")).toEqual({ ok: true, kind: "complete" });
    expect(classifyMilestone("IN_TRANSIT", "COMPLETED")).toMatchObject({ ok: false, reason: "complete_requires_delivery" });
    expect(classifyMilestone("COMPLETED", "IN_TRANSIT")).toMatchObject({ ok: false, reason: "terminal" });
    expect(isTerminalMilestone("CANCELLED")).toBe(true);
    expect(milestoneProgress("EXCEPTION")).toBe(-1);
  });
});

// ---------------------------------------------------------------- events ----
describe("immutable tracking events (normalize / dedup / order)", () => {
  const base = { tenantId: "t", shipmentId: "s", source: "CARRIER" as const, providerCode: "maersk", confidence: "CONFIRMED" as const };
  it("normalizes with a deterministic fingerprint", () => {
    const e = normalizeTrackingEvent({ ...base, eventType: "VESSEL_DEPARTED", occurredAt: "2026-07-01T00:00:00Z", location: { unlocode: "SNDKR" } }, "id1", NOW);
    expect(e.receivedAt).toBe(NOW);
    expect(e.fingerprint).toBe(eventFingerprint({ shipmentId: "s", eventType: "VESSEL_DEPARTED", occurredAt: "2026-07-01T00:00:00Z", location: { unlocode: "SNDKR" } }));
    expect(isCanonicalEvent("VESSEL_DEPARTED")).toBe(true);
    expect(isCanonicalEvent("NONSENSE")).toBe(false);
  });
  it("dedupes by fingerprint and sorts by occurrence (out-of-order safe)", () => {
    const mk = (t: string, fp: string): ShippingTrackingEvent => ({ id: fp, tenantId: "t", shipmentId: "s", eventType: "IN_TRANSIT", occurredAt: t, receivedAt: t, source: "CARRIER", providerCode: "x", confidence: "CONFIRMED", fingerprint: fp });
    const evs = [mk("2026-07-03T00:00:00Z", "b"), mk("2026-07-01T00:00:00Z", "a"), mk("2026-07-01T00:00:00Z", "a")];
    expect(dedupeEvents(evs)).toHaveLength(2);
    expect(sortEvents(evs).map((e) => e.occurredAt)[0]).toBe("2026-07-01T00:00:00Z");
    expect(latestMilestoneEvent(dedupeEvents(evs))?.occurredAt).toBe("2026-07-03T00:00:00Z");
  });
});

// ---------------------------------------------------------------- freshness ----
describe("freshness is per-source and orthogonal to confidence", () => {
  it("an AIS fix ages faster than a carrier milestone", () => {
    const t = "2026-07-16T09:00:00Z"; // 3h old
    expect(classifyFreshness("AIS", t, NOW)).toBe("RECENT");
    expect(classifyFreshness("CARRIER", t, NOW)).toBe("LIVE");
    expect(classifyFreshness("ROAD", t, NOW)).toBe("STALE"); // 3h: past road RECENT(2h), within STALE(12h)
    expect(classifyFreshness("CARRIER", null, NOW)).toBe("UNKNOWN");
    expect(isStaleFreshness("STALE")).toBe(true);
    expect(isStaleFreshness("LIVE")).toBe(false);
  });
});

// ---------------------------------------------------------------- position ----
describe("current-position resolver (never guesses)", () => {
  it("road GPS wins when present", () => {
    const p = resolveCurrentPosition({ roadFix: { latitude: 14.7, longitude: -17.4, occurredAt: NOW } }, NOW);
    expect(p).toMatchObject({ available: true, source: "ROAD", confidence: "CONFIRMED" });
  });
  it("vessel AIS is used ONLY when the container is confirmed aboard (inferred)", () => {
    const vp = { latitude: 10, longitude: -20, occurredAt: NOW, receivedAt: NOW, sourceProvider: "ais-generic" };
    expect(resolveCurrentPosition({ containerConfirmedOnVessel: false, vesselPosition: vp }, NOW).available).toBe(false);
    const yes = resolveCurrentPosition({ containerConfirmedOnVessel: true, vesselPosition: vp }, NOW);
    expect(yes).toMatchObject({ available: true, source: "AIS", confidence: "INFERRED" });
  });
  it("port milestone fallback; no coordinates → not mappable but labelled; never guesses", () => {
    const withCoord = resolveCurrentPosition({ portAnchor: { name: "Dakar", latitude: 14.68, longitude: -17.42, occurredAt: NOW, confirmed: true } }, NOW);
    expect(withCoord).toMatchObject({ available: true, source: "PORT", confidence: "CONFIRMED" });
    const noCoord = resolveCurrentPosition({ portAnchor: { name: "Dakar", latitude: null, longitude: null, occurredAt: NOW, confirmed: false } }, NOW);
    expect(noCoord.available).toBe(false);
    expect(noCoord.locationLabel).toBe("Dakar");
    expect(resolveCurrentPosition({}, NOW).available).toBe(false);
  });
});

// ---------------------------------------------------------------- ETA ----
describe("ETA provenance + change detection (no predictor)", () => {
  it("preserves history and never labels a system estimate as carrier-confirmed", () => {
    const first = applyEta(null, { value: "2026-08-01T00:00:00Z", source: "CARRIER", calculatedAt: NOW });
    expect(first.confidence).toBe("HIGH");
    const next = applyEta(first, { value: "2026-08-05T00:00:00Z", source: "SYSTEM_ESTIMATE", calculatedAt: NOW });
    expect(next.previousValue).toBe("2026-08-01T00:00:00Z");
    expect(defaultEtaConfidence("SYSTEM_ESTIMATE")).toBe("LOW");
    expect(isCarrierConfirmedEta(next)).toBe(false);
    expect(isCarrierConfirmedEta(first)).toBe(true);
  });
  it("detects a significant ETA slip", () => {
    expect(detectEtaChange("2026-08-01T00:00:00Z", "2026-08-05T00:00:00Z").significant).toBe(true);
    expect(detectEtaChange("2026-08-01T00:00:00Z", "2026-08-01T06:00:00Z").significant).toBe(false);
    expect(detectEtaChange("2026-08-05T00:00:00Z", "2026-08-01T00:00:00Z").direction).toBe("earlier");
  });
});

// ---------------------------------------------------------------- map projection ----
describe("map projection is provider-neutral + warns on stale/inferred", () => {
  it("builds bounds, current marker, and warnings; imports no map library", () => {
    const proj = buildShipmentMapProjection({
      origin: { latitude: 14.7, longitude: -17.4 }, destination: { latitude: 51.9, longitude: 4.5 },
      current: { available: true, latitude: 30, longitude: -10, locationLabel: "x", source: "AIS", confidence: "INFERRED", occurredAt: NOW, freshness: "STALE", explanation: "" },
    });
    expect(proj.currentPosition).toMatchObject({ kind: "current", confidence: "INFERRED", freshness: "STALE" });
    expect(proj.bounds).toBeDefined();
    expect(proj.warnings.some((w) => w.includes("récente"))).toBe(true); // stale warning
    expect(proj.warnings.some((w) => w.includes("déduite"))).toBe(true); // inferred warning
    // Domain module must not bind a mapping library.
    expect(read("../lib/shipping/intelligence/map-projection.ts")).not.toMatch(/leaflet|mapbox|maplibre|google/i);
  });
});

// ---------------------------------------------------------------- dashboard + alerts ----
describe("dashboard + alert contracts", () => {
  const row = (over: Partial<DashboardShipmentRow>): DashboardShipmentRow => ({
    milestone: "IN_TRANSIT", bookingStatus: null, plannedArrival: null, estimatedArrival: null, plannedDeparture: null,
    actualDeparture: null, freshness: "RECENT", significantEtaChange: false, containersLoaded: 0, containersAtTransshipment: 0, containersAwaitingCustoms: 0, ...over,
  });
  it("aggregates in transit / delivered / exceptions / stale", () => {
    const d = buildShippingDashboard([
      row({ milestone: "IN_TRANSIT", containersLoaded: 2 }),
      row({ milestone: "DELIVERED" }),
      row({ milestone: "EXCEPTION", freshness: "VERY_STALE" }),
      row({ milestone: "BOOKING_CREATED", bookingStatus: "REQUESTED" }),
    ], NOW);
    expect(d).toMatchObject({ total: 4, inTransit: 1, delivered: 1, exceptions: 1, containersLoaded: 2, bookingsAwaitingConfirmation: 1 });
    expect(d.staleTracking).toBe(1);
  });
  it("derives alerts, most-severe first, only for active shipments", () => {
    const alerts = deriveShipmentAlerts({
      milestone: "IN_TRANSIT", bookingStatus: "REQUESTED", bookingCutoff: "2026-07-01T00:00:00Z", plannedDeparture: "2026-07-01T00:00:00Z",
      actualDeparture: null, plannedArrival: null, significantEtaChange: true, freshness: "STALE", customsBlocked: true, hasUnknownProviderStatus: false,
    }, NOW);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts.map((a) => a.code)).toContain("BOOKING_NOT_CONFIRMED_BY_CUTOFF");
    expect(alerts.map((a) => a.code)).toContain("MISSED_DEPARTURE");
  });
});

// ---------------------------------------------------------------- provider abstraction ----
describe("provider abstraction + engine (honest stubs)", () => {
  it("manual provider works; lookups unsupported; refresh not_configured", async () => {
    const m: ShippingProvider = new ManualShippingProvider();
    expect(m.configured).toBe(true);
    expect(m.capabilities().milestoneTracking).toBe(true);
    expect(await m.findByBooking("x")).toEqual({ ok: false, error: "unsupported" });
    expect(await m.refreshTracking({ reference: "x", type: "booking" })).toEqual({ ok: false, error: "not_configured" });
  });
  it("carrier + AIS stubs are not configured and advertise nothing", async () => {
    const c: ShippingProvider = new CarrierStubProvider("maersk");
    expect(c.configured).toBe(false);
    expect(Object.values(c.capabilities()).every((v) => v === false)).toBe(true);
    expect(await c.refreshTracking({ reference: "x", type: "bl" })).toEqual({ ok: false, error: "not_configured" });
    const ais: VesselPositionProvider = new AisStubProvider();
    expect(ais.configured).toBe(false);
    expect(await ais.getPositionByImo("9074729")).toEqual({ ok: false, error: "not_configured" });
  });
  it("resolveShippingProvider maps codes; the engine validates milestones locally", async () => {
    expect(resolveShippingProvider("maersk").code).toBe("maersk");
    expect(resolveShippingProvider("unknown").code).toBe("manual");
    expect([...SHIPPING_PROVIDERS]).toContain("cma-cgm");
    const engine = new ShippingEngine(new ManualShippingProvider());
    expect(engine.applyMilestone("LOADED", "VESSEL_DEPARTED").ok).toBe(true);
    expect(engine.applyMilestone("COMPLETED", "LOADED").ok).toBe(false);
    // A provider that returns nothing never advances state.
    expect(await engine.refresh("LOADED", { reference: "x", type: "booking" })).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------- status map + config ----
describe("carrier status map + provider readiness (no invented values)", () => {
  it("every carrier status table is EMPTY until verified; unknown → unmapped", () => {
    for (const t of Object.values(CARRIER_STATUS_MAPS)) expect(Object.keys(t)).toHaveLength(0);
    expect(mapCarrierStatus("maersk", "GATE OUT FULL")).toMatchObject({ confidence: "unmapped", milestone: null });
    expect(mapCarrierStatus("manual", "vessel_departed")).toMatchObject({ confidence: "exact", milestone: "VESSEL_DEPARTED" });
  });
  it("manual configured; carriers + AIS unsupported with readiness checklist", () => {
    expect(deriveShippingProviderConfig("manual", {}).status).toBe("configured");
    const mk = deriveShippingProviderConfig("maersk", { MAERSK_API_KEY: "ignored" });
    expect(mk).toMatchObject({ status: "unsupported", live: false });
    expect(mk.requiredInputs).toBe(CARRIER_READINESS_CHECKLIST);
    expect(mk.presentInputs).toEqual([]);
    const ais = deriveAisConfig({});
    expect(ais.status).toBe("unsupported");
    expect(ais.requiredInputs.some((r) => /redistribution/i.test(r))).toBe(true);
  });
});

// ---------------------------------------------------------------- persistence mapping ----
describe("persistence mappers reuse the shipment identity", () => {
  it("rowToOceanShipment maps ocean columns; rowToContainer maps ISO fields", () => {
    const s = rowToOceanShipment({
      id: "s1", file_id: "f1", transport_mode: "SEA", origin: "Dakar", destination: "Rotterdam", carrier_name: "Maersk",
      bl_awb_ref: "BL1", etd: "2026-07-01", atd: null, eta: "2026-08-01", ata: null, ocean_milestone: "IN_TRANSIT", provider_code: "manual",
      carrier_id: null, booking_reference: "BK1", booking_status: "CONFIRMED", master_bl: "MBL1", house_bl: null, eta_previous: "2026-07-20",
      tracking_synced_at: null, tracking_version: 2,
    }, { fileNumber: "EFT-IMP-1", clientName: "ACME" });
    expect(s).toMatchObject({ milestone: "IN_TRANSIT", bookingReference: "BK1", masterBl: "MBL1", estimatedArrival: "2026-08-01", plannedArrival: "2026-07-20", clientName: "ACME" });
    const c = rowToContainer({ id: "c1", shipment_id: "s1", container_number: "CSQU3054383", iso_type: "22G1", seal_number: "S1", gross_weight_kg: 1000, status: "ON_VESSEL", vessel_id: null, voyage_id: null, last_event_at: null, position_confidence: "INFERRED" });
    expect(c).toMatchObject({ number: "CSQU3054383", isoType: "22G1", status: "ON_VESSEL", positionConfidence: "INFERRED" });
  });
});

// ---------------------------------------------------------------- server-only (structural) ----
describe("server actions enforce the safety invariants", () => {
  const src = code("../lib/shipping/intelligence/actions.ts");
  it("is a server module; tenant + actor from the session", () => {
    expect(read("../lib/shipping/intelligence/actions.ts")).toContain('"use server"');
    expect(src).toContain("assertPermission");
    expect(src).toContain("user.tenantId");
    expect(src).toContain("user.id");
  });
  it("gates writes on transport:update / transport:manage (no new permission)", () => {
    expect(src).toContain('"transport:update"');
    expect(src).toContain('"transport:manage"');
    expect(src).not.toMatch(/shipping:[a-z]+|ocean:[a-z]+|vessel:[a-z]+/);
  });
  it("validates coordinates + timestamp, labels MANUAL, dedupes, and uses compare-and-set", () => {
    expect(src).toContain("isValidCoordinate");
    expect(src).toContain("invalid_timestamp");
    expect(src).toContain('confidence: "MANUAL"');
    expect(src).toContain('source: "MANUAL"');
    expect(src).toContain("eventFingerprint");
    expect(src).toContain("duplicate_event");
    expect(src).toContain('.eq("tracking_version", s.tracking_version)');
    expect(src).toContain("stale_transition");
  });
  it("validates milestones locally before applying; never trusts a provider response blindly", () => {
    expect(src).toContain("classifyMilestone(");
    expect(src).toContain("mapCarrierStatus(");
  });
  it("audits SAFE metadata only — no raw payload / coordinates leak to the audit log", () => {
    expect(src).toContain("SHIPPING_TRACKING_MANUAL_EVENT");
    expect(src).not.toMatch(/after:\s*\{[^}]*latitude/); // audit payloads carry no coordinates
  });
});

describe("console reads are scoped, paginated, and provider-free", () => {
  const src = code("../lib/shipping/intelligence/service.ts");
  it("server-only, transport:read gate, tenant-filtered, SQL-paginated", () => {
    expect(src).toContain('import "server-only"');
    expect(src).toContain('assertPermission("transport:read")');
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain(".range(from, from + size)");
  });
  it("makes NO provider network call on a read path and reuses pure contracts", () => {
    expect(src).not.toContain(".refreshTracking(");
    expect(src).not.toContain("new ShippingEngine");
    expect(src).toContain("buildShippingDashboard(");
    expect(src).toContain("resolveCurrentPosition(");
    expect(src).toContain("buildShipmentMapProjection(");
  });
  it("the customs link is read-only (no customs write) and tenant-filtered", () => {
    const cl = code("../lib/shipping/intelligence/customs-link.ts");
    expect(cl).toContain('.eq("tenant_id", tenantId)');
    expect(cl).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("console UI is gated and safe", () => {
  it("every shipping page gates on transport:read", () => {
    for (const p of ["../app/shipping/page.tsx", "../app/shipping/shipments/page.tsx", "../app/shipping/shipments/[shipmentId]/page.tsx", "../app/shipping/containers/page.tsx", "../app/shipping/vessels/page.tsx"]) {
      expect(read(p)).toContain('hasPermission(permissions, "transport:read")');
    }
    expect(read("../app/shipping/shipments/[shipmentId]/page.tsx")).toContain("notFound()");
  });
  it("the manual-event client re-validates on the server and never imports the config resolver", () => {
    const form = read("../components/shipping/manual-event-form.tsx");
    expect(form).toContain('"use client"');
    expect(form).toContain("addManualTrackingEvent(");
    expect(form).not.toContain("intelligence/config");
    expect(form).not.toContain("SERVICE_ROLE");
  });
});

// ---------------------------------------------------------------- boundary + regression ----
describe("shipping stays an honest internal foundation", () => {
  it("no live carrier/AIS endpoint or key is invented in config", () => {
    const cfg = read("../lib/shipping/intelligence/config.ts");
    expect(cfg).not.toMatch(/https?:\/\//);
    expect(cfg).not.toMatch(/MAERSK_(API|URL|KEY)|AIS_(API|URL|KEY|TOKEN)/);
  });
  it("the migration is additive on shipment, adds a dedicated event store, and no new permission/grant to write", () => {
    const mig = read("../supabase/migrations/20260716000004_shipping_line_platform.sql");
    expect(mig).toContain("alter table public.shipment");
    expect(mig).toContain("create table public.ocean_tracking_event");
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).not.toMatch(/raw_payload/i); // no raw provider payloads stored
    expect(mig).toContain("prevent_mutation"); // event store is append-only
  });
  it("the ocean tables are registered as tenant-scoped (leak guard covers them)", () => {
    const reg = read("../lib/db/tenant-tables.ts");
    for (const t of ["ocean_container", "ocean_tracking_event", "ocean_vessel", "ocean_voyage", "ocean_port", "ocean_carrier", "ocean_route_leg", "ocean_port_call"]) {
      expect(reg).toContain(`"${t}"`);
    }
  });
  it("there is NO public tracking route in 7.2A", () => {
    for (const p of ["../app/track", "../app/public/track", "../app/t"]) {
      expect(existsSync(fileURLToPath(new URL(p, import.meta.url)))).toBe(false);
    }
  });
});
