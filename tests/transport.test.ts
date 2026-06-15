import { describe, it, expect } from "vitest";
import { canTransition, nextStatuses, isTerminal, isTransportStatus } from "@/lib/transport/status";
import { canPickup, canReceivePod } from "@/lib/transport/gates";

describe("transport state machine", () => {
  it("allows the forward flow incl. the short-haul jump", () => {
    expect(canTransition("NOT_STARTED", "PLANNED")).toBe(true);
    expect(canTransition("DRIVER_ASSIGNED", "PICKED_UP")).toBe(true);
    expect(canTransition("PICKED_UP", "DELIVERED")).toBe(true); // short haul
    expect(canTransition("DELIVERED", "POD_RECEIVED")).toBe(true);
  });
  it("supports BLOCKED pause/resume and CANCELLED", () => {
    expect(canTransition("IN_TRANSIT", "BLOCKED")).toBe(true);
    expect(canTransition("BLOCKED", "DELIVERED")).toBe(true);
    expect(canTransition("PLANNED", "CANCELLED")).toBe(true);
  });
  it("treats POD_RECEIVED and CANCELLED as terminal", () => {
    expect(nextStatuses("POD_RECEIVED")).toEqual([]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
    expect(isTerminal("POD_RECEIVED")).toBe(true);
    expect(isTerminal("DELIVERED")).toBe(false);
  });
  it("rejects illegal jumps", () => {
    expect(canTransition("NOT_STARTED", "DELIVERED")).toBe(false);
    expect(canTransition("PLANNED", "PICKED_UP")).toBe(false);
    expect(isTransportStatus("FLYING")).toBe(false);
  });
});

describe("transport gates", () => {
  it("canPickup: TRP/HND never gated", () => {
    expect(canPickup("TRP", null, false)).toBe(true);
    expect(canPickup("HND", { required: true, status: "DOCUMENTS_PENDING" }, false)).toBe(true);
  });
  it("canPickup: IMP/EXP need RELEASED unless not-required or override", () => {
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, true)).toBe(true); // override
    expect(canPickup("IMP", { required: false, status: "DECLARED" }, false)).toBe(true);
    expect(canPickup("EXP", null, false)).toBe(true); // no record
  });
  it("canReceivePod requires an approved DELIVERY_NOTE", () => {
    expect(canReceivePod(["DELIVERY_NOTE"])).toBe(true);
    expect(canReceivePod(["COMMERCIAL_INVOICE", "DELIVERY_NOTE"])).toBe(true);
    expect(canReceivePod(["COMMERCIAL_INVOICE"])).toBe(false);
    expect(canReceivePod([])).toBe(false);
  });
});
