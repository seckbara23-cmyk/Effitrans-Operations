/**
 * Driver identity guard (Phase 3.4C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * DRIVER is a role on the EXISTING app_user identity (one auth system). These
 * helpers gate the /driver surface: a driver lands on /driver, staff are sent
 * back to /dashboard, portal users to /portal, unauthenticated to /login — no
 * redirect loops (the /driver routes never call the staff requireUser).
 */
import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, getSessionClass, type CurrentUser } from "@/lib/auth/current-user";

export const DRIVER_ROLE = "DRIVER";

export function isDriver(user: { roles: string[] }): boolean {
  return user.roles.includes(DRIVER_ROLE);
}

/** Returns the authenticated DRIVER, or redirects to the correct home surface. */
export async function requireDriver(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const cls = await getSessionClass();
    redirect(cls === "portal" ? "/portal" : "/login");
  }
  if (!isDriver(user)) redirect("/dashboard");
  return user;
}
