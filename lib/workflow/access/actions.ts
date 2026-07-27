"use server";
/**
 * Assignment actions (Phase WES-3B / WES-3G). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Every assignment goes through an RPC that writes the assignee, the
 * append-only history row and the business event in ONE transaction. These
 * actions never touch an assignee column directly — WES-9A settled that a
 * mandatory record and its mutation cannot be separate application writes.
 *
 * The layering, and why it is split this way:
 *
 *   TypeScript  authorization (who is asking) and POLICY eligibility (who may
 *               hold the seat). The policy document lives here, so eligibility
 *               is decided here; expressing it in SQL would recreate the second
 *               source of truth WES-7 removed.
 *   SQL         what SQL can enforce absolutely — tenancy, existence, activity,
 *               no-op rejection, reason-required, append-only history.
 *
 * Neither layer trusts the other to have done its half.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getUserRoleCodes } from "./roles";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { revalidatePath } from "next/cache";
import { resolveSeatEligibility, isEligibleForSeat } from "./eligibility";

export type AssignmentResult =
  | { ok: true; assignmentEventId: string }
  | { ok: false; error: string };

/** Reason codes the ledger accepts. Mirrors the SQL CHECK. */
export const ASSIGNMENT_REASON_CODES = [
  "INITIAL",
  "REASSIGNMENT",
  "SUPERVISOR_INTERVENTION",
  "WORKLOAD_BALANCING",
  "ABSENCE",
  "ESCALATION",
  "CORRECTION",
  "UNASSIGNMENT",
  "GOVERNANCE",
] as const;
export type AssignmentReasonCode = (typeof ASSIGNMENT_REASON_CODES)[number];

/** Codes that oblige the actor to explain themselves. Enforced again in SQL. */
const REASON_REQUIRED: readonly string[] = ["SUPERVISOR_INTERVENTION", "GOVERNANCE"];

function isReasonCode(v: string): v is AssignmentReasonCode {
  return (ASSIGNMENT_REASON_CODES as readonly string[]).includes(v);
}

/**
 * Assign or reassign a TASK.
 *
 * Note what this does NOT do: it does not touch the dossier, its responsible
 * department, its operational owner or its lifecycle stage. That separation is
 * the entire point of WES-3 — reassigning work must never move the dossier.
 */
