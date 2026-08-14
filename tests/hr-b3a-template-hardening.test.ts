/**
 * EFFITRANS-HR-B3A — import template UAT hardening.
 * ---------------------------------------------------------------------------
 * Every test here answers a defect the production smoke test actually hit:
 *
 *   1. The guidance row under the headers was staged as an employee
 *      (« 3 lignes détectées » for 2 real rows) → the data sheet now holds
 *      HEADERS ONLY; documentation lives in a sheet the parser cannot read.
 *   2. Excel turned +221770000001 into a number (scientific display, + lost)
 *      → the phone column is TEXT-formatted; the parser expands scientific
 *      notation back to digits and always treats values as strings.
 *   3. 14/08/2026 was rejected → the date column carries a yyyy-mm-dd format
 *      so Excel stores the serial the importer already converts.
 *   4. FINANCE-not-Finance → closed vocabularies are DERIVED from their
 *      authoritative registries and the French labels canonicalize to codes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildXlsx, parseXlsx, expandScientific, looksLikeZip, _internals } from "@/lib/hr/xlsx";
import { buildEmployeeImportTemplate } from "@/lib/hr/import-template-xlsx";
import {
  EMPLOYEE_TEMPLATE_COLUMNS,
  EMPLOYEE_TEMPLATE_REQUIRED,
  EMPLOYEE_TEMPLATE_VOCAB,
  EMPLOYEE_IMPORT_ALLOWED_STATUSES,
  autoMapEmployeeHeaders,
  canonicalizeEmployeeVocab,
  excelSerialToIsoDate,
} from "@/lib/hr/import-template";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { EMPLOYMENT_TYPES } from "@/lib/hr/validate";
import { EMPLOYEE_STATUS_LABELS_FR } from "@/lib/hr/lifecycle";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ORG = "lib/hr/organization-actions.ts";

/** Decode the template's zip entries once for the structural assertions. */
function templateParts(): Map<string, string> {
  const entries = _internals.readZipEntries(buildEmployeeImportTemplate());
  const dec = new TextDecoder();
  return new Map([...entries].map(([k, v]) => [k, dec.decode(v)]));
}

const colLetterOf = (field: string): string => {
  const i = EMPLOYEE_TEMPLATE_COLUMNS.findIndex((c) => c.field === field);
  expect(i, field).toBeGreaterThan(-1);
  return String.fromCharCode(65 + i); // 12 columns — single letters suffice
};

// ===========================================================================
describe("the instructional-row trap is gone", () => {
  it("THE UAT REGRESSION: the fresh template's data sheet is headers ONLY — zero importable rows", () => {
    const bytes = buildEmployeeImportTemplate();
    expect(looksLikeZip(bytes)).toBe(true);
    const rows = parseXlsx(bytes); // the parser reads the FIRST sheet — the data sheet
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      EMPLOYEE_TEMPLATE_COLUMNS.map((c) => (c.required ? `${c.headerFr} *` : c.headerFr)),
    );
    // No guidance text anywhere in the data region.
    expect(rows.flat().join(" ")).not.toContain("Obligatoire —");
  });

  it("two employee rows under the template headers parse as exactly two employees", () => {
    const headers = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => (c.required ? `${c.headerFr} *` : c.headerFr));
    const emp = (fn: string) => [fn, "Ndiaye", "Finance", "", "+221770000001", "CDI", "2026-08-14"];
    const rows = parseXlsx(buildXlsx("Employes", [headers, emp("Awa"), emp("Moussa")]));
    const body = rows.slice(1).filter((cells) => cells.some((c) => c.trim() !== ""));
    expect(body).toHaveLength(2);
    // …and the headers still auto-map onto every field.
    const mapping = autoMapEmployeeHeaders(rows[0]);
    for (const col of EMPLOYEE_TEMPLATE_COLUMNS) expect(mapping[col.field], col.field).toBeDefined();
  });

  it("the documentation lives in an Instructions sheet the parser structurally never reads", () => {
    const parts = templateParts();
    expect(parts.get("xl/workbook.xml")).toMatch(/name="Employes"[^>]*sheetId="1"/);
    expect(parts.get("xl/workbook.xml")).toMatch(/name="Instructions"[^>]*sheetId="2"/);
    const instructions = parts.get("xl/worksheets/sheet2.xml") ?? "";
    expect(instructions).toContain("ligne 2");
    expect(instructions).toContain("matricule");
    // The staging path drops rows with no content at all — pinned at the source.
    expect(code(ORG)).toContain("rows.slice(1).filter((cells) => cells.some((c) => c.trim() !== \"\"))");
  });
});

