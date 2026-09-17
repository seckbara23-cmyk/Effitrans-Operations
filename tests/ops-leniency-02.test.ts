/**
 * OPS-LENIENCY-02 — the artefact that IS the act stays hard at its own activity.
 * ---------------------------------------------------------------------------
 * WHAT PRODUCTION DID, on EFT-IMP-2026-00011. An Account Manager started
 * « obtenir l'autorisation Pre-Gate », the interface said the authorization was
 * still missing, and « Terminer » accepted anyway. The activity moved to
 * COMPLETED, the branch counter went to « 1/3 activités parallèles », and the
 * step's own row recorded `evidence_summary.missing = [PRE_GATE_AUTHORIZATION]`.
 * At the same instant the convergence gate answered « Autorisation Pre-Gate
 * obtenue (not_uploaded) » and refused the enlèvement. One dossier, two
 * truths.
 *
 * WHY IT HAPPENED, and why that is not a bug in the completion path. The four
 * transport-readiness requirements were classified SOFT_GATE by OPS-LENIENCY-01
 * on 2026-09-07, on the reasoning that an artefact obtained in parallel should
 * not stop today's work and is re-demanded at a later checkpoint. `submitStep`
 * refuses only what `blockingRequirements` calls blocking, so it passed them —
 * exactly as designed, through the one guard both the button and the server
 * read.
 *
 * WHAT WAS WRONG WAS THE READING. These artefacts are not obtained in parallel
 * with their activity; they ARE it. « obtenir l'autorisation Pre-Gate » has one
 * required document and a completion rule named `pre_gate_obtained`. Closed
 * without it, the row asserts something that did not happen — which is what the
 * doctrine's own HARD reasoning already says about the devis, the final invoice
 * and the proof of deposit.
 *
 * THE RULE THIS SUITE PINS:
 *
 *     START is free.     An activity may be claimed before its artefact exists.
 *     COMPLETE is not.   It refuses, server-side, naming the document.
 *
 * NO NEW MECHANISM. The refusal travels the existing route —
 * `evaluateStepEvidence` → `blockingRequirements` → `submitStep` — and the
 * convergence gate is untouched: it reads the document directly and must never
 * consult a governance class.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CLASSIFIED,
  blockingRequirements,
  blocksCompletion,
  governanceFor,
  requirementMessageFr,
} from "@/lib/process/requirement-class";
import { evaluateStepEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { evaluateStepAction, type StepActionFacts } from "@/lib/process/step-eligibility";
import { evaluatePickupGate } from "@/lib/process/engine/gates";
import { getNode } from "@/lib/process/engine/state";
import { contextualStatus } from "@/lib/process/contextual/view";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The four entries this slice reclassified, and the artefact each names. */
const RECLASSIFIED: readonly [step: string, requirement: string][] = [
  ["pre_gate", "PRE_GATE_AUTHORIZATION"],
  ["bon_a_delivrer", "BON_A_DELIVRER"],
  ["transport_docs_transmission", "PRE_GATE_AUTHORIZATION"],
  ["transport_docs_transmission", "BORDEREAU_LIVRAISON"],
];

/** The one requirement that stays SOFT, and must. */
const STILL_SOFT: readonly [string, string] = ["am_delivery_followup", "SIGNED_DELIVERY_NOTE"];

// ------------------------------------------------------------- fixtures ----

type Doc = { typeCode: string; status: string };

const snapshot = (documents: Doc[]): EvidenceSnapshot =>
  ({
    fileType: "IMP",
    services: ["transport", "customs"],
    access: { documents: true, customs: true, transport: true, finance: true },
    documents,
    customs: { required: true, status: "RELEASED", baeReference: "BAE-1" },
    transport: { vehicleId: "v1", vehiclePlate: null, driverUserId: "d1", driverName: null },
    invoices: [],
  }) as unknown as EvidenceSnapshot;

const facts = (over: Partial<StepActionFacts>): StepActionFacts => ({
  stepKey: "pre_gate",
  state: "ACTIVE",
  assignedUserId: "u-am",
  custody: "not_applicable",
  owningRole: null,
  missingPrerequisites: [],
  requirements: [],
  notApplicable: null,
  ...over,
});

const AM = { userId: "u-am", permissions: ["document:create", "process:handoff:send"], roles: ["ACCOUNT_MANAGER"] };

// ========================================================== A. CLASSIFICATION ==

