/**
 * Business intelligence reads (Phase 3.0). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Derived-only: loads the existing operational records ONCE (admin client +
 * tenant scope, gated by analytics:read — the established analytics pattern) and
 * computes the BI areas via the pure aggregators. No new tables, no ETL, no
 * copies. Finance figures are included only when the viewer holds finance:read.
 * An optional date range filters invoices (by issue date) and payments (by paid
 * date) for the reporting center.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/rbac/check";
import { inDateRange, type DateRange } from "./date-range";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import {
  revenueMetrics,
  clientIntelligence,
  activeClientCount,
  receivablesAging,
  departmentProductivity,
  type BiInvoice,
  type BiPayment,
  type RevenueMetrics,
  type ClientRow,
  type AgingBuckets,
  type DepartmentProductivity,
} from "./aggregate";

export type { DateRange };

export type BusinessIntelligence = {
  canFinance: boolean;
  currency: string;
  revenue: RevenueMetrics;
  activeClients: number;
  clients: ClientRow[];
  topOverdueClients: { clientName: string | null; outstanding: number }[];
  aging: AgingBuckets;
  productivity: DepartmentProductivity;
};

const inRange = inDateRange;

export async function getBusinessIntelligence(permissions: string[], range: DateRange = {}): Promise<BusinessIntelligence> {
  const user = await assertPermission("analytics:read");
  const canFinance = hasPermission(permissions, "finance:read");
  const supabase = getAdminSupabaseClient();
  const tenant = user.tenantId;
  const now = new Date();

  const [clientsRes, filesRes, docsRes, customsRes, transportRes] = await Promise.all([
    supabase.from("client").select("id, name").eq("tenant_id", tenant).returns<{ id: string; name: string | null }[]>(),
    supabase.from("operational_file").select("client_id, status, created_at").eq("tenant_id", tenant).returns<{ client_id: string | null; status: string; created_at: string }[]>(),
    supabase.from("document").select("status").eq("tenant_id", tenant).is("deleted_at", null).returns<{ status: string }[]>(),
    supabase.from("customs_record").select("status, declaration_date, release_date").eq("tenant_id", tenant).is("deleted_at", null).returns<{ status: string; declaration_date: string | null; release_date: string | null }[]>(),
    supabase.from("transport_record").select("status, pickup_actual, delivery_actual").eq("tenant_id", tenant).is("deleted_at", null).returns<{ status: string; pickup_actual: string | null; delivery_actual: string | null }[]>(),
  ]);

  const clients = clientsRes.data ?? [];
  const allFiles = filesRes.data ?? [];
  const files = (range.from || range.to ? allFiles.filter((f) => inRange(f.created_at, range)) : allFiles).map((f) => ({ clientId: f.client_id, status: f.status, createdAt: f.created_at }));

  // Finance (finance:read only) — invoices + lines + payments -> per-invoice totals.
  let invoices: BiInvoice[] = [];
  let payments: BiPayment[] = [];
  let currency = "XOF";
  if (canFinance) {
    const [invRes, lineRes, payRes] = await Promise.all([
      supabase.from("invoice").select("id, client_id, status, issue_date, due_date, currency").eq("tenant_id", tenant).returns<{ id: string; client_id: string | null; status: string; issue_date: string | null; due_date: string | null; currency: string }[]>(),
      supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenant).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
      supabase.from("payment").select("invoice_id, amount, paid_at, reversed_at").eq("tenant_id", tenant).returns<{ invoice_id: string; amount: number; paid_at: string; reversed_at: string | null }[]>(),
    ]);
    const linesByInv = new Map<string, { quantity: number; unitAmount: number; taxRate: number }[]>();
    for (const l of lineRes.data ?? []) {
      const arr = linesByInv.get(l.invoice_id) ?? [];
      arr.push({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) });
      linesByInv.set(l.invoice_id, arr);
    }
    const paysByInv = new Map<string, { amount: number; reversed: boolean }[]>();
    for (const p of payRes.data ?? []) {
      const arr = paysByInv.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount), reversed: p.reversed_at != null });
      paysByInv.set(p.invoice_id, arr);
    }
    const invMeta = new Map<string, { clientId: string | null; issueDate: string | null }>();
    const allInv = (invRes.data ?? []).map((inv) => {
      const { total } = invoiceTotals(linesByInv.get(inv.id) ?? []);
      const balance = balanceDue(total, paidAmount(paysByInv.get(inv.id) ?? []));
      invMeta.set(inv.id, { clientId: inv.client_id, issueDate: inv.issue_date });
      if (inv.currency) currency = inv.currency;
      return { id: inv.id, clientId: inv.client_id, status: inv.status, issueDate: inv.issue_date, dueDate: inv.due_date, total, balance } satisfies BiInvoice;
    });
    invoices = range.from || range.to ? allInv.filter((i) => i.issueDate == null || inRange(i.issueDate, range)) : allInv;

    const allPays = (payRes.data ?? []).map((p) => {
      const m = invMeta.get(p.invoice_id);
      return { clientId: m?.clientId ?? null, issueDate: m?.issueDate ?? null, paidAt: p.paid_at, amount: Number(p.amount), reversed: p.reversed_at != null } satisfies BiPayment;
    });
    payments = range.from || range.to ? allPays.filter((p) => inRange(p.paidAt, range)) : allPays;
  }

  const clientRows = clientIntelligence(clients, invoices, files, payments);
  const topOverdueClients = [...clientRows]
    .filter((c) => c.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)
    .map((c) => ({ clientName: c.clientName, outstanding: c.outstanding }));

  return {
    canFinance,
    currency,
    revenue: revenueMetrics(invoices, payments, now),
    activeClients: activeClientCount(clients, files),
    clients: clientRows.slice(0, 10),
    topOverdueClients,
    aging: receivablesAging(invoices, now),
    productivity: departmentProductivity({
      documents: docsRes.data ?? [],
      customs: customsRes.data ?? [],
      transport: transportRes.data ?? [],
      invoices,
      payments,
    }),
  };
}
