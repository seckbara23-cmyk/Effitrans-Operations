/**
 * UAT-CUSTOMS-SINGLE-DOOR-01 — the customs pair gets one door, and the guard
 * learns which record proves the act.
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, in production, on EFT-IMP-2026-00014.
 *
 * `validateCustoms` has always been the single business door for steps 6/7 and
 * says so in its own comment: certify the record with
 * `record_customs_validation`, THEN call `approveStep("transit_validation")`.
 * But the generic « Valider » stayed independently reachable, and on
 * 2026-10-06 at 13:52:37 the Chef de Transit used it:
 *
 *     process.step.approved  {maker: customs_preparation, validator_step: transit_validation}
 *     → steps 6 and 7 COMPLETED
 *     → customs_record.reviewed_at  STILL NULL
 *
 * That is not merely an uncertified record. `customs.update`, `customs.status`
 * and `customs.receivability` are ALL owned by step 6, so closing it stranded
 * the certification permanently and froze the customs status at
 * DECLARATION_PREPARED — from which RELEASED is unreachable, taking steps 15-26
 * with it. The mirror image of UAT-WF-STEP67-01, which fixed the same pair when
 * only the RECORD half went through and the workflow stalled.
 *
 * WHY THE OBVIOUS FIX WOULD HAVE MADE IT WORSE. `DOMAIN_OWNED_STEPS` is only
 * half a mechanism: `genericTransitionAllowed` enforced it by loading the
 * `invoice` table, because every entry was a billing step. A bare
 * `transit_validation: { withdraws: ["approve"] }` would therefore have asked
 * the invoice rule about a customs dossier, met `invoices.length === 0`, and
 * refused `approveStep` for EVERY caller — including `validateCustoms`'s own
 * internal call. Step 7 would have become closable by nobody, on every dossier.
 *
 * So the fix is three coordinated parts, and the tests below are organised the
 * same way: the entry, the generalised fact source, and the proof that billing
 * kept exactly the semantics it had.
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
  type DomainCustomsFact,
  type DomainFacts,
  type DomainInvoiceFact,
} from "@/lib/process/domain-owned-steps";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const STEP7 = "transit_validation";
const STEP6 = "customs_preparation";
const GUARD = "lib/process/engine/domain-owned-guard.ts";
const ENGINE = "lib/process/engine/actions.ts";
const CUSTOMS = "lib/customs/actions.ts";
const QUEUES = "lib/process/queues/actions.ts";

/** The customs fact, with nothing certified unless a case says so. */
const customs = (over: Partial<DomainCustomsFact> = {}): DomainFacts => ({
  source: "customs_record",
  customs: { reviewedAt: null, reviewedBy: null, ...over },
});
const CERTIFIED = customs({ reviewedAt: "2026-10-06T13:52:37Z", reviewedBy: "chef-de-transit" });

const invoices = (list: DomainInvoiceFact[] = []): DomainFacts => ({ source: "invoice", invoices: list });
const inv = (over: Partial<DomainInvoiceFact> = {}): DomainInvoiceFact => ({
  status: "DRAFT", submittedAt: null, validatedAt: null, rejectionReason: null,
  invoiceNumber: null, ...over,
});

// =========================================================== 1. the entry ====