describe("A — the four entries are HARD, and the ruling says so", () => {
  it("01 — every reclassified key blocks completion", () => {
    for (const [step, req] of RECLASSIFIED) {
      const g = governanceFor(step, req);
      expect(g.klass, `${step}::${req}`).toBe("HARD_GATE");
      expect(g.ratified, `${step}::${req}`).toBe(true);
      expect(blocksCompletion(g), `${step}::${req}`).toBe(true);
    }
  });

  it("02 — each cites OPS-LENIENCY-02 and no longer claims the superseded ruling", () => {
    for (const [step, req] of RECLASSIFIED) {
      const g = governanceFor(step, req);
      expect(g.source, `${step}::${req}`).toContain("OPS-LENIENCY-02");
      // A HARD gate names no later checkpoint: it is required HERE.
      expect(g.mandatoryAtFr, `${step}::${req}`).toBeNull();
      // …and the second control is still cited, so nobody concludes the
      // artefact stopped being required at the enlèvement.
      expect(g.source, `${step}::${req}`).toContain("PICKUP_READINESS");
      expect(g.source, `${step}::${req}`).toContain("étape 15");
    }
  });

  it("03 — the POD stays SOFT: its artefact is the delivery's result, not the act", () => {
    const [step, req] = STILL_SOFT;
    const g = governanceFor(step, req);
    expect(g.klass).toBe("SOFT_GATE");
    expect(blocksCompletion(g)).toBe(false);
    expect(g.mandatoryAtFr).toContain("étape 17");
  });

  it("04 — exactly one SOFT entry remains, and the matrix still cites everything", () => {
    const soft = Object.entries(CLASSIFIED).filter(([, g]) => g.klass === "SOFT_GATE");
    expect(soft.map(([k]) => k)).toEqual([`${STILL_SOFT[0]}::${STILL_SOFT[1]}`]);
    for (const [key, g] of Object.entries(CLASSIFIED)) {
      expect(g.source.length, key).toBeGreaterThan(40);
    }
  });

  it("05 — each reclassified key is a REAL required document of a REAL activity", () => {
    for (const [step, req] of RECLASSIFIED) {
      const node = getNode(step);
      expect(node, step).toBeTruthy();
      expect(node!.requiredDocuments, `${step}::${req}`).toContain(req);
      // And the activity's completion rule names the act the artefact IS.
      expect(node!.completionRule, step).toBeTruthy();
    }
  });
});

// ================================================ B. COMPLETION IS REFUSED ==

describe("B — completion refuses while the artefact is missing", () => {
  it("06 — each activity has an outstanding blocking requirement with no document", () => {
    for (const step of ["pre_gate", "bon_a_delivrer", "transport_docs_transmission"]) {
      const ev = evaluateStepEvidence(step, snapshot([]));
      const blocking = blockingRequirements(step, ev);
      expect(blocking.length, step).toBeGreaterThan(0);
      for (const item of blocking) {
        expect(item.status, `${step}/${item.key}`).toBe("missing");
        expect(item.detail, `${step}/${item.key}`).toBe("not_uploaded");
      }
    }
  });

  it("07 — the transmission activity blocks on BOTH of its artefacts", () => {
    const ev = evaluateStepEvidence("transport_docs_transmission", snapshot([]));
    expect(blockingRequirements("transport_docs_transmission", ev).map((i) => i.key).sort())
      .toEqual(["BORDEREAU_LIVRAISON", "PRE_GATE_AUTHORIZATION"]);
  });

  it("08 — the refusal travels the EXISTING guard, and precedes any write", () => {
    const engine = code("lib/process/engine/actions.ts");
    // One guard, shared with the surface — not a Pre-Gate-specific check.
    expect(engine).toContain("blockingRequirements(stepKey, ev)");
    expect(engine).toContain('failWithEvidence("evidence_missing", ev)');
    expect(engine).not.toMatch(/PRE_GATE_AUTHORIZATION|BON_A_DELIVRER/);
    const submit = engine.slice(engine.indexOf("export async function submitStep"));
    const refusal = submit.indexOf('failWithEvidence("evidence_missing", ev)');
    const write = submit.indexOf("await cas(");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal, "the refusal must precede the state write").toBeLessThan(write);
  });

  it("09 — and the refusal NAMES the artefact rather than returning a bare code", () => {
    const engine = code("lib/process/engine/actions.ts");
    const helper = engine.slice(engine.indexOf("const failWithEvidence"));
    expect(helper).toContain("key: i.key");
    expect(helper).toContain("labelFr: i.labelFr");
  });
});

