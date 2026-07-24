/**
 * Employment lifecycle — PURE, no I/O (Phase HR-1, DEC-B26).
 * ---------------------------------------------------------------------------
 * The single source of truth for employment status and its legal transitions.
 * Mirrors the idiom of lib/users/lifecycle.ts (accounts) but is a DISTINCT
 * lifecycle: this is the EMPLOYMENT relationship, not platform access.
 *
 *   DRAFT ─▶ ACTIVE ─▶ SUSPENDED ⇄ ACTIVE
 *                   └▶ TERMINATED ─▶ ARCHIVED
 *   SUSPENDED ─▶ TERMINATED
 *   DRAFT ─▶ ARCHIVED   (abandon a never-activated record)
 *
 * REHIRE = a NEW employee record (DEC-B26): TERMINATED never returns to ACTIVE,
 * so terminated employment history stays immutable and queryable.
 *
 * ON_LEAVE is NOT a status — leave is derived from dated leave records (HR-3).
 * SUSPENDED here means EMPLOYMENT suspension only; platform-access suspension is
 * the separate app_user 'inactive' + auth-ban path.
 */

export const EMPLOYEE_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED", "TERMINATED", "ARCHIVED"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Allowed next states per current state. TERMINATED→ACTIVE is deliberately absent. */
const TRANSITIONS: Readonly<Record<EmployeeStatus, readonly EmployeeStatus[]>> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "TERMINATED"],
  TERMINATED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function isEmployeeStatus(v: unknown): v is EmployeeStatus {
  return typeof v === "string" && (EMPLOYEE_STATUSES as readonly string[]).includes(v);
}

/** Terminal-ish states retained for history but never re-activated. */
export function isTerminalEmployeeStatus(status: EmployeeStatus): boolean {
  return status === "ARCHIVED";
}

export function nextEmployeeStatuses(from: EmployeeStatus): readonly EmployeeStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionEmployee(from: EmployeeStatus, to: EmployeeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Terminating employment requires a documented reason (DEC-B26). */
export function terminationRequiresReason(to: EmployeeStatus): boolean {
  return to === "TERMINATED";
}

export const EMPLOYEE_STATUS_LABELS_FR: Readonly<Record<EmployeeStatus, string>> = {
  DRAFT: "Brouillon",
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Départ",
  ARCHIVED: "Archivé",
};

export function employeeStatusLabelFr(status: string): string {
  return isEmployeeStatus(status) ? EMPLOYEE_STATUS_LABELS_FR[status] : status;
}
