/**
 * Phase 7.3C — Unified Logistics Command Center. Pure composition tested directly; the
 * server reader + page verified structurally. No new backend; reuses existing domain
 * services; degrades by section.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { platformState, mergeAttention, sortUpcoming, headlineKpis, countBySeverity, type UnifiedAlert, type UpcomingMovement } from "@/lib/logistics/compose";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = (p: string) => existsSync(fileURLToPath(new URL(p, import.meta.url)));

// ---------------------------------------------------------------- pure compose ----
describe("platform state is derived honestly", () => {
  it("unavailable / empty → no_data (never 'normal' on an empty module)", () => {
    expect(platformState({ available: false, hasData: false, critical: 0, warning: 0 })).toBe("no_data");
    expect(platformState({ available: true, hasData: false, critical: 5, warning: 5 })).toBe("no_data");
  });
  it("critical > warning > normal when there is data", () => {
    expect(platformState({ available: true, hasData: true, critical: 1, warning: 3 })).toBe("critical");
    expect(platformState({ available: true, hasData: true, critical: 0, warning: 2 })).toBe("attention");
    expect(platformState({ available: true, hasData: true, critical: 0, warning: 0 })).toBe("normal");
  });
});

describe("unified attention queue: dedupe, order, bound", () => {
  const mk = (over: Partial<UnifiedAlert>): UnifiedAlert => ({ mode: "ocean", severity: "warning", reference: "F1", clientName: null, reason: "r", link: "/x", ...over });
  it("dedupes identical mode+reference+reason", () => {
    expect(mergeAttention([mk({}), mk({})])).toHaveLength(1);
  });
  it("orders by severity then age (oldest first)", () => {
    const out = mergeAttention([
      mk({ reason: "b", severity: "warning", occurredAt: "2026-07-02T00:00:00Z" }),
      mk({ reason: "a", severity: "critical" }),
      mk({ reason: "c", severity: "warning", occurredAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(out.map((a) => a.reason)).toEqual(["a", "c", "b"]);
  });
  it("bounds the result", () => {
    const many = Array.from({ length: 30 }, (_, i) => mk({ reason: `r${i}` }));
    expect(mergeAttention(many, 12)).toHaveLength(12);
  });
  it("counts critical", () => {
    expect(countBySeverity([mk({ severity: "critical" }), mk({ reason: "z", severity: "warning" })], "critical")).toBe(1);
  });
});

describe("upcoming movements: real dates only, chronological, bounded", () => {
  const mk = (at: string, ref: string): UpcomingMovement => ({ mode: "ocean", reference: ref, clientName: null, route: "A → B", at, status: "s", link: "/x" });
  it("drops missing/invalid dates and sorts ascending", () => {
    const out = sortUpcoming([mk("2026-07-03T00:00:00Z", "c"), mk("", "none"), mk("2026-07-01T00:00:00Z", "a"), mk("nope", "bad")]);
    expect(out.map((m) => m.reference)).toEqual(["a", "c"]);
  });
});

describe("headline KPIs sum across modes; unauthorized modules contribute 0", () => {
  it("sums per-mode movement/arrival/delay/exception counts", () => {
    const h = headlineKpis({
      ocean: { inTransit: 3, containersLoaded: 0, arriving7d: 2, delayed: 1, stale: 0, exceptions: 1, awaitingCustoms: 4 },
      air: { flightsToday: 0, awaitingLoading: 0, inFlight: 2, arriving: 1, delayed: 1, exceptions: 2 },
      road: { readyForDispatch: 0, assigned: 0, inTransit: 5, podRequired: 0, overdue: 3 },
      customs: { pending: 6, inspection: 0, awaitingPayment: 0, released: 0, blockedRejected: 0 },
      criticalAlerts: 7,
    });
    expect(h).toEqual({ movementsInProgress: 10, arrivingWithin7Days: 3, overdueOps: 5, criticalAlerts: 7, awaitingCustoms: 10, exceptions: 3 });
  });
  it("treats absent (unauthorized) modules as 0", () => {
    const h = headlineKpis({ ocean: null, air: null, road: null, customs: null, criticalAlerts: 0 });
    expect(h).toEqual({ movementsInProgress: 0, arrivingWithin7Days: 0, overdueOps: 0, criticalAlerts: 0, awaitingCustoms: 0, exceptions: 0 });
  });
});

// ---------------------------------------------------------------- structural: reader ----
describe("the reader reuses existing services + degrades by section (no new backend)", () => {
  const src = code("../lib/logistics/reader.ts");
  it("server-only; reuses each domain's existing bounded read service", () => {
    expect(src).toContain('import "server-only"');
    for (const svc of ["getShippingDashboard", "getAirDashboard", "getIntelligenceDashboard", "getTransportQueue", "getAttentionQueue", "getAirAttentionQueue"]) expect(src).toContain(svc);
  });
  it("does NOT re-implement any domain dashboard calculation", () => {
    expect(src).not.toContain("buildShippingDashboard");
    expect(src).not.toContain("buildAirDashboard");
    expect(src).not.toContain("buildCustomsDashboard");
  });
  it("isolates each module (Promise.allSettled) so one failure/permission degrades only its section", () => {
    expect(src).toContain("Promise.allSettled");
    expect(src).toContain("canCustoms"); // customs gated on customs:read
    expect(src).toContain('hasPermission(perms, "customs:read")');
  });
  it("tenant-filters admin reads and makes no provider call", () => {
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).not.toContain(".refreshTracking(");
    expect(src).not.toContain("new ShippingEngine");
  });
  it("the composer is pure (no I/O, no admin client)", () => {
    const compose = read("../lib/logistics/compose.ts");
    expect(compose).not.toContain("getAdminSupabaseClient");
    expect(compose).not.toContain("assertPermission");
  });
});

// ---------------------------------------------------------------- structural: page + nav ----
describe("the Command Center page + sidebar", () => {
  it("the route is still /departments/transport and is the command center", () => {
    expect(exists("../app/departments/transport/page.tsx")).toBe(true);
    const page = read("../app/departments/transport/page.tsx");
    expect(page).toContain("Transport & Logistique");
    expect(page).toContain("getCommandCenter(");
    expect(page).toContain('hasPermission(permissions, "transport:read")');
  });
  it("ships no Leaflet and no service role on the command center", () => {
    const page = read("../app/departments/transport/page.tsx");
    expect(page).not.toMatch(/leaflet|ShipmentMapLoader/i);
    expect(page.toLowerCase()).not.toContain("getadminsupabaseclient");
    expect(page).not.toMatch(/service_role/i);
  });
  it("customs data is gated (partial permissions handled)", () => {
    const page = read("../app/departments/transport/page.tsx");
    expect(page).toContain("customsAuthorized");
  });
  it("Transport & Logistique is now a Transit workspace — route/permission unchanged, no URL break", () => {
    // Department realignment: it left the top-level sidebar and became a WORKSPACE
    // under the Transit hub. The ROUTE (/departments/transport) and its
    // transport:read gate are unchanged — only the entry point moved.
    const transitHub = read("../app/departments/transit/page.tsx");
    expect(transitHub).toContain('label: "Transport & Logistique"');
    expect(transitHub).toContain('href: "/departments/transport"');
    expect(transitHub).toContain('permission: "transport:read"');
    // The Command Center route itself still exists (this test file already asserts its content above).
    expect(() => read("../app/departments/transport/page.tsx")).not.toThrow();
  });
  it("no new logistics migration/permission was introduced", () => {
    // Composition-only phase: no schema, no permission.
    expect(read("../lib/logistics/reader.ts")).not.toMatch(/logistics:[a-z]+/);
    expect(read("../lib/logistics/compose.ts")).not.toMatch(/insert into|create table/i);
  });
});
