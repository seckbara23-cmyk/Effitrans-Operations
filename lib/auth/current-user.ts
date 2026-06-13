/**
 * Current-user resolver — PLACEHOLDER (Wave 2).
 * ---------------------------------------------------------------------------
 * Defines the contract for the authenticated user + tenant + roles that the
 * rest of the app will depend on. The implementation (resolve the Supabase
 * auth session -> app_user row -> tenant -> roles, and set the per-request RLS
 * tenant context) lands in Wave 3 (AUTH-3 / AUTHZ-2 / RLS-1).
 *
 * Returns null for now. No business logic.
 */

export type CurrentUser = {
  /** app_user.id === auth.users.id */
  id: string;
  /** organization.id this user belongs to */
  tenantId: string;
  email: string;
  isSystemAdmin: boolean;
  /** role codes; populated once RBAC is wired (Wave 3) */
  roles: string[];
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Placeholder — wired in Wave 3 (AUTH-3). No session resolution yet.
  return null;
}
