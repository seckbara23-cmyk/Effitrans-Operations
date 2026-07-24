/**
 * Centre d'Opérations — pure composition (Phase 10.0B). PURE, no I/O, unit-tested.
 * ---------------------------------------------------------------------------
 * Projects the outputs of the EXISTING bounded readers into the cockpit view
 * model. Contains NO domain calculation: every number here was produced by an
 * authoritative engine; this file only counts, groups, labels and re-shapes.
 *
 * Alert severity is handled by the EXISTING executive engine — this module
 * reuses normalizeSeverity / the ExecutiveAlert shape (lib/executive/compose)
 * and adds nothing to the vocabulary (DEC-B34's `code` field arrives in 10.0E,
 * not here).
 */
import { normalizeSeverity } from "@/lib/executive/compose";
import type { ExecutiveAlert } from "@/lib/executive/types";
import type { UnifiedAlert } from "@/lib/logistics/compose";
import type { DashboardTasks } from "@/lib/tasks/types";
import type { ReconciliationData } from "@/lib/finance/types";
import type { FinanceRequestStatus, EvidenceStatus } from "@/lib/finance/requests";
import {
  QUEUE_DEPARTMENT_TO_CANONICAL,
  TRANSIT_TEAMS,
  departmentLabelFr,
  type CanonicalDepartmentCode,
} from "@/lib/organization/departments";
import { QUEUES } from "@/lib/process/queues/registry";
import type {
  CockpitTaskKpis, DepartmentWorkloadEntry, FinanceRequestQueue, UserWorkloadEntry, WorkloadEntry,
} from "./types";

// ---------------------------------------------------------------- generic counting ----

