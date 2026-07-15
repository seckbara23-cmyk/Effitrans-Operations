/**
 * Phase 6.0D — the tenant operations (lifecycle) engine.
 *
 * The enforcement DECISION is the pure predicate tenantBlockReason(); it is tested
 * exhaustively here. The enforcement WIRING (getCurrentUser returns null when blocked;
 * middleware and requireUser route without looping; the actions gate/validate/audit) is
 * asserted structurally against source — the codebase's split, no jsdom, no live DB in
 * node.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  tenantBlockReason,
  isTenantAccessAllowed,
  isTenantOperable,
  canTransition,
  LIFECYCLE_TRANSITIONS,
  LIFECYCLE_STATUSES,
  type LifecycleStatus,
} from "@/lib/platform/company-metadata";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const currentUser = read("../lib/auth/current-user.ts");
const requireUser = read("../lib/auth/require-user.ts");
const middleware = read("../lib/supabase/middleware.ts");
const actions = read("../lib/platform/lifecycle-actions.ts");
const rolloutActions = read("../lib/platform/rollout-actions.ts");
const detail = read("../app/platform/companies/[id]/page.tsx");
const lifecycleUi = read("../components/platform/lifecycle-actions.tsx");
const loginPage = read("../app/(auth)/login/page.tsx");

const NOW = Date.parse("2026-07-15T00:00:00Z");
const day = 86_400_000;

// ------------------------------------------------ the enforcement predicate ----

describe("tenantBlockReason — the single enforcement decision", () => {
  it("allows ACTIVE and TRIAL (in-window)", () => {
    expect(tenantBlockReason("ACTIVE", null, NOW)).toBeNull();
    expect(tenantBlockReason("TRIAL", new Date(NOW + 5 * day).toISOString(), NOW)).toBeNull();
    expect(isTenantAccessAllowed("ACTIVE", null, NOW)).toBe(true);
  });

  it("blocks SUSPENDED and ARCHIVED", () => {
    expect(tenantBlockReason("SUSPENDED", null, NOW)).toBe("SUSPENDED");
    expect(tenantBlockReason("ARCHIVED", null, NOW)).toBe("ARCHIVED");
    expect(isTenantAccessAllowed("SUSPENDED", null, NOW)).toBe(false);
    expect(isTenantAccessAllowed("ARCHIVED", null, NOW)).toBe(false);
  });

  it("blocks a TRIAL whose window has ended — derived, no cron", () => {
    expect(tenantBlockReason("TRIAL", new Date(NOW - day).toISOString(), NOW)).toBe("TRIAL_EXPIRED");
    // ...but not one still within its window, and not one without an end date.
    expect(tenantBlockReason("TRIAL", new Date(NOW + day).toISOString(), NOW)).toBeNull();
    expect(tenantBlockReason("TRIAL", null, NOW)).toBeNull();
  });

  it("agrees with isTenantOperable for the explicit statuses", () => {
    for (const s of LIFECYCLE_STATUSES) {
      // Access (ignoring trial expiry) matches operability for a null trial date.
      expect(isTenantAccessAllowed(s, null, NOW)).toBe(isTenantOperable(s));
    }
  });
});

// ------------------------------------------------ the transition state machine ----

describe("the lifecycle state machine", () => {
  it("suspend: from ACTIVE/TRIAL only", () => {
    expect(canTransition("suspend", "ACTIVE")).toBe(true);
    expect(canTransition("suspend", "TRIAL")).toBe(true);
    expect(canTransition("suspend", "SUSPENDED")).toBe(false);
    expect(canTransition("suspend", "ARCHIVED")).toBe(false);
    expect(LIFECYCLE_TRANSITIONS.suspend.to).toBe("SUSPENDED");
  });

  it("reactivate: from SUSPENDED only, to ACTIVE", () => {
    expect(canTransition("reactivate", "SUSPENDED")).toBe(true);
    for (const s of ["ACTIVE", "TRIAL", "ARCHIVED"] as LifecycleStatus[]) {
      expect(canTransition("reactivate", s)).toBe(false);
    }
    expect(LIFECYCLE_TRANSITIONS.reactivate.to).toBe("ACTIVE");
  });

  it("archive: from ACTIVE/TRIAL/SUSPENDED, and ARCHIVED is terminal", () => {
    for (const s of ["ACTIVE", "TRIAL", "SUSPENDED"] as LifecycleStatus[]) {
      expect(canTransition("archive", s)).toBe(true);
    }
    expect(canTransition("archive", "ARCHIVED")).toBe(false);
    // Nothing transitions OUT of ARCHIVED.
    for (const a of ["suspend", "reactivate", "archive"] as const) {
      expect(canTransition(a, "ARCHIVED")).toBe(false);
    }
  });
});

// ------------------------------------------------ enforcement wiring ----

describe("getCurrentUser is the single enforcement point", () => {
  it("reads the tenant lifecycle in the same query as the profile (no extra query)", () => {
    expect(currentUser).toContain("organization:tenant_id(lifecycle_status, trial_ends_at)");
  });

  it("returns null when the tenant is blocked — the one line that denies the whole tenant", () => {
    expect(currentUser).toContain("tenantBlockReason(");
    // The block sits with the existing status check and returns null.
    expect(currentUser).toContain('if (tenantBlockReason(org.lifecycle_status, org.trial_ends_at, Date.now()) !== null) {');
    expect(currentUser).toContain("SINGLE LIFECYCLE ENFORCEMENT POINT");
  });

  it("does not scatter the check — it is the ONLY tenantBlockReason call in the app path", () => {
    // getCurrentUser + getStaffTenantBlockReason (for routing) both live in this one
    // file; no page/action/service re-implements the decision.
    const enginePaths = [
      "../lib/process/engine/actions.ts",
      "../lib/process/queues/service.ts",
      "../app/dashboard/page.tsx",
    ];
    for (const p of enginePaths) {
      expect(read(p), p).not.toContain("tenantBlockReason");
    }
  });
});

describe("routing is loop-safe for a blocked tenant", () => {
  it("requireUser sends a blocked staff user to /login WITH the reason", () => {
    expect(requireUser).toContain("getStaffTenantBlockReason()");
    expect(requireUser).toContain("redirect(`/login?tenant=${blocked.toLowerCase()}`)");
  });

  it("middleware does NOT bounce a blocked staff user back to /dashboard", () => {
    expect(middleware).toContain("isStaffTenantBlocked");
    expect(middleware).toContain('dest = staffBlocked ? null : "/dashboard"');
    // It reads the lifecycle in the same staff lookup it already does.
    expect(middleware).toContain("organization:tenant_id(lifecycle_status, trial_ends_at)");
  });

  it("the login page explains a blocked tenant, generically", () => {
    expect(loginPage).toContain('params.get("tenant")');
    expect(loginPage).toContain("suspendu");
    expect(loginPage).toContain("archivé");
  });
});

// ------------------------------------------------ the actions ----

describe("lifecycle actions: gated, validated, audited, non-destructive", () => {
  it("every action requires platform:status:update", () => {
    expect(actions).toContain('assertPlatformPermission("platform:status:update")');
    expect(actions).toContain('return { ok: false, error: "unauthorized" }');
    // A tenant SYSTEM_ADMIN has no platform identity, so this refuses them by
    // construction — they can never suspend/reactivate themselves.
  });

  it("exposes exactly suspend / reactivate / archive", () => {
    expect(actions).toContain("export async function suspendTenant");
    expect(actions).toContain("export async function reactivateTenant");
    expect(actions).toContain("export async function archiveTenant");
  });

  it("validates the transition before writing — no arbitrary status set", () => {
    expect(actions).toContain("canTransition(action, from)");
    expect(actions).toContain('return { ok: false, error: "invalid_transition" }');
  });

  it("uses compare-and-set so two admins cannot double-apply", () => {
    expect(actions).toContain('.eq("lifecycle_status", from)');
  });

  it("audits every change with actor, before and after, reusing the existing action", () => {
    expect(AuditActions.PLATFORM_TENANT_STATUS_CHANGED).toBe("platform.tenant.status_changed");
    expect(actions).toContain("AuditActions.PLATFORM_TENANT_STATUS_CHANGED");
    expect(actions).toContain("platformActorId: actor.id");
    expect(actions).toContain("before: { lifecycleStatus: from }");
    // The after payload became multi-line in 6.0E-4 (it now also carries the revocation
    // summary) — match across the newline.
    expect(actions).toMatch(/after: \{\s*lifecycleStatus: to/);
  });

  it("DELETES NOTHING — status column only, no soft-delete architecture", () => {
    const actionsCode = code("../lib/platform/lifecycle-actions.ts"); // strip the doc prose
    expect(actionsCode).not.toContain(".delete(");
    expect(actionsCode).not.toMatch(/deleted_at|is_deleted/i);
  });

  it("keeps the suspension reason OUT of the tenant-readable org row (audit only)", () => {
    // The reason is written into the audit payload, never onto organization (which the
    // tenant can read via organization_select_own).
    const updateBlock = actions.slice(actions.indexOf('.from("organization")\n    .update'), actions.indexOf("writeAudit"));
    expect(updateBlock).not.toContain("reason");
  });
});

describe("rollout is denied for a non-operable tenant", () => {
  it("setTenantRollout refuses when the tenant is suspended/archived", () => {
    expect(rolloutActions).toContain("isTenantOperable(org.lifecycle_status)");
    expect(rolloutActions).toContain('return { ok: false, error: "tenant_not_operable" }');
  });
});

// ------------------------------------------------ the console UI ----

describe("the detail console surfaces valid actions only, with a real dialog", () => {
  it("renders LifecycleActions, gated by a real lifecycle status", () => {
    expect(detail).toContain("LifecycleActions");
    expect(detail).toContain("isLifecycleStatus(c.lifecycleStatus)");
  });

  it("shows only transitions valid from the current status", () => {
    expect(lifecycleUi).toContain("canTransition(a, status)");
    expect(lifecycleUi).toContain("if (available.length === 0) return null;");
  });

  it("confirms via a dialog that states access/data/reversibility — never a browser alert", () => {
    expect(lifecycleUi).toContain('role="dialog"');
    expect(lifecycleUi).not.toMatch(/\balert\(/);
    expect(lifecycleUi).not.toContain("window.confirm");
    expect(lifecycleUi).toContain("IRRÉVERSIBLE"); // archive is spelled out as terminal
    expect(lifecycleUi).toContain("Les données sont conservées"); // suspend states data remains
    // Archive states the ENFORCED contract accurately: it blocks tenant access, it is NOT
    // a tenant-side "read-only" mode (5.0E validation). The data is readable only by
    // platform admins.
    expect(lifecycleUi).toContain("L'accès au tenant est définitivement désactivé");
    expect(lifecycleUi).not.toContain("Le tenant devient définitivement en lecture seule");
  });

  it("holds no authority and no service-role credential", () => {
    for (const forbidden of ["assertPlatformPermission", "getAdminSupabaseClient", "service_role", ".from("]) {
      expect(code("../components/platform/lifecycle-actions.tsx"), forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------- every protected entry point obeys the point ----

describe("narrow portals and API routes resolve through the single enforcement point", () => {
  const driverAuth = read("../lib/driver/auth.ts");
  const courierPage = read("../app/courier/page.tsx");
  const requirePermission = read("../lib/auth/require-permission.ts");

  it("the driver portal guard resolves via getCurrentUser — a suspended tenant's driver is denied", () => {
    // requireDriver → getCurrentUser (null when the tenant is blocked) → redirect to
    // /login, never the /driver surface. It never re-reads the lifecycle itself.
    expect(driverAuth).toContain("getCurrentUser()");
    expect(code("../lib/driver/auth.ts")).toContain("if (!user)");
    expect(driverAuth).not.toContain("tenantBlockReason"); // no scattered second check
  });

  it("the courier workspace resolves via requireUser → getCurrentUser", () => {
    expect(courierPage).toContain("requireUser()");
  });

  it("every gated server action resolves via getCurrentUser (assertPermission)", () => {
    expect(requirePermission).toContain("getCurrentUser()");
    expect(requirePermission).toContain("if (!user) throw");
  });

  it("the authenticated API routes resolve via getCurrentUser", () => {
    for (const p of [
      "../app/api/driver/positions/route.ts",
      "../app/api/reports/export/route.ts",
      "../app/api/copilot/route.ts",
      "../app/api/ai/health/route.ts",
    ]) {
      expect(read(p), p).toContain("getCurrentUser");
    }
  });
});

describe("lifecycle enforcement precedes narrow-identity routing (identity-regression compat)", () => {
  it("requireUser redirects a BLOCKED user before it can ever route a driver to /driver", () => {
    // A suspended SYSTEM_ADMIN+DRIVER: getCurrentUser → null → the !user block redirects
    // (to /login with the reason). The isDriverOnly redirect sits AFTER that block, so it
    // is unreachable for a blocked user — lifecycle wins over /driver, structurally.
    const src = code("../lib/auth/require-user.ts");
    const nullGuard = src.indexOf("if (!user)");
    const driverRedirect = src.indexOf("isDriverOnly(user.roles)");
    expect(nullGuard).toBeGreaterThanOrEqual(0);
    expect(driverRedirect).toBeGreaterThan(nullGuard);
  });

  it("lifecycle code never reintroduces raw driver/courier membership routing", () => {
    // The enforcement path keys on tenant STATUS, never on roles, so it cannot regress the
    // identity fix. Neither lifecycle source mentions DRIVER/COURIER membership at all.
    for (const p of ["../lib/platform/lifecycle-actions.ts", "../lib/platform/company-metadata.ts"]) {
      const src = read(p);
      expect(src, p).not.toContain('roles.includes("DRIVER")');
      expect(src, p).not.toContain('roles.includes("COURIER")');
    }
  });
});
