"use server";
/**
 * Finance execution — server actions (Phase 9.0E). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONE write path for finance_request (workflow steps 20–26 seam): request
 * intake → maker-checker review → explicit disbursement → documentary evidence
 * → verification → optional conversion to a customer-billable charge →
 * financial clearance. Every rule the module DECIDES lives in ../requests
 * (pure); every mutation here is flag-gated, permission-gated, tenant-scoped,
 * compare-and-set guarded, and audited with safe metadata.
 *
 * BOUNDARIES, restated where they are enforced:
 *   * approval never creates a payment (review touches finance_request only);
 *   * a disbursement is only the explicit action, CAS on APPROVED → DISBURSED;
 *   * recording a duty payment NEVER clears customs (this module never writes
 *     customs_record and never calls releaseCustoms);
 *   * evidence submission ≠ verification (distinct statuses, distinct actor);
 *   * conversion to a billable charge is explicit, reimbursable-only, and uses
 *     the EXISTING billing_charge → invoice chain (no invoice writes here);
 *   * clearance asserts only Finance's own completeness and never touches
 *     ownership, delivery, customs, or payment settlement.
 *
 * Gated on financeExecution (ENGINE ∧ STRUCTURES ∧ INTAKE ∧ TRANSIT ∧ FINANCE
 * env flags ∧ tenant rollout). When migration 20260723000002 is absent the
 * read side degrades to null (panel hidden) and every write fails closed.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { createNotification } from "@/lib/notifications/create";
import { sendHandoff } from "@/lib/process/engine/actions";
import {
  canTransitionFinanceRequest,
  canTransitionEvidence,
  evaluateFinancialClearance,
  isFinanceCategory,
  isDisbursementMethod,
  financeCategoryLabelFr,
  FINANCE_CATEGORIES,
  FINANCE_BLOCKER_CATEGORIES,
  type FinanceRequestStatus,
  type EvidenceStatus,
  type ClearanceResult,
} from "./requests";

type Admin = ReturnType<typeof getAdminSupabaseClient>;
type Ctx = { userId: string; tenantId: string; permissions: string[] };

export type FinanceActionError =
  | "finance_disabled"
  | "forbidden"
  | "not_found"
  | "invalid_state"
  | "reason_required"
  | "self_review_forbidden"
  | "self_verification_forbidden"
  | "not_reimbursable"
  | "clearance_not_ready";

export type FinanceActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: FinanceActionError; missing?: string[] };

const fail = (error: FinanceActionError): FinanceActionResult => ({ ok: false, error });
const isErr = (v: Ctx | FinanceActionError): v is FinanceActionError => typeof v === "string";

async function financeGuard(permission: string, fileId: string): Promise<Ctx | FinanceActionError> {
  const kill = globalKillSwitch();
  if (!kill.enabled || !kill.financeExecution) return "finance_disabled";
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return "forbidden";
  }
  const tenantFlags = await getTenantProcessFlags(user.tenantId);
  if (!tenantFlags.enabled || !tenantFlags.financeExecution) return "finance_disabled";
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return "forbidden";
  const permissions = await getEffectivePermissions(user.id);
  return { userId: user.id, tenantId: user.tenantId, permissions };
}

/** The dossier, tenant-verified. */
async function loadFile(admin: Admin, tenantId: string, fileId: string) {
  const { data } = await admin
    .from("operational_file")
    .select("id, tenant_id, file_number")
    .eq("id", fileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ?? null;
}

/** One request, tenant + dossier verified. */
async function loadRequest(admin: Admin, tenantId: string, fileId: string, requestId: string) {
  const { data } = await admin
    .from("finance_request")
    .select("*")
    .eq("id", requestId)
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .maybeSingle();
  return data ?? null;
}

// ========================================================= step 20: intake ====

/**
 * File a finance request (Transit/Operations → Finance). Creates the REQUEST
 * fact only — no payment, no invoice, no accounting entry. Gated on the same
 * permission the Transit payment-gate request uses (process:decision:create),
 * so the origin stays the operational side that already holds it.
 */
export async function createFinanceRequest(
  fileId: string,
  input: {
    category: string;
    amount: number;
    currency?: string;
    purpose: string;
    beneficiary: string;
    reimbursable?: boolean;
    customsRecordId?: string;
    processDecisionId?: string;
  },
): Promise<FinanceActionResult> {
  const ctx = await financeGuard("process:decision:create", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!isFinanceCategory(input.category)) return fail("invalid_state");
  if (!Number.isFinite(input.amount) || input.amount <= 0) return fail("invalid_state");
  if (!input.purpose?.trim() || !input.beneficiary?.trim()) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const file = await loadFile(admin, ctx.tenantId, fileId);
  if (!file) return fail("not_found");

  const reimbursable =
    input.reimbursable ??
    FINANCE_CATEGORIES.find((c) => c.code === input.category)!.reimbursableByDefault;

  const { data: created, error } = await admin
    .from("finance_request")
    .insert({
      tenant_id: ctx.tenantId,
      file_id: fileId,
      customs_record_id: input.customsRecordId ?? null,
      process_decision_id: input.processDecisionId ?? null,
      category: input.category,
      amount: input.amount,
      currency: input.currency?.trim() || "XOF",
      purpose: input.purpose.trim(),
      beneficiary: input.beneficiary.trim(),
      reimbursable,
      requested_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !created) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_REQUEST_CREATED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: created.id,
    after: {
      category: input.category,
      amount: input.amount,
      currency: input.currency?.trim() || "XOF",
      reimbursable,
      file_id: fileId,
    },
  });

  await notifyRoles(ctx, fileId, ["FINANCE_OFFICER", "CUSTOMS_FINANCE_OFFICER", "OPS_SUPERVISOR"],
    "Nouvelle demande de fonds", `Une demande de fonds (${financeCategoryLabelFr(input.category)}) attend la revue Finance.`);
  return { ok: true, id: created.id };
}

