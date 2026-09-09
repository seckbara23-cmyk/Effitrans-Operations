/**
 * OPS-CUSTOMS-GAINDE-04 slice 5 — one construction, one decision, three surfaces.
 * ---------------------------------------------------------------------------
 * THE DEFECT, which is subtler than it sounds. `evaluateStepAction` was pure
 * and shared from the day it was written, and the two surfaces that read it
 * STILL disagreed three provable ways — because sharing a decision is not the
 * same as sharing the facts it decides on. Each caller assembled its own from
 * whatever it had in scope:
 *
 *   1. EVIDENCE — the queue folded missing evidence into its blocker, the
 *      process page folded in only missing prerequisites. So the dossier
 *      surface offered « Terminer » on steps `submitStep` then refused.
 *   2. CUSTODY — both derived a SENT-only boolean, a partial re-implementation
 *      of `custodyStateFor`. A step whose governed route had transmitted
 *      nothing looked ready and was refused `handoff_not_sent`.
 *   3. CLAIM — `claimedByAnother` fired only on ACTIVE while the engine's
 *      `assignmentRefusal` bites in ANY state once an assignee exists, and
 *      Transit writes assignments on AVAILABLE rows.
 *
 * A third surface built on those facts would have inherited all three. So the
 * facts moved INTO the evaluator and the construction into one builder.
 *
 * WHAT THIS FILE HOLDS. That the three divergences are closed at the source;
 * that ownership, unauthorized evidence and the governance class are now
 * expressible; and that no surface has kept a private derivation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { ASSIGNMENT_OWNED_STEPS } from "@/lib/process/handoff-routes";
import { getNode } from "@/lib/process/engine/state";
import {
  CLASSIFIED,
  blocksCompletion,
  governanceFor,
  requirementMessageFr,
} from "@/lib/process/requirement-class";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ME = { userId: "u-me", permissions: ["customs:create", "customs:update"], roles: ["CUSTOMS_DECLARANT"] };
const CHEF = { userId: "u-chef", permissions: ["customs:create", "customs:update"], roles: ["CHIEF_OF_TRANSIT"] };

/** Step 6 — owned by the Déclarant, and one of the assignment-owned steps. */
const step6 = (over: Partial<StepActionFacts> = {}): StepActionFacts => ({
  stepKey: "customs_preparation",
  state: "AVAILABLE",
  assignedUserId: null,
  custody: "not_applicable",
  owningRole: "CUSTOMS_DECLARANT",
  missingPrerequisites: [],
  requirements: [],
  ...over,
});

const missing = (key = "COMMERCIAL_INVOICE") =>
  [{ key, labelFr: "Facture commerciale", status: "missing" as const }];

/**
 * A requirement Effitrans HAS ruled a hard gate (OPS-LENIENCY-01).
 * `customs_preparation::CUSTOMS_DOSSIER` is the maker side of the
 * `customs_validation` maker/checker pair, which the doctrine excludes from
 * every derogation. Used wherever a test needs something that genuinely stops
 * the step, now that an UNRULED requirement deliberately does not.
 */
const hardMissing = () =>
  [{ key: "CUSTOMS_DOSSIER", labelFr: "Dossier de d\u00e9douanement", status: "missing" as const }];

// ===========================================================================
// DIVERGENCE 1 — evidence
// ===========================================================================

