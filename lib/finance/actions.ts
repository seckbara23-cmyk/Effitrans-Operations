"use server";

/**
 * Finance server actions (Phase 1.11). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gate on a finance permission (role-based, NOT dossier visibility), scope to
 * tenant, write via the service-role admin client, audit, revalidate. Invoices
 * are editable only while DRAFT; numbers are assigned on ISSUE; payments are
 * capped at the balance due. Charges + draft invoices are soft/hard-deletable.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { balanceDue, invoiceTotals, paidAmount, paymentStatus, round2 } from "./calc";
import {
  canDeleteInvoice,
  canEditInvoice,
  canIssue,
  canRecordPayment,
  canVoid,
  isInvoiceStatus,
} from "./status";
import type {
  ActionResult,
  ChargeInput,
  InvoiceLineInput,
  InvoiceStatus,
  PaymentInput,
} from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

function revalidate(fileId?: string) {
  if (fileId) revalidatePath(`/files/${fileId}`);
  revalidatePath("/finance");
  revalidatePath("/dashboard");
}

async function verifyFile(supabase: Admin, fileId: string, tenantId: string) {
  const { data } = await supabase
    .from("operational_file")
    .select("id, tenant_id, client_id")
    .eq("id", fileId)
    .maybeSingle();
  return data && data.tenant_id === tenantId ? data : null;
}

async function loadInvoice(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("invoice")
    .select("id, file_id, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/** Total / paid / balance for an invoice, derived from its lines + payments. */
async function invoiceBalance(supabase: Admin, invoiceId: string, tenantId: string) {
  const [lines, payments] = await Promise.all([
    supabase.from("invoice_line").select("quantity, unit_amount, tax_rate").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
    supabase.from("payment").select("amount, reversed_at").eq("invoice_id", invoiceId).eq("tenant_id", tenantId),
  ]);
  const { total } = invoiceTotals(
    (lines.data ?? []).map((l) => ({
      quantity: Number(l.quantity),
      unitAmount: Number(l.unit_amount),
      taxRate: Number(l.tax_rate),
    })),
  );
  const paid = paidAmount(
    (payments.data ?? []).map((p) => ({ amount: Number(p.amount), reversed: p.reversed_at != null })),
  );
  return { total, paid, balance: balanceDue(total, paid) };
}

// ---------------------------------------------------------------- charges ----

export async function createCharge(fileId: string, input: ChargeInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!input.description?.trim()) return { ok: false, error: "description_required" };

  const supabase = getAdminSupabaseClient();
  if (!(await verifyFile(supabase, fileId, user.tenantId))) return { ok: false, error: "file_not_found" };

  const { data, error } = await supabase
    .from("billing_charge")
    .insert({
      tenant_id: user.tenantId,
      file_id: fileId,
      description: input.description.trim(),
      quantity: input.quantity ?? 1,
      unit_amount: input.unitAmount ?? 0,
      tax_rate: input.taxRate ?? 0,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({ action: AuditActions.CHARGE_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "billing_charge", entityId: data.id, after: { file_id: fileId } });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export async function updateCharge(id: string, input: ChargeInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!input.description?.trim()) return { ok: false, error: "description_required" };

  const supabase = getAdminSupabaseClient();
  const { data: charge } = await supabase
    .from("billing_charge")
    .select("id, file_id, tenant_id")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!charge) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("billing_charge")
    .update({
      description: input.description.trim(),
      quantity: input.quantity ?? 1,
      unit_amount: input.unitAmount ?? 0,
      tax_rate: input.taxRate ?? 0,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.CHARGE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "billing_charge", entityId: id });
  revalidate(charge.file_id);
  return { ok: true, id };
}

export async function deleteCharge(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: charge } = await supabase
    .from("billing_charge")
    .select("id, file_id")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!charge) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("billing_charge")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.CHARGE_DELETED, actorId: user.id, tenantId: user.tenantId, entity: "billing_charge", entityId: id });
  revalidate(charge.file_id);
  return { ok: true, id };
}

// --------------------------------------------------------------- invoices ----

export async function createInvoice(fileId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const file = await verifyFile(supabase, fileId, user.tenantId);
  if (!file) return { ok: false, error: "file_not_found" };

  const { data, error } = await supabase
    .from("invoice")
    .insert({ tenant_id: user.tenantId, file_id: fileId, client_id: file.client_id, status: "DRAFT", created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({ action: AuditActions.INVOICE_CREATED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: data.id, after: { file_id: fileId } });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export async function updateInvoice(
  id: string,
  input: { dueDate?: string | null; notes?: string | null },
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canEditInvoice(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };

  const { error } = await supabase
    .from("invoice")
    .update({ due_date: input.dueDate || null, notes: input.notes?.trim() || null })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: id });
  revalidate(inv.file_id);
  return { ok: true, id };
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canDeleteInvoice(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };

  const { error } = await supabase.from("invoice").delete().eq("id", id).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_DELETED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: id, before: { status: inv.status } });
  revalidate(inv.file_id);
  return { ok: true, id };
}