// ========================================================= step 21: review ====

/**
 * Finance reviews the request: approve / reject / return-for-correction.
 * MAKER-CHECKER ON IDENTITY: the reviewer may never be the requester, even
 * when one person holds both permissions. Approval authorizes execution and
 * nothing else — it writes finance_request only, never payment/invoice.
 * Rejection and return require a note. CAS on the current status.
 */
export async function reviewFinanceRequest(
  fileId: string,
  requestId: string,
  input: { verdict: "APPROVED" | "REJECTED" | "RETURNED"; note?: string },
): Promise<FinanceActionResult> {
  const ctx = await financeGuard("finance:validate", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!["APPROVED", "REJECTED", "RETURNED"].includes(input.verdict)) return fail("invalid_state");
  if (input.verdict !== "APPROVED" && !input.note?.trim()) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (req.requested_by === ctx.userId) return fail("self_review_forbidden");
  if (!canTransitionFinanceRequest(req.status as FinanceRequestStatus, input.verdict)) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("finance_request")
    .update({
      status: input.verdict,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      review_note: input.note?.trim() || null,
    })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", req.status) // CAS — a concurrent review matches zero rows
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_REQUEST_REVIEWED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    before: { status: req.status },
    after: { status: input.verdict, category: req.category },
  });

  if (req.requested_by !== ctx.userId) {
    const file = await loadFile(admin, ctx.tenantId, fileId);
    await createNotification({
      tenantId: ctx.tenantId,
      userId: req.requested_by,
      type: "FILE_ASSIGNED",
      fileId,
      title: `Demande de fonds ${input.verdict === "APPROVED" ? "approuvée" : input.verdict === "REJECTED" ? "rejetée" : "à corriger"} — ${file?.file_number ?? ""}`.trim(),
      body: input.verdict === "APPROVED"
        ? "La demande est approuvée. Le décaissement reste à exécuter par la Finance."
        : "La revue Finance a retourné la demande — consultez la note de revue.",
    });
  }
  return { ok: true, id: requestId };
}

