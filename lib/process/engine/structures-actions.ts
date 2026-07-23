"use server";
/**
 * Workflow structural extensions — server actions (Phase 9.0B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONE write path for the Phase 9.0B contracts: canonical owner, recorded
 * decisions, formal blockers, Transit team membership/targeting, explicit
 * skips. Same 8-step contract as lib/process/engine/actions.ts (flag → auth →
 * tenant/visibility → registry validation → pure state machine → apply with
 * COMPARE-AND-SET → audit), with ONE addition: the Phase 9.0B `structures`
 * sub-flag must also be on, so everything here is dark until
 * EFFITRANS_PROCESS_STRUCTURES_ENABLED=true on top of the engine master flag
 * and the tenant rollout.
 *
 * Actor and tenant are ALWAYS the resolved session — never a parameter. The
 * engine still never writes operational_file.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { roleCanonicalDepartment } from "@/lib/organization/departments";
import { stepAppliesToFileType } from "../applicability";
import { DECISION_POLICIES, isDecisionType, isDecisionOutcome, type DecisionType } from "../decision-policy";
import { canTransitionStep, isKnownStep } from "./state";
import type { EngineError, EngineResult } from "./types";

type Ctx = { userId: string; tenantId: string; permissions: string[] };
type Admin = ReturnType<typeof getAdminSupabaseClient>;

const fail = (error: EngineError): EngineResult => ({ ok: false, error });

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath(`/files/${fileId}/process`);
}

/**
 * Steps 1-3 of the engine checklist + the 9.0B structures sub-flag. Mirrors
 * actions.ts's guard (which cannot be exported from a "use server" module
 * without becoming a client-callable action itself).
 */
async function structuresGuard(permission: string, fileId: string | null): Promise<Ctx | EngineError> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.structures) return "engine_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  const tenantFlags = await getTenantProcessFlags(user.tenantId);
  if (!tenantFlags.enabled || !tenantFlags.structures) return "engine_disabled";
  if (fileId !== null && !(await isFileVisible(user.id, user.tenantId, fileId))) return "forbidden";
  const permissions = await getEffectivePermissions(user.id);
  return { userId: user.id, tenantId: user.tenantId, permissions };
}

const isErr = (v: Ctx | EngineError): v is EngineError => typeof v === "string";

/** The ACTIVE instance for a dossier, tenant-verified. */
async function loadInstance(admin: Admin, tenantId: string, fileId: string) {
  const { data } = await admin
    .from("process_instance")
    .select("id, tenant_id, file_id, status, owner_user_id")
    .eq("file_id", fileId)
    .neq("status", "CANCELLED")
    .maybeSingle();
  if (!data || data.tenant_id !== tenantId) return null;
  return data;
}

