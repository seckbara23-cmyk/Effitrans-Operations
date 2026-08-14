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
  it("EMPLOYEES is a supported import kind, and its contract lives in ONE module", () => {
    const s = read(ORG);
    expect(s).toContain('"ORG_UNITS" | "POSITIONS" | "WORK_LOCATIONS" | "EMPLOYEES"');
    // HR-B3 moved the contract to import-template.ts — shared by the xlsx
    // builder, the auto-mapper, the validator and the tests. The matricule is
    // deliberately NOT a column: numbers are minted at application.
    expect(s).toContain("required: [...EMPLOYEE_TEMPLATE_REQUIRED]");
    // The FIELD LIST has no matricule column (prose may mention the engine).
    const tpl = read("lib/hr/import-template.ts");
    expect(tpl).not.toMatch(/field: "employee_number"/);
  });

  it("HR-B3 landed: validation is deep — duplicates, references, managers", () => {
    const s = code(ORG);
    // The row validator resolves references and refuses what it cannot prove.
    for (const check of ["email_exists", "duplicate_in_file", "duplicate_name_in_file",
                         "unknown_unit", "inactive_unit", "unknown_position", "inactive_position",
                         "unknown_site", "inactive_site", "unknown_manager"]) {
      expect(s, check).toContain(`"${check}"`);
    }
    // …and nothing is ever CREATED from a spreadsheet value.
    const validator = s.slice(s.indexOf("function validateEmployeeRow"), s.indexOf("export async function validateHrImport"));
    expect(validator).not.toMatch(/\.insert\(/);
  });

  it("HR-B3 landed: Excel is accepted, server-parsed, size-limited", () => {
    expect(read("components/hr/import-studio.tsx")).toContain('accept=".xlsx,.csv');
    const s = read(ORG);
    // The limits are the SERVER's, not the file input's.
    expect(s).toContain("MAX_IMPORT_BYTES");
    expect(s).toContain("MAX_IMPORT_ROWS");
    expect(s).toContain('"file_too_large"');
  });

  it("HR-B3 landed: the template downloads from the shared contract", () => {
    expect(read("components/hr/import-studio.tsx")).toContain("Télécharger le modèle Excel");
    const route = read("app/departments/hr/imports/template/route.ts");
    expect(route).toContain("EMPLOYEE_TEMPLATE_COLUMNS");
    expect(route).toContain('hasPermission(permissions, "hr:manage")');
  });

  it("the four-eyes visa is identity-enforced, and apply comes only after it", () => {
    const approve = code(ORG).slice(code(ORG).indexOf("export async function approveHrImport"));
    expect(approve.slice(0, 800)).toContain("batch.submitted_by === admin.id");
    const apply = code(ORG).slice(code(ORG).indexOf("export async function applyHrImport"));
    expect(apply).toContain('.in("status", ["READY", "APPLIED_WITH_ERRORS"])');
  });

  it("the audit is on the record with the dual-manager coherence note", () => {
    const doc = read("docs/hr/hr-2-master-data-crud-audit.md");
    expect(doc).toContain("create-only");
    expect(doc).toContain("the manager exists TWICE");
    expect(doc).toContain("THE PIPELINE STOPS AT READY");
  });
});