export async function assignTaskToUser(input: {
  taskId: string;
  userId: string | null;
  reasonCode: string;
  reason?: string | null;
}): Promise<AssignmentResult> {
  let actor;
  try {
    actor = await assertPermission("task:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!isReasonCode(input.reasonCode)) return { ok: false, error: "invalid_reason_code" };
  if (REASON_REQUIRED.includes(input.reasonCode) && !input.reason?.trim()) {
    return { ok: false, error: "reason_required" };
  }

  const supabase = getAdminSupabaseClient();

  // Locate the task, its dossier and the process instance that pins the policy.
  const { data: task } = await supabase
    .from("task")
    .select("id, tenant_id, file_id, status")
    .eq("id", input.taskId)
    .eq("tenant_id", actor.tenantId)
    .maybeSingle<{ id: string; tenant_id: string; file_id: string; status: string }>();
  if (!task) return { ok: false, error: "not_found" };

  const { data: instance } = await supabase
    .from("process_instance")
    .select("id")
    .eq("file_id", task.file_id)
    .eq("tenant_id", actor.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  // POLICY ELIGIBILITY (WES-3J). Skipped for unassignment — removing work from
  // someone is not a claim that they were eligible to hold it.
  let policyVersionId: string | null = null;
  if (input.userId) {
    const stepKey = await currentStepKey(supabase, instance?.id ?? null, actor.tenantId);
    const eligibility = await resolveSeatEligibility(
      { tenantId: actor.tenantId, processInstanceId: instance?.id ?? null },
      stepKey,
      "assignee",
    );
    // Fail closed: an unresolvable pinned policy means nobody is eligible.
    if (!eligibility.resolved) return { ok: false, error: "policy_unresolved" };

    const targetRoles = await getUserRoleCodes(input.userId, actor.tenantId);
    if (!isEligibleForSeat(eligibility, targetRoles)) {
      return { ok: false, error: "not_eligible" };
    }
    policyVersionId = eligibility.policyVersionId;
  }

  const { data, error } = await supabase.rpc("assign_task", {
    p_task_id: input.taskId,
    p_new_user_id: input.userId,
    p_actor: actor.id,
    p_reason_code: input.reasonCode,
    p_reason: input.reason ?? null,
    p_step_key: null,
    p_policy_id: policyVersionId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  const result = data as { assignment_event_id: string } | null;

  await writeAudit({
    action: AuditActions.TASK_ASSIGNED,
    actorId: actor.id,
    tenantId: actor.tenantId,
    entity: "task",
    entityId: input.taskId,
    after: { assigned_to: input.userId, reason_code: input.reasonCode },
  });

  revalidatePath(`/files/${task.file_id}`);
  revalidatePath("/tasks");
  return { ok: true, assignmentEventId: result?.assignment_event_id ?? "" };
}

/** Assign or reassign a process STEP execution. */
export async function assignStepToUser(input: {
  executionId: string;
  userId: string | null;
  reasonCode: string;
  reason?: string | null;
}): Promise<AssignmentResult> {
  let actor;
  try {
    actor = await assertPermission("process:owner:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!isReasonCode(input.reasonCode)) return { ok: false, error: "invalid_reason_code" };
  if (REASON_REQUIRED.includes(input.reasonCode) && !input.reason?.trim()) {
    return { ok: false, error: "reason_required" };
  }

  const supabase = getAdminSupabaseClient();
  const { data: execution } = await supabase
    .from("process_step_execution")
    .select("id, tenant_id, step_key, process_instance_id")
    .eq("id", input.executionId)
    .eq("tenant_id", actor.tenantId)
    .maybeSingle<{
      id: string;
      tenant_id: string;
      step_key: string;
      process_instance_id: string;
    }>();
  if (!execution) return { ok: false, error: "not_found" };

  let policyVersionId: string | null = null;
  if (input.userId) {
    const eligibility = await resolveSeatEligibility(
      { tenantId: actor.tenantId, processInstanceId: execution.process_instance_id },
      execution.step_key,
      "assignee",
    );
    if (!eligibility.resolved) return { ok: false, error: "policy_unresolved" };

    const targetRoles = await getUserRoleCodes(input.userId, actor.tenantId);
    if (!isEligibleForSeat(eligibility, targetRoles)) {
      return { ok: false, error: "not_eligible" };
    }
    policyVersionId = eligibility.policyVersionId;
  }

  const { data, error } = await supabase.rpc("assign_process_step", {
    p_execution_id: input.executionId,
    p_new_user_id: input.userId,
    p_actor: actor.id,
    p_reason_code: input.reasonCode,
    p_reason: input.reason ?? null,
    p_policy_id: policyVersionId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  const result = data as { assignment_event_id: string; file_id: string | null } | null;
  if (result?.file_id) revalidatePath(`/files/${result.file_id}`);
  return { ok: true, assignmentEventId: result?.assignment_event_id ?? "" };
}

/**
 * Assign or reassign the OPERATIONAL OWNER (WES-3G).
 *
 * Distinct from task assignment on purpose: the owner keeps oversight as work
 * crosses departments, and is never merely "whoever holds the current task".
 */
export async function assignOperationalOwner(input: {
  processInstanceId: string;
  userId: string;
  reasonCode: string;
  reason?: string | null;
}): Promise<AssignmentResult> {
  let actor;
  try {
    actor = await assertPermission("process:owner:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!isReasonCode(input.reasonCode)) return { ok: false, error: "invalid_reason_code" };
  if (REASON_REQUIRED.includes(input.reasonCode) && !input.reason?.trim()) {
    return { ok: false, error: "reason_required" };
  }

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.rpc("assign_operational_owner", {
    p_instance_id: input.processInstanceId,
    p_new_user_id: input.userId,
    p_actor: actor.id,
    p_reason_code: input.reasonCode,
    p_reason: input.reason ?? null,
    p_policy_id: null,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  const result = data as { assignment_event_id: string; file_id: string | null } | null;

  await writeAudit({
    action: AuditActions.PROCESS_OWNER_ASSIGNED,
    actorId: actor.id,
    tenantId: actor.tenantId,
    entity: "process_instance",
    entityId: input.processInstanceId,
    after: { owner_user_id: input.userId, reason_code: input.reasonCode },
  });

  if (result?.file_id) revalidatePath(`/files/${result.file_id}`);
  return { ok: true, assignmentEventId: result?.assignment_event_id ?? "" };
}

/**
 * The step key currently in play for a dossier, used to look up seat bindings.
 * Falls back to the empty string, which yields NO eligible roles — fail closed.
 */
async function currentStepKey(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  processInstanceId: string | null,
  tenantId: string,
): Promise<string> {
  if (!processInstanceId) return "";
  const { data } = await supabase
    .from("process_step_execution")
    .select("step_key")
    .eq("tenant_id", tenantId)
    .eq("process_instance_id", processInstanceId)
    .in("state", ["AVAILABLE", "ACTIVE", "PENDING"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ step_key: string }>();
  return data?.step_key ?? "";
}

/**
 * RPC exceptions carry business meaning; surface a stable code rather than raw
 * Postgres text. Anything unrecognised becomes a generic failure — an unknown
 * database message is never shown to a user.
 */
function mapRpcError(message: string): string {
  if (message.includes("assignee unchanged") || message.includes("owner unchanged")) {
    return "unchanged";
  }
  if (message.includes("not active")) return "assignee_inactive";
  if (message.includes("another tenant") || message.includes("not a member")) {
    return "invalid_assignee";
  }
  if (message.includes("cannot be reassigned")) return "invalid_state";
  if (message.includes("cannot be unassigned")) return "owner_required";
  if (message.includes("reason is required")) return "reason_required";
  if (message.includes("not found")) return "not_found";
  return "assignment_failed";
}