/** An ACTIVE (status='active') staff user of this tenant, with their role codes. */
async function loadActiveStaff(admin: Admin, tenantId: string, userId: string) {
  const { data: staff } = await admin
    .from("app_user")
    .select("id, tenant_id, status")
    .eq("id", userId)
    .maybeSingle();
  if (!staff || staff.tenant_id !== tenantId || staff.status !== "active") return null;
  const { data: roleRows } = await admin
    .from("user_role")
    .select("role:role_id(code)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .returns<{ role: { code: string } | { code: string }[] | null }[]>();
  const roles = (roleRows ?? [])
    .map((r) => (Array.isArray(r.role) ? r.role[0] : r.role))
    .filter((r): r is { code: string } => Boolean(r))
    .map((r) => r.code);
  return { id: staff.id, roles };
}

// ================================================================ ownership ====

/**
 * Assign (or change) the canonical operational owner of a dossier process.
 * The owner must be an ACTIVE same-tenant staff user whose roles map to
 * OPERATIONS in the canonical organization registry — the business rule
 * "the owner belongs to Operations". No override path exists in 9.0B
 * (a controlled exception would be a later, explicitly-approved addition).
 */
export async function assignProcessOwner(
  fileId: string,
  input: { ownerUserId: string; reason?: string },
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:owner:assign", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const target = await loadActiveStaff(admin, ctx.tenantId, input.ownerUserId);
  if (!target) return fail("not_found");
  const isOperations = target.roles.some((code) => roleCanonicalDepartment(code) === "OPERATIONS");
  if (!isOperations) return fail("forbidden");

  const before = instance.owner_user_id;
  if (before === input.ownerUserId) return { ok: true, id: instance.id }; // idempotent

  const { error } = await admin
    .from("process_instance")
    .update({
      owner_user_id: input.ownerUserId,
      owner_assigned_at: new Date().toISOString(),
      owner_assigned_by: ctx.userId,
      owner_assignment_reason: input.reason?.trim() || null,
    })
    .eq("id", instance.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return fail("invalid_state");

  await writeAudit({
    action: before ? AuditActions.PROCESS_OWNER_CHANGED : AuditActions.PROCESS_OWNER_ASSIGNED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_instance",
    entityId: instance.id,
    before: { owner_user_id: before },
    after: { owner_user_id: input.ownerUserId, reason: input.reason?.trim() || null },
  });
  revalidate(fileId);
  return { ok: true, id: instance.id };
}

// ================================================================ decisions ====

/**
 * Request a recorded workflow decision (e.g. « continuer avant confirmation du
 * paiement »). The reason is MANDATORY — a continuation without a recorded
 * justification is exactly the implicit default the business forbids.
 */
export async function requestProcessDecision(
  fileId: string,
  input: {
    decisionType: string;
    reason: string;
    stepKey?: string;
    supersedesDecisionId?: string;
  },
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:decision:create", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isDecisionType(input.decisionType)) return fail("unknown_step");
  if (!input.reason || input.reason.trim().length === 0) return fail("reason_required");
  if (input.stepKey && !isKnownStep(input.stepKey)) return fail("unknown_step");

  const admin = getAdminSupabaseClient();
  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  let stepExecutionId: string | null = null;
  if (input.stepKey) {
    const { data: exec } = await admin
      .from("process_step_execution")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .eq("step_key", input.stepKey)
      .not("state", "in", "(REJECTED,CANCELLED)")
      .maybeSingle();
    stepExecutionId = exec?.id ?? null;
  }

  if (input.supersedesDecisionId) {
    const { data: prior } = await admin
      .from("process_decision")
      .select("id, tenant_id, process_instance_id, status")
      .eq("id", input.supersedesDecisionId)
      .maybeSingle();
    if (!prior || prior.tenant_id !== ctx.tenantId || prior.process_instance_id !== instance.id) {
      return fail("not_found");
    }
    if (prior.status !== "FINALIZED") return fail("invalid_state"); // only a finalized decision can be superseded
  }

  const { data: created, error } = await admin
    .from("process_decision")
    .insert({
      tenant_id: ctx.tenantId,
      process_instance_id: instance.id,
      process_step_execution_id: stepExecutionId,
      decision_type: input.decisionType,
      requested_by: ctx.userId,
      reason: input.reason.trim(),
      supersedes_decision_id: input.supersedesDecisionId ?? null,
    })
    .select("id")
    .single();
  if (error || !created) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_DECISION_REQUESTED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_decision",
    entityId: created.id,
    after: {
      decision_type: input.decisionType,
      process_instance_id: instance.id,
      step_key: input.stepKey ?? null,
      supersedes: input.supersedesDecisionId ?? null,
    },
  });
  revalidate(fileId);
  return { ok: true, id: created.id };
}

