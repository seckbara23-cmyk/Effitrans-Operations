/**
 * HR-IMPORT-MAPPING-01 — ONE employee import row, validated and resolved. PURE.
 * ---------------------------------------------------------------------------
 * WHY IT MOVED HERE. This rule decides what Effitrans HR may load: which
 * departement is real, which Poste exists, which Site is active, and who may
 * be a Responsable. It lived inside a "use server" module, where a Next.js
 * server file may export nothing but async functions — so the one rule the
 * whole import turns on could not be exercised by a single test. Every claim
 * about it was a source pin: text matching, which passes whether or not the
 * code underneath is right.
 *
 * So the rule is pure and lives here, the action keeps the I/O (loading the
 * tenant-scoped reference data) and the authority boundary, and the
 * regressions now run the actual decision against actual catalog shapes.
 *
 * NOTHING ABOUT THE CONTRACT CHANGED IN THE MOVE except what
 * HR-IMPORT-MAPPING-01 ratified: the shared fold for catalog lookups, refusal
 * on ambiguity rather than a first-match guess, and the identifier-only
 * reporting line.
 *
 * IT CREATES NOTHING. No unknown value becomes a new Poste, Site or Unite: an
 * unrecognised "Comptble" is a readable refusal, never a catalog row. And no
 * field here has any path into application authorization — a Poste is an
 * employment fact, never a role, and this module imports nothing that could
 * make it one.
 */
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import {
  EMPLOYEE_IMPORT_ALLOWED_STATUSES,
  canonicalizeEmployeeVocab,
  excelSerialToIsoDate,
} from "./import-template";
import { EMPLOYMENT_TYPES } from "./validate";
import { resolveByFold } from "./normalize";

/** One readable problem on one row — the shape hr_import_error stores. */
export type EmployeeRowProblem = { field: string; code: string; message_fr: string };

// HR-B3A: derived from THE canonical registry — never a second hard-coded list.
const DEPARTMENT_CODES: readonly string[] = CANONICAL_DEPARTMENTS.map((d) => d.code);

export type EmployeeImportRefs = {
  units: { id: string; name: string; code: string | null; is_active: boolean }[];
  positions: { title: string; is_active: boolean }[];
  locations: { name: string; is_active: boolean }[];
  employees: {
    id: string; employee_number: string; professional_email: string | null;
    first_name: string; last_name: string; status: string;
  }[];
};

/**
 * Case-insensitive equality for IDENTITY comparisons — the in-file and registry
 * duplicate guards.
 *
 * ⚠ DELIBERATELY NOT `hrFold`. Catalog values are folded because « SIEGE » and
 * « Siège » are one site; PEOPLE are not. Folding accents here would make
 * « Marie-José » and « Marie Jose » the same person and refuse a legitimate
 * colleague as a homonym — a different ruling, with different consequences,
 * that nobody has made. HR-A2's warning-first duplicate policy stands as it is.
 */
const ciEq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PHONE_RE = /^[+0-9 ().\-]{6,}$/;

/** Validate + resolve ONE employee row. Mutates `parsed` with resolved ids and
 *  canonical catalog values; pushes readable French problems. */
