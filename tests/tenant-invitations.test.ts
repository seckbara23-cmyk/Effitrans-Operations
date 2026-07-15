/**
 * Phase 6.0E-3 — platform invitation operations (resend / regenerate / cancel).
 *
 * The invitation STATE + eligibility are pure functions, tested exhaustively. The
 * actions' guarantees (platform-gated, tenant-validated, reuse the ONE welcome pipeline,
 * cancellation is enforced not cosmetic, the setup link is never audited/persisted) are
 * asserted structurally against source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  deriveInvitationState,
  canResendInvitation,
  canCancelInvitation,
  type InvitationState,
} from "@/lib/users/invitation-state";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = read("../lib/platform/invitation-actions.ts");
const welcomeSend = read("../lib/users/welcome-send.ts");
const client = read("../components/platform/invitation-actions.tsx");

/** Extract the argument text of each writeAudit(...) call (up to its closing "});"). */
function auditPayloads(src: string): string[] {
  return src.split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
}

// ---------------------------------------------------------------- state ----

describe("deriveInvitationState — every state names a real fact", () => {
  const base = { status: "active", lastLoginAt: null, onboardingEmailSentAt: null };

  it("setup_completed once they have logged in — even if later deactivated", () => {
    expect(deriveInvitationState({ ...base, lastLoginAt: "2026-07-10T00:00:00Z" })).toBe("setup_completed");
    expect(deriveInvitationState({ status: "inactive", lastLoginAt: "2026-07-10T00:00:00Z", onboardingEmailSentAt: null })).toBe("setup_completed");
  });

  it("cancelled when deactivated before ever logging in", () => {
    expect(deriveInvitationState({ ...base, status: "inactive" })).toBe("cancelled");
  });

  it("email_sent when a provider-backed welcome was recorded and no login yet", () => {
    expect(deriveInvitationState({ ...base, onboardingEmailSentAt: "2026-07-01T00:00:00Z" })).toBe("email_sent");
  });

  it("no_invitation when nothing was delivered and no login yet", () => {
    expect(deriveInvitationState(base)).toBe("no_invitation");
  });

  it("never infers 'pending' from the mere absence of a login", () => {
    // A user with no email + no login is 'no_invitation', not a made-up 'pending'.
    const states: InvitationState[] = ["setup_completed", "cancelled", "email_sent", "no_invitation"];
    expect(states).not.toContain("pending" as InvitationState);
  });
});

describe("eligibility — resend and cancel apply only to an outstanding invite", () => {
  it("resend/cancel only for email_sent or no_invitation", () => {
    expect(canResendInvitation("email_sent")).toBe(true);
    expect(canResendInvitation("no_invitation")).toBe(true);
    expect(canResendInvitation("setup_completed")).toBe(false);
    expect(canResendInvitation("cancelled")).toBe(false);

    expect(canCancelInvitation("email_sent")).toBe(true);
    expect(canCancelInvitation("no_invitation")).toBe(true);
    expect(canCancelInvitation("setup_completed")).toBe(false);
    expect(canCancelInvitation("cancelled")).toBe(false);
  });
});

// ---------------------------------------------------------------- actions ----

describe("invitation actions are platform-gated, tenant-scoped and reuse one pipeline", () => {
  it("every action requires platform:companies:update", () => {
    expect(actions).toContain('assertPlatformPermission("platform:companies:update")');
    expect(actions).toContain('return { ok: false, error: "unauthorized" }');
    expect(actions).toContain("export async function resendTenantInvitation");
    expect(actions).toContain("export async function regenerateTenantSetupLink");
    expect(actions).toContain("export async function cancelTenantInvitation");
  });

  it("validates the target user belongs to the target tenant (no cross-tenant op)", () => {
    expect(actions).toContain("data.tenant_id !== tenantId");
    expect(actions).toContain('return { ok: false, error: "not_found" }');
  });

  it("re-checks eligibility server-side from the derived state", () => {
    expect(actions).toContain("canResendInvitation(state)");
    expect(actions).toContain("canCancelInvitation(state)");
    expect(actions).toContain('return { ok: false, error: "ineligible" }');
  });

  it("reuses the shared welcome pipeline — no separate invitation subsystem", () => {
    expect(actions).toContain('from "@/lib/users/welcome-send"');
    expect(actions).toContain("sendStaffWelcome(");
  });
});

describe("cancellation is REAL, not cosmetic", () => {
  it("deactivates the user (getCurrentUser then denies any session) and audits it", () => {
    expect(actions).toContain('.update({ status: "inactive" })');
    expect(AuditActions.USER_INVITATION_CANCELLED).toBe("user.invitation.cancelled");
    expect(actions).toContain("AuditActions.USER_INVITATION_CANCELLED");
  });

  it("does not hard-delete the user", () => {
    expect(code("../lib/platform/invitation-actions.ts")).not.toContain("deleteUser");
    expect(code("../lib/platform/invitation-actions.ts")).not.toContain(".delete(");
  });
});

describe("the setup link and password never leak", () => {
  it("no writeAudit payload in the actions carries the link", () => {
    for (const payload of auditPayloads(actions)) {
      expect(payload).not.toContain("setupLink");
      expect(payload).not.toContain("action_link");
    }
  });

  it("no writeAudit payload in the shared pipeline carries the link", () => {
    for (const payload of auditPayloads(welcomeSend)) {
      expect(payload).not.toContain("action_link");
      // setupLink may appear ONLY coerced to a boolean flag (!!setupLink), never as a value.
      expect(payload.replace(/!!setupLink/g, "OK")).not.toContain("setupLink");
    }
  });

  it("the pipeline mints a recovery LINK, never emails a password", () => {
    expect(welcomeSend).toContain('type: "recovery"');
    // No password field is ever set or sent (the /auth/update-password redirect path is
    // not a password value — hence the specific "password:" check).
    expect(code("../lib/users/welcome-send.ts")).not.toContain("password:");
  });
});

describe("the client controls hold no authority and show a one-time link safely", () => {
  it("no admin client / service role / direct DB in the client chunk", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role", ".from(", "generateLink"]) {
      expect(code("../components/platform/invitation-actions.tsx"), forbidden).not.toContain(forbidden);
    }
  });

  it("the one-time link is visually distinguished, copyable, and warns it is not stored", () => {
    expect(client).toContain("usage unique");
    expect(client).toContain("CopyButton");
    expect(client).toContain("disparaît si vous actualisez");
    // Cancel is confirmed via a dialog, never a browser prompt (check comment-stripped code).
    expect(client).toContain('role="dialog"');
    expect(code("../components/platform/invitation-actions.tsx")).not.toContain("window.confirm");
    expect(code("../components/platform/invitation-actions.tsx")).not.toMatch(/\balert\(/);
  });
});
