"use client";

/**
 * A single task card with inline controls (Phase 1.3). Reused by the global
 * list and the dossier panel. Invokes server-action proxies only.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { activeTargets } from "@/lib/tasks/status";
import { classifyDue } from "@/lib/notifications/classify";
import { cancelTask, changeTaskStatus, completeTask } from "@/lib/tasks/actions";
import { TaskAssignment } from "./task-assignment";
import { PromptDialog } from "@/components/finance/prompt-dialog";
import type { ActionResult, Assignee, TaskListItem } from "@/lib/tasks/types";

const STATUS_STYLE: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-sky-50 text-sky-700",
  BLOCKED: "bg-red-50 text-red-700",
  DONE: "bg-teal-50 text-teal-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};
const PRIORITY_STYLE: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-500",
  NORMAL: "bg-sky-50 text-sky-700",
  HIGH: "bg-amber-50 text-amber-700",
  URGENT: "bg-red-50 text-red-700",
};

export function TaskRow({
  task,
  assignees,
  policyResolved = true,
  canUpdate,
  canDelete,
  showFile = false,
  currentUserId = null,
}: {
  task: TaskListItem;
  assignees: Assignee[];
  /**
   * The signed-in user. Used ONLY to choose between the ordinary "Terminer"
   * and the intervention flow — the server re-decides both authority and the
   * reason requirement (WES-3B), so a wrong value here changes nothing but the
   * label the operator sees.
   */
  currentUserId?: string | null;
  /** False when the pinned policy could not be resolved (WES-3J fail-closed). */
  policyResolved?: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  showFile?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [intervening, setIntervening] = useState(false);
  // Unassigned counts as "not mine": the server refuses it too, and the dialog
  // explains that it must be assigned or completed as an intervention.
  const isMine = Boolean(currentUserId && task.assignedToId && task.assignedToId === currentUserId);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = t.tasks.errors as Record<string, string>;
        setError(map[res.error] ?? t.tasks.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  const due = task.dueAt ? task.dueAt.slice(0, 10) : null;
  const dueState = classifyDue(task.dueAt, task.status, new Date());
  const dueClass =
    dueState === "overdue"
      ? "font-semibold text-red-600"
      : dueState === "today"
        ? "font-semibold text-amber-600"
        : "text-slate-500";
  const dueLabel =
    dueState === "overdue"
      ? `${t.tasks.dashboard.overdue} · ${due}`
      : dueState === "today"
        ? `${t.tasks.dashboard.today} · ${due}`
        : due;

  return (
    <div className="surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[task.priority]}`}>
          {t.tasks.priorities[task.priority]}
        </span>
        <span className="font-medium text-navy-900">{task.title}</span>
        {showFile && task.fileNumber && (
          <Link href={`/files/${task.fileId}`} className="tabular text-xs text-teal-700 hover:underline">
            {task.fileNumber}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-2">
          {due && <span className={`text-xs ${dueClass}`}>{dueLabel}</span>}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[task.status]}`}>
            {t.tasks.statuses[task.status]}
          </span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {/* WES-3A.1 — the canonical, policy-aware, atomic assignment path.
            The legacy inline <select> called assignTask, which bypassed pinned
            policy, active-user validation, the assignment ledger, the business
            event and the reason requirement. */}
        <TaskAssignment
          taskId={task.id}
          currentAssigneeId={task.assignedToId ?? null}
          currentAssigneeLabel={task.assignedToEmail}
          options={assignees}
          policyResolved={policyResolved}
          canAssign={canUpdate}
        />

        {canUpdate && (
          <span className="ml-auto flex flex-wrap items-center gap-2">

            {/* Status change (active targets) */}
            <select
              value={""}
              disabled={pending}
              onChange={(e) => e.target.value && run(() => changeTaskStatus(task.id, e.target.value))}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="">{t.tasks.actions.move}</option>
              {activeTargets(task.status).map((s) => (
                <option key={s} value={s}>
                  {t.tasks.statuses[s]}
                </option>
              ))}
            </select>

            {task.status !== "DONE" && task.status !== "CANCELLED" && (
              <button
                onClick={() =>
                  // WES-3B — completing work that is not yours is an
                  // INTERVENTION and needs a stated reason. That path existed
                  // server-side but was unreachable: the UI always called
                  // completeTask with no reason, so a non-assignee got
                  // `not_assigned` and (untranslated) a generic failure.
                  isMine ? run(() => completeTask(task.id)) : setIntervening(true)
                }
                disabled={pending}
                className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
              >
                {isMine ? t.tasks.actions.complete : t.tasks.actions.completeForOther}
              </button>
            )}
            {canDelete && task.status !== "CANCELLED" && (
              <button
                onClick={() => run(() => cancelTask(task.id))}
                disabled={pending}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {t.tasks.actions.cancel}
              </button>
            )}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* UAT — the same accessible dialog used for invoice issuance. */}
      <PromptDialog
        open={intervening}
        mode="text"
        title={t.tasks.actions.interventionTitle}
        help={t.tasks.actions.interventionHelp}
        label={t.tasks.actions.interventionLabel}
        required
        submitLabel={t.tasks.actions.complete}
        onCancel={() => setIntervening(false)}
        onSubmit={(reason) => {
          setIntervening(false);
          run(() => completeTask(task.id, { reason }));
        }}
      />
    </div>
  );
}
