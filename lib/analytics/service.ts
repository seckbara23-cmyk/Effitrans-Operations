/**
 * Analytics aggregation service (Phase 1.13). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client, gated by assertPermission('analytics:read') +
 * explicit tenant scope. Direct aggregation from operational tables (acceptable
 * at current scale; the service can later be swapped for materialized views
 * WITHOUT changing the UI). All math is the pure ./calc module. Finance KPIs are
 * only computed when `includeFinance` (the page passes hasPermission('finance:read')).
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { assertPermission } from "@/lib/auth/require-permission";
import { balanceDue, invoiceTotals, paidAmount } from "@/lib/finance/calc";
import {
  blockedOperations,
  computeCustoms,
  computeFinancial,
  computeOperations,
  computePortal,
  computeTeam,
  computeTransport,
  customsPipeline,
  revenueByClient,
  revenueTrend,
  statusDistribution,
  transportPipeline,
  type ClosureRow,
  type CustomsRow,
  type FileRow,
  type TransportRow,
} from "./calc";
import type { AnalyticsData, InvoiceAgg } from "./types";

/**
 * P1: request-scoped memoization (React cache) keyed by `includeFinance`. The
 * dashboard resolves analytics from several places in one render (control tower
 * + department "management" card); with cache() they all share ONE aggregation
 * pass instead of re-running ~11 queries each. Request-scoped, so no staleness.
 */
export const getAnalytics = cache(async (includeFinance: boolean): Promise<AnalyticsData> => {
  const user = await assertPermission("analytics:read");
  const supabase = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const now = new Date();

  const [files, customs, transport, tasks, clientUsers, invoices, transitions, sharedDocs, downloads, invoiceViews] =
    await Promise.all([
      scopedFrom(supabase, "operational_file", tenant).select("status, priority, created_at, client_id").returns<FileRow[]>(),
      scopedFrom(supabase, "customs_record", tenant).select("file_id, status, declaration_date, release_date").is("deleted_at", null).returns<CustomsRow[]>(),
      scopedFrom(supabase, "transport_record", tenant).select("file_id, status, delivery_planned, delivery_actual").is("deleted_at", null).returns<TransportRow[]>(),
      scopedFrom(supabase, "task", tenant).select("status").returns<{ status: string }[]>(),
      scopedFrom(supabase, "client_user", tenant).select("status, client_id").returns<{ status: string; client_id: string }[]>(),
      scopedFrom(supabase, "invoice", tenant).select("id, status, issue_date, due_date, client_id").returns<{ id: string; status: string; issue_date: string | null; due_date: string | null; client_id: string | null }[]>(),
      scopedFrom(supabase, "file_state_transition", tenant).select("file_id, occurred_at, to_status").eq("to_status", "CLOSED").returns<{ file_id: string; occurred_at: string; to_status: string }[]>(),
      scopedFrom(supabase, "document", tenant).select("id", { count: "exact", head: true }).eq("shared_with_client", true).eq("status", "APPROVED").is("deleted_at", null),
      scopedFrom(supabase, "audit_log", tenant).select("id", { count: "exact", head: true }).eq("action", "portal.document.downloaded"),
      scopedFrom(supabase, "audit_log", tenant).select("id", { count: "exact", head: true }).eq("action", "portal.invoice.viewed"),
    ]);

  const fileRows = files.data ?? [];
  const customsRows = customs.data ?? [];
  const transportRows = transport.data ?? [];
  const taskRows = tasks.data ?? [];
  const clientUserRows = clientUsers.data ?? [];
  const invoiceRows = invoices.data ?? [];

  // Per-invoice money totals (only fetched when finance is in scope).
  const invoiceIds = invoiceRows.map((i) => i.id);
  let totalsById = new Map<string, { total: number; paid: number; balance: number }>();
  let clientNames: Record<string, string> = {};
  if (includeFinance && invoiceIds.length > 0) {
    const [lines, payments, clients] = await Promise.all([
      scopedFrom(supabase, "invoice_line", tenant).select("invoice_id, quantity, unit_amount, tax_rate").in("invoice_id", invoiceIds).returns<{ invoice_id: string; quantity: number | string; unit_amount: number | string; tax_rate: number | string }[]>(),
      scopedFrom(supabase, "payment", tenant).select("invoice_id, amount, reversed_at").in("invoice_id", invoiceIds).returns<{ invoice_id: string; amount: number | string; reversed_at: string | null }[]>(),
      scopedFrom(supabase, "client", tenant).select("id, name").returns<{ id: string; name: string }[]>(),
    ]);
    const linesByInv = new Map<string, { quantity: number; unitAmount: number; taxRate: number }[]>();
    for (const l of lines.data ?? []) {
      const arr = linesByInv.get(l.invoice_id) ?? [];
      arr.push({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) });
      linesByInv.set(l.invoice_id, arr);
    }
    const paysByInv = new Map<string, { amount: number; reversed: boolean }[]>();
    for (const p of payments.data ?? []) {
      const arr = paysByInv.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount), reversed: p.reversed_at != null });
      paysByInv.set(p.invoice_id, arr);
    }
    totalsById = new Map(
      invoiceIds.map((id) => {
        const { total } = invoiceTotals(linesByInv.get(id) ?? []);
        const paid = paidAmount(paysByInv.get(id) ?? []);
        return [id, { total, paid, balance: balanceDue(total, paid) }];
      }),
    );
    clientNames = Object.fromEntries((clients.data ?? []).map((c) => [c.id, c.name]));
  }

  const invoiceAggs: InvoiceAgg[] = invoiceRows.map((i) => {
    const t = totalsById.get(i.id) ?? { total: 0, paid: 0, balance: 0 };
    return { status: i.status, issueDate: i.issue_date, dueDate: i.due_date, clientId: i.client_id, ...t };
  });

  // Closures: join CLOSED transitions to each file's created_at (avg closure time).
  const createdByFile = new Map<string, string>();
  const { data: fileIdRows } = await scopedFrom(supabase, "operational_file", tenant)
    .select("id, created_at")
    .returns<{ id: string; created_at: string }[]>();
  for (const f of fileIdRows ?? []) createdByFile.set(f.id, f.created_at);
  const closures: ClosureRow[] = (transitions.data ?? [])
    .map((tr) => ({ created_at: createdByFile.get(tr.file_id) ?? "", occurred_at: tr.occurred_at }))
    .filter((c) => c.created_at);

  return {
    currency: "XOF",
    financial: includeFinance ? computeFinancial(invoiceAggs, now) : null,
    operations: computeOperations(fileRows, blockedOperations(customsRows, transportRows), now),
    customs: computeCustoms(customsRows),
    transport: computeTransport(transportRows),
    portal: computePortal(clientUserRows, sharedDocs.count ?? 0, downloads.count ?? 0, invoiceViews.count ?? 0),
    team: computeTeam(taskRows, customsRows, invoiceAggs, closures),
    charts: {
      revenueTrend: includeFinance ? revenueTrend(invoiceAggs, now) : null,
      statusDistribution: statusDistribution(fileRows),
      revenueByClient: includeFinance ? revenueByClient(invoiceAggs, clientNames) : null,
      customsPipeline: customsPipeline(customsRows),
      transportPipeline: transportPipeline(transportRows),
    },
  };
});
