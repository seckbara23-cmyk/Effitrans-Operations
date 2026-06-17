/**
 * Department handoff tasks (Phase 2.1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * createHandoffTask is IDEMPOTENT — it pre-checks for an open handoff task of the
 * same (dossier, type) and the partial unique index (migration 20260617000001)
 * is the race-proof backstop. On a genuinely new task it: writes the task (reuses
 * the existing `task` table), emits ONE audit `handoff.task.created`, and creates
 * ONE in-app notification per target-role holder (reusing TASK_ASSIGNED — no new
 * notification type). Never throws — a handoff must not break the triggering
 * business action. The dept-count readers are gated by each department's own read
 * permission (admin client, same pattern as the queue services) so they never
 * touch task RLS.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { createNotification } from "@/lib/notifications/create";
import { reportError } from "@/lib/observability/report";
import { t } from "@/lib/i18n";
import { HANDOFFS, isHandoffType, type HandoffType } from "./rules";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
export type HandoffResult = "created" | "exists" | "skipped";

export async function createHandoffTask(
  supabase: Admin,
  ctx: { tenantId: string; actorId: string },
  fileId: string,
  type: HandoffType,
): Promise<HandoffResult> {
  try {
    const def = HANDOFFS[type];

    // Idempotency pre-check: an open (not DONE/CANCELLED) handoff of this type?
    const { data: existing } = await supabase
      .from("task")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("file_id", fileId)
      .eq("handoff_type", type)
      .not("status", "in", "(DONE,CANCELLED)")
      .limit(1)
      .maybeSingle();
    if (existing) return "exists";

    const title = t.handoffs.titles[type];
    const { data, error } = await supabase
      .from("task")
      .insert({
        tenant_id: ctx.tenantId,
        file_id: fileId,
        title,
        status: "TODO",
        priority: "HIGH",
        handoff_type: type,
        created_by: ctx.actorId,
      })
      .select("id, file:file_id(file_number)")
      .single<{ id: string; file: { file_number: string } | null }>();

    if (error || !data) {
      // Lost a race to the partial unique index -> a duplicate already exists.
      if (error && /duplicate|unique/i.test(error.message)) return "exists";
      reportError(error ?? new Error("handoff insert failed"), {
        scope: "action",
        event: "handoff.create",
        extra: { fileId, type },
      });
      return "skipped";
    }

    await writeAudit({
      action: AuditActions.HANDOFF_TASK_CREATED,
      actorId: ctx.actorId,
      tenantId: ctx.tenantId,
      entity: "task",
      entityId: data.id,
      after: { dossier: fileId, source: def.source, target: def.target, task_id: data.id, type },
    });

    // Notify the target-role holders (in-app, self-scoped). One event per new task.
    await notifyRole(supabase, ctx.tenantId, def.role, {
      taskId: data.id,
      fileId,
      title,
      fileNumber: data.file?.file_number ?? "",
      targetDept: def.target,
    });

    return "created";
  } catch (e) {
    reportError(e, { scope: "action", event: "handoff.create", extra: { fileId, type } });
    return "skipped";
  }
}

async function notifyRole(
  supabase: Admin,
  tenantId: string,
  roleCode: string,
  msg: { taskId: string; fileId: string; title: string; fileNumber: string; targetDept: string },
): Promise<void> {
  const { data: role } = await supabase
    .from("role")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", roleCode)
    .maybeSingle();
  if (!role) return;
  const { data: members } = await supabase
    .from("user_role")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role_id", role.id)
    .returns<{ user_id: string }[]>();
  const deptLabel = (t.lifecycle.departments as Record<string, string>)[msg.targetDept] ?? msg.targetDept;
  const body = t.handoffs.notifyBody.replace("{file}", msg.fileNumber).replace("{dept}", deptLabel);
  for (const uid of new Set((members ?? []).map((m) => m.user_id))) {
    await createNotification({
      tenantId,
      userId: uid,
      type: "TASK_ASSIGNED",
      taskId: msg.taskId,
      fileId: msg.fileId,
      title: msg.title,
      body,
    });
  }
}

// ------------------------------------------------------- dept dashboard reads ----

async function countOpen(supabase: Admin, tenantId: string, type?: HandoffType): Promise<number> {
  let q = supabase
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .not("handoff_type", "is", null)
    .not("status", "in", "(DONE,CANCELLED)");
  if (type) q = q.eq("handoff_type", type);
  const { count } = await q;
  return count ?? 0;
}

/** Open CUSTOMS_HANDOFF count for the Documentation dashboard ("ready for customs"). */
export async function readyForCustomsCount(): Promise<number> {
  const u = await assertPermission("document:read");
  return countOpen(getAdminSupabaseClient(), u.tenantId, "CUSTOMS_HANDOFF");
}
/** Open CUSTOMS_HANDOFF count for the Customs dashboard ("ready for declaration"). */
export async function readyForDeclarationCount(): Promise<number> {
  const u = await assertPermission("customs:read");
  return countOpen(getAdminSupabaseClient(), u.tenantId, "CUSTOMS_HANDOFF");
}
export async function readyForDispatchCount(): Promise<number> {
  const u = await assertPermission("transport:read");
  return countOpen(getAdminSupabaseClient(), u.tenantId, "TRANSPORT_HANDOFF");
}
export async function readyForBillingCount(): Promise<number> {
  const u = await assertPermission("finance:read");
  return countOpen(getAdminSupabaseClient(), u.tenantId, "FINANCE_HANDOFF");
}
/** All open handoffs — Management ("pending handoffs"). */
export async function pendingHandoffsCount(): Promise<number> {
  const u = await assertPermission("analytics:read");
  return countOpen(getAdminSupabaseClient(), u.tenantId);
}

/** The open handoff task on a dossier (for the lifecycle tracker). Gated by file:read. */
export async function getOpenHandoffForFile(
  fileId: string,
): Promise<{ type: HandoffType; title: string } | null> {
  const u = await assertPermission("file:read");
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("task")
    .select("handoff_type")
    .eq("tenant_id", u.tenantId)
    .eq("file_id", fileId)
    .not("handoff_type", "is", null)
    .not("status", "in", "(DONE,CANCELLED)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ handoff_type: string }>();
  if (!data || !isHandoffType(data.handoff_type)) return null;
  return { type: data.handoff_type, title: t.handoffs.titles[data.handoff_type] };
}
