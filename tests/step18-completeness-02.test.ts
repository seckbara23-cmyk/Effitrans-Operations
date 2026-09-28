/**
 * STEP18-COMPLETENESS-02 — the checker's half of `completeness_review`.
 *
 * The engine was never wrong. `coordinator_completeness` → `am_completeness` is
 * one of the three ratified `MAKER_CHECKER_PAIRS`, and the engine has always
 * been willing to complete it: `submitStep` parks the preparer at SUBMITTED,
 * `approveStep` completes both halves and promotes `billing_draft`. What did not
 * exist was any way to ASK it. `StepActions` offered Démarrer and Terminer;
 * neither the coordination nor the account-management queue declared an
 * `approve` action; and the one call site that did exist passed the SUBMITTED
 * row's own key where the VALIDATOR's was required, so it could not have
 * succeeded even if a button had been rendered.
 *
 * On EFT-IMP-2026-00013 that left step 18 SUBMITTED, step 19 PENDING and steps
 * 20-26 unreachable, with the billing gate correctly reporting both completeness
 * controls outstanding.
 *
 * These tests pin the repair AND — at least as deliberately — everything it was
 * forbidden to touch: the doctrine, the classification of RECEIPT and
 * PAYMENT_PROOF, maker/checker independence, and the absence of any override.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAKER_CHECKER_PAIRS,
  getStep,
} from "@/lib/process/effitrans-process";
import {
  canTransitionStep,
  correctionStepFor,
  evaluateMakerChecker,
  isValidationStep,
  preparerStepFor,
  prerequisitesMet,
  requiresIndependentReview,
  stepPermission,
  validatorStepFor,
  type ExecutionView,
} from "@/lib/process/engine/state";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import {
  blockingRequirements,
  blocksCompletion,
  governanceFor,
  CLASSIFIED,
} from "@/lib/process/requirement-class";
import { evaluateBillingGate } from "@/lib/process/engine/gates";
import type { EvidenceSnapshot, StepEvidence } from "@/lib/process/engine/evidence";
import { getQueue } from "@/lib/process/queues/registry";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — a pin must match CODE, never a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENGINE = "lib/process/engine/actions.ts";
const ELIGIBILITY = "lib/process/step-eligibility.ts";
const QUEUE_ACTIONS = "lib/process/queues/actions.ts";
const QUEUE_REGISTRY = "lib/process/queues/registry.ts";
const STEP_ACTIONS = "components/process/step-actions.tsx";
const BUILD = "lib/process/contextual/build.ts";

const PREPARER = "coordinator_completeness";
const VALIDATOR = "am_completeness";

const MAKER = "user-coordinator-maker";
const CHECKER = "user-account-manager-checker";
const REVIEW_PERMISSION = "process:completeness:review";

/** Step 18's facts as production actually holds them on 00013. */
const submittedFacts = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: PREPARER,
  state: "SUBMITTED",
  assignedUserId: MAKER,
  submittedBy: MAKER,
  custody: "not_applicable",
  owningRole: "COORDINATOR",
  missingPrerequisites: [],
  // Exactly what 00013 carries: both informational requirements outstanding.
  requirements: [
    { key: "RECEIPT", labelFr: "Reçu", status: "missing" },
    { key: "PAYMENT_PROOF", labelFr: "Preuve de paiement", status: "missing" },
  ],
  ...over,
});

const viewer = (userId: string, permissions: string[] = [REVIEW_PERMISSION]) => ({
  userId,
  permissions,
  roles: ["ACCOUNT_MANAGER", "COORDINATOR"],
});

const evidence = (missing: string[]): StepEvidence => ({
  items: missing.map((key) => ({ key, labelFr: key, status: "missing" as const })),
  satisfied: [],
  missing,
  invalid: [],
  pendingReview: [],
  unauthorized: [],
  complete: missing.length === 0,
});

const done = (...keys: string[]): ExecutionView[] =>
  keys.map((stepKey) => ({ stepKey, state: "COMPLETED" as const }));

const snapshot = (docs: { typeCode: string; status: string }[] = []): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: docs,
  customs: null,
  transport: null,
  invoices: [],
});

