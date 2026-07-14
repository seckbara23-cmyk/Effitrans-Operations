import { describe, it, expect } from "vitest";
import {
  CLIENT_JOURNEY,
  EFFITRANS_PROCESS,
  LEGACY_DEPT,
  MAKER_CHECKER_PAIRS,
  PARALLEL_ACTIVITIES,
  PICKUP_READINESS,
  PROCESS_STEP_COUNT,
  STEP_KEYS,
  evaluatePickupReadiness,
  getStep,
  getStepByNumber,
  stepsForDepartment,
  stepsInBranch,
} from "@/lib/process/effitrans-process";
import { DOCUMENT_MAPPINGS, MISSING_DOCUMENT_TYPES, mapDocument } from "@/lib/process/documents";
import { ROLE_MAPPINGS, mapRole, missingRoles, auditMissingRoles, roleIsUsable } from "@/lib/process/roles";
import { PROCESS_SLA_POLICIES, SLA_UNCONFIGURED_LABEL, getSlaPolicy, slaIsEnforceable } from "@/lib/process/sla-policies";

const ALL = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];
const ALL_KEYS = new Set(ALL.map((s) => s.key));

// ------------------------------------------------------ registry integrity ----

describe("official process registry — exactly 26 steps", () => {
  it("holds exactly 26 steps", () => {
    expect(EFFITRANS_PROCESS).toHaveLength(PROCESS_STEP_COUNT);
    expect(PROCESS_STEP_COUNT).toBe(26);
  });

  it("numbers them 1..26, contiguous and unique", () => {
    const numbers = EFFITRANS_PROCESS.map((s) => s.stepNumber);
    expect(numbers).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(26);
  });

  it("keeps step keys unique and stable across steps and parallel activities", () => {
    expect(new Set(STEP_KEYS).size).toBe(26);
    expect(ALL_KEYS.size).toBe(26 + PARALLEL_ACTIVITIES.length);
  });

  it("resolves every step by key and by number", () => {
    for (const step of EFFITRANS_PROCESS) {
      expect(getStep(step.key)).toBe(step);
      expect(getStepByNumber(step.stepNumber)).toBe(step);
    }
    expect(getStep("not_a_step")).toBeNull();
    expect(getStepByNumber(99)).toBeNull();
  });

  it("gives every step a French label, an internal label and a description", () => {
    for (const s of ALL) {
      expect(s.labelFr.length).toBeGreaterThan(0);
      expect(s.internalLabel.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------ step wiring ----

describe("step graph", () => {
  it("references only declared steps in prerequisites and nextSteps", () => {
    for (const s of ALL) {
      for (const p of s.prerequisites) expect(ALL_KEYS.has(p), `${s.key} prerequisite ${p}`).toBe(true);
      for (const n of s.nextSteps) expect(ALL_KEYS.has(n), `${s.key} nextStep ${n}`).toBe(true);
    }
  });

  it("points every rejection target at a declared step", () => {
    for (const s of EFFITRANS_PROCESS) {
      if (s.rejectsTo !== null) expect(ALL_KEYS.has(s.rejectsTo), `${s.key} rejectsTo`).toBe(true);
    }
  });

  it("never lets a step reject forward into the future", () => {
    for (const s of EFFITRANS_PROCESS) {
      if (!s.rejectsTo) continue;
      const target = getStep(s.rejectsTo);
      expect(target).not.toBeNull();
      expect(target!.stepNumber).toBeLessThan(s.stepNumber);
    }
  });

  it("terminates at collections (step 26 has no next step)", () => {
    const last = getStepByNumber(26)!;
    expect(last.key).toBe("collections");
    expect(last.nextSteps).toEqual([]);
  });

  it("starts at cotation with no prerequisites", () => {
    const first = getStepByNumber(1)!;
    expect(first.key).toBe("cotation");
    expect(first.prerequisites).toEqual([]);
  });
});

// ------------------------------------------------- responsible roles/depts ----

describe("responsible roles and departments", () => {
  it("maps every step's role to the official role registry", () => {
    for (const s of ALL) expect(() => mapRole(s.role)).not.toThrow();
  });

  it("covers all 15 official roles in the mapping", () => {
    expect(ROLE_MAPPINGS).toHaveLength(15);
    expect(new Set(ROLE_MAPPINGS.map((m) => m.officialRole)).size).toBe(15);
  });

  it("PRESERVES the Phase 5.0A finding: seven roles were missing at audit time", () => {
    // The historical verdict. It is a record of what we found, not a description of
    // the present, and it does not shrink as the gaps get closed.
    expect(auditMissingRoles().map((m) => m.officialRole).sort()).toEqual([
      "ADMINISTRATIVE_OFFICER",
      "BILLING_OFFICER",
      "COLLECTIONS_OFFICER",
      "COURIER",
      "CUSTOMS_FIELD_AGENT",
      "CUSTOMS_FINANCE_OFFICER",
      "PICKUP_AGENT",
    ]);
  });

  it("and records that Phase 5.0B CLOSED all seven — no role is missing today", () => {
    // The map went stale here for two phases: 5.0B created these roles in the
    // migration and the seed, but ROLE_MAPPINGS still said tenantRole: null. Nothing
    // read it until the 5.0E-2B pilot checklist did, and it then reported 9 of 26
    // steps as untestable — which was false. Both facts now live side by side.
    expect(missingRoles()).toEqual([]);
    for (const m of auditMissingRoles()) {
      expect(m.tenantRole, m.officialRole).not.toBeNull();
      expect(m.status, m.officialRole).toBe("mapped");
    }
  });

  it("flags QUOTATION_MANAGER as inert, not usable", () => {
    const m = mapRole("COTATION_OFFICER");
    expect(m.tenantRole).toBe("QUOTATION_MANAGER");
    expect(m.status).toBe("inert");
    expect(roleIsUsable("COTATION_OFFICER")).toBe(false);
  });

  it("reuses existing roles where they are semantically equivalent", () => {
    expect(mapRole("OPERATIONS_MANAGER").tenantRole).toBe("OPS_SUPERVISOR");
    expect(mapRole("CHIEF_TRANSIT").tenantRole).toBe("CHIEF_OF_TRANSIT");
    expect(mapRole("COORDINATOR").tenantRole).toBe("COORDINATOR");
    expect(mapRole("ACCOUNT_MANAGER").tenantRole).toBe("ACCOUNT_MANAGER");
  });

  it("bridges every official department to a legacy UI department", () => {
    for (const s of ALL) expect(LEGACY_DEPT[s.department]).toBeDefined();
  });

  it("builds a non-empty queue for every department that owns work", () => {
    for (const dept of new Set(ALL.map((s) => s.department))) {
      expect(stepsForDepartment(dept).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------- account manager owns ----

describe("Account Manager ownership", () => {
  it("keeps the Account Manager as the customer-facing owner across the dossier", () => {
    const amSteps = EFFITRANS_PROCESS.filter((s) => s.role === "ACCOUNT_MANAGER").map((s) => s.stepNumber);
    expect(amSteps).toEqual([3, 16, 19]);
  });

  it("gives the Account Manager the whole parallel readiness branch", () => {
    expect(PARALLEL_ACTIVITIES.every((a) => a.role === "ACCOUNT_MANAGER")).toBe(true);
  });
});

// --------------------------------------------------------- parallel branch ----

describe("parallel branches and the pickup join gate", () => {
  it("puts the customs chain (steps 4-13) in the customs branch", () => {
    const customs = EFFITRANS_PROCESS.filter((s) => s.parallelGroup === "customs").map((s) => s.stepNumber);
    expect(customs).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("runs transport readiness as a branch, not a linear stage", () => {
    const branch = stepsInBranch("transport_readiness");
    expect(branch.map((s) => s.key).sort()).toEqual([
      "bon_a_delivrer",
      "pre_gate",
      "transport_assignment",
      "transport_docs_transmission",
    ]);
  });

  it("lets both branches depart from the same upstream step (no forced ordering)", () => {
    // Customs enters via step 4; transport readiness enters via step 14 + activities.
    // Both hang off am_dossier_opening, so neither blocks the other.
    expect(getStep("coordinator_reception")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(getStep("transport_assignment")!.prerequisites).toEqual(["am_dossier_opening"]);
    expect(getStep("bon_a_delivrer" as string)).toBeNull(); // it is an activity, not a numbered step
  });

  it("converges both branches at pickup (step 15)", () => {
    const pickup = getStepByNumber(15)!;
    expect(pickup.key).toBe("pickup");
    expect(pickup.prerequisites).toEqual(["customs_field_clearance", "transport_assignment"]);
    expect(pickup.parallelGroup).toBe("main");
  });

  it("declares six pickup-readiness requirements across both branches", () => {
    expect(PICKUP_READINESS.map((r) => r.key)).toEqual([
      "customs_released",
      "bon_a_delivrer",
      "pre_gate",
      "bordereau_livraison",
      "vehicle_assigned",
      "driver_assigned",
    ]);
    expect(PICKUP_READINESS.filter((r) => r.branch === "customs")).toHaveLength(1);
    expect(PICKUP_READINESS.filter((r) => r.branch === "transport_readiness")).toHaveLength(5);
  });
});

describe("pickup readiness gate", () => {
  const ready = {
    fileType: "IMP",
    customsReleased: true,
    customsRequired: true,
    bonADelivrer: true,
    preGate: true,
    bordereauLivraison: true,
    vehicleAssigned: true,
    driverAssigned: true,
  };

  it("opens only when every applicable requirement is satisfied", () => {
    const r = evaluatePickupReadiness(ready);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("blocks pickup when customs is released but transport is not ready", () => {
    const r = evaluatePickupReadiness({ ...ready, bonADelivrer: false, preGate: false });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["bon_a_delivrer", "pre_gate"]);
  });

  it("blocks pickup when transport is ready but customs is not released", () => {
    const r = evaluatePickupReadiness({ ...ready, customsReleased: false });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["customs_released"]);
  });

  it("blocks pickup when no vehicle or driver is assigned", () => {
    const r = evaluatePickupReadiness({ ...ready, vehicleAssigned: false, driverAssigned: false });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["vehicle_assigned", "driver_assigned"]);
  });

  it("is configurable by operation type — TRP/HND carry no customs leg", () => {
    const trp = evaluatePickupReadiness({ ...ready, fileType: "TRP", customsReleased: false });
    expect(trp.ready).toBe(true);
    expect(trp.notApplicable).toEqual(["customs_released"]);

    const imp = evaluatePickupReadiness({ ...ready, fileType: "IMP", customsReleased: false });
    expect(imp.ready).toBe(false);
  });

  it("mirrors canPickup(): customs that is not required does not block", () => {
    const r = evaluatePickupReadiness({ ...ready, customsReleased: false, customsRequired: false });
    expect(r.ready).toBe(true);
  });
});

// ----------------------------------------------------------- maker-checker ----

describe("maker-checker separation (Deliverable 8)", () => {
  it("declares the three independent-review pairs", () => {
    expect(MAKER_CHECKER_PAIRS.map((p) => p.key)).toEqual([
      "customs_validation",
      "invoice_validation",
      "completeness_review",
    ]);
  });

  it("never allows self-approval and always requires a reason", () => {
    for (const p of MAKER_CHECKER_PAIRS) {
      expect(p.selfApprovalAllowed).toBe(false);
      expect(p.reasonRequired).toBe(true);
    }
  });

  it("keeps preparer and validator as distinct steps with distinct roles", () => {
    for (const p of MAKER_CHECKER_PAIRS) {
      const preparer = getStep(p.preparerStep)!;
      const validator = getStep(p.validatorStep)!;
      expect(preparer.key).not.toBe(validator.key);
      expect(preparer.role).not.toBe(validator.role);
    }
  });

  it("routes every rejection back to an explicit correction step", () => {
    for (const p of MAKER_CHECKER_PAIRS) {
      const validator = getStep(p.validatorStep)!;
      expect(validator.rejectsTo).toBe(p.correctionStep);
      expect(getStep(p.correctionStep)).not.toBeNull();
    }
  });

  it("separates the Declarant from the Chief Transit who validates their work", () => {
    expect(getStep("customs_preparation")!.role).toBe("CUSTOMS_DECLARANT");
    expect(getStep("transit_validation")!.role).toBe("CHIEF_TRANSIT");
  });

  it("separates Billing (drafts) from Finance (validates)", () => {
    expect(getStep("billing_draft")!.role).toBe("BILLING_OFFICER");
    expect(getStep("finance_invoice_validation")!.role).toBe("FINANCE_OFFICER");
  });
});

// -------------------------------------------------------------- ordering ----

describe("hard ordering constraints", () => {
  it("requires GAINDE registration (9) strictly before document submission (11)", () => {
    const submission = getStep("gainde_document_submission")!;
    expect(submission.stepNumber).toBe(11);
    expect(submission.prerequisites).toContain("gainde_registration");
    expect(getStep("gainde_registration")!.stepNumber).toBe(9);
  });

  it("makes Finance — not the Declarant — responsible for GAINDE registration", () => {
    expect(getStep("gainde_registration")!.role).toBe("CUSTOMS_FINANCE_OFFICER");
    expect(getStep("gainde_document_submission")!.role).toBe("CUSTOMS_DECLARANT");
  });

  it("requires the BAE before pickup", () => {
    expect(getStep("customs_field_clearance")!.requiredDocuments).toContain("BON_A_ENLEVER");
    expect(getStep("pickup")!.prerequisites).toContain("customs_field_clearance");
  });

  it("routes POD through the Coordinator and the AM before Billing — never straight to Finance", () => {
    expect(getStep("transport_pod_handoff")!.nextSteps).toEqual(["coordinator_completeness"]);
    expect(getStep("coordinator_completeness")!.nextSteps).toEqual(["am_completeness"]);
    expect(getStep("am_completeness")!.nextSteps).toEqual(["billing_draft"]);
  });

  it("gates billing on the two completeness checkpoints", () => {
    expect(getStep("billing_draft")!.prerequisites).toEqual(["am_completeness"]);
    expect(getStep("am_completeness")!.completionRule).toBe("billing_ready");
  });

  it("closes only after full payment — DELIVERED must not equal CLOSED", () => {
    const closure = getStep("collections")!;
    expect(closure.completionRule).toBe("fully_paid_and_operationally_complete");
    // Delivery is step 16; closure is step 26. Ten steps stand between them.
    expect(getStep("am_delivery_followup")!.stepNumber).toBe(16);
    expect(closure.stepNumber).toBe(26);
  });

  it("keeps archiving (23) separate from financial closure (26)", () => {
    expect(getStep("administration_deposit_prep")!.completionRule).toBe("courier_assigned_and_dossier_archived");
    expect(getStep("administration_deposit_prep")!.stepNumber).toBeLessThan(getStep("collections")!.stepNumber);
  });
});

// -------------------------------------------------------------- documents ----

describe("required-document mapping (Deliverable 9)", () => {
  it("maps every document a step requires to the official document registry", () => {
    for (const s of ALL) {
      for (const d of s.requiredDocuments) expect(() => mapDocument(d), `${s.key} → ${d}`).not.toThrow();
    }
  });

  it("covers the 17 official artefacts", () => {
    expect(DOCUMENT_MAPPINGS).toHaveLength(17);
    expect(new Set(DOCUMENT_MAPPINGS.map((d) => d.key)).size).toBe(17);
  });

  it("has NO document types left missing — the catalog is complete (Phase 5.0D)", () => {
    expect(MISSING_DOCUMENT_TYPES).toEqual([]);
  });

  it("shipped the two pickup-gate document types in Phase 5.0B", () => {
    // Without a type to hold them, the official pickup gate could only ever block,
    // never open — so these two could not wait for 5.0D.
    expect(mapDocument("BON_A_DELIVRER").typeCode).toBe("BON_A_DELIVRER");
    expect(mapDocument("BON_A_DELIVRER").status).toBe("mapped");
    expect(mapDocument("PRE_GATE_AUTHORIZATION").typeCode).toBe("PRE_GATE_AUTHORIZATION");
    expect(mapDocument("PRE_GATE_AUTHORIZATION").status).toBe("mapped");
  });

  it("SPLIT the DELIVERY_NOTE conflation in Phase 5.0D (prepared BL vs signed POD)", () => {
    // The conflation was not cosmetic: it made the pickup gate unsatisfiable,
    // because the only type that could satisfy "Bordereau de Livraison" was a POD
    // that cannot exist until after delivery.
    expect(mapDocument("BORDEREAU_LIVRAISON").typeCode).toBe("BORDEREAU_LIVRAISON");
    expect(mapDocument("SIGNED_DELIVERY_NOTE").typeCode).toBe("DELIVERY_NOTE");
    expect(mapDocument("BORDEREAU_LIVRAISON").typeCode).not.toBe(
      mapDocument("SIGNED_DELIVERY_NOTE").typeCode,
    );
  });

  it("keeps the customs dossier and the final invoice as structured records, not uploads", () => {
    expect(mapDocument("CUSTOMS_DOSSIER").status).toBe("structured");
    expect(mapDocument("FINAL_INVOICE").status).toBe("structured");
  });

  it("reuses PAYMENT_RECEIPT for receipts and payment proofs — no duplicate uploads", () => {
    expect(mapDocument("RECEIPT").typeCode).toBe("PAYMENT_RECEIPT");
    expect(mapDocument("PAYMENT_PROOF").typeCode).toBe("PAYMENT_RECEIPT");
  });
});

// ------------------------------------------------------------------- SLA ----

describe("SLA policies (Deliverable 13) — no invented values", () => {
  it("gives every step an SLA policy key that resolves", () => {
    for (const s of ALL) expect(getSlaPolicy(s.slaPolicyKey), s.key).not.toBeNull();
  });

  it("never fabricates a value for an unconfigured policy", () => {
    for (const p of PROCESS_SLA_POLICIES) {
      if (p.state === "unconfigured") {
        expect(p.warningHours).toBeNull();
        expect(p.criticalHours).toBeNull();
      }
    }
  });

  it("never lets an unconfigured policy produce an overdue status", () => {
    for (const p of PROCESS_SLA_POLICIES) {
      if (p.state === "unconfigured") expect(slaIsEnforceable(p.key)).toBe(false);
    }
    expect(SLA_UNCONFIGURED_LABEL).toBe("SLA non configuré");
  });

  it("marks the four pre-existing live thresholds as unratified, not approved", () => {
    const unratified = PROCESS_SLA_POLICIES.filter((p) => p.state === "unratified");
    expect(unratified.map((p) => p.key).sort()).toEqual([
      "completeness_review",
      "customs_preparation",
      "invoice_validation",
      "transport_assignment",
    ]);
    for (const p of unratified) {
      expect(p.warningHours).not.toBeNull();
      expect(p.source).toContain("lib/sla/config.ts");
    }
  });

  it("has nothing ratified yet — management has approved no value", () => {
    expect(PROCESS_SLA_POLICIES.filter((p) => p.state === "ratified")).toHaveLength(0);
  });
});

// -------------------------------------------------------- client journey ----

describe("client-visible journey (Deliverable 11)", () => {
  it("exposes exactly ten customer-safe stages", () => {
    expect(CLIENT_JOURNEY.map((s) => s.key)).toEqual([
      "request_received",
      "documentation_in_preparation",
      "customs_processing",
      "customs_released",
      "transport_preparation",
      "pickup_completed",
      "in_transit",
      "delivered",
      "invoice_issued",
      "payment_closure",
    ]);
  });

  it("maps every customer-visible step to a declared stage", () => {
    const stages = new Set(CLIENT_JOURNEY.map((s) => s.key));
    for (const s of ALL) {
      if (s.clientStage !== null) expect(stages.has(s.clientStage), s.key).toBe(true);
    }
  });

  it("never exposes internal validation loops to the client", () => {
    for (const key of [
      "transit_validation",
      "finance_invoice_validation",
      "coordinator_completeness",
      "am_completeness",
    ]) {
      expect(getStep(key)!.clientStage, key).toBeNull();
    }
  });

  it("never exposes coordinator handoffs, spending authorisations, deposit or collection internals", () => {
    for (const key of [
      "coordinator_reception",
      "coordinator_to_finance",
      "coordinator_to_declarant",
      "transit_declarant_assignment",
      "transport_pod_handoff",
      "administration_deposit_prep",
      "courier_deposit",
      "administration_proof_handoff",
    ]) {
      expect(getStep(key)!.clientStage, key).toBeNull();
    }
  });
});

// --------------------------------------------------------- audit verdicts ----

describe("Phase 5.0A audit verdicts", () => {
  it("records a verdict for every step", () => {
    for (const s of ALL) {
      expect(["implemented", "partial", "missing"]).toContain(s.implementation.verdict);
    }
  });

  it("nothing is fully implemented yet", () => {
    expect(EFFITRANS_PROCESS.filter((s) => s.implementation.verdict === "implemented")).toHaveLength(0);
  });

  it("counts 13 partial and 13 missing steps", () => {
    expect(EFFITRANS_PROCESS.filter((s) => s.implementation.verdict === "partial")).toHaveLength(13);
    expect(EFFITRANS_PROCESS.filter((s) => s.implementation.verdict === "missing")).toHaveLength(13);
  });

  it("names at least one concrete gap for every step that is not implemented", () => {
    for (const s of ALL) {
      if (s.implementation.verdict !== "implemented") {
        expect(s.implementation.gaps.length, s.key).toBeGreaterThan(0);
      }
    }
  });
});
