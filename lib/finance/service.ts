/**
 * Finance reads (Phase 1.11). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * FINANCE-ROLE based: gated by assertPermission('finance:read') only — NOT by
 * dossier visibility. A general operational user never sees money. Service-role
 * admin client + explicit tenant scope; the finance RLS policies (tenant +
 * finance:read) are the CI-tested boundary. Totals/balance/overdue are derived
 * (./calc). Soft-deleted charges excluded; reversed payments excluded from paid.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { balanceDue, invoiceTotals, isOverdue, paidAmount } from "./calc";
import { isMissingReference, isVerificationStatus } from "./verification";
import type {
  Charge,
  FinanceForFile,
  FinanceKpis,
  InvoiceDetail,
  InvoiceLine,
  InvoiceQueueItem,
  InvoiceStatus,
  Payment,
  PaymentMethod,
  ReconciliationData,
  ReconciliationPayment,
} from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

type InvoiceRow = {
  id: string;
  file_id: string;
  invoice_number: string | null;
  status: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
};
type LineRow = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount: number;
  tax_rate: number;
};
type PaymentRow = {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  reversed_at: string | null;
  provider_name: string | null;
  provider_reference: string | null;
  verification_status: string;
};

function buildInvoice(
  inv: InvoiceRow,
  lineRows: LineRow[],
  payRows: PaymentRow[],
  now: Date,
): InvoiceDetail {
  const lines: InvoiceLine[] = lineRows.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unitAmount: Number(l.unit_amount),
    taxRate: Number(l.tax_rate),
  }));
  const payments: Payment[] = payRows.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method as PaymentMethod,
    reference: p.reference,
    paidAt: p.paid_at,
    reversed: p.reversed_at != null,
    providerName: p.provider_name,
    providerReference: p.provider_reference,
    verificationStatus: isVerificationStatus(p.verification_status)
      ? p.verification_status
      : "PENDING",
  }));
  const { subtotal, tax, total } = invoiceTotals(lines);
  const paid = paidAmount(payments);
  const balance = balanceDue(total, paid);
  const status = inv.status as InvoiceStatus;
  return {
    id: inv.id,
    fileId: inv.file_id,
    invoiceNumber: inv.invoice_number,
    status,
    currency: inv.currency,
    issueDate: inv.issue_date,
    dueDate: inv.due_date,
    notes: inv.notes,
    lines,
    payments,
    subtotal,
    tax,
    total,
    paid,
    balance,
    overdue: isOverdue(status, inv.due_date, balance, now),
  };
}

async function fetchLinesAndPayments(supabase: Admin, tenantId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return { lines: [] as LineRow[], payments: [] as PaymentRow[] };
  const [lines, payments] = await Promise.all([
    supabase
      .from("invoice_line")
      .select("id, invoice_id, description, quantity, unit_amount, tax_rate")
      .eq("tenant_id", tenantId)
      .in("invoice_id", invoiceIds)
      .returns<LineRow[]>(),
    supabase
      .from("payment")
      .select(
        "id, invoice_id, amount, method, reference, paid_at, reversed_at, provider_name, provider_reference, verification_status",
      )
      .eq("tenant_id", tenantId)
      .in("invoice_id", invoiceIds)
      .returns<PaymentRow[]>(),
  ]);
  return { lines: lines.data ?? [], payments: payments.data ?? [] };
}

/** All finance for one dossier (finance:read). */
export async function getFinanceForFile(fileId: string): Promise<FinanceForFile> {
  const user = await assertPermission("finance:read");
  const supabase = getAdminSupabaseClient();
  const now = new Date();

  const { data: chargeRows } = await supabase
    .from("billing_charge")
    .select("id, file_id, description, quantity, unit_amount, tax_rate, currency")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const charges: Charge[] = (chargeRows ?? []).map((c) => ({
    id: c.id,
    fileId: c.file_id,
    description: c.description,
    quantity: Number(c.quantity),
    unitAmount: Number(c.unit_amount),
    taxRate: Number(c.tax_rate),
    currency: c.currency,
  }));

  const { data: invRows } = await supabase
    .from("invoice")
    .select("id, file_id, invoice_number, status, currency, issue_date, due_date, notes")
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: false })
    .returns<InvoiceRow[]>();

  const ids = (invRows ?? []).map((i) => i.id);
  const { lines, payments } = await fetchLinesAndPayments(supabase, user.tenantId, ids);

  const invoices = (invRows ?? []).map((inv) =>
    buildInvoice(
      inv,
      lines.filter((l) => l.invoice_id === inv.id),
      payments.filter((p) => p.invoice_id === inv.id),
      now,
    ),
  );

  const hasIssued = invoices.some((i) => i.status !== "DRAFT" && i.status !== "VOID");
  const outstanding = invoices.reduce(
    (s, i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID" ? s + i.balance : s),
    0,
  );

  return { charges, invoices, hasIssued, outstanding };
}

