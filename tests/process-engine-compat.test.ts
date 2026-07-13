/**
 * Phase 5.0B-4 — historical compatibility + consolidated read model.
 *
 * The rule under test: a legacy dossier is NEVER credited with evidence the
 * platform did not capture. Prior steps become UNVERIFIED_HISTORICAL, which
 * satisfies no prerequisite, no gate, and no closure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildInitialExecutions, planCompatibilityInit, PROCESS_VERSION } from "@/lib/process/engine/init";
import { buildReadModel } from "@/lib/process/engine/read-model";
import { ALL_NODE_KEYS, prerequisitesMet } from "@/lib/process/engine/state";
import type { EvidenceSnapshot } from "@/lib/process/engine/evidence";
import type { HandoffRow, ProcessInstanceRow, StepExecutionRow } from "@/lib/process/engine/types";

const T = "tenant-a";
const I = "inst-1";

const snap: EvidenceSnapshot = {
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: null,
  transport: null,
  invoices: [],
};

function instance(over: Partial<ProcessInstanceRow> = {}): ProcessInstanceRow {
  return {
    id: I,
    tenantId: T,
    fileId: "file-1",
    processVersion: PROCESS_VERSION,
    status: "ACTIVE",
    compatibilitySource: "NATIVE",
    compatibilityVersion: null,
    startedAt: "2026-07-13T00:00:00Z",
    completedAt: null,
    closedAt: null,
    ...over,
  };
}

function execRows(states: Record<string, string>): StepExecutionRow[] {
  return ALL_NODE_KEYS.map((stepKey, i) => ({
    id: `e${i}`,
    processInstanceId: I,
    stepKey,
    stepNumber: null,
    state: (states[stepKey] ?? "PENDING") as StepExecutionRow["state"],
    assignedUserId: null,
    assignedRoleCode: null,
    submittedBy: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    receivedFromUserId: null,
    receivedAt: null,
    startedAt: null,
    completedAt: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    correctionOfId: null,
    overrideUsed: false,
    overrideReason: null,
    evidenceSummary: null,
  }));
}

// ------------------------------------------------------------ native init ----

describe("native initialization", () => {
  const rows = buildInitialExecutions(T, I);

  it("materializes all 29 registry nodes exactly once", () => {
    expect(rows).toHaveLength(29);
    expect(new Set(rows.map((r) => r.step_key)).size).toBe(29);
  });

  it("opens only step 1 and leaves everything else PENDING", () => {
    const open = rows.filter((r) => r.state === "AVAILABLE");
    expect(open).toHaveLength(1);
    expect(open[0].step_key).toBe("cotation");
    expect(rows.filter((r) => r.state === "PENDING")).toHaveLength(28);
  });

  it("never invents a completed step", () => {
    expect(rows.some((r) => r.state === "COMPLETED")).toBe(false);
  });

  it("stamps every row with the tenant and the instance", () => {
    expect(rows.every((r) => r.tenant_id === T && r.process_instance_id === I)).toBe(true);
  });
});

// --------------------------------------------------- compatibility mapping ----

describe("historical compatibility (Deliverable 10)", () => {
  it("maps a delivered legacy dossier and marks prior steps UNVERIFIED, never COMPLETED", () => {
    const plan = planCompatibilityInit(T, I, {
      fileStatus: "DELIVERED",
      fileType: "IMP",
      customs: { status: "RELEASED", required: true },
      transport: { status: "DELIVERED" },
      invoices: [],
      podApproved: false,
    });

    expect(plan.stepNumber).toBe(16);
    // NOTHING is completed. Not one step.
    expect(plan.executions.some((e) => e.state === "COMPLETED")).toBe(false);
    expect(plan.executions.some((e) => e.state === "APPROVED")).toBe(false);
    expect(plan.summary.unverified).toBeGreaterThan(0);
    expect(plan.summary.active).toBe(1);
  });

  it("never invents an approval, a document or a payment", () => {
    const plan = planCompatibilityInit(T, I, {
      fileStatus: "CLOSED",
      fileType: "IMP",
      customs: { status: "RELEASED", required: true },
      transport: { status: "POD_RECEIVED" },
      invoices: [{ status: "PAID", balance: 0 }],
      podApproved: true,
    });
    // Even a fully paid, closed legacy dossier gets zero COMPLETED steps: the
    // official steps' evidence (validations, handoffs, receptions) never existed.
    expect(plan.executions.every((e) => e.state !== "COMPLETED")).toBe(true);
  });

  it("an UNVERIFIED_HISTORICAL step satisfies NO prerequisite", () => {
    const plan = planCompatibilityInit(T, I, {
      fileStatus: "IN_PROGRESS",
      fileType: "IMP",
      customs: { status: "DECLARED", required: true },
      transport: null,
      invoices: [],
      podApproved: false,
    });
    const views = plan.executions.map((e) => ({ stepKey: e.step_key, state: e.state }));
    // Step 12 is ACTIVE; step 11 is UNVERIFIED_HISTORICAL. Step 12's prerequisite
    // (step 11) is therefore NOT met — the engine will not let it be completed on
    // the strength of a step nobody evidenced.
    expect(prerequisitesMet("customs_followup", views)).toBe(false);
  });

  it("cancels the whole instance for a cancelled dossier", () => {
    const plan = planCompatibilityInit(T, I, {
      fileStatus: "CANCELLED",
      fileType: "IMP",
      customs: null,
      transport: null,
      invoices: [],
      podApproved: false,
    });
    expect(plan.stepNumber).toBeNull();
    expect(plan.executions.every((e) => e.state === "CANCELLED")).toBe(true);
  });

  it("carries the mapper's notes into the plan (no silent assumptions)", () => {
    const plan = planCompatibilityInit(T, I, {
      fileStatus: "CLOSED",
      fileType: "IMP",
      customs: null,
      transport: null,
      invoices: [{ status: "ISSUED", balance: 100 }],
      podApproved: false,
    });
    expect(plan.notes.join(" ")).toContain("sans paiement intégral");
    expect(plan.confidence).toBe("unverified");
  });
});

// ---------------------------------------------------------------- read model ----

describe("consolidated read model (Deliverable 11)", () => {
  it("reports branches, gates, owner and phase in ONE object", () => {
    const rows = execRows({ cotation: "ACTIVE" });
    const m = buildReadModel(instance(), rows, [], snap);

    expect(m.processVersion).toBe(PROCESS_VERSION);
    expect(m.activeSteps.map((s) => s.stepKey)).toEqual(["cotation"]);
    expect(m.currentPhase).toBe("cotation");
    expect(m.currentOwner?.role).toBe("COTATION_OFFICER");
    expect(m.branches.customs).toBeDefined();
    expect(m.branches.transportReadiness).toBeDefined();
    expect(m.pickupReadiness.ready).toBe(false);
    expect(m.billingReadiness.ready).toBe(false);
    expect(m.closureReadiness.ready).toBe(false);
  });

  it("never fabricates an overdue status for an unconfigured SLA", () => {
    const m = buildReadModel(instance(), execRows({ cotation: "ACTIVE" }), [], snap);
    expect(m.activeSteps[0].sla.state).toBe("unconfigured");
    expect(m.activeSteps[0].sla.label).toBe("SLA non configuré");
  });

  it("surfaces the pending handoff awaiting explicit reception", () => {
    const h: HandoffRow = {
      id: "h1",
      processInstanceId: I,
      fromStepKey: "am_dossier_opening",
      toStepKey: "coordinator_reception",
      sentBy: "u1",
      sentAt: "2026-07-13T00:00:00Z",
      receivedBy: null,
      receivedAt: null,
      status: "SENT",
      rejectionReason: null,
      returnedToStepKey: null,
      dedupKey: "k",
    };
    const m = buildReadModel(instance(), execRows({}), [h], snap);
    expect(m.pendingHandoff?.toStepKey).toBe("coordinator_reception");
  });

  it("flags a mapped instance with unverified steps as low confidence", () => {
    const rows = execRows({ cotation: "UNVERIFIED_HISTORICAL", operations_intake: "ACTIVE" });
    const m = buildReadModel(
      instance({ compatibilitySource: "COMPATIBILITY_MAPPED", compatibilityVersion: "compat-v1" }),
      rows,
      [],
      snap,
    );
    expect(m.compatibilityConfidence).toBe("mapped_with_unverified_steps");
    expect(m.unverifiedSteps).toEqual(["cotation"]);
    // An unverified step is NOT counted as completed.
    expect(m.completedSteps).not.toContain("cotation");
  });

  it("exposes the correction loop with its rejection reason", () => {
    const rows = execRows({});
    rows[0] = { ...rows[0], id: "rej", stepKey: "customs_preparation", state: "REJECTED", rejectionReason: "Facture commerciale illisible" };
    rows[1] = { ...rows[1], id: "fix", stepKey: "customs_preparation", state: "ACTIVE", correctionOfId: "rej" };
    const m = buildReadModel(instance(), rows, [], snap);

    expect(m.correctionState).toEqual([
      { stepKey: "customs_preparation", reason: "Facture commerciale illisible", correctionOfId: "rej" },
    ]);
  });

  it("maps to a customer-safe journey stage, never an internal one", () => {
    const m = buildReadModel(instance(), execRows({ transit_validation: "ACTIVE" }), [], snap);
    // transit_validation is an INTERNAL validation loop: clientStage is null.
    expect(m.activeSteps[0].stepKey).toBe("transit_validation");
    expect(m.clientStage).toBeNull();
  });
});

// -------------------------------------------------------------- audit safety ----

describe("audit payloads carry no sensitive content (Deliverable 12)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/process/engine/actions.ts", import.meta.url)),
    "utf8",
  );

  it("never audits document contents, storage paths, bytes or credentials", () => {
    for (const forbidden of [
      "storage_path",
      "signedUrl",
      "password",
      "temporaryPassword",
      "secret",
      "token",
      "api_key",
      "file_bytes",
    ]) {
      expect(src, `audit payload must never reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("audits evidence as KEYS only, never as document rows", () => {
    // The engine writes `evidence: ev.satisfied` — an array of official document
    // KEYS (e.g. BON_A_ENLEVER) — never the document rows themselves.
    expect(src).toContain("evidence: ev.satisfied");
    expect(src).not.toContain("evidence: snap.evidence.documents");
  });

  it("requires an explicit override reason before it can ever be audited", () => {
    expect(src).toContain("isOverride: true");
    expect(src).toContain("overrideReason: opts?.overrideReason");
  });

  it("routes every mutation through the permission guard", () => {
    // Each exported mutation calls guard(), which asserts the flag, the
    // permission, and dossier visibility before anything else happens.
    const mutations = [
      "initializeProcessForFile",
      "activateStep",
      "submitStep",
      "approveStep",
      "rejectStep",
      "sendHandoff",
      "receiveHandoff",
      "rejectHandoff",
    ];
    for (const m of mutations) expect(src).toContain(`export async function ${m}`);
    // guard() is the only path to a ctx, and it checks the flag first.
    expect(src).toContain('if (!getProcessFlags().enabled) return "engine_disabled"');
  });
});