// ===========================================================================
// A — submission parks at SUBMITTED and promotes nothing
// ===========================================================================
describe("A · step 18 submission", () => {
  it("A1 — coordinator_completeness is a maker/checker PREPARER", () => {
    expect(requiresIndependentReview(PREPARER)).toBe(true);
    expect(isValidationStep(PREPARER)).toBe(false);
    expect(isValidationStep(VALIDATOR)).toBe(true);
    expect(preparerStepFor(VALIDATOR)).toBe(PREPARER);
  });

  it("A2 — so submitStep targets SUBMITTED, not COMPLETED", () => {
    const src = code(ENGINE);
    expect(src).toContain("const needsReview = requiresIndependentReview(stepKey);");
    expect(src).toContain('const target: StepState = needsReview ? "SUBMITTED" : "COMPLETED";');
    expect(canTransitionStep("ACTIVE", "SUBMITTED")).toBe(true);
  });

  it("A3 — and step 20 is NOT promoted by the submission", () => {
    // The guard that makes a submitted pair wait for its checker.
    expect(code(ENGINE)).toContain('if (target === "COMPLETED") {');
    // Structurally: SUBMITTED is not a done state, so the successor's
    // prerequisite is unmet and nothing could promote it anyway.
    expect(prerequisitesMet("billing_draft", [{ stepKey: VALIDATOR, state: "SUBMITTED" }])).toBe(false);
    expect(prerequisitesMet(VALIDATOR, [{ stepKey: PREPARER, state: "SUBMITTED" }])).toBe(false);
  });

  it("A4 — a lenient submission still records what was outstanding", () => {
    expect(code(ENGINE)).toContain("evidence_summary: { satisfied: ev.satisfied, missing: ev.missing }");
  });
});

// ===========================================================================
// B, C, L — the two informational requirements are untouched
// ===========================================================================
describe("B, C, L · RECEIPT and PAYMENT_PROOF remain unclassified and non-blocking", () => {
  it("B — a missing Reçu does not block", () => {
    const g = governanceFor(PREPARER, "RECEIPT");
    expect(g.klass).toBe("FLAG_FOR_RULING");
    expect(g.ratified).toBe(false);
    expect(blocksCompletion(g)).toBe(false);
  });

  it("C — a missing Preuve de paiement does not block", () => {
    const g = governanceFor(PREPARER, "PAYMENT_PROOF");
    expect(g.klass).toBe("FLAG_FOR_RULING");
    expect(g.ratified).toBe(false);
    expect(blocksCompletion(g)).toBe(false);
  });

  it("B+C — with BOTH absent, nothing blocks completion of step 18", () => {
    expect(blockingRequirements(PREPARER, evidence(["RECEIPT", "PAYMENT_PROOF"]))).toEqual([]);
  });

  it("L — neither key gained a classification (the deliberate absence holds)", () => {
    expect(CLASSIFIED[`${PREPARER}::RECEIPT`]).toBeUndefined();
    expect(CLASSIFIED[`${PREPARER}::PAYMENT_PROOF`]).toBeUndefined();
    // …and the registry still declares them as step 18's documents, unchanged.
    expect(getStep(PREPARER)!.requiredDocuments).toEqual(["RECEIPT", "PAYMENT_PROOF"]);
  });

  it("L2 — the leniency default itself is unchanged", () => {
    // Only a RULED blocker blocks. FLAG_FOR_RULING must never become a gate by
    // implementation side effect.
    expect(blocksCompletion({ klass: "HARD_GATE", ratified: true, mandatoryAtFr: null, source: "x" })).toBe(true);
    expect(blocksCompletion({ klass: "FLAG_FOR_RULING", ratified: false, mandatoryAtFr: null, source: "" })).toBe(false);
    expect(blocksCompletion({ klass: "INFORMATIONAL", ratified: true, mandatoryAtFr: null, source: "x" })).toBe(false);
  });
});

