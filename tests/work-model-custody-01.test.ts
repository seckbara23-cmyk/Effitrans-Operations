/**
 * WORK-MODEL-CUSTODY-01 — the work model may not be stricter than the engine.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG. `kindOf` decided that an AVAILABLE step was "blocked" by
 * reading the RAW custody state:
 *
 *     e.custody === "awaiting_reception" || e.custody === "awaiting_transmission"
 *
 * That is the rule for a route which REQUIRES reception. Three of the four
 * ratified routes deliberately do not, and on those `awaiting_transmission` is
 * the NORMAL resting state: no handoff row is ever created for them, so the
 * state never changes and the step stayed bucketed as blocked for ever.
 *
 * On EFT-IMP-2026-00013 that put official step 23 under « Bloquées — Un
 * prérequis ratifié n'est pas satisfait. » while, proven against production:
 * the step was AVAILABLE, its prerequisite `billing_dispatch` was COMPLETED,
 * `FINAL_INVOICE` was satisfied by a genuinely ISSUED invoice, and the engine's
 * own `custodyRefusalForState` returned null. The server would have accepted
 * « Démarrer ». The read model refused to offer it — stricter than the action
 * layer, which the contract at the top of `step-eligibility.ts` forbids.
 *
 * THIS IS THE SECOND TIME. `step-eligibility` carried the identical copy and was
 * corrected in UAT-STEP10-HANDOFF-01, after step 10 of EFT-IMP-2026-00011 became
 * unstartable for the Coordinator. `StepEligibility` has exposed `custodyRefusal`
 * ever since, precisely so no consumer needs to re-derive it. This file kept the
 * copy that had already been disproved.
 *
 * So these tests are written against the ENGINE'S rule rather than against a
 * restatement of it: every case below builds its verdict with the real
 * `evaluateStepAction` and the real route table, and the last one asserts the
 * structural property — that the work model never inspects raw custody at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDossierWork, type WorkNode } from "@/lib/process/work-model";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import {
  custodyRefusalForState,
  custodyStateFor,
  routeTo,
  HANDOFF_ROUTES,
} from "@/lib/process/handoff-routes";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES, PROCESS_STEP_COUNT } from "@/lib/process/effitrans-process";

/** The Chargé administratif who owns step 23 on 00013. */
const ADMINISTRATION = {
  userId: "u-adm-demo",
  permissions: ["admin_service:manage", "courier:assign", "finance:read"],
  roles: ["ADMINISTRATIVE_OFFICER"],
};
/** The Coordinator who owns step 10 — the route that DOES require reception. */
const COORDINATOR = {
  userId: "u-coord",
  permissions: ["customs:update", "process:handoff:send"],
  roles: ["COORDINATOR"],
};

const facts = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: "administration_deposit_prep",
  state: "AVAILABLE",
  assignedUserId: null,
  custody: "not_applicable",
  owningRole: "ADMINISTRATIVE_OFFICER",
  missingPrerequisites: [],
  requirements: [],
  notApplicable: null,
  ...over,
});

function node(f: StepActionFacts, viewer = ADMINISTRATION): WorkNode {
  const registry = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES].find((n) => n.key === f.stepKey);
  return {
    stepKey: f.stepKey,
    stepNumber: registry?.stepNumber ?? null,
    labelFr: registry?.labelFr ?? f.stepKey,
    state: f.state,
    branch: registry?.parallelGroup ?? "main",
    ownerLabelFr: null,
    assigneeLabel: null,
    eligibility: evaluateStepAction(f, viewer),
  } as WorkNode;
}

const classify = (f: StepActionFacts, viewer = ADMINISTRATION) => {
  const w = buildDossierWork({
    nodes: [node(f, viewer)],
    officialTotal: PROCESS_STEP_COUNT,
    activitiesTotal: PARALLEL_ACTIVITIES.length,
  });
  const key = f.stepKey;
  if (w.blocked.some((i) => i.stepKey === key)) return "blocked";
  if (w.current.some((i) => i.stepKey === key)) return "current";
  if (w.parallel.some((i) => i.stepKey === key)) return "parallel";
  if (w.upcoming.some((i) => i.stepKey === key)) return "upcoming";
  if (w.notApplicable.some((i) => i.stepKey === key)) return "not_applicable";
  return "(absent)";
};

// =================================================== 1. the reported defect ====

describe("a requiresReception:false route is not blocked by awaiting_transmission", () => {
  it("1 — the EFT-IMP-2026-00013 shape is offered, not blocked", () => {
    const f = facts({ custody: "awaiting_transmission" });

    // The engine's own verdict first, so the expectation is not a restatement.
    expect(routeTo("administration_deposit_prep")?.requiresReception).toBe(false);
    expect(custodyRefusalForState("administration_deposit_prep", "awaiting_transmission")).toBeNull();

    expect(classify(f)).not.toBe("blocked");
    expect(classify(f)).toBe("current");
  });

  it("…and awaiting_transmission is the NORMAL resting state for such a route", () => {
    // No handoff row is created for it, ever, so the raw state never changes.
    expect(custodyStateFor("administration_deposit_prep", [])).toBe("awaiting_transmission");
  });

  it("…which is why the old rule blocked it permanently", () => {
    // The exact predicate that was removed, kept here as the thing being refuted.
    const oldRule = (c: string) => c === "awaiting_reception" || c === "awaiting_transmission";
    expect(oldRule("awaiting_transmission"), "the old rule said blocked").toBe(true);
    expect(
      custodyRefusalForState("administration_deposit_prep", "awaiting_transmission"),
      "the engine says otherwise",
    ).toBeNull();
  });
});