/** A returned request, corrected, goes back into review. Requester-side action. */
export async function resubmitFinanceRequest(fileId: string, requestId: string): Promise<FinanceActionResult> {
  const ctx = await financeGuard("process:decision:create", fileId);
  if (isErr(ctx)) return fail(ctx);
  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (!canTransitionFinanceRequest(req.status as FinanceRequestStatus, "REQUESTED")) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("finance_request")
    .update({ status: "REQUESTED", reviewed_by: null, reviewed_at: null })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", req.status)
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_REQUEST_REVIEWED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    before: { status: req.status },
    after: { status: "REQUESTED", resubmission: true },
  });
  return { ok: true, id: requestId };
}

// =================================================== step 22: disbursement ====

/**
 * Record the ACTUAL disbursement. Only from APPROVED — the compare-and-set on
 * that single edge is the duplicate-execution guard (a second concurrent call
 * matches zero rows) AND the no-unauthorized-payment guard (a REQUESTED or
 * REJECTED request has no edge into DISBURSED). Never inferred from approval.
 * Writes finance_request only: no payment row (customer money-in is a
 * different fact), no invoice, no customs write.
 */
export async function recordDisbursement(
  fileId: string,
  requestId: string,
  input: { amount: number; method: string; reference?: string; paidAt?: string },
): Promise<FinanceActionResult> {
  const ctx = await financeGuard("finance:payment", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (!Number.isFinite(input.amount) || input.amount <= 0) return fail("invalid_state");
  if (!isDisbursementMethod(input.method)) return fail("invalid_state");

  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (!canTransitionFinanceRequest(req.status as FinanceRequestStatus, "DISBURSED")) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("finance_request")
    .update({
      status: "DISBURSED",
      disbursed_amount: input.amount,
      disbursement_method: input.method,
      disbursement_reference: input.reference?.trim() || null,
      disbursed_at: input.paidAt ?? new Date().toISOString().slice(0, 10),
      disbursed_by: ctx.userId,
    })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "APPROVED") // CAS — the ONLY edge into DISBURSED
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_REQUEST_DISBURSED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    after: {
      category: req.category,
      amount: input.amount,
      method: input.method,
      reference: input.reference?.trim() || null,
    },
  });

  if (req.requested_by !== ctx.userId) {
    const file = await loadFile(admin, ctx.tenantId, fileId);
    await createNotification({
      tenantId: ctx.tenantId,
      userId: req.requested_by,
      type: "FILE_ASSIGNED",
      fileId,
      title: `Décaissement exécuté — ${file?.file_number ?? ""}`.trim(),
      body: "La Finance a exécuté le décaissement demandé. Le justificatif reste à joindre et vérifier.",
    });
  }
  return { ok: true, id: requestId };
}

// ============================================ step 24: evidence + verify ====

/**
 * Attach documentary proof from the EXISTING document store. The document must
 * belong to the same tenant AND the same dossier. Submission sets SUBMITTED —
 * it never verifies anything.
 */
export async function attachDisbursementEvidence(
  fileId: string,
  requestId: string,
  documentId: string,
): Promise<FinanceActionResult> {
  const ctx = await financeGuard("finance:update", fileId);
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (!canTransitionEvidence(req.evidence_status as EvidenceStatus, "SUBMITTED")) return fail("invalid_state");

  const { data: doc } = await admin
    .from("document")
    .select("id, tenant_id, file_id")
    .eq("id", documentId)
    .eq("tenant_id", ctx.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return fail("not_found");

  const { data: updated, error } = await admin
    .from("finance_request")
    .update({ evidence_status: "SUBMITTED", evidence_document_id: documentId })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .eq("evidence_status", req.evidence_status) // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_EVIDENCE_SUBMITTED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    after: { document_id: documentId, category: req.category },
  });
  return { ok: true, id: requestId };
}

/**
 * Verify (or reject) the submitted proof. MAKER-CHECKER ON IDENTITY: the
 * verifier may never be the executor who disbursed. Rejection requires a note.
 * Verification is its own audited act — never automatic on upload.
 */
