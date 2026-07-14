import { describe, it, expect } from "vitest";
import {
  followRedirects,
  nextRoute,
  type RouteContext,
} from "@/lib/auth/route-contract";
import { classifySession } from "@/lib/auth/session-class";

// A portal client with a temporary password: authenticated, ACTIVE, must change.
const PORTAL_TEMP: RouteContext = { identity: "portal", portalStatus: "ACTIVE", mustChangePassword: true };
const PORTAL_OK: RouteContext = { identity: "portal", portalStatus: "ACTIVE", mustChangePassword: false };
const PORTAL_DISABLED: RouteContext = { identity: "portal", portalStatus: "DISABLED" };
const STAFF: RouteContext = { identity: "staff" };
const NONE: RouteContext = { identity: "none" };
// Platform admin capability is orthogonal to tenant identity (Phase 4.0B).
const PLATFORM_ONLY: RouteContext = { identity: "none", isPlatformAdmin: true };
const DUAL_STAFF_PLATFORM: RouteContext = { identity: "staff", isPlatformAdmin: true };

/** Assert the chain from `start` terminates (no loop) within the hop budget. */
function terminal(start: string, ctx: RouteContext): string {
  const res = followRedirects(start, ctx, 12);
  expect(res.looped, `redirect LOOP from ${start}: ${res.chain.join(" → ")}`).toBe(false);
  return res.terminal;
}

describe("session classification", () => {
  it("staff wins, then portal, then none", () => {
    expect(classifySession(true, false)).toBe("staff");
    expect(classifySession(false, true)).toBe("portal");
    expect(classifySession(false, false)).toBe("none");
    expect(classifySession(true, true)).toBe("staff"); // defensive: dual identity → staff
  });
});

describe("redirect contract — no loops, correct destinations", () => {
  // 1. Temporary-password portal login lands on the change-password screen.
  it("temp-password portal user reaching /portal ends at change-password", () => {
    expect(terminal("/portal", PORTAL_TEMP)).toBe("/portal/auth/change-password");
    expect(terminal("/portal/login", PORTAL_TEMP)).toBe("/portal/auth/change-password");
  });

  // 2. The change-password page renders — it never redirects to itself.
  it("change-password page renders (no self-redirect)", () => {
    expect(nextRoute("/portal/auth/change-password", PORTAL_TEMP)).toBeNull();
    expect(terminal("/portal/auth/change-password", PORTAL_TEMP)).toBe("/portal/auth/change-password");
  });

  // 3. A portal user cannot access /dashboard or other staff routes.
  it("portal user is bounced off staff routes to the portal", () => {
    expect(terminal("/dashboard", PORTAL_TEMP)).toBe("/portal/auth/change-password");
    expect(terminal("/clients", PORTAL_OK)).toBe("/portal");
    // never renders a staff route:
    expect(nextRoute("/dashboard", PORTAL_OK)).toBe("/portal");
  });

  // 4. A portal-only user hitting the STAFF /login is routed safely, no loop.
  it("portal user on /login → /portal (never a /login ⇄ /dashboard loop)", () => {
    expect(terminal("/login", PORTAL_OK)).toBe("/portal");
    expect(terminal("/login", PORTAL_TEMP)).toBe("/portal/auth/change-password");
    expect(terminal("/", PORTAL_OK)).toBe("/portal");
  });

  // 5. Unauthenticated /portal request goes to the portal login.
  it("unauthenticated portal route → /portal/login", () => {
    expect(terminal("/portal", NONE)).toBe("/portal/login");
    expect(terminal("/portal/documents", NONE)).toBe("/portal/login");
  });

  // 6. Staff login behaviour is unchanged.
  it("staff routing is unchanged", () => {
    expect(terminal("/login", STAFF)).toBe("/dashboard"); // authenticated staff → dashboard
    expect(nextRoute("/dashboard", STAFF)).toBeNull(); // renders
    expect(terminal("/dashboard", NONE)).toBe("/login"); // unauthenticated staff route → login
    expect(nextRoute("/login", NONE)).toBeNull(); // login form renders
    expect(terminal("/", STAFF)).toBe("/dashboard");
  });

  // 7. After the password change (mustChange=false), /portal loads.
  it("portal loads once the password has been changed", () => {
    expect(nextRoute("/portal", PORTAL_OK)).toBeNull();
    expect(terminal("/portal", PORTAL_OK)).toBe("/portal");
  });

  // 8. A disabled portal user cannot enter the portal (and never loops).
  it("disabled portal user is sent to the portal login and stays there", () => {
    expect(terminal("/portal", PORTAL_DISABLED)).toBe("/portal/login");
    // the /portal/login → /portal enhancement must NOT fire for a disabled user
    expect(nextRoute("/portal/login", PORTAL_DISABLED)).toBeNull();
  });

  // 9. Google-login bypass: cleared flag behaves as a normal active portal user.
  it("google-verified portal user (flag cleared) navigates normally", () => {
    expect(terminal("/portal", PORTAL_OK)).toBe("/portal");
    expect(terminal("/portal/files", PORTAL_OK)).toBe("/portal/files");
  });

  // Cross-cutting: a staff user must not enter the portal, and must not loop.
  it("staff user hitting a portal route lands on the portal login without loop", () => {
    expect(terminal("/portal", STAFF)).toBe("/portal/login");
    expect(nextRoute("/portal/login", STAFF)).toBeNull();
  });

  // Cross-cutting: exhaustive no-loop sweep across identities × representative paths.
  it("no identity × path combination ever loops", () => {
    const paths = ["/", "/login", "/dashboard", "/clients", "/portal", "/portal/login", "/portal/auth/change-password", "/portal/documents", "/auth/callback", "/portal/auth/callback", "/platform", "/platform/companies"];
    const ctxs: RouteContext[] = [NONE, STAFF, PORTAL_TEMP, PORTAL_OK, PORTAL_DISABLED, { identity: "portal", portalStatus: "INVITED" }, PLATFORM_ONLY, DUAL_STAFF_PLATFORM];
    for (const path of paths) {
      for (const ctx of ctxs) {
        const res = followRedirects(path, ctx, 12);
        expect(res.looped, `LOOP: ${path} [${JSON.stringify(ctx)}] → ${res.chain.join(" → ")}`).toBe(false);
      }
    }
  });
});

