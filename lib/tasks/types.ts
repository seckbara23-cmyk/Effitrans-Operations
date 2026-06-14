/**
 * Tasks shared types (Phase 1.3). Client + server safe.
 */
export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TaskInput = {
  title: string;
  description?: string | null;
  priority?: TaskPriority | null;
  dueAt?: string | null;
  assignedTo?: string | null;
};

export type Assignee = { id: string; label: string };

export type TaskListItem = {
  id: string;
  fileId: string;
  fileNumber: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  assignedToEmail: string | null;
};

export type TaskDetail = TaskListItem & {
  description: string | null;
  assignedTo: string | null;
  completedAt: string | null;
};

export type DashboardTasks = {
  today: TaskListItem[];
  overdue: TaskListItem[];
  mine: TaskListItem[];
};

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