export function validateEmployeeRow(
  parsed: Record<string, string>,
  rowNumber: number,
  refs: EmployeeImportRefs,
  seenEmails: Map<string, number>,
  seenNames: Map<string, number>,
  problems: { field: string; code: string; message_fr: string }[],
): void {
  const push = (field: string, code: string, message_fr: string) =>
    problems.push({ field, code, message_fr });

  // HR-B3A: accept the registries' own French labels (« Finance » → FINANCE,
  // « Brouillon » → DRAFT) — exact, accent/case-insensitive, then validate the
  // canonical code. The server stays authoritative; Excel dropdowns are UX.
  for (const f of ["department", "employment_type", "status"] as const) {
    if (parsed[f]) parsed[f] = canonicalizeEmployeeVocab(f, parsed[f]);
  }

  if (parsed.department && !DEPARTMENT_CODES.includes(parsed.department)) {
    push("department", "invalid_department",
      `Département inconnu : « ${parsed.department} » (attendu : ${DEPARTMENT_CODES.join(", ")})`);
  }
  if (parsed.employment_type && !(EMPLOYMENT_TYPES as readonly string[]).includes(parsed.employment_type)) {
    push("employment_type", "invalid_employment_type",
      `Type d'emploi inconnu : « ${parsed.employment_type} » (attendu : ${EMPLOYMENT_TYPES.join(", ")})`);
  }
  if (parsed.status && !(EMPLOYEE_IMPORT_ALLOWED_STATUSES as readonly string[]).includes(parsed.status)) {
    push("status", "invalid_status",
      `Statut initial invalide : « ${parsed.status} » (un import ne crée que DRAFT ou ACTIVE)`);
  }
  if (parsed.hire_date) {
    parsed.hire_date = excelSerialToIsoDate(parsed.hire_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.hire_date) || Number.isNaN(Date.parse(parsed.hire_date))) {
      push("hire_date", "invalid_date", `Date d'entrée invalide : « ${parsed.hire_date} » (AAAA-MM-JJ attendu)`);
    }
  }
  if (parsed.professional_email) {
    const email = parsed.professional_email.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      push("professional_email", "invalid_email", `Adresse e-mail invalide : « ${parsed.professional_email} »`);
    } else {
      const prior = seenEmails.get(email);
      if (prior !== undefined) {
        push("professional_email", "duplicate_in_file",
          `Adresse e-mail en double dans le fichier (déjà ligne ${prior})`);
      } else {
        seenEmails.set(email, rowNumber);
        const existing = refs.employees.find(
          (e) => e.professional_email && ciEq(e.professional_email, email),
        );
        if (existing) {
          push("professional_email", "email_exists",
            `Adresse e-mail déjà utilisée (${existing.employee_number})`);
        }
      }
    }
  }
  if (parsed.professional_phone && !PHONE_RE.test(parsed.professional_phone)) {
    const numerified = /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(parsed.professional_phone);
    push("professional_phone", "invalid_phone", numerified
      ? `Téléphone converti en nombre par Excel : « ${parsed.professional_phone} » — utilisez la colonne Texte du modèle fourni et ressaisissez le numéro avec son +`
      : `Téléphone invalide : « ${parsed.professional_phone} »`);
  }
  if (parsed.first_name && parsed.last_name) {
    const key = `${parsed.first_name.trim().toLowerCase()}|${parsed.last_name.trim().toLowerCase()}`;
    const prior = seenNames.get(key);
    if (prior !== undefined) {
      push("last_name", "duplicate_name_in_file",
        `Nom en double dans le fichier (déjà ligne ${prior}) — importez l'un des deux manuellement (confirmation d'homonymie)`);
    } else {
      seenNames.set(key, rowNumber);
      const existing = refs.employees.find(
        (e) => ciEq(e.first_name, parsed.first_name) && ciEq(e.last_name, parsed.last_name)
          && e.status !== "TERMINATED" && e.status !== "ARCHIVED",
      );
      if (existing) {
        push("last_name", "employee_exists",
          `Un employé en cours porte déjà ce nom (${existing.employee_number}) — créez-le manuellement pour confirmer l'homonymie`);
      }
    }
  }
  // HR-IMPORT-MAPPING-01 — the three catalog lookups, under THE fold. « SIEGE »
  // now finds « Siège »; a catalog holding both « Chauffeur » and « CHAUFFEUR »
  // is refused as ambiguous rather than silently resolved to whichever row came
  // back first. Unknown and ambiguous are different sentences because they need
  // different acts: add the entry, or clean the catalog.
  if (parsed.org_unit) {
    const byCode = resolveByFold(refs.units, (u) => u.code, parsed.org_unit);
    const found = byCode.kind === "none"
      ? resolveByFold(refs.units, (u) => u.name, parsed.org_unit)
      : byCode;
    if (found.kind === "none") {
      push("org_unit", "unknown_unit", `Unité « ${parsed.org_unit} » introuvable`);
    } else if (found.kind === "ambiguous") {
      push("org_unit", "ambiguous_unit",
        `Plusieurs unités correspondent à « ${parsed.org_unit} » (${found.count}) — corrigez le catalogue ou utilisez un code distinct`);
    } else if (!found.value.is_active) {
      push("org_unit", "inactive_unit", `Unité « ${parsed.org_unit} » inactive`);
    } else {
      parsed.org_unit_id = found.value.id;
    }
  }
  if (parsed.position) {
    const found = resolveByFold(refs.positions, (p) => p.title, parsed.position);
    if (found.kind === "none") {
      push("position", "unknown_position", `Poste « ${parsed.position} » introuvable au catalogue`);
    } else if (found.kind === "ambiguous") {
      push("position", "ambiguous_position",
        `Plusieurs postes du catalogue correspondent à « ${parsed.position} » (${found.count}) — corrigez le catalogue`);
    } else if (!found.value.is_active) {
      push("position", "inactive_position", `Poste « ${parsed.position} » inactif`);
    } else {
      parsed.position = found.value.title; // canonical spelling → applied as job_title
    }
  }
  if (parsed.work_location) {
    const found = resolveByFold(refs.locations, (l) => l.name, parsed.work_location);
    if (found.kind === "none") {
      push("work_location", "unknown_site", `Site de travail « ${parsed.work_location} » introuvable`);
    } else if (found.kind === "ambiguous") {
      push("work_location", "ambiguous_site",
        `Plusieurs sites correspondent à « ${parsed.work_location} » (${found.count}) — corrigez le catalogue`);
    } else if (!found.value.is_active) {
      push("work_location", "inactive_site", `Site de travail « ${parsed.work_location} » inactif`);
    } else {
      parsed.work_location = found.value.name;
    }
  }
  // HR-IMPORT-MAPPING-01 — THE REPORTING LINE IS IDENTIFIER-ONLY.
  //
  // A NAME NEVER RESOLVES. Effitrans's real file names « OUSMANE SADIO » eight
  // times over, and seven of the eight managers are rows of that same file: at
  // first import none of them has a matricule yet, because the platform mints
  // matricules at application. Matching on a name would attach a whole
  // department's reporting line to whoever happened to be spelled the same —
  // the one mistake this field must never make. The ratified sequence is two
  // passes: import people, receive matricules, then attach managers.
  //
  // The matricule is canonical: unique per tenant and immutable by trigger. An
  // email is accepted only when ONE employee carries it — `professional_email`
  // has no uniqueness constraint, so a shared address is ambiguous, not a
  // person. A foreign tenant's employee is simply absent from `refs` (loaded
  // tenant-scoped), and `createEmployee` re-proves the tenant at application.
  if (parsed.manager) {
    const needle = parsed.manager.trim();
    const byEmail = needle.includes("@");
    const found = byEmail
      ? resolveByFold(refs.employees, (e) => e.professional_email, needle)
      : resolveByFold(refs.employees, (e) => e.employee_number, needle);

    if (found.kind === "ambiguous") {
      push("manager", "ambiguous_manager", byEmail
        ? `Responsable « ${needle} » ambigu : ${found.count} employés portent cet email professionnel — utilisez le matricule`
        : `Responsable « ${needle} » ambigu : ${found.count} matricules correspondent — corrigez le registre`);
    } else if (found.kind === "none") {
      // A value carrying a space and no digit is a NAME, and a name has no
      // resolution at all — saying « introuvable » would invite HR to look for
      // a spelling that does not exist.
      const looksLikeName = !byEmail && /\s/.test(needle) && !/\d/.test(needle);
      if (looksLikeName) {
        push("manager", "manager_not_identifier",
          `Responsable « ${needle} » : un nom ne peut pas désigner un employé. Indiquez le matricule (ou l'email professionnel s'il est unique), ou laissez vide et rattachez les responsables après ce premier import`);
      } else {
        push("manager", "unknown_manager",
          `Responsable « ${needle} » introuvable (matricule ou email professionnel d'un employé existant)`);
      }
    } else if (found.value.status === "TERMINATED" || found.value.status === "ARCHIVED") {
      push("manager", "inactive_manager", `Responsable « ${needle} » n'est plus en activité`);
    } else {
      parsed.manager_employee_id = found.value.id;
    }
  }
}
