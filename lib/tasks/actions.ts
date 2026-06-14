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
import { validateTask } from "./validate";
import { canTransition, isTaskStatus, ACTIVE_STATUSES } from "./status";
import type { ActionResult, TaskInput, TaskStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadTask(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("task")
    .select("id, tenant_id, file_id, status")
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

export async function assignTask(id: string, userId: string | null): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("task:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const task = await loadTask(supabase, id, user.tenantId);
  if (!task) return { ok: false, error: "not_found" };

  if (userId) {
    const { data: target } = await supabase
      .from("app_user")
      .select("id, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!target || target.tenant_id !== user.tenantId) return { ok: false, error: "invalid_assignee" };
  }

  const { error } = await supabase
    .from("task")
    .update({ assigned_to: userId })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TASK_ASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "task",
    entityId: id,
    after: { assigned_to: userId },
  });
  revalidate(task.file_id);
  return { ok: true, id };
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

export async function completeTask(id: string): Promise<ActionResult> {
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
