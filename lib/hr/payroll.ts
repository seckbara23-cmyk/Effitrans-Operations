import "server-only";

/**
 * HR-7A/7B — payroll preparation reads. SERVER-ONLY. FACTS ONLY.
 * ---------------------------------------------------------------------------
 * Nothing in this module computes, stores or formats money — HR-7 prepares
 * FACTS (identity, movements, attendance quantities, approved-leave tenths,
 * quantified adjustments) for an external payroll process. DEC-B63 and the
 * HR-7 audit are the governing boundary; Q1 gates any amount ever appearing.
 *
 * TWO-TIER READS (§9 of the audit): the period REGISTER (codes, dates,
 * statuses, counts) rides `hr:read` like every HR workflow surface. The LINE
 * CONTENT — per-person presence facts — is confidential: it is returned only
 * to the preparing desk (`hr:manage`, which writes these lines through the
 * governed RPCs and must see what it verifies) or to a holder of the PARKED
 * `hr:payroll:read` (the future read-only seat — Q7/Q8). `hr:sensitive:read`
 * is deliberately NOT consulted: payroll has its own, narrower door.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

// The pure primitives live in ./payroll/model so the CLIENT workspace can
// import them (labels, types, the read-tier rule): a `server-only` module
// cannot cross that boundary. Re-exported here so server callers keep one
// import — the lib/hr/performance ⇄ performance/scoring idiom.
export * from "./payroll/model";
import type {
  PayrollPeriod, PayrollLine, PayrollAdjustment, PayrollAdjustmentKind,
  PayrollPeriodStatus, LeaveBreakdownEntry,
} from "./payroll/model";

export async function listPayrollPeriods(tenantId: string): Promise<PayrollPeriod[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_payroll_period")
    .select("id, code, label_fr, period_start, period_end, status, cutoff_at, line_count, draft_excluded_count, prepared_by, verified_by, approved_by, locked_at, cancellation_reason, version, supersedes_period_id")
    .eq("tenant_id", tenantId)
    .order("period_start", { ascending: false }).order("version", { ascending: false });
  if (error) throw new Error(`[hr] payroll periods read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, code: r.code, labelFr: r.label_fr,
    periodStart: r.period_start, periodEnd: r.period_end,
    status: r.status as PayrollPeriodStatus, cutoffAt: r.cutoff_at,
    lineCount: r.line_count, draftExcludedCount: r.draft_excluded_count,
    preparedBy: r.prepared_by, verifiedBy: r.verified_by, approvedBy: r.approved_by,
    lockedAt: r.locked_at, cancelledReason: r.cancellation_reason,
    version: r.version, supersedesPeriodId: r.supersedes_period_id,
  }));
}

/** Lines are returned ONLY to a reader with the facts tier — otherwise []
 *  (the caller shows the register and says the content is withheld). */
export async function listPayrollLines(
  tenantId: string, periodId: string, canReadFacts: boolean,
): Promise<PayrollLine[]> {
  if (!canReadFacts) return [];
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_payroll_period_line").select("*")
    .eq("tenant_id", tenantId).eq("period_id", periodId)
    .order("employee_number");
  if (error) throw new Error(`[hr] payroll lines read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, employeeNumber: r.employee_number,
    firstName: r.first_name, lastName: r.last_name, department: r.department,
    orgUnitLabel: r.org_unit_label, positionLabel: r.position_label,
    workLocationLabel: r.work_location_label,
    contractKind: r.contract_kind, employmentStatus: r.employment_status,
    hireDate: r.hire_date, terminationDate: r.termination_date,
    joinedInPeriod: r.joined_in_period, leftInPeriod: r.left_in_period,
    hasOpenAssignment: r.has_open_assignment, hasLinkedAccount: r.has_linked_account,
    attendanceDays: r.attendance_days, workedMinutes: r.worked_minutes,
    leaveBreakdown: (r.leave_breakdown ?? []) as LeaveBreakdownEntry[],
    leaveTenthsTotal: r.leave_tenths_total,
    exceptions: (r.exceptions ?? []) as string[],
  }));
}

export async function listAdjustmentKinds(tenantId: string): Promise<PayrollAdjustmentKind[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_payroll_adjustment_kind")
    .select("id, code, label_fr, unit, requires_reason, is_active")
    .eq("tenant_id", tenantId).order("code");
  if (error) throw new Error(`[hr] adjustment kinds read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, code: r.code, labelFr: r.label_fr, unit: r.unit,
    requiresReason: r.requires_reason, isActive: r.is_active,
  }));
}

export async function listPayrollAdjustments(
  tenantId: string, periodId: string, canReadFacts: boolean,
): Promise<PayrollAdjustment[]> {
  if (!canReadFacts) return [];
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_payroll_adjustment")
    .select("id, period_id, employee_id, kind_id, quantity, reason, status, proposed_by, decided_by, decision_note, version, supersedes_adjustment_id")
    .eq("tenant_id", tenantId).eq("period_id", periodId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[hr] payroll adjustments read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, periodId: r.period_id, employeeId: r.employee_id, kindId: r.kind_id,
    quantity: r.quantity, reason: r.reason, status: r.status,
    proposedBy: r.proposed_by, decidedBy: r.decided_by, decisionNote: r.decision_note,
    version: r.version, supersedesAdjustmentId: r.supersedes_adjustment_id,
  }));
}