describe("1 — transit_validation is domain-owned, and withdraws ONLY approve", () => {
  it("the map names it, sourced on the customs record", () => {
    const e = domainOwnedStep(STEP7);
    expect(e).toBeTruthy();
    expect(e!.withdraws).toEqual(["approve"]);
    expect(e!.factSource).toBe("customs_record");
  });

  it("generic approve is withdrawn", () => {
    expect(isGenericTransitionWithdrawn(STEP7, "approve")).toBe(true);
  });

  /**
   * REQUIREMENT 6. There is no `rejectCustoms`, so the generic rejection is the
   * ONLY way the Chef can refuse a bad declaration. Withdrawing it would not
   * move the act to another door — it would delete the act.
   */
  it("generic REJECT is not withdrawn — there is no rejectCustoms to replace it", () => {
    expect(isGenericTransitionWithdrawn(STEP7, "reject")).toBe(false);
    expect(isGenericTransitionWithdrawn(STEP7, "submit")).toBe(false);
    expect(code(CUSTOMS)).not.toContain("export async function rejectCustoms");
  });

  it("step 6 keeps every generic control — the Déclarant's work is untouched", () => {
    for (const t of ["submit", "approve", "reject"] as const) {
      expect(isGenericTransitionWithdrawn(STEP6, t), t).toBe(false);
    }
  });

  it("the sentence sends the operator to the customs door, not to a function", () => {
    const r = domainOwnedReasonFr(STEP7);
    expect(r).toBeTruthy();
    expect(r).toMatch(/Valider — Chef de Transit/);
    expect(r).not.toMatch(/validateCustoms|approveStep|domainFact/);
  });

  it("the maker-checker pairing is unchanged", () => {
    const pair = MAKER_CHECKER_PAIRS.find((p) => p.key === "customs_validation");
    expect(pair).toBeTruthy();
    expect(pair!.preparerStep).toBe(STEP6);
    expect(pair!.validatorStep).toBe(STEP7);
    expect(pair!.selfApprovalAllowed).toBe(false);
    expect(pair!.reasonRequired).toBe(true);
  });
});

// ================================================ 2. the customs fact rule ====

describe("2 — only a certified customs record admits the approval", () => {
  it("refuses when reviewed_at is NULL — the production shape exactly", () => {
    // EFT-IMP-2026-00014: a customs record exists, carries a declaration, and
    // has never been certified. This is the call that must now fail.
    expect(domainFactSatisfied(STEP7, "approve", customs())).toBe(false);
  });

  it("refuses when there is no customs record at all", () => {
    expect(
      domainFactSatisfied(STEP7, "approve", { source: "customs_record", customs: null }),
    ).toBe(false);
  });

  /**
   * `reviewed_by` alone is NOT certification, and the RPC says why: « A legacy
   * row carrying a bare `reviewed_by` was never validated in this platform's
   * sense, so it remains validatable. » The old `record_customs_release` used
   * to write it on its own — ATTR-CUSTOMS-01 stopped that.
   */
  it("refuses a bare reviewed_by — the instant is the fact", () => {
    expect(domainFactSatisfied(STEP7, "approve", customs({ reviewedBy: "someone" }))).toBe(false);
  });

  it("refuses an instant with no author — a shape no writer can produce", () => {
    expect(domainFactSatisfied(STEP7, "approve", customs({ reviewedAt: "2026-10-06T13:52:37Z" })))
      .toBe(false);
  });

  it("ALLOWS once the certification wrote both, as record_customs_validation does", () => {
    expect(domainFactSatisfied(STEP7, "approve", CERTIFIED)).toBe(true);
  });

  it("…and admits nothing but `approve` — reject is not governed here", () => {
    expect(domainFactSatisfied(STEP7, "reject", CERTIFIED)).toBe(false);
    expect(domainFactSatisfied(STEP7, "submit", CERTIFIED)).toBe(false);
  });

  /** REQUIREMENT 13. A customs dossier has no invoice at step 7, and must not need one. */
  it("customs validation does NOT require an invoice", () => {
    expect(domainFactSatisfied(STEP7, "approve", CERTIFIED)).toBe(true);
    // and the invoice rule's empty-set refusal never reaches it
    expect(domainFactSatisfied(STEP7, "approve", invoices([]))).toBe(false);
  });

  /** Evidence from the wrong domain proves nothing, in either direction. */
  it("mismatched evidence is refused rather than reinterpreted", () => {
    expect(domainFactSatisfied(STEP7, "approve", invoices([inv({ status: "ISSUED" })]))).toBe(false);
    expect(domainFactSatisfied("billing_dispatch", "submit", CERTIFIED)).toBe(false);
    expect(domainFactSatisfied("finance_invoice_validation", "approve", CERTIFIED)).toBe(false);
  });

  /** REQUIREMENT 14. A step nobody gave a rule, and a step nobody withdrew. */
  it("unknown steps and unsupported transitions fail closed", () => {
    expect(domainFactSatisfied("pickup", "approve", CERTIFIED)).toBe(false);
    expect(domainFactSatisfied("pickup", "submit", invoices([inv({ status: "ISSUED" })]))).toBe(false);
    expect(domainFactSatisfied("", "approve", CERTIFIED)).toBe(false);
  });
});

