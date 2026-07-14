/**
 * Official billing workflow — PURE state core (Phase 5.0D-2). No I/O.
 * ---------------------------------------------------------------------------
 * Official steps 20-22: Billing drafts -> Finance validates -> Billing emails.
 *
 * REUSES the existing invoice row. There is no second invoice, approval or email
 * system. The official states are expressed on the invoice we already have:
 *
 *   DRAFT, submitted_at = null      the maker is still preparing it
 *   DRAFT, submitted_at set         SUBMITTED — awaiting an independent checker
 *   VALIDATED                       the checker approved it (step 21 done)
 *   ISSUED                          successfully EMAILED to the client (step 22)
 *   rejection_reason set + revision++   sent back for correction
 *
 * Why VALIDATED -> ISSUED only on a successful send: the client portal's RLS only
 * exposes ISSUED/PARTIALLY_PAID/PAID invoices. Keeping a validated-but-unsent
 * invoice at VALIDATED therefore means the client cannot see an invoice that has
 * not actually been sent to them — the privacy rule falls out of the state model
 * instead of needing a separate guard.
 */
import type { InvoiceStatus } from "@/lib/finance/types";

/** Sanitized, specific errors. Never leak provider details or invoice contents. */
export type BillingError =
  | "feature_disabled"
  | "forbidden"
  | "cross_tenant_forbidden"
  | "dossier_not_billing_ready"
  | "invoice_missing"
  | "invoice_not_submittable"
  | "invoice_not_editable"
  | "duplicate_submission"
  | "invoice_not_awaiting_validation"
  | "self_approval_forbidden"
  | "validation_reason_required"
  | "invoice_not_validated"
  | "billing_contact_missing"
  | "email_send_failed"
  | "no_lines";

export const BILLING_ERROR_FR: Record<BillingError, string> = {
  feature_disabled: "Le moteur de processus est désactivé.",
  forbidden: "Action non autorisée.",
  cross_tenant_forbidden: "Action non autorisée.",
  dossier_not_billing_ready:
    "Le dossier n'est pas prêt à facturer : les contrôles de complétude (Coordinateur puis Account Manager) doivent être validés.",
  invoice_missing: "Aucune facture pour ce dossier.",
  invoice_not_submittable: "Cette facture ne peut pas être soumise dans son état actuel.",
  invoice_not_editable:
    "Cette facture ne peut plus être modifiée : elle est en attente de validation ou déjà validée.",
  duplicate_submission: "Cette facture a déjà été soumise à la Finance.",
  invoice_not_awaiting_validation: "Cette facture n'est pas en attente de validation.",
  self_approval_forbidden:
    "Vous ne pouvez pas valider une facture que vous avez vous-même établie. Un contrôleur indépendant est requis.",
  validation_reason_required: "Un motif de rejet est obligatoire.",
  invoice_not_validated: "La facture doit être validée par la Finance avant d'être envoyée au client.",
  billing_contact_missing: "Aucun contact de facturation pour ce client.",
  email_send_failed: "L'envoi de la facture a échoué. Vous pouvez réessayer.",
  no_lines: "La facture ne contient aucune ligne.",
};

/** The invoice facts the pure predicates need. */
export type InvoiceView = {
  id: string;
  status: InvoiceStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  rejectionReason: string | null;
  revision: number;
  lineCount: number;
};

/** Awaiting an independent checker: drafted AND submitted, not yet validated. */
export function isAwaitingValidation(inv: InvoiceView): boolean {
  return inv.status === "DRAFT" && inv.submittedAt !== null && inv.validatedAt === null;
}

/** Still being prepared (or sent back for correction). */
export function isEditableDraft(inv: InvoiceView): boolean {
  return inv.status === "DRAFT" && inv.submittedAt === null;
}

/**
 * May the maker still change the invoice?
 *
 * NO once it is submitted: otherwise a maker could edit after submitting and the
 * checker would approve something different from what they reviewed. A rejection
 * CLEARS submitted_at, which is what reopens the draft for correction.
 */
export function canEditOfficialInvoice(inv: InvoiceView): boolean {
  return isEditableDraft(inv);
}

/** Submittable: an editable draft that actually has lines. */
export function canSubmitInvoice(inv: InvoiceView): { ok: boolean; error?: BillingError } {
  if (inv.status === "VALIDATED" || inv.status === "ISSUED") {
    return { ok: false, error: "duplicate_submission" };
  }
  if (isAwaitingValidation(inv)) return { ok: false, error: "duplicate_submission" };
  if (!isEditableDraft(inv)) return { ok: false, error: "invoice_not_submittable" };
  if (inv.lineCount <= 0) return { ok: false, error: "no_lines" };
  return { ok: true };
}

/**
 * May `checkerId` validate this invoice?
 *
 * MAKER != CHECKER, enforced on IDENTITY — not on permission. OPS_SUPERVISOR and
 * SYSTEM_ADMIN deliberately hold BOTH finance:create and finance:validate (a
 * supervisor may act in either capacity), and they are still refused here when
 * they are the maker. There is no override: `process:override` governs the
 * PROCESS engine's maker-checker seam and is granted to no role; the invoice
 * checker rule has no escape hatch at all.
 */
export function canValidateInvoice(
  inv: InvoiceView,
  checkerId: string,
): { ok: boolean; error?: BillingError } {
  if (!isAwaitingValidation(inv)) return { ok: false, error: "invoice_not_awaiting_validation" };
  if (inv.submittedBy && inv.submittedBy === checkerId) {
    return { ok: false, error: "self_approval_forbidden" };
  }
  return { ok: true };
}

export const MAX_REJECTION_REASON = 500;

export function validateRejectionReason(reason: string | null | undefined): {
  ok: boolean;
  error?: BillingError;
  value?: string;
} {
  const v = (reason ?? "").trim();
  if (v.length === 0) return { ok: false, error: "validation_reason_required" };
  return { ok: true, value: v.slice(0, MAX_REJECTION_REASON) };
}

/** Only a validated invoice may be emailed to the client. */
export function canEmailInvoice(inv: InvoiceView): { ok: boolean; error?: BillingError } {
  if (inv.status !== "VALIDATED") return { ok: false, error: "invoice_not_validated" };
  return { ok: true };
}

/**
 * The Billing/Finance queue state for one dossier. Derived — never stored.
 * Drives both the Billing queue and the Finance validation queue.
 */
export type BillingQueueState =
  | "billing_ready"
  | "draft_missing"
  | "draft_in_progress"
  | "submitted_for_validation"
  | "correction_required"
  | "approved_ready_to_email"
  | "emailed"
  | "email_failed_retry";

export type EmailState = "none" | "queued" | "sent" | "failed";

export function billingQueueState(
  inv: InvoiceView | null,
  billingReady: boolean,
  email: EmailState,
): BillingQueueState {
  if (!inv) return billingReady ? "draft_missing" : "billing_ready";
  if (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID" || inv.status === "PAID") {
    return "emailed";
  }
  if (inv.status === "VALIDATED") {
    return email === "failed" ? "email_failed_retry" : "approved_ready_to_email";
  }
  if (isAwaitingValidation(inv)) return "submitted_for_validation";
  // A draft carrying a rejection reason is a correction, not a fresh draft.
  if (inv.rejectionReason) return "correction_required";
  return "draft_in_progress";
}