export async function issueInvoice(id: string, dueDate?: string | null): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:issue");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canIssue(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };

  const { count } = await supabase
    .from("invoice_line")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", id)
    .eq("tenant_id", user.tenantId);
  if (!count) return { ok: false, error: "no_lines" };

  const { data: number, error: numErr } = await supabase.rpc("next_invoice_number", { p_tenant: user.tenantId });
  if (numErr || !number) return { ok: false, error: numErr?.message ?? "numbering_failed" };

  const today = new Date();
  const issueDate = today.toISOString().slice(0, 10);
  const due = dueDate || new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const { error } = await supabase
    .from("invoice")
    .update({ status: "ISSUED", invoice_number: number, issue_date: issueDate, due_date: due, issued_by: user.id })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_ISSUED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: id, after: { invoice_number: number } });
  revalidate(inv.file_id);
  return { ok: true, id };
}

export async function voidInvoice(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:void");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canVoid(inv.status as InvoiceStatus)) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("invoice")
    .update({ status: "VOID", voided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_VOIDED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: id, before: { status: inv.status } });
  revalidate(inv.file_id);
  return { ok: true, id };
}

// ------------------------------------------------------------ invoice lines ----

export async function addInvoiceLine(invoiceId: string, input: InvoiceLineInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!input.description?.trim()) return { ok: false, error: "description_required" };

  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, invoiceId, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canEditInvoice(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };

  const { error } = await supabase.from("invoice_line").insert({
    tenant_id: user.tenantId,
    invoice_id: invoiceId,
    charge_id: input.chargeId ?? null,
    description: input.description.trim(),
    quantity: input.quantity ?? 1,
    unit_amount: input.unitAmount ?? 0,
    tax_rate: input.taxRate ?? 0,
  });
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: invoiceId });
  revalidate(inv.file_id);
  return { ok: true, id: invoiceId };
}

export async function deleteInvoiceLine(lineId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: line } = await supabase
    .from("invoice_line")
    .select("id, invoice_id")
    .eq("id", lineId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!line) return { ok: false, error: "not_found" };
  const inv = await loadInvoice(supabase, line.invoice_id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canEditInvoice(inv.status as InvoiceStatus)) return { ok: false, error: "not_draft" };

  const { error } = await supabase.from("invoice_line").delete().eq("id", lineId).eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: AuditActions.INVOICE_UPDATED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: line.invoice_id });
  revalidate(inv.file_id);
  return { ok: true, id: line.invoice_id };
}

// ---------------------------------------------------------------- payments ----

export async function recordPayment(invoiceId: string, input: PaymentInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:payment");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };

  const supabase = getAdminSupabaseClient();
  const inv = await loadInvoice(supabase, invoiceId, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };
  if (!canRecordPayment(inv.status as InvoiceStatus)) return { ok: false, error: "not_payable" };

  const { total, paid, balance } = await invoiceBalance(supabase, invoiceId, user.tenantId);
  if (amount > balance) return { ok: false, error: "exceeds_balance" };

  const { error } = await supabase.from("payment").insert({
    tenant_id: user.tenantId,
    invoice_id: invoiceId,
    amount,
    method: input.method,
    reference: input.reference?.trim() || null,
    paid_at: input.paidAt || new Date().toISOString().slice(0, 10),
    recorded_by: user.id,
  });
  if (error) return { ok: false, error: error.message };

  // Recompute the payment-driven status.
  const newStatus = paymentStatus(total, round2(paid + amount));
  await supabase.from("invoice").update({ status: newStatus }).eq("id", invoiceId).eq("tenant_id", user.tenantId);

  await writeAudit({ action: AuditActions.PAYMENT_RECORDED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: invoiceId, after: { amount, method: input.method } });
  revalidate(inv.file_id);
  return { ok: true, id: invoiceId };
}

export async function reversePayment(paymentId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("finance:void");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data: pay } = await supabase
    .from("payment")
    .select("id, invoice_id, reversed_at")
    .eq("id", paymentId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!pay || pay.reversed_at) return { ok: false, error: "not_found" };

  const inv = await loadInvoice(supabase, pay.invoice_id, user.tenantId);
  if (!inv) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("payment")
    .update({ reversed_at: new Date().toISOString(), reversed_by: user.id })
    .eq("id", paymentId)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  // Recompute status; a VOID invoice stays VOID, otherwise re-derive from payments.
  if (inv.status !== "VOID") {
    const { total, paid } = await invoiceBalance(supabase, pay.invoice_id, user.tenantId);
    await supabase
      .from("invoice")
      .update({ status: paymentStatus(total, paid) })
      .eq("id", pay.invoice_id)
      .eq("tenant_id", user.tenantId);
  }

  await writeAudit({ action: AuditActions.PAYMENT_REVERSED, actorId: user.id, tenantId: user.tenantId, entity: "invoice", entityId: pay.invoice_id, before: { payment_id: paymentId } });
  revalidate(inv.file_id);
  return { ok: true, id: pay.invoice_id };
}
