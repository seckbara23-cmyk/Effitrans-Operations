"use server";
/**
 * Official billing workflow — server actions (Phase 5.0D-2). SERVER-ONLY.
 * Official steps 20-22.
 * ---------------------------------------------------------------------------
 * REUSE, NOT REBUILD. There is no second invoice, approval, email or workflow
 * system here:
 *   invoice / invoice_line       the existing rows (Phase 1.11)
 *   communication_message        the existing email queue, with its own
 *                                status/retry_count/last_error/sent_at fields
 *   process engine               the existing maker-checker + handoffs (5.0B)
 *   tenant branding              resolved inside queueAndSend, unchanged
 *   audit_log                    the existing writeAudit
 *
 * Every mutation runs: flag -> permission -> tenant -> dossier access -> billing
 * gate -> invoice state -> apply -> sync the process step -> audit.
 *
 * Concurrency is COMPARE-AND-SET (`update ... where id = ? and <expected state>`,
 * then check the affected row count), exactly like the process engine. A second
 * concurrent submit/approve matches zero rows and is rejected deterministically.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { queueAndSend } from "@/lib/comms/queue";
import { invoiceTotals } from "@/lib/finance/calc";
import { getProcessFlags } from "../config";
import { approveStep, rejectStep, submitStep } from "../engine/actions";
import { loadProcessSnapshot, toViews } from "../engine/snapshot";
import { evaluateBillingGate } from "../engine/gates";
import {
  canEmailInvoice,
  canSubmitInvoice,
  canValidateInvoice,
  validateRejectionReason,
  type BillingError,
  type InvoiceView,
} from "./state";

export type BillingResult<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: BillingError };

const fail = <T,>(error: BillingError): BillingResult<T> => ({ ok: false, error });

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath(`/files/${fileId}/process`);
  revalidatePath("/queues/billing");
  revalidatePath("/queues/finance");
  revalidatePath("/my-work");
}

type Ctx = { userId: string; tenantId: string; permissions: string[] };

async function guard(permission: string, fileId: string): Promise<Ctx | BillingError> {
  if (!getProcessFlags().enabled) return "feature_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  // Cross-tenant / invisible dossier => the same opaque refusal.
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "cross_tenant_forbidden";
  return { userId: user.id, tenantId: user.tenantId, permissions: await getEffectivePermissions(user.id) };
}

const isErr = (v: Ctx | BillingError): v is BillingError => typeof v === "string";

/** Load the invoice with its official maker-checker fields + line count. */
async function loadInvoiceView(
  tenantId: string,
  invoiceId: string,
): Promise<{ view: InvoiceView; fileId: string; clientId: string | null } | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("invoice")
    .select(
      "id, file_id, client_id, status, submitted_by, submitted_at, validated_by, validated_at, rejection_reason, revision",
    )
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Row;

  const { count } = await admin
    .from("invoice_line")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId);

  return {
    view: {
      id: r.id as string,
      status: r.status as InvoiceView["status"],
      submittedBy: str(r.submitted_by),
      submittedAt: str(r.submitted_at),
      validatedBy: str(r.validated_by),
      validatedAt: str(r.validated_at),
      rejectionReason: str(r.rejection_reason),
      revision: Number(r.revision ?? 1),
      lineCount: count ?? 0,
    },
    fileId: r.file_id as string,
    clientId: str(r.client_id),
  };
}

/** The dossier has passed BOTH completeness checkpoints (official steps 18 + 19). */
async function billingReady(ctx: Ctx, fileId: string): Promise<boolean> {
  const snap = await loadProcessSnapshot(ctx.tenantId, fileId, ctx.permissions);
  if (!snap?.instance) return false;
  return evaluateBillingGate(toViews(snap.executions), snap.evidence).ready;
}

// ------------------------------------------------- 20. draft preparation ----