describe("evidence blocks completion, derived by the evaluator and not by a caller", () => {
  it("01 — an ACTIVE step with a missing HARD requirement offers no Terminer", () => {
    // ⚠ OPS-LENIENCY-01 changed which requirements reach this outcome, not the
    // outcome itself. It used to be « any unsatisfied requirement »; Effitrans
    // has since ruled that an UNKNOWN business-completeness requirement must
    // not automatically become a blocker, so the blocking case now needs a
    // requirement that was actually classified. Test 04 covers the other half.
    const el = evaluateStepAction(
      step6({ state: "ACTIVE", assignedUserId: ME.userId, requirements: hardMissing() }),
      ME,
    );
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toContain("Dossier de dédouanement");
  });

  it("02 — and the same facts give the same verdict whoever assembled them", () => {
    // The whole point: the decision no longer depends on which surface built
    // the blocker sentence, because there is no blocker sentence to build.
    const facts = step6({ state: "ACTIVE", assignedUserId: ME.userId, requirements: hardMissing() });
    expect(evaluateStepAction(facts, ME).canSubmit).toBe(false);
    expect(evaluateStepAction({ ...facts, blockedReason: null }, ME).canSubmit).toBe(false);
  });

  it("03 — with nothing outstanding, Terminer is offered", () => {
    const el = evaluateStepAction(step6({ state: "ACTIVE", assignedUserId: ME.userId }), ME);
    expect(el.canSubmit).toBe(true);
    expect(el.reasonFr).toBeNull();
  });

  it("04 — a CLASSIFIED requirement blocks in every unsatisfied status, an unruled one in none", () => {
    // Two rules, and the pair is the whole leniency doctrine in one test.
    //
    // A ruled HARD gate blocks whatever SHAPE its dissatisfaction takes —
    // missing, invalid or awaiting review are three ways of not being there.
    for (const status of ["missing", "invalid", "pending_review"] as const) {
      const el = evaluateStepAction(
        step6({
          state: "ACTIVE",
          assignedUserId: ME.userId,
          requirements: [{ key: "CUSTOMS_DOSSIER", labelFr: "Pièce", status }],
        }),
        ME,
      );
      expect(el.canSubmit, `hard/${status}`).toBe(false);
    }
    // An UNRULED one blocks in none of them: « defaulting every unknown
    // requirement to a blocker is NOT acceptable ».
    for (const status of ["missing", "invalid", "pending_review"] as const) {
      const el = evaluateStepAction(
        step6({
          state: "ACTIVE",
          assignedUserId: ME.userId,
          requirements: [{ key: "COMMERCIAL_INVOICE", labelFr: "Pièce", status }],
        }),
        ME,
      );
      expect(el.canSubmit, `unruled/${status}`).toBe(true);
    }
    // AUTHORITY IS NOT COMPLETENESS. `unauthorized` says the viewer cannot SEE
    // the evidence, so no classification may soften it — not even on a
    // requirement nobody has ruled on.
    {
      const el = evaluateStepAction(
        step6({
          state: "ACTIVE",
          assignedUserId: ME.userId,
          requirements: [{ key: "COMMERCIAL_INVOICE", labelFr: "Pièce", status: "unauthorized" }],
        }),
        ME,
      );
      expect(el.canSubmit, "unauthorized").toBe(false);
    }
  });
});

// ===========================================================================
// DIVERGENCE 2 — custody
// ===========================================================================

describe("custody is a state, not a boolean", () => {
  /**
   * UAT-STEP10-HANDOFF-01 — THESE NOW USE A STEP THAT ACTUALLY HAS A ROUTE.
   *
   * They used to set a custody state on `customs_preparation`, which no route
   * targets: `custodyStateFor` returns `not_applicable` for it and the
   * platform can never produce the fixture. The old evaluator blocked on the
   * bare state, so the tests passed on a state that cannot exist — and went on
   * passing while the rule they protect was wrong for three of the four real
   * routes. Step 4 `coordinator_reception` is the route that requires
   * reception, so it is where the strict rule genuinely applies.
   */
  const routed = (over: Partial<StepActionFacts> = {}) =>
    step6({ stepKey: "coordinator_reception", owningRole: "CHIEF_OF_TRANSIT", ...over });
  const CHIEF = { userId: ME.userId, permissions: ["customs:assign"], roles: ["CHIEF_OF_TRANSIT"] };

  it("05 — awaiting_reception blocks, and says the transfer must be accepted", () => {
    const el = evaluateStepAction(routed({ custody: "awaiting_reception" }), CHIEF);
    expect(el.canStart).toBe(false);
    expect(el.awaitingReception).toBe(true);
    expect(el.reasonFr).toContain("réceptionné");
  });

  it("06 — awaiting_transmission blocks WHERE THE ROUTE REQUIRES RECEPTION", () => {
    // The half a boolean could not express. The engine refuses this with
    // `handoff_not_sent`, and the surface used to offer the button anyway.
    const el = evaluateStepAction(routed({ custody: "awaiting_transmission" }), CHIEF);
    expect(el.canStart).toBe(false);
    expect(el.awaitingReception).toBe(false);
    expect(el.reasonFr).toContain("transmis");
    expect(el.reasonFr).not.toContain("réceptionné");
  });

  it("06b — …and does NOT block where the route does not require it", () => {
    /**
     * THE STEP-10 DEFECT. `gainde_registration → coordinator_to_declarant` is
     * `requiresReception: false`, exactly so that a target reached by
     * promotion is not stranded. `custodyRefusal` returns null for it and
     * `activateStep` accepts the work; the surface refused it anyway and told
     * the Coordinator « Le dossier doit d'abord être formellement transmis au
     * service suivant. » on EFT-IMP-2026-00011.
     */
    const coord = { userId: ME.userId, permissions: ["process:handoff:send"], roles: ["COORDINATOR"] };
    const el = evaluateStepAction(
      step6({
        stepKey: "coordinator_to_declarant",
        owningRole: "COORDINATOR",
        custody: "awaiting_transmission",
      }),
      coord,
    );
    expect(el.canStart, "step 10 must be startable by its Coordinator").toBe(true);
    expect(el.custodyRefusal).toBeNull();
    expect(el.reasonFr).toBeNull();
  });

  it("07 — received and not_applicable do not block", () => {
    for (const custody of ["received", "not_applicable"] as const) {
      expect(evaluateStepAction(step6({ custody }), ME).canStart, custody).toBe(true);
    }
  });
});

