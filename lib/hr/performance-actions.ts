"use server";

/**
 * HR-6 — Performance actions.
 *
 * SEPARATION OF AUTHORITY, EXPLICIT:
 *   cycles · objectives · self-assessment · manager review · competencies → hr:manage
 *   FINALIZE an evaluation                                    → hr:performance:finalize
 *   competency CATALOG and scales                             → hr:config:manage
 *
 * `hr:performance:finalize` exists in the catalogue and is GRANTED TO NO ROLE
 * until management ratifies it (docs/hr/hr-6-permission-analysis.md). It
 * therefore denies everyone today — deliberately, on the `hr:leave:approve`
 * precedent. Finalization freezes a person's performance record permanently;
 * letting it ride hr:manage would make that irreversible act as routine as
 * editing a phone number.
 *
 * Every consequential operation goes through a transactional RPC (ADR-HR2-01 as
 * hardened in HR-4/HR-5): the transition, the domain writes and the ledger
 * events commit together or not at all. No compensation-based multi-call write
 * exists in this module.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { WEIGHT_TOTAL_BP } from "./performance/scoring";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];

export type PerfResult = { ok: true; id?: string; count?: number } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  HR601: "cycle_immutable", HR602: "cycle_terminal", HR603: "forbidden_transition",
  HR604: "evaluation_immutable", HR605: "objective_locked", HR606: "competency_not_found",
  HR607: "level_out_of_scale", HR608: "cycle_not_found", HR609: "cycle_not_draft",
  HR610: "evaluation_not_found", HR611: "cycle_not_open", HR612: "self_already_submitted",
  HR613: "self_not_submitted", HR614: "same_actor_self", HR615: "manager_not_submitted",
  HR616: "same_actor_manager", HR617: "weight_total_mismatch", HR618: "not_finalized",
  HR619: "weight_out_of_range", HR620: "title_required", HR621: "cycle_closed",
  HR622: "objective_not_found",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code]) || "save_failed",
  detail: e?.message,
});

const PATH = "/departments/hr/performance";

/* ========================================================================== */
/* Cycles                                                                     */
/* ========================================================================== */

/** Create a cycle in DRAFT. `cycleKind` is tenant vocabulary, never an enum. */
export async function createPerformanceCycle(input: {
  code: string; labelFr: string; cycleKind: string;
  periodStart: string; periodEnd: string;
  submissionDeadline?: string | null; reviewDeadline?: string | null;
  targetScope?: "ALL_ACTIVE" | "ORG_UNIT" | "POSITION";
  targetOrgUnitId?: string | null; targetPositionId?: string | null;
  weightTotalBp?: number;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!input.code.trim() || !input.labelFr.trim() || !input.cycleKind.trim()) {
    return { ok: false, error: "missing_field" };
  }
  const weight = input.weightTotalBp ?? WEIGHT_TOTAL_BP;
  if (!Number.isInteger(weight) || weight <= 0) return { ok: false, error: "invalid_weight_total" };
  if (input.periodEnd < input.periodStart) return { ok: false, error: "invalid_period" };

  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_performance_cycle").insert({
    tenant_id: admin.tenantId, code: input.code.trim(), label_fr: input.labelFr.trim(),
    cycle_kind: input.cycleKind.trim(), period_start: input.periodStart, period_end: input.periodEnd,
    submission_deadline: input.submissionDeadline || null,
    review_deadline: input.reviewDeadline || null,
    target_scope: input.targetScope ?? "ALL_ACTIVE",
    target_org_unit_id: input.targetOrgUnitId || null,
    target_position_id: input.targetPositionId || null,
    weight_total_bp: weight, hr_owner_id: admin.id, created_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };

  await writeAudit({ action: "hr.performance.cycle_created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_performance_cycle", entityId: data.id, after: { code: input.code, kind: input.cycleKind } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/**
 * DRAFT → OPEN. Materializes one evaluation per targeted employee and puts the
 * event on each of their timelines, in one transaction.
 */
export async function openPerformanceCycle(cycleId: string): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_open_performance_cycle", {
    p_tenant: admin.tenantId, p_cycle: cycleId, p_actor: admin.id,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.cycle_opened", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_performance_cycle", entityId: cycleId, after: { evaluations_created: data ?? 0 } });
  revalidatePath(PATH);
  return { ok: true, id: cycleId, count: (data as number | null) ?? 0 };
}

/** OPEN → IN_REVIEW, or IN_REVIEW → FINALIZED. The trigger owns the legality. */
export async function advancePerformanceCycle(
  cycleId: string, to: "IN_REVIEW" | "FINALIZED",
): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const patch: Tbl["hr_performance_cycle"]["Update"] = { status: to };
  if (to === "FINALIZED") patch.finalized_at = new Date().toISOString();
  const { error } = await s.from("hr_performance_cycle").update(patch)
    .eq("id", cycleId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: `hr.performance.cycle_${to.toLowerCase()}`, actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_performance_cycle", entityId: cycleId, after: { status: to } });
  revalidatePath(PATH);
  return { ok: true, id: cycleId };
}

