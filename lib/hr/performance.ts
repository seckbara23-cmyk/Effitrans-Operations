import "server-only";

/**
 * HR-6 — Performance, objectives and competencies. READ SIDE. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * TWO DISCIPLINES THIS MODULE ENFORCES IN CODE:
 *
 * 1. NO AGGREGATE SCORE IS COMPUTED. Nowhere below is an average, a total
 *    rating, a ranking or a talent classification derived. The scoring
 *    PRIMITIVES are returned as stored — integer basis points and tenant-scale
 *    levels — and the reader decides what they mean. A formula would be a
 *    management decision (HRQ-P3), not a rendering choice.
 *
 * 2. C3 CONTENT IS WITHHELD, NOT ZEROED. Evaluation prose — self comments,
 *    manager comments, strengths, development areas, moderation, summary — is
 *    C3. A reader holding only `hr:read` gets the WORKFLOW (who, which stage,
 *    when) and never the CONTENT. `hr:sensitive:read` unlocks the prose, exactly
 *    as it unlocks C3-classed documents in HR-3. No new read permission was
 *    invented to do this.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Evaluation, Objective, PerformanceCycle, Competency, CompetencyAssessment, CycleStatus, EvaluationStatus } from "./performance/scoring";

// The pure primitives live in ./performance/scoring so the CLIENT workspace can
// import them: a `server-only` module cannot cross that boundary. Re-exported
// here so server callers still have one import.
export * from "./performance/scoring";

const WORKFLOW_COLUMNS =
  "id, cycle_id, employee_id, manager_employee_id, status, self_submitted_at, " +
  "manager_submitted_at, finalized_at, acknowledged_at, self_entered_by, " +
  "manager_entered_by, finalized_by";
const C3_COLUMNS =
  "self_comments, manager_comments, manager_strengths, manager_development, " +
  "recommended_actions, moderation_note, final_summary";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapEvaluation(r: any, canReadSensitive: boolean): Evaluation {
  return {
    id: r.id,
    cycleId: r.cycle_id,
    employeeId: r.employee_id,
    managerEmployeeId: r.manager_employee_id,
    status: r.status,
    selfSubmittedAt: r.self_submitted_at,
    managerSubmittedAt: r.manager_submitted_at,
    finalizedAt: r.finalized_at,
    acknowledgedAt: r.acknowledged_at,
    selfEnteredBy: r.self_entered_by,
    managerEnteredBy: r.manager_entered_by,
    finalizedBy: r.finalized_by,
    contentWithheld: !canReadSensitive,
    selfComments: canReadSensitive ? (r.self_comments ?? null) : null,
    managerComments: canReadSensitive ? (r.manager_comments ?? null) : null,
    managerStrengths: canReadSensitive ? (r.manager_strengths ?? null) : null,
    managerDevelopment: canReadSensitive ? (r.manager_development ?? null) : null,
    recommendedActions: canReadSensitive ? (r.recommended_actions ?? null) : null,
    moderationNote: canReadSensitive ? (r.moderation_note ?? null) : null,
    finalSummary: canReadSensitive ? (r.final_summary ?? null) : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listCycles(tenantId: string): Promise<PerformanceCycle[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s
    .from("hr_performance_cycle")
    .select("id, code, label_fr, cycle_kind, status, period_start, period_end, submission_deadline, review_deadline, weight_total_bp, target_scope, finalized_at")
    .eq("tenant_id", tenantId)
    .order("period_start", { ascending: false });
  if (error) throw new Error(`[hr] cycles read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, code: r.code, labelFr: r.label_fr, cycleKind: r.cycle_kind,
    status: r.status as CycleStatus, periodStart: r.period_start, periodEnd: r.period_end,
    submissionDeadline: r.submission_deadline, reviewDeadline: r.review_deadline,
    weightTotalBp: r.weight_total_bp, targetScope: r.target_scope, finalizedAt: r.finalized_at,
  }));
}

export async function getCycle(tenantId: string, cycleId: string): Promise<PerformanceCycle | null> {
  const all = await listCycles(tenantId);
  return all.find((c) => c.id === cycleId) ?? null;
}

/**
 * Evaluations for a cycle. The C3 columns are only REQUESTED when the reader
 * may see them: withholding at the query, not merely at the mapping, keeps the
 * prose out of the process memory of a request that had no right to it.
 */
export async function listEvaluations(
  tenantId: string,
  opts: { cycleId?: string; employeeId?: string; canReadSensitive: boolean },
): Promise<Evaluation[]> {
  const s = getAdminSupabaseClient();
  const columns = opts.canReadSensitive ? `${WORKFLOW_COLUMNS}, ${C3_COLUMNS}` : WORKFLOW_COLUMNS;
  let q = s.from("hr_evaluation").select(columns).eq("tenant_id", tenantId);
  if (opts.cycleId) q = q.eq("cycle_id", opts.cycleId);
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`[hr] evaluations read failed: ${error.message}`);
  return (data ?? []).map((r) => mapEvaluation(r, opts.canReadSensitive));
}

