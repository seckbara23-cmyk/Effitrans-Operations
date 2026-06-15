/**
 * Executive analytics service (Phase 1.13B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Presentation/decision-support aggregation that sits ON TOP of the unchanged
 * Phase-1.13 analytics. It takes the already-computed AnalyticsData (for the
 * banner + scorecard) and fetches a few extra raw rows (routes, blocked counts,
 * payments-by-month, dossiers-per-client) to derive health / alerts / trends.
 * Gated by analytics:read + tenant scope. Finance-derived parts require the
 * caller to already hold finance:read (signalled by analytics.financial != null).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { balanceDue, invoiceTotals, paidAmount } from "@/lib/finance/calc";
import {
  buildAlerts,
  collectionsTrend,
  computeHealth,
  computeScorecard,
  newDossiersPerMonth,
  revenue12,
  routeActivity,
  topClients,
  transportsOverdue,
  type ExecutiveData,
} from "./executive";
import type { AnalyticsData, InvoiceAgg } from "./types";

const OPEN = new Set(["ISSUED", "PARTIALLY_PAID"]);

export async function getExecutiveAnalytics(analytics: AnalyticsData): Promise<ExecutiveData> {
  const user = await assertPermission("analytics:read");
  const supabase = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const now = new Date();
  const includeFinance = analytics.financial != null;

  const [files, shipments, customs, transport] = await Promise.all([
    supabase.from("operational_file").select("client_id, created_at").eq("tenant_id", tenant).returns<{ client_id: string | null; created_at: string }[]>(),
    supabase.from("shipment").select("origin, destination").eq("tenant_id", tenant).returns<{ origin: string | null; destination: string | null }[]>(),
    supabase.from("customs_record").select("status").eq("tenant_id", tenant).is("deleted_at", null).returns<{ status: string }[]>(),
    supabase.from("transport_record").select("status, delivery_planned").eq("tenant_id", tenant).is("deleted_at", null).returns<{ status: string; delivery_planned: string | null }[]>(),
  ]);

  const fileRows = files.data ?? [];
  const customsRows = customs.data ?? [];
  const transportRows = transport.data ?? [];

  const blockedCustoms = customsRows.filter((c) => c.status === "BLOCKED").length;
  const blockedTransport = transportRows.filter((tr) => tr.status === "BLOCKED").length;
  const tOverdue = transportsOverdue(transportRows, now);

  // Finance-derived: invoice aggregates + payments-by-month + client names.
  let invoiceAggs: InvoiceAgg[] = [];
  let paymentsAgg: { amount: number; paidAt: string | null; reversed: boolean }[] = [];
  let clientNames: Record<string, string> = {};
  let overdueCount = 0;
  if (includeFinance) {
    const { data: invoiceRows } = await supabase
      .from("invoice")
      .select("id, status, issue_date, due_date, client_id")
      .eq("tenant_id", tenant)
      .returns<{ id: string; status: string; issue_date: string | null; due_date: string | null; client_id: string | null }[]>();
    const ids = (invoiceRows ?? []).map((i) => i.id);
    if (ids.length > 0) {
      const [lines, payments, clients] = await Promise.all([
        supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).in("invoice_id", ids),
        supabase.from("payment").select("invoice_id, amount, paid_at, reversed_at").eq("tenant_id", tenant).in("invoice_id", ids),
        supabase.from("client").select("id, name").eq("tenant_id", tenant),
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
        paymentsAgg.push({ amount: Number(p.amount), paidAt: p.paid_at, reversed: p.reversed_at != null });
      }
      clientNames = Object.fromEntries((clients.data ?? []).map((c) => [c.id, c.name]));
      invoiceAggs = (invoiceRows ?? []).map((i) => {
        const { total } = invoiceTotals(linesByInv.get(i.id) ?? []);
        const paid = paidAmount(paysByInv.get(i.id) ?? []);
        const balance = balanceDue(total, paid);
        return { status: i.status, issueDate: i.issue_date, dueDate: i.due_date, clientId: i.client_id, total, paid, balance };
      });
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      overdueCount = invoiceAggs.filter(
        (i) => OPEN.has(i.status) && i.balance > 0 && i.dueDate && new Date(`${i.dueDate}T00:00:00Z`).getTime() < today.getTime(),
      ).length;
    }
  }

  return {
    lastUpdated: now.toISOString(),
    health: computeHealth(overdueCount, blockedCustoms + blockedTransport),
    banner: {
      revenueThisMonth: analytics.financial?.revenueThisMonth ?? null,
      activeDossiers: analytics.operations.active,
      inTransit: analytics.transport.inTransit,
      outstanding: analytics.financial?.outstanding ?? null,
    },
    alerts: buildAlerts({ overdueCount, blockedCustoms, blockedTransport, transportsOverdue: tOverdue }),
    scorecard: computeScorecard(analytics),
    revenue12: includeFinance ? revenue12(invoiceAggs, now) : null,
    collections12: includeFinance ? collectionsTrend(invoiceAggs, paymentsAgg, now) : null,
    newDossiers12: newDossiersPerMonth(fileRows, now),
    topClients: includeFinance ? topClients(invoiceAggs, fileRows, clientNames) : null,
    routes: routeActivity(shipments.data ?? []),
  };
}
