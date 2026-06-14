"use client";

/**
 * Global task list with filter tabs (Phase 1.3). Client component.
 */
import Link from "next/link";
import { t } from "@/lib/i18n";
import { TaskRow } from "./task-row";
import type { Assignee, TaskListItem } from "@/lib/tasks/types";

export function TasksTable({
  tasks,
  assignees,
  canUpdate,
  canDelete,
  filter,
}: {
  tasks: TaskListItem[];
  assignees: Assignee[];
  canUpdate: boolean;
  canDelete: boolean;
  filter: "all" | "mine" | "overdue";
}) {
  const tab = (key: "all" | "mine" | "overdue", href: string, label: string) => (
    <Link
      href={href}
      className={
        filter === key
          ? "rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white"
          : "rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50"
      }
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tab("all", "/tasks", t.tasks.filters.all)}
        {tab("mine", "/tasks?filter=mine", t.tasks.filters.mine)}
        {tab("overdue", "/tasks?filter=overdue", t.tasks.filters.overdue)}
      </div>

      {tasks.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{t.tasks.empty}</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} assignees={assignees} canUpdate={canUpdate} canDelete={canDelete} showFile />
          ))}
        </div>
      )}
    </div>
  );
}
