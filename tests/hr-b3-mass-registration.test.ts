/**
 * EFFITRANS-HR-B3 — mass employee registration.
 * ---------------------------------------------------------------------------
 * The pipeline HR-1 froze at READY is complete: template → upload (xlsx/csv) →
 * deep validation → preview → four-eyes visa → APPLY → report. The invariants
 * this suite defends, in order of what they cost if lost:
 *
 *   1. ONLY the apply transition creates employees, and only through
 *      createEmployee — the same matricule engine, target validation and
 *      ledger event as an individual registration. A parallel insert path is
 *      the one unforgivable regression.
 *   2. Four-eyes survives activation: the submitter still cannot approve, and
 *      apply enters only from a visa'd state.
 *   3. A retry cannot duplicate: applied rows carry their employee_id and are
 *      skipped; a partial failure is never reported as fully successful.
 *   4. The xlsx layer actually works — proven by ROUNDTRIP, not by structure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildXlsx, parseXlsx, looksLikeZip } from "@/lib/hr/xlsx";
import {
  EMPLOYEE_TEMPLATE_COLUMNS,
  EMPLOYEE_TEMPLATE_REQUIRED,
  EMPLOYEE_IMPORT_ALLOWED_STATUSES,
  autoMapEmployeeHeaders,
  excelSerialToIsoDate,
} from "@/lib/hr/import-template";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ORG = "lib/hr/organization-actions.ts";
const MIGRATION = "supabase/migrations/20260829000001_hr_import_apply.sql";

function action(name: string): string {
  const s = code(ORG);
  const i = s.indexOf(`export async function ${name}`);
  expect(i, name).toBeGreaterThan(-1);
  const j = s.indexOf("export async function", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

// ===========================================================================
describe("the xlsx layer, proven by roundtrip", () => {
  it("the template builds, is a real zip, and parses back to itself", () => {
    const headers = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => (c.required ? `${c.headerFr} *` : c.headerFr));
    const hints = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => c.hintFr);
    const bytes = buildXlsx("Employes", [headers, hints]);

    expect(looksLikeZip(bytes)).toBe(true);
    const rows = parseXlsx(bytes);
    expect(rows[0]).toEqual(headers);
    expect(rows[1]).toEqual(hints);
  });

  it("the template's own headers auto-map onto EVERY field — asterisk included", () => {
    const headers = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => (c.required ? `${c.headerFr} *` : c.headerFr));
    const mapping = autoMapEmployeeHeaders(headers);
    for (const col of EMPLOYEE_TEMPLATE_COLUMNS) {
      expect(mapping[col.field], col.field).toBeDefined();
    }
  });

  it("accents and case do not break the mapping; unknown headers map to nothing", () => {
    const mapping = autoMapEmployeeHeaders(["PRENOM", "nom", "Date d'entree", "Colonne Mystere"]);
    expect(mapping.first_name).toBe("PRENOM");
    expect(mapping.last_name).toBe("nom");
    expect(mapping.hire_date).toBe("Date d'entree");
    expect(Object.values(mapping)).not.toContain("Colonne Mystere");
  });

  it("special characters survive the roundtrip", () => {
    const rows = [["Prénom & <Nom>", 'Sy "Général"'], ["N'Diaye", "Ba"]];
    expect(parseXlsx(buildXlsx("T", rows))).toEqual(rows);
  });

  it("Excel day serials convert; everything else passes through", () => {
    expect(excelSerialToIsoDate("46266")).toBe("2026-09-01");
    expect(excelSerialToIsoDate("2026-09-01")).toBe("2026-09-01");
    expect(excelSerialToIsoDate("123")).toBe("123");        // out of range
    expect(excelSerialToIsoDate("abc")).toBe("abc");
  });
});

// ===========================================================================
describe("the template contract", () => {
  it("required is exactly the registry's own minimum; no matricule column exists", () => {
    expect([...EMPLOYEE_TEMPLATE_REQUIRED].sort()).toEqual(["department", "first_name", "last_name"]);
    expect(EMPLOYEE_TEMPLATE_COLUMNS.some((c) => c.field === "employee_number")).toBe(false);
    // Import may only create DRAFT or ACTIVE — never suspend or terminate.
    expect([...EMPLOYEE_IMPORT_ALLOWED_STATUSES]).toEqual(["DRAFT", "ACTIVE"]);
  });

  it("every column maps to something the registry genuinely consumes", () => {
    // The apply stage builds CreateEmployeeInput from exactly these fields.
    const apply = action("applyHrImport");
    const consumed: Record<string, string> = {
      first_name: "firstName", last_name: "lastName", department: "department",
      professional_email: "professionalEmail", professional_phone: "professionalPhone",
      employment_type: "employmentType", hire_date: "hireDate",
      position: "jobTitle", work_location: "workLocation",
    };
    for (const [field, input] of Object.entries(consumed)) {
      expect(apply, `${field} → ${input}`).toContain(`${input}: p.${field}`);
    }
    // The two resolved references travel by id, resolved at validation.
    expect(apply).toContain("managerEmployeeId: p.manager_employee_id");
    expect(apply).toContain("orgUnitId: p.org_unit_id");
  });
});

// ===========================================================================
describe("only the apply transition creates employees", () => {
  it("stage, validate, submit and approve contain NO creation of any kind", () => {
    for (const name of ["stageHrImport", "stageHrImportFile", "validateHrImport", "submitHrImport", "approveHrImport"]) {
      const b = action(name);
      expect(b, name).not.toContain("createEmployee");
      expect(b, name).not.toMatch(/from\("employee"\)\s*\.insert/);
      expect(b, name).not.toContain("next_employee_number");
    }
  });

  it("apply creates exclusively through createEmployee — never an insert, never a second matricule path", () => {
    // THE MUTATION TARGET. Replacing createEmployee with a direct insert would
    // bypass the matricule engine, the target validation, the duplicate policy
    // and the ledger event at once.
    const apply = action("applyHrImport");
    expect(apply).toContain("createEmployee(");
    expect(apply).not.toMatch(/from\("employee"\)\s*\.insert/);
    expect(apply).not.toContain("next_employee_number");
    // Activation goes through the existing lifecycle action, its own audit.
    expect(apply).toContain('transitionEmployee(res.id!, "ACTIVE")');
  });

  it("allowDuplicateName is passed deliberately, because validation already policed it", () => {
    expect(action("applyHrImport")).toContain("allowDuplicateName: true");
    // …and the validator DID police it: both in-file and against production.
    const s = code(ORG);
    expect(s).toContain('"duplicate_name_in_file"');
    expect(s).toContain('"employee_exists"');
  });

  it("bulk creation opens no application account and grants nothing", () => {
    const apply = action("applyHrImport");
    expect(apply).not.toMatch(/app_user|auth\.users|linkEmployeeAccount|user_role|role_permission/);
  });
});

// ===========================================================================
describe("four-eyes, double submission and retry", () => {
  it("the visa is identity-enforced and apply enters only from a visa'd state", () => {
    const approve = action("approveHrImport");
    expect(approve).toContain("batch.submitted_by === admin.id");
    const apply = action("applyHrImport");
    expect(apply).toContain('.in("status", ["READY", "APPLIED_WITH_ERRORS"])');
    // The CAS selects — zero rows means someone else took it. Refused by state.
    expect(apply).toContain('.select("id")');
    expect(apply).toContain('status: "APPLYING"');
  });

  it("a retry skips rows that already became employees", () => {
    const apply = action("applyHrImport");
    expect(apply).toMatch(/if \(r\.employee_id\)/);
    expect(apply.indexOf("if (r.employee_id)")).toBeLessThan(apply.indexOf("createEmployee("));
  });

  it("a partial failure is APPLIED_WITH_ERRORS — never a false success", () => {
    const apply = action("applyHrImport");
    expect(apply).toContain('failed > 0 ? "APPLIED_WITH_ERRORS" : "APPLIED"');
    expect(apply).toContain("applied_count: applied");
    expect(apply).toContain("failed_count: failed");
  });

  it("the batch lifecycle is audited at application", () => {
    const apply = action("applyHrImport");
    expect(apply).toContain('action: "hr.import_applied"');
    expect(apply).toContain("after: { status: finalStatus, applied, failed }");
  });
});

// ===========================================================================
describe("migration 107 and the operator surface", () => {
  it("107 is additive, re-run safe, and keeps the visa invariant", () => {
    const m = read(MIGRATION);
    expect(m).toContain("add column if not exists");
    expect(m).not.toMatch(/drop (table|column)/i);
    expect(m).toContain("hr_import_batch_applied_visa");
    expect(m).toContain("READY must still require a visa");
    // Ledger consistency, the durable way.
    const migrations = require("node:fs")
      .readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql"));
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    expect(migrations).toContain("20260829000001_hr_import_apply.sql");
  });

  it("the registry offers « Importer des employés » beside manual creation", () => {
    expect(read("app/departments/hr/registre/page.tsx")).toContain("Importer des employés");
  });

  it("the single-officer wait is stated, not mysterious", () => {
    expect(read("components/hr/import-studio.tsx"))
      .toContain("En attente du visa d&apos;un second responsable RH");
  });

  it("the report maps rows to matricules and is exportable", () => {
    const s = read("components/hr/import-studio.tsx");
    expect(s).toContain("employé(s) importé(s)");
    expect(s).toContain("Exporter le rapport (CSV)");
    expect(code("lib/hr/organization.ts")).toContain("listImportOutcomes");
  });

  it("the preview speaks the required sentence shape", () => {
    const s = read("components/hr/import-studio.tsx");
    expect(s).toContain("ligne(s) détectée(s)");
    expect(s).toContain("prête(s) à importer");
    expect(s).toContain("à corriger");
  });
});
