/**
 * UAT-WF-STEP67-01 — the step 6 → step 7 maker-checker handoff.
 * ---------------------------------------------------------------------------
 * THE DEFECT, as it executed on EFT-IMP-2026-00011. The Déclarant prepared the
 * customs dossier, recorded the GAINDE reference and pressed « Terminer ».
 * Step 6 `customs_preparation` went to SUBMITTED, exactly as a maker step
 * should. Then nothing could happen ever again:
 *
 *   • step 7 `transit_validation` declares `customs_preparation` as its
 *     prerequisite, and `prerequisitesMet` demands a prerequisite be DONE
 *     (COMPLETED / APPROVED / SKIPPED). SUBMITTED is none of those, so
 *     `promoteSuccessors` never promoted it and its row stayed PENDING;
 *   • the preparer step only reaches COMPLETED through `approveStep`, which is
 *     the checker's own act — so the validator row is PENDING for the whole
 *     review BY CONSTRUCTION, and no handoff route targets it either;
 *   • `assertControlStep` read that PENDING row and refused the Chef de
 *     Transit's « Valider » control with « Cette étape n'est pas encore
 *     ouverte. » — permanently;
 *   • and `recordCustomsValidation`, the only production surface for this
 *     pair, certified the customs RECORD and never touched the official
 *     process at all. Nothing in production called `approveStep` for
 *     `customs_validation`; only the journey tests did, which is why the
 *     engine was green and the dossier was stuck.
 *
 * Two facts had one door and only one of them went through it. This suite pins
 * the deadlock, the gate's new fact, and the fact that neither the Déclarant
 * nor anybody else gained authority in the process.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CONTROL_OWNING_STEP,
  controlGateError,
  evaluateControlGate,
  CONTROL_GATE_MESSAGE_FR,
} from "@/lib/process/control-gate";
import {
  evaluateAvailableSteps,
  evaluateMakerChecker,
  preparerStepFor,
  prerequisitesMet,
  stepPermission,
  type ExecutionView,
} from "@/lib/process/engine/state";
import { getStep, MAKER_CHECKER_PAIRS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { FACT_RULES } from "@/lib/process/reconcile/satisfaction";
import type { StepState } from "@/lib/process/engine/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const server = read("../lib/process/control-gate-server.ts");
const customs = read("../lib/customs/actions.ts");
/** The RENDER path: what the browser's disabled state is actually computed from. */
const verdicts = read("../lib/process/control-ownership-server.ts");
const dossierPage = read("../app/files/[id]/page.tsx");
const panel = read("../components/customs/customs-panel.tsx");

/**
 * Every `evaluateControlGate({ ... })` argument object in a source file.
 *
 * Balanced-brace slice from the `({` to its matching `}`, so an assertion
 * cannot pass because the word appears somewhere else in the file. That is the
 * mistake that let UAT-BLOCKER-STEP67-PROD-02 through: the fix was real, the
 * pins were real, and neither looked at the second call site.
 */
function gateCallArgs(src: string): string[] {
  const out: string[] = [];
  const needle = "evaluateControlGate({";
  let at = src.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at + needle.length - 1, i + 1));
    at = src.indexOf(needle, i);
  }
  return out;
}

/** The body of the action the Chef de Transit's button calls, and nothing else. */
const validationFn = customs.slice(
  customs.indexOf("export async function recordCustomsValidation"),
  customs.indexOf("export async function correctCustoms"),
);

const ME = "user-chef";
const OTHER = "user-other";
const step = (state: string, assignedUserId: string | null = null) =>
  ({ state, assignedUserId }) as { state: StepState; assignedUserId: string | null };

/** The 6→7 pair as it stands the moment the Déclarant presses « Terminer ». */
const AFTER_SUBMIT: ExecutionView[] = [
  { stepKey: "transit_declarant_assignment", state: "COMPLETED" },
  { stepKey: "customs_preparation", state: "SUBMITTED", submittedBy: "user-declarant" },
  { stepKey: "transit_validation", state: "PENDING" },
];

