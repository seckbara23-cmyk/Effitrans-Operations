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
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { messagingGlobalKillSwitch, getTenantMessagingEnabled } from "@/lib/messaging/rollout";
import { buildNavigation, legacyNavigation } from "./build";
import { resolveLandingRoute } from "./landing";
import { narrowStaffIdentity } from "@/lib/auth/staff-identity";
import { FLAGS_ALL_OFF } from "@/lib/process/rollout";
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
        featureFlags: FLAGS_ALL_OFF,
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
    // A DRIVER-ONLY or COURIER-ONLY user is a narrow mobile identity (3.4C / 5.0E-3):
    // their whole job is one surface, and the staff shell for them is empty sections.
    // Someone holding DRIVER/COURIER *and* an operational role stays staff — the 5.0E fix
    // keys on isDriverOnly, not mere membership, so a SYSTEM_ADMIN who also drives gets
    // the full staff navigation, never the driver shell.
    identityType: narrowStaffIdentity(user.roles) ?? "tenant",
    // THE TENANT'S effective flags (5.0E-2A) — not the deployment's. This is what
    // makes navigation and the route guards agree: both resolve through the same
    // function, so a tenant can never see a link to a route that would 404 them.
    featureFlags: await getTenantProcessFlags(user.tenantId),
    // Phase 8.7 — independent of featureFlags; only queried when the messaging
    // kill switch is even on (see getNavigation's short-circuit below).
    messagingEnabled: messagingGlobalKillSwitch() ? await getTenantMessagingEnabled(user.tenantId) : false,
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
  // The GLOBAL kill switches, checked before any session is resolved. This is not an
  // optimization: a root layout that reads cookies forces every route beneath it to
  // render dynamically, which broke the static prerender of /login and /_not-found in
  // 5.0E-1. The per-TENANT gate is applied afterwards, inside buildNavigation, from
  // the flags on the context. Messaging (Phase 8.7) is a SECOND, independent kill
  // switch checked the same cheap way — only when an operator turns it on globally
  // does a request pay for session resolution to learn the per-tenant answer.
  if (!globalKillSwitch().workspaces && !messagingGlobalKillSwitch()) return legacyNavigation();

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
