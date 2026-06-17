/**
 * Customer notification triggers (Phase 2.5). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Called from the existing business actions after a state change commits. Each
 * is best-effort (never throws) and defers to the idempotent notifyCustomer —
 * a milestone notification is generated once (dedup), through the portal +
 * email channels. No new lifecycle, no cron.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { invoiceTotals } from "@/lib/finance/calc";
import { documentationComplete } from "@/lib/handoffs/rules";
import { notifyCustomer } from "./service";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { tenantId: string; actorId: string };
const money = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export async function custDocumentsReceived(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await notifyCustomer(supabase, ctx, { event: "documents_received", fileId });
  } catch {
    /* best-effort */
  }
}

export async function custDocumentsVerified(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    const { data: file } = await supabase.from("operational_file").select("type").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle<{ type: string }>();
    if (!file || (file.type !== "IMP" && file.type !== "EXP")) return;
    const [{ data: types }, { data: docs }] = await Promise.all([
      supabase.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
      supabase.from("document").select("type_code, status").eq("tenant_id", ctx.tenantId).eq("file_id", fileId).is("deleted_at", null).returns<{ type_code: string; status: string }[]>(),
    ]);
    const required = (types ?? []).filter((tp) => (tp.required_for ?? []).includes(file.type)).map((tp) => tp.code);
    const approved = (docs ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code);
    if (!documentationComplete(required, approved)) return;
    await notifyCustomer(supabase, ctx, { event: "documents_verified", fileId });
  } catch {
    /* best-effort */
  }
}

export async function custCustomsCleared(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await notifyCustomer(supabase, ctx, { event: "customs_cleared", fileId });
  } catch {
    /* best-effort */
  }
}

export async function custTransportStarted(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await notifyCustomer(supabase, ctx, { event: "transport_started", fileId });
  } catch {
    /* best-effort */
  }
}

export async function custDelivered(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await notifyCustomer(supabase, ctx, { event: "delivered", fileId, vars: { deliveryDate: new Date().toISOString().slice(0, 10) } });
  } catch {
    /* best-effort */
  }
}

export async function custInvoiceIssued(supabase: Admin, ctx: Ctx, invoiceId: string): Promise<void> {
  try {
    const { data: inv } = await supabase.from("invoice").select("currency, due_date").eq("tenant_id", ctx.tenantId).eq("id", invoiceId).maybeSingle<{ currency: string; due_date: string | null }>();
    const { data: lines } = await supabase.from("invoice_line").select("quantity, unit_amount, tax_rate").eq("tenant_id", ctx.tenantId).eq("invoice_id", invoiceId).returns<{ quantity: number; unit_amount: number; tax_rate: number }[]>();
    const { total } = invoiceTotals((lines ?? []).map((l) => ({ quantity: Number(l.quantity), unitAmount: Number(l.unit_amount), taxRate: Number(l.tax_rate) })));
    await notifyCustomer(supabase, ctx, { event: "invoice_issued", invoiceId, vars: { total: money(total, inv?.currency ?? "XOF"), dueDate: inv?.due_date ?? "—" } });
  } catch {
    /* best-effort */
  }
}

export async function custPaymentReceived(supabase: Admin, ctx: Ctx, invoiceId: string, paymentId: string): Promise<void> {
  try {
    const [{ data: pay }, { data: inv }] = await Promise.all([
      supabase.from("payment").select("amount").eq("tenant_id", ctx.tenantId).eq("id", paymentId).maybeSingle<{ amount: number }>(),
      supabase.from("invoice").select("currency").eq("tenant_id", ctx.tenantId).eq("id", invoiceId).maybeSingle<{ currency: string }>(),
    ]);
    const amount = pay ? money(Number(pay.amount), inv?.currency ?? "XOF") : "";
    await notifyCustomer(supabase, ctx, { event: "payment_received", invoiceId, vars: { amount } });
  } catch {
    /* best-effort */
  }
}
