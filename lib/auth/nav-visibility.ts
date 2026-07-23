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

/**
 * Item-level visibility supporting the ANY-OF gate. Mirrors the server filter
 * (build.ts `grant`): `permissionsAnyOf` wins when set (visible if the user
 * holds ANY of them); otherwise falls back to the single `permission`. Still
 * cosmetic — the route re-checks server-side. This is the ONLY filter on the
 * flag-off navigation path, so it must honor `permissionsAnyOf` too.
 */
export function canSeeNavItem(
  item: { permission?: string; permissionsAnyOf?: readonly string[] },
  session: NavSessionLike,
): boolean {
  if (!session.configured || session.loading) return true;
  if (item.permissionsAnyOf) return item.permissionsAnyOf.some((p) => session.permissions.includes(p));
  return canSeeNav(item.permission, session);
}