// ===========================================================================
describe("phones survive Excel", () => {
  it("+221770000001 roundtrips exactly through build → parse", () => {
    const rows = [["Téléphone professionnel"], ["+221770000001"]];
    expect(parseXlsx(buildXlsx("T", rows))).toEqual(rows);
  });

  it("the template's phone column is TEXT-formatted (numFmt 49) via a column style", () => {
    const parts = templateParts();
    const styles = parts.get("xl/styles.xml") ?? "";
    expect(styles).toContain('numFmtId="49"');
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    const phoneCol = EMPLOYEE_TEMPLATE_COLUMNS.findIndex((c) => c.field === "professional_phone");
    expect(sheet).toMatch(new RegExp(`<col min="${phoneCol + 1}" max="${phoneCol + 1}"[^>]*style="1"`));
  });

  it("scientific notation from a numeric cell expands back to plain digits — exactly", () => {
    expect(expandScientific("2.21770000001E+11")).toBe("221770000001");
    expect(expandScientific("7.7E+8")).toBe("770000000");
    expect(expandScientific("221770000001")).toBe("221770000001"); // not scientific → untouched
    expect(expandScientific("1.5E-3")).toBe("1.5E-3"); // true fraction → never invented
  });

  it("the parser applies the expansion to numeric cells and always yields strings", () => {
    // Hand-build a worksheet whose cell is a NUMBER stored in scientific form —
    // what a foreign tool could emit for a numerified phone.
    const enc = new TextEncoder();
    const zip = _internals.buildZip([
      {
        name: "xl/worksheets/sheet1.xml",
        data: enc.encode(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
            `<sheetData><row r="1"><c r="A1"><v>2.21770000001E+11</v></c></row></sheetData></worksheet>`,
        ),
      },
    ]);
    expect(parseXlsx(zip)).toEqual([["221770000001"]]);
  });
});

// ===========================================================================
describe("dates are unmistakable", () => {
  it("the hire-date column carries the canonical yyyy-mm-dd date format", () => {
    const parts = templateParts();
    expect(parts.get("xl/styles.xml")).toContain('formatCode="yyyy\\-mm\\-dd"');
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    const dateCol = EMPLOYEE_TEMPLATE_COLUMNS.findIndex((c) => c.field === "hire_date");
    expect(sheet).toMatch(new RegExp(`<col min="${dateCol + 1}" max="${dateCol + 1}"[^>]*style="2"`));
  });

  it("date handling stays deterministic: serials convert, ISO passes, garbage is refused downstream", () => {
    expect(excelSerialToIsoDate("46266")).toBe("2026-09-01"); // what a date-formatted cell stores
    expect(excelSerialToIsoDate("2026-08-14")).toBe("2026-08-14");
    expect(excelSerialToIsoDate("14/08/2026")).toBe("14/08/2026"); // unchanged → validator rejects it
  });
});

