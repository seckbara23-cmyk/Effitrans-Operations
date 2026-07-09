import { describe, it, expect } from "vitest";
import {
  evaluateHardDelete,
  hasBlockingOperations,
  type DossierOperationCounts,
} from "@/lib/files/delete-policy";
import { validateAssignee } from "@/lib/files/assign-policy";
import { canCancel, nextStatuses, isFileStatus } from "@/lib/files/status";
import { AuditActions } from "@/lib/audit/events";
import { validateAuditEvent } from "@/lib/audit/validate";

const EMPTY: DossierOperationCounts = {
  finance: 0,
  documents: 0,
  customs: 0,
  transport: 0,
  tasks: 0,
};

// ---------------------------------------------------------------- delete policy
describe("dossier delete policy (Phase 3.2A)", () => {
  it("allows hard delete of an empty dossier", () => {
    expect(hasBlockingOperations(EMPTY)).toBe(false);
    expect(evaluateHardDelete(EMPTY)).toEqual({ allowed: true });
  });

  it.each([
    ["finance", { ...EMPTY, finance: 1 }],
    ["documents", { ...EMPTY, documents: 1 }],
    ["customs", { ...EMPTY, customs: 1 }],
    ["transport", { ...EMPTY, transport: 1 }],
    ["tasks", { ...EMPTY, tasks: 1 }],
  ] as const)("blocks hard delete when %s records exist", (_label, counts) => {
    expect(hasBlockingOperations(counts)).toBe(true);
    expect(evaluateHardDelete(counts)).toEqual({ allowed: false, reason: "has_operations" });
  });

  it("blocks when several kinds of operations exist together", () => {
    expect(
      evaluateHardDelete({ finance: 3, documents: 2, customs: 1, transport: 1, tasks: 5 }),
    ).toEqual({ allowed: false, reason: "has_operations" });
  });
});

// ---------------------------------------------------------------- assign policy
describe("dossier assignee validation (Phase 3.2A)", () => {
  it("accepts an active staff member in the same tenant", () => {
    expect(validateAssignee({ found: true, active: true, sameTenant: true })).toEqual({ ok: true });
  });

  it("rejects an inactive staff member", () => {
    expect(validateAssignee({ found: true, active: false, sameTenant: true })).toEqual({
      ok: false,
      error: "invalid_assignee",
    });
  });

  it("rejects a staff member from another tenant", () => {
    expect(validateAssignee({ found: true, active: true, sameTenant: false })).toEqual({
      ok: false,
      error: "invalid_assignee",
    });
  });

  it("rejects an unknown / non-existent candidate", () => {
    expect(validateAssignee({ found: false, active: false, sameTenant: false })).toEqual({
      ok: false,
      error: "invalid_assignee",
    });
  });
});

// ------------------------------------------------------------------ cancel rule
describe("dossier cancel rule (Phase 3.2A)", () => {
  it("recognises CANCELLED as a valid, terminal status", () => {
    expect(isFileStatus("CANCELLED")).toBe(true);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });

  it("never offers CANCELLED as a normal forward transition", () => {
    for (const s of ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED"] as const) {
      expect(nextStatuses(s)).not.toContain("CANCELLED");
    }
  });

  it("allows cancelling a live dossier but not a finalised one", () => {
    expect(canCancel("DRAFT")).toBe(true);
    expect(canCancel("OPENED")).toBe(true);
    expect(canCancel("IN_PROGRESS")).toBe(true);
    expect(canCancel("DELIVERED")).toBe(true);
    expect(canCancel("CLOSED")).toBe(false);
    expect(canCancel("CANCELLED")).toBe(false);
  });
});

// ------------------------------------------------------------------ audit codes
describe("dossier lifecycle audit events (Phase 3.2A)", () => {
  it("exposes the new attributed action codes", () => {
    expect(AuditActions.FILE_CANCELLED).toBe("file.cancelled");
    expect(AuditActions.FILE_DELETED).toBe("file.deleted");
    expect(AuditActions.FILE_ASSIGNED).toBe("file.assigned");
    expect(AuditActions.FILE_UNASSIGNED).toBe("file.unassigned");
  });

  it("requires an actor for every dossier lifecycle event (fail closed)", () => {
    for (const action of [
      AuditActions.FILE_CANCELLED,
      AuditActions.FILE_DELETED,
      AuditActions.FILE_ASSIGNED,
      AuditActions.FILE_UNASSIGNED,
    ]) {
      expect(() => validateAuditEvent({ action })).toThrow();
      expect(() => validateAuditEvent({ action, actorId: "actor-1" })).not.toThrow();
    }
  });
});
