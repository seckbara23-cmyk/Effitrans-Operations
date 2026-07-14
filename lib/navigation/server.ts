/**
 * Navigation context resolution (Phase 5.0E-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONLY place that turns a request into a NavigationContext. Everything
 * downstream (the sidebar, the landing route) is pure and testable.
 *
 * Cost: getCurrentUser and getEffectivePermissions are both React-cached per
 * request, and every protected page already calls them, so resolving the context
 * in the root layout adds no query on a page a user can actually see.
 *
 * We deliberately do NOT probe for a platform identity here. The tenant shell is
 * never rendered for /platform (it has its own layout), and the invariant that
 * matters — a tenant admin is never offered /platform — is enforced by the builder
 * simply never emitting such an item. Probing would cost every tenant request a
 * query to answer a question the router has already answered.
 */
import "server-only";
import { getCurrentUser, getSessionClass } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { buildNavigation, legacyNavigation } from "./build";
import { resolveLandingRoute } from "./landing";
import type { Navigation, NavigationContext } from "./types";

const ANONYMOUS: Navigation = {
  sections: [],
  primaryRoleLabel: null,
  myWorkHref: null,
  filtered: true,
};

/** Resolve the current request into a navigation context, or null if signed out. */
export async function getNavigationContext(): Promise<NavigationContext | null> {
  const user = await getCurrentUser();

  if (!user) {
    // A portal client has a valid session but no app_user. They are not staff and
    // must never be handed a staff sidebar.
    const cls = await getSessionClass();
    if (cls === "portal") {
      return {
        userId: "",
        tenantId: "",
        roleCodes: [],
        permissions: [],
        identityType: "portal",
        featureFlags: getProcessFlags(),
      };
    }
    return null;
  }

  const permissions = await getEffectivePermissions(user.id);

  return {
    userId: user.id,
    tenantId: user.tenantId,
    roleCodes: user.roles,
    permissions,
    // DRIVER is a mobile-only identity (3.4C); requireUser already keeps them out
    // of staff pages, and the builder gives them no staff sidebar either.
    identityType: user.roles.includes("DRIVER") ? "driver" : "tenant",
    featureFlags: getProcessFlags(),
  };
}

/**
 * The sidebar for the current request.
 *
 * FLAG FIRST, exactly as Phase 5.0C did: with the workspaces flag off we return the
 * legacy sections without resolving a session at all. That is not an optimization —
 * it is what keeps a flag-off deployment identical to today's production, and it is
 * what allows /login and /_not-found to stay statically prerendered (a layout that
 * reads cookies forces every route under it to render dynamically).
 */
export async function getNavigation(): Promise<Navigation> {
  if (!getProcessFlags().workspaces) return legacyNavigation();

  const ctx = await getNavigationContext();
  if (!ctx) return ANONYMOUS;
  return buildNavigation(ctx);
}

/** Where the current user should land. Used by `/` and by post-login. */
export async function getLandingRoute(): Promise<string | null> {
  const ctx = await getNavigationContext();
  if (!ctx) return null;
  return resolveLandingRoute(ctx);
}