/**
 * Finalize a pending decision with an outcome. Gated by the decision-type
 * POLICY (lib/process/decision-policy.ts — configurable, because manager-
 * approval rules are an unresolved business decision) on top of the base
 * permission. COMPARE-AND-SET on status='PENDING'; a finalized decision is
 * immutable at the database level (trigger), so history can never be rewritten.
 *
 * Finalizing CONTINUE_PROVISIONALLY / CONTINUE_WITH_APPROVAL does NOT touch any
 * payment or invoice record — Finance remains the only financial truth; the
 * decision only records that work may proceed.
 */
export async function finalizeProcessDecision(
  fileId: string,
  decisionId: string,
  input: { outcome: string; conditions?: string; expiresAt?: string },
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:decision:approve", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const { data: decision } = await admin
    .from("process_decision")
    .select("id, tenant_id, process_instance_id, decision_type, status")
    .eq("id", decisionId)
    .maybeSingle();
  if (!decision || decision.tenant_id !== ctx.tenantId || decision.process_instance_id !== instance.id) {
    return fail("not_found");
  }
  if (decision.status !== "PENDING") return fail("invalid_state");
  if (!isDecisionOutcome(decision.decision_type as DecisionType, input.outcome)) return fail("invalid_state");

  // The per-type POLICY seam: today every type requires the base permission the
  // guard already checked; a future business ruling tightens this table, not code.
  const policy = DECISION_POLICIES[decision.decision_type as DecisionType];
  if (policy.requiredPermission && !ctx.permissions.includes(policy.requiredPermission)) {
    return fail("forbidden");
  }

  const { data: updated, error } = await admin
    .from("process_decision")
    .update({
      outcome: input.outcome,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
      conditions: input.conditions?.trim() || null,
      expires_at: input.expiresAt ?? null,
      status: "FINALIZED",
    })
    .eq("id", decisionId)
    .eq("status", "PENDING") // CAS — a concurrent finalization matches zero rows
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_DECISION_FINALIZED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_decision",
    entityId: decisionId,
    after: {
      decision_type: decision.decision_type,
      outcome: input.outcome,
      expires_at: input.expiresAt ?? null,
    },
  });
  revalidate(fileId);
  return { ok: true, id: decisionId };
}

// ================================================================= blockers ====

const BLOCKER_CATEGORIES = [
  "MISSING_DOCUMENT", "CUSTOMER_RESPONSE_REQUIRED", "CUSTOMS_OBSERVATION", "PAYMENT_PENDING",
  "PAYMENT_REJECTED", "SUPPLIER_DELAY", "TRANSPORT_UNAVAILABLE", "FIELD_INCIDENT",
  "SYSTEM_DEPENDENCY", "OTHER",
] as const;
const BLOCKER_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export async function openProcessBlocker(
  fileId: string,
  input: {
    category: string;
    title: string;
    description?: string;
    severity?: string;
    stepKey?: string;
    customerVisible?: boolean;
    customerMessage?: string;
    dueAt?: string;
  },
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:blocker:manage", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!(BLOCKER_CATEGORIES as readonly string[]).includes(input.category)) return fail("invalid_state");
  if (!input.title || input.title.trim().length === 0) return fail("reason_required");
  if (input.severity && !(BLOCKER_SEVERITIES as readonly string[]).includes(input.severity)) return fail("invalid_state");
  if (input.stepKey && !isKnownStep(input.stepKey)) return fail("unknown_step");
  // A customer-visible blocker MUST carry a separately-written, customer-safe
  // message — the internal description never doubles as customer text.
  if (input.customerVisible && !input.customerMessage?.trim()) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  let stepExecutionId: string | null = null;
  if (input.stepKey) {
    const { data: exec } = await admin
      .from("process_step_execution")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("process_instance_id", instance.id)
      .eq("step_key", input.stepKey)
      .not("state", "in", "(REJECTED,CANCELLED)")
      .maybeSingle();
    stepExecutionId = exec?.id ?? null;
  }

  const { data: created, error } = await admin
    .from("process_blocker")
    .insert({
      tenant_id: ctx.tenantId,
      process_instance_id: instance.id,
      process_step_execution_id: stepExecutionId,
      category: input.category,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      severity: input.severity ?? "MEDIUM",
      opened_by: ctx.userId,
      customer_visible: input.customerVisible === true,
      customer_message: input.customerVisible === true ? input.customerMessage!.trim() : null,
      due_at: input.dueAt ?? null,
    })
    .select("id")
    .single();
  if (error || !created) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_BLOCKER_OPENED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_blocker",
    entityId: created.id,
    // Safe metadata only — never the internal description body.
    after: {
      category: input.category,
      severity: input.severity ?? "MEDIUM",
      step_key: input.stepKey ?? null,
      customer_visible: input.customerVisible === true,
    },
  });
  revalidate(fileId);
  return { ok: true, id: created.id };
}

