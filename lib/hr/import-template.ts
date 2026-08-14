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
 *
 * HR-B3A (production UAT hardening): the closed vocabularies are DERIVED from
 * their authoritative registries — departments from lib/organization/
 * departments, employment types from lib/hr/validate, statuses from
 * lib/hr/lifecycle — never re-typed here. The template's dropdowns show the
 * FRENCH labels those registries already carry, and canonicalizeEmployeeVocab
 * maps label or code (accent/case-insensitive, EXACT — nothing fuzzy) back to
 * the canonical code before validation. One source of truth, friendlier entry.
 */
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { EMPLOYMENT_TYPES } from "./validate";
import { EMPLOYEE_STATUS_LABELS_FR } from "./lifecycle";

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
    hintFr: "Obligatoire — choisissez dans la liste : Opérations, Transit, Finance ou Ressources humaines",
  },
  { field: "professional_email", headerFr: "Email professionnel", required: false, hintFr: "prenom.nom@exemple.sn" },
  {
    field: "professional_phone", headerFr: "Téléphone professionnel", required: false,
    hintFr: "+221770000001 — la colonne est en format Texte : ne la reformatez pas, le + est préservé",
  },
  {
    field: "employment_type", headerFr: "Type d'emploi", required: false,
    hintFr: "Choisissez dans la liste : CDI, CDD, STAGE, JOURNALIER, PRESTATAIRE ou AUTRE",
  },
  {
    field: "hire_date", headerFr: "Date d'entrée", required: false,
    hintFr: "AAAA-MM-JJ (ex. 2026-08-14) — la colonne est au format date, Excel affiche la forme canonique",
  },
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
    hintFr: "Choisissez dans la liste : Brouillon (défaut) ou Actif",
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

// ======================================================= closed vocabularies ==

export type TemplateVocabEntry = { code: string; labelFr: string };

/**
 * The three closed-vocabulary columns, DERIVED from their authoritative
 * registries — this object never invents a value. Dropdowns show labelFr;
 * canonicalizeEmployeeVocab accepts either form.
 */
export const EMPLOYEE_TEMPLATE_VOCAB: Readonly<
  Record<"department" | "employment_type" | "status", readonly TemplateVocabEntry[]>
> = {
  department: CANONICAL_DEPARTMENTS.map((d) => ({ code: d.code, labelFr: d.labelFr })),
  // Employment types ARE already the human vocabulary (CDI, CDD, …).
  employment_type: EMPLOYMENT_TYPES.map((t) => ({ code: t, labelFr: t })),
  status: EMPLOYEE_IMPORT_ALLOWED_STATUSES.map((s) => ({ code: s, labelFr: EMPLOYEE_STATUS_LABELS_FR[s] })),
};

/**
 * Map an operator-entered value onto its canonical code: exact code or exact
 * French label, accent- and case-insensitive — « Finance » → FINANCE,
 * « Ressources humaines » → HUMAN_RESOURCES, « Brouillon » → DRAFT, « cdi » →
 * CDI. Anything else is returned unchanged and the validator refuses it with
 * the full expected list — deterministic, never a guess.
 */
export function canonicalizeEmployeeVocab(field: string, value: string): string {
  const vocab = (EMPLOYEE_TEMPLATE_VOCAB as Record<string, readonly TemplateVocabEntry[] | undefined>)[field];
  if (!vocab || !value.trim()) return value;
  const n = norm(value);
  const hit = vocab.find((e) => norm(e.code) === n || norm(e.labelFr) === n);
  return hit ? hit.code : value;
}

// ========================================================= instructions sheet ==

/**
 * The « Instructions » worksheet content — documentation lives HERE, in a
 * sheet the parser never reads, so it can never be mistaken for an employee
 * (the UAT-proven trap: a hint row under the headers counted as a ligne).
 */
export function employeeTemplateInstructionRows(): string[][] {
  return [
    ["Colonne", "Obligatoire", "Consignes"],
    ...EMPLOYEE_TEMPLATE_COLUMNS.map((c) => [c.headerFr, c.required ? "Oui" : "Non", c.hintFr]),
    [],
    ["Règles générales", "", ""],
    ["Saisie", "", "Ligne 1 de l'onglet Employes = en-têtes. Saisissez les employés à partir de la ligne 2 — aucune ligne d'exemple, aucune ligne de consigne."],
    ["Dates", "", "Format AAAA-MM-JJ (ex. 2026-08-14). La colonne Date d'entrée est déjà au format date."],
    ["Téléphones", "", "La colonne Téléphone est en format Texte pour préserver +221… — ne la convertissez pas en nombre."],
    ["Données de référence", "", "Unité d'organisation, Poste, Site de travail et Responsable hiérarchique sont facultatifs ; s'ils sont renseignés, ils doivent correspondre exactement à la configuration RH existante."],
    ["Matricule", "", "Le matricule n'est jamais saisi : il est attribué par la plateforme lors de l'application du lot."],
  ];
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
