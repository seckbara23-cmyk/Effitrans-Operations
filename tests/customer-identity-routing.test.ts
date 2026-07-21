/**
 * Customer-identity routing defect — regression suite.
 *
 * Production bug: a customer representative (adja.gueye@caetano.sn) was created
 * through the INTERNAL /users screen with the 'CLIENT_USER' staff-role-catalog code,
 * instead of through the portal invite flow (lib/portal/admin-actions.ts). That put
 * her in app_user + user_role('CLIENT_USER') — a STAFF identity with zero real
 * permissions — instead of client_user, the portal identity table. classifySession
 * resolves identity from TABLE MEMBERSHIP, so she was classified "staff" and every
 * login/refresh landed her on /dashboard (the internal "Centre d'opérations" shell),
 * never the Customer Portal.
 *
 * Two closed holes, asserted here:
 *   1. PROVISIONING — CLIENT_USER can no longer be assigned to an app_user, from the
 *      UI picker (listAssignableRoles) or the server actions (createUser/assignRole),
 *      and an email already provisioned as a portal customer can no longer also
 *      become staff (the reciprocal of the existing email_is_staff guard).
 *   2. CLASSIFICATION — an app_user row only counts as "staff" for session
 *      classification when it is ACTIVE. A stale/archived app_user record (what the
 *      repair script for the existing account produces) can no longer shadow a real,
 *      active client_user and force staff routing — classifySession(false, true)
 *      already proves "portal" wins once the caller excludes the non-active row
 *      (tests/route-contract.test.ts pins the pure function itself).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { classifySession } from "@/lib/auth/session-class";
import { resolveLandingRoute } from "@/lib/navigation/landing";
import { canAccessPortal } from "@/lib/portal/access";
import { resolveProcessFlags } from "@/lib/process/flags";
import { t } from "@/lib/i18n";

const FLAGS_OFF = resolveProcessFlags({});

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const serviceCode = code("../lib/users/service.ts");
const actionsCode = code("../lib/users/actions.ts");
const currentUserCode = code("../lib/auth/current-user.ts");
const middlewareCode = code("../lib/supabase/middleware.ts");
const appShellCode = code("../components/shell/app-shell.tsx");
const portalShell = read("../components/portal/portal-shell.tsx");
const portalLayout = read("../app/portal/(app)/layout.tsx");
const portalAuth = read("../lib/portal/auth.ts");
const requireUserSrc = read("../lib/auth/require-user.ts");
const rootPage = read("../app/page.tsx");
const portalCallback = read("../app/portal/auth/callback/route.ts");
const portalChangePassword = read("../app/portal/auth/change-password/page.tsx");

// -------------------------------------------------- G: account creation ----

describe("G — account creation can no longer mis-provision a customer as staff", () => {
  it("listAssignableRoles excludes CLIENT_USER from the /users picker", () => {
    expect(serviceCode).toContain("NON_ASSIGNABLE_STAFF_ROLE_CODES");
    expect(serviceCode).toContain('"CLIENT_USER"');
    expect(serviceCode).toMatch(/\.filter\(\(r\)\s*=>\s*!.*NON_ASSIGNABLE_STAFF_ROLE_CODES.*includes\(r\.code\)\)/);
  });

  it("createUser rejects CLIENT_USER even if a caller bypasses the UI filter", () => {
    expect(actionsCode).toContain("isNonAssignableStaffRole(roleCatalog.get(id)!)");
    expect(actionsCode).toContain('return { ok: false, error: "invalid_role" }');
  });

  it("createUser rejects an email that already belongs to a portal customer (reciprocal of email_is_staff)", () => {
    expect(actionsCode).toContain('.from("client_user")');
    expect(actionsCode).toContain('return { ok: false, error: "email_is_portal" }');
    // The reverse guard already existed on the portal side — this proves both directions.
    const portalGuard = code("../lib/portal/admin-actions.ts");
    expect(portalGuard).toContain('return { ok: false, error: "email_is_staff" }');
  });

  it("assignRole rejects CLIENT_USER as a post-creation role grant too", () => {
    const assignBlock = actionsCode.slice(
      actionsCode.indexOf("export async function assignRole"),
      actionsCode.indexOf("export async function revokeRole"),
    );
    expect(assignBlock).toContain("isNonAssignableStaffRole(role.code)");
  });

  it("email_is_portal has a safe French message that leaks no internals", () => {
    const map = t.users.errors as Record<string, string>;
    expect(map.email_is_portal).toBeTruthy();
    expect(map.email_is_portal).not.toMatch(/sql|supabase|gotrue|service_role|null|undefined/i);
  });
});

// -------------------------------------------------- I: identity precedence ----

describe("I — a stale app_user record cannot override real portal membership", () => {
  it("classifySession itself: staff wins ONLY when both are genuinely present (defensive default, unchanged)", () => {
    expect(classifySession(true, false)).toBe("staff");
    expect(classifySession(false, true)).toBe("portal");
    expect(classifySession(true, true)).toBe("staff"); // still the deliberate defensive default
  });

  it("getSessionClass only counts an ACTIVE app_user as staff — an archived/inactive one is not staff", () => {
    // This is what actually fixes the "ambiguous CLIENT label" case: by the time
    // classifySession runs, a non-active app_user row already resolves to
    // hasAppUser=false, so classifySession(false, true) — proven above — applies.
    expect(currentUserCode).toContain('.from("app_user").select("id").eq("id", user.id).eq("status", "active").maybeSingle()');
  });

  it("the middleware's independent /login classification uses the same active-only rule", () => {
    expect(middlewareCode).toMatch(/\.from\("app_user"\)[\s\S]*?\.eq\("status", "active"\)/);
  });
});

// -------------------------------------------------- B/K: redirect coverage ----

describe("B — every authenticated entry point preserves the customer destination", () => {
  it("root '/' (direct load, refresh, and PWA start_url) resolves a portal identity to /portal", () => {
    // Covers: direct login (loginDestination shares postLoginPath with this), refreshing
    // the root page, and the installed PWA's start_url="/" (app/manifest.ts) — all three
    // funnel through getLandingRoute -> resolveLandingRoute.
    expect(resolveLandingRoute({
      userId: "u1", tenantId: "t1", roleCodes: [], permissions: [],
      identityType: "portal",
      featureFlags: FLAGS_OFF,
    })).toBe("/portal");
    expect(rootPage).toContain("getLandingRoute");
  });

  it("the portal OAuth callback lands on /portal, never the staff dashboard", () => {
    expect(portalCallback).toContain('NextResponse.redirect(`${origin}/portal`)');
  });

  it("the forced password-change flow keeps the session and continues to /portal", () => {
    expect(portalChangePassword).toContain('window.location.href = "/portal"');
    // Never signs the user out on the SUCCESS path (only on the invalid-gate path).
    const successBlock = portalChangePassword.slice(portalChangePassword.indexOf("const res = await completePortalPasswordChange"));
    expect(successBlock).not.toContain("signOut");
  });

  it("requirePortalUser / requireUser resolve identity server-side before any render (no employee-shell flash)", () => {
    // Both guards call next/navigation redirect() from a server (or server-invoked) path
    // — the redirect happens before the page/shell renders, not after a client mount.
    expect(portalAuth).toContain('import { redirect } from "next/navigation"');
    expect(portalAuth).toContain('if (!u || u.status !== "ACTIVE") redirect("/portal/login")');
    expect(requireUserSrc).toContain('import { redirect } from "next/navigation"');
    expect(requireUserSrc).toContain('redirect(cls === "portal" ? "/portal" : "/login")');
  });
});

// -------------------------------------------------- E: shell composition ----

describe("E — customer identities render PortalShell only, never the internal shell", () => {
  it("AppShell bails out to bare children for /portal BEFORE any sidebar/topbar render", () => {
    const portalBailIdx = appShellCode.indexOf('pathname.startsWith("/portal")');
    const sidebarRenderIdx = appShellCode.indexOf("<DesktopSidebar"); // JSX usage, not the top-of-file import
    expect(portalBailIdx).toBeGreaterThan(-1);
    expect(sidebarRenderIdx).toBeGreaterThan(-1);
    expect(portalBailIdx).toBeLessThan(sidebarRenderIdx);
  });

  it("the portal layout requires an active client_user and renders PortalShell, not AppShell", () => {
    expect(portalLayout).toContain("requirePortalUser()");
    expect(portalLayout).toContain("<PortalShell");
    expect(portalLayout).not.toContain("AppShell");
  });

  it("PortalShell carries no internal terminology, role labels, or employee search/notifications", () => {
    for (const forbidden of ["Centre d'opérations", "Pilotage", "DesktopSidebar", "MobileSidebar", "Topbar", "primaryRoleLabel"]) {
      expect(portalShell, forbidden).not.toContain(forbidden);
    }
  });

  it("the internal 'Centre d'opérations' / 'Pilotage' labels live ONLY in the staff nav, never reachable from the portal", () => {
    const navSrc = read("../lib/nav.ts");
    expect(navSrc).toContain("Centre d'opérations");
    // The portal has its own, completely separate shell (proven above) that never
    // imports lib/nav.ts at all.
    expect(portalLayout).not.toMatch(/from ["']@\/lib\/nav["']/);
    expect(portalShell).not.toMatch(/from ["']@\/lib\/nav["']/);
  });
});

// -------------------------------------------------- D: revocation ----

describe("D/J — revoked portal access is denied, mirroring existing coverage", () => {
  it("a DISABLED or INVITED client_user cannot access the portal (canAccessPortal)", () => {
    expect(canAccessPortal("DISABLED")).toBe(false);
    expect(canAccessPortal("INVITED")).toBe(false);
    expect(canAccessPortal("ACTIVE")).toBe(true);
  });
});
