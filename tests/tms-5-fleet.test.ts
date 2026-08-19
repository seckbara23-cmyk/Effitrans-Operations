/**
 * TMS-5 — Parc & Flotte (lightweight fleet).
 * ---------------------------------------------------------------------------
 * Behavioural proofs (interlock, tenant triggers, uniqueness, the one-open-
 * immobilization invariant) live in supabase/tests/tms_5_fleet_test.sql against
 * a real Postgres. What THIS suite guards is what a static reader can prove:
 * that no new authority was invented, that « En mission » stays DERIVED, that
 * the excluded fleet-ERP surface never appeared, and that the boundaries with
 * HR custody and TMS-6 subcontractors hold.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");

const MIGRATION = "20260908000001_fleet_registry.sql";
const migration = read("supabase", "migrations", MIGRATION);
const migrationCode = strip(migration);
const actionsRaw = read("lib", "fleet", "actions.ts");
const serviceRaw = read("lib", "fleet", "service.ts");
// Comment-stripped: a doctrine comment that NAMES what is forbidden must not
// trip a pin that forbids it (the MAYA-P1.1 prosrc lesson, in TypeScript).
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const actions = stripTs(actionsRaw);
const service = stripTs(serviceRaw);
const templates = read("lib", "platform", "role-templates.ts");
const transportActions = read("lib", "transport", "actions.ts");
const page = read("app", "transport", "parc", "page.tsx");

// ============================================================== authority ====

describe("TMS-5 — the authority is the ratified transport one, nothing invented", () => {
  it("registering, editing and immobilizing ride transport:manage", () => {
    const manageGates = actions.match(/assertPermission\("transport:manage"\)/g) ?? [];
    // createVehicle, updateVehicle, setVehicleStatus, setVehicleActive,
    // upsertVehicleCompliance, openVehicleMaintenance, closeVehicleMaintenance,
    // and (TMS-5C) deleteVehicle — the destructive act rides the SAME authority.
    expect(manageGates.length).toBe(8);
    expect(actions).not.toContain('assertPermission("transport:read")');
  });

  it("reads ride transport:read — the same authority the RLS policies require", () => {
    // listFleet + listVehicleMaintenance assert directly; listAssignableVehicles
    // inherits the gate by calling listFleet.
    expect((service.match(/assertPermission\("transport:read"\)/g) ?? []).length).toBe(2);
    expect(migrationCode).toContain("public.has_permission('transport:read')");
  });

  it("binding a vehicle to a transport stays in the EXISTING assign path", () => {
    const patch = read("lib", "transport", "patch.ts");
    expect(patch).toContain('"vehicleId"');
    expect(patch).toContain('vehicleId: "vehicle_id"');
    const assignSlice = transportActions.slice(
      transportActions.indexOf("export async function assignTransport"),
      transportActions.indexOf("export async function changeTransportStatus"),
    );
    expect(assignSlice).toContain('assertPermission("transport:assign")');
    // The fleet module never BINDS a transport. TMS-5C added a READ of
    // transport_record (to refuse deleting a vehicle that already served), so
    // the guard is now what it always meant: no write, no bind.
    expect(actions).not.toMatch(/from\("transport_record"\)[\s\S]{0,160}?\.(insert|update|upsert|delete)\(/);
  });

  it("NO fleet permission was invented, in the migration or the templates", () => {
    for (const invented of ["fleet:manage", "fleet:read", "vehicle:manage", "vehicle:read", "parc:"]) {
      expect(templates, invented).not.toContain(invented);
    }
    // The migration NAMES those codes once — inside assertion 7a, which exists
    // precisely to refuse them. Everything before the assertions must be clean.
    const beforeAssertions = migrationCode.slice(0, migrationCode.indexOf("do $$"));
    for (const invented of ["fleet:manage", "fleet:read", "vehicle:manage", "vehicle:read"]) {
      expect(beforeAssertions, invented).not.toContain(invented);
    }
    expect(migrationCode).not.toContain("insert into public.permission");
    expect(migrationCode).not.toContain("insert into public.role_permission");
  });

  it("the ACCOUNT_MANAGER gains nothing — the parc is a Transport capability", () => {
    const amBlock = templates.slice(
      templates.indexOf('key: "ACCOUNT_MANAGER"'),
      templates.indexOf('key: "COORDINATOR"'),
    );
    expect(amBlock).not.toContain("transport:manage");
    expect(amBlock).not.toContain("transport:assign");
  });
});

// ====================================================== derived engagement ====

describe("TMS-5 — « En mission » is DERIVED, never a second state machine", () => {
  it("the status vocabulary carries no assignment value", () => {
    expect(migrationCode).toContain("check (status in ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'))");
    const statusBlock = migrationCode.slice(migrationCode.indexOf("status         text not null default 'AVAILABLE'"), migrationCode.indexOf("is_active"));
    expect(statusBlock).not.toContain("ASSIGNED");
    expect(statusBlock).not.toContain("MISSION");
  });

  it("engagement is computed from live transport records", () => {
    expect(service).toContain("ENGAGED_TRANSPORT_STATUSES");
    expect(service).toContain('.from("transport_record")');
    expect(service).toContain("engaged: engagedBy.has(v.id)");
  });

  it("no transport action ever writes a vehicle status (the execution machine stays untouched)", () => {
    expect(transportActions).not.toMatch(/from\("vehicle"\)[\s\S]{0,120}?\.update\(/);
    expect(transportActions).not.toContain('status: "MAINTENANCE"');
  });

  it("the transport state machine gained no state", () => {
    const status = read("lib", "transport", "status.ts");
    for (const invented of ["VEHICLE_ASSIGNED", "AWAITING_VEHICLE", "IMMOBILIZED"]) {
      expect(status, invented).not.toContain(invented);
    }
  });
});

// ========================================================== the interlock ====

describe("TMS-5 — a non-available vehicle cannot be dispatched", () => {
  it("the DB-side trigger refuses tenant mismatch, retired and non-AVAILABLE", () => {
    expect(migrationCode).toContain("create or replace function public.enforce_transport_vehicle()");
    expect(migrationCode).toContain("transport vehicle tenant mismatch");
    expect(migrationCode).toContain("retiré du parc");
    expect(migrationCode).toContain("n''est pas disponible");
    expect(migrationCode).toContain("create trigger trg_transport_vehicle before insert or update on public.transport_record");
  });

  it("compliance and maintenance carry their OWN tenant boundary (a child cannot cross tenants)", () => {
    expect(migrationCode).toContain("create or replace function public.enforce_vehicle_child_tenant()");
    expect(migrationCode).toContain("raise exception 'vehicle child tenant mismatch'");
    expect(migrationCode).toContain("create trigger trg_vehicle_compliance_tenant before insert or update on public.vehicle_compliance");
    expect(migrationCode).toContain("create trigger trg_vehicle_maintenance_tenant before insert or update on public.vehicle_maintenance");
  });

  it("an UNCHANGED binding is never re-litigated (a delivered transport keeps its vehicle)", () => {
    expect(migrationCode).toContain("new.vehicle_id is not distinct from old.vehicle_id");
  });

  it("the picker only offers vehicles the database would accept", () => {
    const slice = service.slice(service.indexOf("export async function listAssignableVehicles"));
    expect(slice).toContain('v.isActive && v.status === "AVAILABLE" && !v.engaged');
  });

  it("returning to service is refused while an immobilizing intervention is open", () => {
    const slice = actions.slice(
      actions.indexOf("export async function setVehicleStatus"),
      actions.indexOf("export async function setVehicleActive"),
    );
    expect(slice).toContain('.eq("immobilizing", true)');
    expect(slice).toContain('return { ok: false, error: "maintenance_open" }');
  });
});

// ============================================================== reuse ====

describe("TMS-5 — reuse, not duplication", () => {
  it("compliance expiry reuses the EXISTING classifier — no second one", () => {
    expect(service).toContain('from "@/lib/documents/expiry"');
    expect(service).toContain("classifyExpiry(c.expires_on");
    expect(service).not.toContain("function classifyExpiry");
  });

  it("compliance stores dates and references only — it is NOT a second document store", () => {
    const block = migrationCode.slice(
      migrationCode.indexOf("create table if not exists public.vehicle_compliance"),
      migrationCode.indexOf("create table if not exists public.vehicle_maintenance"),
    );
    for (const forbidden of ["storage_path", "mime_type", "size_bytes"]) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });

  it("HR equipment custody is untouched — the two models stay separate", () => {
    expect(migrationCode).not.toContain("hr_equipment");
    expect(actions).not.toContain("hr_equipment");
    expect(service).not.toContain("hr_equipment");
  });

  it("the maritime « Transporteurs » plane is not reused for road vehicles", () => {
    for (const maritime of ["ocean_vessel", "ocean_carrier"]) {
      expect(migrationCode, maritime).not.toContain(maritime);
      expect(service, maritime).not.toContain(maritime);
    }
  });

  it("vehicle master data is audited, and NOT pushed into the dossier-scoped event ledger", () => {
    expect(actions).toContain("AuditActions.VEHICLE_CREATED");
    expect(actions).toContain("AuditActions.VEHICLE_STATUS_CHANGED");
    expect(actions).toContain("AuditActions.VEHICLE_MAINTENANCE_OPENED");
    expect(actions).not.toContain("emit_business_event");
    expect(actions).not.toContain("business_event");
  });

  it("the three tables are registered as tenant-scoped (invisible to the guard otherwise)", () => {
    const registry = read("lib", "db", "tenant-tables.ts");
    for (const t of ["vehicle", "vehicle_compliance", "vehicle_maintenance"]) {
      expect(registry).toContain(`"${t}"`);
    }
  });
});

// ====================================================== TMS-6 boundary ====

describe("TMS-5 — the external-transport boundary is preserved for TMS-6", () => {
  it("vehicle_plate survives as the external/hired representation", () => {
    expect(migrationCode).not.toContain("drop column");
    expect(migrationCode).toContain("vehicle_plate");
    const transportMigration = read("supabase", "migrations", "20260615000003_create_transport.sql");
    expect(transportMigration).toContain("transport_company    text");
  });

  it("vehicle_id is nullable — an external vehicle needs no fleet row", () => {
    expect(migrationCode).toContain("add column if not exists vehicle_id uuid references public.vehicle (id)");
    expect(migrationCode).not.toMatch(/vehicle_id uuid not null/);
  });

  it("TMS-5's own migration pre-built no subcontractor registry", () => {
    // PIN MOVED (TMS-6, 2026-08-19): TMS-6 is the ratified phase for external
    // transport, so lib/subcontractors now exists BY DESIGN. What these cases
    // guarded — that the earlier phase did not pre-build it — is preserved by
    // asserting the boundary each phase actually owns.
    expect(migrationCode).not.toContain("subcontractor");
    expect(migrationCode).not.toContain("transport_provider");
  });
});

// ========================================================== scope guard ====

describe("TMS-5 — the excluded fleet-ERP surface never appeared", () => {
  it("no fuel, parts, workshop, costing, depreciation, telematics or route optimization", () => {
    const surfaces = [migrationCode, actions, service, page].join("\n").toLowerCase();
    for (const forbidden of [
      "fuel", "carburant", "spare_part", "piece_detachee", "workshop", "atelier",
      "depreciation", "amortissement", "telematic", "route_optim", "payroll", "invoice_carrier",
    ]) {
      expect(surfaces, forbidden).not.toContain(forbidden);
    }
  });

  it("maintenance stays lightweight: no cost, no supplier, no parts columns", () => {
    const block = migrationCode.slice(migrationCode.indexOf("create table if not exists public.vehicle_maintenance"));
    for (const forbidden of ["cost", "amount", "supplier", "garage", "part_"]) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });

  it("no per-trip mileage log — usage history is the transport_record back-reference", () => {
    expect(migrationCode).not.toContain("mileage_log");
    expect(migrationCode).not.toContain("trip_log");
    expect(migrationCode).toContain("idx_transport_record_vehicle");
  });

  it("build-info advanced to migration 117 as the stable pair", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    // PIN MOVED (TMS-5C): migration 118 now follows. The durable statement is
    // that TMS-5's migration sits where it always did, in ledger order.
    const idx = migrations.indexOf("20260907000001_shipment_geography.sql");
    expect(migrations[idx + 1]).toBe(MIGRATION);
    expect(migrations[idx + 2]).toBe("20260910000001_canonical_transport_department.sql");
    const buildInfo = read("lib", "platform", "ops", "build-info.ts");
    expect(Number(/MIGRATION_COUNT = (\d+)/.exec(buildInfo)![1])).toBe(migrations.length);
  });

  it("the SQL suite exists with its five cases and runs in CI", () => {
    const suite = read("supabase", "tests", "tms_5_fleet_test.sql");
    for (const c of ["TMS5-A", "TMS5-B", "TMS5-C", "TMS5-D", "TMS5-E"]) expect(suite).toContain(c);
    expect(read(".github", "workflows", "ci.yml")).toContain("-f supabase/tests/tms_5_fleet_test.sql");
  });
});