/** OPEN → ACKNOWLEDGED / RESOLVED / CANCELLED; ACKNOWLEDGED → RESOLVED / CANCELLED. */
const BLOCKER_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "CANCELLED"],
  ACKNOWLEDGED: ["RESOLVED", "CANCELLED"],
  RESOLVED: [],
  CANCELLED: [],
};

async function transitionBlocker(
  fileId: string,
  blockerId: string,
  to: "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED",
  resolutionNote: string | null,
  auditAction: string,
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:blocker:manage", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();

  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const { data: blocker } = await admin
    .from("process_blocker")
    .select("id, tenant_id, process_instance_id, status, category")
    .eq("id", blockerId)
    .maybeSingle();
  if (!blocker || blocker.tenant_id !== ctx.tenantId || blocker.process_instance_id !== instance.id) {
    return fail("not_found");
  }
  if (!BLOCKER_TRANSITIONS[blocker.status]?.includes(to)) return fail("invalid_state");

  const terminal = to === "RESOLVED" || to === "CANCELLED";
  const { data: updated, error } = await admin
    .from("process_blocker")
    .update({
      status: to,
      ...(terminal
        ? { resolved_by: ctx.userId, resolved_at: new Date().toISOString(), resolution_note: resolutionNote }
        : {}),
    })
    .eq("id", blockerId)
    .eq("status", blocker.status) // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: auditAction,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_blocker",
    entityId: blockerId,
    before: { status: blocker.status },
    after: { status: to, category: blocker.category },
  });
  revalidate(fileId);
  return { ok: true, id: blockerId };
}

export async function acknowledgeProcessBlocker(fileId: string, blockerId: string): Promise<EngineResult> {
  return transitionBlocker(fileId, blockerId, "ACKNOWLEDGED", null, AuditActions.PROCESS_BLOCKER_ACKNOWLEDGED);
}

/**
 * Resolving a blocker records why, and nothing else: it never completes a step
 * — step progression stays with the engine's own transition actions.
 */
export async function resolveProcessBlocker(
  fileId: string,
  blockerId: string,
  resolutionNote: string,
): Promise<EngineResult> {
  if (!resolutionNote || resolutionNote.trim().length === 0) {
    return fail("reason_required");
  }
  return transitionBlocker(fileId, blockerId, "RESOLVED", resolutionNote.trim(), AuditActions.PROCESS_BLOCKER_RESOLVED);
}

export async function cancelProcessBlocker(fileId: string, blockerId: string, note?: string): Promise<EngineResult> {
  return transitionBlocker(fileId, blockerId, "CANCELLED", note?.trim() || null, AuditActions.PROCESS_BLOCKER_CANCELLED);
}

// ============================================================ Transit teams ====

const TEAM_CODES = ["AIBD", "MARITIME"] as const;

/**
 * Add (or reactivate) a Transit team member. Membership is organizational
 * metadata — it grants NOTHING; roles and permissions stay the only
 * authorization source. Not dossier-scoped, so the guard runs without a file.
 */
