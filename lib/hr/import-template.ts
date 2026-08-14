/**
 * HR-B3 — the ONE definition of the employee import template. PURE.
 * ---------------------------------------------------------------------------
 * Everything the mass-registration journey needs about columns lives here,
 * once: the xlsx template builder writes these headers, the staging step
 * auto-maps them back, the validator reads the same field keys, and the tests
 * pin the contract. HR must never construct column names from documentation —
 * they download the template and the headers ARE the contract.
 *
 * Every field maps onto something the registry genuinely consumes
 * (CreateEmployeeInput / the resolution the validator performs). No invented
 * schema. The matricule is deliberately ABSENT: numbers are minted by
 * next_employee_number at application, never supplied by a spreadsheet.
 */

export type EmployeeTemplateColumn = {
  /** Internal field key — what KIND_FIELDS/validation/apply read. */
  field: string;
  /** The French header the operator sees in the downloaded template. */
  headerFr: string;
  required: boolean;
  /** One-line guidance rendered in the template's second row. */
  hintFr: string;
};

export const EMPLOYEE_TEMPLATE_COLUMNS: readonly EmployeeTemplateColumn[] = [
  { field: "first_name", headerFr: "Prénom", required: true, hintFr: "Obligatoire" },
  { field: "last_name", headerFr: "Nom", required: true, hintFr: "Obligatoire" },
  {
    field: "department", headerFr: "Département plateforme", required: true,
    hintFr: "Obligatoire — OPERATIONS, TRANSIT, FINANCE ou HUMAN_RESOURCES",
  },
  { field: "professional_email", headerFr: "Email professionnel", required: false, hintFr: "prenom.nom@exemple.sn" },
  { field: "professional_phone", headerFr: "Téléphone professionnel", required: false, hintFr: "+221 …" },
  {
    field: "employment_type", headerFr: "Type d'emploi", required: false,
    hintFr: "CDI, CDD, STAGE, JOURNALIER, PRESTATAIRE ou AUTRE",
  },
  { field: "hire_date", headerFr: "Date d'entrée", required: false, hintFr: "AAAA-MM-JJ (ex. 2026-09-01)" },
  {
    field: "org_unit", headerFr: "Unité d'organisation", required: false,
    hintFr: "Code ou nom exact d'une unité active (Configuration RH)",
  },
  {
    field: "position", headerFr: "Poste", required: false,
    hintFr: "Intitulé exact d'un poste actif du catalogue",
  },
  {
    field: "work_location", headerFr: "Site de travail", required: false,
    hintFr: "Nom exact d'un site actif",
  },
  {
    field: "manager", headerFr: "Responsable hiérarchique", required: false,
    hintFr: "Matricule (EMP-0001) ou email professionnel d'un employé existant",
  },
  {
    field: "status", headerFr: "Statut initial", required: false,
    hintFr: "DRAFT (défaut) ou ACTIVE",
  },
] as const;

export const EMPLOYEE_TEMPLATE_REQUIRED: readonly string[] =
  EMPLOYEE_TEMPLATE_COLUMNS.filter((c) => c.required).map((c) => c.field);
export const EMPLOYEE_TEMPLATE_OPTIONAL: readonly string[] =
  EMPLOYEE_TEMPLATE_COLUMNS.filter((c) => !c.required).map((c) => c.field);

/** Import may only create DRAFT (default) or immediately ACTIVE employees —
 *  a spreadsheet never suspends, terminates or archives anyone. */
export const EMPLOYEE_IMPORT_ALLOWED_STATUSES = ["DRAFT", "ACTIVE"] as const;

// A trailing « * » marks a required column in the downloaded template — it is
// presentation, not identity, so matching strips it first.
const norm = (s: string) => s.trim().replace(/\s*\*+$/, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Auto-map source headers onto template fields. Exact French header (accent-
 * and case-insensitive) or the raw field key both match — nothing fuzzy.
 * Unrecognised headers map to nothing and simply carry no data.
 */
export function autoMapEmployeeHeaders(sourceHeaders: readonly string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const col of EMPLOYEE_TEMPLATE_COLUMNS) {
    const hit = sourceHeaders.find((h) => norm(h) === norm(col.headerFr) || norm(h) === norm(col.field));
    if (hit) mapping[col.field] = hit;
  }
  return mapping;
}

/**
 * Excel stores dates as day serials (days since 1899-12-30). When a mapped
 * hire_date arrives as a bare serial in the plausible modern range, convert it
 * to ISO instead of failing the row on a format Excel itself produced.
 */
export function excelSerialToIsoDate(value: string): string {
  if (!/^\d{4,6}$/.test(value)) return value;
  const serial = Number(value);
  if (serial < 20000 || serial > 80000) return value; // ~1954..2118 — outside, leave as-is
  const ms = (serial - 25569) * 86400_000; // 25569 = days 1899-12-30 → 1970-01-01
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}
