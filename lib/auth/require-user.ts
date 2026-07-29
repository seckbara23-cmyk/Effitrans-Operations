/**
 * Route protection guard (AUTH-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Opt-in protection for server components / server actions: call requireUser()
 * at the top of a protected route to enforce authentication. Pages do not yet
 * call this (Wave 3 constraint: no business-domain redirects), but the
 * mechanism is ready for when the login UI (AUTH-1 completion) lands.
 */
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  getSessionClass,
  getStaffTenantBlockReason,
  type CurrentUser,
} from "./current-user";
import { isDriverOnly } from "./staff-identity";
import { getStaffPasswordGate, passwordGateRedirect } from "@/lib/users/password-gate";

/**
 * Returns the authenticated STAFF user, or redirects.
 *
 * Phase 3.2B hotfix: a portal client_user has NO app_user, so getCurrentUser is
 * null for them. Redirecting them to /login triggered a loop (middleware then
 * sent the authenticated /login back to /dashboard). A valid PORTAL session is
 * now routed to /portal instead; only a genuinely unauthenticated (or orphan)
 * caller goes to /login.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    // Phase 6.0D — a staff user whose TENANT is suspended/archived/trial-expired
    // resolves to null just like a signed-out user. Route them to /login WITH the
    // reason (so the page explains it and the middleware does not bounce them back to
    // /dashboard — the loop that would otherwise result). This is routing, not a second
    // enforcement point: the deny already happened in getCurrentUser.
    const blocked = await getStaffTenantBlockReason();
    if (blocked) redirect(`/login?tenant=${blocked.toLowerCase()}`);

    const cls = await getSessionClass();
    redirect(cls === "portal" ? "/portal" : "/login");
  }
  // Phase 3.4C — a DRIVER-ONLY user is a mobile-only identity; keep them out of staff
  // pages (their /driver routes use requireDriver, so this never loops).
  //
  // Phase 5.0E fix: gate on isDriverOnly, NOT roles.includes("DRIVER"). A SYSTEM_ADMIN who
  // also holds the driver role is STAFF and must render the staff page, not be bounced to
  // /driver. Membership in DRIVER is not a driver IDENTITY.
  if (isDriverOnly(user.roles)) redirect("/driver");

  // 2026-07-29 — the staff password gate. An administrator who issues a
  // temporary password sets must_change_password in the same operation, so a
  // session that survived the change can reach exactly one screen: the one that
  // changes the password. An expired temporary password reaches a terminal
  // notice instead — it is never exchangeable for a permanent one, because the
  // credential it was authenticated with is dead.
  //
  // Both targets live under /auth, which the middleware treats as public and the
  // route contract renders without redirecting, so neither can loop. The gate
  // itself fails OPEN (see lib/users/password-gate.ts): a policy that cannot be
  // read must never present as a lockout.
  const gate = passwordGateRedirect(await getStaffPasswordGate(user.id));
  if (gate) redirect(gate);

  return user;
}
