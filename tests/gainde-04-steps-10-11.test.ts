/**
 * OPS-CUSTOMS-GAINDE-04 slices 11-12 — step 10, step 11, and the door nobody
 * was watching.
 * ---------------------------------------------------------------------------
 * TWO LIVE ANSWERS TO ONE QUESTION. `lifecycle-map.ts`, `transit.ts` and
 * `phase-9.0d` put T7 « Vérification du rattachement » on step 10; migration
 * `20260828000001` and `reconcile/satisfaction.ts` put the rattachement fact on
 * step 11 — « There was never a missing step, only a missing fact. » The
 * ambiguity originated in a single reconciliation row that straddled « 10–11 »
 * and was never closed. RATIFIED 2026-09-06 (DEC-C40): step 10 is the
 * Coordinator's RETURN handoff, step 11 is the Déclarant's rattachement AND its
 * verification.
 *
 * AND A DOOR NOBODY WAS WATCHING. `activateStep` refuses `prerequisites_unmet`,
 * and `submitStep` inherits that because the step had to be ACTIVE first.
 * Reconciliation completes a step without activating it, so it passed straight
 * through. A read-only production census on 2026-09-07 found TWO dossiers at
 * step 11 COMPLETED — provenance RECONCILED, no submitter — with step 10 never
 * completed and zero submission documents. Both came through that door.
 *
 * WHAT WAS DELIBERATELY *NOT* DONE. No new evidence key on step 11. The
 * registry already declares the 9+10→11 join, and the previously proposed
 * submit-only dual prerequisite would have tightened the door the violations did
 * NOT come through while leaving open the one they did. Nothing new is invented
 * here: a rule enforced on one of two paths is now enforced on both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getStep } from "@/lib/process/effitrans-process";
import { CANONICAL_LIFECYCLE, TRANSIT_SOURCE_MAP, validateLifecycleMap } from "@/lib/process/lifecycle-map";
import { TRANSIT_STAGES } from "@/lib/process/transit";
import { HANDOFF_ROUTES, routeTo } from "@/lib/process/handoff-routes";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIG = read("supabase/migrations/20261001000001_gainde_declaration_and_tax_payment.sql");

// ===========================================================================
// SLICE 11 — T7 follows the Déclarant
// ===========================================================================

describe("T7 is the Déclarant's act, on step 11", () => {
  it("01 — the Transit source map names step 11", () => {
    const t7 = TRANSIT_SOURCE_MAP.find((t) => t.key === "T7")!;
    expect(t7.stepKeys).toContain("gainde_document_submission");
  });

  it("02 — and so does the execution registry, with the same responsible", () => {
    const t7 = TRANSIT_STAGES.find((t) => t.key === "T7")!;
    expect(t7.stepKeys).toContain("gainde_document_submission");
    expect(t7.responsibleFr).toBe("Déclarant en douane");
  });

  it("03 — the two T-registries AGREE about T7, which they did not before", () => {
    // Two independent T1–T10 registries exist and no test compared them to each
    // other. This compares the one that mattered.
    const a = [...(TRANSIT_SOURCE_MAP.find((t) => t.key === "T7")?.stepKeys ?? [])].sort();
    const b = [...(TRANSIT_STAGES.find((t) => t.key === "T7")?.stepKeys ?? [])].sort();
    expect(a).toEqual(b);
  });

  it("04 — step 10 stays listed, because it OPENS the rattachement", () => {
    // Dropping it would orphan the Coordinator's return handoff from the
    // Transit board. What changed is that the VERIFICATION is no longer claimed
    // to happen there.
    for (const keys of [
      TRANSIT_SOURCE_MAP.find((t) => t.key === "T7")!.stepKeys,
      TRANSIT_STAGES.find((t) => t.key === "T7")!.stepKeys,
    ]) {
      expect(keys).toContain("coordinator_to_declarant");
    }
  });

  it("05 — the lifecycle stage moved with it, and coverage still holds", () => {
    const stage = CANONICAL_LIFECYCLE.find((s) => s.key === "attachment_verification")!;
    expect(stage.stepKeys).toContain("gainde_document_submission");
    // `validateLifecycleMap` fails if any registry node maps to no stage. A
    // realignment that orphaned a step would be caught here rather than in
    // production.
    expect(validateLifecycleMap()).toEqual([]);
  });

  it("06 — the source vocabulary survives the realignment", () => {
    // « rattachement » is the Guide des Étapes Clés' own word, and the pin that
    // protects it is case-sensitive — a label that lost it would read as a
    // different control.
    for (const label of [
      TRANSIT_SOURCE_MAP.find((t) => t.key === "T7")!.labelFr,
      TRANSIT_STAGES.find((t) => t.key === "T7")!.labelFr,
    ]) {
      expect(label).toContain("rattachement");
      expect(label).toContain("vérification");
    }
  });

  it("07 — and the 26-step graph did not move", () => {
    // Renumbering would have broken queue routing and the coverage rule. The
    // ruling changes what a stage MEANS, never what a step is called.
    expect(getStep("coordinator_to_declarant")!.stepNumber).toBe(10);
    expect(getStep("gainde_document_submission")!.stepNumber).toBe(11);
    expect(getStep("gainde_document_submission")!.prerequisites)
      .toEqual(["coordinator_to_declarant", "gainde_registration"]);
  });
});

describe("step 10's receiver is reconciled with what the engine enforces", () => {
  it("08 — the route to step 10 no longer names the wrong recipient", () => {
    const route = routeTo("coordinator_to_declarant")!;
    expect(route.fromStepKey).toBe("gainde_registration");
    // It ends at the Coordination, which then transmits to the Déclarant at
    // step 11. `isRoutedReceiverRole` has always admitted the Coordinator here
    // and refused the Déclarant with `not_eligible_receiver`.
    expect(route.labelFr).toContain("Coordination");
    expect(route.labelFr).not.toContain("Déclarant");
  });

  it("09 — the projection is corrected to match, in migration #139", () => {
    // The projection promised a Déclarant dossier visibility for a reception
    // the engine would then refuse — a promise the platform could not keep.
    expect(MIG).toContain("delete from public.process_step_receiving_role");
    expect(MIG).toContain("'coordinator_to_declarant',  'COORDINATOR',");
    expect(MIG).toContain("'gainde_document_submission','CUSTOMS_DECLARANT',");
  });

  it("10 — and no route was added or removed", () => {
    // Adding one would be a new custody requirement, which is a new hard
    // blocker — and the leniency doctrine forbids inventing one here.
    expect(HANDOFF_ROUTES).toHaveLength(4);
    expect(routeTo("gainde_document_submission")).toBeNull();
  });
});

// ===========================================================================
// SLICE 12 — the reconcile door
// ===========================================================================

describe("reconciliation may no longer complete a step whose prerequisites are open", () => {
  const svc = code("lib/process/reconcile/service.ts");

  it("11 — the prerequisite test is on the completion path", () => {
    expect(svc).toContain("PREREQUISITE_ENFORCED_ON_RECONCILE.has(stepKey)");
    expect(svc).toContain("!prerequisitesMet(stepKey, toViews(evidenceSnap.executions))");
  });

  it("11b — and it is SCOPED to the join Effitrans actually ratified", () => {
    // A general gate on every fact-provable step was tried and CI showed the
    // cost: `pickup` and `transport_pod_handoff` are legitimately proved by
    // facts that arrive before their own prerequisite closes, so it stalled
    // journeys doing nothing wrong. That is precisely the shape the leniency
    // doctrine forbids — a new hard blocker on business sequencing, adopted by
    // side effect rather than ruled on.
    const set = svc.slice(
      svc.indexOf("const PREREQUISITE_ENFORCED_ON_RECONCILE"),
      svc.indexOf("]);", svc.indexOf("const PREREQUISITE_ENFORCED_ON_RECONCILE")),
    );
    expect(set).toContain('"gainde_document_submission"');
    for (const notRatified of ["pickup", "transport_pod_handoff", "am_dossier_opening",
                              "customs_field_clearance", "gainde_registration"]) {
      expect(set, notRatified).not.toContain(`"${notRatified}"`);
    }
  });

  it("12 — it reads the SNAPSHOT, not the loop's filtered executions", () => {
    // That query is filtered to the fact-provable keys, so it cannot see step 10
    // while judging step 11 — and a prerequisite test that cannot see the
    // prerequisite would refuse everything.
    expect(svc).toContain('.in("step_key", [...FACT_PROVABLE_STEP_KEYS])');
    expect(svc).toContain("toViews(evidenceSnap.executions)");
  });

  it("13 — it uses the ENGINE's own rule, not a second implementation", () => {
    expect(svc).toContain('import { prerequisitesMet } from "@/lib/process/engine/state";');
  });

  it("14 — and it sits after the evidence gate, both guarded the same way", () => {
    const a = svc.indexOf("evaluateStepEvidence(stepKey, evidenceSnap.evidence)");
    const b = svc.indexOf("prerequisitesMet(stepKey");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it("15 — step 11's upstream requirement is the REGISTRY's, not a new key", () => {
    // The previously proposed submit-only dual prerequisite would have tightened
    // the door the violations did NOT come through. The registry already
    // declares the 9+10→11 join; closing the reconcile door is what makes it
    // load-bearing on both paths.
    const node = getStep("gainde_document_submission")!;
    expect(node.prerequisites).toEqual(["coordinator_to_declarant", "gainde_registration"]);
    expect(node.requiredDocuments).toEqual(["GAINDE_SUBMISSION_EVIDENCE"]);
  });

  it("16 — and no proxy was added: the Déclarant cannot prove Finance's act", () => {
    // `GAINDE_DECLARATION_REFERENCE` falls back to `declarationNumber`, the
    // Déclarant's own step-6 field. Attaching it to step 11 would rebuild the
    // MAYA-P1.2 proxy through the evidence door.
    const node = getStep("gainde_document_submission")!;
    expect(node.requiredDocuments).not.toContain("GAINDE_DECLARATION_REFERENCE");
  });

  it("17 — nothing is retroactive: the check runs on the completion path only", () => {
    // Two production dossiers are already COMPLETED at step 11 through this
    // door. Inventing a correction to history would be a worse answer than
    // reporting it, and the rule cannot un-complete them.
    expect(svc).not.toMatch(/update[\s\S]{0,80}process_step_execution[\s\S]{0,120}state\s*=\s*'/i);
    expect(read("lib/process/reconcile/service.ts")).toContain("NOT RETROACTIVE");
  });
});
