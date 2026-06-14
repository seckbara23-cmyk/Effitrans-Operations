/**
 * Task state machine (Phase 1.3). Pure — unit-testable.
 * ---------------------------------------------------------------------------
 * Flexible: active states (TODO/IN_PROGRESS/BLOCKED) move freely among
 * themselves + terminal states; DONE/CANCELLED can reopen. completeTask -> DONE,
 * cancelTask -> CANCELLED (soft delete). No hard delete.
 */
import type { TaskStatus } from "./types";

export const TASK_STATUSES: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

/** Non-terminal statuses that changeTaskStatus may target. */
export const ACTIVE_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED"];

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "DONE", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["IN_PROGRESS"], // reopen
  CANCELLED: ["TODO"], // reopen
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as string[]).includes(value);
}

export function isTaskPriority(value: string): value is (typeof TASK_PRIORITIES)[number] {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Active (non-terminal) statuses reachable from `from` — for the status control. */
export function activeTargets(from: TaskStatus): TaskStatus[] {
  return (ALLOWED_TRANSITIONS[from] ?? []).filter((s) => ACTIVE_STATUSES.includes(s));
}