// ===========================================================================
// D, E — who is offered the review
// ===========================================================================
describe("D, E · action exposure", () => {
  it("D — the MAKER is never offered the approval", () => {
    const el = evaluateStepAction(submittedFacts(), viewer(MAKER));
    expect(el.isSubmitter).toBe(true);
    expect(el.canApprove).toBe(false);
    expect(el.canReject).toBe(false);
    // …and is told why, rather than shown a silent row.
    expect(el.reasonFr).toContain("vous ne pouvez pas valider votre propre contrôle");
  });

  it("E — a DIFFERENT holder of the review permission IS offered it", () => {
    const el = evaluateStepAction(submittedFacts(), viewer(CHECKER));
    expect(el.isSubmitter).toBe(false);
    expect(el.canApprove).toBe(true);
    expect(el.canReject).toBe(true);
    expect(el.reviewStepKey).toBe(VALIDATOR);
    expect(el.reviewPermission).toBe(REVIEW_PERMISSION);
  });

  it("E2 — without the review permission, nothing is offered", () => {
    expect(stepPermission(VALIDATOR)).toBe(REVIEW_PERMISSION);
    const withoutIt = evaluateStepAction(submittedFacts(), viewer(CHECKER, ["process:read"]));
    expect(withoutIt.canApprove).toBe(false);
    expect(withoutIt.reasonFr).toBe("En attente de validation indépendante.");
  });

  it("E2b — the permission asked is the VALIDATOR's, NOT the submitted row's", () => {
    // For `completeness_review` the two coincide, so this pair can never prove
    // the rule. `customs_validation` can: the Déclarant prepares under
    // customs:create/update and only the Chef validates, under customs:validate.
    // Asking the row's own permission would have offered the Déclarant the
    // Chef's independent validation of their own declaration.
    expect(stepPermission("customs_preparation")).toBe("customs:create");
    expect(stepPermission("transit_validation")).toBe("customs:validate");

    const customsFacts = submittedFacts({
      stepKey: "customs_preparation",
      owningRole: "CUSTOMS_DECLARANT",
      requirements: [],
    });

    // Holds the PREPARER's permission only → no review.
    const declarant = evaluateStepAction(customsFacts, {
      userId: CHECKER,
      permissions: ["customs:create", "customs:update"],
      roles: ["CUSTOMS_DECLARANT"],
    });
    expect(declarant.reviewStepKey).toBe("transit_validation");
    expect(declarant.reviewPermission).toBe("customs:validate");
    expect(declarant.canApprove).toBe(false);

    // Holds the VALIDATOR's permission → review offered.
    const chef = evaluateStepAction(customsFacts, {
      userId: CHECKER,
      permissions: ["customs:validate"],
      roles: ["CHIEF_TRANSIT"],
    });
    expect(chef.canApprove).toBe(true);
    expect(chef.canReject).toBe(true);
  });

  it("E3 — an UNKNOWN maker is never assumed to be somebody else", () => {
    for (const submittedBy of [null, undefined, ""]) {
      const el = evaluateStepAction(submittedFacts({ submittedBy }), viewer(CHECKER));
      expect(el.canApprove, String(submittedBy)).toBe(false);
    }
  });

  it("E4 — the review is offered ONLY from SUBMITTED", () => {
    for (const state of ["PENDING", "AVAILABLE", "ACTIVE", "COMPLETED", "REJECTED", "BLOCKED"]) {
      expect(evaluateStepAction(submittedFacts({ state }), viewer(CHECKER)).canApprove, state).toBe(false);
    }
  });

  it("E5 — an ordinary step offers no review at all", () => {
    const el = evaluateStepAction(
      submittedFacts({ stepKey: "pickup", state: "SUBMITTED", owningRole: "PICKUP_AGENT" }),
      viewer(CHECKER),
    );
    expect(el.reviewStepKey).toBeNull();
    expect(el.reviewPermission).toBeNull();
    expect(el.canApprove).toBe(false);
  });

  it("E6 — the outstanding informational requirements do not suppress the review", () => {
    // Step 18 was submitted WITH both missing; a checker must still be able to
    // act on it, or leniency would have created a different dead end.
    const el = evaluateStepAction(submittedFacts(), viewer(CHECKER));
    expect(el.requirements.every((r) => !r.blocking)).toBe(true);
    expect(el.canApprove).toBe(true);
  });

  it("D/E — the process page renders exactly that verdict", () => {
    const src = code(STEP_ACTIONS);
    expect(src).toContain("{eligibility.canApprove && (");
    expect(src).toContain("{eligibility.canReject && (");
    expect(src).toContain("Valider");
    expect(src).toContain("Rejeter");
    // The existing lifecycle is untouched.
    expect(src).toContain("{eligibility.canStart && (");
    expect(src).toContain("{eligibility.canSubmit && (");
    expect(src).toContain("Démarrer");
    expect(src).toContain("Terminer");
    // It decides nothing itself: no maker comparison, no permission test.
    expect(src).not.toContain("submittedBy");
    expect(src).not.toContain("hasPermission");
  });
});

