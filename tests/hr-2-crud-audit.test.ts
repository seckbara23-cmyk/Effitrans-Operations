/**
 * EFFITRANS-HR-2 — master data & registry CRUD audit: premises pinned.
 * ---------------------------------------------------------------------------
 * The audit's conclusions rest on a handful of verifiable facts about what
 * exists TODAY. These hold them still until HR-C1/HR-B3 deliberately move them
 * — each guard is that phase's mutation target, so a failure marks intentional
 * landing, not decay.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ORG = "lib/hr/organization-actions.ts";
const ACTIONS = "lib/hr/actions.ts";

describe("the registry is complete and its rules hold", () => {
  it("the matricule is untouchable through update", () => {
    const s = code(ACTIONS);
    const upd = s.slice(s.indexOf("export async function updateEmployee"), s.indexOf("export async function transitionEmployee"));
    expect(upd).not.toMatch(/employee_number|employeeNumber/);
  });

  it("duplicate prevention is database-level on all three master tables", () => {
    const m = code("supabase/migrations/20260801000001_hr_organization_foundation.sql");
    expect(m).toContain("uq_hr_org_unit_code");
    expect(m).toContain("unique (tenant_id, title)");
    expect(m).toContain("unique (tenant_id, name)");
    expect(m).toContain("uq_employee_open_primary_assignment");
  });
});

describe("master data is create-only today — the HR-C1 mutation targets", () => {
  it("HR-C1 landed: the three update actions exist, under the config authority", () => {
    // These pins moved deliberately when HR-C1 shipped the corrections the
    // audit found missing. Each update loads the current row tenant-scoped and
    // re-checks hr:config:manage server-side.
    const s = code(ORG);
    for (const fn of ["updateOrgUnit", "updatePosition", "updateWorkLocation"]) {
      const body = s.slice(s.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 600), fn).toContain('assertPermission("hr:config:manage")');
      expect(body.slice(0, 1400), fn).toContain('.eq("tenant_id", admin.tenantId)');
    }
  });

  it("HR-C1 landed: positions and sites can now be deactivated too", () => {
    const s = code(ORG);
    for (const fn of ["setOrgUnitActive", "setPositionActive", "setWorkLocationActive"]) {
      expect(s, fn).toContain(`export async function ${fn}`);
    }
    // Still deactivation, never deletion — no destructive path on the master
    // tables. (Staging-row cleanup during re-validation is a different thing.)
    for (const tbl of ["hr_org_unit", "hr_position", "hr_work_location"]) {
      expect(s, tbl).not.toMatch(new RegExp(`from\("${tbl}"\)\s*\.delete`));
    }
  });
});

describe("the import pipeline — real, four-eyed, shallow, endless", () => {
  it("EMPLOYEES is a supported import kind with the code's own template", () => {
    const s = read(ORG);
    expect(s).toContain('"ORG_UNITS" | "POSITIONS" | "WORK_LOCATIONS" | "EMPLOYEES"');
    // The current template contract, verbatim — HR-B3 extends exactly this.
    expect(s).toContain('required: ["first_name", "last_name", "department"]');
    expect(s).toContain('optional: ["employee_number", "job_title", "email", "phone", "status", "hire_date"]');
  });

  it("validation is exactly four checks deep — no duplicate or reference logic", () => {
    // The HR-B3 work list, stated as absences. Any of these appearing outside
    // that phase would be an unaudited validation change.
    const s = code(ORG);
    const validate = s.slice(s.indexOf("export async function validateHrImport"), s.indexOf("export async function submitHrImport"));
    expect(validate).toContain("invalid_date");
    expect(validate).toContain("invalid_department");
    expect(validate).not.toMatch(/duplicate|professional_email|manager|position_id|work_location_id/);
  });

  it("CSV only — the studio does not accept Excel yet", () => {
    expect(read("components/hr/import-studio.tsx")).toContain('accept=".csv,text/csv"');
    expect(read("components/hr/import-studio.tsx")).not.toMatch(/xlsx|spreadsheetml/);
  });

  it("no template download exists yet", () => {
    expect(code("components/hr/import-studio.tsx") + code("app/departments/hr/imports/page.tsx"))
      .not.toMatch(/Télécharger le modèle|download.*template|template.*download/i);
  });

  it("the pipeline still stops at READY and the four-eyes visa is identity-enforced", () => {
    const s = read(ORG);
    expect(s).toContain("THE PIPELINE STOPS AT READY");
    const approve = code(ORG).slice(code(ORG).indexOf("export async function approveHrImport"));
    expect(approve.slice(0, 800)).toContain("batch.submitted_by === admin.id");
  });

  it("the audit is on the record with the dual-manager coherence note", () => {
    const doc = read("docs/hr/hr-2-master-data-crud-audit.md");
    expect(doc).toContain("create-only");
    expect(doc).toContain("the manager exists TWICE");
    expect(doc).toContain("THE PIPELINE STOPS AT READY");
  });
});
