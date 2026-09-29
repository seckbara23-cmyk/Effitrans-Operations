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
  // C-4 — the irreversible-send boundary. Step 22 must be able to COMPLETE
  // before the invoice leaves the building, and if it somehow fails afterwards
  // the caller is told the truth rather than "ok".
  | "dispatch_step_not_reached"
  | "dispatch_step_claimed_by_another"
  | "dispatch_step_not_claimable"
  | "delivered_workflow_not_advanced"
  // The business mutation committed and the workflow step did not move.
  | "step_completion_failed"
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
  dispatch_step_not_reached:
    "L'étape « Émission de la facture » n'est pas encore ouverte sur ce dossier. Rien n'a été envoyé.",
  dispatch_step_claimed_by_another:
    "L'étape « Émission de la facture » est prise en charge par un autre intervenant. Rien n'a été envoyé.",
  dispatch_step_not_claimable:
    "L'étape « Émission de la facture » n'a pas pu être ouverte. Rien n'a été envoyé.",
  // NOT a failure message and NOT a success message. The client HAS the invoice
  // and the invoice IS issued — only the dossier did not advance. Resending
  // would email the client twice and is never the remedy.
  step_completion_failed:
    "L'étape officielle n'a pas pu être mise à jour. La facture porte bien votre soumission, "
    + "mais l'étape reste ouverte : ouvrez-la et réessayez.",
  delivered_workflow_not_advanced:
    "La facture a bien été envoyée au client et émise, mais l'étape « Émission de la facture » n'a pas pu être clôturée. "
    + "Ne renvoyez pas la facture : ouvrez l'étape et clôturez-la, ou contactez un administrateur.",
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

// ------------------------------------------- the lane, as ONE pure decision ----

/**
 * Which of the three official billing steps can currently ACCEPT their act.
 *
 * Not "is the step done" — "would the transition land". `AVAILABLE -> SUBMITTED`
 * is not a legal step transition, so step 20 must be claimable or already
 * claimed for a submission to complete; step 22 is the same, which is why
 * `prepareDispatchStep` exists. A step that is PENDING, closed, or held by
 * somebody else is not open.
 */
export type LaneStepOpenness = { draftOpen: boolean; dispatchOpen: boolean };

/** What the READER holds. Three permissions, and nothing about identity. */
export type LanePermissions = { mayCreate: boolean; mayValidate: boolean; mayIssue: boolean };

export type LaneCapabilities = {
  prepare: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  issue: boolean;
};

export type LaneVerdict = {
  can: LaneCapabilities;
  /** The refusal for the act this reader is closest to; null when one is offered. */
  blockedReason: BillingError | null;
};

/**
 * What this reader may do in the billing lane RIGHT NOW — the WHOLE decision,
 * PURE (STEP20-BILLING-UI-01).
 *
 * WHY IT IS HERE AND NOT IN THE PANEL, AND NOT IN THE LOADER. A decision that
 * lives inside a server-only module cannot be executed by a unit test, so a
 * mutation to it — an unconditional `true` — passes every test in the suite.
 * That is not hypothetical: it is exactly how BILLING-BYPASS-01's ninth mutation
 * probe survived, and the fix ratified there was to extract the rule into a pure
 * function and leave the server half loading rows. This is the same shape, for
 * the same reason. `lib/process/billing/lane.ts` loads; this decides.
 *
 * IT GRANTS NOTHING. Every answer is built from the predicates directly above —
 * `canSubmitInvoice`, `canValidateInvoice`, `canEmailInvoice` — which are the
 * SAME ones the server actions re-run under their own `guard()`. A `true` here
 * means "the action would accept this today", and is used to decide what to
 * RENDER; a `false` removes a control from a screen and nothing from a server
 * action, all of which stay reachable and authoritative.
 *
 * FAILS CLOSED: no invoice, no permission, or a step that cannot accept the act
 * all answer false.
 */
export function billingLaneCapabilities(input: {
  invoice: InvoiceView | null;
  viewerId: string;
  billingReady: boolean;
  perms: LanePermissions;
  steps: LaneStepOpenness;
}): LaneVerdict {
  const { invoice, viewerId, billingReady, perms, steps } = input;
  const missing = { ok: false as const, error: "invoice_missing" as BillingError };

  const submitCheck = invoice ? canSubmitInvoice(invoice) : missing;
  const validateCheck = invoice ? canValidateInvoice(invoice, viewerId) : missing;
  const emailCheck = invoice ? canEmailInvoice(invoice) : missing;

  // The action creates a draft only when the dossier has no OPEN invoice — it
  // returns the existing row for any DRAFT or VALIDATED one rather than making a
  // second. The same condition, so the control is never an affordance that does
  // nothing: offering « Établir le brouillon » beside an invoice already under
  // Finance review is exactly that.
  const openInvoice = invoice !== null && (invoice.status === "DRAFT" || invoice.status === "VALIDATED");

  const can: LaneCapabilities = {
    prepare: perms.mayCreate && billingReady && !openInvoice && steps.draftOpen,
    submit: perms.mayCreate && billingReady && submitCheck.ok && steps.draftOpen,
    // MAKER != CHECKER is inside canValidateInvoice, on IDENTITY. Never
    // re-stated here: one rule, one place, no second opinion to drift.
    approve: perms.mayValidate && validateCheck.ok,
    reject: perms.mayValidate && validateCheck.ok,
    issue: perms.mayIssue && emailCheck.ok && steps.dispatchOpen,
  };

  let blockedReason: BillingError | null = null;
  if (!can.prepare && !can.submit && !can.approve && !can.reject && !can.issue) {
    if (perms.mayCreate && !billingReady) blockedReason = "dossier_not_billing_ready";
    else if (invoice === null) blockedReason = "invoice_missing";
    else if (perms.mayValidate && invoice.submittedAt !== null) blockedReason = validateCheck.error ?? null;
    else if (perms.mayCreate && isEditableDraft(invoice)) blockedReason = submitCheck.error ?? null;
    else if (perms.mayIssue && invoice.status === "VALIDATED" && !steps.dispatchOpen) {
      blockedReason = "dispatch_step_not_reached";
    } else if (perms.mayIssue) blockedReason = emailCheck.error ?? null;
  }

  return { can, blockedReason };
}

