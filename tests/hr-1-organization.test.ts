/**
 * HR-1 — Organization Foundation, structural contracts.
 * ---------------------------------------------------------------------------
 * Pins what the frozen architecture (HR-0F) demands of migration 73 and the
 * HR-1 surfaces, so a later change cannot quietly weaken it:
 *   * the two HRQ-D2 permissions are catalog-only — granted to NO role (B1)
 *   * org tables carry RLS + the ratified triggers/CHECKs
 *   * the import pipeline stops at READY — no apply/activate code exists
 *   * the dashboard is the hub page; the registry moved to /registre
 *   * HR stays under MANAGEMENT — DÉPARTEMENTS keeps its ratified 3 entries
 *   * the buildOrgTree helper arranges and orders the forest correctly
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOrgTree, UNIT_KINDS } from "@/lib/hr/org-tree";
import type { HrOrgUnit } from "@/lib/hr/org-tree";
import { navSections } from "@/lib/nav";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260801000001_hr_organization_foundation.sql";
const ACTIONS = "lib/hr/organization-actions.ts";

// ---------------------------------------------------------------------------
describe("B1 pause — the two permissions exist and are granted to nobody", () => {
  const m = sql(MIGRATION);

  it("inserts exactly the two ratified codes, no invented ones", () => {
    expect(m).toContain("'hr:config:manage'");
    expect(m).toContain("'hr:sensitive:read'");
    // No hr:import:*, hr:leave:* etc. — those belong to the ratified family, later.
    expect(m).not.toMatch(/hr:import:|hr:leave:|hr:comp:/);
  });

  it("writes NO role_permission row — activation is a later grant migration", () => {
    expect(m).not.toContain("role_permission");
  });

  it("grants nothing to SYSTEM_ADMIN anywhere (DEC-B25)", () => {
    expect(m).not.toContain("SYSTEM_ADMIN");
  });
});

// ---------------------------------------------------------------------------
describe("migration 73 — structures of the frozen architecture", () => {
  const m = sql(MIGRATION);

  it("creates the nine tables", () => {
    for (const t of [
      "hr_configuration", "hr_org_unit", "hr_position", "hr_work_location",
      "employee_assignment", "hr_employee_event",
      "hr_import_batch", "hr_import_staging_row", "hr_import_error",
    ]) {
      expect(m, t).toContain(`create table if not exists public.${t}`);
    }
  });

  it("every table gets RLS enabled and a SELECT policy", () => {
    for (const t of [
      "hr_configuration", "hr_org_unit", "hr_position", "hr_work_location",
      "employee_assignment", "hr_employee_event",
      "hr_import_batch", "hr_import_staging_row", "hr_import_error",
    ]) {
      expect(m, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(m, t).toContain(`create policy ${t}_select`);
    }
  });

  it("import tables gate on hr:manage; directory tables on hr:read", () => {
    const batchPolicy = m.slice(m.indexOf("create policy hr_import_batch_select"));
    expect(batchPolicy.slice(0, 300)).toContain("has_permission('hr:manage')");
    const unitPolicy = m.slice(m.indexOf("create policy hr_org_unit_select"));
    expect(unitPolicy.slice(0, 300)).toContain("has_permission('hr:read')");
  });

  it("kind order is trigger-enforced and strictly descending", () => {
    expect(m).toContain("hr_org_unit_check_parent");
    expect(m).toContain("if rank_parent >= rank_child then");
  });

  it("one open PRIMARY assignment per employee (partial unique)", () => {
    expect(m).toContain("uq_employee_open_primary_assignment");
    expect(m).toContain("where effective_to is null and assignment_kind = 'PRIMARY'");
  });

  it("the Timeline ledger is append-only via prevent_mutation", () => {
    expect(m).toContain("trg_hr_employee_event_immutable");
    expect(m).toContain("prevent_mutation");
  });

  it("the matricule is immutable — UPDATE-only trigger (no DELETE branch trap)", () => {
    expect(m).toContain("employee_number_immutable");
    expect(m).toContain("before update on public.employee");
    expect(m).not.toMatch(/employee_number_immutable[\s\S]{0,400}or delete on public\.employee/);
  });

  it("maker-checker is structural: approver differs; READY requires approval", () => {
    expect(m).toContain("hr_batch_approver_differs");
    expect(m).toContain("approved_by <> submitted_by");
    expect(m).toContain("hr_batch_ready_requires_approval");
  });

  it("staging has NO applied/accepted state and no created_* linkage column", () => {
    expect(m).toContain("check (status in ('PENDING', 'VALID', 'REJECTED'))");
    const staging = m.slice(m.indexOf("hr_import_staging_row"), m.indexOf("hr_import_error"));
    expect(staging).not.toMatch(/created_\w+_id/);
  });
});

// ---------------------------------------------------------------------------
describe("the pipeline stops at READY — nothing applies a batch", () => {
  it("no apply/activate action exists in the actions module", () => {
    const a = code(ACTIONS);
    expect(a).not.toMatch(/applyHrImport|activateHrImport|executeHrImport/);
    // Approval writes READY and nothing else touches hr_org_unit from a batch.
    expect(a).not.toMatch(/from\("hr_org_unit"\)[\s\S]{0,200}batch/);
  });

  it("approval refuses the submitter (server pre-check names the refusal)", () => {
    expect(code(ACTIONS)).toContain('if (batch.submitted_by === admin.id) return { ok: false, error: "same_actor" }');
  });
});

// ---------------------------------------------------------------------------
describe("navigation & pages — ratified placement", () => {
  it("DÉPARTEMENTS keeps its ratified 3 entries; HR stays under MANAGEMENT", () => {
    const departments = navSections.find((s) => s.key === "departments")!;
    expect(departments.items.map((i) => i.key)).toEqual(["operations", "transit", "finance"]);
    const management = navSections.find((s) => s.key === "management")!;
    const hr = management.items.find((i) => i.key === "hr")!;
    expect(hr.href).toBe("/departments/hr");
    expect(hr.permission).toBe("hr:read");
  });

  it("the hub is the dashboard; the registry lives at /registre", () => {
    const dash = read("app/departments/hr/page.tsx");
    expect(dash).toContain("Tableau de bord RH");
    expect(dash).not.toContain("EmployeeCreateForm"); // no employee CRUD on the dashboard
    const registre = read("app/departments/hr/registre/page.tsx");
    expect(registre).toContain("EmployeeCreateForm"); // the shipped registry, moved intact
  });

  it("dark cards name their phase instead of linking nowhere", () => {
    const dash = read("app/departments/hr/page.tsx");
    // HR-4 then HR-5 turned earlier tiles into live workspaces; Performance stays dark.
    for (const phase of ["HR-6"]) expect(dash).toContain(phase);
    expect(dash).toContain('aria-disabled="true"');
  });

  it("the configuration page names the HRQ-D2 dependency instead of a silent 404", () => {
    expect(read("app/departments/hr/configuration/page.tsx")).toContain("HRQ-D2");
  });

  it("HR-1 pages gate on hr:read server-side", () => {
    for (const p of [
      "app/departments/hr/page.tsx",
      "app/departments/hr/organisation/page.tsx",
      "app/departments/hr/configuration/page.tsx",
      "app/departments/hr/imports/page.tsx",
    ]) {
      expect(code(p), p).toContain('hasPermission(permissions, "hr:read")');
    }
  });

  it("the tree is read-only — no drag, no client mutation on the organisation page", () => {
    const page = code("app/departments/hr/organisation/page.tsx"); // comments stripped
    expect(page).not.toContain('"use client"');
    expect(page).not.toMatch(/drag|onDrop|Draggable/i);
  });
});

// ---------------------------------------------------------------------------
describe("ci.yml runs the new RLS suite, appended last", () => {
  it("the step exists after the aging suite and before Supabase stop", () => {
    const ci = read(".github/workflows/ci.yml");
    const aging = ci.indexOf("rls_aging_balance_test.sql");
    const hr1 = ci.indexOf("rls_hr_organization_test.sql");
    const stop = ci.indexOf("Stop local Supabase");
    expect(aging).toBeGreaterThan(-1);
    expect(hr1).toBeGreaterThan(aging);
    expect(stop).toBeGreaterThan(hr1);
    expect(ci).toContain("::error::HR-1 Organization Foundation suite failed");
  });
});

// ---------------------------------------------------------------------------
describe("buildOrgTree — the pure helper", () => {
  const unit = (over: Partial<HrOrgUnit>): HrOrgUnit => ({
    id: "u", tenant_id: "t", parent_id: null, unit_kind: "DEPARTMENT", name: "X",
    code: null, canonical_department: null, is_active: true,
    created_at: "", updated_at: "", ...over,
  });

  it("arranges a forest and orders kinds by rank then name", () => {
    const tree = buildOrgTree([
      unit({ id: "team", parent_id: "dep", unit_kind: "TEAM", name: "Quai" }),
      unit({ id: "dep", unit_kind: "DEPARTMENT", name: "Exploitation" }),
      unit({ id: "bu", unit_kind: "BUSINESS_UNIT", name: "Direction Générale" }),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["bu", "dep"]);
    expect(tree[1].children.map((n) => n.id)).toEqual(["team"]);
  });

  it("an orphaned child (inactive parent chain) still renders as a root, never disappears", () => {
    const tree = buildOrgTree([unit({ id: "s", parent_id: "missing", unit_kind: "SECTION", name: "S" })]);
    expect(tree.map((n) => n.id)).toEqual(["s"]);
  });

  it("kind vocabulary matches the migration exactly", () => {
    const m = sql(MIGRATION);
    for (const k of UNIT_KINDS) expect(m).toContain(`'${k}'`);
  });
});