export async function verifyDisbursementEvidence(
  fileId: string,
  requestId: string,
  input: { verdict: "VERIFIED" | "REJECTED"; note?: string },
): Promise<FinanceActionResult> {
  const ctx = await financeGuard("finance:void", fileId);
  if (isErr(ctx)) return fail(ctx);
  if (input.verdict !== "VERIFIED" && input.verdict !== "REJECTED") return fail("invalid_state");
  if (input.verdict === "REJECTED" && !input.note?.trim()) return fail("reason_required");

  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (req.disbursed_by === ctx.userId) return fail("self_verification_forbidden");
  if (!canTransitionEvidence(req.evidence_status as EvidenceStatus, input.verdict)) return fail("invalid_state");

  const { data: updated, error } = await admin
    .from("finance_request")
    .update({
      evidence_status: input.verdict,
      evidence_verified_by: ctx.userId,
      evidence_verified_at: new Date().toISOString(),
      evidence_note: input.note?.trim() || null,
    })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .eq("evidence_status", "SUBMITTED") // CAS
    .select("id");
  if (error || !updated || updated.length === 0) return fail("invalid_state");

  await writeAudit({
    action: AuditActions.FINANCE_EVIDENCE_VERIFIED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    after: { verdict: input.verdict, category: req.category },
  });
  return { ok: true, id: requestId };
}

// ======================================= step 25: billable conversion seam ====

/**
 * Convert a DISBURSED, REIMBURSABLE request into a customer billing charge —
 * the EXISTING billing_charge → invoice_line → invoice chain takes it from
 * there (numbering, totals, PDF, validation, issue: all untouched). Explicit
 * and idempotent (billing_charge_id set once); a non-reimbursable request can
 * never become an invoice item. This action never touches the invoice table
 * and never marks anything paid.
 */
