/**
 * TMS-5C addendum — Parc & Flotte mutation reachability + controlled deletion.
 * ---------------------------------------------------------------------------
 * TWO production findings, and what the audit actually established:
 *
 * 1. The greyed-out controls were NOT an authorization problem. The session
 *    displaying « Chargé RH » also held SYSTEM_ADMIN, so `transport:manage` was
 *    genuinely present and the console rendered. The defect was a stale React
 *    initializer: `useState(vehicles[0]?.id)` captured "" on an EMPTY parc and
 *    never re-ran, so every `!target` control stayed disabled after the first
 *    vehicle was added — which is why production shows the vehicle with ZERO
 *    compliance and ZERO maintenance rows despite both forms being exercised.
 *
 * 2. There was no way to remove a test vehicle. Deletion now exists, refuses
 *    anything carrying operational evidence, and is decided server-side.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actionsRaw = read("lib", "fleet", "actions.ts");
const actions = stripTs(actionsRaw);
const console_ = read("components", "fleet", "fleet-console.tsx");
const parcPage = read("app", "transport", "parc", "page.tsx");
const migration117 = read("supabase", "migrations", "20260908000001_fleet_registry.sql");

const deleteSlice = actionsRaw.slice(actionsRaw.indexOf("export async function deleteVehicle"));

// ================================================= finding 1: reachability ====

describe("TMS-5C/1 — the selected vehicle survives a refresh (the real defect)", () => {
  it("the target is DERIVED from the current list, not frozen by useState", () => {
    expect(console_).toContain(
      'const target = vehicles.some((v) => v.id === picked) ? picked : (vehicles[0]?.id ?? "");',
    );
    // the stale initializer must not be what the controls read
    expect(console_).not.toContain('const [target, setTarget] = useState');
  });

  it("the picker writes the PICK, so an explicit choice still wins", () => {
    expect(console_).toContain("onChange={(e) => setPicked(e.target.value)}");
    expect(console_).toContain("value={target}");
  });

  it("a control disabled because the vehicle is ALREADY in that state says so", () => {
    expect(console_).toContain("const already = selected?.status === s;");
    expect(console_).toContain('title={already ? "Le véhicule est déjà dans cet état." : undefined}');
    expect(console_).toContain("État actuel :");
  });

  it("a reader without transport:manage gets an explanation, not grey buttons", () => {
    expect(parcPage).toContain("Consultation seule");
    expect(parcPage).toContain("relève du Responsable Transport");
    expect(parcPage).toContain("{canManage ? (");
  });
});

describe("TMS-5C/1 — authority is unchanged and server-side", () => {
  it("every fleet mutation still asserts transport:manage — the fix widened nothing", () => {
    // create, update, setStatus, setActive, compliance, openMaint, closeMaint, delete
    expect((actions.match(/assertPermission\("transport:manage"\)/g) ?? []).length).toBe(9); // TMS-1A: retire + reactivate replaced setVehicleActive
    expect(actions).not.toContain('assertPermission("transport:read")');
    expect(actions).not.toContain('assertPermission("hr:');
  });

  it("viewing stays transport:read; no new permission was invented", () => {
    expect(parcPage).toContain('hasPermission(permissions, "transport:read")');
    for (const invented of ["fleet:delete", "vehicle:delete", "fleet:manage"]) {
      expect(actionsRaw, invented).not.toContain(invented);
      expect(read("lib", "platform", "role-templates.ts"), invented).not.toContain(invented);
    }
  });

  it("client state can never authorize: every action re-reads the vehicle in ITS OWN tenant", () => {
    expect((actions.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});

// =================================================== finding 2: deletion ====

describe("TMS-5C/2 — permanent deletion is controlled, not a Delete button", () => {
  it("requires transport:manage and the vehicle must belong to the caller's tenant", () => {
    expect(deleteSlice).toContain('assertPermission("transport:manage")');
    expect(deleteSlice).toContain('.eq("tenant_id", user.tenantId)');
    expect(deleteSlice).toContain('return { ok: false, error: "not_found" }');
  });

  it("the destructive confirmation is re-checked SERVER-side against the registration", () => {
    expect(deleteSlice).toContain("!== vehicle.registration.toUpperCase()");
    expect(deleteSlice).toContain('return { ok: false, error: "confirmation_mismatch" }');
  });

  it("ANY transport reference — current or historical — refuses deletion", () => {
    expect(deleteSlice).toContain('.from("transport_record")');
    expect(deleteSlice).toContain('.eq("vehicle_id", id)');
    // Bound to the GUARD itself: `vehicle_in_use` also appears in the FK
    // backstop below, so asserting the bare string let the count check be
    // deleted while the pin still passed.
    expect(deleteSlice).toContain(
      'if ((transportRefs ?? 0) > 0) return { ok: false, error: "vehicle_in_use" };',
    );
  });

  it("ANY intervention history refuses deletion", () => {
    expect(deleteSlice).toContain('.from("vehicle_maintenance")');
    expect(deleteSlice).toContain(
      'if ((maintenanceRows ?? 0) > 0) return { ok: false, error: "vehicle_has_history" };',
    );
  });

  it("the database is the backstop — an FK violation maps to the same refusal", () => {
    expect(deleteSlice).toContain('if (error.code === "23503") return { ok: false, error: "vehicle_in_use" }');
    // transport_record.vehicle_id carries NO cascade, so the DB refuses too
    const fk = migration117.slice(migration117.indexOf("add column if not exists vehicle_id"));
    expect(fk.slice(0, 200)).not.toContain("on delete cascade");
    expect(fk.slice(0, 200)).not.toContain("on delete set null");
  });

  it("operational evidence is NEVER destroyed to make the delete succeed", () => {
    // no cascade is added, and nothing deletes transport or maintenance rows
    expect(deleteSlice).not.toMatch(/from\("transport_record"\)[\s\S]{0,80}\.delete\(/);
    expect(deleteSlice).not.toMatch(/from\("vehicle_maintenance"\)[\s\S]{0,80}\.delete\(/);
    expect(actions).not.toContain("force");
  });

  it("compliance is the ONE child with different retention — descriptive, cascades with the asset", () => {
    const compliance = migration117.slice(
      migration117.indexOf("create table if not exists public.vehicle_compliance"),
      migration117.indexOf("create table if not exists public.vehicle_maintenance"),
    );
    expect(compliance).toContain("references public.vehicle (id) on delete cascade");
    // and the disposition is written down, not implied
    expect(actionsRaw).toContain("DESCRIPTIVE master data");
  });

  it("the destructive act is audited with the registration, so the trail names what is gone", () => {
    expect(deleteSlice).toContain("AuditActions.VEHICLE_DELETED");
    expect(deleteSlice).toContain("before: { registration: vehicle.registration }");
    expect(read("lib", "audit", "events.ts")).toContain('VEHICLE_DELETED: "vehicle.deleted"');
  });

  it("the UI demands the immatriculation and names the vehicle being destroyed", () => {
    expect(console_).toContain("Suppression définitive");
    expect(console_).toContain("confirmDelete.trim().toUpperCase() !== selected.registration.toUpperCase()");
    expect(console_).toContain("deleteVehicle(target, confirmDelete.trim())");
    expect(console_).toContain("Mettre hors service");
  });

  it("retirement stays the path for a vehicle with history — deletion did not replace it", () => {
    expect(actions).toContain("export async function retireVehicle");
    expect(actions).toContain("export async function setVehicleStatus");
    expect(console_).toContain("vehicle_has_history");
  });

  it("the dispatch interlock is untouched by deletion", () => {
    expect(migration117).toContain("create or replace function public.enforce_transport_vehicle()");
    expect(migration117).toContain("n''est pas disponible");
    expect(actions).not.toContain("enforce_transport_vehicle");
  });
});

// ========================================================== the migration ====

describe("TMS-5C — the one schema change, and why it is not manufactured", () => {
  const migration = read("supabase", "migrations", "20260910000001_canonical_transport_department.sql");

  it("widens ONLY the process_blocker department CHECK — the single place the vocabulary is stored", () => {
    expect(migration).toContain("process_blocker_source_department_code_check");
    expect(migration).toContain("'OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES'");
    expect(migration).not.toContain("create table");
    expect(migration).not.toContain("insert into");
    expect(migration).not.toContain("create policy");
  });

  it("keeps every pre-existing code — a widening, never a replacement", () => {
    expect(migration).toContain("lost an existing code");
    // all three stored constraints are widened, not just the latent one
    for (const c of [
      "employee_department_check",
      "hr_org_unit_canonical_department_check",
      "process_blocker_source_department_code_check",
    ]) {
      expect(migration, c).toContain(c);
    }
    // …and nothing is rewritten
    expect(migration).not.toContain("update public.employee");
    expect(migration).not.toContain("update public.hr_org_unit");
  });

  // PIN MOVED (TMS-6, 2026-08-19): 119 now follows. The durable statement is
  // that TMS-5C's migration sits where it always did, in ledger order, and that
  // build-info stays consistent with the directory.
  it("migration 118 sits in ledger order and the ledger stays self-consistent", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = migrations.indexOf("20260908000001_fleet_registry.sql");
    expect(migrations[idx + 1]).toBe("20260910000001_canonical_transport_department.sql");
    const buildInfo = read("lib", "platform", "ops", "build-info.ts");
    expect(Number(/MIGRATION_COUNT = (\d+)/.exec(buildInfo)![1])).toBe(migrations.length);
  });
});
