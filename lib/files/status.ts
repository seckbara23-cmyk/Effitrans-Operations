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
 * again. Every other status can. Pure so the rule is unit-testable and shared by
 * the cancel action + the UI (which hides the button when this is false).
 */
export function canCancel(status: FileStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}
