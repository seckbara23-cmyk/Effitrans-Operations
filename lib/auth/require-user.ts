/**
 * Route protection guard (AUTH-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Opt-in protection for server components / server actions: call requireUser()
 * at the top of a protected route to enforce authentication. Pages do not yet
 * call this (Wave 3 constraint: no business-domain redirects), but the
 * mechanism is ready for when the login UI (AUTH-1 completion) lands.
 */
import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "./current-user";

/** Returns the authenticated user, or redirects to /login if unauthenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
