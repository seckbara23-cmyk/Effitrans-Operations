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
    const paths = ["/", "/login", "/dashboard", "/clients", "/portal", "/portal/login", "/portal/auth/change-password", "/portal/documents", "/auth/callback", "/portal/auth/callback"];
    const ctxs: RouteContext[] = [NONE, STAFF, PORTAL_TEMP, PORTAL_OK, PORTAL_DISABLED, { identity: "portal", portalStatus: "INVITED" }];
    for (const path of paths) {
      for (const ctx of ctxs) {
        const res = followRedirects(path, ctx, 12);
        expect(res.looped, `LOOP: ${path} [${JSON.stringify(ctx)}] → ${res.chain.join(" → ")}`).toBe(false);
      }
    }
  });
});
