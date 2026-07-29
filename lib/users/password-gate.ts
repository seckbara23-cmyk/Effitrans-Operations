import "server-only";

/**
 * The staff password gate — read side. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Answers one question for the staff guard on every authenticated request: may
 * this user reach the application, or must they deal with their password first?
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE QUERY, AND WHY IT FAILS OPEN
 * ===========================================================================
 * The obvious implementation folds `must_change_password` and
 * `temp_password_expires_at` into getCurrentUser's existing app_user select. It
 * would cost nothing extra — and it would be a loaded gun.
 *
 * Migrations here are applied by an operator, separately from the deploy. Between
 * "code shipped" and "migration 71 applied", a select naming those columns
 * FAILS. getCurrentUser would return null for the failed query, every staff user
 * would resolve as signed-out, and the entire tenant would be locked out of the
 * platform by a deploy — with no way in to fix it, since the fix is a migration.
 *
 * So it is its own query, and ANY failure — missing column, dropped connection,
 * malformed value — yields "ok". Fail-open is the correct posture here and it
 * costs nothing in security: this gate does not authenticate anybody. GoTrue
 * already verified the password. What the gate adds is a POLICY (change it now;
 * that temporary one has expired), and a policy that briefly fails to apply is a
 * degraded feature. A policy that locks out an entire company is an outage.
 *
 * Request-memoized, so the guard, the layout and any nested check share one read.
 */
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { evaluatePasswordGate, type PasswordGateState } from "./password-lifecycle";

/**
 * The gate state for one user.
 *
 * The row is fetched by PRIMARY KEY — the authenticated session's own id — which
 * is a tighter scope than a tenant filter: it can only ever resolve the caller's
 * own record, so the service-role client cannot reach across tenants here.
 */
export const getStaffPasswordGate = cache(async (userId: string): Promise<PasswordGateState> => {
  try {
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase
      .from("app_user")
      .select("must_change_password, temp_password_expires_at")
      .eq("id", userId)
      .maybeSingle<{ must_change_password: boolean | null; temp_password_expires_at: string | null }>();
    if (error || !data) return "ok"; // column absent / row unreadable → never block
    return evaluatePasswordGate({
      mustChangePassword: data.must_change_password,
      tempPasswordExpiresAt: data.temp_password_expires_at,
      now: new Date(),
    });
  } catch {
    return "ok";
  }
});

/** Where a gated user must go. Both live under /auth, which is public, so no redirect loop. */
export const STAFF_CHANGE_PASSWORD = "/auth/change-password";
export const STAFF_PASSWORD_EXPIRED = "/auth/password-expired";

export function passwordGateRedirect(state: PasswordGateState): string | null {
  if (state === "must_change") return STAFF_CHANGE_PASSWORD;
  if (state === "temp_expired") return STAFF_PASSWORD_EXPIRED;
  return null;
}