export async function convertRequestToCharge(fileId: string, requestId: string): Promise<FinanceActionResult> {
  const ctx = await financeGuard("finance:create", fileId);
  if (isErr(ctx)) return fail(ctx);

  const admin = getAdminSupabaseClient();
  const req = await loadRequest(admin, ctx.tenantId, fileId, requestId);
  if (!req) return fail("not_found");
  if (req.billing_charge_id) return { ok: true, id: req.billing_charge_id }; // idempotent
  if (req.status !== "DISBURSED") return fail("invalid_state");
  if (!req.reimbursable) return fail("not_reimbursable");

  const { data: charge, error } = await admin
    .from("billing_charge")
    .insert({
      tenant_id: ctx.tenantId,
      file_id: fileId,
      description: `${financeCategoryLabelFr(req.category)} — ${req.purpose}`,
      quantity: 1,
      unit_amount: req.disbursed_amount ?? req.amount,
      tax_rate: 0,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !charge) return fail("invalid_state");

  const { data: linked } = await admin
    .from("finance_request")
    .update({ billing_charge_id: charge.id })
    .eq("id", requestId)
    .eq("tenant_id", ctx.tenantId)
    .is("billing_charge_id", null) // CAS — a concurrent conversion loses
    .select("id");
  if (!linked || linked.length === 0) {
    // Lost the race: remove the orphan charge, return the winner's link.
    await admin.from("billing_charge").update({ deleted_at: new Date().toISOString() }).eq("id", charge.id).eq("tenant_id", ctx.tenantId);
    const again = await loadRequest(admin, ctx.tenantId, fileId, requestId);
    return again?.billing_charge_id ? { ok: true, id: again.billing_charge_id } : fail("invalid_state");
  }

  await writeAudit({
    action: AuditActions.FINANCE_REQUEST_BILLED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "finance_request",
    entityId: requestId,
    after: { billing_charge_id: charge.id, amount: req.disbursed_amount ?? req.amount, category: req.category },
  });
  return { ok: true, id: charge.id };
}

// ================================================== step 26: clearance ====

/**
 * Financial clearance: an explicit, audited statement that Finance's work on
 * this dossier is complete — evaluated by the PURE rule, never assumed. It
 * does NOT complete delivery, transfer ownership, settle the customer account
 * or clear customs. The workflow output is the engine's EXISTING handoff
 * (gainde_registration → coordinator_to_declarant, the registry's canonical
 * Finance → next-team transition); when the actor lacks the handoff
 * permission, the Coordinator is notified to perform the reception instead.
 */
export async function clearFinance(
  fileId: string,
  opts?: { invoiceIntentionallyDeferred?: boolean; deferralReason?: string },
): Promise<FinanceActionResult<{ id: string; handoffSent: boolean }>> {
  const ctx = await financeGuard("finance:validate", fileId);
  if (isErr(ctx)) return fail(ctx) as FinanceActionResult<{ id: string; handoffSent: boolean }>;
  // An explicit deferral is a recorded judgement — it needs a reason.
  if (opts?.invoiceIntentionallyDeferred && !opts.deferralReason?.trim()) {
    return fail("reason_required") as FinanceActionResult<{ id: string; handoffSent: boolean }>;
  }

  const admin = getAdminSupabaseClient();
  const file = await loadFile(admin, ctx.tenantId, fileId);
  if (!file) return fail("not_found") as FinanceActionResult<{ id: string; handoffSent: boolean }>;

  const clearance = await evaluateClearanceLive(admin, ctx.tenantId, fileId, opts?.invoiceIntentionallyDeferred === true);
  if (!clearance.ready) {
    return { ok: false, error: "clearance_not_ready", missing: [...clearance.missing] };
  }

  await writeAudit({
    action: AuditActions.FINANCE_CLEARED,
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    entity: "operational_file",
    entityId: fileId,
    after: {
      invoice_deferred: opts?.invoiceIntentionallyDeferred === true,
      deferral_reason: opts?.deferralReason?.trim() || null,
    },
  });

  // The explicit workflow handoff — the engine enforces its own permission; a
  // refusal degrades to a Coordinator notification, never a silent success claim.
  let handoffSent = false;
  try {
    const sent = await sendHandoff(fileId, "gainde_registration", "coordinator_to_declarant");
    handoffSent = sent.ok;
  } catch {
    handoffSent = false;
  }
  if (!handoffSent) {
    await notifyRoles(ctx, fileId, ["COORDINATOR", "OPS_SUPERVISOR"],
      "Feu vert financier accordé", "La Finance a terminé son intervention sur le dossier ; la suite du circuit peut reprendre.");
  }

  return { ok: true, id: fileId, handoffSent };
}

// ================================================================ read side ====

export type FinanceRequestView = {
  id: string;
  category: string;
  categoryLabel: string;
  amount: number;
  currency: string;
  purpose: string;
  beneficiary: string;
  reimbursable: boolean;
  status: FinanceRequestStatus;
  evidenceStatus: EvidenceStatus;
  requestedByName: string;
  reviewedByName: string | null;
  disbursedByName: string | null;
  disbursedAmount: number | null;
  disbursementMethod: string | null;
  disbursementReference: string | null;
  reviewNote: string | null;
  billed: boolean;
};

export type FinanceState = {
  fileNumber: string;
  requests: FinanceRequestView[];
  clearance: ClearanceResult;
  invoiceState: "none" | "draft" | "validated" | "issued";
  openFinanceBlockers: number;
  pendingPaymentDecision: boolean;
  /** Dossier documents usable as payment evidence (for the attach picker). */
  evidenceDocuments: { id: string; label: string }[];
};

/** Read-side finance state. Returns null when dark / table absent / error. */
export async function getFinanceState(fileId: string): Promise<FinanceState | null> {
  const ctx = await financeGuard("finance:read", fileId);
  if (isErr(ctx)) return null;
  const admin = getAdminSupabaseClient();

  try {
    const file = await loadFile(admin, ctx.tenantId, fileId);
    if (!file) return null;

    const { data: reqRows, error: reqError } = await admin
      .from("finance_request")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("file_id", fileId)
      .order("requested_at", { ascending: true });
    if (reqError) return null; // table absent (migration not applied) — degrade

    const requests = reqRows ?? [];

    // Batch display names (never shown as UUIDs).
    const userIds = [
      ...new Set(
        requests.flatMap((r) => [r.requested_by, r.reviewed_by, r.disbursed_by]).filter((v): v is string => Boolean(v)),
      ),
    ];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users } = await admin
        .from("app_user")
        .select("id, name, email")
        .eq("tenant_id", ctx.tenantId)
        .in("id", userIds)
        .returns<{ id: string; name: string | null; email: string }[]>();
      for (const u of users ?? []) names.set(u.id, u.name?.trim() || u.email);
    }

    // Invoice state (existing chain; read-only).
    const { data: invoices } = await admin
      .from("invoice")
      .select("status")
      .eq("tenant_id", ctx.tenantId)
      .eq("file_id", fileId)
      .returns<{ status: string }[]>();
    const invStatuses = (invoices ?? []).map((i) => i.status);
    const invoiceState: FinanceState["invoiceState"] = invStatuses.some((s) =>
      ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(s),
    )
      ? "issued"
      : invStatuses.includes("VALIDATED")
        ? "validated"
        : invStatuses.includes("DRAFT")
          ? "draft"
          : "none";

    // Finance blockers + pending payment decision (9.0B tables — tolerate absence).
    let openFinanceBlockers = 0;
    let pendingPaymentDecision = false;
    try {
      const { data: instance } = await admin
        .from("process_instance")
        .select("id, tenant_id")
        .eq("file_id", fileId)
        .eq("tenant_id", ctx.tenantId)
        .neq("status", "CANCELLED")
        .maybeSingle();
      if (instance) {
        const { data: blockers } = await admin
          .from("process_blocker")
          .select("id")
          .eq("tenant_id", ctx.tenantId)
          .eq("process_instance_id", instance.id)
          .in("status", ["OPEN", "ACKNOWLEDGED"])
          .in("category", [...FINANCE_BLOCKER_CATEGORIES])
          .returns<{ id: string }[]>();
        openFinanceBlockers = blockers?.length ?? 0;
        const { data: decisions } = await admin
          .from("process_decision")
          .select("id")
          .eq("tenant_id", ctx.tenantId)
          .eq("process_instance_id", instance.id)
          .eq("decision_type", "CONTINUE_BEFORE_PAYMENT")
          .eq("status", "PENDING")
          .returns<{ id: string }[]>();
        pendingPaymentDecision = (decisions?.length ?? 0) > 0;
      }
    } catch {
      // 9.0B structures absent — clearance still evaluates on what exists.
    }

    // Evidence-capable documents on the dossier (financial proofs + other).
    const { data: docs } = await admin
      .from("document")
      .select("id, type_code, title")
      .eq("tenant_id", ctx.tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null)
      .in("type_code", ["PAYMENT_RECEIPT", "PROOF_OF_DEPOSIT", "OTHER"])
      .returns<{ id: string; type_code: string; title: string | null }[]>();

    const clearance = evaluateFinancialClearance({
      requests: requests.map((r) => ({
        status: r.status as FinanceRequestStatus,
        evidenceStatus: r.evidence_status as EvidenceStatus,
      })),
      openFinanceBlockers,
      pendingPaymentDecision,
      invoiceState,
      invoiceIntentionallyDeferred: false,
    });

    return {
      fileNumber: file.file_number,
      requests: requests.map((r) => ({
        id: r.id,
        category: r.category,
        categoryLabel: financeCategoryLabelFr(r.category),
        amount: Number(r.amount),
        currency: r.currency,
        purpose: r.purpose,
        beneficiary: r.beneficiary,
        reimbursable: r.reimbursable,
        status: r.status as FinanceRequestStatus,
        evidenceStatus: r.evidence_status as EvidenceStatus,
        requestedByName: names.get(r.requested_by) ?? "—",
        reviewedByName: r.reviewed_by ? (names.get(r.reviewed_by) ?? "—") : null,
        disbursedByName: r.disbursed_by ? (names.get(r.disbursed_by) ?? "—") : null,
        disbursedAmount: r.disbursed_amount === null ? null : Number(r.disbursed_amount),
        disbursementMethod: r.disbursement_method,
        disbursementReference: r.disbursement_reference,
        reviewNote: r.review_note,
        billed: Boolean(r.billing_charge_id),
      })),
      clearance,
      invoiceState,
      openFinanceBlockers,
      pendingPaymentDecision,
      evidenceDocuments: (docs ?? []).map((d) => ({
        id: d.id,
        label: d.title?.trim() || d.type_code,
      })),
    };
  } catch {
    return null; // migration absent / transient failure — the panel simply hides
  }
}