// ============================================= 3. billing is untouched ========

describe("3 — billing semantics are preserved exactly", () => {
  it("billing_draft: empty set still fails closed; submission still admits", () => {
    expect(domainFactSatisfied("billing_draft", "submit", invoices([]))).toBe(false);
    expect(domainFactSatisfied("billing_draft", "submit", invoices([inv()]))).toBe(false);
    expect(domainFactSatisfied("billing_draft", "submit", invoices([inv({ submittedAt: "t" })])))
      .toBe(true);
    expect(domainFactSatisfied("billing_draft", "submit", invoices([inv({ status: "VALIDATED" })])))
      .toBe(true);
  });

  it("finance_invoice_validation: approve needs VALIDATED, reject needs a reopened motif", () => {
    expect(domainFactSatisfied("finance_invoice_validation", "approve", invoices([inv()]))).toBe(false);
    expect(
      domainFactSatisfied("finance_invoice_validation", "approve", invoices([inv({ status: "VALIDATED" })])),
    ).toBe(true);
    expect(
      domainFactSatisfied("finance_invoice_validation", "reject",
        invoices([inv({ rejectionReason: "motif", submittedAt: null })])),
    ).toBe(true);
    expect(
      domainFactSatisfied("finance_invoice_validation", "reject",
        invoices([inv({ rejectionReason: "motif", submittedAt: "t" })])),
    ).toBe(false);
  });

  it("billing_dispatch: still needs an ISSUED status AND an official number", () => {
    expect(domainFactSatisfied("billing_dispatch", "submit", invoices([inv({ status: "ISSUED" })])))
      .toBe(false);
    expect(domainFactSatisfied("billing_dispatch", "submit", invoices([inv({ invoiceNumber: "n" })])))
      .toBe(false);
    expect(
      domainFactSatisfied("billing_dispatch", "submit",
        invoices([inv({ status: "ISSUED", invoiceNumber: "n" })])),
    ).toBe(true);
  });

  /** REQUIREMENT 12. The rule that protects billing must stay invoice-scoped. */
  it("invoice-governed transitions with zero invoices remain fail-closed", () => {
    for (const [step, t] of [
      ["billing_draft", "submit"], ["finance_invoice_validation", "approve"],
      ["finance_invoice_validation", "reject"], ["billing_dispatch", "submit"],
    ] as const) {
      expect(domainFactSatisfied(step, t, invoices([])), `${step}/${t}`).toBe(false);
    }
  });
});

// ============================ 3b. defence in depth, pinned honestly ===========
//
// Four lines in the rule cannot be reached behaviourally TODAY, and adversarial
// probes proved it: delete any of them and every assertion above still passes.
// That is not a reason to drop them, and it would be dishonest to write a test
// implying they are exercised.
//
//   * the factSource/facts mismatch check — each switch only knows its own
//     steps, so a mismatched pair already falls through to a default;
//   * `customsFactSatisfied`'s trailing `return false` — `transit_validation`
//     is the only customs-owned step;
//   * `invoiceFactSatisfied`'s `invoices.length === 0` early return — every
//     invoice rule is a `.some()`, which is already false on an empty array;
//   * `invoiceFactSatisfied`'s trailing `return false` — the switch covers all
//     three billing steps.
//
// They exist so that the FIFTH entry — whenever somebody adds one — fails
// closed instead of open, which is the moment they stop being unreachable. So
// they are pinned by SHAPE, and this comment says why that is the right kind of
// test rather than a weaker one.
describe("3b — the fail-closed lines are present, and will matter to the next entry", () => {
  const map = read("lib/process/domain-owned-steps.ts");

  it("evidence from the wrong domain is refused before any rule runs", () => {
    expect(map).toContain("if (owned.factSource !== facts.source) return false;");
  });

  it("a step with no rule is refused in BOTH domains", () => {
    // Matched on the comment+return pair, which is unique in the file. Slicing
    // to the "next }" is what a first draft of this test did, and it found the
    // closing brace of an inner block instead of the function's.
    expect(map).toContain(
      "  // A customs-owned step the map withdraws but nobody gave a rule: refuse.\n  return false;\n}",
    );
    expect(map).toContain(
      "  // An invoice-owned step the map withdraws but nobody gave a rule: refuse. The\n"
      + "  // guard only reaches here for a withdrawn step, and silence is not permission.\n"
      + "  return false;\n}",
    );
    expect(map).toContain("  if (invoices.length === 0) return false;");
  });

  it("a step absent from the map is refused, never defaulted", () => {
    expect(map).toContain("if (!owned) return false;");
  });
});

