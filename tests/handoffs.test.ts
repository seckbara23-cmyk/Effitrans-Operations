import { describe, it, expect } from "vitest";
import {
  HANDOFFS,
  HANDOFF_TYPES,
  isHandoffType,
  documentationComplete,
  dossierFullyPaid,
} from "@/lib/handoffs/rules";

describe("handoff rules (Phase 2.1)", () => {
  it("defines exactly four department handoffs with correct source/target/role", () => {
    expect(HANDOFF_TYPES).toEqual(["CUSTOMS_HANDOFF", "TRANSPORT_HANDOFF", "FINANCE_HANDOFF", "ARCHIVE_HANDOFF"]);
    expect(HANDOFFS.CUSTOMS_HANDOFF).toMatchObject({ source: "documentation", target: "customs", role: "CUSTOMS_DECLARANT" });
    expect(HANDOFFS.TRANSPORT_HANDOFF).toMatchObject({ source: "customs", target: "transport", role: "TRANSPORT_OFFICER" });
    expect(HANDOFFS.FINANCE_HANDOFF).toMatchObject({ source: "transport", target: "finance", role: "FINANCE_OFFICER" });
    expect(HANDOFFS.ARCHIVE_HANDOFF).toMatchObject({ source: "finance", target: "archive", role: "OPS_SUPERVISOR" });
  });

  it("guards handoff type strings", () => {
    expect(isHandoffType("FINANCE_HANDOFF")).toBe(true);
    expect(isHandoffType("NOT_A_TYPE")).toBe(false);
  });
});

describe("Documentation → Customs precondition", () => {
  it("fires only when every required document is approved", () => {
    expect(documentationComplete(["BL", "INVOICE"], ["BL", "INVOICE", "EXTRA"])).toBe(true);
    expect(documentationComplete(["BL", "INVOICE"], ["BL"])).toBe(false);
  });
  it("does not fire when nothing is required (no false handoff)", () => {
    expect(documentationComplete([], ["BL"])).toBe(false);
  });
  it("is deterministic — re-evaluating the same state yields the same decision (idempotent trigger)", () => {
    const required = ["BL", "INVOICE"];
    const approved = ["BL", "INVOICE"];
    expect(documentationComplete(required, approved)).toBe(documentationComplete(required, approved));
  });
});

describe("Finance → Archive precondition", () => {
  it("fires when issued invoices all carry zero balance", () => {
    expect(dossierFullyPaid([{ status: "PAID", balance: 0 }])).toBe(true);
  });
  it("does not fire while any issued invoice owes a balance", () => {
    expect(dossierFullyPaid([{ status: "PAID", balance: 0 }, { status: "ISSUED", balance: 500 }])).toBe(false);
  });
  it("does not fire with no issued invoices (DRAFT/VOID ignored)", () => {
    expect(dossierFullyPaid([{ status: "DRAFT", balance: 0 }])).toBe(false);
    expect(dossierFullyPaid([{ status: "VOID", balance: 0 }])).toBe(false);
    expect(dossierFullyPaid([])).toBe(false);
  });
});
