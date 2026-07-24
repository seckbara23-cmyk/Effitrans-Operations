/**
 * Centre d'Opérations — tenant-wide finance-request queue (Phase 10.0B).
 * SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * Closes the single biggest reader gap found by the 10.0A audit (§4.3):
 * finance_request was readable ONLY per dossier (getFinanceState). This reader
 * lists the OPEN pipeline tenant-wide so the cockpit can show pending
 * approvals / pending disbursements / evidence owed.
 *
 * Boundaries (unchanged from lib/finance):
 *  - READ-ONLY: the ONE write path for finance_request remains
 *    lib/finance/request-actions; approval ≠ payment; nothing here transitions
 *    anything.
 *  - Same scoping model as its sibling getFinanceQueue: role-gated
 *    (finance:read), tenant-scoped, NOT per-dossier visibility — Finance sees
 *    the tenant's whole pipeline or nothing.
 *  - Same darkness contract as getFinanceState: null when financeExecution is
 *    off (env or tenant) or when migration 20260723000002 is absent.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { assertPermission } from "@/lib/auth/require-permission";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { financeCategoryLabelFr, type EvidenceStatus, type FinanceRequestStatus } from "@/lib/finance/requests";
import { financeRequestQueueSummary, isActionableFinanceRequest } from "./compose";
import type { FinanceRequestQueue, FinanceRequestQueueItem } from "./types";

/** Bounded working set (oldest first) — the cockpit shows counts + a short list, never everything. */
const REQUEST_CAP = 500;
const ITEM_CAP = 10;

type RequestRow = {
  id: string;
  file_id: string;
  status: string;
  evidence_status: string;
  amount: number | string;
  currency: string;
  category: string;
  requested_at: string;
};

/** The tenant's open finance-request pipeline. Null when dark / unauthorized / migration absent. */
export async function getFinanceRequestQueue(): Promise<FinanceRequestQueue | null> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.financeExecution) return null;
  let user;
  try {
    user = await assertPermission("finance:read");
  } catch {
    return null;
  }
  const flags = await getTenantProcessFlags(user.tenantId);
  if (!flags.enabled || !flags.financeExecution) return null;

  const admin = getAdminSupabaseClient();
  const { data, error } = await scopedFrom(admin, "finance_request", user.tenantId)
    .select("id, file_id, status, evidence_status, amount, currency, category, requested_at")
    .in("status", ["REQUESTED", "APPROVED", "RETURNED", "DISBURSED"])
    .order("requested_at", { ascending: true })
    .limit(REQUEST_CAP)
    .returns<RequestRow[]>();
  if (error) return null; // table absent (migration not applied) — degrade, same as getFinanceState

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    fileId: r.file_id,
    status: r.status as FinanceRequestStatus,
    evidenceStatus: r.evidence_status as EvidenceStatus,
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    requestedAt: r.requested_at,
  }));

  const summary = financeRequestQueueSummary(rows);

  // Oldest actionable requests, with file numbers (batch — never per-row).
  const actionable = rows.filter(isActionableFinanceRequest).slice(0, ITEM_CAP);
  const fileNumbers = new Map<string, string | null>();
  const fileIds = [...new Set(actionable.map((r) => r.fileId))];
  if (fileIds.length > 0) {
    const { data: files } = await scopedFrom(admin, "operational_file", user.tenantId)
      .select("id, file_number")
      .in("id", fileIds)
      .returns<{ id: string; file_number: string | null }[]>();
    for (const f of files ?? []) fileNumbers.set(f.id, f.file_number);
  }

  const items: FinanceRequestQueueItem[] = actionable.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    fileNumber: fileNumbers.get(r.fileId) ?? null,
    status: r.status,
    evidenceStatus: r.evidenceStatus,
    amount: r.amount,
    currency: r.currency,
    categoryLabel: financeCategoryLabelFr(r.category),
    requestedAt: r.requestedAt,
  }));

  return { ...summary, items };
}