describe("platform / tenant route isolation (4.0B)", () => {
  it("a tenant admin (staff, not platform) CANNOT access /platform — routed to dashboard", () => {
    expect(nextRoute("/platform", STAFF)).toBe("/dashboard");
    expect(terminal("/platform", STAFF)).toBe("/dashboard");
    expect(terminal("/platform/companies", STAFF)).toBe("/dashboard");
  });

  it("a platform admin renders /platform and its sub-routes", () => {
    expect(nextRoute("/platform", PLATFORM_ONLY)).toBeNull();
    expect(terminal("/platform", PLATFORM_ONLY)).toBe("/platform");
    expect(terminal("/platform/companies", PLATFORM_ONLY)).toBe("/platform/companies");
  });

  it("a pure platform admin lands on /platform from tenant routes and /login (no loop)", () => {
    expect(terminal("/dashboard", PLATFORM_ONLY)).toBe("/platform");
    expect(terminal("/login", PLATFORM_ONLY)).toBe("/platform");
    expect(terminal("/", PLATFORM_ONLY)).toBe("/platform");
  });

  it("a dual staff+platform admin can reach BOTH surfaces", () => {
    expect(nextRoute("/platform", DUAL_STAFF_PLATFORM)).toBeNull(); // platform renders
    expect(nextRoute("/dashboard", DUAL_STAFF_PLATFORM)).toBeNull(); // tenant renders
    expect(terminal("/login", DUAL_STAFF_PLATFORM)).toBe("/dashboard"); // staff home by default
  });

  it("is the exact shape the permanent super-admin bootstrap produces (5.0E-4B)", () => {
    // seckbara23@gmail.com after bootstrap_platform_super_admin.sql: a tenant SYSTEM_ADMIN
    // (identity: "staff") who is ALSO a PLATFORM_SUPER_ADMIN (isPlatformAdmin: true). Two
    // identities on one auth id, and each surface resolves the one it needs with no
    // inheritance — the routing proof of the separation the SQL script preserves.
    const owner = DUAL_STAFF_PLATFORM;

    // Every platform route: reachable, no bounce.
    for (const p of ["/platform", "/platform/rollout", "/platform/companies", "/platform/settings"]) {
      expect(nextRoute(p, owner), p).toBeNull();
    }
    // Every named tenant route: still reachable, unchanged by holding the platform role.
    for (const p of ["/dashboard", "/my-work", "/settings/pilot", "/files"]) {
      expect(nextRoute(p, owner), p).toBeNull();
    }

    // A PURE tenant admin (no platform identity) is bounced OFF the platform — proving the
    // platform access comes from the platform identity, never from SYSTEM_ADMIN.
    expect(nextRoute("/platform", STAFF)).toBe("/dashboard");
    expect(nextRoute("/platform/rollout", STAFF)).toBe("/dashboard");
  });

  it("a portal user cannot access /platform", () => {
    expect(nextRoute("/platform", PORTAL_OK)).toBe("/portal");
  });

  it("an unauthenticated /platform request goes to /login", () => {
    expect(terminal("/platform", NONE)).toBe("/login");
  });
});
