/**
 * Route protection guard (AUTH-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Opt-in protection for server components / server actions: call requireUser()
 * at the top of a protected route to enforce authentication. Pages do not yet
 * call this (Wave 3 constraint: no business-domain redirects), but the
 * mechanism is ready for when the login UI (AUTH-1 completion) lands.
 */
import { redirect } from "next/navigation";
import { getCurrentUser, getSessionClass, type CurrentUser } from "./current-user";

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
    const cls = await getSessionClass();
    redirect(cls === "portal" ? "/portal" : "/login");
  }
  // Phase 3.4C — DRIVER is a mobile-only identity; keep drivers out of staff pages
  // (their /driver routes use requireDriver, so this never loops).
  if (user.roles.includes("DRIVER")) redirect("/driver");
  return user;
}