// ===========================================================================
describe("closed vocabularies — one source of truth, human labels accepted", () => {
  it("the vocab is DERIVED from the authoritative registries, value for value", () => {
    expect(EMPLOYEE_TEMPLATE_VOCAB.department).toEqual(
      CANONICAL_DEPARTMENTS.map((d) => ({ code: d.code, labelFr: d.labelFr })),
    );
    expect(EMPLOYEE_TEMPLATE_VOCAB.employment_type.map((e) => e.code)).toEqual([...EMPLOYMENT_TYPES]);
    expect(EMPLOYEE_TEMPLATE_VOCAB.status).toEqual(
      EMPLOYEE_IMPORT_ALLOWED_STATUSES.map((s) => ({ code: s, labelFr: EMPLOYEE_STATUS_LABELS_FR[s] })),
    );
  });

  it("THE UAT FIX: French labels and any casing canonicalize to the exact code", () => {
    expect(canonicalizeEmployeeVocab("department", "Finance")).toBe("FINANCE");
    expect(canonicalizeEmployeeVocab("department", "Ressources humaines")).toBe("HUMAN_RESOURCES");
    expect(canonicalizeEmployeeVocab("department", "opérations")).toBe("OPERATIONS");
    expect(canonicalizeEmployeeVocab("employment_type", "cdi")).toBe("CDI");
    expect(canonicalizeEmployeeVocab("status", "Brouillon")).toBe("DRAFT");
    expect(canonicalizeEmployeeVocab("status", "Actif")).toBe("ACTIVE");
    // Deterministic: unknown values pass through unchanged for the validator to refuse.
    expect(canonicalizeEmployeeVocab("department", "Comptabilité")).toBe("Comptabilité");
    expect(canonicalizeEmployeeVocab("status", "Suspendu")).toBe("Suspendu");
  });

  it("the validator canonicalizes BEFORE the membership checks — server stays authoritative", () => {
    const s = code(ORG);
    const canon = s.indexOf("canonicalizeEmployeeVocab(f, parsed[f])");
    const membership = s.indexOf('"invalid_department"');
    expect(canon).toBeGreaterThan(-1);
    expect(canon).toBeLessThan(membership);
    // The hard-coded department list is GONE — derived from THE registry.
    expect(s).not.toMatch(/=\s*\["OPERATIONS",\s*"TRANSIT"/);
    expect(s).toContain('from "@/lib/organization/departments"');
  });

  it("the template's dropdowns offer exactly the registries' French labels", () => {
    const sheet = templateParts().get("xl/worksheets/sheet1.xml") ?? "";
    for (const field of ["department", "employment_type", "status"] as const) {
      const letter = colLetterOf(field);
      const block = new RegExp(`<dataValidation type="list" allowBlank="1"[^>]*sqref="${letter}2:${letter}\\d+">([\\s\\S]*?)</dataValidation>`).exec(sheet);
      expect(block, field).not.toBeNull();
      for (const e of EMPLOYEE_TEMPLATE_VOCAB[field]) expect(block![1], `${field}:${e.labelFr}`).toContain(e.labelFr);
    }
    // allowBlank: the optional columns stay OPTIONAL — a dropdown never makes a field required.
  });
});

// ===========================================================================
describe("nothing HR-B3 guaranteed has moved", () => {
  it("required fields, forbidden matricule column and allowed statuses are unchanged", () => {
    expect([...EMPLOYEE_TEMPLATE_REQUIRED].sort()).toEqual(["department", "first_name", "last_name"]);
    expect(EMPLOYEE_TEMPLATE_COLUMNS.some((c) => c.field === "employee_number")).toBe(false);
    expect([...EMPLOYEE_IMPORT_ALLOWED_STATUSES]).toEqual(["DRAFT", "ACTIVE"]);
    // org unit / position / site / manager remain optional (the UAT left them blank).
    for (const f of ["org_unit", "position", "work_location", "manager"]) {
      expect(EMPLOYEE_TEMPLATE_COLUMNS.find((c) => c.field === f)?.required, f).toBe(false);
    }
  });

  it("no migration was needed — the ledger count is untouched by this phase", () => {
    const migrations = require("node:fs")
      .readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql"));
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    // B3A itself shipped no migration — durable: no file carries its name.
    expect(migrations.some((f: string) => /b3a/i.test(f))).toBe(false);
    expect(migrations).toContain("20260829000001_hr_import_apply.sql");
  });

  it("apply still creates exclusively through createEmployee and four-eyes still stands", () => {
    const s = code(ORG);
    expect(s).toContain("export async function applyHrImport");
    expect(s).not.toMatch(/from\("employee"\)\s*\.insert/);
    expect(s).toContain("batch.submitted_by === admin.id");
    expect(s).toContain('.in("status", ["READY", "APPLIED_WITH_ERRORS"])');
  });
});
