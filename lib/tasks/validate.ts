/**
 * Pure validation for task inputs (Phase 1.3). Unit-testable.
 */
import type { TaskInput } from "./types";
import { isTaskPriority } from "./status";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns an error code, or null if valid. */
export function validateTask(input: TaskInput): string | null {
  if (!(input.title ?? "").trim()) return "title_required";
  if (input.priority && !isTaskPriority(input.priority)) return "invalid_priority";
  if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) return "invalid_due_date";
  if (input.assignedTo && !UUID_RE.test(input.assignedTo)) return "invalid_assignee";
  return null;
}
