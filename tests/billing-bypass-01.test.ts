/**
 * BILLING-BYPASS-01 — the generic controls stop being a way around the billing
 * workflow.
 *
 * `billing_draft` declares `requiredDocuments: []`, so `evaluateStepEvidence`
 * had nothing to block on and the generic « Terminer » moved step 20 to
 * SUBMITTED **with no invoice in existence**. `approveStep` inspects no invoice
 * at all, so the generic « Valider » then completed steps 20 AND 21 and
 * promoted step 22 — an audit trail asserting Finance had validated a document
 * that did not exist. Only step 22 was protected, by its FINAL_INVOICE evidence.
 *
 * The generic approval became reachable for this pair in STEP18-COMPLETENESS-02,
 * which offered Valider/Rejeter for every ratified maker/checker pair. Right for
 * `completeness_review`, where the generic controls ARE the act; wrong here,
 * where they route around one.
 *
 * Two halves, and the second is the one that matters: `engine/actions.ts`
 * carries `"use server"`, so `submitStep`/`approveStep`/`rejectStep` are
 * client-reachable endpoints. Hiding buttons is a courtesy; the server refuses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DOMAIN_OWNED_STEPS,
  domainFactSatisfied,
  domainOwnedReasonFr,
  domainOwnedStep,
  isGenericTransitionWithdrawn,
  type DomainInvoiceFact,
} from "@/lib/process/domain-owned-steps";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { getStep, MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";
import { validatorStepFor } from "@/lib/process/engine/state";
import { processErrorFr } from "@/lib/process/error-fr";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENGINE = "lib/process/engine/actions.ts";
const GUARD = "lib/process/engine/domain-owned-guard.ts";
const MAP = "lib/process/domain-owned-steps.ts";
const ELIGIBILITY = "lib/process/step-eligibility.ts";
const BILLING = "lib/process/billing/actions.ts";

const DRAFT = "billing_draft";
const VALIDATION = "finance_invoice_validation";
const DISPATCH = "billing_dispatch";
const COMPLETENESS = "coordinator_completeness";

const MAKER = "user-billing-maker";
const CHECKER = "user-finance-checker";

const facts = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: DRAFT,
  state: "ACTIVE",
  assignedUserId: MAKER,
  submittedBy: null,
  custody: "not_applicable",
  owningRole: "BILLING_OFFICER",
  missingPrerequisites: [],
  requirements: [],
  ...over,
});

const viewer = (userId: string, permissions: string[]) => ({
  userId,
  permissions,
  roles: ["BILLING_OFFICER", "FINANCE_OFFICER"],
});

// ===========================================================================
// The ratified map
// ===========================================================================
describe("the domain-owned map is explicit and minimal", () => {
  it("1 — names exactly the two billing steps", () => {
    expect(Object.keys(DOMAIN_OWNED_STEPS).sort()).toEqual([DRAFT, VALIDATION].sort());
  });

  it("2 — withdraws submit from step 20, approve+reject from step 21", () => {
    expect(domainOwnedStep(DRAFT)!.withdraws).toEqual(["submit"]);
    expect(domainOwnedStep(VALIDATION)!.withdraws.slice().sort()).toEqual(["approve", "reject"]);
    expect(isGenericTransitionWithdrawn(DRAFT, "submit")).toBe(true);
    expect(isGenericTransitionWithdrawn(VALIDATION, "approve")).toBe(true);
    expect(isGenericTransitionWithdrawn(VALIDATION, "reject")).toBe(true);
  });

  it("3 — and withdraws NOTHING from any other step", () => {
    for (const step of [DISPATCH, COMPLETENESS, "am_completeness", "pickup", "customs_preparation",
                        "transit_validation", "transport_pod_handoff"]) {
      for (const t of ["submit", "approve", "reject"] as const) {
        expect(isGenericTransitionWithdrawn(step, t), `${step}/${t}`).toBe(false);
      }
    }
  });

  it("4 — every named step is a real registry step, with a French sentence", () => {
    for (const key of Object.keys(DOMAIN_OWNED_STEPS)) {
      expect(getStep(key), key).toBeTruthy();
      const reason = domainOwnedReasonFr(key);
      expect(reason, key).toBeTruthy();
      expect(reason, key).toMatch(/facture/i);
    }
    expect(domainOwnedReasonFr("pickup")).toBeNull();
  });

  it("5 — no requiredDocuments were faked to achieve this", () => {
    // The brief forbids it, and it would have been dishonest: a draft carrying
    // lines is not a document.
    expect(getStep(DRAFT)!.requiredDocuments).toEqual([]);
    expect(getStep(VALIDATION)!.requiredDocuments).toEqual([]);
    expect(getStep(DISPATCH)!.requiredDocuments).toEqual(["FINAL_INVOICE"]);
  });
});

// ===========================================================================
// UI suppression
// ===========================================================================
describe("generic controls are withdrawn in the UI", () => {
  it("6 — generic SUBMIT is not offered on step 20", () => {
    const el = evaluateStepAction(facts(), viewer(MAKER, ["finance:create"]));
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toBe(domainOwnedReasonFr(DRAFT));
    expect(el.reasonFr).toMatch(/soumettant la facture à la Finance/);
  });

  it("7 — but STARTING step 20 is untouched: claiming work is not the act", () => {
    const el = evaluateStepAction(
      facts({ state: "AVAILABLE", assignedUserId: null }),
      viewer(MAKER, ["finance:create"]),
    );
    expect(el.canStart).toBe(true);
  });

  it("8 — generic APPROVE/REJECT are not offered on the submitted step-20 row", () => {
    // The review is offered on the PREPARER row; the VALIDATOR key is what the
    // map names, so the suppression must key on that.
    expect(validatorStepFor(DRAFT)).toBe(VALIDATION);
    const el = evaluateStepAction(
      facts({ state: "SUBMITTED", submittedBy: MAKER }),
      viewer(CHECKER, ["finance:validate"]),
    );
    expect(el.reviewStepKey).toBe(VALIDATION);
    expect(el.canApprove).toBe(false);
    expect(el.canReject).toBe(false);
    expect(el.reasonFr).toBe(domainOwnedReasonFr(VALIDATION));
  });

  it("9 — PR #17 does NOT regress: the completeness pair keeps its review", () => {
    const el = evaluateStepAction(
      facts({
        stepKey: COMPLETENESS, state: "SUBMITTED", submittedBy: MAKER,
        owningRole: "COORDINATOR",
      }),
      viewer(CHECKER, ["process:completeness:review"]),
    );
    expect(el.reviewStepKey).toBe("am_completeness");
    expect(el.canApprove).toBe(true);
    expect(el.canReject).toBe(true);
  });

  it("10 — …and its generic submit is untouched too", () => {
    const el = evaluateStepAction(
      facts({ stepKey: COMPLETENESS, state: "ACTIVE", assignedUserId: MAKER, owningRole: "COORDINATOR" }),
      viewer(MAKER, ["process:completeness:review"]),
    );
    expect(el.canSubmit).toBe(true);
  });

  it("11 — an ordinary step keeps Démarrer and Terminer", () => {
    const el = evaluateStepAction(
      facts({ stepKey: "pickup", state: "ACTIVE", assignedUserId: MAKER, owningRole: "PICKUP_AGENT" }),
      viewer(MAKER, ["transport:update"]),
    );
    expect(el.canSubmit).toBe(true);
  });

  it("12 — step 22 is untouched by this slice", () => {
    expect(isGenericTransitionWithdrawn(DISPATCH, "submit")).toBe(false);
    const el = evaluateStepAction(
      facts({ stepKey: DISPATCH, state: "ACTIVE", assignedUserId: MAKER, owningRole: "BILLING_OFFICER" }),
      viewer(MAKER, ["finance:issue"]),
    );
    expect(el.canSubmit).toBe(true);
  });
});

// ===========================================================================
// Server-side authority — the half that actually closes the hole
// ===========================================================================
describe("the server refuses generic transitions on domain-owned steps", () => {
  it("13 — the engine action module is a CLIENT-REACHABLE endpoint", () => {
    // This is why UI suppression alone is insufficient, asserted rather than
    // assumed. If this ever stops being true the guard is still correct.
    expect(read(ENGINE).startsWith('"use server"')).toBe(true);
  });

  it("14 — submitStep consults the guard", () => {
    const src = code(ENGINE);
    const fn = src.slice(src.indexOf("export async function submitStep"), src.indexOf("export async function completeStep"));
    expect(fn).toContain("genericTransitionAllowed({");
    expect(fn).toContain('transition: "submit"');
    expect(fn).toContain('return fail("domain_owned_transition")');
    // …before evidence is even evaluated.
    expect(fn.indexOf("genericTransitionAllowed")).toBeLessThan(fn.indexOf("evaluateStepEvidence"));
  });

  it("15 — approveStep and rejectStep consult it, keyed on the VALIDATOR step", () => {
    const src = code(ENGINE);
    const approve = src.slice(src.indexOf("export async function approveStep"), src.indexOf("export async function rejectStep"));
    const reject = src.slice(src.indexOf("export async function rejectStep"));
    for (const [fn, transition] of [[approve, "approve"], [reject, "reject"]] as const) {
      expect(fn).toContain("genericTransitionAllowed({");
      expect(fn).toContain("stepKey: validatorStepKey,");
      expect(fn).toContain(`transition: "${transition}"`);
      expect(fn).toContain('return fail("domain_owned_transition")');
    }
  });

  it("16 — the guard asks for the FACT, never for a caller-supplied token", () => {
    const g = code(GUARD);
    // A parameter would not be a boundary: arguments to a server action come
    // from the caller.
    expect(g).not.toMatch(/viaDomainAction|isDomainCall|trusted|bypassToken/);
    // It reads the invoice the domain action writes before it moves the step,
    // and DECIDES nothing itself — the rule is pure and tested below.
    expect(g).toContain('.from("invoice")');
    expect(g).toContain("domainFactSatisfied(input.transition, invoices)");
    expect(g).toContain("if (error) return false;");
    expect(g).toContain("if (!isGenericTransitionWithdrawn(input.stepKey, input.transition)) return true;");

    // The loader must DELEGATE, not decide — and must not wave anything
    // through on the way. Exactly one `return true` (the not-domain-owned early
    // exit), and the delegation is the last thing it does. Without this an
    // unconditional `return true;` could sit above the delegation, leaving it
    // present but unreachable — a mutation nothing else here would catch,
    // because the function is server-only and cannot be executed in a unit test.
    expect((g.match(/return true;/g) ?? []).length).toBe(1);
    expect(g.trimEnd().endsWith("return domainFactSatisfied(input.transition, invoices);\n}")).toBe(true);
  });

  // ---- the RULE, exercised rather than read ------------------------------
  const inv = (over: Partial<DomainInvoiceFact> = {}): DomainInvoiceFact => ({
    status: "DRAFT", submittedAt: null, validatedAt: null, rejectionReason: null, ...over,
  });

  it("17 — NO invoice: every domain-owned transition is refused", () => {
    for (const t of ["submit", "approve", "reject"] as const) {
      expect(domainFactSatisfied(t, []), t).toBe(false);
    }
  });

  it("18 — an EMPTY, unsubmitted draft cannot close step 20 or 21", () => {
    // The exact EFT-IMP-2026-00013 shape: a DRAFT that nobody submitted.
    const draftOnly = [inv()];
    expect(domainFactSatisfied("submit", draftOnly)).toBe(false);
    expect(domainFactSatisfied("approve", draftOnly)).toBe(false);
    expect(domainFactSatisfied("reject", draftOnly)).toBe(false);
  });

  it("19 — after submitInvoiceToFinance, the step-20 transition is admitted", () => {
    const submitted = [inv({ submittedAt: "2026-09-29T10:00:00Z" })];
    expect(domainFactSatisfied("submit", submitted)).toBe(true);
    // …but the approval still is not: nobody has validated it.
    expect(domainFactSatisfied("approve", submitted)).toBe(false);
    expect(domainFactSatisfied("reject", submitted)).toBe(false);
  });

  it("20 — after approveInvoice, the step-21 approval is admitted", () => {
    const validated = [inv({ status: "VALIDATED", submittedAt: "t", validatedAt: "t" })];
    expect(domainFactSatisfied("approve", validated)).toBe(true);
    expect(domainFactSatisfied("submit", validated)).toBe(true);
  });

  it("21 — after rejectInvoice, the rejection is admitted and the approval is not", () => {
    const rejected = [inv({ submittedAt: null, rejectionReason: "montant erroné" })];
    expect(domainFactSatisfied("reject", rejected)).toBe(true);
    expect(domainFactSatisfied("approve", rejected)).toBe(false);
  });

  it("22 — a legacy ISSUED/PAID invoice is never stranded", () => {
    for (const status of ["ISSUED", "PARTIALLY_PAID", "PAID"]) {
      const legacy = [inv({ status, submittedAt: null })];
      expect(domainFactSatisfied("submit", legacy), status).toBe(true);
      expect(domainFactSatisfied("approve", legacy), status).toBe(true);
    }
  });

  it("23 — a VOID invoice alone satisfies nothing", () => {
    const voided = [inv({ status: "VOID" })];
    for (const t of ["submit", "approve", "reject"] as const) {
      expect(domainFactSatisfied(t, voided), t).toBe(false);
    }
  });

  it("24 — the refusal has its own code and its own French sentence", () => {
    expect(code("lib/process/engine/types.ts")).toContain('| "domain_owned_transition"');
    const fr = processErrorFr("domain_owned_transition");
    expect(fr).toBeTruthy();
    expect(fr).toMatch(/facture/i);
    expect(fr).not.toMatch(/^domain_owned/);
  });
});

// ===========================================================================
// The domain actions still work
// ===========================================================================
describe("the governed billing actions are NOT blocked", () => {
  it("25 — each writes its invoice fact BEFORE it moves the step", () => {
    const src = code(BILLING);

    const submit = src.slice(src.indexOf("export async function submitInvoiceToFinance"), src.indexOf("export async function approveInvoice"));
    expect(submit.indexOf("submitted_at: new Date().toISOString()")).toBeLessThan(submit.indexOf('submitStep(fileId, "billing_draft")'));

    const approve = src.slice(src.indexOf("export async function approveInvoice"), src.indexOf("export async function rejectInvoice"));
    expect(approve.indexOf('status: "VALIDATED"')).toBeLessThan(approve.indexOf('approveStep(fileId, "finance_invoice_validation")'));

    const reject = src.slice(src.indexOf("export async function rejectInvoice"), src.indexOf("export async function emailValidatedInvoice"));
    expect(reject.indexOf("rejection_reason: r.value")).toBeLessThan(reject.indexOf('rejectStep(fileId, "finance_invoice_validation"'));
  });

  it("26 — so each action's own fact admits its own transition, and no other", () => {
    // The state each action writes, and what it unlocks. Exercised, not read:
    // the rule is pure precisely so a mutation to it fails here.
    const afterSubmit = [{ status: "DRAFT", submittedAt: "t", validatedAt: null, rejectionReason: null }];
    const afterApprove = [{ status: "VALIDATED", submittedAt: "t", validatedAt: "t", rejectionReason: null }];
    const afterReject = [{ status: "DRAFT", submittedAt: null, validatedAt: null, rejectionReason: "motif" }];

    expect(domainFactSatisfied("submit", afterSubmit)).toBe(true);
    expect(domainFactSatisfied("approve", afterSubmit)).toBe(false);

    expect(domainFactSatisfied("approve", afterApprove)).toBe(true);

    expect(domainFactSatisfied("reject", afterReject)).toBe(true);
    expect(domainFactSatisfied("approve", afterReject)).toBe(false);
  });

  it("27 — the billing actions keep their OWN rules — nothing was moved", () => {
    const state = code("lib/process/billing/state.ts");
    expect(state).toContain('if (inv.lineCount <= 0) return { ok: false, error: "no_lines" };');
    expect(state).toContain('return { ok: false, error: "self_approval_forbidden" };');
    expect(state).toContain('if (inv.status !== "VALIDATED") return { ok: false, error: "invoice_not_validated" };');
  });

  it("28 — no second billing state machine was created", () => {
    const g = code(GUARD) + code(MAP);
    for (const forbidden of ["next_invoice_number", "queueAndSend", "ensureOfficialInvoiceArtifact",
                             "invoiceTotals", "canSubmitInvoice", "canValidateInvoice"]) {
      expect(g, forbidden).not.toContain(forbidden);
    }
    // The guard writes nothing at all.
    expect(code(GUARD)).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it("29 — legacy invoices stay recoverable", () => {
    // An invoice that reached VALIDATED/ISSUED by any route satisfies the rule,
    // so a dossier invoiced through the legacy `issueInvoice` door — where
    // `submitted_at` was never set — is not stranded with neither a generic
    // control nor a governed one. The guard exists to stop a step closing on
    // NOTHING, not to relitigate history.
    const legacyIssued = [{ status: "ISSUED", submittedAt: null, validatedAt: null, rejectionReason: null }];
    expect(domainFactSatisfied("submit", legacyIssued)).toBe(true);
    expect(domainFactSatisfied("approve", legacyIssued)).toBe(true);
  });
});

// ===========================================================================
// Invariants this slice must not have touched
// ===========================================================================
describe("no existing process invariant was weakened", () => {
  it("30 — maker/checker, evidence, permissions and prerequisites are intact", () => {
    const src = code(ENGINE);
    expect(src).toContain("const decision = evaluateMakerChecker(st.submittedBy, c.userId, {");
    expect(src).toContain("if (!decision.allowed) return fail(decision.reason);");
    expect(src).toContain("if (blockingRequirements(stepKey, ev).length > 0) {");
    expect(src).toContain('if (ev.unauthorized.length > 0) {');
    expect(src).toContain("const c = await guard(stepPermission(stepKey), fileId);");
  });

  it("31 — the three ratified maker/checker pairs are unchanged", () => {
    expect(MAKER_CHECKER_PAIRS.map((p) => p.key).sort()).toEqual([
      "completeness_review", "customs_validation", "invoice_validation",
    ]);
    for (const p of MAKER_CHECKER_PAIRS) {
      expect(p.selfApprovalAllowed, p.key).toBe(false);
      expect(p.reasonRequired, p.key).toBe(true);
    }
  });

  it("32 — customs_validation is NOT domain-owned: the Chef's panel already calls approveStep", () => {
    // Its domain action passes the VALIDATOR key straight through, so adding it
    // to the map would have blocked the very surface it uses.
    expect(isGenericTransitionWithdrawn("transit_validation", "approve")).toBe(false);
    expect(code("lib/customs/actions.ts")).toContain('approveStep(rec.file_id, "transit_validation")');
  });

  it("33 — no requirement was reclassified", () => {
    const rc = code("lib/process/requirement-class.ts");
    expect(rc).not.toContain("billing_draft::");
    expect(rc).not.toContain("finance_invoice_validation::");
    expect(rc).toContain('"billing_dispatch::FINAL_INVOICE": hard(OBJECT_OF_THE_ACT)');
  });

  it("34 — the map and the guard are the only new concepts, and neither writes", () => {
    expect(code(MAP)).not.toMatch(/\.(insert|update|delete)\(/);
    expect(code(MAP)).not.toContain("server-only");
    expect(read(GUARD).startsWith('import "server-only";')).toBe(true);
    // The map is pure, so the client component can read it.
    expect(code(ELIGIBILITY)).toContain('from "./domain-owned-steps"');
  });

  it("35 — this slice ships no migration", () => {
    const buildInfo = read("lib/platform/ops/build-info.ts");
    expect(buildInfo).toContain('LATEST_MIGRATION = "20261007000001_delivery_note_signed_label"');
    expect(buildInfo).toContain("MIGRATION_COUNT = 145");
  });
});
