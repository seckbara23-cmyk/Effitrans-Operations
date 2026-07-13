import { describe, it, expect } from "vitest";
import {
  BACKFILL_RULES,
  UNVERIFIABLE_STEPS,
  mapDossierToOfficialStep,
  type CompatibilityInput,
} from "@/lib/process/compatibility";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { FILE_STATUSES } from "@/lib/files/status";

const base: CompatibilityInput = {
  fileStatus: "IN_PROGRESS",
  fileType: "IMP",
  customs: null,
  transport: null,
  invoices: [],
  podApproved: false,
};

describe("existing-dossier compatibility (Deliverable 15)", () => {
  it("maps every existing FileStatus to something — nothing crashes", () => {
    for (const status of FILE_STATUSES) {
      expect(() => mapDossierToOfficialStep({ ...base, fileStatus: status })).not.toThrow();
    }
  });

  it("always lands on a real official step (or null for cancelled)", () => {
    const keys = new Set(EFFITRANS_PROCESS.map((s) => s.key));
    for (const status of FILE_STATUSES) {
      const m = mapDossierToOfficialStep({ ...base, fileStatus: status });
      if (m.stepKey === null) {
        expect(status).toBe("CANCELLED");
      } else {
        expect(keys.has(m.stepKey)).toBe(true);
        expect(m.stepNumber).toBeGreaterThanOrEqual(1);
        expect(m.stepNumber).toBeLessThanOrEqual(26);
      }
    }
  });

  it("takes cancelled dossiers out of the process entirely", () => {
    const m = mapDossierToOfficialStep({ ...base, fileStatus: "CANCELLED" });
    expect(m.stepNumber).toBeNull();
    expect(m.stepKey).toBeNull();
  });
});

describe("no invented evidence", () => {
  it("never reports a step as completed — only assumed", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      transport: { status: "DELIVERED" },
    });
    // The mapping exposes `assumedSteps`, never `completedSteps`.
    expect(m).not.toHaveProperty("completedSteps");
    expect(m.assumedSteps.every((n) => n < m.stepNumber!)).toBe(true);
  });

  it("marks every step whose evidence the platform never captured as unverifiable", () => {
    // The 15 steps with a `missing` verdict can never be evidenced for a legacy dossier.
    expect(UNVERIFIABLE_STEPS).toEqual([1, 4, 5, 7, 8, 10, 11, 18, 19, 21, 23, 24, 25]);
  });

  it("reports only the unverifiable steps at or before the mapped position", () => {
    const early = mapDossierToOfficialStep({ ...base, fileStatus: "OPENED" });
    expect(early.unverifiableSteps).toEqual([1]);

    const late = mapDossierToOfficialStep({
      ...base,
      fileStatus: "CLOSED",
      invoices: [{ status: "PAID", balance: 0 }],
    });
    expect(late.unverifiableSteps).toEqual(UNVERIFIABLE_STEPS);
  });

  it("flags a maker-checker step as unverified rather than assuming it happened", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      customs: { status: "DECLARATION_PREPARED", required: true },
    });
    expect(m.stepNumber).toBe(6);
    expect(m.confidence).toBe("unverified");
    expect(m.notes.join(" ")).toContain("validation Chef de Transit");
  });
});

describe("mapping from real records", () => {
  it("maps a draft dossier to dossier opening, noting cotation was never modelled", () => {
    const m = mapDossierToOfficialStep({ ...base, fileStatus: "DRAFT" });
    expect(m.stepNumber).toBe(3);
    expect(m.confidence).toBe("unverified");
    expect(m.notes.join(" ")).toContain("Cotation");
  });

  it("maps customs states to the customs chain", () => {
    expect(mapDossierToOfficialStep({ ...base, customs: { status: "DOCUMENTS_PENDING", required: true } }).stepNumber).toBe(6);
    expect(mapDossierToOfficialStep({ ...base, customs: { status: "DECLARED", required: true } }).stepNumber).toBe(12);
    expect(mapDossierToOfficialStep({ ...base, customs: { status: "INSPECTION", required: true } }).stepNumber).toBe(12);
  });

  it("moves a released dossier to transport preparation", () => {
    const m = mapDossierToOfficialStep({ ...base, customs: { status: "RELEASED", required: true } });
    expect(m.stepNumber).toBe(14);
  });

  it("maps transport states to pickup and delivery", () => {
    expect(mapDossierToOfficialStep({ ...base, transport: { status: "DRIVER_ASSIGNED" } }).stepNumber).toBe(14);
    expect(mapDossierToOfficialStep({ ...base, transport: { status: "PICKED_UP" } }).stepNumber).toBe(15);
    expect(mapDossierToOfficialStep({ ...base, transport: { status: "DELIVERED" } }).stepNumber).toBe(16);
  });

  it("records that POD used to skip the completeness checkpoints", () => {
    const m = mapDossierToOfficialStep({ ...base, transport: { status: "POD_RECEIVED" } });
    expect(m.stepNumber).toBe(18);
    expect(m.notes.join(" ")).toContain("contournant les contrôles de complétude");
  });

  it("maps a draft invoice to billing, noting no billing gate existed", () => {
    const m = mapDossierToOfficialStep({ ...base, invoices: [{ status: "DRAFT", balance: 100 }] });
    expect(m.stepNumber).toBe(20);
    expect(m.notes.join(" ")).toContain("porte de facturation");
  });

  it("cannot tell emailed from deposited for an issued invoice", () => {
    const m = mapDossierToOfficialStep({ ...base, invoices: [{ status: "ISSUED", balance: 100 }] });
    expect(m.stepNumber).toBe(22);
    expect(m.confidence).toBe("unverified");
  });

  it("supports partial payment without treating it as recovered", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      invoices: [{ status: "PARTIALLY_PAID", balance: 40 }],
    });
    expect(m.stepNumber).toBe(22);
  });

  it("maps a fully paid dossier to collections", () => {
    const m = mapDossierToOfficialStep({ ...base, invoices: [{ status: "PAID", balance: 0 }] });
    expect(m.stepNumber).toBe(26);
    expect(m.confidence).toBe("derived");
  });
});

describe("DELIVERED != CLOSED, and premature closure is surfaced", () => {
  it("does not treat a delivered dossier as closed", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      fileStatus: "DELIVERED",
      transport: { status: "DELIVERED" },
    });
    expect(m.stepNumber).toBe(16);
    expect(m.stepNumber).not.toBe(26);
  });

  it("flags a dossier closed without full payment instead of trusting it", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      fileStatus: "CLOSED",
      invoices: [{ status: "ISSUED", balance: 250_000 }],
    });
    expect(m.stepNumber).toBe(26);
    expect(m.confidence).toBe("unverified");
    expect(m.notes.join(" ")).toContain("sans paiement intégral");
  });

  it("trusts a closed dossier that is genuinely paid", () => {
    const m = mapDossierToOfficialStep({
      ...base,
      fileStatus: "CLOSED",
      invoices: [{ status: "PAID", balance: 0 }],
    });
    expect(m.confidence).toBe("derived");
  });
});

describe("backfill safety contract", () => {
  it("forbids inventing evidence, mutating status, auto-closing, or weakening RLS", () => {
    expect(BACKFILL_RULES.inventEvidence).toBe(false);
    expect(BACKFILL_RULES.mutateFileStatus).toBe(false);
    expect(BACKFILL_RULES.autoClose).toBe(false);
    expect(BACKFILL_RULES.relaxRls).toBe(false);
    expect(BACKFILL_RULES.preserveHistory).toBe(true);
    expect(BACKFILL_RULES.surfaceUnverified).toBe(true);
  });
});