export async function addTeamMember(teamCode: string, userId: string): Promise<EngineResult> {
  const ctx = await structuresGuard("process:team:manage", null);
  if (isErr(ctx)) return fail(ctx);
  if (!(TEAM_CODES as readonly string[]).includes(teamCode)) return fail("invalid_state");

  const admin = getAdminSupabaseClient();
  const target = await loadActiveStaff(admin, ctx.tenantId, userId);
  if (!target) return fail("not_found");

  const { data: existing } = await admin
    .from("organization_team_member")
    .select("id, active")
    .eq("tenant_id", ctx.tenantId)
    .eq("team_code", teamCode)
    .eq("app_user_id", userId)
    .maybeSingle();

  let memberId: string;
  if (existing) {
    if (existing.active) return { ok: true, id: existing.id }; // idempotent
    const { error } = await admin
      .from("organization_team_member")
      .update({ active: true, assigned_at: new Date().toISOString(), assigned_by: ctx.userId })
      .eq("id", existing.id);
    if (error) return fail("invalid_state");
    memberId = existing.id;
  } else {
    const { data: created, error } = await admin
      .from("organization_team_member")
      .insert({ tenant_id: ctx.tenantId, team_code: teamCode, app_user_id: userId, assigned_by: ctx.userId })
      .select("id")
      .single();
    if (error || !created) return fail("invalid_state");
    memberId = created.id;
  }

  await writeAudit({
    action: AuditActions.PROCESS_TEAM_MEMBER_ADDED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "organization_team_member",
    entityId: memberId,
    after: { team_code: teamCode, app_user_id: userId },
  });
  return { ok: true, id: memberId };
}

/** Deactivate a membership (never a hard delete — history stays readable). */
export async function removeTeamMember(teamCode: string, userId: string): Promise<EngineResult> {
  const ctx = await structuresGuard("process:team:manage", null);
  if (isErr(ctx)) return fail(ctx);
  if (!(TEAM_CODES as readonly string[]).includes(teamCode)) return fail("invalid_state");

  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("organization_team_member")
    .select("id, active")
    .eq("tenant_id", ctx.tenantId)
    .eq("team_code", teamCode)
    .eq("app_user_id", userId)
    .maybeSingle();
  if (!existing || !existing.active) return fail("not_found");

  const { error } = await admin
    .from("organization_team_member")
    .update({ active: false })
    .eq("id", existing.id)
    .eq("active", true); // CAS
  if (error) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_TEAM_MEMBER_REMOVED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "organization_team_member",
    entityId: existing.id,
    before: { team_code: teamCode, app_user_id: userId, active: true },
    after: { active: false },
  });
  return { ok: true, id: existing.id };
}

/**
 * Target a step at a Transit team (AIBD / Maritime) — the T9 dispatch shape.
 * A team target does NOT make every member an individual assignee; per-user
 * assignment stays on assigned_user_id, untouched here.
 */
export async function assignStepTeam(
  fileId: string,
  stepKey: string,
  teamCode: string | null,
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:team:manage", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isKnownStep(stepKey)) return fail("unknown_step");
  if (teamCode !== null && !(TEAM_CODES as readonly string[]).includes(teamCode)) return fail("invalid_state");

  const admin = getAdminSupabaseClient();
  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const { data: exec } = await admin
    .from("process_step_execution")
    .select("id, state, assigned_team_code")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", instance.id)
    .eq("step_key", stepKey)
    .not("state", "in", "(REJECTED,CANCELLED)")
    .maybeSingle();
  if (!exec) return fail("not_found");

  const { error } = await admin
    .from("process_step_execution")
    .update({ assigned_team_code: teamCode })
    .eq("id", exec.id);
  if (error) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_TEAM_ASSIGNED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_step_execution",
    entityId: exec.id,
    before: { team_code: exec.assigned_team_code },
    after: { team_code: teamCode, step_key: stepKey },
  });
  revalidate(fileId);
  return { ok: true, id: exec.id };
}