// ================================================= C. START BEFORE EVIDENCE ==

describe("C — starting is still free", () => {
  it("10 — activation never consults evidence", () => {
    const engine = code("lib/process/engine/actions.ts");
    const activate = engine.slice(
      engine.indexOf("export async function activateStep"),
      engine.indexOf("export async function submitStep"),
    );
    expect(activate).not.toContain("evaluateStepEvidence");
    expect(activate).not.toContain("blockingRequirements");
  });

  it("11 — an AVAILABLE activity with no document is still startable", () => {
    for (const [step, req] of RECLASSIFIED) {
      const el = evaluateStepAction(
        facts({
          stepKey: step,
          state: "AVAILABLE",
          assignedUserId: null,
          requirements: [{ key: req, labelFr: req, status: "missing" }],
        }),
        AM,
      );
      expect(el.canStart, `${step} must be claimable without its artefact`).toBe(true);
      expect(el.canSubmit, `${step} must not be completable without it`).toBe(false);
    }
  });
});

// ============================================== D. EVIDENCE THEN COMPLETION ==

describe("D — verified evidence clears the block", () => {
  it("12 — a VERIFIED document satisfies, and nothing remains outstanding", () => {
    for (const [step, req] of RECLASSIFIED) {
      const docs = getNode(step)!.requiredDocuments.map((k) => ({ typeCode: k, status: "VERIFIED" }));
      const ev = evaluateStepEvidence(step, snapshot(docs));
      expect(blockingRequirements(step, ev), step).toEqual([]);
      expect(ev.missing, step).toEqual([]);
      expect(ev.satisfied, `${step}::${req}`).toContain(req);
    }
  });

  it("13 — CONSUMED_AS_EVIDENCE also satisfies", () => {
    const ev = evaluateStepEvidence("pre_gate", snapshot([{ typeCode: "PRE_GATE_AUTHORIZATION", status: "CONSUMED_AS_EVIDENCE" }]));
    expect(blockingRequirements("pre_gate", ev)).toEqual([]);
  });

  it("14 — ⚠ UPLOADED ALONE IS NOT ENOUGH: the document must be verified", () => {
    // The doctrine is unchanged by this slice and must stay unchanged: an
    // operator uploading their own paper does not thereby verify it.
    for (const status of ["UPLOADED", "PENDING_REVIEW"]) {
      const ev = evaluateStepEvidence("pre_gate", snapshot([{ typeCode: "PRE_GATE_AUTHORIZATION", status }]));
      const blocking = blockingRequirements("pre_gate", ev);
      expect(blocking.length, status).toBe(1);
      expect(blocking[0].status, status).toBe("pending_review");
    }
  });

  it("15 — REJECTED and EXPIRED remain unsatisfied", () => {
    for (const status of ["REJECTED", "EXPIRED"]) {
      const ev = evaluateStepEvidence("pre_gate", snapshot([{ typeCode: "PRE_GATE_AUTHORIZATION", status }]));
      const blocking = blockingRequirements("pre_gate", ev);
      expect(blocking.length, status).toBe(1);
      expect(blocking[0].status, status).toBe("invalid");
    }
  });
});

// ================================================== E. THE SURFACE AGREES ==

