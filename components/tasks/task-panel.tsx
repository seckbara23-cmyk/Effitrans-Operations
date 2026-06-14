"use client";

/**
 * Tasks panel embedded on a dossier detail page (Phase 1.3). Client component.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { createTask } from "@/lib/tasks/actions";
import { TASK_PRIORITIES } from "@/lib/tasks/status";
import { TaskRow } from "./task-row";
import type { ActionResult, Assignee, TaskListItem, TaskPriority } from "@/lib/tasks/types";

const input =
  "rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

export function TaskPanel({
  fileId,
  tasks,
  assignees,
  canCreate,
  canUpdate,
  canDelete,
}: {
  fileId: string;
  tasks: TaskListItem[];
  assignees: Assignee[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [dueAt, setDueAt] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  function add() {
    setError(null);
    startTransition(async () => {
      const res: ActionResult = await createTask(fileId, {
        title,
        priority,
        dueAt: dueAt || null,
        assignedTo: assignedTo || null,
      });
      if (!res.ok) {
        const map = t.tasks.errors as Record<string, string>;
        setError(map[res.error] ?? t.tasks.errors.generic);
        return;
      }
      setTitle("");
      setDueAt("");
      setAssignedTo("");
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-4 p-5">
      <p className="text-sm font-semibold text-navy-900">{t.tasks.panelTitle}</p>

      {canCreate && (
        <div className="grid gap-2 sm:grid-cols-5">
          <input className={`${input} sm:col-span-2`} placeholder={t.tasks.form.title} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className={input} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t.tasks.priorities[p]}
              </option>
            ))}
          </select>
          <input className={input} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <button onClick={add} disabled={pending || !title.trim()} className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60">
            {pending ? t.tasks.actions.saving : t.tasks.add}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-xs text-slate-400">{t.tasks.empty}</p>
        ) : (
          tasks.map((task) => (
            <TaskRow key={task.id} task={task} assignees={assignees} canUpdate={canUpdate} canDelete={canDelete} />
          ))
        )}
      </div>
    </div>
  );
}