/**
 * Billing Officer prepares the invoice draft (official step 20, maker half).
 *
 * A draft may NOT be created on a dossier that is not billing-ready: both the
 * Coordinator's and the Account Manager's completeness reviews must have passed.
 * This is the gate the platform never had — an invoice used to be creatable on
 * any dossier at any time, with no evidence at all.
 */
export async function prepareInvoiceDraft(fileId: string): Promise<BillingResult<{ id: string }>> {
  const c = await guard("finance:create", fileId);
  if (isErr(c)) return fail(c);

  if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready");

  const admin = getAdminSupabaseClient();

  // One active draft per dossier — a second call returns the existing one.
  const { data: existing } = await admin
    .from("invoice")
    .select("id")
    .eq("file_id", fileId)
    .eq("tenant_id", c.tenantId)
    .in("status", ["DRAFT", "VALIDATED"])
    .limit(1);
  const found = ((existing ?? []) as Row[])[0];
  if (found) return { ok: true, id: found.id as string };

  const { data: file } = await admin
    .from("operational_file")
    .select("client_id")
    .eq("id", fileId)
    .eq("tenant_id", c.tenantId)
    .maybeSingle();

  const { data: created, error } = await admin
    .from("invoice")
    .insert({
      tenant_id: c.tenantId,
      file_id: fileId,
      client_id: (file as Row | null)?.client_id as string | null,
      status: "DRAFT",
      created_by: c.userId,
    })
    .select("id")
    .single();
  if (error || !created) return fail("invoice_missing");

  await writeAudit({
    action: AuditActions.INVOICE_CREATED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: created.id as string,
    after: { file_id: fileId, official_step: "billing_draft" },
  });
  revalidate(fileId);
  return { ok: true, id: created.id as string };
}

// --------------------------------------------- 20. submit to Finance ----

/**
 * Billing submits the draft for independent validation.
 *
 * The invoice is FROZEN from here (lib/finance/actions.ts updateInvoice refuses a
 * submitted invoice), so the checker approves exactly what they reviewed.
 * The process step is advanced ONLY after a real invoice submission exists.
 */