// ===========================================================================
// DIVERGENCE 3 — the claim
// ===========================================================================

describe("an assignment is respected in every state the engine respects it", () => {
  it("08 — an AVAILABLE assignment-owned step assigned to someone else offers no Démarrer", () => {
    // `assignmentRefusal` bites in ANY state once an assignee exists, and
    // Transit genuinely writes assignments on AVAILABLE rows. The UI offered
    // « Démarrer » on work the engine refuses with `step_assigned_to_other`.
    expect(ASSIGNMENT_OWNED_STEPS.has("customs_preparation")).toBe(true);
    const el = evaluateStepAction(step6({ assignedUserId: "someone-else" }), ME);
    expect(el.claimedByAnother).toBe(true);
    expect(el.canStart).toBe(false);
  });

  it("09 — and the assignee still gets it", () => {
    const el = evaluateStepAction(step6({ assignedUserId: ME.userId }), ME);
    expect(el.claimedByAnother).toBe(false);
    expect(el.canStart).toBe(true);
  });

  it("10 — outside the assignment-owned steps the ACTIVE-only narrowing stands", () => {
    // Ratified 2026-09-04 as a UI narrowing rather than a guard; widening it
    // everywhere would be a product decision nobody made.
    expect(ASSIGNMENT_OWNED_STEPS.has("am_dossier_opening")).toBe(false);
    const available = evaluateStepAction(
      { ...step6({ assignedUserId: "someone-else" }), stepKey: "am_dossier_opening", owningRole: null },
      ME,
    );
    expect(available.claimedByAnother).toBe(false);
  });
});

// ===========================================================================
// WHAT THE EVALUATOR COULD NOT SAY BEFORE
// ===========================================================================

describe("ownership, at the same seam the controls use", () => {
  it("11 — a foreign role is not the owner and is offered nothing", () => {
    const el = evaluateStepAction(step6(), CHEF);
    expect(el.mayAct, "the Chef genuinely holds the permission").toBe(true);
    expect(el.isOwner).toBe(false);
    expect(el.canStart).toBe(false);
    expect(el.reasonFr).toContain("rôle responsable");
  });

  it("12 — an audited assignment makes it theirs, exactly as the control gate says", () => {
    const el = evaluateStepAction(step6({ assignedUserId: CHEF.userId }), CHEF);
    expect(el.isOwner).toBe(true);
    expect(el.canStart).toBe(true);
  });

  it("13 — a step with no owning role defers, as the compatibility path requires", () => {
    const el = evaluateStepAction(step6({ owningRole: null }), CHEF);
    expect(el.isOwner).toBe(true);
    expect(el.canStart).toBe(true);
  });
});

describe("unauthorized evidence never reads as ready", () => {
  it("14 — it is its own state, with its own sentence", () => {
    // `evidence.complete` deliberately ignores unauthorized items — right for a
    // display, wrong for a write, and `submitStep` hard-refuses on them. A card
    // that read `complete` told a viewer « prêt » about work the server refuses.
    const el = evaluateStepAction(
      step6({
        state: "ACTIVE",
        assignedUserId: ME.userId,
        requirements: [{ key: "K", labelFr: "Pièce", status: "unauthorized" }],
      }),
      ME,
    );
    expect(el.unauthorized).toBe(true);
    expect(el.canSubmit).toBe(false);
    expect(el.reasonFr).toBe("Informations insuffisantes pour évaluer cette étape.");
    expect(el.reasonFr).not.toMatch(/prêt/i);
  });

  it("15 — and authority is never softened by a governance class", () => {
    const el = evaluateStepAction(
      step6({
        state: "ACTIVE",
        assignedUserId: ME.userId,
        requirements: [{ key: "K", labelFr: "Pièce", status: "unauthorized" }],
      }),
      ME,
    );
    expect(el.requirements[0].blocking).toBe(true);
  });
});