describe("the deadlock is real — why the gate cannot read the validator row alone", () => {
  it("a SUBMITTED preparer does NOT satisfy its validator's prerequisite", () => {
    expect(getStep("transit_validation")!.prerequisites).toEqual(["customs_preparation"]);
    expect(
      prerequisitesMet("transit_validation", AFTER_SUBMIT),
      "SUBMITTED is not DONE — this is the engine's own rule and it is correct",
    ).toBe(false);
  });

  it("…so nothing can ever promote step 7 out of PENDING before its own review", () => {
    expect(
      evaluateAvailableSteps(AFTER_SUBMIT),
      "no promoter opens a validator step: its prerequisite is the work it reviews",
    ).not.toContain("transit_validation");
  });

  it("…and no reconciler stands in for the review either", () => {
    for (const key of ["customs_preparation", "transit_validation"]) {
      expect(FACT_RULES[key], `${key} must stay human-only`).toBeUndefined();
    }
  });

  it("`approveStep` therefore asks about the PREPARER, never the validator row", () => {
    // The engine's contract, stated as the pair registry states it: the review
    // is addressed by the VALIDATOR key and performed on the PREPARER's row.
    expect(preparerStepFor("transit_validation")).toBe("customs_preparation");
    expect(preparerStepFor("customs_preparation"), "the preparer is not a validator").toBeNull();
  });
});

describe("the gate — a SUBMITTED maker opens its checker's control", () => {
  it("ALLOWS the checker while the validator row is PENDING", () => {
    const r = evaluateControlGate({
      hasInstance: true,
      step: step("PENDING"),
      userId: ME,
      preparerState: "SUBMITTED",
    });
    expect(r).toEqual({ allowed: true, reason: "review_pending" });
    // `gateToError` maps every allowed verdict to null; the code exists only
    // for the refusals, and an allowed one must never become a `step_gate_*`.
    expect(controlGateError(r.reason)).toBe("forbidden");
  });

  it("REFUSES while the maker has not submitted — every other preparer state", () => {
    for (const preparerState of [
      "PENDING", "AVAILABLE", "ACTIVE", "BLOCKED", "COMPLETED", "APPROVED",
      "REJECTED", "SKIPPED", "CANCELLED", "UNVERIFIED_HISTORICAL",
    ] as StepState[]) {
      expect(
        evaluateControlGate({ hasInstance: true, step: step("PENDING"), userId: ME, preparerState }),
        preparerState,
      ).toEqual({ allowed: false, reason: "step_not_open" });
    }
  });

  it("does NOT reopen a review that is over", () => {
    // A validator row that is COMPLETED/REJECTED/SKIPPED/CANCELLED is a
    // finished review. A stale SUBMITTED preparer must not resurrect it, and
    // the sentence must stay « terminée », not « pas encore ouverte ».
    for (const state of ["COMPLETED", "APPROVED", "REJECTED", "SKIPPED", "CANCELLED"]) {
      expect(
        evaluateControlGate({
          hasInstance: true, step: step(state), userId: ME, preparerState: "SUBMITTED",
        }),
        state,
      ).toEqual({ allowed: false, reason: "step_closed" });
    }
  });

  it("keeps the assignment narrowing — a claimed review is still somebody else's", () => {
    expect(
      evaluateControlGate({
        hasInstance: true, step: step("PENDING", OTHER), userId: ME, preparerState: "SUBMITTED",
      }),
    ).toEqual({ allowed: false, reason: "assigned_to_another" });
    expect(
      evaluateControlGate({
        hasInstance: true, step: step("PENDING", ME), userId: ME, preparerState: "SUBMITTED",
      }),
    ).toEqual({ allowed: true, reason: "review_pending" });
  });

  it("changes NOTHING for a caller that passes no preparer fact (UI-1 intact)", () => {
    for (const preparerState of [undefined, null]) {
      const r = evaluateControlGate({
        hasInstance: true, step: step("PENDING"), userId: ME, preparerState,
      });
      expect(r).toEqual({ allowed: false, reason: "step_not_open" });
      expect(controlGateError(r.reason)).toBe("step_gate_step_not_open");
    }
    expect(CONTROL_GATE_MESSAGE_FR.step_not_open).toBe("Cette étape n'est pas encore ouverte.");
  });

  it("is NARROW — only a maker-checker validator control can be affected", () => {
    const affected = Object.entries(CONTROL_OWNING_STEP)
      .filter(([, stepKey]) => preparerStepFor(stepKey) !== null)
      .map(([controlId]) => controlId);
    expect(affected).toEqual(["customs.validation"]);
    // Every OTHER control's PENDING step is refused exactly as before, because
    // the server resolves no preparer for it at all.
    for (const [, stepKey] of Object.entries(CONTROL_OWNING_STEP)) {
      if (preparerStepFor(stepKey)) continue;
      expect(
        evaluateControlGate({ hasInstance: true, step: step("PENDING"), userId: ME }),
        stepKey,
      ).toEqual({ allowed: false, reason: "step_not_open" });
    }
  });
});

