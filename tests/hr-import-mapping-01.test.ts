/**
 * HR-IMPORT-MAPPING-01 — slice 1: matching, prohibited data, the reporting line.
 * ---------------------------------------------------------------------------
 * WHAT PRODUCTION SHOWED. Effitrans HR uploaded its real workbook and every one
 * of 47 rows was refused on the same three fields. The audit separated four
 * causes, and this suite covers the three that are CODE:
 *
 *   MATCHING     « SIEGE » could never find « Siège ». Catalog lookups compared
 *                on trim+lowercase while the closed vocabularies folded accents,
 *                so one file had its Département accepted and its Site refused
 *                for the very same kind of difference.
 *   PROHIBITED   a reformatted workbook put national-ID numbers and gender under
 *                the template's headers; they were stored verbatim and then
 *                quoted back inside French validation messages. DEC-B27 forbids
 *                the registry those fields outright.
 *   REPORTING    « Responsable = OUSMANE SADIO » can never resolve: the rule
 *                takes identifiers, and at a first import nobody has a matricule
 *                yet — the platform mints them at application. Names must not
 *                resolve, and the ratified answer is two passes.
 *
 * The fourth cause is DATA (the catalogs hold one poste and one site) and is
 * deliberately not touched here: seeding production is a separate, governed act.
 *
 * These are behavioural tests. The rule they exercise was extracted from the
 * "use server" module for exactly that reason — a Next.js server file may export
 * nothing but async functions, so while it lived there every claim about it was
 * a source pin that passes whether or not the code is right.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hrFold, hrFoldEquals, resolveByFold } from "@/lib/hr/normalize";
import { forbiddenColumns, forbiddenColumnReason, FORBIDDEN_COLUMN_LABELS_FR } from "@/lib/hr/forbidden-columns";
import {
  validateEmployeeRow,
  type EmployeeImportRefs,
  type EmployeeRowProblem,
} from "@/lib/hr/import-validate";
import {
  EMPLOYEE_TEMPLATE_COLUMNS,
  autoMapEmployeeHeaders,
  employeeTemplateInstructionRows,
} from "@/lib/hr/import-template";
import { buildEmployeeImportTemplate } from "@/lib/hr/import-template-xlsx";
import { buildXlsx, parseXlsx } from "@/lib/hr/xlsx";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ORG = "lib/hr/organization-actions.ts";
const RULE = "lib/hr/import-validate.ts";

// ---------------------------------------------------------------- fixtures ----

/** The catalog as Effitrans would hold it once seeded — French spellings. */
const refs = (over: Partial<EmployeeImportRefs> = {}): EmployeeImportRefs => ({
  units: [
    { id: "u-fin", name: "Finance", code: "FIN", is_active: true },
    { id: "u-old", name: "Transit historique", code: "TRH", is_active: false },
  ],
  positions: [
    { title: "Déclarant en douane", is_active: true },
    { title: "Chauffeur", is_active: true },
    { title: "Agent de cotation", is_active: false },
  ],
  locations: [
    { name: "Siège", is_active: true },
    { name: "Entrepôt", is_active: false },
  ],
  employees: [
    {
      id: "e-chef", employee_number: "EMP-0001", professional_email: "ousmane.sadio@effitrans.sn",
      first_name: "Ousmane", last_name: "Sadio", status: "ACTIVE",
    },
    {
      id: "e-gone", employee_number: "EMP-0002", professional_email: "parti@effitrans.sn",
      first_name: "Ancien", last_name: "Collegue", status: "TERMINATED",
    },
  ],
  ...over,
});

function runRow(input: Record<string, string>, r: EmployeeImportRefs = refs()) {
  const parsed: Record<string, string> = {
    first_name: "Awa", last_name: "Ndiaye", department: "FINANCE", ...input,
  };
  const problems: EmployeeRowProblem[] = [];
  validateEmployeeRow(parsed, 2, r, new Map(), new Map(), problems);
  return { parsed, problems, codes: problems.map((p) => p.code) };
}

// ========================================================== NORMALIZATION ====

