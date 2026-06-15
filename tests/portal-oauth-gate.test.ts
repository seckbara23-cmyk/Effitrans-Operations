import { describe, it, expect } from "vitest";
import { evaluatePortalOAuth, isResettablePortal } from "@/lib/portal/oauth-gate";

const verified = { emailVerified: true };

describe("portal OAuth gate (1.16)", () => {
  it("allows an ACTIVE portal user whose email matches (no activation)", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "ACTIVE" }, authEmail: "c@client.sn", ...verified }),
    ).toEqual({ ok: true, activate: false });
  });

  it("allows an INVITED portal user and flags activation (first Google login)", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "INVITED" }, authEmail: "C@Client.SN", ...verified }),
    ).toEqual({ ok: true, activate: true });
  });

  it("rejects a DISABLED portal user", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "DISABLED" }, authEmail: "c@client.sn", ...verified }),
    ).toEqual({ ok: false, reason: "disabled" });
  });

  it("rejects an unknown id / staff-at-portal-gate (no client_user)", () => {
    expect(
      evaluatePortalOAuth({ profile: null, authEmail: "staff@effitrans.sn", ...verified }),
    ).toEqual({ ok: false, reason: "not_portal" });
  });

  it("rejects an email mismatch (no impersonation)", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "ACTIVE" }, authEmail: "evil@gmail.com", ...verified }),
    ).toEqual({ ok: false, reason: "email_mismatch" });
  });

  it("rejects an unverified email", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "ACTIVE" }, authEmail: "c@client.sn", emailVerified: false }),
    ).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("rejects a missing email", () => {
    expect(
      evaluatePortalOAuth({ profile: { email: "c@client.sn", status: "ACTIVE" }, authEmail: null, ...verified }),
    ).toEqual({ ok: false, reason: "no_email" });
  });

  it("reset eligibility: anything but DISABLED", () => {
    expect(isResettablePortal({ email: "c@client.sn", status: "ACTIVE" })).toBe(true);
    expect(isResettablePortal({ email: "c@client.sn", status: "INVITED" })).toBe(true);
    expect(isResettablePortal({ email: "c@client.sn", status: "DISABLED" })).toBe(false);
    expect(isResettablePortal(null)).toBe(false);
  });
});