export async function cancelPerformanceCycle(cycleId: string, reason: string): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.from("hr_performance_cycle").update({
    status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: reason.trim(),
  }).eq("id", cycleId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.cycle_cancelled", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_performance_cycle", entityId: cycleId, after: { reason: reason.trim() } });
  revalidatePath(PATH);
  return { ok: true, id: cycleId };
}

/* ========================================================================== */
/* Objectives                                                                 */
/* ========================================================================== */

/** Assign an objective. An amendment passes `supersedesObjectiveId` — the old
 *  row becomes SUPERSEDED and survives; nothing is rewritten. */
export async function assignObjective(input: {
  cycleId: string; employeeId: string; title: string; weightBp: number;
  description?: string | null; category?: string | null;
  measurableTarget?: string | null; dueDate?: string | null;
  supersedesObjectiveId?: string | null;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(input.weightBp) || input.weightBp < 0 || input.weightBp > WEIGHT_TOTAL_BP) {
    return { ok: false, error: "weight_out_of_range" };
  }
  if (!input.title.trim()) return { ok: false, error: "title_required" };

  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_assign_objective", {
    p_tenant: admin.tenantId, p_cycle: input.cycleId, p_employee: input.employeeId,
    p_actor: admin.id, p_title: input.title.trim(), p_weight_bp: input.weightBp,
    p_description: input.description || null, p_category: input.category || null,
    p_target: input.measurableTarget || null, p_due: input.dueDate || null,
    p_supersedes: input.supersedesObjectiveId || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.objective_assigned", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_objective", entityId: (data as string) ?? null,
    after: { employee_id: input.employeeId, weight_bp: input.weightBp,
             amendment: Boolean(input.supersedesObjectiveId) } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

/**
 * Progress and manager achievement, both in basis points. Deliberately NOT
 * emitted to the employee timeline (§12): a progress edit is not a chapter in
 * someone's employment story. It is audited normally instead.
 */
export async function updateObjectiveProgress(input: {
  objectiveId: string; progressBp?: number; managerAchievementBp?: number | null;
  managerAssessment?: string | null; completionNote?: string | null;
  status?: "ACTIVE" | "ACHIEVED" | "PARTIAL" | "MISSED" | "CANCELLED";
  evidenceDocumentId?: string | null;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const inRange = (v: number | null | undefined) =>
    v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= WEIGHT_TOTAL_BP);
  if (!inRange(input.progressBp) || !inRange(input.managerAchievementBp)) {
    return { ok: false, error: "bp_out_of_range" };
  }

  const patch: Tbl["hr_objective"]["Update"] = {};
  if (input.progressBp !== undefined) patch.progress_bp = input.progressBp;
  if (input.managerAchievementBp !== undefined) patch.manager_achievement_bp = input.managerAchievementBp;
  if (input.managerAssessment !== undefined) patch.manager_assessment = input.managerAssessment;
  if (input.completionNote !== undefined) patch.completion_note = input.completionNote;
  if (input.status !== undefined) patch.status = input.status;
  if (input.evidenceDocumentId !== undefined) patch.evidence_document_id = input.evidenceDocumentId;
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_update" };

  const s = getAdminSupabaseClient();
  const { error } = await s.from("hr_objective").update(patch)
    .eq("id", input.objectiveId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.objective_updated", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_objective", entityId: input.objectiveId,
    after: { progress_bp: input.progressBp ?? null, status: input.status ?? null } });
  revalidatePath(PATH);
  return { ok: true, id: input.objectiveId };
}

/* ========================================================================== */
/* The four-stage evaluation workflow                                         */
/* ========================================================================== */

/**
 * Stage 1. NOTE ON WHO IS SPEAKING: until an employee self-service surface
 * exists (HRQ-P1), the login recorded here belongs to an HR operator entering
 * the employee's words, not to the employee. The column is named
 * `self_entered_by` for exactly that reason, and the audit records the same.
 */
export async function submitSelfAssessment(evaluationId: string, comments: string): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_submit_self_assessment", {
    p_tenant: admin.tenantId, p_evaluation: evaluationId, p_actor: admin.id,
    p_comments: comments,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  // C3 DISCIPLINE: the audit records THAT a stage happened, never its prose.
  await writeAudit({ action: "hr.performance.self_submitted", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_evaluation", entityId: evaluationId });
  revalidatePath(PATH);
  return { ok: true, id: evaluationId };
}

/** Stage 2. The RPC refuses an actor who already filled the self-assessment. */
export async function submitManagerReview(input: {
  evaluationId: string; comments: string; strengths?: string | null;
  development?: string | null; recommendedActions?: string | null;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_submit_manager_review", {
    p_tenant: admin.tenantId, p_evaluation: input.evaluationId, p_actor: admin.id,
    p_comments: input.comments, p_strengths: input.strengths || null,
    p_development: input.development || null, p_actions: input.recommendedActions || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.manager_submitted", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_evaluation", entityId: input.evaluationId });
  revalidatePath(PATH);
  return { ok: true, id: input.evaluationId };
}

