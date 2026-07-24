/**
 * Operational File state machine (Phase 1.2). Pure — unit-testable.
 * ---------------------------------------------------------------------------
 * Reduced 1.2 lifecycle (DEC confirmed): DRAFT -> OPENED -> IN_PROGRESS ->
 * DELIVERED -> CLOSED. ARCHIVED + the POD hard-gate are deferred to the
 * document/POD module. Forward-only.
 */
import type { FileStatus } from "./types";

export const FILE_STATUSES: FileStatus[] = [
  "DRAFT",
  "OPENED",
  "IN_PROGRESS",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
];

// CANCELLED is a terminal status reached ONLY via the dedicated cancel action
// (lib/files/actions.ts#cancelFile), never through the forward advance path — so
// it is not a target in any transition list. Both CLOSED and CANCELLED are dead
// ends for the normal state machine.
const ALLOWED_TRANSITIONS: Record<FileStatus, FileStatus[]> = {
  DRAFT: ["OPENED"],
  OPENED: ["IN_PROGRESS"],
  IN_PROGRESS: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function isFileStatus(value: string): value is FileStatus {
  return (FILE_STATUSES as string[]).includes(value);
}

/**
 * DEC-B43 (Phase 10.0D-1, ratified 2026-07-24) — THE single definition of an
 * ACTIVE dossier, used by every KPI, dashboard, report and future API:
 *
 *   An active dossier is any dossier that has NOT reached a terminal state.
 *
 * Terminal = CLOSED, CANCELLED (ARCHIVED joins this set when it exists).
 * Everything else — DRAFT included, DELIVERED included until formal closure —
 * is operational work the company is still carrying. Effitrans manages
 * workload, not merely process status: a DRAFT shipment already consumes
 * operational effort; if a dossier still belongs to the company, it is active.
 *
 * No other module may re-derive "active" from status literals; they import
 * this predicate (test-enforced).
 */
export const TERMINAL_FILE_STATUSES: readonly FileStatus[] = ["CLOSED", "CANCELLED"];

export function isActiveFileStatus(status: FileStatus): boolean {
  return !TERMINAL_FILE_STATUSES.includes(status);
}

/** Allowed next statuses from `from`. */
export function nextStatuses(from: FileStatus): FileStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

/** Whether `from -> to` is a permitted transition. */
export function canTransition(from: FileStatus, to: FileStatus): boolean {
  return nextStatuses(from).includes(to);
}

/**
 * Whether a dossier in `status` may be cancelled. A CLOSED dossier is already
 * finalised and an already-CANCELLED one is terminal — neither can be cancelled
 * again. Every other status can. Cancellable ⇔ still active (the DEC-B43
 * predicate) — one terminal set, not two.
 */
export function canCancel(status: FileStatus): boolean {
  return isActiveFileStatus(status);
}
