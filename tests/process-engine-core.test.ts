/**
 * Phase 5.0B-2 — the pure engine core: state machine, prerequisites, parallel
 * branches, join gates, maker-checker, evidence, closure.
 *
 * These prove the six things Phase 5.0B may not be declared complete without:
 * parallel branches, the pickup gate, maker-checker, rejection/correction,
 * DELIVERED != CLOSED, and "no invented historical evidence".
 */
import { describe, it, expect } from "vitest";
import {
  ALL_NODE_KEYS,
  canTransitionStep,
  correctionStepFor,
  evaluateAvailableSteps,
  evaluateBranch,
  evaluateMakerChecker,
  isKnownStep,
  isValidationStep,
  missingPrerequisites,
  preparerStepFor,
  prerequisitesMet,
  requiresIndependentReview,
  type ExecutionView,
} from "@/lib/process/engine/state";
import {
  checkEvidence,
  evaluateStepEvidence,
  fullyPaid,
  podReceived,
  type EvidenceSnapshot,
} from "@/lib/process/engine/evidence";
import {
  evaluateBillingGate,
  evaluateClosureGate,
  evaluatePickupGate,
} from "@/lib/process/engine/gates";
import { evaluateClosureReadiness } from "@/lib/process/engine/state";
import type { StepState } from "@/lib/process/engine/types";

// ---------------------------------------------------------------- helpers ----

/** Materialize all 29 nodes at PENDING, then override the given ones. */
function execs(overrides: Record<string, StepState | ExecutionView> = {}): ExecutionView[] {
  return ALL_NODE_KEYS.map((stepKey) => {
    const o = overrides[stepKey];
    if (!o) return { stepKey, state: "PENDING" as StepState };
    if (typeof o === "string") return { stepKey, state: o };
    return o;
  });
}

/** All steps up to and including `keys` marked COMPLETED. */
function done(...keys: string[]): Record<string, StepState> {
  return Object.fromEntries(keys.map((k) => [k, "COMPLETED" as StepState]));
}

const emptySnap: EvidenceSnapshot = {
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: null,
  transport: null,
  invoices: [],
};

const readySnap: EvidenceSnapshot = {
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [
    { typeCode: "BON_A_DELIVRER", status: "APPROVED" },
    { typeCode: "PRE_GATE_AUTHORIZATION", status: "APPROVED" },
    { typeCode: "DELIVERY_NOTE", status: "APPROVED" },
  ],
  customs: {
    required: true,
    status: "RELEASED",
    baeReference: "BAE-2026-001",
    declarationNumber: "D-1",
    externalRef: "GAINDE-1",
  },
  transport: { status: "PLANNED", vehiclePlate: "DK-1234-AB", driverName: null, driverUserId: "u-driver" },
  invoices: [],
};

// ------------------------------------------------------------ step machine ----

