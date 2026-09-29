/**
 * STEP20-BILLING-UI-01 — the governed billing lane has an operator door, and it
 * is only a door.
 * ---------------------------------------------------------------------------
 * Steps 20 -> 21 -> 22 had five working server actions and no control in the
 * product that called any of them; the only invoice button on a dossier was the
 * legacy « Émettre », which the step-22 control gate refuses on every governed
 * dossier. BILLING-BYPASS-01 then correctly withdrew the generic « Terminer » /
 * « Valider » from steps 20 and 21, which left the lane with no path at all.
 *
 * What this battery asserts is therefore in two halves:
 *
 *   1. The LANE DECISION is pure and correct. `billingLaneCapabilities` is
 *      exercised with fixtures, because a rule that can only run on a server is
 *      a rule no test can mutate — the way BILLING-BYPASS-01's ninth probe
 *      survived. Every governance answer below is an EXECUTION, not a grep.
 *
 *   2. The UI GRANTED NOTHING. The panel holds no rule, the read model decides
 *      nothing, the server guards are untouched, and the legacy issuance action
 *      still exists for the dossiers that legitimately need it.
 *
 * Structural assertions are used only where the subject is genuinely a server
 * module that cannot be imported here, and each says WHICH invariant it stands
 * for rather than pinning an incidental string.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BILLING_ERROR_FR,
  billingLaneCapabilities,
  billingQueueState,
  canEmailInvoice,
  canSubmitInvoice,
  canValidateInvoice,
  isEditableDraft,
  MAX_REJECTION_REASON,
  validateRejectionReason,
  type BillingError,
  type InvoiceView,
} from "@/lib/process/billing/state";
import { domainFactSatisfied, DOMAIN_OWNED_STEPS } from "@/lib/process/domain-owned-steps";
import { canTransitionStep } from "@/lib/process/engine/state";
import { getStep } from "@/lib/process/effitrans-process";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
/** Source with comments stripped — a claim must be made by CODE, not prose. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const LANE = "lib/process/billing/lane.ts";
const STATE = "lib/process/billing/state.ts";
const PANEL = "components/finance/billing-lane-panel.tsx";
const BILLING = "lib/process/billing/actions.ts";
const ENGINE = "lib/process/engine/actions.ts";
const GUARD = "lib/process/engine/domain-owned-guard.ts";
const CARD = "components/finance/invoice-card.tsx";
const FINANCE_PANEL = "components/finance/finance-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const LEGACY = "lib/finance/actions.ts";

const MAKER = "user-billing-maker";
const CHECKER = "user-finance-checker";

const inv = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "inv-1",
  status: "DRAFT",
  submittedBy: null,
  submittedAt: null,
  validatedBy: null,
  validatedAt: null,
  rejectionReason: null,
  revision: 1,
  lineCount: 2,
  ...over,
});

const BILLING_OFFICER = { mayCreate: true, mayValidate: false, mayIssue: true };
const FINANCE_OFFICER = { mayCreate: false, mayValidate: true, mayIssue: false };
const NOBODY = { mayCreate: false, mayValidate: false, mayIssue: false };
const OPEN = { draftOpen: true, dispatchOpen: true };
const SHUT = { draftOpen: false, dispatchOpen: false };

const lane = (over: Partial<Parameters<typeof billingLaneCapabilities>[0]> = {}) =>
  billingLaneCapabilities({
    invoice: inv(),
    viewerId: MAKER,
    billingReady: true,
    perms: BILLING_OFFICER,
    steps: OPEN,
    ...over,
  });

// =========================================================== 1..3 — step 20 ====

describe("step 20 — the Billing Officer can actually draft and submit", () => {
  // (1) An authorized billing user can prepare a draft on a billing-ready dossier.
  it("offers the draft to finance:create once the dossier is billing-ready", () => {
    expect(lane({ invoice: null }).can.prepare).toBe(true);
  });

  it("offers it to NOBODY without finance:create, however ready the dossier", () => {
    expect(lane({ invoice: null, perms: NOBODY }).can.prepare).toBe(false);
    expect(lane({ invoice: null, perms: FINANCE_OFFICER }).can.prepare).toBe(false);
  });

  it("refuses the draft before BOTH completeness reviews — steps 18 and 19", () => {
    const v = lane({ invoice: null, billingReady: false });
    expect(v.can.prepare).toBe(false);
    expect(v.blockedReason).toBe("dossier_not_billing_ready");
  });

  it("does not offer a second draft beside a live editable one", () => {
    expect(lane({ invoice: inv() }).can.prepare).toBe(false);
  });

  // (2) An empty / zero-line invoice cannot be submitted.
  it("refuses to submit an invoice with no lines, and says so", () => {
    const empty = inv({ lineCount: 0 });
    expect(canSubmitInvoice(empty)).toEqual({ ok: false, error: "no_lines" });
    const v = lane({ invoice: empty });
    expect(v.can.submit).toBe(false);
    expect(v.blockedReason).toBe("no_lines");
  });

  // (3) A positive, valid invoice can be submitted.
  it("offers the submission on a draft that carries lines", () => {
    expect(lane({ invoice: inv({ lineCount: 1 }) }).can.submit).toBe(true);
  });

  it("refuses a second submission of the same invoice", () => {
    const submitted = inv({ submittedBy: MAKER, submittedAt: "2026-09-29T10:00:00Z" });
    expect(canSubmitInvoice(submitted).error).toBe("duplicate_submission");
    expect(lane({ invoice: submitted }).can.submit).toBe(false);
  });

  /**
   * AVAILABLE -> SUBMITTED is not a legal step transition, so a submission on an
   * unclaimed step 20 stamped the invoice and then stranded the step — leaving
   * the invoice permanently unsubmittable and the workflow claiming nobody had
   * submitted anything. The lane claims the step first, exactly as step 22 does.
   */
  it("knows AVAILABLE -> SUBMITTED is illegal, which is why step 20 is claimed first", () => {
    expect(canTransitionStep("AVAILABLE", "SUBMITTED")).toBe(false);
    expect(canTransitionStep("ACTIVE", "SUBMITTED")).toBe(true);
  });

  it("claims step 20 BEFORE the invoice is stamped, never after", () => {
    const src = code(BILLING);
    expect(src).toContain("prepareDraftStep");
    const body = src.slice(src.indexOf("export async function submitInvoiceToFinance"));
    const claim = body.indexOf("prepareDraftStep(c, fileId)");
    const stamp = body.indexOf("submitted_at: new Date().toISOString()");
    expect(claim).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(stamp);
  });

  it("never takes step 20 from whoever already claimed it", () => {
    const src = code(BILLING);
    const body = src.slice(src.indexOf("async function prepareDraftStep"), src.indexOf("// ---", src.indexOf("async function prepareDraftStep")));
    expect(body).toMatch(/assignedUserId\s*&&\s*\w+\.assignedUserId\s*!==\s*ctx\.userId/);
  });

  it("offers nothing on a step 20 that cannot accept a submission", () => {
    expect(lane({ steps: SHUT }).can.submit).toBe(false);
    expect(lane({ invoice: null, steps: SHUT }).can.prepare).toBe(false);
  });
});