// ============================================= 2. a genuine custody refusal ====

describe("a genuine custody refusal still blocks", () => {
  it("2 — awaiting_reception blocks on any routed step", () => {
    const f = facts({ custody: "awaiting_reception" });
    expect(custodyRefusalForState("administration_deposit_prep", "awaiting_reception")).toBe(
      "handoff_reception_required",
    );
    expect(classify(f)).toBe("blocked");
  });

  it("2 — awaiting_transmission blocks where the route DOES require reception", () => {
    // The other side of the same rule, on a route that is genuinely gated.
    const gated = HANDOFF_ROUTES.find((r) => r.requiresReception);
    expect(gated, "the route table must still contain a reception-gated route").toBeTruthy();

    const f = facts({
      stepKey: gated!.toStepKey,
      custody: "awaiting_transmission",
      owningRole: null,
    });
    expect(custodyRefusalForState(gated!.toStepKey, "awaiting_transmission")).toBe("handoff_not_sent");
    expect(classify(f, COORDINATOR)).toBe("blocked");
  });

  it("…so the fix narrowed the rule, it did not remove it", () => {
    expect(custodyRefusalForState("administration_deposit_prep", "awaiting_reception")).not.toBeNull();
    expect(custodyRefusalForState("administration_deposit_prep", "received")).toBeNull();
    expect(custodyRefusalForState("administration_deposit_prep", "not_applicable")).toBeNull();
  });
});

// ============================================ 3. evidence still blocks too =====

describe("a hard outstanding requirement still blocks", () => {
  it("3 — step 23 with FINAL_INVOICE outstanding is blocked", () => {
    // `administration_deposit_prep::FINAL_INVOICE` is hard(OBJECT_OF_THE_ACT).
    const f = facts({
      custody: "awaiting_transmission",
      requirements: [{ key: "FINAL_INVOICE", labelFr: "Facture définitive", status: "missing" }],
    });
    const el = evaluateStepAction(f, ADMINISTRATION);
    expect(el.requirements[0].blocking, "the ratified class must still block").toBe(true);
    expect(classify(f)).toBe("blocked");
  });

  it("…and the same step with it SATISFIED is offered", () => {
    // Satisfied requirements never reach the model: `outstandingRequirements`
    // filters them, which is why 00013 presents with an empty list.
    expect(classify(facts({ custody: "awaiting_transmission", requirements: [] }))).toBe("current");
  });
});

// ================================= 4. agreement with the authoritative verdict ==

describe("the bucket agrees with StepEligibility", () => {
  it("4 — the 00013 step-23 conditions classify consistently with canStart", () => {
    const f = facts({ custody: "awaiting_transmission" });
    const el = evaluateStepAction(f, ADMINISTRATION);
    expect(el.canStart, "the engine would accept Démarrer").toBe(true);
    expect(classify(f), "so the reader must be offered it").toBe("current");
  });

  it("4 — canStart and not-blocked agree across every custody state", () => {
    for (const custody of [
      "not_applicable",
      "awaiting_transmission",
      "awaiting_reception",
      "received",
    ] as const) {
      const f = facts({ custody });
      const el = evaluateStepAction(f, ADMINISTRATION);
      const bucket = classify(f);
      // A startable step is never bucketed as blocked, and an unstartable one
      // that is blocked for CUSTODY is never offered. That is the invariant the
      // defect violated in one direction.
      if (el.canStart) expect(bucket, custody).not.toBe("blocked");
      if (el.custodyRefusal !== null) expect(bucket, custody).toBe("blocked");
    }
  });
});

// ============================= 5. it cannot become stricter again, structurally =

describe("the work model cannot reinterpret raw custody", () => {
  it("5 — kindOf reads custodyRefusal and never the raw state", () => {
    const src = readFileSync(join(__dirname, "..", "lib/process/work-model.ts"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(src).toContain("e.custodyRefusal !== null");
    // No comparison against a CustodyState anywhere in the model.
    expect(src).not.toMatch(/custody\s*===/);
    // The two states the defect turned on. `not_applicable` and `received` are
    // deliberately NOT listed: `not_applicable` is also a WorkKind bucket name in
    // this file, so banning the string would assert something about unrelated
    // vocabulary rather than about custody.
    for (const literal of ["awaiting_reception", "awaiting_transmission"]) {
      expect(src, `work-model must not name the custody state ${literal}`).not.toContain(`"${literal}"`);
    }
    // And the CustodyState type is not imported here at all, so the model has no
    // way to reason about one even accidentally.
    expect(src).not.toMatch(/CustodyState/);
  });

  it("5 — and the engine's rule remains the single implementation", () => {
    const routes = readFileSync(join(__dirname, "..", "lib/process/handoff-routes.ts"), "utf8");
    expect(routes).toContain("export function custodyRefusalForState");
    // Both consumers ask it; neither restates it.
    const elig = readFileSync(join(__dirname, "..", "lib/process/step-eligibility.ts"), "utf8");
    expect(elig).toContain("custodyRefusalForState(facts.stepKey, facts.custody)");
  });
});