describe("the ratified fold — one rule, exact after folding", () => {
  it("01 — folds diacritics, case, and every shape of whitespace", () => {
    for (const written of ["SIEGE", "SIÈGE", "Siège", "siege", "  siège  ", "Siège", "SIÈGE"]) {
      expect(hrFold(written), written).toBe("siege");
    }
    // Excel copy-paste leaves non-breaking spaces and double spaces behind.
    expect(hrFold("DECLARANT  EN DOUANE")).toBe("declarant en douane");
    expect(hrFoldEquals("DECLARANT EN DOUANE", "Déclarant en douane")).toBe(true);
  });

  it("02 — and is NEVER fuzzy: a different word is a different value", () => {
    expect(hrFoldEquals("Chauffeur", "Chauffeurs")).toBe(false);
    expect(hrFoldEquals("Comptable", "Comptble")).toBe(false);
    expect(hrFoldEquals("Chef Transit", "Chef de Transit")).toBe(false);
    expect(hrFoldEquals("Siege", "Siege social")).toBe(false);
  });

  it("03 — resolution answers match, none or AMBIGUOUS — never a first guess", () => {
    const catalog = [{ t: "Chauffeur" }, { t: "Agent de transit" }];
    expect(resolveByFold(catalog, (c) => c.t, "CHAUFFEUR")).toEqual({ kind: "match", value: catalog[0] });
    expect(resolveByFold(catalog, (c) => c.t, "Cariste")).toEqual({ kind: "none" });
    // `unique (tenant_id, title)` is case-sensitive, so a catalog CAN hold both.
    const collided = [{ t: "Chauffeur" }, { t: "CHAUFFEUR" }];
    expect(resolveByFold(collided, (c) => c.t, "chauffeur")).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("04 — an empty needle resolves to nothing, not to an empty catalog key", () => {
    const catalog = [{ t: "" }, { t: "Chauffeur" }];
    expect(resolveByFold(catalog, (c) => c.t, "")).toEqual({ kind: "none" });
    expect(resolveByFold(catalog, (c) => c.t, "   ")).toEqual({ kind: "none" });
  });
});

// ============================================================== CATALOGUES ====

describe("catalog matching — the defect, and the boundaries around it", () => {
  it("05 — THE REGRESSION: HR's capitals find the catalog's French spelling", () => {
    const r = runRow({ position: "DECLARANT EN DOUANE", work_location: "SIEGE" });
    expect(r.codes).toEqual([]);
    // …and the CANONICAL spelling is what gets applied, not the file's.
    expect(r.parsed.position).toBe("Déclarant en douane");
    expect(r.parsed.work_location).toBe("Siège");
  });

  it("06 — an unknown poste is refused with a reason HR can act on", () => {
    const r = runRow({ position: "COORDONNATEUR AGENTS DE TRANSIT" });
    expect(r.codes).toEqual(["unknown_position"]);
    expect(r.problems[0].message_fr).toContain("COORDONNATEUR AGENTS DE TRANSIT");
    expect(r.problems[0].message_fr).toContain("introuvable au catalogue");
    expect(r.parsed.position).toBe("COORDONNATEUR AGENTS DE TRANSIT"); // never rewritten
  });

  it("07 — an unknown site and an unknown unit are refused the same way", () => {
    expect(runRow({ work_location: "TERRAIN" }).codes).toEqual(["unknown_site"]);
    expect(runRow({ org_unit: "105" }).codes).toEqual(["unknown_unit"]);
  });

  it("08 — AMBIGUITY IS A REFUSAL: the platform never picks one of two", () => {
    const collided = refs({
      positions: [{ title: "Chauffeur", is_active: true }, { title: "CHAUFFEUR", is_active: true }],
      locations: [{ name: "Siège", is_active: true }, { name: "SIEGE", is_active: true }],
    });
    const r = runRow({ position: "chauffeur", work_location: "siege" }, collided);
    expect(r.codes.sort()).toEqual(["ambiguous_position", "ambiguous_site"]);
    for (const p of r.problems) expect(p.message_fr).toContain("(2)");
    // Nothing was resolved — the value stays exactly as the file wrote it.
    expect(r.parsed.position).toBe("chauffeur");
    expect(r.parsed.work_location).toBe("siege");
  });

  it("09 — inactive is its own answer, not « introuvable » and not ambiguous", () => {
    expect(runRow({ position: "AGENT DE COTATION" }).codes).toEqual(["inactive_position"]);
    expect(runRow({ work_location: "ENTREPOT" }).codes).toEqual(["inactive_site"]);
    expect(runRow({ org_unit: "TRH" }).codes).toEqual(["inactive_unit"]);
  });

  it("10 — a unit resolves by CODE first, then by name, and yields its id", () => {
    expect(runRow({ org_unit: "fin" }).parsed.org_unit_id).toBe("u-fin");
    expect(runRow({ org_unit: "FINANCE" }).parsed.org_unit_id).toBe("u-fin");
  });

  it("11 — nothing is ever created from a spreadsheet value", () => {
    const s = code(RULE);
    expect(s).not.toMatch(/\.insert\(/);
    expect(s).not.toMatch(/getAdminSupabaseClient|createOrgUnit|createPosition|createWorkLocation/);
  });
});

// ================================================================ MANAGER ====

describe("the reporting line is identifier-only", () => {
  it("12 — a matricule resolves, whatever its casing or padding", () => {
    for (const written of ["EMP-0001", "emp-0001", "  EMP-0001  "]) {
      const r = runRow({ manager: written });
      expect(r.codes, written).toEqual([]);
      expect(r.parsed.manager_employee_id, written).toBe("e-chef");
    }
  });

  it("13 — A NAME NEVER RESOLVES, even when that exact person exists", () => {
    // Ousmane Sadio IS in the registry, ACTIVE, and holds EMP-0001.
    const r = runRow({ manager: "OUSMANE SADIO" });
    expect(r.parsed.manager_employee_id).toBeUndefined();
    expect(r.codes).toEqual(["manager_not_identifier"]);
    // …and the refusal teaches the two-pass sequence rather than inviting a
    // hunt for a spelling that does not exist.
    const m = r.problems[0].message_fr;
    expect(m).toContain("un nom ne peut pas désigner un employé");
    expect(m).toContain("matricule");
    expect(m).toContain("laissez vide");
  });

  it("14 — an unknown identifier is « introuvable », which is a different fact", () => {
    expect(runRow({ manager: "EMP-9999" }).codes).toEqual(["unknown_manager"]);
    expect(runRow({ manager: "inconnu@effitrans.sn" }).codes).toEqual(["unknown_manager"]);
  });

  it("15 — an email resolves ONLY when one employee carries it", () => {
    expect(runRow({ manager: "OUSMANE.SADIO@effitrans.sn" }).parsed.manager_employee_id).toBe("e-chef");

    const shared = refs({
      employees: [
        { id: "e-a", employee_number: "EMP-0010", professional_email: "contact@effitrans.sn", first_name: "A", last_name: "Un", status: "ACTIVE" },
        { id: "e-b", employee_number: "EMP-0011", professional_email: "contact@effitrans.sn", first_name: "B", last_name: "Deux", status: "ACTIVE" },
      ],
    });
    const r = runRow({ manager: "contact@effitrans.sn" }, shared);
    expect(r.codes).toEqual(["ambiguous_manager"]);
    expect(r.parsed.manager_employee_id).toBeUndefined();
    expect(r.problems[0].message_fr).toContain("matricule");
  });

  it("16 — a departed manager is refused, and a foreign tenant's simply is not there", () => {
    expect(runRow({ manager: "EMP-0002" }).codes).toEqual(["inactive_manager"]);
    // Cross-tenant: the reference set is loaded tenant-scoped, so another
    // tenant's matricule resolves to nothing — and the registry re-proves the
    // tenant again when the batch is applied.
    expect(runRow({ manager: "EMP-7777" }).codes).toEqual(["unknown_manager"]);
    expect(code(ORG)).toContain('.eq("tenant_id", tenantId)');
    expect(code("lib/hr/actions.ts")).toContain('.eq("tenant_id", ctx.tenantId)');
  });
});

// ====================================================== PROHIBITED COLUMNS ====

describe("prohibited data is refused before anything is stored", () => {
  it("17 — every forbidden family is recognised, in French and in English", () => {
    const cases: [string, string][] = [
      ["CNI", "pièce d'identité"],
      ["N° carte d'identité", "pièce d'identité"],
      ["Passeport", "pièce d'identité"],
      ["SEXE", "sexe"],
      ["Genre", "sexe"],
      ["Date de naissance", "naissance"],
      ["Situation matrimoniale", "situation familiale"],
      ["Salaire brut", "rémunération"],
      ["Prime de transport", "rémunération"],
      ["Groupe sanguin", "médicales"],
      ["N° IPRES", "organisme social"],
    ];
    for (const [header, expected] of cases) {
      const reason = forbiddenColumnReason(header);
      expect(reason, header).not.toBeNull();
      expect(reason!, header).toContain(expected);
    }
  });

  it("18 — and NOT ONE legitimate template header is flagged", () => {
    for (const col of EMPLOYEE_TEMPLATE_COLUMNS) {
      expect(forbiddenColumnReason(col.headerFr), col.headerFr).toBeNull();
      expect(forbiddenColumnReason(`${col.headerFr} *`), col.headerFr).toBeNull();
    }
    // « Date d'entrée » must never read as a date of birth, and a matricule
    // column is IGNORED rather than forbidden — it is not prohibited data.
    expect(forbiddenColumnReason("Date d'entrée")).toBeNull();
    expect(forbiddenColumnReason("matricule")).toBeNull();
  });

  it("19 — the finding names the COLUMN and cannot carry a value", () => {
    const headers = ["Prénom *", "Nom *", "CNI", "SEXE", "Salaire net"];
    const found = forbiddenColumns(headers);
    expect(found.map((f) => f.header)).toEqual(["CNI", "SEXE", "Salaire net"]);
    for (const f of found) expect(f.reasonFr.length).toBeGreaterThan(5);
    // Structurally impossible to leak a cell: the detector is given headers.
    expect(forbiddenColumns.length).toBe(1);
    expect(code("lib/hr/forbidden-columns.ts")).not.toMatch(/\braw\b|cells|values\[/);
  });

  it("20 — a clean header row yields nothing at all", () => {
    expect(forbiddenColumns(EMPLOYEE_TEMPLATE_COLUMNS.map((c) => c.headerFr))).toEqual([]);
  });

  it("21 — THE REFUSAL PRECEDES THE BATCH: no batch row, no staging row", () => {
    const s = code(ORG);
    const check = s.indexOf("forbiddenColumns(header)");
    const batchInsert = s.indexOf('.from("hr_import_batch")');
    const stagingInsert = s.indexOf('.from("hr_import_staging_row").insert');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(batchInsert);
    expect(check).toBeLessThan(stagingInsert);
    // It refuses the FILE, and says which columns — never what they contained.
    expect(s).toContain('error: "forbidden_columns"');
    expect(s).toContain("messages: forbidden.map((f) =>");
  });

  it("22 — the permission gate still comes first", () => {
    const s = code(ORG);
    expect(s.indexOf('assertPermission("hr:manage")')).toBeLessThan(s.indexOf("forbiddenColumns(header)"));
  });
});

// =============================================================== TEMPLATE ====

describe("the template tells the truth about the parser", () => {
  it("23 — the département hint names all five, derived from the registry", () => {
    const hint = EMPLOYEE_TEMPLATE_COLUMNS.find((c) => c.field === "department")!.hintFr;
    for (const d of CANONICAL_DEPARTMENTS) expect(hint, d.code).toContain(d.labelFr);
    expect(CANONICAL_DEPARTMENTS).toHaveLength(5);
  });

  it("24 — Poste and Site explain the fold instead of promising « exact »", () => {
    for (const field of ["position", "work_location", "org_unit"]) {
      const hint = EMPLOYEE_TEMPLATE_COLUMNS.find((c) => c.field === field)!.hintFr;
      expect(hint, field).toContain("accents");
      expect(hint, field).toContain("majuscules");
      expect(hint, field).not.toContain("exact d'un");
    }
  });

  it("25 — the manager column states the identifier rule and the two passes", () => {
    const hint = EMPLOYEE_TEMPLATE_COLUMNS.find((c) => c.field === "manager")!.hintFr;
    expect(hint).toContain("Matricule");
    expect(hint).toContain("unique");
    expect(hint).toContain("Un nom ne résout jamais");
  });

  it("26 — the Instructions sheet carries the prohibited list and the tab rule", () => {
    const rows = employeeTemplateInstructionRows().flat().join(" ");
    expect(rows).toContain("Colonnes INTERDITES");
    for (const label of FORBIDDEN_COLUMN_LABELS_FR) expect(rows, label).toContain(label);
    expect(rows).toContain("DEC-B27");
    expect(rows).toContain("premier onglet");
    expect(rows).toContain("ambiguïté");
    // The prohibited list is documentation, and documentation never sits in the
    // data sheet — the parser reads the first sheet only.
    expect(parseXlsx(buildEmployeeImportTemplate())).toHaveLength(1);
  });

  it("27 — ROUND TRIP: the platform's own template, populated, parses and validates", () => {
    // Start from the REAL downloadable bytes, not a reconstruction.
    const headers = parseXlsx(buildEmployeeImportTemplate())[0];
    const row = headers.map((h) => {
      if (h.startsWith("Prénom")) return "Awa";
      if (h.startsWith("Nom")) return "Ndiaye";
      if (h.startsWith("Département")) return "Finance";
      if (h === "Poste") return "DECLARANT EN DOUANE";
      if (h === "Site de travail") return "SIEGE";
      if (h === "Responsable hiérarchique") return "EMP-0001";
      if (h === "Type d'emploi") return "CDI";
      if (h === "Date d'entrée") return "44197";
      return "";
    });

    const rows = parseXlsx(buildXlsx("Employes", [headers, row]));
    expect(rows).toHaveLength(2);

    const mapping = autoMapEmployeeHeaders(rows[0]);
    const parsed: Record<string, string> = {};
    for (const col of EMPLOYEE_TEMPLATE_COLUMNS) {
      const source = mapping[col.field];
      parsed[col.field] = source ? (rows[1][rows[0].indexOf(source)] ?? "").trim() : "";
    }

    const problems: EmployeeRowProblem[] = [];
    validateEmployeeRow(parsed, 2, refs(), new Map(), new Map(), problems);
    expect(problems.map((p) => `${p.field}/${p.code}`)).toEqual([]);
    expect(parsed.department).toBe("FINANCE");
    expect(parsed.position).toBe("Déclarant en douane");
    expect(parsed.work_location).toBe("Siège");
    expect(parsed.manager_employee_id).toBe("e-chef");
    expect(parsed.hire_date).toBe("2021-01-01");
  });
});

// ========================================================== AUTHORIZATION ====

describe("an employment fact is never an authorization", () => {
  it("28 — no module on the import path can reach an account, a role or a permission", () => {
    for (const p of [RULE, "lib/hr/normalize.ts", "lib/hr/forbidden-columns.ts", "lib/hr/import-template.ts"]) {
      const s = code(p);
      for (const forbidden of ["user_role", "role_permission", "app_user", "auth.users", "hasPermission", "grantRole"]) {
        expect(s.includes(forbidden), `${p} mentions ${forbidden}`).toBe(false);
      }
    }
  });

  it("29 — a Poste is written as a job title and nothing else", () => {
    // The catalog match resolves a LABEL; the apply stage carries it to
    // `jobTitle`. There is no branch anywhere from a poste to a role code.
    expect(code(ORG)).toContain("jobTitle: p.position");
    expect(code(RULE)).not.toMatch(/CUSTOMS_DECLARANT|roleCanonicalDepartment|ROLE_/);
  });

  it("30 — and the four-eyes visa is untouched by this slice", () => {
    const s = code(ORG);
    expect(s).toContain('if (batch.submitted_by === admin.id) return { ok: false, error: "same_actor" };');
    expect(s).toContain('.in("status", ["READY", "APPLIED_WITH_ERRORS"])');
  });
});
