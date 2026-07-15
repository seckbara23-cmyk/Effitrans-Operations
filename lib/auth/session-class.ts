/**
 * Session identity classification (Phase 3.2B hotfix) — PURE core. No I/O.
 * ---------------------------------------------------------------------------
 * The SAME Supabase Auth project backs two identity classes: staff (app_user)
 * and portal clients (client_user). A given auth.users id is in EXACTLY ONE, or
 * neither ("none" — an orphan/transient OAuth state). Routing must treat these
 * separately so a portal session is never handled as a (broken) staff session.
 *
 * The DB reads live in the server resolver (lib/auth/current-user.getSessionClass)
 * and inline in the edge middleware; this pure classifier is shared so the rule
 * is one tested source of truth, importable from edge/client/test without I/O.
 */
import { isDriverOnly } from "./staff-identity";

export type SessionClass = "none" | "staff" | "portal";

/** Staff wins over portal (a dual identity should never happen; staff is safer). */
export function classifySession(hasAppUser: boolean, hasClientUser: boolean): SessionClass {
  if (hasAppUser) return "staff";
  if (hasClientUser) return "portal";
  return "none";
}

/**
 * Post-login landing path (Phase 3.4C; platform in 4.0B) — PURE. Portal →
 * /portal; a DRIVER-ONLY staff user → their mobile workspace; other staff →
 * /dashboard; a user who is ONLY a platform admin (no tenant identity) → /platform. A
 * user who is BOTH staff and a platform admin lands on their tenant home (staff wins)
 * and navigates to /platform explicitly. Shared by loginDestination + the OAuth callback
 * so the redirect rule is one tested source of truth.
 *
 * Phase 5.0E fix: the driver branch keys on isDriverOnly, NOT roles.includes("DRIVER").
 * A SYSTEM_ADMIN who also holds the DRIVER role is staff → /dashboard, never /driver.
 * Merely holding the driver role no longer overrides the admin workspace.
 */
export function postLoginPath(cls: SessionClass, roles: string[], isPlatformAdmin = false): string {
  if (cls === "portal") return "/portal";
  if (cls === "staff" && isDriverOnly(roles)) return "/driver";
  if (cls === "staff") return "/dashboard";
  if (isPlatformAdmin) return "/platform";
  return "/dashboard";
}
