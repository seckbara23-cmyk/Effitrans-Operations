/**
 * Role-driven landing route (Phase 5.0E-1, Deliverable 2). PURE — ONE function.
 * ---------------------------------------------------------------------------
 * Before this, `app/page.tsx` redirected EVERY staff user to /dashboard. For a
 * Coursier — who holds no analytics:read — that was a page with nothing on it.
 * The landing route is a real product decision, so it gets one pure, testable
 * function rather than being scattered across a layout, a page and a middleware.
 *
 * INVARIANT: this function may only ever return a route the caller can actually
 * open. Every branch below is guarded by the SAME condition the route itself
 * enforces (its flag and its permission), so the landing can never bounce a user
 * into a 404 or a redirect loop. `followRedirects` in the route contract asserts
 * this for real.
 *
 * DEVIATION FROM THE BRIEF, stated plainly: the brief routes each specialist to
 * their queue (/queues/…). We route them to /my-work instead, because My Work is a
 * strict superset of a queue — it shows their queue items *plus* the handoffs
 * awaiting their reception, the corrections sent back to them, and the steps they
 * must validate. Landing on the queue would hide the two categories that are most
 * urgent. Only the four roles whose work is NOT dossier-step work get a different
 * landing: Coordinator/Supervisor (oversight), Account Manager (relationship),
 * Collections (aging), Courier (deposit runs).
 */
import type { NavigationContext } from "./types";
import { OVERSIGHT_ROLES } from "@/lib/auth/staff-identity";

export const LANDING_MY_WORK = "/my-work";
export const LANDING_DASHBOARD = "/dashboard";
export const LANDING_FILES = "/files";
export const LANDING_PORTFOLIO = "/portfolio";
export const LANDING_COLLECTIONS = "/collections";
export const LANDING_COURIER = "/courier";
export const LANDING_DRIVER = "/driver";
export const LANDING_PLATFORM = "/platform";
export const LANDING_PORTAL = "/portal";

const OVERSIGHT = [...OVERSIGHT_ROLES];

// The narrow-identity predicates now live in ONE pure, edge-safe source of truth
// (lib/auth/staff-identity) shared with the login redirect, the route guard and the
// navigation resolver — so "who is a driver / courier" cannot drift between them. Re-
// exported here for the existing importers.
export { isCourierOnly, isDriverOnly } from "@/lib/auth/staff-identity";

/** Where this user should land after login, and where "/" sends them. */
export function resolveLandingRoute(ctx: NavigationContext): string {
  // Separate identity surfaces. These never reach the tenant staff shell.
  if (ctx.identityType === "platform") return LANDING_PLATFORM;
  if (ctx.identityType === "portal") return LANDING_PORTAL;
  if (ctx.identityType === "driver") return LANDING_DRIVER;
  if (ctx.identityType === "courier") return LANDING_COURIER;

  const roles = new Set(ctx.roleCodes);
  const can = (p: string) => ctx.permissions.includes(p);
  const { workspaces, collections } = ctx.featureFlags;

  if (workspaces && can("process:read")) {
    // Oversight roles answer "who has the dossier now" — that is the control
    // tower, which already carries the process section (5.0C). Not a new page.
    if (OVERSIGHT.some((r) => roles.has(r))) return LANDING_DASHBOARD;

    // The Account Manager's unit of work is the CLIENT, not the step.
    if (roles.has("ACCOUNT_MANAGER")) return LANDING_PORTFOLIO;

    // Collections works an aging balance, not a step queue.
    if (roles.has("COLLECTIONS_OFFICER") && collections && can("collections:manage")) {
      return LANDING_COLLECTIONS;
    }

    // Every other operational role: the workbench.
    return LANDING_MY_WORK;
  }

  // Workspaces off (today's production). Preserve the legacy landing exactly,
  // except that we no longer send a user to a page they cannot read.
  if (can("analytics:read")) return LANDING_DASHBOARD;
  if (can("file:read")) return LANDING_FILES;
  return LANDING_DASHBOARD;
}