describe("step state machine", () => {
  it("knows every registry node and rejects unknown step keys", () => {
    expect(ALL_NODE_KEYS).toHaveLength(29); // 26 official steps + 3 parallel activities
    expect(isKnownStep("customs_preparation")).toBe(true);
    expect(isKnownStep("bon_a_delivrer")).toBe(true);
    expect(isKnownStep("not_a_step")).toBe(false);
  });

  it("walks the happy path", () => {
    expect(canTransitionStep("PENDING", "AVAILABLE")).toBe(true);
    expect(canTransitionStep("AVAILABLE", "ACTIVE")).toBe(true);
    expect(canTransitionStep("ACTIVE", "SUBMITTED")).toBe(true);
    expect(canTransitionStep("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionStep("APPROVED", "COMPLETED")).toBe(true);
  });

  it("makes REJECTED terminal — a correction is a NEW row, never an overwrite", () => {
    expect(canTransitionStep("REJECTED", "ACTIVE")).toBe(false);
    expect(canTransitionStep("REJECTED", "SUBMITTED")).toBe(false);
    expect(canTransitionStep("REJECTED", "COMPLETED")).toBe(false);
  });

  it("forbids skipping the review: ACTIVE cannot jump to APPROVED", () => {
    expect(canTransitionStep("ACTIVE", "APPROVED")).toBe(false);
  });

  it("forbids reviving a completed step", () => {
    expect(canTransitionStep("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransitionStep("UNVERIFIED_HISTORICAL", "COMPLETED")).toBe(false);
  });
});

// ----------------------------------------------------------- prerequisites ----

describe("prerequisites", () => {
  it("opens step 2 only once step 1 is done", () => {
    expect(prerequisitesMet("operations_intake", execs())).toBe(false);
    expect(prerequisitesMet("operations_intake", execs(done("cotation")))).toBe(true);
  });

  it("reports exactly which prerequisites are missing", () => {
    expect(missingPrerequisites("pickup", execs())).toEqual([
      "customs_field_clearance",
      "transport_assignment",
    ]);
    expect(
      missingPrerequisites("pickup", execs(done("customs_field_clearance"))),
    ).toEqual(["transport_assignment"]);
  });

  it("never treats an UNVERIFIED_HISTORICAL prerequisite as satisfied", () => {
    const e = execs({ cotation: "UNVERIFIED_HISTORICAL" });
    expect(prerequisitesMet("operations_intake", e)).toBe(false);
  });

  it("never treats a REJECTED attempt as satisfied", () => {
    const e = execs({ cotation: "REJECTED" });
    expect(prerequisitesMet("operations_intake", e)).toBe(false);
  });

  it("surfaces newly-available work", () => {
    expect(evaluateAvailableSteps(execs())).toEqual(["cotation"]);
    const after = evaluateAvailableSteps(execs(done("cotation")));
    expect(after).toEqual(["operations_intake"]);
  });

  it("opens BOTH branches at once when the dossier is prepared", () => {
    // am_dossier_opening completed => the customs chain (step 4) AND the whole
    // transport-readiness branch become available simultaneously.
    const avail = evaluateAvailableSteps(
      execs(done("cotation", "operations_intake", "am_dossier_opening")),
    );
    expect(avail).toContain("coordinator_reception"); // customs branch entry
    expect(avail).toContain("transport_assignment"); // transport branch entry
    expect(avail).toContain("bon_a_delivrer");
    expect(avail).toContain("pre_gate");
  });
});

// -------------------------------------------------------- parallel branches ----

describe("parallel branches (Deliverable 5)", () => {
  const prepared = done("cotation", "operations_intake", "am_dossier_opening");

  it("progresses the customs branch without touching transport readiness", () => {
    const e = execs({
      ...prepared,
      ...done("coordinator_reception", "transit_declarant_assignment"),
      customs_preparation: "ACTIVE",
    });
    const customs = evaluateBranch("customs", e);
    const transport = evaluateBranch("transport_readiness", e);

    expect(customs.active).toContain("customs_preparation");
    expect(customs.complete).toBe(false);
    // The transport branch is untouched — NOT a child status of customs.
    expect(transport.completed).toEqual([]);
    expect(transport.complete).toBe(false);
  });

  it("progresses transport readiness without touching customs", () => {
    const e = execs({
      ...prepared,
      ...done("bon_a_delivrer", "pre_gate", "transport_docs_transmission", "transport_assignment"),
    });
    const customs = evaluateBranch("customs", e);
    const transport = evaluateBranch("transport_readiness", e);

    expect(transport.complete).toBe(true);
    // Customs has not advanced at all.
    expect(customs.completed).toEqual([]);
  });

  it("lets one branch finish entirely while the other is still blocked", () => {
    const e = execs({
      ...prepared,
      ...done("bon_a_delivrer", "pre_gate", "transport_docs_transmission", "transport_assignment"),
      customs_preparation: "BLOCKED",
    });
    expect(evaluateBranch("transport_readiness", e).complete).toBe(true);
    expect(evaluateBranch("customs", e).blocked).toContain("customs_preparation");
  });

  it("does not open pickup until BOTH branches reach their convergence steps", () => {
    const customsOnly = execs({
      ...prepared,
      ...done(
        "coordinator_reception", "transit_declarant_assignment", "customs_preparation",
        "transit_validation", "coordinator_to_finance", "gainde_registration",
        "coordinator_to_declarant", "gainde_document_submission", "customs_followup",
        "customs_field_clearance",
      ),
    });
    expect(prerequisitesMet("pickup", customsOnly)).toBe(false);
    expect(missingPrerequisites("pickup", customsOnly)).toEqual(["transport_assignment"]);

    const both = execs({
      ...prepared,
      ...done(
        "coordinator_reception", "transit_declarant_assignment", "customs_preparation",
        "transit_validation", "coordinator_to_finance", "gainde_registration",
        "coordinator_to_declarant", "gainde_document_submission", "customs_followup",
        "customs_field_clearance", "transport_assignment",
      ),
    });
    expect(prerequisitesMet("pickup", both)).toBe(true);
  });
});

// -------------------------------------------------------------- pickup gate ----

describe("pickup convergence gate (Deliverable 6)", () => {
  it("opens when all six requirements are satisfied", () => {
    const g = evaluatePickupGate(readySnap);
    expect(g.ready).toBe(true);
    expect(g.missing).toEqual([]);
  });

  it("reports each missing condition SEPARATELY", () => {
    const g = evaluatePickupGate(emptySnap);
    expect(g.ready).toBe(false);
    // customs is null => 'not required' => that requirement passes; the five
    // transport-readiness requirements all fail, each with its own reason.
    expect(g.missing).toEqual([
      "bon_a_delivrer",
      "pre_gate",
      "bordereau_livraison",
      "vehicle_assigned",
      "driver_assigned",
    ]);
    const byKey = Object.fromEntries(g.requirements.map((r) => [r.key, r]));
    expect(byKey.vehicle_assigned.detail).toBe("no_vehicle_plate");
    expect(byKey.driver_assigned.detail).toBe("no_driver_assigned");
  });

  it("blocks pickup when customs is required but not released", () => {
    const g = evaluatePickupGate({
      ...readySnap,
      customs: { ...readySnap.customs!, status: "INSPECTION" },
    });
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["customs_released"]);
    expect(g.requirements.find((r) => r.key === "customs_released")!.detail).toBe("customs_not_released");
  });

  it("blocks pickup when customs is released but transport is not ready", () => {
    const g = evaluatePickupGate({ ...readySnap, transport: null });
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["vehicle_assigned", "driver_assigned"]);
  });

  it("does NOT fabricate a customs requirement for TRP/HND", () => {
    const g = evaluatePickupGate({ ...readySnap, fileType: "TRP", customs: null });
    expect(g.ready).toBe(true);
    expect(g.requirements.find((r) => r.key === "customs_released")!.notApplicable).toBe(true);
  });

  it("still requires customs for IMP/EXP", () => {
    const g = evaluatePickupGate({ ...readySnap, fileType: "IMP", customs: { ...readySnap.customs!, status: "DECLARED" } });
    expect(g.ready).toBe(false);
  });

  it("never infers a BAE or a vehicle from whitespace", () => {
    const g = evaluatePickupGate({
      ...readySnap,
      transport: { status: "PLANNED", vehiclePlate: "   ", driverName: "  ", driverUserId: null },
    });
    expect(g.missing).toEqual(["vehicle_assigned", "driver_assigned"]);
  });

  it("accepts a driver assigned by free-text name OR by app-user link", () => {
    const byName = evaluatePickupGate({
      ...readySnap,
      transport: { status: "PLANNED", vehiclePlate: "DK-1", driverName: "Amadou", driverUserId: null },
    });
    expect(byName.ready).toBe(true);
  });

  it("fails CLOSED when the readiness documents are absent", () => {
    const g = evaluatePickupGate({ ...readySnap, documents: [] });
    expect(g.ready).toBe(false);
    expect(g.missing).toContain("bon_a_delivrer");
    expect(g.missing).toContain("pre_gate");
    expect(g.missing).toContain("bordereau_livraison");
  });

  it("does not open on an unapproved Bon à Délivrer (uploaded != validated)", () => {
    const g = evaluatePickupGate({
      ...readySnap,
      documents: [
        { typeCode: "BON_A_DELIVRER", status: "PENDING_REVIEW" },
        { typeCode: "PRE_GATE_AUTHORIZATION", status: "APPROVED" },
        { typeCode: "DELIVERY_NOTE", status: "APPROVED" },
      ],
    });
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["bon_a_delivrer"]);
    expect(g.requirements.find((r) => r.key === "bon_a_delivrer")!.detail).toBe("awaiting_approval");
  });
});

// ------------------------------------------------------------ maker-checker ----

describe("maker-checker (Deliverable 7)", () => {
  const noOverride = { overrideFlagOn: false, hasOverridePermission: false };

  it("declares the three official pairs", () => {
    expect(requiresIndependentReview("customs_preparation")).toBe(true);
    expect(requiresIndependentReview("billing_draft")).toBe(true);
    expect(requiresIndependentReview("coordinator_completeness")).toBe(true);
    expect(requiresIndependentReview("pickup")).toBe(false);
  });

  it("maps each validation step to its preparer and correction target", () => {
    expect(preparerStepFor("transit_validation")).toBe("customs_preparation");
    expect(correctionStepFor("transit_validation")).toBe("customs_preparation");
    expect(preparerStepFor("finance_invoice_validation")).toBe("billing_draft");
    expect(preparerStepFor("am_completeness")).toBe("coordinator_completeness");
    expect(isValidationStep("transit_validation")).toBe(true);
    expect(isValidationStep("customs_preparation")).toBe(false);
  });

  it("allows a DIFFERENT person to approve", () => {
    expect(evaluateMakerChecker("maker-1", "checker-2", noOverride)).toEqual({ allowed: true });
  });

  it("REFUSES self-validation by default", () => {
    expect(evaluateMakerChecker("maker-1", "maker-1", noOverride)).toEqual({
      allowed: false,
      reason: "self_validation_forbidden",
    });
  });

  it("still refuses when the override flag is on but the actor lacks process:override", () => {
    expect(
      evaluateMakerChecker("m", "m", { overrideFlagOn: true, hasOverridePermission: false }),
    ).toEqual({ allowed: false, reason: "override_not_allowed" });
  });

  it("still refuses when the actor holds process:override but the flag is off", () => {
    expect(
      evaluateMakerChecker("m", "m", { overrideFlagOn: false, hasOverridePermission: true }),
    ).toEqual({ allowed: false, reason: "self_validation_forbidden" });
  });

  it("requires a justification even with the flag AND the permission", () => {
    expect(
      evaluateMakerChecker("m", "m", { overrideFlagOn: true, hasOverridePermission: true }),
    ).toEqual({ allowed: false, reason: "reason_required" });
    expect(
      evaluateMakerChecker("m", "m", {
        overrideFlagOn: true,
        hasOverridePermission: true,
        overrideReason: "   ",
      }),
    ).toEqual({ allowed: false, reason: "reason_required" });
  });

  it("permits the override ONLY with flag + permission + reason (all three)", () => {
    expect(
      evaluateMakerChecker("m", "m", {
        overrideFlagOn: true,
        hasOverridePermission: true,
        overrideReason: "Single-person customs office; approved by management.",
      }),
    ).toEqual({ allowed: true });
  });

  it("treats an unknown maker as no conflict (nothing to self-approve)", () => {
    expect(evaluateMakerChecker(null, "checker", noOverride)).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------- evidence ----

describe("evidence checker (Deliverable 9)", () => {
  it("satisfies only on an APPROVED document", () => {
    const snap = { ...emptySnap, documents: [{ typeCode: "DELIVERY_NOTE", status: "APPROVED" }] };
    expect(checkEvidence("SIGNED_DELIVERY_NOTE", snap).status).toBe("satisfied");
  });

  it("reports an unreviewed document as pending_review, NEVER satisfied", () => {
    const snap = { ...emptySnap, documents: [{ typeCode: "DELIVERY_NOTE", status: "PENDING_REVIEW" }] };
    expect(checkEvidence("SIGNED_DELIVERY_NOTE", snap).status).toBe("pending_review");
  });

  it("reports a rejected/expired document as invalid", () => {
    const snap = { ...emptySnap, documents: [{ typeCode: "DELIVERY_NOTE", status: "REJECTED" }] };
    expect(checkEvidence("SIGNED_DELIVERY_NOTE", snap).status).toBe("invalid");
  });

  it("reports unauthorized when the caller cannot read the module", () => {
    const snap = { ...emptySnap, access: { ...emptySnap.access, customs: false } };
    expect(checkEvidence("BON_A_ENLEVER", snap).status).toBe("unauthorized");
  });

  it("never infers a BAE from an empty reference", () => {
    const snap = {
      ...emptySnap,
      customs: { required: true, status: "RELEASED", baeReference: "  ", declarationNumber: null, externalRef: null },
    };
    expect(checkEvidence("BON_A_ENLEVER", snap).status).toBe("missing");
  });

  it("says so explicitly when a document type is not in the catalog yet", () => {
    const r = checkEvidence("PROOF_OF_DEPOSIT", emptySnap);
    expect(r.status).toBe("missing");
    expect(r.detail).toBe("document_type_not_in_catalog");
  });

  it("evaluates every document a step requires", () => {
    const e = evaluateStepEvidence("customs_field_clearance", emptySnap);
    expect(e.missing).toEqual(["BON_A_ENLEVER"]);
    expect(e.complete).toBe(false);

    const ok = evaluateStepEvidence("customs_field_clearance", readySnap);
    expect(ok.complete).toBe(true);
  });

  it("derives full payment and POD from real records", () => {
    expect(fullyPaid({ ...emptySnap, invoices: [{ status: "PAID", balance: 0 }] })).toBe(true);
    expect(fullyPaid({ ...emptySnap, invoices: [{ status: "ISSUED", balance: 5 }] })).toBe(false);
    expect(fullyPaid({ ...emptySnap, invoices: [{ status: "DRAFT", balance: 0 }] })).toBe(false);
    expect(podReceived(readySnap)).toBe(true);
    expect(podReceived(emptySnap)).toBe(false);
  });
});

// --------------------------------------------------- billing + closure gates ----

describe("billing readiness (Deliverable 10)", () => {
  it("is closed until POD + both completeness checkpoints pass", () => {
    const g = evaluateBillingGate(execs(), emptySnap);
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["pod_received", "coordinator_completeness", "am_completeness"]);
  });

  it("opens once POD is approved and both checkpoints are done", () => {
    const g = evaluateBillingGate(
      execs(done("coordinator_completeness", "am_completeness")),
      readySnap,
    );
    expect(g.ready).toBe(true);
  });
});

describe("closure: DELIVERED must never mean CLOSED", () => {
  const allDone = () => Object.fromEntries(ALL_NODE_KEYS.map((k) => [k, "COMPLETED" as StepState]));

  it("refuses to close a delivered-but-unpaid dossier", () => {
    const g = evaluateClosureGate(
      execs(allDone()),
      { ...readySnap, invoices: [{ status: "ISSUED", balance: 250_000 }] },
    );
    expect(g.ready).toBe(false);
    expect(g.missing).toEqual(["fully_paid"]);
  });

  it("closes only when fully paid AND operationally complete", () => {
    const g = evaluateClosureGate(
      execs(allDone()),
      { ...readySnap, invoices: [{ status: "PAID", balance: 0 }] },
    );
    expect(g.ready).toBe(true);
  });

  it("refuses to close on the strength of UNVERIFIED_HISTORICAL steps", () => {
    const e = execs({ ...allDone(), transit_validation: "UNVERIFIED_HISTORICAL" });
    const g = evaluateClosureGate(e, { ...readySnap, invoices: [{ status: "PAID", balance: 0 }] });
    expect(g.ready).toBe(false);
    expect(g.missing).toContain("process_complete");
    expect(g.requirements.find((r) => r.key === "process_complete")!.detail).toBe(
      "unverified_historical_steps",
    );
  });

  it("readiness detail lists the exact unfinished steps", () => {
    const r = evaluateClosureReadiness({
      executions: execs({ ...allDone(), collections: "ACTIVE" }),
      fullyPaid: true,
      podReceived: true,
    });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("step_incomplete:collections");
  });

  it("never counts an unverified historical step as complete", () => {
    const r = evaluateClosureReadiness({
      executions: execs({ ...allDone(), cotation: "UNVERIFIED_HISTORICAL" }),
      fullyPaid: true,
      podReceived: true,
    });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("step_unverified:cotation");
  });
});