// ===========================================================================
// THE LENIENCY DOCTRINE — expressible, and behaviour-neutral until ratified
// ===========================================================================

describe("requirements carry a governance class", () => {
  it("16 — an unclassified requirement is FLAG_FOR_RULING, never a silent HARD_GATE", () => {
    // « Defaulting every unknown requirement to a blocker is NOT acceptable. »
    const g = governanceFor("customs_preparation", "COMMERCIAL_INVOICE");
    expect(g.klass).toBe("FLAG_FOR_RULING");
    expect(g.ratified).toBe(false);
  });

  it("17 — and it does NOT block — the ratified default rule", () => {
    // ⚠ REVERSED 2026-09-07, deliberately. The 2026-09-06 slice kept today's
    // behaviour for an unruled requirement, reasoning that switching off a
    // shipped gate is itself an unratified act. Effitrans then ruled the other
    // way, in terms that leave no room: « UNKNOWN BUSINESS COMPLETENESS
    // REQUIREMENT MUST NOT AUTOMATICALLY BECOME HARD_GATE. »
    expect(blocksCompletion(governanceFor("x", "y"))).toBe(false);
  });

  it("18 — only a class ruled BLOCKING blocks", () => {
    const g = (klass: Parameters<typeof blocksCompletion>[0]["klass"]) =>
      ({ klass, ratified: true, mandatoryAtFr: null, source: "DEC-X" });
    expect(blocksCompletion(g("SOFT_GATE"))).toBe(false);
    expect(blocksCompletion(g("INFORMATIONAL"))).toBe(false);
    expect(blocksCompletion(g("NOT_APPLICABLE"))).toBe(false);
    expect(blocksCompletion(g("FLAG_FOR_RULING"))).toBe(false);
    // A controlled exception blocks until somebody exercises it: an exception
    // that applies itself is not a control.
    expect(blocksCompletion(g("CONTROLLED_EXCEPTION"))).toBe(true);
    expect(blocksCompletion(g("HARD_GATE"))).toBe(true);
  });

  it("19 — every ratified entry carries a first-party citation", () => {
    // Entries here change what an operator is told AND what the engine
    // refuses, so each needs a source. « The code already does it » is not a
    // source — that reasoning is what produced 108 unexamined blockers.
    for (const [key, g] of Object.entries(CLASSIFIED)) {
      expect(g.ratified, key).toBe(true);
      expect(g.source.length, key).toBeGreaterThan(40);
      // A SOFT gate must name WHERE the artefact becomes mandatory. Without a
      // later checkpoint, downgrading it would simply drop the requirement.
      if (g.klass === "SOFT_GATE") expect(g.mandatoryAtFr, key).toBeTruthy();
    }
  });

  it("20 — the registry classifies the step-evidence requirements the registry declares", () => {
    // Bounded and checkable: every key here must be a real requirement of a
    // real step, so a typo cannot silently classify nothing.
    for (const key of Object.keys(CLASSIFIED)) {
      const [stepKey, reqKey] = key.split("::");
      const node = getNode(stepKey);
      expect(node, stepKey).toBeTruthy();
      expect(node!.requiredDocuments, key).toContain(reqKey);
    }
  });

  it("21 — an unruled requirement is reported, not dressed as a settled rule", () => {
    // ⚠ THE §8 CORRECTION. On dossier 00011 the Bon à Délivrer and the Pre-Gate
    // were shown as « Cette exigence est bloquante aujourd'hui ; sa
    // classification est en attente de ratification » — internal governance
    // bookkeeping printed on an operator's screen, presenting an unexamined
    // requirement as a confirmed blocker.
    const el = evaluateStepAction(
      step6({ state: "ACTIVE", assignedUserId: ME.userId, requirements: missing() }),
      ME,
    );
    const r = el.requirements[0];
    expect(r.blocking).toBe(false);
    expect(r.messageFr).toContain("Information à compléter");
    expect(r.messageFr).toContain("Facture commerciale");
    expect(r.messageFr).toContain("vous pouvez poursuivre les opérations autorisées");
    expect(r.messageFr).not.toContain("Action requise");
    expect(r.messageFr).not.toContain("bloquante aujourd'hui");
  });

  it("22 — a SOFT gate names the checkpoint where it becomes mandatory", () => {
    const msg = requirementMessageFr({
      labelFr: "Bordereau de livraison",
      governance: { klass: "SOFT_GATE", ratified: true, mandatoryAtFr: "avant la validation du Chef de Transit", source: "DEC-X" },
      blocks: false,
    });
    expect(msg).toContain("Information à compléter");
    expect(msg).toContain("vous pouvez poursuivre");
    expect(msg).toContain("avant la validation du Chef de Transit");
    expect(msg).not.toContain("Action requise");
  });
});

