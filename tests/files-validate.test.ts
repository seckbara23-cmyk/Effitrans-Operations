import { describe, it, expect } from "vitest";
import { validateFile } from "@/lib/files/validate";
import { canTransition, nextStatuses, isFileStatus } from "@/lib/files/status";

const CLIENT = "00000000-0000-0000-0000-000000000abc";

describe("validateFile", () => {
  it("requires a valid type", () => {
    expect(validateFile({ type: "IMP", clientId: CLIENT })).toBeNull();
    // @ts-expect-error invalid type
    expect(validateFile({ type: "XXX", clientId: CLIENT })).toBe("invalid_type");
  });

  it("requires a valid client uuid", () => {
    expect(validateFile({ type: "EXP", clientId: "" })).toBe("client_required");
    expect(validateFile({ type: "EXP", clientId: "not-a-uuid" })).toBe("client_required");
  });

  it("validates transport mode when present", () => {
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { transportMode: "SEA" } })).toBeNull();
    // @ts-expect-error invalid mode
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { transportMode: "BOAT" } })).toBe("invalid_mode");
  });
});

describe("file state machine", () => {
  it("allows only the forward transition", () => {
    expect(canTransition("DRAFT", "OPENED")).toBe(true);
    expect(canTransition("OPENED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "DELIVERED")).toBe(true);
    expect(canTransition("DELIVERED", "CLOSED")).toBe(true);
  });

  it("rejects skips, backward moves, and transitions out of CLOSED", () => {
    expect(canTransition("DRAFT", "IN_PROGRESS")).toBe(false);
    expect(canTransition("OPENED", "DRAFT")).toBe(false);
    expect(canTransition("CLOSED", "DELIVERED")).toBe(false);
    expect(nextStatuses("CLOSED")).toEqual([]);
  });

  it("isFileStatus guards unknown values", () => {
    expect(isFileStatus("OPENED")).toBe(true);
    expect(isFileStatus("ARCHIVED")).toBe(false);
  });
});
