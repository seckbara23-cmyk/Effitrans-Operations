/**
 * Phase 7.3A — Air Cargo foundation (sibling of Ocean Shipping). Pure logic exercised
 * directly; server-only + client modules verified structurally. Reuses the shipping generic
 * engine (freshness/eta/events/map/customs). No live airline/IATA is claimed.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isValidIataAirline, isValidIataAirport, isValidIcaoAirline, isValidIcaoAirport } from "@/lib/air/intelligence/validators";
import { AIR_MILESTONES, classifyAirMilestone, isTerminalAirMilestone, AIR_MILESTONE_CATEGORY } from "@/lib/air/intelligence/milestones";
import { AIR_EVENTS, isAirEvent, airEventIsMilestone, rowToAirEvent, latestAirMilestoneEvent, eventFingerprint, type AirTrackingEvent } from "@/lib/air/intelligence/events";
import { resolveAirPosition } from "@/lib/air/intelligence/position";
import { buildAirDashboard, type AirDashboardRow } from "@/lib/air/intelligence/dashboard";
import { deriveAirAlerts } from "@/lib/air/intelligence/alerts";
import { ManualAirProvider, AirlineProvider, AirCargoEngine, resolveAirProvider, AIR_PROVIDERS, deriveAirProviderConfig, AIRLINE_READINESS_CHECKLIST, mapAirlineStatus, AIRLINE_STATUS_MAP, type AirProvider } from "@/lib/air/intelligence/provider";
import { previewAirEvent } from "@/lib/air/intelligence/studio";
import { rowToAirShipment, coerceAirMilestone } from "@/lib/air/intelligence/persistence";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NOW = "2026-07-16T12:00:00Z";

describe("air identifier validators (IATA vs ICAO, distinct)", () => {
  it("airline IATA(2)/ICAO(3), airport IATA(3)/ICAO(4)", () => {
    expect(isValidIataAirline("AF")).toBe(true); expect(isValidIataAirline("AFR")).toBe(false);
    expect(isValidIataAirport("DKR")).toBe(true); expect(isValidIataAirport("DK")).toBe(false);
    expect(isValidIcaoAirline("AFR")).toBe(true); expect(isValidIcaoAirline("AF")).toBe(false);
    expect(isValidIcaoAirport("GOBD")).toBe(true); expect(isValidIcaoAirport("GOB")).toBe(false);
    expect(isValidIataAirport("")).toBe(true); // optional
  });
});

describe("air milestones (sibling architecture)", () => {
  it("13 milestones + categories", () => {
    expect(AIR_MILESTONES).toHaveLength(13);
    expect(AIR_MILESTONE_CATEGORY.DEPARTED).toBe("flight");
    expect(AIR_MILESTONE_CATEGORY.CUSTOMS).toBe("customs");
  });
  it("classify advance/regress/exception/cancel/terminal", () => {
    expect(classifyAirMilestone("LOADED", "DEPARTED")).toEqual({ ok: true, kind: "advance" });
    expect(classifyAirMilestone("ARRIVED", "LOADED")).toEqual({ ok: true, kind: "regress" });
    expect(classifyAirMilestone("DEPARTED", "EXCEPTION")).toEqual({ ok: true, kind: "exception" });
    expect(classifyAirMilestone("DEPARTED", "CANCELLED")).toEqual({ ok: true, kind: "cancel" });
    expect(classifyAirMilestone("DELIVERED", "LOADED")).toMatchObject({ ok: false, reason: "terminal" });
    expect(isTerminalAirMilestone("DELIVERED")).toBe(true);
  });
});

describe("air events reuse the generic helpers", () => {
  it("vocabulary + fingerprint (reused) + latest milestone", () => {
    expect(AIR_EVENTS.length).toBe(15);
    expect(isAirEvent("DEPARTED")).toBe(true); expect(isAirEvent("NOPE")).toBe(false);
    expect(airEventIsMilestone("DEPARTED")).toBe(true); expect(airEventIsMilestone("POSITION_UPDATE" as never)).toBe(false);
    const fp = eventFingerprint({ shipmentId: "s", eventType: "DEPARTED", occurredAt: "2026-07-01T00:00:00Z", location: { unlocode: "DKR" } });
    const e = rowToAirEvent({ id: "1", tenant_id: "t", shipment_id: "s", uld_id: null, event_type: "DEPARTED", occurred_at: "2026-07-01T00:00:00Z", received_at: NOW, source: "MANUAL", provider_code: "manual", confidence: "MANUAL", location_name: null, location_iata: "DKR", latitude: null, longitude: null, flight_number: "AF1", description: null, fingerprint: fp });
    expect(e.eventType).toBe("DEPARTED"); expect(e.location?.iata).toBe("DKR");
    const list: AirTrackingEvent[] = [e, { ...e, id: "2", eventType: "ARRIVED", occurredAt: "2026-07-02T00:00:00Z", fingerprint: "x" }];
    expect(latestAirMilestoneEvent(list)?.eventType).toBe("ARRIVED");
  });
});

describe("air position resolver (never guesses)", () => {
  it("manual → flight (inferred, only if aboard) → airport → none", () => {
    expect(resolveAirPosition({ manualFix: { latitude: 14.7, longitude: -17.4, occurredAt: NOW } }, NOW)).toMatchObject({ available: true, source: "MANUAL", confidence: "MANUAL" });
    const fp = { latitude: 30, longitude: -10, occurredAt: NOW, receivedAt: NOW, sourceProvider: "x" };
    expect(resolveAirPosition({ cargoConfirmedOnFlight: false, flightPosition: fp }, NOW).available).toBe(false);
    expect(resolveAirPosition({ cargoConfirmedOnFlight: true, flightPosition: fp }, NOW)).toMatchObject({ available: true, source: "AIS", confidence: "INFERRED" });
    expect(resolveAirPosition({ airportAnchor: { name: "Dakar", latitude: 14.7, longitude: -17.4, occurredAt: NOW, confirmed: true } }, NOW)).toMatchObject({ available: true, source: "PORT", confidence: "CONFIRMED" });
    expect(resolveAirPosition({}, NOW).available).toBe(false);
  });
});

describe("air dashboard + alerts", () => {
  const row = (o: Partial<AirDashboardRow>): AirDashboardRow => ({ milestone: "DEPARTED", scheduledDeparture: null, actualDeparture: null, scheduledArrival: null, actualArrival: null, plannedArrival: null, estimatedArrival: null, freshness: "RECENT", significantEtaChange: false, ...o });
  it("aggregates in-flight / delivered / exceptions", () => {
    const d = buildAirDashboard([row({ milestone: "DEPARTED" }), row({ milestone: "DELIVERED" }), row({ milestone: "EXCEPTION", freshness: "VERY_STALE" })], NOW);
    expect(d).toMatchObject({ total: 3, inFlight: 1, delivered: 1, exceptions: 1 });
    expect(d.staleTracking).toBe(1);
  });
  it("derives alerts most-severe first", () => {
    const alerts = deriveAirAlerts({ milestone: "DEPARTED", scheduledDeparture: "2026-07-01T00:00:00Z", actualDeparture: null, scheduledArrival: null, estimatedArrival: null, freshness: "STALE", connectionMissed: true, uldMismatch: false, cargoMismatch: false, hasUnknownEvent: false }, NOW);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts.map((a) => a.code)).toContain("MISSED_DEPARTURE");
  });
});

describe("air provider abstraction (honest stubs) + config", () => {
  it("manual works, airline stub not_configured, engine validates locally", async () => {
    const m: AirProvider = new ManualAirProvider();
    expect(m.configured).toBe(true); expect(m.capabilities().milestoneTracking).toBe(true);
    expect(await m.refreshTracking({ reference: "x", type: "mawb" })).toEqual({ ok: false, error: "not_configured" });
    const a: AirProvider = new AirlineProvider();
    expect(a.configured).toBe(false);
    expect(Object.values(a.capabilities()).every((v) => v === false)).toBe(true);
    expect(resolveAirProvider("airline").code).toBe("airline"); expect(resolveAirProvider("x").code).toBe("manual");
    expect([...AIR_PROVIDERS]).toEqual(["manual", "airline"]);
    const engine = new AirCargoEngine(new ManualAirProvider());
    expect(engine.applyMilestone("LOADED", "DEPARTED").ok).toBe(true);
    expect(engine.applyMilestone("DELIVERED", "LOADED").ok).toBe(false);
  });
  it("config: manual configured; airline unsupported + checklist; status map empty", () => {
    expect(deriveAirProviderConfig("manual", {}).status).toBe("configured");
    const air = deriveAirProviderConfig("airline", { AIRLINE_API_KEY: "ignored" });
    expect(air).toMatchObject({ status: "unsupported", live: false });
    expect(air.requiredInputs).toBe(AIRLINE_READINESS_CHECKLIST);
    expect(Object.keys(AIRLINE_STATUS_MAP.airline)).toHaveLength(0);
    expect(mapAirlineStatus("airline", "GATE_OUT")).toMatchObject({ confidence: "unmapped", milestone: null });
    expect(mapAirlineStatus("manual", "departed")).toMatchObject({ confidence: "exact", milestone: "DEPARTED" });
  });
});

describe("air studio preview + persistence", () => {
  it("previews advance / correction-confirm / invalid / out-of-order", () => {
    expect(previewAirEvent("LOADED", "DEPARTED", NOW, null)).toMatchObject({ kind: "advance", ok: true, requiresConfirmation: false });
    expect(previewAirEvent("ARRIVED", "LOADED", NOW, null)).toMatchObject({ kind: "regress", requiresConfirmation: true });
    expect(previewAirEvent("DELIVERED", "LOADED", NOW, null)).toMatchObject({ ok: false, reason: "terminal" });
    expect(previewAirEvent("LOADED", "DEPARTED", "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z").outOfOrder).toBe(true);
  });
  it("rowToAirShipment maps air columns", () => {
    const s = rowToAirShipment({ id: "s", file_id: "f", origin: "DKR", destination: "CDG", airline_id: null, air_milestone: "DEPARTED", air_provider_code: "manual", etd: "2026-07-01", atd: null, eta: "2026-07-02", ata: null, eta_previous: null, tracking_synced_at: null, air_tracking_version: 1 }, { fileNumber: "F1", clientName: "ACME", mawb: "057-12345675", hawb: null });
    expect(s).toMatchObject({ milestone: "DEPARTED", mawb: "057-12345675", origin: "DKR", clientName: "ACME" });
    expect(coerceAirMilestone("WAT")).toBe("BOOKED");
  });
});

// ---------------------------------------------------------------- structural ----
describe("air actions enforce safety invariants", () => {
  const src = code("../lib/air/intelligence/actions.ts");
  const mgmt = code("../lib/air/intelligence/manage-actions.ts");
  it("server modules; session tenant+actor; transport:update/manage; no new perm", () => {
    expect(read("../lib/air/intelligence/actions.ts")).toContain('"use server"');
    expect(read("../lib/air/intelligence/manage-actions.ts")).toContain('"use server"');
    expect(src).toContain("assertPermission");
    expect(mgmt).toContain('"transport:manage"'); expect(mgmt).toContain('"transport:update"');
    expect(src).not.toMatch(/air:[a-z]+|airline:[a-z]+/); expect(mgmt).not.toMatch(/air:[a-z]+:/);
  });
  it("manual event: coord/timestamp validation, MANUAL, dedup, CAS, correction confirm, safe audit", () => {
    expect(src).toContain("isValidCoordinate"); expect(src).toContain("invalid_timestamp");
    expect(src).toContain('confidence: "MANUAL"'); expect(src).toContain('source: "MANUAL"');
    expect(src).toContain("eventFingerprint"); expect(src).toContain("duplicate_event");
    expect(src).toContain('.eq("air_tracking_version", s.air_tracking_version)'); expect(src).toContain("confirmation_required");
    expect(src).not.toMatch(/after:\s*\{[^}]*latitude/);
  });
  it("mgmt: in-tenant guards, IATA/ICAO/coord validation, no destructive delete of reference data", () => {
    expect(mgmt).toContain("inTenant(");
    for (const v of ["isValidIataAirline", "isValidIataAirport", "isValidIcaoAirline", "isValidIcaoAirport", "isValidCoordinate", "validateVoyageChronology"]) expect(mgmt).toContain(v);
    expect(mgmt).not.toMatch(/from\("air_airline"\)\.delete/); expect(mgmt).not.toMatch(/from\("air_airport"\)\.delete/);
    expect(mgmt).not.toMatch(/after:\s*\{[^}]*latitude/);
  });
});

describe("air reads scoped + provider-free; reuse the generic engine", () => {
  it("server-only, transport:read, tenant-filtered, SQL-paginated, no provider call", () => {
    for (const f of ["service", "manage-service"]) {
      const s = code(`../lib/air/intelligence/${f}.ts`);
      expect(s).toContain('import "server-only"');
      expect(s).toContain('assertPermission("transport:read")');
      expect(s).toContain('.eq("tenant_id", tenantId)');
      expect(s).not.toContain(".refreshTracking(");
    }
    const svc = code("../lib/air/intelligence/service.ts");
    expect(svc).toContain("buildShipmentMapProjection("); // reuses the shared projection
    expect(svc).toContain("getShipmentCustomsSummary("); // reuses the shared customs summary
    expect(svc).toContain("resolveAirPosition(");
  });
  it("air REUSES generic helpers (no duplicate engine)", () => {
    expect(read("../lib/air/intelligence/events.ts")).toContain('from "@/lib/shipping/intelligence/events"');
    expect(read("../lib/air/intelligence/position.ts")).toContain('from "@/lib/shipping/intelligence/position"');
    expect(read("../lib/air/intelligence/dashboard.ts")).toContain('from "@/lib/shipping/intelligence/freshness"');
  });
});

describe("air console + client bundle safety + boundary", () => {
  it("the detail page reuses the shared Leaflet loader, customs link, and documents", () => {
    const p = read("../app/air/shipments/[shipmentId]/page.tsx");
    expect(p).toContain("ShipmentMapLoader"); expect(p).toContain("/customs/intelligence"); expect(p).toContain("listDocuments(");
  });
  it("air client components use the pure preview and ship no service role", () => {
    const c = read("../components/air/air-console.tsx");
    expect(c).toContain('"use client"'); expect(c).toContain("previewAirEvent(");
    for (const f of ["../components/air/air-console.tsx", "../components/air/air-management-forms.tsx"]) {
      const src = read(f).toLowerCase();
      for (const s of ["service_role", "getadminsupabaseclient"]) expect(src, `${f}::${s}`).not.toContain(s);
    }
  });
  it("migration additive; no new permission/grant-to-write; reuses transport:read; registry updated", () => {
    const mig = read("../supabase/migrations/20260716000006_air_cargo_platform.sql");
    expect(mig).toContain("has_permission('transport:read')");
    expect(mig).not.toMatch(/insert into public\.permission/i);
    expect(mig).toContain("prevent_mutation"); // event store append-only
    const reg = read("../lib/db/tenant-tables.ts");
    for (const t of ["air_airline", "air_airport", "air_flight", "air_uld", "air_tracking_event", "air_cargo_piece"]) expect(reg).toContain(`"${t}"`);
  });
  it("no public tracking route; RLS test covers air isolation", () => {
    for (const p of ["../app/track", "../app/air/public"]) expect(existsSync(fileURLToPath(new URL(p, import.meta.url)))).toBe(false);
    expect(read("../supabase/tests/rls_air_test.sql")).toContain("air_uld");
  });
});