// ============================================================ skipped steps ====

/**
 * Explicitly skip a non-applicable step. Two sources:
 *   DEFINITION — deterministic: the applicability registry says this step does
 *                not apply to this dossier's TYPE (e.g. customs steps on TRP/HND).
 *   MANUAL     — an authorized human call for dossier-specific conditions the
 *                definitions cannot see yet (no delivery leg purchased, contract-
 *                client cotation…). Requires the same narrow permission.
 * Both require a reason and both are audited. Skipped ≠ completed: the state
 * machine records SKIPPED, closure readiness accepts it, and the customer
 * timeline never renders it.
 */
export async function skipStep(
  fileId: string,
  stepKey: string,
  input: { reason: string; source: "DEFINITION" | "MANUAL" },
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:step:skip", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isKnownStep(stepKey)) return fail("unknown_step");
  if (!input.reason || input.reason.trim().length === 0) return fail("reason_required");
  if (input.source !== "DEFINITION" && input.source !== "MANUAL") return fail("invalid_state");

  const admin = getAdminSupabaseClient();
  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  // DEFINITION skips must actually be definition-backed for THIS dossier's type.
  if (input.source === "DEFINITION") {
    const { data: file } = await admin
      .from("operational_file")
      .select("id, type, tenant_id")
      .eq("id", fileId)
      .maybeSingle();
    if (!file || file.tenant_id !== ctx.tenantId) return fail("not_found");
    if (stepAppliesToFileType(stepKey, file.type)) return fail("invalid_state");
  }

  const { data: exec } = await admin
    .from("process_step_execution")
    .select("id, state")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", instance.id)
    .eq("step_key", stepKey)
    .not("state", "in", "(REJECTED,CANCELLED)")
    .maybeSingle();
  if (!exec) return fail("not_found");
  if (!canTransitionStep(exec.state as never, "SKIPPED")) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("process_step_execution")
    .update({
      state: "SKIPPED",
      skipped_by: ctx.userId,
      skipped_at: new Date().toISOString(),
      skip_reason: input.reason.trim(),
      skip_source: input.source,
    })
    .eq("id", exec.id)
    .eq("state", exec.state) // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_STEP_SKIPPED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_step_execution",
    entityId: exec.id,
    before: { state: exec.state },
    after: { state: "SKIPPED", step_key: stepKey, source: input.source },
  });
  revalidate(fileId);
  return { ok: true, id: exec.id };
}

/** Reopen a skipped step (SKIPPED → PENDING). Audited; requires a reason. */
export async function reopenSkippedStep(
  fileId: string,
  stepKey: string,
  reason: string,
): Promise<EngineResult> {
  const ctx = await structuresGuard("process:step:skip", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isKnownStep(stepKey)) return fail("unknown_step");
  if (!reason || reason.trim().length === 0) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const instance = await loadInstance(admin, ctx.tenantId, fileId);
  if (!instance) return fail("not_found");

  const { data: exec } = await admin
    .from("process_step_execution")
    .select("id, state")
    .eq("tenant_id", ctx.tenantId)
    .eq("process_instance_id", instance.id)
    .eq("step_key", stepKey)
    .eq("state", "SKIPPED")
    .maybeSingle();
  if (!exec) return fail("not_found");
  if (!canTransitionStep("SKIPPED", "PENDING")) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("process_step_execution")
    .update({
      state: "PENDING",
      skipped_by: null,
      skipped_at: null,
      skip_reason: null,
      skip_source: null,
    })
    .eq("id", exec.id)
    .eq("state", "SKIPPED") // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.PROCESS_STEP_SKIP_REOPENED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "process_step_execution",
    entityId: exec.id,
    before: { state: "SKIPPED" },
    after: { state: "PENDING", step_key: stepKey, reason: reason.trim() },
  });
  revalidate(fileId);
  return { ok: true, id: exec.id };
}