/** Count rows by a nullable key; null/empty keys are dropped (unassigned ≠ a bucket). */
export function countByKey(rows: { key: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.key) continue;
    m.set(r.key, (m.get(r.key) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------- workload rollups ----

const QUEUE_LABEL_FR: Readonly<Record<string, string>> = Object.fromEntries(
  QUEUES.map((q) => [q.key, q.labelFr]),
);

/**
 * Roll the engine's per-queue open counts (getQueueCounts — the nav-badge
 * numbers) up to the canonical departments. Display metadata only, NEVER
 * authorization (lib/organization doctrine). Departments with no mapped open
 * work are omitted — an absent row is "no queue data", not "zero verified".
 */
export function rollupQueueDepths(counts: Record<string, number>): {
  byDepartment: DepartmentWorkloadEntry[];
  byQueue: WorkloadEntry[];
} {
  const dept = new Map<CanonicalDepartmentCode, number>();
  const byQueue: WorkloadEntry[] = [];
  for (const [queueKey, open] of Object.entries(counts)) {
    byQueue.push({ key: queueKey, labelFr: QUEUE_LABEL_FR[queueKey] ?? queueKey, open });
    const canonical = QUEUE_DEPARTMENT_TO_CANONICAL[queueKey];
    if (!canonical) continue;
    dept.set(canonical, (dept.get(canonical) ?? 0) + open);
  }
  byQueue.sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
  const byDepartment = [...dept.entries()]
    .map(([code, open]): DepartmentWorkloadEntry => ({ key: code, labelFr: departmentLabelFr(code), open }))
    .sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
  return { byDepartment, byQueue };
}

const TEAM_LABEL_FR: Readonly<Record<string, string>> = Object.fromEntries(
  TRANSIT_TEAMS.map((t) => [t.code, t.labelFr]),
);

/** Label + sort per-team open counts. Unknown codes keep their raw code (honest, never dropped). */
export function toTeamWorkload(counts: Map<string, number>): WorkloadEntry[] {
  return [...counts.entries()]
    .map(([code, open]): WorkloadEntry => ({ key: code, labelFr: TEAM_LABEL_FR[code] ?? code, open }))
    .sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
}

/**
 * Named per-person workload (DEC-B30: coordination data, not a performance
 * score — the reader gates this behind the supervision boundary). Sorted by
 * open work, bounded.
 */
export function toUserWorkload(
  counts: Map<string, number>,
  names: Map<string, string>,
  cap = 15,
): UserWorkloadEntry[] {
  return [...counts.entries()]
    .map(([userId, open]): UserWorkloadEntry => ({
      userId,
      displayName: names.get(userId) ?? "Utilisateur inconnu",
      open,
    }))
    .sort((a, b) => b.open - a.open || a.displayName.localeCompare(b.displayName))
    .slice(0, cap);
}

// ---------------------------------------------------------------- finance requests ----

export type FinanceRequestRowLike = {
  id: string;
  fileId: string;
  status: FinanceRequestStatus;
  evidenceStatus: EvidenceStatus;
  amount: number;
  currency: string;
  requestedAt: string;
};

/** A request still needing someone's action (a DISBURSED one is settled once evidence is VERIFIED). */
export function isActionableFinanceRequest(r: {
  status: FinanceRequestStatus;
  evidenceStatus: EvidenceStatus;
}): boolean {
  if (r.status === "REQUESTED" || r.status === "APPROVED" || r.status === "RETURNED") return true;
  return r.status === "DISBURSED" && r.evidenceStatus !== "VERIFIED";
}

/**
 * Aggregate the open finance-request pipeline. Pure counting over statuses the
 * finance module already assigned — approval/disbursement semantics live in
 * lib/finance/requests, never here. Amounts sum PER CURRENCY (mixing
 * currencies would fabricate a number no engine produced).
 */
export function financeRequestQueueSummary(
  rows: FinanceRequestRowLike[],
): Omit<FinanceRequestQueue, "items"> {
  let pendingReview = 0, approvedNotDisbursed = 0, returned = 0, evidenceMissing = 0, evidenceToVerify = 0;
  const amounts = new Map<string, number>();
  let oldest: string | null = null;
  for (const r of rows) {
    if (!isActionableFinanceRequest(r)) continue;
    if (r.status === "REQUESTED") pendingReview += 1;
    else if (r.status === "APPROVED") approvedNotDisbursed += 1;
    else if (r.status === "RETURNED") returned += 1;
    else if (r.status === "DISBURSED") {
      if (r.evidenceStatus === "SUBMITTED") evidenceToVerify += 1;
      else evidenceMissing += 1; // NONE or REJECTED — evidence still owed
    }
    if (r.status === "REQUESTED" || r.status === "APPROVED") {
      amounts.set(r.currency, (amounts.get(r.currency) ?? 0) + r.amount);
    }
    if (oldest === null || r.requestedAt < oldest) oldest = r.requestedAt;
  }
  return {
    pendingReview,
    approvedNotDisbursed,
    returned,
    evidenceMissing,
    evidenceToVerify,
    pendingAmounts: [...amounts.entries()]
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    oldestRequestedAt: oldest,
  };
}

// ---------------------------------------------------------------- projections ----

/**
 * Project the Command Center's unified attention queue into ExecutiveAlerts —
 * the SAME mapping the executive reader performs (severity normalized from the
 * token each engine assigned, never scored here).
 */
export function projectAttentionAlerts(attention: UnifiedAlert[]): ExecutiveAlert[] {
  return attention.map((a): ExecutiveAlert => ({
    level: normalizeSeverity(a.severity),
    origin: a.mode,
    reference: a.reference,
    clientName: a.clientName,
    reason: a.reason,
    href: a.link,
    occurredAt: a.occurredAt ?? null,
    sourceSeverity: a.severity,
  }));
}

/** Scalar task counts from the dashboard task lists (the page derives the same trio today). */
export function taskKpis(tasks: DashboardTasks | null): CockpitTaskKpis | null {
  if (!tasks) return null;
  return { dueToday: tasks.today.length, overdue: tasks.overdue.length, mine: tasks.mine.length };
}

/** The reconciliation indicators the cockpit surfaces (counts only — rows stay on /finance/reconciliation). */
export function reconciliationIndicators(
  recon: ReconciliationData | null,
): { pending: number; missingReference: number; failedIntents: number } | null {
  if (!recon) return null;
  return {
    pending: recon.counts.pending,
    missingReference: recon.counts.missingReference,
    failedIntents: recon.onlineIntents.filter((i) => i.status === "FAILED" || i.status === "EXPIRED").length,
  };
}
