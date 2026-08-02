/**
 * HR-5 — ON_LEAVE derivation. PURE. No imports, no clock, no I/O.
 * ---------------------------------------------------------------------------
 * THE RULE OF THIS PHASE: being on leave is COMPUTED, never stored.
 *
 * `employee.status` keeps its ratified five values and gains none. There is no
 * ON_LEAVE column, no ON_LEAVE transition, and no writer anywhere in the
 * codebase that could set one — a hand-set ON_LEAVE would drift from the
 * approved request that justifies it, and the drift would be invisible.
 *
 * A presence is therefore a PROJECTION over (status, approved leave, date).
 * Only an APPROVED request whose window contains the reference date counts:
 * a submitted request is a plan, a cancelled one is history, and neither makes
 * anybody absent.
 */

export type LeaveWindow = {
  status: string;
  startISO: string;
  endISO: string;
};

export type Presence = "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "TERMINATED" | "ARCHIVED" | "DRAFT";

export const PRESENCE_LABEL_FR: Record<Presence, string> = {
  DRAFT: "Brouillon",
  ACTIVE: "Actif",
  ON_LEAVE: "En congé",
  SUSPENDED: "Suspendu",
  TERMINATED: "Sorti",
  ARCHIVED: "Archivé",
};

/** True when an APPROVED window contains the reference date (inclusive). */
export function isOnLeaveOn(windows: readonly LeaveWindow[], referenceISO: string): boolean {
  return windows.some(
    (w) => w.status === "APPROVED" && w.startISO <= referenceISO && w.endISO >= referenceISO,
  );
}

/**
 * The employee's presence for display.
 *
 * ON_LEAVE only ever OVERLAYS an ACTIVE employee: a suspended, terminated or
 * archived person is not "on leave", whatever rows exist — their employment
 * state is the stronger fact, and saying otherwise would misreport a departure.
 */
export function derivePresence(
  employeeStatus: string,
  windows: readonly LeaveWindow[],
  referenceISO: string,
): Presence {
  if (employeeStatus !== "ACTIVE") return employeeStatus as Presence;
  return isOnLeaveOn(windows, referenceISO) ? "ON_LEAVE" : "ACTIVE";
}
