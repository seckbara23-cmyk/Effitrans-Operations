import { describe, it, expect } from "vitest";
import { getDossierLifecycle, type LifecycleInput, type StepStatus } from "@/lib/files/lifecycle";

function mk(overrides: Partial<LifecycleInput>): LifecycleInput {
  return {
    fileId: "f1",
    file: { status: "DRAFT", type: "IMP" },
    documents: [],
    missingRequired: [],
    customs: null,
    transport: null,
    invoices: [],
    podApproved: false,
    ...overrides,
  };
}
const statusOf = (lc: ReturnType<typeof getDossierLifecycle>, key: string): StepStatus =>
  lc.steps.find((s) => s.key === key)!.status;

describe("getDossierLifecycle (Phase 2.0 addendum)", () => {
  it("1. new dossier — draft is current, nothing done", () => {
    const lc = getDossierLifecycle(mk({ file: { status: "DRAFT", type: "IMP" }, missingRequired: [{ label: "Facture commerciale" }] }));
    expect(statusOf(lc, "draft")).toBe("current");
    expect(statusOf(lc, "quote_approved")).toBe("pending");
    expect(lc.currentStep).toBe("draft");
    expect(lc.nextAction?.reasonCode).toBe("approve_quote");
    expect(lc.completedPercent).toBe(0);
  });

  it("2. missing documents — collection is blocked with the missing list", () => {
    const lc = getDossierLifecycle(mk({ file: { status: "OPENED", type: "IMP" }, missingRequired: [{ label: "Facture commerciale" }] }));
    expect(statusOf(lc, "draft")).toBe("completed");
    expect(statusOf(lc, "quote_approved")).toBe("completed");
    expect(statusOf(lc, "documents_collection")).toBe("blocked");
    expect(lc.currentStep).toBe("documents_collection");
    expect(lc.blockers).toHaveLength(1);
    expect(lc.blockers[0].reason).toContain("Facture commerciale");
  });

  it("3. documents verified — customs preparation becomes current", () => {
    const lc = getDossierLifecycle(mk({ file: { status: "IN_PROGRESS", type: "IMP" }, documents: [{ status: "APPROVED" }], missingRequired: [] }));
    expect(statusOf(lc, "documents_collection")).toBe("completed");
    expect(statusOf(lc, "documents_verified")).toBe("completed");
    expect(statusOf(lc, "customs_preparation")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("declare");
  });

  it("3b. customs declaration is gated until documents are verified", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "OPENED", type: "IMP" },
      documents: [{ status: "PENDING_REVIEW" }], // collected but not approved
      missingRequired: [{ label: "BL" }],
      customs: { status: "NOT_STARTED" },
    }));
    // collection done (something uploaded), verified is the frontier, awaiting review
    expect(statusOf(lc, "documents_collection")).toBe("completed");
    expect(statusOf(lc, "documents_verified")).toBe("current");
    expect(statusOf(lc, "customs_declaration")).toBe("pending");
    expect(lc.nextAction?.reasonCode).toBe("docs_pending_review");
  });

  it("4. customs declared — inspection is current", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "DECLARED" },
    }));
    expect(statusOf(lc, "customs_preparation")).toBe("completed");
    expect(statusOf(lc, "customs_declaration")).toBe("completed");
    expect(statusOf(lc, "customs_inspection")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("await_customs_response");
  });

  it("5. customs released — transport planning becomes current (no gate)", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "NOT_STARTED" },
    }));
    expect(statusOf(lc, "release_authorized")).toBe("completed");
    expect(statusOf(lc, "transport_planned")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("plan_transport");
  });

  it("6. transport delivered — invoicing is current, gated on POD", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "DELIVERED", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "DELIVERED" },
      podApproved: false,
    }));
    expect(statusOf(lc, "delivered")).toBe("completed");
    expect(statusOf(lc, "invoiced")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("await_pod");
  });

  it("7. invoice issued — payment is current", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "DELIVERED", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "POD_RECEIVED" },
      podApproved: true,
      invoices: [{ status: "ISSUED", balance: 1000 }],
    }));
    expect(statusOf(lc, "invoiced")).toBe("completed");
    expect(statusOf(lc, "paid")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("record_payment");
  });

  it("8. invoice paid — archive is current", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "DELIVERED", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "POD_RECEIVED" },
      podApproved: true,
      invoices: [{ status: "PAID", balance: 0 }],
    }));
    expect(statusOf(lc, "paid")).toBe("completed");
    expect(statusOf(lc, "archived")).toBe("current");
    expect(lc.nextAction?.reasonCode).toBe("close_dossier");
  });

  it("9. archived — everything complete, no next action", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "CLOSED", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "POD_RECEIVED" },
      podApproved: true,
      invoices: [{ status: "PAID", balance: 0 }],
    }));
    expect(lc.steps.every((s) => s.status === "completed")).toBe(true);
    expect(lc.currentStep).toBeNull();
    expect(lc.nextAction).toBeNull();
    expect(lc.completedPercent).toBe(100);
  });

  it("exposes current and next department for handoff display", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "RELEASED" },
      transport: { status: "NOT_STARTED" },
    }));
    expect(lc.currentDepartment).toBe("transport");
    expect(lc.nextDepartment).toBe("finance");
  });

  it("skips customs steps when customs is not applicable (required=false)", () => {
    const lc = getDossierLifecycle(mk({
      file: { status: "IN_PROGRESS", type: "IMP" },
      documents: [{ status: "APPROVED" }],
      customs: { status: "NOT_STARTED", required: false },
      transport: { status: "NOT_STARTED" },
    }));
    expect(statusOf(lc, "customs_preparation")).toBe("skipped");
    expect(statusOf(lc, "release_authorized")).toBe("skipped");
    // frontier skips straight to transport
    expect(statusOf(lc, "transport_planned")).toBe("current");
  });
});
