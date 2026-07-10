/**
 * Redirect contract (Phase 3.2B hotfix) — PURE, unit-testable. No I/O.
 * ---------------------------------------------------------------------------
 * The SINGLE source of truth for how the middleware + page guards route a
 * request, expressed as a pure function so redirect loops can be proven absent
 * with a hop-limited chain follower. It models the SETTLED behaviour of:
 *   - lib/supabase/middleware.ts (session refresh + login redirects)
 *   - app/page.tsx (/ → /dashboard)
 *   - lib/auth/require-user.ts (staff guard)
 *   - app/portal/(app)/layout.tsx + lib/portal/auth.ts (portal guard + forced change)
 *
 * Staff and portal identities are routed SEPARATELY: a portal session is never
 * sent into the staff /login ⇄ /dashboard cycle.
 */
import { classifySession, type SessionClass } from "./session-class";

export type PortalStatus = "ACTIVE" | "INVITED" | "DISABLED" | null;

export type RouteContext = {
  identity: SessionClass; // "none" | "staff" | "portal"
  portalStatus?: PortalStatus; // meaningful only when identity === "portal"
  mustChangePassword?: boolean; // meaningful only for an ACTIVE portal user
};

export const STAFF_LOGIN = "/login";
export const PORTAL_LOGIN = "/portal/login";
export const PORTAL_CHANGE_PASSWORD = "/portal/auth/change-password";
export const DASHBOARD = "/dashboard";
export const PORTAL_HOME = "/portal";

// ---- path classification -----------------------------------------------------
export function isStaffLogin(p: string): boolean {
  return p === STAFF_LOGIN;
}
export function isPortalLogin(p: string): boolean {
  return p === PORTAL_LOGIN;
}
export function isPortalAuth(p: string): boolean {
  return p.startsWith("/portal/auth"); // callback, update-password, change-password
}
export function isStaffAuth(p: string): boolean {
  return p.startsWith("/auth"); // callback, update-password
}
export function isPortalApp(p: string): boolean {
  return (p === "/portal" || p.startsWith("/portal/")) && !isPortalLogin(p) && !isPortalAuth(p);
}
export function isRoot(p: string): boolean {
  return p === "/";
}
/** A protected staff route (anything not root/login/auth/portal). */
export function isStaffApp(p: string): boolean {
  return (
    !isRoot(p) &&
    !isStaffLogin(p) &&
    !isStaffAuth(p) &&
    !isPortalLogin(p) &&
    !isPortalAuth(p) &&
    !isPortalApp(p)
  );
}

/** Paths reachable without authentication (mirror of middleware.isPublicPath). */
export function isPublicPath(p: string): boolean {
  return isStaffLogin(p) || isPortalLogin(p) || isStaffAuth(p) || isPortalAuth(p);
}

// ---- the two redirect layers -------------------------------------------------

/** Edge middleware behaviour (identity-aware only for the authenticated /login case). */
export function middlewareRedirect(path: string, ctx: RouteContext): string | null {
  const authed = ctx.identity !== "none";
  if (!authed && !isPublicPath(path)) {
    return isPortalApp(path) || isPortalLogin(path) ? PORTAL_LOGIN : STAFF_LOGIN;
  }
  if (authed && isStaffLogin(path)) {
    // Route by identity so a portal session is NEVER thrown into the staff loop.
    if (ctx.identity === "staff") return DASHBOARD;
    if (ctx.identity === "portal") return PORTAL_HOME;
    return null; // orphan (no profile) → render the login page, never loop
  }
  return null;
}

/** Page/guard behaviour once the middleware lets the request through. */
export function pageRedirect(path: string, ctx: RouteContext): string | null {
  if (isRoot(path)) return DASHBOARD; // app/page.tsx (unconditional)

  if (isStaffApp(path)) {
    if (ctx.identity === "staff") return null; // render
    if (ctx.identity === "portal") return PORTAL_HOME; // require-user: bounce portal to portal
    return STAFF_LOGIN; // none/orphan
  }

  if (isPortalApp(path)) {
    if (ctx.identity === "portal" && ctx.portalStatus === "ACTIVE") {
      return ctx.mustChangePassword ? PORTAL_CHANGE_PASSWORD : null; // forced change or render
    }
    return PORTAL_LOGIN; // non-active portal / staff / none
  }

  if (isPortalLogin(path)) {
    // An already-signed-in ACTIVE portal user is sent home (the (app) layout then
    // routes to change-password when required). Non-active/staff/none render the form.
    if (ctx.identity === "portal" && ctx.portalStatus === "ACTIVE") return PORTAL_HOME;
    return null;
  }

  // isStaffLogin, isStaffAuth, isPortalAuth (incl. change-password) → render.
  return null;
}

/** Settled next hop for `path` under `ctx`, or null to render `path`. */
export function nextRoute(path: string, ctx: RouteContext): string | null {
  return middlewareRedirect(path, ctx) ?? pageRedirect(path, ctx);
}

export type ChainResult = {
  chain: string[];
  terminal: string; // the path that finally renders
  looped: boolean; // true if the hop budget was exhausted (a loop)
};

/**
 * Follow the redirect chain from `start` under `ctx` until a path renders or the
 * hop budget is exhausted. `looped: true` means a redirect loop — the primary
 * regression guard for this class of bug.
 */
export function followRedirects(start: string, ctx: RouteContext, maxHops = 10): ChainResult {
  const chain: string[] = [start];
  let current = start;
  for (let i = 0; i < maxHops; i++) {
    const next = nextRoute(current, ctx);
    if (next == null) return { chain, terminal: current, looped: false };
    chain.push(next);
    current = next;
  }
  return { chain, terminal: current, looped: true };
}

export { classifySession };