// ===========================================================================
// F — the server is the control
// ===========================================================================
describe("F · self-approval is refused server-side", () => {
  it("F1 — maker == checker is refused with no override available", () => {
    const d = evaluateMakerChecker(MAKER, MAKER, {
      overrideFlagOn: false,
      hasOverridePermission: false,
    });
    expect(d.allowed).toBe(false);
    // Narrowed, so a decision that unexpectedly ALLOWED fails here rather than
    // silently skipping the assertion.
    if (d.allowed) throw new Error("self-approval was allowed");
    expect(d.reason).toBe("self_validation_forbidden");
  });

  it("F2 — even holding the permission, without the flag it is refused", () => {
    const noFlag = evaluateMakerChecker(MAKER, MAKER, {
      overrideFlagOn: false,
      hasOverridePermission: true,
    });
    expect(noFlag.allowed).toBe(false);

    // …and with the flag AND the permission but no motif, still refused.
    const noReason = evaluateMakerChecker(MAKER, MAKER, {
      overrideFlagOn: true,
      hasOverridePermission: true,
    });
    expect(noReason.allowed).toBe(false);
    if (noReason.allowed) throw new Error("self-approval was allowed");
    expect(noReason.reason).toBe("reason_required");
  });

  it("F3 — a different identity is allowed", () => {
    expect(
      evaluateMakerChecker(MAKER, CHECKER, { overrideFlagOn: false, hasOverridePermission: false }).allowed,
    ).toBe(true);
  });

  it("F4 — approveStep consults it on IDENTITY, before writing anything", () => {
    const src = code(ENGINE);
    expect(src).toContain("const decision = evaluateMakerChecker(st.submittedBy, c.userId, {");
    expect(src).toContain("if (!decision.allowed) return fail(decision.reason);");
    // …and only ever from SUBMITTED.
    expect(src).toContain('if (st.state !== "SUBMITTED") return fail("invalid_state");');
    // The UI cannot be the boundary: the action re-guards the permission itself.
    expect(src).toContain("const permission = getNode(validatorStepKey)?.permissions[0] ?? \"process:manage\";");
  });

  it("F5 — the eligibility layer is advertised as exposure, never as authority", () => {
    const src = read(ELIGIBILITY);
    expect(src).toContain("Exposure only");
    expect(src).toContain("can hide a button the");
  });
});

// ===========================================================================
// G — the queue seam resolves preparer → validator
// ===========================================================================
describe("G · approval resolves to the VALIDATOR step", () => {
  it("G1 — the registry gives the inverse lookup", () => {
    expect(validatorStepFor(PREPARER)).toBe(VALIDATOR);
    expect(validatorStepFor(VALIDATOR)).toBeNull(); // not a preparer
    expect(validatorStepFor("pickup")).toBeNull();
  });

  it("G2 — it is derived from MAKER_CHECKER_PAIRS, for EVERY pair", () => {
    for (const p of MAKER_CHECKER_PAIRS) {
      expect(validatorStepFor(p.preparerStep), p.key).toBe(p.validatorStep);
      expect(preparerStepFor(p.validatorStep), p.key).toBe(p.preparerStep);
    }
  });

  it("G3 — the queue proxy resolves before calling the engine", () => {
    const src = code(QUEUE_ACTIONS);
    expect(src).toContain("function resolveValidatorStep(stepKey: string): string | null {");
    expect(src).toContain("if (isValidationStep(stepKey)) return stepKey;");
    expect(src).toContain("return validatorStepFor(stepKey);");
    expect(src).toContain("const validatorStepKey = resolveValidatorStep(stepKey);");
    expect(src).toContain("await approveStep(fileId, validatorStepKey)");
    expect(src).toContain("await rejectStep(fileId, validatorStepKey, reason)");
  });

  it("G4 — it refuses safely when the key is neither half of a pair", () => {
    const src = code(QUEUE_ACTIONS);
    expect((src.match(/if \(!validatorStepKey\) return \{ ok: false, error: "unknown_step" \};/g) ?? []).length)
      .toBe(2);
  });

  it("G5 — no step key is hard-coded into the seam", () => {
    const src = code(QUEUE_ACTIONS);
    expect(src).not.toContain(PREPARER);
    expect(src).not.toContain(VALIDATOR);
    expect(code(ELIGIBILITY)).not.toContain(PREPARER);
    expect(code(ELIGIBILITY)).not.toContain(VALIDATOR);
    expect(code(STEP_ACTIONS)).not.toContain(PREPARER);
  });
});

