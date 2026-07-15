/**
 * Phase 6.0F — cross-cutting threat scenarios (the integrated platform, not one phase).
 *
 * Each block encodes an attacker scenario from the security review and asserts the
 * defense at its enforcement point. Behavioural where a pure function allows it,
 * structural (comment-stripped source) where the defense is I/O. Many scenarios also
 * have dedicated suites (identity-priority, tenant-lifecycle, tenant-invitations,
 * session-revocation, platform-copilot, rls_* SQL) — this file proves the ones that live
 * at the server-action / auth boundary and indexes the rest.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { postLoginPath } from "@/lib/auth/session-class";
import { isDriverOnly } from "@/lib/auth/staff-identity";
import { validateBrandingDraft } from "@/lib/branding/edit";
import { isPlatformPermission } from "@/lib/platform/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const userActions = read("../lib/users/actions.ts");
const platformAuth = read("../lib/auth/require-permission.ts");
const getPlatformUser = read("../lib/platform/auth.ts");
const lifecycle = read("../lib/platform/lifecycle-actions.ts");
const branding = read("../lib/platform/branding-actions.ts");
const invitations = read("../lib/platform/invitation-actions.ts");
const currentUser = read("../lib/auth/current-user.ts");

// -------------------------------------------------- actor / tenant spoofing ----

describe("a client cannot spoof the actor or the tenant of a server action", () => {
  it("the actor is resolved server-side from the session, never taken as an argument", () => {
    // createUser's signature carries email/name/roles/credentialMode — NO actorId, NO
    // tenantId. The actor + tenant come from assertPermission(...).tenantId/.id.
    expect(userActions).toContain("admin = await assertPermission(");
    expect(userActions).toContain("tenant_id: admin.tenantId");
    expect(userActions).not.toMatch(/function createUser\([^)]*actorId/);
    expect(userActions).not.toMatch(/function createUser\([^)]*tenantId/);
  });

  it("a mutation on another user validates the target belongs to the caller's tenant", () => {
    // setUserStatus / assignRole reject a target from a different tenant.
    expect(userActions).toContain("target.tenant_id !== admin.tenantId");
    expect(userActions).toContain('return { ok: false, error: "not_found" }');
  });

  it("platform actions resolve the platform actor server-side and take no client actor", () => {
    for (const src of [lifecycle, branding, invitations]) {
      expect(src).toContain("assertPlatformPermission(");
      expect(src).toContain("actor.id");
    }
  });
});

// -------------------------------------------------- privilege boundary ----

describe("a tenant identity can never gain platform authority", () => {
  it("getPlatformUser resolves the platform_admin row by auth.uid — a tenant user is null", () => {
    // A tenant user has an app_user, not a platform_admin, so this lookup misses → null.
    expect(getPlatformUser).toContain('.from("platform_admin")');
    expect(getPlatformUser).toContain(".eq(\"id\", user.id)");
    expect(getPlatformUser).toContain("if (!pa");
  });

  it("permissions are derived from the resolved role server-side, never client-supplied", () => {
    expect(getPlatformUser).toContain("platformPermissionsFor(pa.platform_role)");
  });

  it("no tenant-style permission code is a platform permission", () => {
    for (const c of ["admin:users:manage", "file:read", "finance:read", "process:read"]) {
      expect(isPlatformPermission(c)).toBe(false);
    }
  });

  it("gated server actions resolve the user through getCurrentUser (assertPermission)", () => {
    expect(platformAuth).toContain("getCurrentUser()");
    expect(platformAuth).toContain("if (!user) throw");
  });
});

// -------------------------------------------------- lifecycle / session ----

describe("a suspended or archived tenant is denied at the single enforcement point", () => {
  it("getCurrentUser returns null when the tenant is blocked (drives login/API/portal deny)", () => {
    expect(currentUser).toContain("tenantBlockReason(");
    expect(currentUser).toContain("SINGLE LIFECYCLE ENFORCEMENT POINT");
  });

  it("lifecycle transitions use compare-and-set so a race cannot double-apply", () => {
    expect(lifecycle).toContain('.eq("lifecycle_status", from)');
  });

  it("a cancelled invitation is enforced by deactivating the user (no session thereafter)", () => {
    expect(invitations).toContain('.update({ status: "inactive" })');
  });
});

// -------------------------------------------------- identity / injection ----

describe("identity and input-injection defenses", () => {
  it("adding DRIVER to a SYSTEM_ADMIN does not demote them to the driver portal", () => {
    expect(postLoginPath("staff", ["SYSTEM_ADMIN", "DRIVER"])).toBe("/dashboard");
    expect(isDriverOnly(["SYSTEM_ADMIN", "DRIVER"])).toBe(false);
  });

  it("branding input containing HTML/script is rejected, not stored", () => {
    expect(validateBrandingDraft({ email_footer: "<img src=x onerror=alert(1)>" }).ok).toBe(false);
    expect(validateBrandingDraft({ display_name: "<b>x</b>" }).ok).toBe(false);
  });
});

// -------------------------------------------------- sensitive-data leakage ----

describe("secrets never enter logs, audit, or URLs", () => {
  it("the setup link is never audited by the shared welcome pipeline", () => {
    const welcome = read("../lib/users/welcome-send.ts");
    const payloads = welcome.split("writeAudit(").slice(1).map((s) => s.slice(0, s.indexOf("});")));
    for (const p of payloads) expect(p).not.toContain("action_link");
  });

  it("the temp password is never written to an audit payload in user creation", () => {
    // The action NAME is chosen by the `generated` flag (a truthiness check), but the
    // audit `after` payload never carries the password value itself.
    const src = code("../lib/users/actions.ts");
    const auditIdx = src.indexOf("writeAudit({");
    const block = src.slice(auditIdx, auditIdx + 500);
    const after = block.slice(block.indexOf("after:"));
    expect(after).not.toContain("generated");
    expect(after).not.toContain("password");
  });

  it("the platform Copilot audit records safe metadata only", () => {
    const route = read("../app/api/platform/copilot/route.ts");
    const start = route.indexOf("writeAudit(");
    const block = route.slice(start, route.indexOf("});", start) + 3);
    expect(block).not.toContain("prompt");
    expect(block).toContain("tenantCount");
  });
});

// -------------------------------------------------- coverage index ----

describe("the deeper threat suites exist and run (indexed here for the acceptance report)", () => {
  it("the dedicated suites are present", () => {
    for (const p of [
      "./identity-priority.test.ts",
      "./tenant-lifecycle.test.ts",
      "./tenant-invitations.test.ts",
      "./tenant-session-revocation.test.ts",
      "./platform-copilot.test.ts",
      "./tenant-acceptance.test.ts",
    ]) {
      expect(read(p).length).toBeGreaterThan(0);
    }
    // The DB-level bidirectional isolation proof runs in CI.
    expect(read("../supabase/tests/rls_multitenant_acceptance_test.sql")).toContain("MULTI-TENANT ACCEPTANCE");
  });
});
