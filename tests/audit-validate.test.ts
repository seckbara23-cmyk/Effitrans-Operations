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

  it("allows null actor for 1.15B machine events (webhook / TTL driven)", () => {
    expect(() => validateAuditEvent({ action: "payment.auto_recorded" })).not.toThrow();
    expect(() => validateAuditEvent({ action: "provider.webhook.received" })).not.toThrow();
    expect(isSystemAction("payment_intent.succeeded")).toBe(true);
    expect(isSystemAction("payment_intent.expired")).toBe(true);
    // but staff/portal-initiated intent events still require an actor
    expect(isSystemAction("payment_intent.created")).toBe(false);
    expect(() => validateAuditEvent({ action: "payment_intent.created" })).toThrow(/required/);
  });

  it("allows null actor for a rejected OAuth login, but attributes a successful one (1.16)", () => {
    // A login rejected at the gate has no authenticated actor to attribute.
    expect(() => validateAuditEvent({ action: "auth.login.rejected" })).not.toThrow();
    expect(isSystemAction("auth.login.rejected")).toBe(true);
    // A successful Google login is attributed to the staff actor.
    expect(isSystemAction("auth.login.google")).toBe(false);
    expect(() => validateAuditEvent({ action: "auth.login.google" })).toThrow(/required/);
    expect(() => validateAuditEvent({ action: "auth.login.google", actorId: "u1" })).not.toThrow();
  });

  it("portal OAuth: rejected is a machine event, login/reset are attributed (1.16)", () => {
    expect(() => validateAuditEvent({ action: "portal.login.rejected" })).not.toThrow();
    expect(isSystemAction("portal.login.rejected")).toBe(true);
    expect(isSystemAction("portal.login.google")).toBe(false);
    expect(() => validateAuditEvent({ action: "portal.login.google" })).toThrow(/required/);
    expect(() => validateAuditEvent({ action: "portal.login.google", clientUserId: "cu1" })).not.toThrow();
    expect(() => validateAuditEvent({ action: "portal.password_reset.completed", clientUserId: "cu1" })).not.toThrow();
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