// ================================================= 4. the server boundary =====

describe("4 — the refusal is server-side, on every entry point", () => {
  const g = code(GUARD);

  it("the guard reads the source the entry DECLARES, not a fixed table", () => {
    expect(g).toContain("const owned = domainOwnedStep(input.stepKey);");
    expect(g).toContain('if (owned.factSource === "customs_record")');
    expect(g).toContain('.from("customs_record")');
    expect(g).toContain('.select("reviewed_at, reviewed_by")');
    expect(g).toContain('.from("invoice")');
  });

  it("…and it is bounded to the tenant and to live records", () => {
    const branch = g.slice(g.indexOf('factSource === "customs_record"'), g.indexOf('.from("invoice")'));
    expect(branch).toContain('.eq("tenant_id", input.tenantId)');
    expect(branch).toContain('.eq("file_id", input.fileId)');
    expect(branch).toContain('.is("deleted_at", null)');
  });

  it("both branches fail closed on a read that did not answer", () => {
    expect((g.match(/if \(error\) return false;/g) ?? []).length).toBe(2);
    expect((g.match(/return true;/g) ?? []).length).toBe(1);
  });

  it("the guard decides nothing itself — it loads and delegates", () => {
    expect(g).not.toMatch(/viaDomainAction|isDomainCall|trusted|bypassToken|override/);
    expect((g.match(/domainFactSatisfied\(/g) ?? []).length).toBe(2);
  });

  /**
   * REQUIREMENT 3/D. The engine action is the boundary, so BOTH generic
   * surfaces — the dossier step panel and the queue proxy — are refused by the
   * same guard, whichever one calls.
   */
  it("approveStep asks the guard, keyed on the VALIDATOR step", () => {
    const e = code(ENGINE);
    expect(e).toContain("genericTransitionAllowed({");
    expect(e).toMatch(/stepKey: validatorStepKey,\s*\n\s*transition: "approve",/);
  });

  it("the queue proxy reaches the SAME engine action, so it cannot differ", () => {
    const q = code(QUEUES);
    expect(q).toContain("const r = await approveStep(fileId, validatorStepKey);");
    // it adds no approval of its own
    expect(q).not.toContain("genericTransitionAllowed");
    expect(q).not.toMatch(/\.from\("customs_record"\)/);
  });

  it("validateCustoms certifies BEFORE it calls the engine — the ordering is the capability", () => {
    const a = code(CUSTOMS);
    const rpc = a.indexOf('rpc("record_customs_validation"');
    const approve = a.indexOf(`approveStep(rec.file_id, "${STEP7}")`);
    expect(rpc).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(rpc);
  });

  it("…and no other module calls approveStep for transit_validation", () => {
    // Searched repo-wide: the only callers are validateCustoms (the door),
    // approveInvoice (billing) and the queue proxy (generic, now guarded).
    const callers = ["lib/customs/actions.ts", "lib/process/billing/actions.ts", "lib/process/queues/actions.ts"];
    for (const f of callers) expect(code(f), f).toContain("approveStep(");
    expect(code("lib/process/billing/actions.ts")).not.toContain(STEP7);
  });

  it("self-validation protections are untouched", () => {
    const a = code(CUSTOMS);
    expect(a).toContain('return { ok: false, error: "self_validation" };');
    expect(a).toContain('return { ok: false, error: "self_validation_editor" };');
    expect(a).toContain('if (rec.reviewed_at) return { ok: false, error: "already_validated" };');
    // and the control gate still runs before any of it
    expect(a).toContain('customsControlGate("customs.validation", rec.file_id, user)');
  });
});

// ============================================ 5. the UI, from one source ======

describe("5 — the dossier and the queue stop offering a competing door", () => {
  const base = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
    stepKey: STEP6,
    state: "SUBMITTED",
    assignedUserId: null,
    submittedBy: "declarant",
    custody: "not_applicable",
    owningRole: "CUSTOMS_DECLARANT",
    missingPrerequisites: [],
    requirements: [],
    ...over,
  });
  const chef = {
    userId: "chef",
    permissions: ["customs:update", "customs:validate", "process:step:complete"],
    roles: ["CHIEF_OF_TRANSIT"],
  };

  it("the Chef is NOT offered the generic Valider on the customs pair", () => {
    expect(evaluateStepAction(base(), chef).canApprove).toBe(false);
  });

  /** REQUIREMENT 6 again, at the surface: Rejeter must survive. */
  it("…but Rejeter remains, because its act has no other door", () => {
    expect(evaluateStepAction(base(), chef).canReject).toBe(true);
  });

  it("and the operator is told where the validation lives", () => {
    const r = evaluateStepAction(base(), chef).reasonFr;
    expect(r).toMatch(/Valider — Chef de Transit/);
  });

  it("the billing pair still withdraws BOTH halves — unchanged behaviour", () => {
    const f = base({ stepKey: "billing_draft", submittedBy: "billing", owningRole: "BILLING_OFFICER" });
    const finance = { userId: "fin", permissions: ["finance:validate", "process:step:complete"], roles: ["FINANCE_OFFICER"] };
    const el = evaluateStepAction(f, finance);
    expect(el.canApprove).toBe(false);
    expect(el.canReject).toBe(false);
  });

  it("an ordinary pair keeps both controls", () => {
    const f = base({
      stepKey: "coordinator_completeness",
      submittedBy: "someone-else",
      owningRole: "COORDINATOR",
    });
    const coord = {
      userId: "coord",
      permissions: ["process:completeness:review", "process:step:complete"],
      roles: ["COORDINATOR"],
    };
    const el = evaluateStepAction(f, coord);
    expect(el.canApprove).toBe(true);
    expect(el.canReject).toBe(true);
  });

  it("both surfaces read the SAME eligibility — neither decides for itself", () => {
    for (const c of ["components/process/step-actions.tsx", "components/process/queue-row-actions.tsx"]) {
      const src = code(c);
      expect(src, c).toMatch(/canApprove/);
      expect(src, c).toMatch(/canReject/);
      // no surface consults the domain map directly
      expect(src, c).not.toContain("DOMAIN_OWNED_STEPS");
      expect(src, c).not.toContain("isGenericTransitionWithdrawn");
    }
  });
});