/** Tenant-wide invoice queue (finance:read). */
export async function getFinanceQueue(opts?: { status?: string }): Promise<InvoiceQueueItem[]> {
  const user = await assertPermission("finance:read");
  const supabase = getAdminSupabaseClient();
  const now = new Date();

  let query = supabase
    .from("invoice")
    .select(
      "id, file_id, invoice_number, status, currency, due_date, file:file_id(file_number, client:client_id(name))",
    )
    .eq("tenant_id", user.tenantId);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<
      (InvoiceRow & {
        file: { file_number: string; client: { name: string } | null } | null;
      })[]
    >();
  if (error) throw new Error(`[finance] queue failed: ${error.message}`);

  const rows = data ?? [];
  const { lines, payments } = await fetchLinesAndPayments(
    supabase,
    user.tenantId,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const built = buildInvoice(
      r,
      lines.filter((l) => l.invoice_id === r.id),
      payments.filter((p) => p.invoice_id === r.id),
      now,
    );
    return {
      id: r.id,
      fileId: r.file_id,
      fileNumber: r.file?.file_number ?? null,
      clientName: r.file?.client?.name ?? null,
      invoiceNumber: r.invoice_number,
      status: built.status,
      currency: r.currency,
      total: built.total,
      paid: built.paid,
      balance: built.balance,
      dueDate: r.due_date,
      overdue: built.overdue,
    };
  });
}

type ReconRow = PaymentRow & {
  invoice: {
    invoice_number: string | null;
    file_id: string;
    currency: string;
    file: { file_number: string | null; client: { name: string } | null } | null;
  } | null;
};

/**
 * Tenant-wide payment reconciliation (Phase 1.15A; finance:read).
 * Surfaces the verification workflow: unverified payments to action, payments
 * missing a reference, recently resolved ones, and outstanding invoice balances.
 * Read-only aggregation — no calculation change to invoices.
 */
export async function getReconciliation(): Promise<ReconciliationData> {
  const user = await assertPermission("finance:read");
  const supabase = getAdminSupabaseClient();

  const { data, error } = await supabase
    .from("payment")
    .select(
      "id, invoice_id, amount, method, reference, paid_at, reversed_at, provider_name, provider_reference, verification_status, invoice:invoice_id(invoice_number, file_id, currency, file:file_id(file_number, client:client_id(name)))",
    )
    .eq("tenant_id", user.tenantId)
    .order("paid_at", { ascending: false })
    .returns<ReconRow[]>();
  if (error) throw new Error(`[finance] reconciliation failed: ${error.message}`);

  const rows = data ?? [];
  const toRecon = (r: ReconRow): ReconciliationPayment => {
    const reference = r.reference;
    const providerReference = r.provider_reference;
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      fileId: r.invoice?.file_id ?? "",
      invoiceNumber: r.invoice?.invoice_number ?? null,
      fileNumber: r.invoice?.file?.file_number ?? null,
      clientName: r.invoice?.file?.client?.name ?? null,
      amount: Number(r.amount),
      currency: r.invoice?.currency ?? "XOF",
      method: r.method as PaymentMethod,
      reference,
      providerName: r.provider_name,
      providerReference,
      paidAt: r.paid_at,
      verificationStatus: isVerificationStatus(r.verification_status)
        ? r.verification_status
        : "PENDING",
      reversed: r.reversed_at != null,
      missingReference: isMissingReference({ reference, providerReference }),
    };
  };

  const all = rows.map(toRecon);
  const active = all.filter((p) => !p.reversed);

  const pending = active.filter((p) => p.verificationStatus === "PENDING");
  const missingReference = active.filter(
    (p) => p.missingReference && p.verificationStatus !== "REJECTED",
  );
  const recentlyResolved = all
    .filter((p) => p.verificationStatus !== "PENDING")
    .slice(0, 20);

  const outstanding = (await getFinanceQueue()).filter(
    (i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") && i.balance > 0,
  );
  const outstandingTotal = outstanding.reduce((s, i) => s + i.balance, 0);

  return {
    counts: {
      pending: pending.length,
      verified: all.filter((p) => p.verificationStatus === "VERIFIED").length,
      rejected: all.filter((p) => p.verificationStatus === "REJECTED").length,
      missingReference: missingReference.length,
    },
    pending,
    missingReference,
    recentlyResolved,
    outstanding,
    outstandingTotal,
    currency: outstanding[0]?.currency ?? all[0]?.currency ?? "XOF",
  };
}

/** Dashboard finance KPIs (finance:read). */
export async function getFinanceKpis(): Promise<FinanceKpis> {
  const queue = await getFinanceQueue();
  return {
    outstanding: queue.reduce(
      (s, i) => (i.status === "ISSUED" || i.status === "PARTIALLY_PAID" ? s + i.balance : s),
      0,
    ),
    overdueCount: queue.filter((i) => i.overdue).length,
    draftCount: queue.filter((i) => i.status === "DRAFT").length,
    issuedCount: queue.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID").length,
  };
}
