/**
 * Pure nav-visibility rule (UI-2). No imports — unit-testable.
 * ---------------------------------------------------------------------------
 * Extracted from use-session.tsx so the cosmetic filtering rule can be tested
 * without importing the React/client module. COSMETIC ONLY — server/RLS remain
 * authoritative.
 */
export type NavSessionLike = {
  permissions: string[];
  loading: boolean;
  configured: boolean;
};

/**
 * Show a nav item when: no permission is required, the session is still
 * loading, Supabase is unconfigured, or the user holds the permission.
 */
export function canSeeNav(
  required: string | undefined,
  session: NavSessionLike,
): boolean {
  if (!required) return true;
  if (!session.configured || session.loading) return true;
  return session.permissions.includes(required);
}