/** Live clearance evaluation shared by clearFinance. */
async function evaluateClearanceLive(
  admin: Admin,
  tenantId: string,
  fileId: string,
  invoiceIntentionallyDeferred: boolean,
): Promise<ClearanceResult> {
  const { data: reqRows } = await admin
    .from("finance_request")
    .select("status, evidence_status")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .returns<{ status: string; evidence_status: string }[]>();

  const { data: invoices } = await admin
    .from("invoice")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .returns<{ status: string }[]>();
  const invStatuses = (invoices ?? []).map((i) => i.status);
  const invoiceState = invStatuses.some((s) => ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(s))
    ? ("issued" as const)
    : invStatuses.includes("VALIDATED")
      ? ("validated" as const)
      : invStatuses.includes("DRAFT")
        ? ("draft" as const)
        : ("none" as const);

  let openFinanceBlockers = 0;
  let pendingPaymentDecision = false;
  try {
    const { data: instance } = await admin
      .from("process_instance")
      .select("id, tenant_id")
      .eq("file_id", fileId)
      .eq("tenant_id", tenantId)
      .neq("status", "CANCELLED")
      .maybeSingle();
    if (instance) {
      const { data: blockers } = await admin
        .from("process_blocker")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("process_instance_id", instance.id)
        .in("status", ["OPEN", "ACKNOWLEDGED"])
        .in("category", [...FINANCE_BLOCKER_CATEGORIES])
        .returns<{ id: string }[]>();
      openFinanceBlockers = blockers?.length ?? 0;
      const { data: decisions } = await admin
        .from("process_decision")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("process_instance_id", instance.id)
        .eq("decision_type", "CONTINUE_BEFORE_PAYMENT")
        .eq("status", "PENDING")
        .returns<{ id: string }[]>();
      pendingPaymentDecision = (decisions?.length ?? 0) > 0;
    }
  } catch {
    /* 9.0B structures absent */
  }

  return evaluateFinancialClearance({
    requests: (reqRows ?? []).map((r) => ({
      status: r.status as FinanceRequestStatus,
      evidenceStatus: r.evidence_status as EvidenceStatus,
    })),
    openFinanceBlockers,
    pendingPaymentDecision,
    invoiceState,
    invoiceIntentionallyDeferred,
  });
}

