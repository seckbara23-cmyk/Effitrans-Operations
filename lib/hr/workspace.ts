import "server-only";

/**
 * HR-5A — HR Operations Center composition. SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * PURE COMPOSITION over what HR-1..HR-5 already store. This module contains no
 * business rule, no derived employment state and no new engine: it reads rows
 * the existing phases wrote and arranges them for one page.
 *
 * Two disciplines carried over deliberately:
 *   * ON_LEAVE is never computed here — HR-5's projection owns it
 *     (lib/hr/leave.ts + leave/presence.ts). This module only COUNTS what that
 *     projection would say, from the same APPROVED rows.
 *   * "Expiring soon" is a WINDOW OVER STORED DATES, not a policy. The window
 *     is a caller-supplied number of days with a stated default; no statutory
 *     notice period is implied, because none has been ratified.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { performanceCounts, type PerformanceCounts } from "./performance";
import { trainingCounts, type TrainingCounts } from "./training";

/** Default look-ahead for expiry surfaces. A display window, not a legal rule. */
export const EXPIRY_WINDOW_DAYS = 30;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export type ExpiringContract = {
  id: string; employeeId: string; contractKind: string; endDate: string;
};
export type ExpiringDocument = {
  id: string; employeeId: string; title: string; expiryDate: string;
};
export type RecentActivity = {
  id: string; employeeId: string; kind: string; occurredAt: string;
};

/**
 * Contracts whose end_date falls inside the window and that are still live.
 * ENDED contracts are excluded: a finished contract is not an expiry to chase.
 */
export async function expiringContracts(tenantId: string, days = EXPIRY_WINDOW_DAYS): Promise<ExpiringContract[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s
    .from("employment_contract")
    .select("id, employee_id, contract_kind, end_date, status")
    .eq("tenant_id", tenantId)
    .in("status", ["DRAFT", "VERIFIED"])
    .not("end_date", "is", null)
    .gte("end_date", isoDay(new Date()))
    .lte("end_date", plusDays(days))
    .order("end_date");
  if (error) throw new Error(`[hr] expiring contracts read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, contractKind: r.contract_kind, endDate: r.end_date as string,
  }));
}

/** Live documents carrying an expiry_date inside the window. */
export async function expiringDocuments(tenantId: string, days = EXPIRY_WINDOW_DAYS): Promise<ExpiringDocument[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s
    .from("hr_document")
    .select("id, employee_id, title, expiry_date")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("expiry_date", "is", null)
    .gte("expiry_date", isoDay(new Date()))
    .lte("expiry_date", plusDays(days))
    .order("expiry_date");
  if (error) throw new Error(`[hr] expiring documents read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, title: r.title, expiryDate: r.expiry_date as string,
  }));
}

/** The tenant-wide tail of the employment ledger — the workspace's activity feed. */
export async function recentHrActivity(tenantId: string, limit = 12): Promise<RecentActivity[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s
    .from("hr_employee_event")
    .select("id, employee_id, event_kind, occurred_at")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[hr] recent activity read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, kind: r.event_kind, occurredAt: r.occurred_at,
  }));
}

/**
 * Everything the HR Operations Center needs, in one composition.
 *
 * Each part is failure-isolated: one unreadable source degrades that figure to
 * `null` — an HONEST "indisponible" — instead of collapsing the page. Zero and
 * unavailable are different states and are rendered differently (the DEC-B58
 * discipline from the operations cockpit, applied here).
 */
export type HrCenterData = {
  expiringContracts: ExpiringContract[] | null;
  expiringDocuments: ExpiringDocument[] | null;
  recentActivity: RecentActivity[] | null;
  /** HR-6. Null when unreadable — « indisponible », never zero. */
  performance: PerformanceCounts | null;
  training: TrainingCounts | null;
};

export async function getHrCenterData(tenantId: string): Promise<HrCenterData> {
  const [c, d, a, p, t] = await Promise.allSettled([
    expiringContracts(tenantId),
    expiringDocuments(tenantId),
    recentHrActivity(tenantId),
    performanceCounts(tenantId),
    trainingCounts(tenantId),
  ]);
  return {
    expiringContracts: c.status === "fulfilled" ? c.value : null,
    expiringDocuments: d.status === "fulfilled" ? d.value : null,
    recentActivity: a.status === "fulfilled" ? a.value : null,
    performance: p.status === "fulfilled" ? p.value : null,
    training: t.status === "fulfilled" ? t.value : null,
  };
}