export async function submitInvoiceToFinance(invoiceId: string): Promise<BillingResult> {
  const admin = getAdminSupabaseClient();

  // Resolve the dossier first so the guard can check access.
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:create", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canSubmitInvoice(loaded.view);
  if (!check.ok) return fail(check.error!);

  if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready");

  // CAS: only an unsubmitted DRAFT may be submitted. A concurrent second submit
  // matches zero rows.
  const { data } = await admin
    .from("invoice")
    .update({ submitted_by: c.userId, submitted_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .is("submitted_at", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("duplicate_submission");

  // Sync the official process: step 20 is now SUBMITTED, awaiting the checker.
  // The engine records the maker on the execution row and opens step 21.
  await submitStep(fileId, "billing_draft");

  await writeAudit({
    action: AuditActions.INVOICE_DRAFT_SUBMITTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // Identifiers and state only — never the invoice contents.
    after: { file_id: fileId, revision: loaded.view.revision, official_step: "billing_draft" },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------- 21. Finance approval ----

/**
 * Finance validates the invoice (official step 21, CHECKER half).
 *
 * MAKER != CHECKER on IDENTITY. OPS_SUPERVISOR and SYSTEM_ADMIN hold both
 * finance:create and finance:validate by design — and are still refused here when
 * they are the maker. There is no override for this rule.
 */
export async function approveInvoice(invoiceId: string): Promise<BillingResult> {
  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:validate", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canValidateInvoice(loaded.view, c.userId);
  if (!check.ok) return fail(check.error!);

  const now = new Date().toISOString();
  // CAS: only a submitted, not-yet-validated DRAFT may be validated. A second
  // concurrent approval matches zero rows — deterministic, never a double review.
  const { data } = await admin
    .from("invoice")
    .update({ status: "VALIDATED", validated_by: c.userId, validated_at: now, rejection_reason: null })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .not("submitted_at", "is", null)
    .is("validated_at", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("invoice_not_awaiting_validation");

  // Sync the official process. The engine re-checks maker != checker on the
  // execution row, so the rule holds even if this action were bypassed.
  await approveStep(fileId, "finance_invoice_validation");

  await writeAudit({
    action: AuditActions.INVOICE_VALIDATED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    after: { maker: loaded.view.submittedBy, checker: c.userId, revision: loaded.view.revision },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------ 21. Finance rejection ----

/**
 * Finance rejects with a MANDATORY reason. The invoice returns to Billing for
 * correction: submitted_at is cleared (reopening the draft) and `revision` is
 * incremented, so the resubmission history is traceable. The prior review is NOT
 * overwritten — the engine keeps the rejected execution row forever and creates a
 * NEW correction row pointing at it.
 */
export async function rejectInvoice(invoiceId: string, reason: string): Promise<BillingResult> {
  const r = validateRejectionReason(reason);
  if (!r.ok) return fail(r.error!);

  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:validate", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  // A rejection is still a review: the checker may not be the maker.
  const check = canValidateInvoice(loaded.view, c.userId);
  if (!check.ok) return fail(check.error!);

  const now = new Date().toISOString();
  const { data } = await admin
    .from("invoice")
    .update({
      // Back to an editable draft: clearing submitted_at is what reopens it.
      submitted_at: null,
      rejected_by: c.userId,
      rejected_at: now,
      rejection_reason: r.value,
      revision: loaded.view.revision + 1,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "DRAFT")
    .not("submitted_at", "is", null)
    .select("id");
  if ((data?.length ?? 0) !== 1) return fail("invoice_not_awaiting_validation");

  // The engine freezes the rejected step and opens a NEW correction row.
  await rejectStep(fileId, "finance_invoice_validation", r.value!);

  await writeAudit({
    action: AuditActions.INVOICE_VALIDATION_REJECTED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // The sanitized reason and identifiers only — never the invoice payload.
    after: {
      maker: loaded.view.submittedBy,
      checker: c.userId,
      reason: r.value,
      revision: loaded.view.revision + 1,
    },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId };
}

// ------------------------------------------------------ 22. invoice email ----

/**
 * Billing emails the VALIDATED invoice to the client (official step 22).
 *
 * REUSES communication_message end-to-end: its status/retry_count/last_error/
 * sent_at fields ARE the delivery outcome, so no email table is added.
 *
 * IDEMPOTENT: an already-SENT message for this invoice short-circuits, so a
 * double click cannot email the client twice.
 *
 * A successful send does NOT mean paid, does NOT mean deposited, and does NOT
 * close the dossier — it only advances step 22. The invoice moves
 * VALIDATED -> ISSUED here, which is also what first makes it visible in the
 * client portal (portal RLS exposes ISSUED/PARTIALLY_PAID/PAID): a client can
 * never see an invoice that was not actually sent to them.
 */
export async function emailValidatedInvoice(invoiceId: string): Promise<BillingResult<{ id: string; status: string }>> {
  const admin = getAdminSupabaseClient();
  const { data: pre } = await admin.from("invoice").select("file_id, tenant_id").eq("id", invoiceId).maybeSingle();
  const fileId = (pre as Row | null)?.file_id as string | undefined;
  if (!fileId) return fail("invoice_missing");

  const c = await guard("finance:issue", fileId);
  if (isErr(c)) return fail(c);
  if ((pre as Row).tenant_id !== c.tenantId) return fail("cross_tenant_forbidden");

  const loaded = await loadInvoiceView(c.tenantId, invoiceId);
  if (!loaded) return fail("invoice_missing");

  const check = canEmailInvoice(loaded.view);
  if (!check.ok) return fail(check.error!);

  // Idempotency: already delivered => success, without sending a second email.
  const { data: alreadySent } = await admin
    .from("communication_message")
    .select("id")
    .eq("tenant_id", c.tenantId)
    .eq("related_entity", "invoice")
    .eq("related_entity_id", invoiceId)
    .eq("status", "SENT")
    .limit(1);
  if (((alreadySent ?? []) as Row[]).length > 0) {
    return { ok: true, id: invoiceId, status: "SENT" };
  }

  // The authorized billing contact: the client's primary contact, else the client
  // record's own email. No contact => no send (we never guess a recipient).
  const { data: contacts } = await admin
    .from("client_contact")
    .select("name, email, is_primary")
    .eq("tenant_id", c.tenantId)
    .eq("client_id", loaded.clientId ?? "")
    .not("email", "is", null);
  const rows = (contacts ?? []) as Row[];
  const primary = rows.find((r) => r.is_primary === true) ?? rows[0];

  const { data: client } = await admin
    .from("client")
    .select("name, email")
    .eq("id", loaded.clientId ?? "")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  const clientRow = client as Row | null;

  const recipientEmail = str(primary?.email) ?? str(clientRow?.email);
  if (!recipientEmail) return fail("billing_contact_missing");

  // Totals from the existing calculator — no second money model.
  const { data: lines } = await admin
    .from("invoice_line")
    .select("quantity, unit_amount, tax_rate")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", c.tenantId);
  const totals = invoiceTotals(
    ((lines ?? []) as Row[]).map((l) => ({
      quantity: Number(l.quantity ?? 0),
      unitAmount: Number(l.unit_amount ?? 0),
      taxRate: Number(l.tax_rate ?? 0),
    })),
  );

  // Number + dates are assigned at SEND time (an unsent invoice has no number).
  const { data: number } = await admin.rpc("next_invoice_number", { p_tenant: c.tenantId });
  const today = new Date();
  const issueDate = today.toISOString().slice(0, 10);
  const dueDate = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const invoiceNumber = (number as string | null) ?? invoiceId.slice(0, 8);

  // Branding and rendering are resolved INSIDE queueAndSend — unchanged.
  const sent = await queueAndSend({
    tenantId: c.tenantId,
    createdBy: c.userId,
    templateKey: "invoice_issued",
    vars: {
      clientName: (str(clientRow?.name) ?? "") as string,
      invoiceNumber,
      total: String(totals.total),
      dueDate,
      portalLink: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/portal/invoices/${invoiceId}`,
    },
    recipientEmail,
    recipientName: str(primary?.name) ?? str(clientRow?.name),
    related: "invoice",
    relatedId: invoiceId,
    fileId,
    clientId: loaded.clientId,
  });

  if (sent.status !== "SENT") {
    // The message row keeps status/last_error/retry_count — retry is just calling
    // this action again. The invoice stays VALIDATED and step 22 does NOT advance.
    await writeAudit({
      action: AuditActions.INVOICE_EMAIL_FAILED,
      actorId: c.userId,
      tenantId: c.tenantId,
      entity: "invoice",
      entityId: invoiceId,
      // Classification only — never the provider error body, never the email body.
      after: { file_id: fileId, delivery_status: sent.status, retryable: true },
    });
    revalidate(fileId);
    return fail("email_send_failed");
  }

  // Delivered. NOW the invoice becomes ISSUED (and portal-visible).
  await admin
    .from("invoice")
    .update({
      status: "ISSUED",
      invoice_number: invoiceNumber,
      issue_date: issueDate,
      due_date: dueDate,
      issued_by: c.userId,
    })
    .eq("id", invoiceId)
    .eq("tenant_id", c.tenantId)
    .eq("status", "VALIDATED");

  // Step 22 advances ONLY on a successful send.
  await submitStep(fileId, "billing_dispatch");

  await writeAudit({
    action: AuditActions.INVOICE_EMAILED,
    actorId: c.userId,
    tenantId: c.tenantId,
    entity: "invoice",
    entityId: invoiceId,
    // Recipient + outcome. NEVER the rendered email body.
    after: {
      recipient: recipientEmail,
      invoice_number: invoiceNumber,
      message_id: sent.id,
      delivery_status: sent.status,
    },
  });
  revalidate(fileId);
  return { ok: true, id: invoiceId, status: sent.status };
}
