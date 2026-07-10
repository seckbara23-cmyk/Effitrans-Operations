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
export type SessionClass = "none" | "staff" | "portal";

/** Staff wins over portal (a dual identity should never happen; staff is safer). */
export function classifySession(hasAppUser: boolean, hasClientUser: boolean): SessionClass {
  if (hasAppUser) return "staff";
  if (hasClientUser) return "portal";
  return "none";
}
