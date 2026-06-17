/**
 * Handoff triggers (Phase 2.1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Called from the EXISTING business actions after a state change commits. Each
 * checks its precondition then defers to the idempotent createHandoffTask. All
 * are best-effort (never throw) — a handoff must not break the parent action.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { invoiceTotals, paidAmount, balanceDue } from "@/lib/finance/calc";
import { createHandoffTask } from "./service";
import { documentationComplete, dossierFullyPaid } from "./rules";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { tenantId: string; actorId: string };

/** Documentation → Customs: all required docs for an IMP/EXP dossier are APPROVED. */
export async function onDocumentApproved(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    const { data: file } = await supabase
      .from("operational_file")
      .select("type")
      .eq("id", fileId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle<{ type: string }>();
    if (!file || (file.type !== "IMP" && file.type !== "EXP")) return;

    const [{ data: types }, { data: docs }] = await Promise.all([
      supabase.from("document_type").select("code, required_for").eq("active", true).returns<{ code: string; required_for: string[] | null }[]>(),
      supabase.from("document").select("type_code, status").eq("tenant_id", ctx.tenantId).eq("file_id", fileId).is("deleted_at", null).returns<{ type_code: string; status: string }[]>(),
    ]);
    const required = (types ?? []).filter((tp) => (tp.required_for ?? []).includes(file.type)).map((tp) => tp.code);
    const approved = (docs ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code);
    if (!documentationComplete(required, approved)) return;

    await createHandoffTask(supabase, ctx, fileId, "CUSTOMS_HANDOFF");
  } catch {
    /* best-effort */
  }
}

/** Customs → Transport: fired once customs is RELEASED. */
export async function onCustomsReleased(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await createHandoffTask(supabase, ctx, fileId, "TRANSPORT_HANDOFF");
  } catch {
    /* best-effort */
  }
}

/** Transport → Finance: fired once the POD is received (gate already enforced upstream). */
export async function onPodReceived(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    await createHandoffTask(supabase, ctx, fileId, "FINANCE_HANDOFF");
  } catch {
    /* best-effort */
  }
}

/** Finance → Archive: fired when every issued invoice on the dossier is fully paid. */
export async function onPaymentRecorded(supabase: Admin, ctx: Ctx, fileId: string): Promise<void> {
  try {
    const invoices = await dossierInvoiceBalances(supabase, ctx.tenantId, fileId);
    if (!dossierFullyPaid(invoices)) return;
    await createHandoffTask(supabase, ctx, fileId, "ARCHIVE_HANDOFF");
  } catch {
    /* best-effort */
  }
}

async function dossierInvoiceBalances(
  supabase: Admin,
  tenantId: string,
  fileId: string,
): Promise<{ status: string; balance: number }[]> {
  const { data: invs } = await supabase
    .from("invoice")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .returns<{ id: string; status: string }[]>();
  const rows = invs ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: lines }, { data: pays }] = await Promise.all([
    supabase.from("invoice_line").select("invoice_id, quantity, unit_amount, tax_rate").eq("tenant_id", tenantId).in("invoice_id", ids).returns<{ invoice_id: string; quantity: number; unit_amount: number; tax_rate: number }[]>(),
    supabase.from("payment").select("invoice_id, amount, reversed_at").eq("tenant_id", tenantId).in("invoice_id", ids).returns<{ invoice_id: string; amount: number; reversed_at: string | null }[]>(),
  ]);
  return rows.map((inv) => {
    const l = (lines ?? [])
      .filter((x) => x.invoice_id === inv.id)
      .map((x) => ({ quantity: Number(x.quantity), unitAmount: Number(x.unit_amount), taxRate: Number(x.tax_rate) }));
    const p = (pays ?? [])
      .filter((x) => x.invoice_id === inv.id)
      .map((x) => ({ amount: Number(x.amount), reversed: x.reversed_at != null }));
    const { total } = invoiceTotals(l);
    return { status: inv.status, balance: balanceDue(total, paidAmount(p)) };
  });
}
