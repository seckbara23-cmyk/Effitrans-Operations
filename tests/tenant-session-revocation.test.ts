/**
 * Phase 6.0E-4 — immediate session revocation on Suspend / Archive.
 *
 * Revocation is I/O against the Auth admin API, so its guarantees (supported lever only,
 * bounded + tenant-scoped, honest partial-failure, staged after the transition, safe
 * audit, next-request enforcement untouched) are asserted structurally against source —
 * the codebase's no-jsdom / no-live-DB convention.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const revocation = read("../lib/platform/session-revocation.ts");
const revocationCode = code("../lib/platform/session-revocation.ts");
const lifecycle = read("../lib/platform/lifecycle-actions.ts");
const lifecycleCode = code("../lib/platform/lifecycle-actions.ts");
const ui = read("../components/platform/lifecycle-actions.tsx");
const currentUser = read("../lib/auth/current-user.ts");

// ---------------------------------------------------------------- the lever ----

describe("revocation uses the ONLY supported, safe per-user lever", () => {
  it("bans / un-bans via updateUserById(ban_duration) — GoTrue has no delete-sessions-by-id", () => {
    expect(revocation).toContain("updateUserById(id, { ban_duration: banDuration }");
    expect(revocation).toContain('const PERMANENT_BAN = "876000h"');
    expect(revocation).toContain('const UNBAN = "none"');
  });

  it("never deletes a user and never relies on signOut(jwt) (an admin has no user JWT)", () => {
    expect(revocationCode).not.toContain("deleteUser");
    expect(revocationCode).not.toContain("signOut");
  });
});

describe("revocation is bounded and tenant-scoped — cross-tenant is impossible", () => {
  it("selects user ids from app_user scoped by the target tenant, never the global auth list", () => {
    expect(revocation).toContain('.from("app_user")');
    expect(revocation).toContain('.eq("tenant_id", tenantId)');
    // NOT the global auth listing (that would be cross-tenant).
    expect(revocationCode).not.toContain("auth.admin.listUsers");
  });

  it("is paginated and bounded by a hard ceiling", () => {
    expect(revocation).toContain(".range(");
    expect(revocation).toContain("MAX_USERS");
    expect(revocation).toContain("CONCURRENCY"); // bounded fan-out
  });

  it("returns COUNTS only — never a token, session id, or provider error", () => {
    expect(revocation).toContain("targeted");
    expect(revocation).toContain("revoked");
    expect(revocation).toContain("failed");
    for (const forbidden of ["access_token", "refresh_token", "session_id", "properties"]) {
      expect(revocationCode, forbidden).not.toContain(forbidden);
    }
  });

  it("counts a single failure instead of throwing (partial failure is tolerated)", () => {
    expect(revocation).toContain("catch");
    expect(revocation).toContain("failed++");
  });
});

// ---------------------------------------------------------------- the boundary ----

describe("the staged lifecycle boundary: transition, then revoke, then audit", () => {
  it("applies the transition (compare-and-set) BEFORE any revocation", () => {
    const transitionAt = lifecycle.indexOf('.eq("lifecycle_status", from)');
    const revokeAt = lifecycle.indexOf("setTenantAuthBan(admin, tenantId");
    expect(transitionAt).toBeGreaterThanOrEqual(0);
    expect(revokeAt).toBeGreaterThan(transitionAt);
  });

  it("suspend/archive BAN; reactivate UN-BANS", () => {
    expect(lifecycle).toContain('if (action === "suspend" || action === "archive") {');
    expect(lifecycle).toContain("setTenantAuthBan(admin, tenantId, true)");
    expect(lifecycle).toContain('} else if (action === "reactivate") {');
    expect(lifecycle).toContain("setTenantAuthBan(admin, tenantId, false)");
  });

  it("a partial revocation failure does NOT roll back the applied transition", () => {
    // write_failed is returned ONLY for the Stage-1 update error; revocation cannot
    // produce a failure result — the success path returns ok:true with the summary.
    const revokeAt = lifecycleCode.indexOf("setTenantAuthBan(admin, tenantId");
    const afterRevoke = lifecycleCode.slice(revokeAt);
    expect(afterRevoke).not.toContain('error: "write_failed"');
    expect(lifecycle).toContain("return { ok: true, from, to, ...(revocation ? { revocation } : {}) }");
  });

  it("audits the transition WITH a safe revocation summary (counts only)", () => {
    expect(AuditActions.PLATFORM_TENANT_STATUS_CHANGED).toBe("platform.tenant.status_changed");
    expect(lifecycle).toContain("sessionRevocation: revocation");
  });

  it("does NOT weaken the Phase 6.0D next-request enforcement", () => {
    // The lifecycle action never touches getCurrentUser, and getCurrentUser still denies a
    // blocked tenant on every request — revocation is ADDED, not a replacement.
    expect(lifecycleCode).not.toContain("getCurrentUser");
    expect(currentUser).toContain("SINGLE LIFECYCLE ENFORCEMENT POINT");
    expect(currentUser).toContain("tenantBlockReason(");
  });
});

// ---------------------------------------------------------------- the console ----

describe("the console explains sign-out and reports the outcome honestly", () => {
  it("suspend/archive copy states that active sessions are revoked / users signed out", () => {
    expect(ui).toContain("sessions actives sont révoquées");
    expect(ui).toContain("déconnectés");
  });

  it("reactivate copy states old sessions are NOT restored (users re-authenticate)", () => {
    expect(ui).toContain("Les anciennes sessions ne sont pas restaurées");
  });

  it("reports the transition outcome and any partial revocation failure", () => {
    expect(ui).toContain("revocationLine");
    expect(ui).toContain("échec(s)"); // partial-failure path is surfaced
    expect(ui).toContain("Transition appliquée");
    // Duplicate submit is prevented while pending.
    expect(ui).toContain("disabled={pending}");
  });
});