// ===========================================================================
// NO SURFACE KEEPS A PRIVATE DERIVATION
// ===========================================================================

describe("one construction, and it is the only one", () => {
  it("23 — both server surfaces build facts through the shared constructor", () => {
    expect(code("lib/process/contextual/facts.ts")).toContain("buildStepFacts({");
    expect(code("lib/process/queues/service.ts")).toContain("buildStepFacts({");
  });

  it("24 — and the dossier's process page reads the loader rather than the database", () => {
    const page = code("app/files/[id]/process/page.tsx");
    expect(page).toContain("loadContextualStepFacts(");
    expect(page).not.toContain("process_handoff");
    expect(page).not.toContain("getAdminSupabaseClient");
  });

  it("25 — the builder is PURE: the queue and the dossier cannot share a query", () => {
    const build = code("lib/process/contextual/build.ts");
    expect(build).not.toMatch(/getAdminSupabaseClient|server-only|await /);
  });

  it("26 — the loader never reads the permission-FILTERED snapshot arrays directly", () => {
    // The defect `gate-authority.ts` exists to prevent: a BILLING_OFFICER holds
    // no `document:read`, so `snap.documents` is empty for them and every
    // evidence item would read « missing » instead of « you cannot see this ».
    const loader = code("lib/process/contextual/facts.ts");
    for (const forbidden of ["snap.documents", "snap.customs", "snap.transport", "snap.invoices"]) {
      expect(loader, forbidden).not.toContain(forbidden);
    }
    expect(loader).toContain("evaluateStepEvidence(");
  });

  it("27 — nothing loads the owning role per step: it is one batched read", () => {
    const owning = code("lib/process/contextual/owning-roles.ts");
    expect(owning).toContain('.in("step_key", keys)');
    // One reader for the whole platform — three copies of this query were about
    // to exist.
    for (const consumer of [
      "lib/process/contextual/facts.ts",
      "lib/process/control-ownership-server.ts",
      "lib/process/queues/service.ts",
    ]) {
      expect(code(consumer), consumer).toContain("owning-roles");
    }
  });

  it("28 — the evaluator is still PURE and is still not a second engine", () => {
    const e = code("lib/process/step-eligibility.ts");
    expect(e).not.toMatch(/getAdminSupabaseClient|createClient|"use server"|from\(/);
    expect(e).not.toMatch(/process_step_execution|\.update\(|\.insert\(/);
  });
});

// ===========================================================================
// A6 — the snapshot is memoized, and the key carries the AUTHORITY
// ===========================================================================

describe("the render cache cannot leak a privileged snapshot", () => {
  const cacheSrc = code("lib/process/engine/snapshot-cache.ts");

  it("29 — the permission set is part of the key, not an ignored argument", () => {
    // `gate-authority.ts` deliberately builds a snapshot with GATE_FULL_READ
    // that it describes as "created here, consumed here, and never handed
    // back". A key of (tenant, file) alone would hand exactly that to the next
    // permission-filtered display caller.
    expect(cacheSrc).toContain("permissionKey: string");
    expect(cacheSrc).toContain("[...new Set(permissions)].sort().join(SEP)");
    expect(cacheSrc).toContain("cache(");
  });

  it("30 — and mutations do NOT come through it", () => {
    // An action loads, writes, and may load again; serving it a memoized
    // pre-write snapshot would make it decide on state it had already changed.
    const engine = code("lib/process/engine/actions.ts");
    expect(engine).not.toContain("loadProcessSnapshotForDisplay");
    expect(engine).toContain("loadProcessSnapshot(");
  });

  it("31 — the three READ paths share it", () => {
    for (const p of [
      "lib/process/engine/service.ts",
      "lib/process/engine/gate-authority.ts",
      "lib/process/contextual/facts.ts",
    ]) {
      expect(code(p), p).toContain("loadProcessSnapshotForDisplay(");
    }
  });
});
