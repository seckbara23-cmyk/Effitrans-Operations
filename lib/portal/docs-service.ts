/**
 * Portal documents + invoices reads (Phase 1.12B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * USER-CONTEXT client so the additive portal RLS is the hard boundary:
 *   - document portal policy -> only APPROVED + shared + own-client docs
 *   - invoice portal policy   -> only ISSUED/PARTIALLY_PAID/PAID own-client
 *   - invoice_line/payment     -> inherit invoice visibility
 * SAFE projections only. Totals/balance/overdue reuse the pure finance calc.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { balanceDue, invoiceTotals, isOverdue, paidAmount } from "@/lib/finance/calc";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import type {
  PortalDocument,
  PortalInvoiceDetail,
  PortalInvoiceSummary,
} from "./types";

/** Audit a portal invoice view (portal actor). Best-effort. */
export async function auditPortalInvoiceView(
  clientUserId: string,
  tenantId: string,
  invoiceId: string,
): Promise<void> {
  await writeAudit({
    action: AuditActions.PORTAL_INVOICE_VIEWED,
    clientUserId,
    tenantId,
    entity: "invoice",
    entityId: invoiceId,
  });
}

type DocRow = {
  id: string;
  file_id: string;
  title: string | null;
  created_at: string;
  doc_type: { label_fr: string } | null;
  file: { file_number: string } | null;
};
const DOC_SELECT =
  "id, file_id, title, created_at, doc_type:type_code(label_fr), file:file_id(file_number)";

function toDoc(d: DocRow): PortalDocument {
  return {
    id: d.id,
    typeLabel: d.doc_type?.label_fr ?? "",
    title: d.title,
    fileId: d.file_id,
    fileNumber: d.file?.file_number ?? null,
    createdAt: d.created_at,
  };
}

export async function listPortalDocuments(fileId?: string): Promise<PortalDocument[]> {
  const supabase = getServerSupabaseClient();
  let q = supabase.from("document").select(DOC_SELECT);
  if (fileId) q = q.eq("file_id", fileId);
  const { data } = await q.order("created_at", { ascending: false }).returns<DocRow[]>();
  return (data ?? []).map(toDoc);
}

type InvRow = {
  id: string;
  file_id: string;
  invoice_number: string | null;
  status: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  file: { file_number: string } | null;
};
type LineRow = { invoice_id: string; description: string; quantity: number; unit_amount: number; tax_rate: number };
type PayRow = { invoice_id: string; amount: number; method: string; reference: string | null; paid_at: string; reversed_at: string | null; verification_status: string };

function summarize(
  inv: InvRow,
  lines: LineRow[],
  payments: PayRow[],
  now: Date,
): PortalInvoiceSummary & { issueDate: string | null; subtotal: number; tax: number } {
  const { subtotal, tax, total } = invoiceTotals(
    lines.map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) })),
  );
  const paid = paidAmount(payments.map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null })));
  const balance = balanceDue(total, paid);
  return {
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    fileId: inv.file_id,
    fileNumber: inv.file?.file_number ?? null,
    status: inv.status,
    currency: inv.currency,
    issueDate: inv.issue_date,
    subtotal,
    tax,
    total,
    paid,
    balance,
    dueDate: inv.due_date,
    overdue: isOverdue(inv.status as "ISSUED", inv.due_date, balance, now),
  };
}

async function fetchLinesPayments(supabase: ReturnType<typeof getServerSupabaseClient>, ids: string[]) {
  if (ids.length === 0) return { lines: [] as LineRow[], payments: [] as PayRow[] };
  const [lines, payments] = await Promise.all([
    supabase.from("invoice_line").select("invoice_id, description, quantity, unit_amount, tax_rate").in("invoice_id", ids).returns<LineRow[]>(),
    supabase.from("payment").select("invoice_id, amount, method, reference, paid_at, reversed_at, verification_status").in("invoice_id", ids).returns<PayRow[]>(),
  ]);
  return { lines: lines.data ?? [], payments: payments.data ?? [] };
}

export async function listPortalInvoices(fileId?: string): Promise<PortalInvoiceSummary[]> {
  const supabase = getServerSupabaseClient();
  const now = new Date();
  let q = supabase
    .from("invoice")
    .select("id, file_id, invoice_number, status, currency, issue_date, due_date, file:file_id(file_number)");
  if (fileId) q = q.eq("file_id", fileId);
  const { data } = await q.order("created_at", { ascending: false }).returns<InvRow[]>();
  const rows = data ?? [];
  const { lines, payments } = await fetchLinesPayments(supabase, rows.map((r) => r.id));
  return rows.map((r) =>
    summarize(r, lines.filter((l) => l.invoice_id === r.id), payments.filter((p) => p.invoice_id === r.id), now),
  );
}

export async function getPortalInvoice(id: string): Promise<PortalInvoiceDetail | null> {
  const supabase = getServerSupabaseClient();
  const now = new Date();
  const { data: inv } = await supabase
    .from("invoice")
    .select("id, file_id, invoice_number, status, currency, issue_date, due_date, file:file_id(file_number)")
    .eq("id", id)
    .maybeSingle<InvRow>();
  if (!inv) return null;

  const { lines, payments } = await fetchLinesPayments(supabase, [inv.id]);
  const base = summarize(inv, lines, payments, now);
  return {
    ...base,
    // Customer-safe: surface only that a payment is being verified, never the
    // internal verification status / provider refs / reconciliation detail.
    paymentVerifying: payments.some((p) => p.reversed_at == null && p.verification_status === "PENDING"),
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitAmount: Number(l.unit_amount),
      taxRate: Number(l.tax_rate),
    })),
    payments: payments
      .filter((p) => p.reversed_at == null)
      .map((p) => ({ amount: Number(p.amount), method: p.method, reference: p.reference, paidAt: p.paid_at })),
  };
}