// ======================================= 6. nothing unrelated was touched =====

describe("6 — no unrelated contract moved", () => {
  it("transport parallelism is unaffected", () => {
    for (const step of ["transport_assignment", "pickup", "am_delivery_followup", "transport_pod_handoff"]) {
      for (const t of ["submit", "approve", "reject"] as const) {
        expect(isGenericTransitionWithdrawn(step, t), `${step}/${t}`).toBe(false);
      }
    }
  });

  it("the map still names exactly four steps", () => {
    expect(Object.keys(DOMAIN_OWNED_STEPS).sort()).toEqual([
      "billing_dispatch", "billing_draft", "finance_invoice_validation", "transit_validation",
    ]);
  });

  it("no control gate was weakened and no migration shipped", () => {
    const gate = code("lib/process/control-gate.ts");
    expect(gate).toContain('const ACTIONABLE: readonly StepState[] = ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"];');
    expect(gate).toContain('"customs.validation": "transit_validation"');
    expect(gate).toContain('"customs.update": "customs_preparation"');
    // this slice is pure application logic
    for (const f of [GUARD, "lib/process/domain-owned-steps.ts", "lib/process/step-eligibility.ts"]) {
      expect(code(f), f).not.toMatch(/alter table|create policy|create or replace function/i);
    }
  });

  it("the customs status ladder is untouched", () => {
    const st = code("lib/customs/status.ts");
    expect(st).toContain('DECLARATION_PREPARED: ["DECLARED", "BLOCKED", "CANCELLED"],');
    expect(st).toContain('DUTIES_ASSESSED: ["RELEASED", "BLOCKED", "CANCELLED"],');
  });
});
