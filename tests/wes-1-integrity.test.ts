/**
 * Phase WES-1 — workflow integrity hotfixes.
 * ---------------------------------------------------------------------------
 * One regression suite per UAT defect. The repaired logic is PURE wherever it
 * could be (the patch contract, the handoff surpassal predicate), so those are
 * tested as BEHAVIOUR — call it, assert the outcome. The server-action
 * guarantees (CAS, delete protection, audit-only-on-success, flag independence)
 * are asserted structurally against the real source, since importing a
 * "use server" module pulls the whole server chain.
 *
 * Traceability to the WES Audit findings:
 *   WES-1A  transport data loss ............ audit §6, §9.6
 *   WES-1B  last-write-wins ................ audit §6
 *   WES-1C  soft-delete/revive regression .. audit §2 (K), §9.1(b)
 *   WES-1D  handoff trigger re-fire ........ audit §4, §9.2
 *   WES-1E  driver assignment split ........ audit §5 (H), §9.4
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TRANSPORT_ASSIGNMENT_FIELDS,
  TRANSPORT_COLUMN,
  TRANSPORT_PLANNING_FIELDS,
  buildTransportPatch,
  clearFieldsAreValid,
  isEmptyPatch,
} from "@/lib/transport/patch";
import {
  HANDOFF_ORDER,
  handoffSurpassed,
  reachedHandoffIndex,
  type DossierProgress,
} from "@/lib/handoffs/rules";
import { t } from "@/lib/i18n";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** Executable code only — prose in comments must never satisfy or break an assertion. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TRANSPORT_ACTIONS = read("../lib/transport/actions.ts");
const CUSTOMS_ACTIONS = read("../lib/customs/actions.ts");
const HANDOFF_SERVICE = read("../lib/handoffs/service.ts");
const DRIVER_ACTIONS = read("../lib/transport/driver-actions.ts");
const FILE_PAGE = read("../app/files/[id]/page.tsx");
const PANEL = read("../components/transport/transport-panel.tsx");
const DRIVER_ASSIGN = read("../components/transport/driver-assign.tsx");
const DRIVER_SERVICE = read("../lib/driver/service.ts");
const DRIVER_AUTH = read("../lib/driver/auth.ts");

const ALL_FIELDS = [...TRANSPORT_PLANNING_FIELDS, ...TRANSPORT_ASSIGNMENT_FIELDS];

// ========================= WES-1A — partial patch (1-14) ====================

describe("WES-1A — transport updates never erase what they were not asked to change", () => {
  it("1 — an OMITTED field is not written at all", () => {
    const patch = buildTransportPatch({ notes: "RAS" }, TRANSPORT_PLANNING_FIELDS);
    expect(patch).toEqual({ notes: "RAS" });
    expect(patch).not.toHaveProperty("pickup_location");
    expect(patch).not.toHaveProperty("delivery_location");
  });

  it("2 — an EMPTY STRING preserves: a blank input is not consent to erase", () => {
    const patch = buildTransportPatch(
      { notes: "RAS", pickupLocation: "", deliveryLocation: "   " },
      TRANSPORT_PLANNING_FIELDS,
    );
    expect(patch).toEqual({ notes: "RAS" });
  });

  it("3 — an explicit NULL also preserves (absence is never consent)", () => {
    const patch = buildTransportPatch({ notes: null, pickupLocation: "Dakar" }, TRANSPORT_PLANNING_FIELDS);
    expect(patch).toEqual({ pickup_location: "Dakar" });
  });

  it("4 — only `clearFields` writes null, and only for the named field", () => {
    const patch = buildTransportPatch({ notes: "RAS" }, TRANSPORT_PLANNING_FIELDS, ["pickupLocation"]);
    expect(patch).toEqual({ notes: "RAS", pickup_location: null });
  });

  it("5 — values are trimmed", () => {
    expect(buildTransportPatch({ notes: "  RAS  " }, TRANSPORT_PLANNING_FIELDS)).toEqual({ notes: "RAS" });
  });

  it("6 — THE UAT DEFECT: assigning a chauffeur preserves every planning field", () => {
    // The assign form owns only driver/vehicle fields; nothing else may be touched.
    const patch = buildTransportPatch({ driverName: "M. Diop" }, TRANSPORT_ASSIGNMENT_FIELDS);
    expect(patch).toEqual({ driver_name: "M. Diop" });
    for (const f of TRANSPORT_PLANNING_FIELDS) {
      expect(patch, f).not.toHaveProperty(TRANSPORT_COLUMN[f]);
    }
  });

  it("7 — changing the vehicle preserves the chauffeur and the planning fields", () => {
    const patch = buildTransportPatch({ vehiclePlate: "DK-1234-AB" }, TRANSPORT_ASSIGNMENT_FIELDS);
    expect(patch).toEqual({ vehicle_plate: "DK-1234-AB" });
    expect(patch).not.toHaveProperty("driver_name");
    expect(patch).not.toHaveProperty("driver_phone");
  });

  it("8 — changing notes preserves the schedule and the route", () => {
    const patch = buildTransportPatch({ notes: "Retard prévu" }, TRANSPORT_PLANNING_FIELDS);
    for (const col of ["pickup_location", "delivery_location", "pickup_planned", "delivery_planned"]) {
      expect(patch, col).not.toHaveProperty(col);
    }
  });

  it("9 — a completely empty input writes nothing", () => {
    const patch = buildTransportPatch({}, TRANSPORT_PLANNING_FIELDS);
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it("10 — a field outside the action's ownership is ignored", () => {
    // driverName is not a planning field: updateTransport may never touch it.
    const patch = buildTransportPatch({ driverName: "M. Diop" }, TRANSPORT_PLANNING_FIELDS);
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it("11 — clearFields is validated against the action's own fields", () => {
    expect(clearFieldsAreValid(["notes"], TRANSPORT_PLANNING_FIELDS)).toBe(true);
    expect(clearFieldsAreValid(["driverName"], TRANSPORT_PLANNING_FIELDS)).toBe(false);
    expect(clearFieldsAreValid(undefined, TRANSPORT_PLANNING_FIELDS)).toBe(true);
  });

  it("12 — a cross-action clear is refused, not silently applied", () => {
    const patch = buildTransportPatch({}, TRANSPORT_PLANNING_FIELDS, ["driverName"]);
    expect(patch).not.toHaveProperty("driver_name");
  });

  it("13 — every field maps to exactly one distinct column", () => {
    const cols = ALL_FIELDS.map((f) => TRANSPORT_COLUMN[f]);
    expect(new Set(cols).size).toBe(cols.length);
  });

  it("14 — the destructive `|| null` pattern is gone from both actions", () => {
    expect(TRANSPORT_ACTIONS).not.toMatch(/input\.\w+\?\.trim\(\) \|\| null/);
    expect(TRANSPORT_ACTIONS).not.toMatch(/a\.\w+\?\.trim\(\) \|\| null/);
    expect(TRANSPORT_ACTIONS).toContain("buildTransportPatch");
  });
});

// ==================== WES-1B — optimistic concurrency (15-21) ===============

describe("WES-1B — concurrent transport edits cannot silently overwrite", () => {
  it("15 — the update is constrained on the loaded updated_at (CAS)", () => {
    expect(TRANSPORT_ACTIONS).toMatch(/\.eq\("updated_at", expectedUpdatedAt\)/);
    expect(TRANSPORT_ACTIONS).toMatch(/\(data\?\.length \?\? 0\) === 1 \? "ok" : "stale"/);
  });

  it("16 — both material mutations REQUIRE the token", () => {
    for (const fn of ["updateTransport", "assignTransport"]) {
      const src = TRANSPORT_ACTIONS.slice(TRANSPORT_ACTIONS.indexOf(`export async function ${fn}(`));
      expect(src.slice(0, 400), fn).toContain("expectedUpdatedAt: string");
    }
  });

  it("17 — a stale write returns a conflict, never a success", () => {
    expect(TRANSPORT_ACTIONS).toMatch(/=== "stale"\)\s*\{\s*\n\s*return \{ ok: false, error: "stale_write" \}/);
  });

  it("18 — a rejected stale write writes NO success audit", () => {
    // The stale branch returns before writeAudit in both actions.
    for (const fn of ["updateTransport", "assignTransport"]) {
      const start = TRANSPORT_ACTIONS.indexOf(`export async function ${fn}(`);
      const body = TRANSPORT_ACTIONS.slice(start, TRANSPORT_ACTIONS.indexOf("\n}", start));
      const staleAt = body.indexOf('error: "stale_write" }');
      const auditAt = body.indexOf("writeAudit");
      expect(staleAt, fn).toBeGreaterThan(-1);
      expect(auditAt, fn).toBeGreaterThan(staleAt);
    }
  });

  it("19 — a conflict is refused outright: no retry loop, no automatic merge", () => {
    const src = code(TRANSPORT_ACTIONS);
    // casUpdate runs exactly once per action, and its result is only ever compared.
    expect((src.match(/casUpdate\(/g) ?? []).length).toBe(3); // 1 definition + 2 call sites
    expect(src).not.toMatch(/while\s*\(|for\s*\(.*attempt|setTimeout/);
  });

  it("20 — the conflict message is user-facing French and leaks no internals", () => {
    const msg = t.transport.errors.stale_write;
    expect(msg).toContain("modifié par un autre utilisateur");
    expect(msg).toContain("Actualisez la page");
    expect(msg).not.toMatch(/updated_at|postgres|supabase|SQL/i);
  });

  it("21 — the token is carried verbatim from the reader, never reformatted", () => {
    expect(read("../lib/transport/service.ts")).toContain("updatedAt: r.updated_at,");
    expect(PANEL).toContain("r.updatedAt");
    expect(PANEL).not.toMatch(/updatedAt.*toISOString|Date\(.*updatedAt/);
  });
});

// ================= WES-1C — completed records are protected (22-29) =========

describe("WES-1C — completed module records cannot be reset", () => {
  it("22 — a RELEASED customs record cannot be ordinarily deleted", () => {
    const fn = CUSTOMS_ACTIONS.slice(CUSTOMS_ACTIONS.indexOf("export async function deleteCustoms"));
    expect(fn).toMatch(/rec\.status === "RELEASED"[\s\S]{0,80}protected_released/);
  });

  it("23 — a DELIVERED / POD_RECEIVED transport cannot be ordinarily deleted", () => {
    expect(TRANSPORT_ACTIONS).toMatch(
      /DELETE_PROTECTED_STATUSES: readonly TransportStatus\[\] = \["DELIVERED", "POD_RECEIVED"\]/,
    );
    const fn = TRANSPORT_ACTIONS.slice(TRANSPORT_ACTIONS.indexOf("export async function deleteTransport"));
    expect(fn).toMatch(/DELETE_PROTECTED_STATUSES\.includes[\s\S]{0,120}protected_completed/);
  });

  it("24 — pre-completion records keep their existing delete behaviour", () => {
    // Only the two terminal-evidence states are protected; nothing else changed.
    const fn = TRANSPORT_ACTIONS.slice(TRANSPORT_ACTIONS.indexOf("export async function deleteTransport"));
    expect(fn).not.toContain('"PLANNED"');
    expect(fn).not.toContain('"IN_TRANSIT"');
  });

  it("25 — customs revival NO LONGER resets the status", () => {
    expect(CUSTOMS_ACTIONS).not.toMatch(/deleted_at: null, status: "NOT_STARTED"/);
    expect(CUSTOMS_ACTIONS).toMatch(/\.update\(\{ deleted_at: null \}\)/);
  });

  it("26 — transport revival NO LONGER resets the status", () => {
    expect(TRANSPORT_ACTIONS).not.toMatch(/deleted_at: null, status: "NOT_STARTED"/);
    expect(TRANSPORT_ACTIONS).toMatch(/\.update\(\{ deleted_at: null \}\)/);
  });

  it("27 — revival touches ONLY deleted_at, so evidence survives", () => {
    // BAE reference, release date, delivery/POD timestamps are never written on revive.
    // PIN SCOPED (TMS-4, 2026-08-18): requestTransport now sits before
    // createTransport and has its own revival (pinned in tms-4-transport-
    // request.test.ts) plus a legitimate fresh-insert `status:` — the slice is
    // anchored to createTransport so it keeps measuring what it always did.
    for (const [name, src] of [["customs", CUSTOMS_ACTIONS], ["transport", TRANSPORT_ACTIONS]] as const) {
      const c = code(src);
      const from = name === "transport"
        ? c.indexOf("if (!existing.deleted_at)", c.indexOf("export async function createTransport"))
        : c.indexOf("if (!existing.deleted_at)");
      const revive = c.slice(from, c.indexOf("return { ok: true, id: existing.id };", from));
      expect(revive.length, name).toBeGreaterThan(0);
      expect(revive, name).not.toMatch(/bae_reference|release_date|delivery_actual|pickup_actual|pod_document_id|status:/);
    }
  });

  it("28 — WES-1 builds NO new override system for protected deletes", () => {
    expect(TRANSPORT_ACTIONS).not.toMatch(/overrideReason|force\s*[:=]|allowDelete/);
    expect(CUSTOMS_ACTIONS).not.toMatch(/overrideReason|force\s*[:=]|allowDelete/);
  });

  it("29 — protection messages exist in French for both modules", () => {
    expect(t.transport.errors.protected_completed).toMatch(/livré/i);
    expect((t.customs.errors as Record<string, string>).protected_released).toMatch(/BAE/);
  });
});

// ================== WES-1D — handoffs cannot re-fire (30-45) ================

const NOTHING: DossierProgress = {
  customsStatus: null,
  transportStatus: null,
  hasIssuedInvoice: false,
  fileClosed: false,
  satisfiedTypes: [],
};

describe("WES-1D — a satisfied handoff never comes back", () => {
  it("30 — a fresh dossier has reached nothing, so the first handoff is allowed", () => {
    expect(reachedHandoffIndex(NOTHING)).toBe(-1);
    expect(handoffSurpassed("CUSTOMS_HANDOFF", NOTHING)).toBe(false);
  });

  it("31 — a NOT_STARTED record is not 'reached': the first handoff still fires", () => {
    const p = { ...NOTHING, customsStatus: "NOT_STARTED", transportStatus: "NOT_STARTED" };
    expect(reachedHandoffIndex(p)).toBe(-1);
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(false);
  });

  it("32 — THE UAT DEFECT: a late POD approval cannot recreate the customs handoff", () => {
    // Customs released, dossier in transport at POD_RECEIVED; a document approval
    // fires onDocumentApproved again. Before WES-1D this recreated
    // « Dossier prêt pour déclaration douanière ».
    const p: DossierProgress = {
      customsStatus: "RELEASED",
      transportStatus: "POD_RECEIVED",
      hasIssuedInvoice: false,
      fileClosed: false,
      satisfiedTypes: [],
    };
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(true);
    expect(handoffSurpassed("TRANSPORT_HANDOFF", p)).toBe(true);
  });

  it("33 — a handoff already carried to DONE is never recreated", () => {
    const p = { ...NOTHING, satisfiedTypes: ["CUSTOMS_HANDOFF"] as const };
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(true);
    // …and it does not block the NEXT department's handoff.
    expect(handoffSurpassed("TRANSPORT_HANDOFF", p)).toBe(false);
  });

  it("34 — customs started ⇒ the customs handoff is surpassed", () => {
    for (const s of ["DOCUMENTS_PENDING", "DECLARED", "INSPECTION", "RELEASED"]) {
      expect(handoffSurpassed("CUSTOMS_HANDOFF", { ...NOTHING, customsStatus: s }), s).toBe(true);
    }
  });

  it("35 — the legitimate transport handoff still fires at customs release", () => {
    // onCustomsReleased: customs RELEASED, transport not yet started.
    const p = { ...NOTHING, customsStatus: "RELEASED", transportStatus: "NOT_STARTED" };
    expect(handoffSurpassed("TRANSPORT_HANDOFF", p)).toBe(false);
  });

  it("36 — the legitimate finance handoff still fires at POD", () => {
    const p = { ...NOTHING, customsStatus: "RELEASED", transportStatus: "POD_RECEIVED" };
    expect(handoffSurpassed("FINANCE_HANDOFF", p)).toBe(false);
  });

  it("37 — the legitimate archive handoff still fires when invoices are paid", () => {
    const p = { ...NOTHING, transportStatus: "POD_RECEIVED", hasIssuedInvoice: true };
    expect(handoffSurpassed("ARCHIVE_HANDOFF", p)).toBe(false);
  });

  it("38 — an issued invoice surpasses every earlier handoff", () => {
    const p = { ...NOTHING, hasIssuedInvoice: true };
    expect(reachedHandoffIndex(p)).toBe(2);
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(true);
    expect(handoffSurpassed("TRANSPORT_HANDOFF", p)).toBe(true);
    expect(handoffSurpassed("FINANCE_HANDOFF", p)).toBe(true);
  });

  it("39 — a closed dossier surpasses all four", () => {
    const p = { ...NOTHING, fileClosed: true };
    expect(reachedHandoffIndex(p)).toBe(3);
    for (const type of HANDOFF_ORDER) expect(handoffSurpassed(type, p), type).toBe(true);
  });

  it("40 — repeated identical events are idempotent (the predicate is pure)", () => {
    const p = { ...NOTHING, customsStatus: "RELEASED" };
    const first = handoffSurpassed("CUSTOMS_HANDOFF", p);
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(first);
    expect(handoffSurpassed("CUSTOMS_HANDOFF", p)).toBe(true);
  });

  it("41 — a CANCELLED record does not count as progress", () => {
    const p = { ...NOTHING, customsStatus: "CANCELLED", transportStatus: "CANCELLED" };
    expect(reachedHandoffIndex(p)).toBe(-1);
  });

  it("42 — the guard sits in the ONE funnel, so every producer inherits it", () => {
    expect(HANDOFF_SERVICE).toContain("handoffSurpassed(");
    expect(HANDOFF_SERVICE).toContain('return "surpassed"');
    // All four triggers go through createHandoffTask — nothing bypasses it.
    const triggers = read("../lib/handoffs/triggers.ts");
    expect((triggers.match(/createHandoffTask\(/g) ?? []).length).toBe(4);
    expect(triggers).not.toMatch(/\.from\("task"\)[\s\S]{0,80}\.insert/);
  });

  it("43 — a surpassed handoff creates no task AND no notification", () => {
    // The surpassed check returns before both the insert and notifyRole.
    const fn = HANDOFF_SERVICE.slice(HANDOFF_SERVICE.indexOf("export async function createHandoffTask"));
    const surpassedAt = fn.indexOf('return "surpassed"');
    expect(surpassedAt).toBeGreaterThan(-1);
    expect(fn.indexOf(".insert(")).toBeGreaterThan(surpassedAt);
    expect(fn.indexOf("notifyRole(")).toBeGreaterThan(surpassedAt);
  });

  it("44 — progress is read from the module records, not from the tasks it guards", () => {
    const fn = HANDOFF_SERVICE.slice(HANDOFF_SERVICE.indexOf("async function readDossierProgress"));
    for (const table of ["customs_record", "transport_record", "invoice", "operational_file"]) {
      expect(fn, table).toContain(`from("${table}")`);
    }
    expect(fn).toMatch(/\.eq\("tenant_id", tenantId\)/);
  });

  it("45 — the existing open-task idempotency check is preserved", () => {
    expect(HANDOFF_SERVICE).toMatch(/\.not\("status", "in", "\(DONE,CANCELLED\)"\)/);
    expect(HANDOFF_SERVICE).toContain('return "exists"');
  });
});

// ============ WES-1E — authenticated chauffeur, tracking-independent (46-56) =

describe("WES-1E — chauffeur identity is not a tracking feature", () => {
  it("46 — driver assignment is gated on transport:assign ALONE", () => {
    expect(FILE_PAGE).toMatch(/const assignableDrivers = canAssignDriver && transportRecord/);
    expect(FILE_PAGE).not.toMatch(/trackingOn && canAssignDriver/);
  });

  it("47 — the DriverAssign panel no longer renders behind the tracking flag", () => {
    expect(FILE_PAGE).toMatch(/\{canReadTransport && transportRecord && \(\s*\n\s*<DriverAssign/);
    expect(FILE_PAGE).not.toMatch(/trackingOn && canReadTransport && transportRecord/);
  });

  it("48 — TRACKING_ENABLED still gates GPS surfaces", () => {
    // The flag keeps its real job: telemetry, not identity.
    expect(FILE_PAGE).toMatch(/trackingOn && canReadTracking/);
    expect(FILE_PAGE).toContain("getTrackingTimeline");
  });

  it("49 — the driver portal's mission query keys on the authenticated user id", () => {
    expect(DRIVER_SERVICE).toMatch(/\.eq\("driver_user_id", user\.id\)/);
  });

  it("50 — the driver portal guard does not consult any tracking flag", () => {
    expect(DRIVER_AUTH).not.toMatch(/trackingEnabled|driverMobileTracking|TRACKING_ENABLED/);
    expect(DRIVER_SERVICE).not.toMatch(/trackingEnabled\(\)|driverMobileTrackingEnabled\(\)/);
  });

  it("51 — the assigned driver must be an ACTIVE, same-tenant DRIVER", () => {
    const fn = DRIVER_ACTIONS.slice(DRIVER_ACTIONS.indexOf("async function isTenantDriver"));
    expect(fn).toMatch(/\.eq\("tenant_id", tenantId\)/);
    expect(fn).toMatch(/appUser\.status !== "active"/);
    expect(fn).toMatch(/r\.role\?\.code === "DRIVER"/);
    expect(DRIVER_ACTIONS).toMatch(/isTenantDriver\([\s\S]{0,80}invalid_driver/);
  });

  it("52 — the selectable list exposes only tenant DRIVER users, never arbitrary staff", () => {
    const drivers = read("../lib/transport/drivers.ts");
    expect(drivers).toMatch(/r\.role\?\.code !== "DRIVER"/);
    expect(drivers).toMatch(/r\.user\.status !== "active"/);
    expect(drivers).toMatch(/\.eq\("tenant_id", user\.tenantId\)/);
  });

  it("53 — assignment notifies the chauffeur through the existing inbox", () => {
    const fn = DRIVER_ACTIONS.slice(DRIVER_ACTIONS.indexOf("export async function assignDriverUser"));
    expect(fn).toContain("createNotification(");
    expect(fn).toContain("Nouvelle mission de transport");
    // No duplicate notification when re-assigning the same driver.
    expect(fn).toMatch(/rec\.driver_user_id === driverUserId[\s\S]{0,60}return \{ ok: true/);
  });

  it("54 — a free-text name never masquerades as an authenticated assignment", () => {
    expect(DRIVER_ASSIGN).toMatch(/!currentDriverUserId && \(displayDriverName \?\? ""\)/);
    expect(t.transport.driverAssign.unauthenticated).toMatch(/aucun chauffeur authentifié/i);
    expect(t.transport.driverAssign.unauthenticated).toMatch(/aucune mission/i);
  });

  it("55 — driver_name stays a display field: it is not the assignment link", () => {
    // assignTransport writes only display columns; the link is driver_user_id.
    const fn = TRANSPORT_ACTIONS.slice(
      TRANSPORT_ACTIONS.indexOf("export async function assignTransport"),
      TRANSPORT_ACTIONS.indexOf("export async function changeTransportStatus"),
    );
    expect(fn).not.toContain("driver_user_id");
    expect(DRIVER_ACTIONS).toContain("driver_user_id: driverUserId");
  });

  it("56 — WES-1 introduces no mission entity (that is WES-6)", () => {
    const changed = [TRANSPORT_ACTIONS, DRIVER_ACTIONS, HANDOFF_SERVICE, PANEL, DRIVER_ASSIGN].join("\n");
    expect(changed).not.toMatch(/transport_mission|MissionEntity|createMission/);
  });
});

// ======================= scope discipline (57-60) ===========================

describe("WES-1 stayed inside its scope", () => {
  it("57 — no canonical projection, ratchet or unified progress was built", () => {
    const changed = [TRANSPORT_ACTIONS, CUSTOMS_ACTIONS, HANDOFF_SERVICE, read("../lib/handoffs/rules.ts")].join("\n");
    expect(changed).not.toMatch(/high_water|highWater|dossier_lifecycle_state|canonicalProjection/);
  });

  it("58 — no assignment ledger, policy registry, SLA engine or event ledger", () => {
    const changed = [TRANSPORT_ACTIONS, CUSTOMS_ACTIONS, HANDOFF_SERVICE, DRIVER_ACTIONS].join("\n");
    expect(changed).not.toMatch(/assignment_event|policy_version|business_event|sla_status/);
  });

  it("59 — no new business policy was hardcoded (only integrity guards)", () => {
    // The only new constants are the two protected-status lists, which prevent
    // corruption; no new seat, route, document requirement or threshold.
    const changed = [TRANSPORT_ACTIONS, CUSTOMS_ACTIONS, read("../lib/handoffs/rules.ts")].join("\n");
    expect(changed).not.toMatch(/CUSTOMS_FIELD_AGENT|CHIEF_OF_TRANSIT|warningHours|criticalHours/);
  });

  it("60 — the reused rank tables are imported, not duplicated", () => {
    const rules = read("../lib/handoffs/rules.ts");
    expect(rules).toMatch(/import \{ CUSTOMS_RANK, TRANSPORT_RANK.*\} from "@\/lib\/files\/lifecycle"/);
    expect(rules).not.toMatch(/DOCUMENTS_PENDING:\s*1/); // no second copy of the table
  });
});
