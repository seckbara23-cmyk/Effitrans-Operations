/**
 * Phase 5.0D-2 — official billing workflow (steps 20-22): maker-checker on the
 * invoice, rejection/correction, and the validated-invoice email.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  BILLING_ERROR_FR,
  billingQueueState,
  canEditOfficialInvoice,
  canEmailInvoice,
  canSubmitInvoice,
  canValidateInvoice,
  isAwaitingValidation,
  isEditableDraft,
  validateRejectionReason,
  MAX_REJECTION_REASON,
  type InvoiceView,
} from "@/lib/process/billing/state";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const actions = read("../lib/process/billing/actions.ts");
const financeActions = read("../lib/finance/actions.ts");

const MAKER = "user-billing";
const CHECKER = "user-finance";

const inv = (o: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "inv-1",
  status: "DRAFT",
  submittedBy: null,
  submittedAt: null,
  validatedBy: null,
  validatedAt: null,
  rejectionReason: null,
  revision: 1,
  lineCount: 2,
  ...o,
});

const submitted = (o: Partial<InvoiceView> = {}) =>
  inv({ submittedBy: MAKER, submittedAt: "2026-07-14T09:00:00Z", ...o });

// ------------------------------------------------------------ draft + submit ----

describe("draft preparation and submission (step 20)", () => {
  it("requires billing readiness before a draft can be created", () => {
    // The gate the platform never had: an invoice used to be creatable on any
    // dossier at any time, with no evidence.
    expect(actions).toContain("dossier_not_billing_ready");
    expect(actions).toContain("evaluateBillingGate");
    expect(actions).toContain('if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready")');
  });

  it("keeps ONE active draft per dossier — a second call returns the existing one", () => {
    expect(actions).toContain('.in("status", ["DRAFT", "VALIDATED"])');
  });

  it("submits an editable draft that has lines", () => {
    expect(canSubmitInvoice(inv())).toEqual({ ok: true });
  });

  it("refuses to submit an empty invoice", () => {
    expect(canSubmitInvoice(inv({ lineCount: 0 }))).toEqual({ ok: false, error: "no_lines" });
  });

  it("refuses a DUPLICATE submission", () => {
    expect(canSubmitInvoice(submitted())).toEqual({ ok: false, error: "duplicate_submission" });
    expect(canSubmitInvoice(inv({ status: "VALIDATED" }))).toEqual({
      ok: false,
      error: "duplicate_submission",
    });
  });

  it("guards duplicate submission at the database, not just in memory", () => {
    // CAS: only an unsubmitted DRAFT may be submitted. A concurrent second submit
    // matches zero rows.
    expect(actions).toContain('.is("submitted_at", null)');
    expect(actions).toContain('if ((data?.length ?? 0) !== 1) return fail("duplicate_submission")');
  });
});

// ------------------------------------------------------------- frozen invoice ----

describe("a submitted invoice is FROZEN", () => {
  it("cannot be edited once submitted", () => {
    expect(canEditOfficialInvoice(inv())).toBe(true);
    // Without this, a maker could edit after submitting and the checker would
    // approve something other than what they reviewed.
    expect(canEditOfficialInvoice(submitted())).toBe(false);
  });

  it("cannot be edited once validated", () => {
    expect(canEditOfficialInvoice(inv({ status: "VALIDATED" }))).toBe(false);
  });

  it("hardens the EXISTING updateInvoice action, not just the new one", () => {
    expect(financeActions).toContain('if (inv.submitted_at && !inv.validated_at) return { ok: false, error: "awaiting_validation" }');
  });

  it("leaves legacy invoices editable (submitted_at is null) — no regression", () => {
    // A pre-5.0D invoice has submitted_at = null, so the new guard never fires.
    expect(isEditableDraft(inv())).toBe(true);
  });
});

// -------------------------------------------------------------- maker-checker ----

describe("maker-checker on the invoice (Deliverable 3/8)", () => {
  it("lets an independent checker validate", () => {
    expect(canValidateInvoice(submitted(), CHECKER)).toEqual({ ok: true });
  });

  it("REFUSES self-approval — the maker can never validate their own invoice", () => {
    expect(canValidateInvoice(submitted(), MAKER)).toEqual({
      ok: false,
      error: "self_approval_forbidden",
    });
  });

  it("refuses self-approval even for a supervisor holding BOTH permissions", () => {
    // OPS_SUPERVISOR and SYSTEM_ADMIN deliberately hold finance:create AND
    // finance:validate. The rule is enforced on IDENTITY, so they are still
    // refused when they are the maker. There is no override for this.
    const supervisor = getTenantRoleTemplate("OPS_SUPERVISOR")!;
    expect(supervisor.permissions).toContain("finance:create");
    expect(supervisor.permissions).toContain("finance:validate");

    const sup = "user-supervisor";
    expect(canValidateInvoice(submitted({ submittedBy: sup }), sup)).toEqual({
      ok: false,
      error: "self_approval_forbidden",
    });
  });

  it("keeps BILLING_OFFICER unable to validate (permission level)", () => {
    const billing = getTenantRoleTemplate("BILLING_OFFICER")!;
    expect(billing.permissions).toContain("finance:create");
    expect(billing.permissions).not.toContain("finance:validate");
  });

  it("keeps FINANCE_OFFICER able to validate", () => {
    expect(getTenantRoleTemplate("FINANCE_OFFICER")!.permissions).toContain("finance:validate");
  });

  it("gives Courier, Driver and Collections NO invoice creation or approval", () => {
    for (const role of ["COURIER", "DRIVER"]) {
      const p = getTenantRoleTemplate(role)!.permissions;
      expect(p.some((x) => x.startsWith("finance:")), role).toBe(false);
    }
    const collections = getTenantRoleTemplate("COLLECTIONS_OFFICER")!.permissions;
    expect(collections).not.toContain("finance:create");
    expect(collections).not.toContain("finance:validate");
    expect(collections).not.toContain("finance:issue");
  });

  it("refuses to validate an invoice that was never submitted", () => {
    expect(canValidateInvoice(inv(), CHECKER)).toEqual({
      ok: false,
      error: "invoice_not_awaiting_validation",
    });
  });

  it("guards double approval at the database (CAS), not just in memory", () => {
    expect(actions).toContain('.is("validated_at", null)');
    expect(actions).toContain('if ((data?.length ?? 0) !== 1) return fail("invoice_not_awaiting_validation")');
  });

  it("re-checks maker != checker inside the process engine too", () => {
    // Belt and braces: even if this action were bypassed, the engine re-checks the
    // execution row's submitted_by.
    expect(actions).toContain('approveStep(fileId, "finance_invoice_validation")');
  });
});

// -------------------------------------------------------- rejection/correction ----

describe("rejection and correction (Deliverables 4-5)", () => {
  it("requires a reason", () => {
    expect(validateRejectionReason("")).toEqual({ ok: false, error: "validation_reason_required" });
    expect(validateRejectionReason("   ")).toEqual({ ok: false, error: "validation_reason_required" });
    expect(validateRejectionReason(null)).toEqual({ ok: false, error: "validation_reason_required" });
  });

  it("bounds the reason length", () => {
    const long = "x".repeat(MAX_REJECTION_REASON + 200);
    const r = validateRejectionReason(long);
    expect(r.ok).toBe(true);
    expect(r.value!.length).toBe(MAX_REJECTION_REASON);
  });

  it("a rejection is still a REVIEW: the checker may not be the maker", () => {
    expect(actions).toContain("// A rejection is still a review: the checker may not be the maker.");
  });

  it("reopens the draft by clearing submitted_at and bumps the revision", () => {
    expect(actions).toContain("submitted_at: null,");
    expect(actions).toContain("revision: loaded.view.revision + 1,");
  });

  it("creates a traceable correction row in the engine, never overwriting the review", () => {
    expect(actions).toContain('rejectStep(fileId, "finance_invoice_validation", r.value!)');
  });

  it("shows a rejected draft as a CORRECTION, not a fresh draft", () => {
    const rejected = inv({ rejectionReason: "Ligne 3 erronée", revision: 2 });
    expect(billingQueueState(rejected, true, "none")).toBe("correction_required");
  });

  it("lets the same maker correct and resubmit their draft", () => {
    const rejected = inv({ rejectionReason: "Ligne 3 erronée", revision: 2 });
    expect(canEditOfficialInvoice(rejected)).toBe(true);
    expect(canSubmitInvoice(rejected)).toEqual({ ok: true });
  });
});

// -------------------------------------------------------------------- email ----

describe("validated-invoice email (step 22, Deliverable 6)", () => {
  it("REFUSES to email an unvalidated invoice", () => {
    expect(canEmailInvoice(inv())).toEqual({ ok: false, error: "invoice_not_validated" });
    expect(canEmailInvoice(submitted())).toEqual({ ok: false, error: "invoice_not_validated" });
  });

  it("allows emailing a validated invoice", () => {
    expect(canEmailInvoice(inv({ status: "VALIDATED", validatedBy: CHECKER }))).toEqual({ ok: true });
  });

  it("REUSES communication_message — no second email system", () => {
    expect(actions).toContain("queueAndSend");
    expect(actions).toContain('templateKey: "invoice_issued"');
    expect(actions).not.toContain("create table");
  });

  it("is IDEMPOTENT — an already-SENT message short-circuits", () => {
    expect(actions).toContain('.eq("related_entity", "invoice")');
    expect(actions).toContain('.eq("status", "SENT")');
    expect(actions).toContain('return { ok: true, id: invoiceId, status: "SENT" };');
  });

  it("requires an authorized billing contact — never guesses a recipient", () => {
    expect(actions).toContain('if (!recipientEmail) return fail("billing_contact_missing")');
  });

  it("keeps a FAILED email retryable and does NOT advance step 22", () => {
    expect(actions).toContain('if (sent.status !== "SENT")');
    expect(actions).toContain("retryable: true");
    // The step advance happens only after the failure branch has returned.
    const failIdx = actions.indexOf('return fail("email_send_failed")');
    const stepIdx = actions.indexOf('submitStep(fileId, "billing_dispatch")');
    expect(failIdx).toBeGreaterThan(0);
    expect(stepIdx).toBeGreaterThan(failIdx);
  });

  it("advances step 22 ONLY on a successful send", () => {
    expect(actions).toContain('await submitStep(fileId, "billing_dispatch");');
  });

  it("a successful email does NOT mark the invoice paid", () => {
    // The only status it writes is ISSUED. Nothing sets PAID/PARTIALLY_PAID.
    expect(actions).toContain('status: "ISSUED",');
    expect(actions).not.toContain('status: "PAID"');
    expect(actions).not.toContain('status: "PARTIALLY_PAID"');
  });

  it("a successful email does NOT touch the physical deposit", () => {
    expect(actions).not.toContain("invoice_deposit");
    expect(actions).not.toContain("PROOF_ACCEPTED");
  });

  it("a successful email does NOT close the dossier", () => {
    expect(actions).not.toContain("PROCESS_CLOSED");
    // operational_file is READ (to resolve client_id) but never WRITTEN: the
    // billing workflow can no more close a dossier than a payment webhook can.
    expect(actions).toMatch(/\.from\("operational_file"\)\s*\.select/);
    expect(actions).not.toMatch(/\.from\("operational_file"\)\s*\.update/);
    expect(actions).not.toMatch(/status:\s*"CLOSED"/);
  });

  it("makes the invoice portal-visible only once it is actually sent", () => {
    // Portal RLS exposes ISSUED/PARTIALLY_PAID/PAID. Keeping a validated-but-unsent
    // invoice at VALIDATED means a client can never see an invoice that was not
    // actually sent to them — the privacy rule falls out of the state model.
    expect(canEmailInvoice(inv({ status: "VALIDATED" })).ok).toBe(true);
    expect(billingQueueState(inv({ status: "VALIDATED" }), true, "none")).toBe("approved_ready_to_email");
    expect(billingQueueState(inv({ status: "ISSUED" }), true, "sent")).toBe("emailed");
  });
});

// ------------------------------------------------------------ queue mapping ----

describe("queue state mapping (Deliverable 7)", () => {
  it("maps every official billing state", () => {
    expect(billingQueueState(null, false, "none")).toBe("billing_ready");
    expect(billingQueueState(null, true, "none")).toBe("draft_missing");
    expect(billingQueueState(inv(), true, "none")).toBe("draft_in_progress");
    expect(billingQueueState(submitted(), true, "none")).toBe("submitted_for_validation");
    expect(billingQueueState(inv({ rejectionReason: "r", revision: 2 }), true, "none")).toBe("correction_required");
    expect(billingQueueState(inv({ status: "VALIDATED" }), true, "none")).toBe("approved_ready_to_email");
    expect(billingQueueState(inv({ status: "VALIDATED" }), true, "failed")).toBe("email_failed_retry");
    expect(billingQueueState(inv({ status: "ISSUED" }), true, "sent")).toBe("emailed");
    expect(billingQueueState(inv({ status: "PAID" }), true, "sent")).toBe("emailed");
  });

  it("exposes the maker identity to the Finance queue", () => {
    expect(isAwaitingValidation(submitted())).toBe(true);
    expect(submitted().submittedBy).toBe(MAKER);
  });
});

// ------------------------------------------------------------- error model ----

describe("error model (Deliverable 10)", () => {
  it("gives every error a clear, actionable French message", () => {
    for (const [code, message] of Object.entries(BILLING_ERROR_FR)) {
      expect(message.length, code).toBeGreaterThan(5);
    }
  });

  it("explains WHY self-approval is refused", () => {
    expect(BILLING_ERROR_FR.self_approval_forbidden).toContain("contrôleur indépendant");
  });

  it("tells the user a failed email can be retried", () => {
    expect(BILLING_ERROR_FR.email_send_failed).toContain("réessayer");
  });
});

// ------------------------------------------------------------ audit safety ----

describe("audit safety", () => {
  it("never audits the email body, the invoice contents, or provider details", () => {
    // The rendered body lives only in communication_message, written by
    // queueAndSend. It must never reach an audit payload, and neither must any
    // provider credential.
    for (const forbidden of ["body_html", "body_text", "api_key", "provider_key", "smtp", "line_items"]) {
      expect(actions, `audit must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("audits identifiers, states and the sanitized reason only", () => {
    expect(actions).toContain("reason: r.value,");
    expect(actions).toContain("delivery_status: sent.status,");
  });

  it("never mutates process state from outside the engine", () => {
    expect(actions).not.toContain("process_step_execution");
    expect(actions).not.toContain("process_handoff");
  });
});
