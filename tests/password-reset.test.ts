import { describe, it, expect } from "vitest";
import { isActiveStaff } from "@/lib/auth/oauth-gate";
import { validateNewPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { validateAuditEvent, isSystemAction } from "@/lib/audit/validate";

/**
 * Phase 1.16B — staff password recovery/reset. The eligibility decision is the
 * pure `isActiveStaff` predicate (the server actions resolve the app_user BY id
 * and feed it here); the new-password rules are `validateNewPassword`. These
 * tests map 1:1 to the requested scenarios.
 */
describe("staff password reset — eligibility (1.16B)", () => {
  it("active staff can request a reset", () => {
    expect(isActiveStaff({ email: "bob@effitrans.sn", status: "active" })).toBe(true);
  });

  it("unknown email → no eligible profile (generic response, no reset)", () => {
    // The id resolves to NO app_user → predicate false; the action still returns
    // a generic success to the UI, so existence is never revealed.
    expect(isActiveStaff(null)).toBe(false);
  });

  it("inactive staff is blocked", () => {
    expect(isActiveStaff({ email: "bob@effitrans.sn", status: "inactive" })).toBe(false);
  });

  it("portal-only user is blocked from the staff reset flow", () => {
    // A portal-only auth id has NO app_user row → resolves to null → blocked.
    expect(isActiveStaff(null)).toBe(false);
  });
});

describe("staff password reset — new-password rules (1.16B)", () => {
  it("rejects a password shorter than the minimum", () => {
    expect(validateNewPassword("short", "short")).toBe("tooShort");
    expect("1234567".length).toBeLessThan(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword("1234567", "1234567")).toBe("tooShort");
  });

  it("rejects a confirm-password mismatch", () => {
    expect(validateNewPassword("longenough1", "longenough2")).toBe("mismatch");
  });

  it("accepts a valid, matching password", () => {
    expect(validateNewPassword("longenough1", "longenough1")).toBeNull();
  });
});

describe("staff password reset — audit events (1.16B)", () => {
  it("requested + completed are attributed (require an actor)", () => {
    expect(() => validateAuditEvent({ action: "auth.password_reset.requested" })).toThrow(/required/);
    expect(() => validateAuditEvent({ action: "auth.password_reset.requested", actorId: "u1" })).not.toThrow();
    expect(() => validateAuditEvent({ action: "auth.password_reset.completed", actorId: "u1" })).not.toThrow();
    // These are NOT machine events — they are always tied to the resolved staff actor.
    expect(isSystemAction("auth.password_reset.requested")).toBe(false);
    expect(isSystemAction("auth.password_reset.completed")).toBe(false);
  });
});