describe("the server loads the fact — not just the sentence", () => {
  it("resolves the owning step's PREPARER and passes its state to the rule", () => {
    expect(server).toContain('import { preparerStepFor } from "./engine/state"');
    expect(server).toMatch(/const preparerKey = preparerStepFor\(stepKey\)/);
    expect(server, "the pure rule must receive the fact").toMatch(/preparerState,\s*\}\)/);
  });

  it("reads BOTH rows in ONE query, keyed by step_key", () => {
    // `.eq("step_key", a).eq("step_key", b)` matches nothing and two `.in()`
    // filters are a cartesian product; a row must be identified by its own key.
    expect(server).toMatch(/\.in\("step_key", wantedKeys\)/);
    expect(server).toMatch(/select\("step_key, state, assigned_user_id"\)/);
    expect(server).toMatch(/rows\.find\(\(r\) => r\.step_key === key/);
  });

  it("reads the LIVE attempt of each step, never a frozen REJECTED one", () => {
    // `rejectStep` freezes the rejected row and creates a NEW attempt, so a
    // corrected step has two rows. The old `.limit(1)` returned whichever came
    // first and could refuse a correction with `step_closed`.
    expect(server).toMatch(
      /r\.state !== "REJECTED" && r\.state !== "CANCELLED"/,
    );
    expect(server).toMatch(/const exec = live\(stepKey\)/);
    expect(server).toMatch(/live\(preparerKey\)\?\.state/);
  });
});

describe("the Chef's act now reaches the official process", () => {
  it("recordCustomsValidation approves the pair by its VALIDATOR key", () => {
    expect(validationFn.length).toBeGreaterThan(0);
    expect(validationFn).toContain('approveStep(rec.file_id, "transit_validation")');
    // The result is KEPT — a discarded refusal is how a dossier reads
    // « validé » on a workflow that never moved.
    expect(validationFn).toMatch(/const advanced = await approveStep/);
    expect(validationFn).toMatch(/if \(!advanced\.ok && !noOfficialPair\)/);
    expect(validationFn).toContain("PROCESS_DISPATCH_NOT_ADVANCED");
    expect(validationFn).toContain('return { ok: false, error: "step_completion_failed" }');
  });

  it("…and does not fail a dossier that has no official process at all", () => {
    // The compatibility population `assertControlStep` itself defers on: the
    // engine dark for the tenant, or no process_instance on the dossier.
    expect(validationFn).toMatch(/advanced\.error === "engine_disabled"/);
    expect(validationFn).toMatch(/advanced\.error === "not_found"/);
  });

  it("the certification is written BEFORE the process is advanced", () => {
    expect(validationFn.indexOf('rpc("record_customs_validation"')).toBeLessThan(
      validationFn.indexOf("await approveStep"),
    );
  });
});

describe("nothing was broadened, and maker ≠ checker still holds", () => {
  it("the engine will demand the SAME permission the control already asserts", () => {
    expect(stepPermission("transit_validation")).toBe("customs:validate");
    expect(validationFn).toContain('assertPermission("customs:validate")');
  });

  it("the Déclarant holds no validation authority in any role template", () => {
    const declarant = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CUSTOMS_DECLARANT");
    expect(declarant, "the Déclarant template must exist").toBeTruthy();
    expect(declarant!.permissions).not.toContain("customs:validate");
  });

  it("self-validation is still refused on IDENTITY, with no reachable override", () => {
    expect(
      evaluateMakerChecker("user-declarant", "user-declarant", {
        overrideFlagOn: false, hasOverridePermission: false,
      }),
    ).toEqual({ allowed: false, reason: "self_validation_forbidden" });
    // No template grants process:override, so the seam is unreachable by role.
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.permissions, t.key).not.toContain("process:override");
    }
  });

  it("both halves of authorship are still disqualified at the panel's door", () => {
    expect(validationFn).toMatch(/rec\.created_by === user\.id/);
    expect(validationFn).toMatch(/rec\.updated_by === user\.id/);
    expect(validationFn).toMatch(/rec\.reviewed_at\) return \{ ok: false, error: "already_validated" \}/);
  });

  it("the registry's pair definitions are untouched", () => {
    expect(MAKER_CHECKER_PAIRS.map((p) => p.key)).toEqual([
      "customs_validation", "invoice_validation", "completeness_review",
    ]);
    expect(MAKER_CHECKER_PAIRS.find((p) => p.key === "customs_validation")).toMatchObject({
      preparerStep: "customs_preparation",
      validatorStep: "transit_validation",
      correctionStep: "customs_preparation",
      selfApprovalAllowed: false,
    });
  });

  it("the parallel activities depend on neither half of the pair", () => {
    for (const activity of PARALLEL_ACTIVITIES) {
      expect(activity.prerequisites, activity.key).not.toContain("customs_preparation");
      expect(activity.prerequisites, activity.key).not.toContain("transit_validation");
    }
    // …and the pair does not wait on them either, so the customs branch and the
    // transport-readiness branch stay siblings.
    expect(getStep("customs_preparation")!.prerequisites).toEqual(["transit_declarant_assignment"]);
  });
});

