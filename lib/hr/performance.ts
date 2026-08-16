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
 *
 * 3. HR-B2 — IDENTITY-SCOPED DISCLOSURE (Q2, ratified). Two narrow lanes join
 *    the org-wide permission: an employee reads the prose of their OWN
 *    evaluation, and the manager SNAPSHOTTED on an evaluation reads that
 *    employee's self-assessment plus the review they authored. The rule is
 *    pure (./performance/disclosure) and it neither grants nor implies
 *    `hr:sensitive:read`.
 *
 *    THE WITHHOLDING DISCIPLINE SURVIVES THE CHANGE: prose is still never
 *    fetched for a row the reader has no lane on. The workflow columns are
 *    read for every row; the C3 columns are read in a SECOND, narrowed query
 *    restricted to the rows the reader may see — so a reader with a lane on
 *    their own row does not pull a colleague's prose into memory on the way.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { evaluationDisclosure, hasAnyDisclosure, type DisclosureScope } from "./performance/disclosure";
import type { Evaluation, Objective, PerformanceCycle, Competency, CompetencyAssessment, CycleStatus, EvaluationStatus } from "./performance/scoring";

// The pure primitives live in ./performance/scoring so the CLIENT workspace can
// import them: a `server-only` module cannot cross that boundary. Re-exported
// here so server callers still have one import.
export * from "./performance/scoring";

type WorkflowRow = {
  id: string; cycle_id: string; employee_id: string; manager_employee_id: string | null;
  status: string; self_submitted_at: string | null; manager_submitted_at: string | null;
  finalized_at: string | null; acknowledged_at: string | null;
  self_entered_by: string | null; manager_entered_by: string | null; finalized_by: string | null;
};

const WORKFLOW_COLUMNS =
  "id, cycle_id, employee_id, manager_employee_id, status, self_submitted_at, " +
  "manager_submitted_at, finalized_at, acknowledged_at, self_entered_by, " +
  "manager_entered_by, finalized_by";
const C3_COLUMNS =
  "self_comments, manager_comments, manager_strengths, manager_development, " +
  "recommended_actions, moderation_note, final_summary";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Merge a workflow row with the prose the reader's lanes actually disclose. */
function mapEvaluation(r: any, prose: any | null, scope: DisclosureScope): Evaluation {
  const p = prose ?? {};
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
    contentWithheld: !hasAnyDisclosure(scope),
    selfComments: scope.self ? (p.self_comments ?? null) : null,
    managerComments: scope.manager ? (p.manager_comments ?? null) : null,
    managerStrengths: scope.manager ? (p.manager_strengths ?? null) : null,
    managerDevelopment: scope.manager ? (p.manager_development ?? null) : null,
    recommendedActions: scope.manager ? (p.recommended_actions ?? null) : null,
    moderationNote: scope.hr ? (p.moderation_note ?? null) : null,
    finalSummary: scope.hr ? (p.final_summary ?? null) : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type EvaluationReader = {
  /** The org-wide sensitive authority (hr:sensitive:read). */
  canReadSensitive: boolean;
  /** The reader's linked ACTIVE employee id, when they have one. */
  viewerEmployeeId?: string | null;
};

/**
 * Fetch the C3 columns for exactly the rows this reader has a lane on.
 * A reader with neither the org-wide permission nor an identity gets no query
 * at all — the prose never enters the process.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchProse(
  tenantId: string, ids: string[], reader: EvaluationReader,
): Promise<Map<string, any>> {
  const viewer = reader.viewerEmployeeId ?? null;
  if (ids.length === 0 || (!reader.canReadSensitive && !viewer)) return new Map();
  const s = getAdminSupabaseClient();
  let q = s.from("hr_evaluation").select(`id, ${C3_COLUMNS}`).eq("tenant_id", tenantId).in("id", ids);
  if (!reader.canReadSensitive && viewer) {
    // The narrowing that keeps the discipline: own row, or a row whose
    // SNAPSHOTTED manager is the reader. Nothing else is even selected.
    q = q.or(`employee_id.eq.${viewer},manager_employee_id.eq.${viewer}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`[hr] evaluation content read failed: ${error.message}`);
  return new Map((data ?? []).map((r: any) => [r.id, r]));
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
  opts: { cycleId?: string; employeeId?: string; managerEmployeeId?: string } & EvaluationReader,
): Promise<Evaluation[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_evaluation").select(WORKFLOW_COLUMNS).eq("tenant_id", tenantId);
  if (opts.cycleId) q = q.eq("cycle_id", opts.cycleId);
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  if (opts.managerEmployeeId) q = q.eq("manager_employee_id", opts.managerEmployeeId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500)
    .returns<WorkflowRow[]>();
  if (error) throw new Error(`[hr] evaluations read failed: ${error.message}`);
  const rows = data ?? [];
  const prose = await fetchProse(tenantId, rows.map((r) => r.id), opts);
  return rows.map((r) => {
    const scope = evaluationDisclosure({
      canReadSensitive: opts.canReadSensitive,
      viewerEmployeeId: opts.viewerEmployeeId ?? null,
      evaluation: { employeeId: r.employee_id, managerEmployeeId: r.manager_employee_id },
    });
    return mapEvaluation(r, prose.get(r.id) ?? null, scope);
  });
}

export async function getEvaluation(
  tenantId: string, evaluationId: string, reader: EvaluationReader,
): Promise<Evaluation | null> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_evaluation").select(WORKFLOW_COLUMNS)
    .eq("tenant_id", tenantId).eq("id", evaluationId).maybeSingle()
    .returns<WorkflowRow | null>();
  if (error) throw new Error(`[hr] evaluation read failed: ${error.message}`);
  if (!data) return null;
  const scope = evaluationDisclosure({
    canReadSensitive: reader.canReadSensitive,
    viewerEmployeeId: reader.viewerEmployeeId ?? null,
    evaluation: { employeeId: data.employee_id, managerEmployeeId: data.manager_employee_id },
  });
  const prose = hasAnyDisclosure(scope) ? await fetchProse(tenantId, [data.id], reader) : new Map();
  return mapEvaluation(data, prose.get(data.id) ?? null, scope);
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
