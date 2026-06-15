import { describe, it, expect } from "vitest";
import { validateAuditEvent, isSystemAction } from "@/lib/audit/validate";

describe("audit event validation", () => {
  it("requires a non-empty action", () => {
    expect(() => validateAuditEvent({ action: "" })).toThrow(/action is required/);
    expect(() => validateAuditEvent({ action: "   " })).toThrow(/action is required/);
  });

  it("requires an actor (staff or portal) for non-system actions (fail closed)", () => {
    expect(() => validateAuditEvent({ action: "user.role.assigned" })).toThrow(/actorId or clientUserId is required/);
    expect(() =>
      validateAuditEvent({ action: "user.role.assigned", actorId: "u1" }),
    ).not.toThrow();
    // Phase 1.12: a portal (client_user) actor also satisfies attribution.
    expect(() =>
      validateAuditEvent({ action: "portal.login", clientUserId: "cu1" }),
    ).not.toThrow();
  });

  it("allows null actor for system.* actions", () => {
    expect(() => validateAuditEvent({ action: "system.seed" })).not.toThrow();
    expect(isSystemAction("system.seed")).toBe(true);
    expect(isSystemAction("auth.login")).toBe(false);
  });

  it("requires overrideReason when isOverride", () => {
    expect(() =>
      validateAuditEvent({ action: "admin.override.access", actorId: "u1", isOverride: true }),
    ).toThrow(/overrideReason is required/);
    expect(() =>
      validateAuditEvent({
        action: "admin.override.access",
        actorId: "u1",
        isOverride: true,
        overrideReason: "investigation #42",
      }),
    ).not.toThrow();
  });
});
