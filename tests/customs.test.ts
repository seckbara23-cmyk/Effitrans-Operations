import { describe, it, expect } from "vitest";
import { canTransition, nextStatuses, isTerminal, isCustomsStatus } from "@/lib/customs/status";
import {
  requiredCustomsDocCodes,
  canDeclare,
  canRelease,
  canCloseFile,
} from "@/lib/customs/gates";

describe("customs state machine", () => {
  it("allows the forward flow", () => {
    expect(canTransition("NOT_STARTED", "DOCUMENTS_PENDING")).toBe(true);
    expect(canTransition("DECLARATION_PREPARED", "DECLARED")).toBe(true);
    expect(canTransition("DUTIES_ASSESSED", "RELEASED")).toBe(true);
  });
  it("allows BLOCKED/CANCELLED from active states and resume from BLOCKED", () => {
    expect(canTransition("DECLARED", "BLOCKED")).toBe(true);
    expect(canTransition("BLOCKED", "INSPECTION")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "CANCELLED")).toBe(true);
  });
  it("treats RELEASED and CANCELLED as terminal", () => {
    expect(nextStatuses("RELEASED")).toEqual([]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
    expect(isTerminal("RELEASED")).toBe(true);
    expect(isTerminal("DECLARED")).toBe(false);
  });
  it("rejects illegal jumps", () => {
    expect(canTransition("NOT_STARTED", "RELEASED")).toBe(false);
    expect(canTransition("DOCUMENTS_PENDING", "RELEASED")).toBe(false);
    expect(isCustomsStatus("FOO")).toBe(false);
  });
});

describe("customs gates", () => {
  const gating = ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "BILL_OF_LADING", "AIRWAY_BILL"];

  it("applies the BL/AWB-by-mode rule", () => {
    expect(requiredCustomsDocCodes(gating, "SEA")).toContain("BILL_OF_LADING");
    expect(requiredCustomsDocCodes(gating, "SEA")).not.toContain("AIRWAY_BILL");
    expect(requiredCustomsDocCodes(gating, "AIR")).toContain("AIRWAY_BILL");
    expect(requiredCustomsDocCodes(gating, "AIR")).not.toContain("BILL_OF_LADING");
    const road = requiredCustomsDocCodes(gating, "ROAD");
    expect(road).not.toContain("BILL_OF_LADING");
    expect(road).not.toContain("AIRWAY_BILL");
    expect(road).toContain("COMMERCIAL_INVOICE");
  });

  it("canDeclare only when nothing is missing", () => {
    expect(canDeclare([])).toBe(true);
    expect(canDeclare(["PACKING_LIST"])).toBe(false);
  });

  it("canRelease requires a BAE reference", () => {
    expect(canRelease({ baeReference: "BAE-123" })).toBe(true);
    expect(canRelease({ baeReference: "  " })).toBe(false);
    expect(canRelease({ baeReference: null })).toBe(false);
  });

  it("canCloseFile blocks only required, un-released IMP/EXP", () => {
    expect(canCloseFile("TRP", null)).toBe(true);
    expect(canCloseFile("IMP", null)).toBe(true); // no record => allowed
    expect(canCloseFile("IMP", { required: false, status: "DECLARED" })).toBe(true);
    expect(canCloseFile("IMP", { required: true, status: "DECLARED" })).toBe(false);
    expect(canCloseFile("IMP", { required: true, status: "RELEASED" })).toBe(true);
    expect(canCloseFile("EXP", { required: true, status: "CANCELLED" })).toBe(true);
  });
});
