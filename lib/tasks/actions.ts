"use server";

/**
 * Task server actions (Phase 1.3). SERVER ACTIONS / SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors Client/File: gate on permission, scope to tenant, write via the
 * service-role admin client, audit, revalidate. Soft-delete only (cancelTask ->
 * CANCELLED, gated by task:delete). No hard delete.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import { t } from "@/lib/i18n";
import { validateTask } from "./validate";
import { canTransition, isTaskStatus, ACTIVE_STATUSES } from "./status";
import { getDossierAccess } from "@/lib/workflow/access/service";
import { assignTaskToUser } from "@/lib/workflow/access/actions";
import { mayCompleteWork } from "@/lib/workflow/access/resolver";
import type { ActionResult, TaskInput, TaskStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

async function loadTask(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("task")
    .select("id, tenant_id, file_id, status, assigned_to, handoff_type")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.tenant_id !== tenantId) return null;
  return data;
}

function revalidate(fileId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (fileId) revalidatePath(`/files/${fileId}`);
}

export async function createTask(fileId: string, input: TaskInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateTask(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();

  // Tenant scope: the file must belong to the caller's tenant.
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.tenant_id !== user.tenantId) return { ok: false, error: "file_not_found" };

  const { data, error } = await supabase
    .from("task")
    .insert({
      tenant_id: user.tenantId,
      file_id: fileId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority ?? "NORMAL",
      due_at: input.dueAt || null,
      assigned_to: input.assignedTo || null,
      created_by: user.id,
      status: "TODO",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.TASK_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: data.id,
    after: { file_id: fileId, title: input.title.trim() },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export async function updateTask(id: string, input: TaskInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateTask(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();
  const task = await loadTask(supabase, id, user.tenantId);
  if (!task) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("task")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority ?? "NORMAL",
      due_at: input.dueAt || null,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TASK_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: id,
    after: { title: input.title.trim() },
  });
  revalidate(task.file_id);
  return { ok: true, id };
}

/**
 * @deprecated WES-3A.1 — kept ONLY as a delegating compatibility wrapper.
 *
 * This action used to be the production assignment path, and it bypassed
 * every guarantee WES-3 introduced: pinned-policy eligibility, active-user
 * validation, the append-only assignment ledger, the atomic business event,
 * and the reason requirement for supervisor reassignment. It wrote
 * `task.assigned_to` directly and then audited separately — the dual write
 * WES-9A prohibits.
 *
 * It is not deleted, because deleting it would silently drop any caller that
 * has not been migrated. It DELEGATES instead, so there is exactly one
 * authoritative assignment path and no way to reach the old behaviour.
 *
 * New code calls `assignTaskToUser` directly, which also accepts a reason.
 */
export async function assignTask(id: string, userId: string | null): Promise<ActionResult> {
  const result = await assignTaskToUser({
    taskId: id,
    userId,
    // The legacy signature carries no reason, so the only codes it can honestly
    // claim are the ones that require none. Supervisor and governance
    // reassignment are unreachable through this path by design.
    reasonCode: userId ? "REASSIGNMENT" : "UNASSIGNMENT",
  });
  return result.ok ? { ok: true, id } : { ok: false, error: result.error };
}

export async function changeTaskStatus(id: string, toStatus: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isTaskStatus(toStatus) || !ACTIVE_STATUSES.includes(toStatus)) {
    return { ok: false, error: "invalid_status" };
  }

  const supabase = getAdminSupabaseClient();
  const task = await loadTask(supabase, id, user.tenantId);
  if (!task) return { ok: false, error: "not_found" };

  const from = task.status as TaskStatus;
  if (!canTransition(from, toStatus)) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("task")
    .update({ status: toStatus, completed_at: null }) // leaving DONE clears completion
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TASK_STATUS_CHANGED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: id,
    before: { status: from },
    after: { status: toStatus },
  });
  revalidate(task.file_id);
  return { ok: true, id };
}

export async function completeTask(
  id: string,
  /**
   * WES-3B: completing work that is not yours is an INTERVENTION, and an
   * intervention must be declared and explained. Omitting it is not a way to
   * complete someone else's task quietly — it is refused.
   */
  intervention?: { reason: string },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const task = await loadTask(supabase, id, user.tenantId);
  if (!task) return { ok: false, error: "not_found" };
  if (!canTransition(task.status as TaskStatus, "DONE")) return { ok: false, error: "invalid_transition" };

  // COMPLETION AUTHORITY (WES-3B). Before WES-3 this action had NO assignee
  // check at all: `task:update` let anyone in the tenant complete anyone's work,
  // which is precisely the "people own tasks" guarantee the doctrine requires.
  //
  // The rule, from the pure resolver so pages, actions and tests share it:
  //   * the assignee completes their own task;
  //   * anyone else is intervening, which requires the authority AND a reason.
  const assignee = task.assigned_to as string | null;
  const isAssignee = !!assignee && assignee === user.id;

  if (!isAssignee) {
    const access = await getDossierAccess(task.file_id);
    const verdict = mayCompleteWork(
      access ?? {
        canViewSummary: false, canViewCurrentDepartmentDetail: false,
        canViewHistoricalDepartmentDetail: false, canViewDocuments: false,
        canActOnCurrentStep: false, canCompleteAssignedTask: false,
        canReassignWithinDepartment: false, canIntervene: false,
        visibilityReason: "none", reasons: [],
      },
      { intervening: true, reason: intervention?.reason ?? null },
    );
    if (!verdict.ok) return { ok: false, error: verdict.error };

    // An intervention is recorded as such — never as ordinary completion.
    await writeAudit({
      action: AuditActions.TASK_COMPLETED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "task",
      entityId: id,
      after: {
        intervention: true,
        reason: intervention?.reason ?? "",
        previous_assignee: assignee,
      },
    });
  }

  const { error } = await supabase
    .from("task")
    .update({ status: "DONE", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TASK_COMPLETED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: id,
    before: { status: task.status },
    after: { status: "DONE" },
  });
  // Phase 2.1 — a completed department handoff is audited as such.
  const handoffType = (task as { handoff_type?: string | null }).handoff_type;
  if (handoffType) {
    await writeAudit({
      action: AuditActions.HANDOFF_TASK_COMPLETED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "task",
      entityId: id,
      after: { dossier: task.file_id, type: handoffType, task_id: id },
    });
  }
  revalidate(task.file_id);
  return { ok: true, id };
}

export async function cancelTask(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const task = await loadTask(supabase, id, user.tenantId);
  if (!task) return { ok: false, error: "not_found" };
  if (!canTransition(task.status as TaskStatus, "CANCELLED")) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("task")
    .update({ status: "CANCELLED" })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TASK_CANCELLED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: id,
    before: { status: task.status },
    after: { status: "CANCELLED" },
  });
  revalidate(task.file_id);
  return { ok: true, id };
}