describe("ONE rule, TWO evaluators — the parity that was missing", () => {
  /**
   * UAT-BLOCKER-STEP67-PROD-02. `assertControlStep` refuses a CLICK.
   * `getControlVerdicts` decides whether there is a click to refuse, and it is
   * what the dossier page renders `disabled` from. Teaching the first that a
   * SUBMITTED maker opens its checker's control changed nothing an operator
   * could reach, because the second still answered `step_not_open`.
   *
   * These tests are about the CLASS, not the instance: any future fact added
   * to the gate must reach both, and a third caller must not appear silently.
   */
  it("has exactly the two known callers of the gate, and no more", () => {
    const callers = [
      ["lib/process/control-gate-server.ts", server],
      ["lib/process/control-ownership-server.ts", verdicts],
    ] as const;
    for (const [name, src] of callers) {
      expect(gateCallArgs(src).length, `${name} must call the gate`).toBeGreaterThan(0);
    }
    // The pure module defines it; nothing else may evaluate it. A new caller is
    // a new place for the fact set to drift, and must come with its own pin.
    expect(gateCallArgs(read("../lib/process/control-gate.ts")).length).toBe(0);
  });

  it("EVERY gate call passes the preparer fact — including the render path", () => {
    for (const [name, src] of [
      ["control-gate-server.ts", server],
      ["control-ownership-server.ts", verdicts],
    ] as const) {
      const args = gateCallArgs(src);
      for (const [i, a] of args.entries()) {
        // The no-instance compatibility branch answers `allowed` and asks
        // nothing about steps, so it needs no preparer.
        if (/step:\s*null/.test(a) && /hasInstance:\s*false/.test(a)) continue;
        expect(a, `${name} gate call #${i + 1} omits preparerState: ${a}`).toContain("preparerState");
      }
    }
  });

  it("the render path resolves the preparer from the registry, per control", () => {
    expect(verdicts).toContain('import { preparerStepFor } from "./engine/state"');
    expect(verdicts).toMatch(/const preparerKey = preparerStepFor\(stepKey\)/);
    // …and LOADS it: a verdict computed from a row that was never fetched is
    // indistinguishable from one computed from PENDING.
    expect(verdicts).toMatch(/owningSteps\.map\(\(k\) => preparerStepFor\(k\)\)/);
    expect(verdicts).toMatch(/execByStep\.get\(preparerKey\)\?\.state/);
  });

  it("the render path keeps the LIVE attempt too", () => {
    // A last-wins map over two rows renders the verdict for whichever the
    // database returned second. Both sides now prefer the live attempt.
    expect(verdicts).toMatch(/r\.state === "REJECTED" \|\| r\.state === "CANCELLED"/);
    expect(server).toMatch(/r\.state !== "REJECTED" && r\.state !== "CANCELLED"/);
  });
});

describe("the production rendering path, pinned end to end", () => {
  it("the dossier page asks getControlVerdicts for the Chef's control", () => {
    expect(dossierPage).toContain("getControlVerdicts(");
    expect(dossierPage).toContain('"customs.validation"');
  });

  it("the panel's disabled state and its sentence both come from that verdict", () => {
    expect(panel).toContain('disabled={pending || !gateOpen("customs.validation")}');
    expect(panel).toContain('<GateHint reason={gateReason("customs.validation")} />');
    // `gateOpen` reads `allowed`; `gateReason` reads `reasonFr`. Both are the
    // verdict's own fields, so there is no third opinion in the client.
    expect(panel).toMatch(/const gateOpen = \(controlId: string\) => gates\[controlId\]\?\.allowed \?\? true/);
    expect(panel).toMatch(/const gateReason = \(controlId: string\) => gates\[controlId\]\?\.reasonFr \?\? null/);
  });

  it("a validator control refused for lack of a submission still says NOT YET", () => {
    // The render path's own composition, exercised through the pure rule it
    // uses: no submission ⇒ the same sentence as before, unchanged.
    const r = evaluateControlGate({
      hasInstance: true,
      step: step("PENDING"),
      userId: ME,
      preparerState: "ACTIVE",
    });
    expect(r).toEqual({ allowed: false, reason: "step_not_open" });
    expect(CONTROL_GATE_MESSAGE_FR[controlGateError(r.reason).slice("step_gate_".length)])
      .toBe("Cette étape n'est pas encore ouverte.");
  });
});
