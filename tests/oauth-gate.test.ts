import { describe, it, expect } from "vitest";
import { evaluateStaffOAuth, isActiveStaff, normalizeEmail } from "@/lib/auth/oauth-gate";

const verified = { emailVerified: true };

describe("staff OAuth gate (1.16)", () => {
  it("allows an active staff profile whose email matches the verified Google email", () => {
    expect(
      evaluateStaffOAuth({
        profile: { email: "bob@effitrans.sn", status: "active" },
        authEmail: "bob@effitrans.sn",
        ...verified,
      }),
    ).toEqual({ ok: true });
  });

  it("matches case/whitespace-insensitively", () => {
    expect(
      evaluateStaffOAuth({
        profile: { email: "Bob@Effitrans.SN", status: "active" },
        authEmail: "  bob@effitrans.sn ",
        ...verified,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an unknown id (no staff profile) — never auto-creates", () => {
    expect(
      evaluateStaffOAuth({ profile: null, authEmail: "ghost@gmail.com", ...verified }),
    ).toEqual({ ok: false, reason: "not_staff" });
  });

  it("rejects an inactive staff profile", () => {
    expect(
      evaluateStaffOAuth({
        profile: { email: "bob@effitrans.sn", status: "inactive" },
        authEmail: "bob@effitrans.sn",
        ...verified,
      }),
    ).toEqual({ ok: false, reason: "disabled" });
  });

  it("rejects when the verified email does not match the by-id profile (no impersonation)", () => {
    expect(
      evaluateStaffOAuth({
        profile: { email: "bob@effitrans.sn", status: "active" },
        authEmail: "mallory@gmail.com",
        ...verified,
      }),
    ).toEqual({ ok: false, reason: "email_mismatch" });
  });

  it("rejects an unverified Google email even if everything else matches", () => {
    expect(
      evaluateStaffOAuth({
        profile: { email: "bob@effitrans.sn", status: "active" },
        authEmail: "bob@effitrans.sn",
        emailVerified: false,
      }),
    ).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("rejects a missing email", () => {
    expect(
      evaluateStaffOAuth({ profile: { email: "x@y.z", status: "active" }, authEmail: null, ...verified }),
    ).toEqual({ ok: false, reason: "no_email" });
  });

  it("normalizeEmail trims + lowercases + tolerates null", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("staff password-recovery gate (1.16)", () => {
  it("only an active staff profile may request/complete a reset", () => {
    expect(isActiveStaff({ email: "b@e.sn", status: "active" })).toBe(true);
    expect(isActiveStaff({ email: "b@e.sn", status: "inactive" })).toBe(false);
    expect(isActiveStaff(null)).toBe(false);
  });
});