// ===========================================================================
// H, I — what approval achieves
// ===========================================================================
describe("H, I · approval completes the pair and opens billing", () => {
  it("H1 — the preparer moves SUBMITTED → COMPLETED by compare-and-set", () => {
    const src = code(ENGINE);
    expect(src).toContain('const ok = await cas(st.execId, c.tenantId, "SUBMITTED", {');
    expect(src).toContain('state: "COMPLETED",');
    expect(src).toContain("reviewed_by: c.userId,");
  });

  it("H2 — the validation step is completed in the same act", () => {
    const src = code(ENGINE);
    expect(src).toContain(
      '.update({ state: "COMPLETED", reviewed_by: c.userId, reviewed_at: now, completed_at: now })',
    );
  });

  it("H3 — and BOTH halves then hand work on", () => {
    const src = code(ENGINE);
    expect(src).toContain("await promoteSuccessors(c.tenantId, fileId, c.permissions, preparerKey, c.userId);");
    expect(src).toContain("await promoteSuccessors(c.tenantId, fileId, c.permissions, validatorStepKey, c.userId);");
  });

  it("H4 — billing_draft's prerequisite is exactly the validator step", () => {
    expect(getStep("billing_draft")!.prerequisites).toEqual([VALIDATOR]);
    expect(prerequisitesMet("billing_draft", done(VALIDATOR))).toBe(true);
    expect(prerequisitesMet("billing_draft", [{ stepKey: VALIDATOR, state: "PENDING" }])).toBe(false);
  });

  it("I — the billing gate then reports both completeness controls satisfied", () => {
    const pod = snapshot([{ typeCode: "DELIVERY_NOTE", status: "VERIFIED" }]);

    // Before: step 18 SUBMITTED is NOT done, so both remain outstanding.
    const before = evaluateBillingGate([{ stepKey: PREPARER, state: "SUBMITTED" }], pod);
    expect(before.ready).toBe(false);
    expect(before.missing).toContain("coordinator_completeness");
    expect(before.missing).toContain("am_completeness");

    // After: one act completes both, and the gate opens.
    const after = evaluateBillingGate(done(PREPARER, VALIDATOR), pod);
    expect(after.requirements.find((r) => r.key === "coordinator_completeness")?.satisfied).toBe(true);
    expect(after.requirements.find((r) => r.key === "am_completeness")?.satisfied).toBe(true);
    expect(after.missing).toEqual([]);
    expect(after.ready).toBe(true);
  });

  it("I2 — the POD requirement is unchanged by any of this", () => {
    const noPod = evaluateBillingGate(done(PREPARER, VALIDATOR), snapshot());
    expect(noPod.ready).toBe(false);
    expect(noPod.missing).toEqual(["pod_received"]);
  });
});

// ===========================================================================
// J — rejection follows the ratified contract
// ===========================================================================
describe("J · rejection", () => {
  it("J1 — am_completeness sends the work back to coordinator_completeness", () => {
    expect(correctionStepFor(VALIDATOR)).toBe(PREPARER);
    expect(getStep(VALIDATOR)!.rejectsTo).toBe(PREPARER);
    const pair = MAKER_CHECKER_PAIRS.find((p) => p.key === "completeness_review")!;
    expect(pair.correctionStep).toBe(PREPARER);
    expect(pair.reasonRequired).toBe(true);
    expect(pair.selfApprovalAllowed).toBe(false);
  });

  it("J2 — a reason is mandatory, and the checker may not be the maker", () => {
    const src = code(ENGINE);
    const fn = src.slice(src.indexOf("export async function rejectStep"));
    expect(fn).toContain('if (!reason || reason.trim().length === 0) return fail("reason_required");');
    // A rejection is a review too: same identity rule, same refusal.
    expect(fn).toContain("evaluateMakerChecker(st.submittedBy, c.userId, {");
    expect(fn).toContain("if (!decision.allowed) return fail(decision.reason);");
    expect(fn).toContain('if (st.state !== "SUBMITTED") return fail("invalid_state");');
    // The rejected attempt is FROZEN and a NEW correction row is created — the
    // existing lifecycle, not a new one.
    expect(fn).toContain('state: "REJECTED",');
    expect(fn).toContain("correction_of_id: st.execId,");
    // …and it is the pair's own correction step that reopens.
    expect(fn).toContain("const correctionKey = correctionStepFor(validatorStepKey);");
  });

  it("J3 — the surface collects the motif before calling", () => {
    const src = code(STEP_ACTIONS);
    expect(src).toContain('window.prompt("Motif du rejet (obligatoire) :")');
    expect(src).toContain('setError("Un motif est obligatoire.");');
  });
});