// ================================================================ helpers ====

/** Notify active holders of any of the given roles (best-effort, never the actor). */
async function notifyRoles(ctx: Ctx, fileId: string, roleCodes: string[], title: string, body: string) {
  const admin = getAdminSupabaseClient();
  const { data: roleRows } = await admin
    .from("role").select("id").eq("tenant_id", ctx.tenantId).in("code", roleCodes)
    .returns<{ id: string }[]>();
  const roleIds = (roleRows ?? []).map((r) => r.id);
  if (roleIds.length === 0) return;
  const { data: userRoles } = await admin
    .from("user_role").select("user_id").eq("tenant_id", ctx.tenantId).in("role_id", roleIds)
    .returns<{ user_id: string }[]>();
  const recipientIds = [...new Set((userRoles ?? []).map((u) => u.user_id))].filter((id) => id !== ctx.userId);
  if (recipientIds.length === 0) return;
  const { data: active } = await admin
    .from("app_user").select("id").in("id", recipientIds).eq("tenant_id", ctx.tenantId).eq("status", "active")
    .returns<{ id: string }[]>();
  const { data: fileRow } = await admin
    .from("operational_file").select("file_number").eq("id", fileId).eq("tenant_id", ctx.tenantId).maybeSingle();
  for (const r of active ?? []) {
    await createNotification({
      tenantId: ctx.tenantId,
      userId: r.id,
      type: "FILE_ASSIGNED",
      fileId,
      title: `${title} — ${fileRow?.file_number ?? ""}`.trim(),
      body,
    });
  }
}
