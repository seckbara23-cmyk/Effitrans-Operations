/**
 * Employee input validation — PURE, no I/O (Phase HR-1).
 * ---------------------------------------------------------------------------
 * Deterministic field checks shared by the create/update server actions and the
 * unit tests. The canonical department set and employment-type vocabulary mirror
 * the migration's CHECK constraints (kept in sync deliberately — the DB is the
 * ultimate authority; this gives friendly errors before the round-trip).
 *
 * NOTE (DEC-B27): there is no salary/national-ID/DOB/medical field to validate —
 * those domains do not exist in HR-1 and must never be added here.
 */

import { isCanonicalDepartment } from "@/lib/organization/departments";

/** Employment-type vocabulary — PROVISIONAL pending Senegal legal review (DEC-B27). */
export const EMPLOYMENT_TYPES = ["CDI", "CDD", "STAGE", "JOURNALIER", "PRESTATAIRE", "AUTRE"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type EmployeeCoreInput = {
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  professionalEmail?: string | null;
  personalEmail?: string | null;
  employmentType?: string | null;
  hireDate?: string | null;
  probationEndDate?: string | null;
};

/** RFC-lite email shape — intentionally permissive, only rejects obvious garbage. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** ISO calendar date (YYYY-MM-DD). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidEmploymentType(v: string): v is EmploymentType {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(v);
}

/**
 * Validate a create/update payload. Returns the list of French error messages
 * (empty = valid). `partial` skips the required-field checks (for updates).
 */
export function validateEmployeeInput(input: EmployeeCoreInput, opts: { partial?: boolean } = {}): string[] {
  const errors: string[] = [];
  const partial = opts.partial ?? false;

  if (!partial || input.firstName !== undefined) {
    if (!input.firstName || !input.firstName.trim()) errors.push("Le prénom est obligatoire.");
  }
  if (!partial || input.lastName !== undefined) {
    if (!input.lastName || !input.lastName.trim()) errors.push("Le nom est obligatoire.");
  }
  if (!partial || input.department !== undefined) {
    if (!input.department || !isCanonicalDepartment(input.department)) {
      errors.push("Le département est obligatoire et doit être un département reconnu.");
    }
  }

  if (input.professionalEmail && !EMAIL_RE.test(input.professionalEmail)) {
    errors.push("L'e-mail professionnel n'est pas valide.");
  }
  if (input.personalEmail && !EMAIL_RE.test(input.personalEmail)) {
    errors.push("L'e-mail personnel n'est pas valide.");
  }
  if (input.employmentType && !isValidEmploymentType(input.employmentType)) {
    errors.push("Le type de contrat n'est pas reconnu.");
  }
  if (input.hireDate && !DATE_RE.test(input.hireDate)) {
    errors.push("La date d'embauche est invalide.");
  }
  if (input.probationEndDate && !DATE_RE.test(input.probationEndDate)) {
    errors.push("La date de fin de période d'essai est invalide.");
  }
  // Probation must not precede hire (only when both are valid ISO dates).
  if (
    input.hireDate &&
    input.probationEndDate &&
    DATE_RE.test(input.hireDate) &&
    DATE_RE.test(input.probationEndDate) &&
    input.probationEndDate < input.hireDate
  ) {
    errors.push("La fin de période d'essai ne peut pas précéder la date d'embauche.");
  }

  return errors;
}

export function isValidEmployeeInput(input: EmployeeCoreInput, opts: { partial?: boolean } = {}): boolean {
  return validateEmployeeInput(input, opts).length === 0;
}