/**
 * Stage 3 — THE consequential act. Gated on hr:performance:finalize, which
 * nobody holds until ratification. The RPC independently enforces the weight
 * total and the actor separation, so this gate is not the only thing standing
 * between a record and permanence.
 */
export async function finalizeEvaluation(input: {
  evaluationId: string; moderationNote?: string | null; finalSummary?: string | null;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:performance:finalize"); }
  catch { return { ok: false, error: "forbidden_finalize" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_finalize_evaluation", {
    p_tenant: admin.tenantId, p_evaluation: input.evaluationId, p_actor: admin.id,
    p_moderation_note: input.moderationNote || null, p_final_summary: input.finalSummary || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.finalized", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_evaluation", entityId: input.evaluationId });
  revalidatePath(PATH);
  return { ok: true, id: input.evaluationId };
}

/** Stage 4 — receipt, never approval. The trigger guarantees nothing else moves. */
export async function acknowledgeEvaluation(evaluationId: string, note?: string): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_acknowledge_evaluation", {
    p_tenant: admin.tenantId, p_evaluation: evaluationId, p_actor: admin.id,
    p_note: note?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.performance.acknowledged", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_evaluation", entityId: evaluationId });
  revalidatePath(PATH);
  return { ok: true, id: evaluationId };
}

/* ========================================================================== */
/* Competencies — catalog is CONFIGURATION, assessment is HR work             */
/* ========================================================================== */

/**
 * The competency catalog and its scales are tenant configuration, so they sit
 * behind hr:config:manage — the same gate as positions and org units. No
 * competency is seeded by the platform: what this company values in its people
 * is not a decision a migration gets to make.
 */
export async function upsertCompetency(input: {
  id?: string; code: string; labelFr: string; description?: string | null;
  category?: string | null; scaleMin?: number; scaleMax?: number;
  scaleLabels?: Record<string, string>; isActive?: boolean;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:config:manage"); } catch { return { ok: false, error: "forbidden_config" }; }
  const min = input.scaleMin ?? 1;
  const max = input.scaleMax ?? 5;
  if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min) {
    return { ok: false, error: "invalid_scale" };
  }
  if (!input.code.trim() || !input.labelFr.trim()) return { ok: false, error: "missing_field" };

  const s = getAdminSupabaseClient();
  const row = {
    tenant_id: admin.tenantId, code: input.code.trim(), label_fr: input.labelFr.trim(),
    description: input.description || null, category: input.category || null,
    scale_min: min, scale_max: max, scale_labels: input.scaleLabels ?? {},
    is_active: input.isActive ?? true,
  };
  if (input.id) {
    const { error } = await s.from("hr_competency").update(row)
      .eq("id", input.id).eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed", detail: error.message };
    await writeAudit({ action: "hr.performance.competency_updated", actorId: admin.id,
      tenantId: admin.tenantId, entity: "hr_competency", entityId: input.id, after: { code: row.code } });
    revalidatePath(PATH);
    return { ok: true, id: input.id };
  }
  const { data, error } = await s.from("hr_competency").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };
  await writeAudit({ action: "hr.performance.competency_created", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_competency", entityId: data.id, after: { code: row.code } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/** Record a competency level. The scale trigger refuses off-scale values. */
export async function recordCompetencyAssessment(input: {
  evaluationId: string; competencyId: string;
  selfLevel?: number | null; managerLevel?: number | null;
  expectedLevel?: number | null; note?: string | null;
}): Promise<PerfResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();

  const { data: existing } = await s.from("hr_competency_assessment").select("id")
    .eq("tenant_id", admin.tenantId).eq("evaluation_id", input.evaluationId)
    .eq("competency_id", input.competencyId).maybeSingle();

  const row = {
    tenant_id: admin.tenantId, evaluation_id: input.evaluationId,
    competency_id: input.competencyId, self_level: input.selfLevel ?? null,
    manager_level: input.managerLevel ?? null, expected_level: input.expectedLevel ?? null,
    note: input.note || null,
  };
  const { data, error } = existing
    ? await s.from("hr_competency_assessment").update(row).eq("id", existing.id)
        .eq("tenant_id", admin.tenantId).select("id").single()
    : await s.from("hr_competency_assessment").insert(row).select("id").single();
  if (error || !data) return { ok: false, ...mapRpc(error) };

  await writeAudit({ action: "hr.performance.competency_assessed", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_competency_assessment", entityId: data.id,
    after: { evaluation_id: input.evaluationId, competency_id: input.competencyId } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}