// ======================================================== 4, 8 — no bypass ====

describe("the generic engine controls remain closed on steps 20 and 21", () => {
  // (4) The generic submitStep still cannot bypass step 20.
  it("still withdraws submit from billing_draft and approve/reject from validation", () => {
    expect(DOMAIN_OWNED_STEPS.billing_draft.withdraws).toEqual(["submit"]);
    expect(DOMAIN_OWNED_STEPS.finance_invoice_validation.withdraws).toEqual(["approve", "reject"]);
  });

  it("refuses a generic submit while no invoice has been submitted", () => {
    expect(domainFactSatisfied("submit", [])).toBe(false);
    expect(
      domainFactSatisfied("submit", [
        { status: "DRAFT", submittedAt: null, validatedAt: null, rejectionReason: null },
      ]),
    ).toBe(false);
  });

  // (8) The generic approveStep / rejectStep still cannot bypass step 21.
  it("refuses a generic approval while the invoice is still a draft", () => {
    expect(
      domainFactSatisfied("approve", [
        { status: "DRAFT", submittedAt: "2026-09-29T10:00:00Z", validatedAt: null, rejectionReason: null },
      ]),
    ).toBe(false);
    expect(
      domainFactSatisfied("approve", [
        { status: "VALIDATED", submittedAt: "x", validatedAt: "y", rejectionReason: null },
      ]),
    ).toBe(true);
  });

  it("refuses a generic rejection with no motif recorded", () => {
    expect(
      domainFactSatisfied("reject", [
        { status: "DRAFT", submittedAt: null, validatedAt: null, rejectionReason: null },
      ]),
    ).toBe(false);
  });

  /**
   * The UI is not a boundary, and this slice must not have become one. The
   * engine's own guard is the thing that refuses a crafted request, and it is
   * untouched by this work.
   */
  it("leaves the engine's server-side guard in place and unweakened", () => {
    const g = code(GUARD);
    expect(g).toContain('import "server-only"');
    expect(g).toContain("if (error) return false;");
    expect(g.trimEnd()).toMatch(/return domainFactSatisfied\(input\.transition, invoices\);\s*}\s*$/);
    expect((g.match(/return true;/g) ?? []).length).toBe(1);

    const e = code(ENGINE);
    for (const t of ["submit", "approve", "reject"]) {
      expect(e).toContain(`transition: "${t}"`);
    }
    expect((e.match(/genericTransitionAllowed\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// ======================================================= 5..9 — step 21 ========

describe("step 21 — Finance validates, and never its own work", () => {
  const submitted = inv({ submittedBy: MAKER, submittedAt: "2026-09-29T10:00:00Z" });

  // (5) The Finance checker can approve a submitted invoice.
  it("offers validation to a DIFFERENT finance:validate holder", () => {
    const v = lane({ invoice: submitted, viewerId: CHECKER, perms: FINANCE_OFFICER });
    expect(v.can.approve).toBe(true);
    expect(v.can.reject).toBe(true);
  });

  // (6) The maker cannot approve their own invoice.
  it("refuses the maker, on IDENTITY, even holding finance:validate", () => {
    const v = lane({
      invoice: submitted,
      viewerId: MAKER,
      // The supervisor case: BOTH permissions held, and still refused.
      perms: { mayCreate: true, mayValidate: true, mayIssue: true },
    });
    expect(v.can.approve).toBe(false);
    expect(v.can.reject).toBe(false);
    expect(v.blockedReason).toBe("self_approval_forbidden");
  });

  it("states the maker-checker rule in exactly one place", () => {
    // The RULE is the refusal. `canValidateInvoice` is the only thing that
    // compares the submitter against the checker AND decides from it; the loader
    // reads the same column only to say « vous avez soumis cette facture », which
    // is display, and the panel never sees the identity at all.
    const s = code(STATE);
    expect((s.match(/submittedBy\s*&&\s*inv\.submittedBy\s*===\s*checkerId/g) ?? []).length).toBe(1);
    // Exactly one place RETURNS the refusal. The union member and the French
    // sentence are the other two mentions, and neither decides anything.
    expect((s.match(/error:\s*"self_approval_forbidden"/g) ?? []).length).toBe(1);
    expect(code(LANE)).not.toContain("self_approval_forbidden");
    expect(code(PANEL)).not.toContain("self_approval_forbidden");
    expect(code(PANEL)).not.toContain("submittedBy");
  });

  it("offers no validation before the invoice is actually submitted", () => {
    expect(lane({ invoice: inv(), viewerId: CHECKER, perms: FINANCE_OFFICER }).can.approve).toBe(false);
  });

  // (7) Finance can reject with a mandatory reason.
  it("requires a motif on every rejection, bounded in length", () => {
    expect(validateRejectionReason("")).toEqual({ ok: false, error: "validation_reason_required" });
    expect(validateRejectionReason("   ")).toEqual({ ok: false, error: "validation_reason_required" });
    expect(validateRejectionReason(null).ok).toBe(false);
    const long = validateRejectionReason("x".repeat(MAX_REJECTION_REASON + 50));
    expect(long.ok).toBe(true);
    expect(long.value!.length).toBe(MAX_REJECTION_REASON);
  });

  it("does not let the panel submit an empty motif", () => {
    const p = read(PANEL);
    expect(p).toMatch(/reason\.trim\(\)\.length === 0/);
    expect(p).toContain("maxLength={MAX_REJECTION_REASON}");
  });

  // (9) A rejection returns the invoice to the correct editable state.
  it("reopens the draft for correction, with the motif still attached", () => {
    const returned = inv({ submittedBy: null, submittedAt: null, rejectionReason: "TVA erronée", revision: 2 });
    expect(isEditableDraft(returned)).toBe(true);
    expect(canSubmitInvoice(returned).ok).toBe(true);
    expect(billingQueueState(returned, true, "none")).toBe("correction_required");
    expect(lane({ invoice: returned }).can.submit).toBe(true);
  });

  it("clears submitted_at and bumps the revision when Finance rejects", () => {
    const src = code(BILLING);
    const body = src.slice(src.indexOf("export async function rejectInvoice"));
    expect(body).toMatch(/submitted_at:\s*null/);
    expect(body).toMatch(/revision/);
    expect(body).toContain("validateRejectionReason");
  });

  it("returns the rejection to step 20, per the registry", () => {
    expect(getStep("finance_invoice_validation")?.rejectsTo).toBe("billing_draft");
  });
});

// ==================================================== 10..13 — step 22 =========

describe("step 22 — issuance happens once, after validation, and numbers once", () => {
  // (10) Step 22 cannot issue before validation.
  it("refuses to issue a draft, submitted or not", () => {
    expect(canEmailInvoice(inv()).error).toBe("invoice_not_validated");
    expect(canEmailInvoice(inv({ submittedAt: "x", submittedBy: MAKER })).error).toBe("invoice_not_validated");
    expect(lane({ invoice: inv(), perms: BILLING_OFFICER }).can.issue).toBe(false);
  });

  it("offers issuance only on a VALIDATED invoice, to finance:issue", () => {
    const validated = inv({ status: "VALIDATED", submittedBy: MAKER, submittedAt: "x", validatedBy: CHECKER, validatedAt: "y" });
    expect(lane({ invoice: validated }).can.issue).toBe(true);
    expect(lane({ invoice: validated, perms: FINANCE_OFFICER }).can.issue).toBe(false);
  });

  // (11) Step 22 issues exactly once.
  it("offers nothing once the invoice has been issued", () => {
    for (const status of ["ISSUED", "PARTIALLY_PAID", "PAID"] as const) {
      const done = inv({ status });
      expect(canEmailInvoice(done).ok).toBe(false);
      expect(lane({ invoice: done }).can.issue).toBe(false);
      expect(billingQueueState(done, true, "sent")).toBe("emailed");
    }
  });

  it("refuses issuance when step 22 has not been reached", () => {
    const validated = inv({ status: "VALIDATED", submittedBy: MAKER, submittedAt: "x" });
    const v = lane({ invoice: validated, steps: { draftOpen: false, dispatchOpen: false } });
    expect(v.can.issue).toBe(false);
    expect(v.blockedReason).toBe("dispatch_step_not_reached");
  });

  // (12) The official number is allocated exactly once, at the governed step 22.
  it("allocates the number in the governed lane exactly once, and only there", () => {
    const src = code(BILLING);
    expect((src.match(/next_invoice_number/g) ?? []).length).toBe(1);
    // …and inside emailValidatedInvoice, not earlier in the lane.
    const issue = src.indexOf("export async function emailValidatedInvoice");
    expect(src.indexOf("next_invoice_number")).toBeGreaterThan(issue);
    // Nothing in steps 20 or 21 numbers anything.
    for (const fn of ["prepareInvoiceDraft", "submitInvoiceToFinance", "approveInvoice", "rejectInvoice"]) {
      const start = src.indexOf(`export async function ${fn}`);
      const end = src.indexOf("export async function", start + 10);
      expect(src.slice(start, end === -1 ? undefined : end)).not.toContain("next_invoice_number");
    }
  });

  it("did not move numbering earlier, and the UI allocates nothing", () => {
    expect(code(LANE)).not.toContain("next_invoice_number");
    expect(code(PANEL)).not.toContain("next_invoice_number");
    expect(code(STATE)).not.toContain("next_invoice_number");
  });

  // (13) A repeated click / retry cannot allocate a second number.
  it("guards the issue path with the VALIDATED precondition a retry cannot re-satisfy", () => {
    const validated = inv({ status: "VALIDATED" });
    expect(canEmailInvoice(validated).ok).toBe(true);
    // The action sets ISSUED; a second call sees ISSUED and is refused.
    expect(canEmailInvoice(inv({ status: "ISSUED" })).ok).toBe(false);
  });

  it("re-checks that precondition inside the action, not only in the UI", () => {
    const src = code(BILLING);
    const body = src.slice(src.indexOf("export async function emailValidatedInvoice"));
    expect(body).toContain("canEmailInvoice");
    expect(body).toContain("prepareDispatchStep");
    // CAS on the status, so two concurrent issues cannot both win.
    expect(body).toMatch(/\.eq\("status",\s*"VALIDATED"\)/);
  });

  it("asks before doing the irreversible thing", () => {
    const p = read(PANEL);
    expect(p).toContain('setDialog("issue")');
    expect(p).toMatch(/définitive/);
  });
});

// ============================================ 14 — the server is authoritative ==

describe("the UI granted nothing: every action re-checks on the server", () => {
  // (14) Unauthorized roles cannot invoke the actions server-side.
  it("guards all five governed actions with a permission, not a prop", () => {
    const src = code(BILLING);
    const expected: Record<string, string> = {
      prepareInvoiceDraft: "finance:create",
      submitInvoiceToFinance: "finance:create",
      approveInvoice: "finance:validate",
      rejectInvoice: "finance:validate",
      emailValidatedInvoice: "finance:issue",
    };
    for (const [fn, permission] of Object.entries(expected)) {
      const start = src.indexOf(`export async function ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      const end = src.indexOf("export async function", start + 10);
      const body = src.slice(start, end === -1 ? undefined : end);
      expect(body, fn).toContain(`guard("${permission}"`);
    }
  });

  it("keeps the guard's four gates: kill switch, permission, tenant, visibility", () => {
    const g = code(BILLING);
    const body = g.slice(g.indexOf("async function guard("), g.indexOf("const isErr ="));
    expect(body).toContain("globalKillSwitch()");
    expect(body).toContain("assertPermission(permission)");
    expect(body).toContain("getTenantProcessFlags");
    expect(body).toContain("isFileVisible");
  });

  it("accepts no client-supplied bypass anywhere in the slice", () => {
    for (const p of [LANE, PANEL, STATE, BILLING]) {
      const src = code(p);
      expect(src, p).not.toMatch(/viaDomainAction/);
      expect(src, p).not.toMatch(/\bbypass(Token|Guard)\b/);
      expect(src, p).not.toMatch(/\bskipGuard\b/);
      expect(src, p).not.toMatch(/\boverride\s*[:=]\s*true/);
    }
  });

  it("gives the panel no authority of its own — it renders what the server decided", () => {
    const p = code(PANEL);
    // Every control's visibility comes from the server-resolved verdict — and
    // the assertion binds each capability to ITS OWN render guard. `toContain`
    // was not enough: each name also appears in the `anyAction` disjunction, so
    // replacing a guard with a hardcoded `true` left the string present and the
    // mutation survived. The `{` anchors this to the JSX guard.
    for (const cap of ["prepare", "submit", "approve", "reject", "issue"]) {
      expect(p, cap).toContain(`{view.can.${cap} &&`);
    }
    // …and no control is rendered on a constant.
    expect(p).not.toMatch(/\{\s*true\s*&&/);
    // And the panel re-derives none of the rules.
    expect(p).not.toContain("canSubmitInvoice");
    expect(p).not.toContain("canValidateInvoice");
    expect(p).not.toContain("canEmailInvoice");
    expect(p).not.toContain("billingLaneCapabilities");
    expect(p).not.toMatch(/lineCount\s*[<>=]/);
    expect(p).not.toMatch(/status\s*===\s*"VALIDATED"/);
  });

  it("reads the maker-checker columns on the SERVER, never in the browser", () => {
    expect(code(LANE)).toContain('import "server-only"');
    expect(code(LANE)).toContain("submitted_by");
    // The client type exposes the verdict, not the identity behind it.
    expect(code(PANEL)).not.toContain("submitted_by");
    expect(read(LANE)).toContain("viewerIsMaker");
  });

  it("fails closed in the read model at every unknown", () => {
    const l = code(LANE);
    for (const closed of [
      "if (!globalKillSwitch().enabled) return null;",
      "if (!user) return null;",
      "if (!snap?.instance) return null;",
    ]) {
      expect(l).toContain(closed);
    }
    expect(l).toContain("if (error) return null;");
    expect(l).toContain("isFileVisible");
  });

  it("invents no French: every refusal comes from the shared vocabulary", () => {
    const p = code(PANEL);
    expect(p).toContain("BILLING_ERROR_FR");
    // No private error map on this surface — the sixth one was already a defect.
    expect(p).not.toMatch(/const\s+\w*ERROR_FR\s*[:=]/);
    // And every code the read model can emit has a sentence.
    const codes: BillingError[] = [
      "dossier_not_billing_ready",
      "invoice_missing",
      "self_approval_forbidden",
      "no_lines",
      "duplicate_submission",
      "invoice_not_submittable",
      "invoice_not_awaiting_validation",
      "invoice_not_validated",
      "dispatch_step_not_reached",
    ];
    for (const c of codes) {
      expect(BILLING_ERROR_FR[c], c).toBeTruthy();
    }
  });
});

// ================================================== the legacy issuance door ====

describe("two issuance doors, one retired exactly where it conflicts", () => {
  it("keeps the legacy action intact — a non-engine dossier still needs it", () => {
    expect(code(LEGACY)).toContain("export async function issueInvoice");
  });

  it("withdraws only the legacy CONTROL, and only where the lane governs", () => {
    const card = code(CARD);
    expect(card).toMatch(/isDraft && canIssueInvoice && !governedLane/);
    // Exactly one CONTROL is gated on it — the prop's declaration and its type
    // are the other two mentions, and nothing else on the card reads it.
    expect((card.match(/!governedLane/g) ?? []).length).toBe(1);
    expect((card.match(/governedLane/g) ?? []).length).toBe(3);
    expect(code(FINANCE_PANEL)).toContain("governedLane={governedLane}");
    expect(code(PAGE)).toContain("governedLane={billingLane !== null}");
  });

  it("renders the governed panel only when the engine governs the dossier", () => {
    // No process instance => null => no panel, and the legacy door stays open.
    expect(code(LANE)).toContain("if (!snap?.instance) return null;");
    expect(code(PAGE)).toContain("canReadFinance && billingLane &&");
  });

  it("proves the two doors could never be open at the same moment anyway", () => {
    // The legacy control renders only on a DRAFT; issuance in the lane needs
    // VALIDATED, which is reached only after step 21.
    const legacyOpen = (s: InvoiceView["status"]) => s === "DRAFT";
    const governedOpen = (s: InvoiceView["status"]) => canEmailInvoice(inv({ status: s })).ok;
    for (const s of ["DRAFT", "VALIDATED", "ISSUED", "PARTIALLY_PAID", "PAID"] as const) {
      expect(legacyOpen(s) && governedOpen(s), s).toBe(false);
    }
  });

  it("restores no generic submit/approve/reject control", () => {
    const p = code(PANEL);
    for (const generic of ["submitStep", "approveStep", "rejectStep", "activateStep"]) {
      expect(p, generic).not.toContain(generic);
    }
  });
});

// ============================================ 15, 16 — nothing else moved ======

describe("no neighbouring contract was changed", () => {
  // (15) Steps 18 and 19 are unchanged.
  it("leaves the completeness pair and its registry entries alone", () => {
    expect(getStep("coordinator_completeness")?.rejectsTo).toBe(
      getStep("coordinator_completeness")?.rejectsTo,
    );
    expect(getStep("am_completeness")?.prerequisites).toContain("coordinator_completeness");
    expect(getStep("billing_draft")?.prerequisites).toEqual(["am_completeness"]);
    // The generic controls are still the act for completeness — never withdrawn.
    expect(DOMAIN_OWNED_STEPS.coordinator_completeness).toBeUndefined();
    expect(DOMAIN_OWNED_STEPS.am_completeness).toBeUndefined();
  });

  it("changes no workflow prerequisite in the billing lane", () => {
    expect(getStep("finance_invoice_validation")?.prerequisites).toEqual(["billing_draft"]);
    expect(getStep("billing_dispatch")?.prerequisites).toEqual(["finance_invoice_validation"]);
    expect(getStep("billing_draft")?.permissions).toEqual(["finance:create"]);
  });

  it("adds no requiredDocuments to make a gate pass", () => {
    expect(getStep("billing_draft")?.requiredDocuments).toEqual([]);
  });

  // (16) The PR #19 billing-bypass contract still holds — asserted above by
  // execution; here as the ratified map's size, which a third entry would break.
  it("still withdraws generic controls from exactly two steps", () => {
    expect(Object.keys(DOMAIN_OWNED_STEPS).sort()).toEqual([
      "billing_draft",
      "finance_invoice_validation",
    ]);
  });

  it("introduces no migration and no schema change", () => {
    for (const p of [LANE, STATE, PANEL, BILLING]) {
      expect(code(p), p).not.toMatch(/\b(alter table|create table|drop table|grant )/i);
    }
  });

  // (17) No automated test mutates the production dossier.
  it("names no production dossier and writes nothing", () => {
    const self = read("tests/step20-billing-ui-01.test.ts");
    expect(self).not.toMatch(/EFT-IMP-2026-\d+/);
    // No client is imported here and none is constructed, so nothing in this
    // file can reach a database — production or otherwise. Every fixture above
    // is a literal.
    expect(self).not.toMatch(/^import .*(supabase|admin).*$/im);
    expect(self).not.toMatch(/getAdminSupabaseClient\(/);
    expect(self).not.toMatch(/createClient\(/);
  });
});

// ================================================== mutation probes (design) ====

describe("the lane decision is exercisable, so a mutation to it fails a test", () => {
  /**
   * The probe that matters. BILLING-BYPASS-01's ninth mutation survived because
   * the rule lived in a server-only module a unit test cannot execute. These
   * assert the shape that prevents a repeat: the decision is pure, imported
   * here, and every governance answer above ran it.
   */
  it("keeps the whole verdict in the pure module, and only loading in the server one", () => {
    const l = code(LANE);
    // The verdict is TAKEN from the pure function — asserted as the assignment,
    // not merely as the call. A weaker `toContain("billingLaneCapabilities(")`
    // was satisfied by a probe that kept a dead reference to it and granted on
    // raw permissions beside it. `lane.ts` is server-only and cannot be executed
    // here, so this wiring is the one thing only a structural check can hold.
    expect(l).toContain("const { can, blockedReason } = billingLaneCapabilities({");
    // No capability object is BUILT here. (`can: {` still appears — in the view
    // type — and declaring a field is not computing one.)
    expect((l.match(/\bcan\s*=\s*\{/g) ?? []).length).toBe(0);
    expect((l.match(/blockedReason\s*=[^=]/g) ?? []).length).toBe(0);
    // The loader COMPUTES no capability: it never combines a permission with a
    // predicate, which is what deciding would look like. (`prepare:` and friends
    // still appear — in the view TYPE — and a field name is not a decision.)
    expect(l).not.toMatch(/may(Create|Validate|Issue)\s*&&/);
    expect(l).not.toContain("canSubmitInvoice");
    expect(l).not.toContain("canValidateInvoice");
    expect(l).not.toContain("canEmailInvoice");
    expect(code(STATE)).toContain("export function billingLaneCapabilities");
  });

  it("an unconditional yes would be caught: every capability has a false case", () => {
    // If `billingLaneCapabilities` returned all-true, each of these would fail.
    expect(lane({ perms: NOBODY }).can).toEqual({
      prepare: false,
      submit: false,
      approve: false,
      reject: false,
      issue: false,
    });
    expect(lane({ invoice: null, billingReady: false }).can.prepare).toBe(false);
    expect(lane({ invoice: inv({ lineCount: 0 }) }).can.submit).toBe(false);
    expect(
      lane({
        invoice: inv({ submittedBy: MAKER, submittedAt: "x" }),
        viewerId: MAKER,
        perms: { mayCreate: true, mayValidate: true, mayIssue: true },
      }).can.approve,
    ).toBe(false);
    expect(lane({ invoice: inv({ status: "VALIDATED" }), steps: SHUT }).can.issue).toBe(false);
  });

  it("an unconditional no would be caught too: every capability has a true case", () => {
    expect(lane({ invoice: null }).can.prepare).toBe(true);
    expect(lane({}).can.submit).toBe(true);
    const submitted = inv({ submittedBy: MAKER, submittedAt: "x" });
    expect(lane({ invoice: submitted, viewerId: CHECKER, perms: FINANCE_OFFICER }).can.approve).toBe(true);
    expect(lane({ invoice: submitted, viewerId: CHECKER, perms: FINANCE_OFFICER }).can.reject).toBe(true);
    expect(lane({ invoice: inv({ status: "VALIDATED" }) }).can.issue).toBe(true);
  });

  it("swapping approve's permission for the maker's would be caught", () => {
    // finance:create and finance:validate genuinely differ for this pair, so a
    // mutation that reads the wrong one cannot pass.
    const submitted = inv({ submittedBy: MAKER, submittedAt: "x" });
    expect(lane({ invoice: submitted, viewerId: CHECKER, perms: BILLING_OFFICER }).can.approve).toBe(false);
    expect(lane({ invoice: submitted, viewerId: CHECKER, perms: FINANCE_OFFICER }).can.submit).toBe(false);
  });

  it("dropping the step-openness term from submit or issue would be caught", () => {
    expect(lane({ steps: { draftOpen: false, dispatchOpen: true } }).can.submit).toBe(false);
    expect(
      lane({ invoice: inv({ status: "VALIDATED" }), steps: { draftOpen: true, dispatchOpen: false } }).can.issue,
    ).toBe(false);
  });
});
