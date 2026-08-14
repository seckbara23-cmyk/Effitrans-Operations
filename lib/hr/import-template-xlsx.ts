/**
 * HR-B3A — the downloadable employee template WORKBOOK. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * One place builds the file the route serves and the tests open, so the two
 * can never drift. Layout decisions here all answer a production UAT finding:
 *
 *   * Sheet 1 « Employes » holds the HEADERS ONLY — the old guidance row under
 *     the headers was staged as an employee (« 3 lignes détectées » for 2).
 *     Documentation lives in sheet 2 « Instructions », which the parser (first
 *     sheet only) structurally cannot read as data.
 *   * The phone column is TEXT-formatted (numFmt 49) so +221770000001 survives
 *     typing — General format turned it numeric/scientific and dropped the +.
 *   * The hire-date column carries a yyyy-mm-dd date format: Excel accepts the
 *     operator's locale entry (14/08/2026), stores the day serial the importer
 *     already converts, and DISPLAYS the canonical form.
 *   * The three closed-vocabulary columns get dropdowns whose values come from
 *     EMPLOYEE_TEMPLATE_VOCAB — derived from the authoritative registries,
 *     shown as the French labels the server canonicalizes back to codes.
 */
import { buildXlsxWorkbook, type XlsxSheet } from "./xlsx";
import {
  EMPLOYEE_TEMPLATE_COLUMNS,
  EMPLOYEE_TEMPLATE_VOCAB,
  employeeTemplateInstructionRows,
} from "./import-template";

const colIndex = (field: string): number =>
  EMPLOYEE_TEMPLATE_COLUMNS.findIndex((c) => c.field === field);

export function buildEmployeeImportTemplate(): Uint8Array {
  const headers = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => (c.required ? `${c.headerFr} *` : c.headerFr));

  const dataSheet: XlsxSheet = {
    name: "Employes",
    // HEADERS ONLY — never an instructional/example row in the data region.
    rows: [headers],
    colWidths: Object.fromEntries(
      EMPLOYEE_TEMPLATE_COLUMNS.map((c, i) => [i, Math.max(18, c.headerFr.length + 6)]),
    ),
    colStyles: {
      [colIndex("professional_phone")]: "text",
      [colIndex("hire_date")]: "date",
    },
    validations: (["department", "employment_type", "status"] as const).map((field) => ({
      col: colIndex(field),
      values: EMPLOYEE_TEMPLATE_VOCAB[field].map((e) => e.labelFr),
    })),
  };

  const instructionsSheet: XlsxSheet = {
    name: "Instructions",
    rows: employeeTemplateInstructionRows(),
    colWidths: { 0: 26, 1: 12, 2: 110 },
  };

  return buildXlsxWorkbook([dataSheet, instructionsSheet]);
}