describe("E — the button and the server read one verdict", () => {
  it("16 — canSubmit is false and the requirement reads « Action requise »", () => {
    for (const [step, req] of RECLASSIFIED) {
      const el = evaluateStepAction(
        facts({ stepKey: step, requirements: [{ key: req, labelFr: "Autorisation Pre-Gate", status: "missing" }] }),
        AM,
      );
      expect(el.canSubmit, step).toBe(false);
      expect(el.requirements[0].blocking, step).toBe(true);
      expect(el.requirements[0].klass, step).toBe("HARD_GATE");
      expect(el.requirements[0].messageFr, step).toContain("Action requise");
      expect(el.requirements[0].messageFr, step).not.toContain("vous pouvez poursuivre");
      // The card names the outstanding artefact as the reason.
      expect(el.reasonFr, step).toContain("Action requise");
    }
  });

  it("17 — the status vocabulary is UNCHANGED: an outstanding artefact is not « Bloquée »", () => {
    const missing = [{ key: "PRE_GATE_AUTHORIZATION", labelFr: "Autorisation Pre-Gate", status: "missing" as const }];

    // AVAILABLE and startable: « À votre tour ». Making a hard requirement read
    // « Bloquée » here would tell an Account Manager that the platform is
    // stopping them, when what it wants is for them to start and go get the
    // paper. The invitation is the point of the start-before-evidence rule.
    const open = evaluateStepAction(
      facts({ stepKey: "pre_gate", state: "AVAILABLE", assignedUserId: null, requirements: missing }),
      AM,
    );
    expect(open.canStart).toBe(true);
    expect(contextualStatus("AVAILABLE", open).labelFr).toBe("À votre tour");

    // ACTIVE and not yet completable: « En cours » — somebody is on it.
    const held = evaluateStepAction(facts({ stepKey: "pre_gate", requirements: missing }), AM);
    expect(held.canSubmit).toBe(false);
    expect(contextualStatus("ACTIVE", held).labelFr).toBe("En cours");

    // In BOTH readings the card carries the same sentence, which is where the
    // operator learns what completion will need.
    for (const el of [open, held]) expect(el.requirements[0].messageFr).toContain("Action requise");
  });

  it("18 — the message comes from the classifier, not from a second sentence", () => {
    const g = governanceFor("pre_gate", "PRE_GATE_AUTHORIZATION");
    expect(requirementMessageFr({ labelFr: "Autorisation Pre-Gate", governance: g, blocks: true }))
      .toBe("Action requise : Autorisation Pre-Gate.");
  });
});

// ================================================= F. CONVERGENCE UNCHANGED ==

describe("F — the convergence gate is untouched and independent", () => {
  it("19 — it still refuses while the artefacts are missing", () => {
    const gate = evaluatePickupGate(snapshot([]));
    expect(gate.ready).toBe(false);
    expect(gate.missing).toEqual(expect.arrayContaining(["bon_a_delivrer", "pre_gate", "bordereau_livraison"]));
    for (const key of ["bon_a_delivrer", "pre_gate", "bordereau_livraison"]) {
      expect(gate.requirements.find((r) => r.key === key)?.detail, key).toBe("not_uploaded");
    }
  });

  it("20 — and opens on the same VERIFIED documents", () => {
    const gate = evaluatePickupGate(
      snapshot(["BON_A_DELIVRER", "PRE_GATE_AUTHORIZATION", "BORDEREAU_LIVRAISON"].map((c) => ({ typeCode: c, status: "VERIFIED" }))),
    );
    expect(gate.ready).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("21 — ⚠ the gate never consults the governance class", () => {
    // The invariant that survived both rulings. If a later slice made the gate
    // read the matrix, reclassifying anything would silently move a join gate.
    expect(code("lib/process/engine/gates.ts")).not.toContain("blocksCompletion");
    expect(code("lib/process/engine/gates.ts")).not.toContain("requirement-class");
    expect(code("lib/process/engine/gate-authority.ts")).not.toContain("blocksCompletion");
    // It reads the DOCUMENT, by key.
    const gate = read("lib/process/engine/gates.ts");
    for (const key of ["BON_A_DELIVRER", "PRE_GATE_AUTHORIZATION", "BORDEREAU_LIVRAISON"]) {
      expect(gate, key).toContain(`checkEvidence("${key}", snap)`);
    }
  });

  it("22 — step 15 still consults it authoritatively and refuses gate_blocked", () => {
    const engine = code("lib/process/engine/actions.ts");
    expect(engine).toContain("await authoritativePickupGate(c.tenantId, fileId)");
    expect(engine).toContain('return fail("gate_blocked")');
  });
});

// ============================================== G. NO NEW MECHANISM AT ALL ==

describe("G — the slice adds nothing", () => {
  it("23 — no new evidence state, document type, or structured Pre-Gate field", () => {
    const cls = code("lib/process/requirement-class.ts");
    // The classifier is still a lookup table plus two predicates.
    expect(cls).not.toContain("supabase");
    expect(cls).not.toContain("async ");
    expect(cls).not.toContain("document_type");
    // The registry's Pre-Gate contract is untouched.
    const node = getNode("pre_gate")!;
    expect(node.requiredDocuments).toEqual(["PRE_GATE_AUTHORIZATION"]);
    expect(node.completionRule).toBe("pre_gate_obtained");
  });

  it("24 — the evidence evaluator has no per-activity special case", () => {
    const ev = code("lib/process/engine/evidence.ts");
    expect(ev).not.toContain("PRE_GATE_AUTHORIZATION");
    expect(ev).not.toContain("BON_A_DELIVRER");
  });
});
