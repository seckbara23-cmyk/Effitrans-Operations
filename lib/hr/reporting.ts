import "server-only";

/**
 * HR-9A — reporting readers. SERVER-ONLY, READ-ONLY, and deliberately thin.
 *
 * COMPOSITION, NOT A SECOND MODEL. Every figure below comes from the HR read
 * models that already own it — the registry, the leave module, the onboarding
 * and offboarding readers, the HR center. HR-9 stores nothing, materialises
 * nothing, and defines no figure twice: where the hub already computes a
 * number, this module calls the same function rather than restating the query.
 *
 * WHAT IS ABSENT BY RATIFICATION: no turnover rate (RQ-9.3), no absence rate
 * (no schedule model — HR-7 Q9), no monetary figure (DEC-B63), no grouping of
 * the free-text departure motive (RQ-8.1), and no as-of reconstruction —
 * v1 is current state plus movements between two dates (RQ-9.4).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { employeeStats } from "./read";
import { leaveCounts } from "./leave";
import { hrOperationsCounts } from "./onboarding";
import { offboardingCounts } from "./offboarding";
import { getHrCenterData } from "./workspace";
import type { BreakdownRow, ReportPeriod } from "./reporting/model";

export {
  K_ANONYMITY_FLOOR, MASKED_LABEL_FR, EMPLOYEE_STATUS_FR, HR9_DEFERRED_INDICATORS,
  reportViewerTier, applyPrivacyFloor, maskedCount, resolvePeriod, isIsoDate,
} from "./reporting/model";
export type {
  ReportViewerTier, BreakdownRow, PresentedRow, ReportPeriod,
} from "./reporting/model";

export type HeadlineIndicators = {
  /** Registry state, now. */
  employeesTotal: number;
  employeesActive: number;
  employeesSuspended: number;
  withoutAccount: number;
  /** Movements strictly inside the period — stamped facts, never inferred. */
  entriesInPeriod: number;
  departuresInPeriod: number;
  /** Leave requests whose window overlaps the period, by decision. */
  leaveApprovedInPeriod: number;
  leavePendingNow: number;
  onLeaveToday: number;
  /** Live operational load (the hub's own counters). */
  onboardingActive: number;
  offboardingActive: number;
  offboardingStepsPending: number;
  equipmentOutstanding: number;
  equipmentAwaitingReturn: number;
  /** Expiry watch, or null when the underlying read was unavailable. */
  contractsExpiringSoon: number | null;
  documentsExpiringSoon: number | null;
};

export type HrReport = {
  period: ReportPeriod;
  headline: HeadlineIndicators;
  byStatus: BreakdownRow[];
  byDepartment: BreakdownRow[];
  byOrgUnit: BreakdownRow[];
};

/** Rows counted per key, sorted by size then label — presentation, not policy. */
function tally(values: readonly (string | null)[], fallback: string): BreakdownRow[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = (v ?? "").trim() || fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The whole report, for one tenant and one period. `department` narrows the
 * population the way the registry's own filter does — it is a filter, not a
 * scope: HR-9 grants no access it did not already have.
 */
export async function buildHrReport(
  tenantId: string, period: ReportPeriod, department?: string | null,
): Promise<HrReport> {
  const s = getAdminSupabaseClient();

  let q = s.from("employee")
    .select("status, department, hire_date, termination_date")
    .eq("tenant_id", tenantId);
  if (department) q = q.eq("department", department);
  const [population, stats, leave, ops, departures, center, units] = await Promise.all([
    q,
    employeeStats(tenantId),
    leaveCounts(tenantId),
    hrOperationsCounts(tenantId),
    offboardingCounts(tenantId),
    getHrCenterData(tenantId),
    // Placement comes from the HR-A2 authoritative rule: the OPEN PRIMARY
    // assignment's unit. Read here as a join rather than recomputed.
    s.from("employee_assignment")
      .select("employee_id, hr_org_unit(name)")
      .eq("tenant_id", tenantId).eq("assignment_kind", "PRIMARY").is("effective_to", null),
  ]);
  if (population.error) throw new Error(`[hr] report population read failed: ${population.error.message}`);
  const rows = population.data ?? [];

  const inPeriod = (d: string | null) => d !== null && d >= period.from && d <= period.to;

  // Approved leave overlapping the period — the request's own dates, at face
  // value (the HR-7 facts doctrine: never prorated, never inferred).
  const approvedInPeriod = await s.from("hr_leave_request")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("status", "APPROVED")
    .lte("start_date", period.to).gte("end_date", period.from);

  const unitByEmployee = new Map<string, string>();
  for (const a of (units.data ?? []) as unknown as {
    employee_id: string; hr_org_unit: { name: string } | null;
  }[]) {
    if (a.hr_org_unit?.name) unitByEmployee.set(a.employee_id, a.hr_org_unit.name);
  }

  const headline: HeadlineIndicators = {
    employeesTotal: rows.length,
    employeesActive: rows.filter((r) => r.status === "ACTIVE").length,
    employeesSuspended: rows.filter((r) => r.status === "SUSPENDED").length,
    withoutAccount: stats.withoutAccount,
    entriesInPeriod: rows.filter((r) => inPeriod(r.hire_date)).length,
    departuresInPeriod: rows.filter((r) => inPeriod(r.termination_date)).length,
    leaveApprovedInPeriod: approvedInPeriod.count ?? 0,
    leavePendingNow: leave.pending,
    onLeaveToday: leave.onLeaveToday,
    onboardingActive: ops.activeCases,
    offboardingActive: departures.activeCases,
    offboardingStepsPending: departures.stepsPending,
    equipmentOutstanding: departures.equipmentOutstanding,
    equipmentAwaitingReturn: ops.assetsAwaitingReturn,
    contractsExpiringSoon: center.expiringContracts?.length ?? null,
    documentsExpiringSoon: center.expiringDocuments?.length ?? null,
  };

  // The org-unit breakdown counts only the filtered population, so a
  // department filter narrows every table on the page consistently.
  const employeeIds = department
    ? new Set((await s.from("employee").select("id").eq("tenant_id", tenantId)
        .eq("department", department)).data?.map((r) => r.id) ?? [])
    : null;
  const unitValues = [...unitByEmployee.entries()]
    .filter(([id]) => employeeIds === null || employeeIds.has(id))
    .map(([, name]) => name);

  return {
    period,
    headline,
    byStatus: tally(rows.map((r) => r.status), "—"),
    byDepartment: tally(rows.map((r) => r.department), "Non affecté"),
    byOrgUnit: tally(unitValues, "Sans unité"),
  };
}