// ===========================================================================
// K — no override was introduced
// ===========================================================================
describe("K · the override remains unavailable", () => {
  it("K1 — process:override is granted to no role template", () => {
    const templates = read("lib/platform/role-templates.ts");
    expect(templates).not.toContain('"process:override"');
  });

  it("K2 — and nothing in this slice asks for one", () => {
    for (const f of [ELIGIBILITY, QUEUE_ACTIONS, QUEUE_REGISTRY, STEP_ACTIONS, BUILD]) {
      expect(code(f), f).not.toContain("process:override");
      expect(code(f), f).not.toContain("overrideReason");
      expect(code(f), f).not.toContain("selfApproval");
    }
  });

  it("K3 — the queue proxies pass no override option through", () => {
    const src = code(QUEUE_ACTIONS);
    expect(src).toContain("await approveStep(fileId, validatorStepKey)");
    expect(src).not.toMatch(/approveStep\([^)]*overrideReason/);
  });
});

// ===========================================================================
// M — the other two pairs do not regress
// ===========================================================================
describe("M · customs_validation and invoice_validation are untouched", () => {
  it("M1 — all three ratified pairs still exist, with independence required", () => {
    expect(MAKER_CHECKER_PAIRS.map((p) => p.key).sort()).toEqual([
      "completeness_review", "customs_validation", "invoice_validation",
    ]);
    for (const p of MAKER_CHECKER_PAIRS) {
      expect(p.selfApprovalAllowed, p.key).toBe(false);
      expect(p.reasonRequired, p.key).toBe(true);
    }
  });

  it("M2 — their dedicated call sites still address the engine by the VALIDATOR key", () => {
    expect(code("lib/customs/actions.ts")).toContain('approveStep(rec.file_id, "transit_validation")');
    expect(code("lib/process/billing/actions.ts")).toContain('approveStep(fileId, "finance_invoice_validation")');
    expect(code("lib/process/billing/actions.ts")).toContain('rejectStep(fileId, "finance_invoice_validation"');
  });

  it("M3 — a validator key passed to the queue proxy still resolves to itself", () => {
    // So those existing callers would be unaffected if they ever routed here.
    for (const p of MAKER_CHECKER_PAIRS) {
      expect(isValidationStep(p.validatorStep), p.key).toBe(true);
    }
  });

  it("M4 — the transit queue keeps its review actions; coordination gains none", () => {
    expect(getQueue("transit")!.actions).toContain("approve");
    expect(getQueue("finance")!.actions).toContain("approve");
    // The PREPARER's queue must not offer the review: its owner is the maker.
    expect(getQueue("coordination")!.actions).not.toContain("approve");
    expect(getQueue("coordination")!.actions).not.toContain("reject");
  });

  it("M5 — the account-management queue, which owns the validator, may review", () => {
    const q = getQueue("account_management")!;
    expect(q.actions).toContain("approve");
    expect(q.actions).toContain("reject");
    // …and keeps everything it already offered.
    for (const a of ["receive_handoff", "reject_handoff", "assign", "start", "submit", "send_handoff"]) {
      expect(q.actions, a).toContain(a);
    }
  });
});

// ===========================================================================
// Scope discipline
// ===========================================================================
describe("scope · nothing beyond D-1/D-2 moved", () => {
  it("no migration ships with this slice", () => {
    const files = readFileSync(join(root, "lib/platform/ops/build-info.ts"), "utf8");
    expect(files).toContain('LATEST_MIGRATION = "20261007000001_delivery_note_signed_label"');
    expect(files).toContain("MIGRATION_COUNT = 145");
  });

  it("the document doctrine and catalogue vocabulary are untouched", () => {
    const docs = code("lib/process/documents.ts");
    expect(docs).toContain('key: "RECEIPT"');
    expect(docs).toContain('key: "PAYMENT_PROOF"');
    // Both still resolve to the one catalogue type — D-3, deferred, not fixed.
    expect((docs.match(/typeCode: "PAYMENT_RECEIPT"/g) ?? []).length).toBe(2);
  });

  it("the eligibility layer added exposure fields only — no new authority", () => {
    const src = code(ELIGIBILITY);
    expect(src).toContain("canApprove: boolean;");
    expect(src).toContain("canReject: boolean;");
    // It still never touches the database or a server action.
    expect(src).not.toMatch(/\.(insert|update|delete)\(/);
    expect(src).not.toContain("getAdminSupabaseClient");
  });
});
