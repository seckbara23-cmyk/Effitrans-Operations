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
];

const ALLOWED_TRANSITIONS: Record<FileStatus, FileStatus[]> = {
  DRAFT: ["OPENED"],
  OPENED: ["IN_PROGRESS"],
  IN_PROGRESS: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
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