export async function getEvaluation(
  tenantId: string, evaluationId: string, canReadSensitive: boolean,
): Promise<Evaluation | null> {
  const s = getAdminSupabaseClient();
  const columns = canReadSensitive ? `${WORKFLOW_COLUMNS}, ${C3_COLUMNS}` : WORKFLOW_COLUMNS;
  const { data, error } = await s.from("hr_evaluation").select(columns)
    .eq("tenant_id", tenantId).eq("id", evaluationId).maybeSingle();
  if (error) throw new Error(`[hr] evaluation read failed: ${error.message}`);
  return data ? mapEvaluation(data, canReadSensitive) : null;
}

export async function listObjectives(
  tenantId: string, opts: { cycleId?: string; employeeId?: string } = {},
): Promise<Objective[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_objective").select("id, employee_id, cycle_id, title, description, category, weight_bp, measurable_target, due_date, status, progress_bp, manager_achievement_bp, manager_assessment, completion_note, evidence_document_id, version, supersedes_objective_id, locked_at",
  ).eq("tenant_id", tenantId);
  if (opts.cycleId) q = q.eq("cycle_id", opts.cycleId);
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  const { data, error } = await q.order("created_at").limit(1000);
  if (error) throw new Error(`[hr] objectives read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, cycleId: r.cycle_id, title: r.title,
    description: r.description, category: r.category, weightBp: r.weight_bp,
    measurableTarget: r.measurable_target, dueDate: r.due_date, status: r.status,
    progressBp: r.progress_bp, managerAchievementBp: r.manager_achievement_bp,
    managerAssessment: r.manager_assessment, completionNote: r.completion_note,
    evidenceDocumentId: r.evidence_document_id, version: r.version,
    supersedesObjectiveId: r.supersedes_objective_id, locked: r.locked_at !== null,
  }));
}

export async function listCompetencies(tenantId: string, activeOnly = false): Promise<Competency[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_competency")
    .select("id, code, label_fr, description, category, scale_min, scale_max, scale_labels, is_active")
    .eq("tenant_id", tenantId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q.order("code");
  if (error) throw new Error(`[hr] competencies read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, code: r.code, labelFr: r.label_fr, description: r.description,
    category: r.category, scaleMin: r.scale_min, scaleMax: r.scale_max,
    scaleLabels: (r.scale_labels ?? {}) as Record<string, string>, isActive: r.is_active,
  }));
}

/** Levels are primitives. No gap score, no average, no derived rating. */
export async function listCompetencyAssessments(
  tenantId: string, evaluationId: string,
): Promise<CompetencyAssessment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_competency_assessment")
    .select("id, competency_id, self_level, manager_level, expected_level, note")
    .eq("tenant_id", tenantId).eq("evaluation_id", evaluationId);
  if (error) throw new Error(`[hr] competency assessments read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, competencyId: r.competency_id, selfLevel: r.self_level,
    managerLevel: r.manager_level, expectedLevel: r.expected_level, note: r.note,
  }));
}

/**
 * Counts for the HR workspace. COUNTS ONLY — nothing here is an average, a
 * ranking or a rating. Each is a fact you could verify by opening a list.
 */
export type PerformanceCounts = {
  cyclesInProgress: number;
  awaitingSelf: number;
  awaitingManager: number;
  awaitingFinalization: number;
  awaitingAcknowledgment: number;
  objectivesOverdue: number;
};

export async function performanceCounts(tenantId: string): Promise<PerformanceCounts> {
  const s = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const today = new Date().toISOString().slice(0, 10);
  const evals = (status: string) =>
    s.from("hr_evaluation").select("id", head).eq("tenant_id", tenantId).eq("status", status);

  const [cycles, self, manager, finalize, ack, overdue] = await Promise.all([
    s.from("hr_performance_cycle").select("id", head).eq("tenant_id", tenantId)
      .in("status", ["OPEN", "IN_REVIEW"]),
    evals("DRAFT"),
    evals("SELF_SUBMITTED"),
    evals("MANAGER_SUBMITTED"),
    evals("FINALIZED"),
    s.from("hr_objective").select("id", head).eq("tenant_id", tenantId)
      .is("locked_at", null).lt("due_date", today).in("status", ["DRAFT", "ACTIVE"]),
  ]);

  return {
    cyclesInProgress: cycles.count ?? 0,
    awaitingSelf: self.count ?? 0,
    awaitingManager: manager.count ?? 0,
    awaitingFinalization: finalize.count ?? 0,
    awaitingAcknowledgment: ack.count ?? 0,
    objectivesOverdue: overdue.count ?? 0,
  };
}
