/**
 * Permission guard for server actions (Task 6a). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the current user and asserts they hold a permission. Throws if not
 * authenticated or not permitted — server actions surface the error and abort.
 * Pages do their own inline check + render a friendly message instead.
 */
import { getCurrentUser, type CurrentUser } from "./current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";

export class PermissionError extends Error {
  constructor(code: string) {
    super(`[auth] permission denied: "${code}" required`);
    this.name = "PermissionError";
  }
}

/** Returns the current user if they hold `code`; otherwise throws. */
export async function assertPermission(code: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError(code);
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, code)) throw new PermissionError(code);
  return user;
}

/**
 * Returns the current user if they hold AT LEAST ONE of `codes`; otherwise throws.
 *
 * Exists for permission SUCCESSION: when a broad permission is split into
 * granular ones, the actions must accept the new code or the retired umbrella
 * for as long as tenants may still be holding only the umbrella. Without it, the
 * migration that adds the granular grants and the deploy that requires them
 * would have to land atomically — and in this project migrations are applied by
 * an operator, separately from the deploy.
 *
 * This is a widening of nothing: every code passed must be a real permission the
 * caller was already entitled to. The thrown error names the FIRST code, which
 * is by convention the one the caller should actually be granted.
 */
export async function assertAnyPermission(codes: readonly string[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new PermissionError(codes[0] ?? "");
  const permissions = await getEffectivePermissions(user.id);
  if (!codes.some((c) => hasPermission(permissions, c))) throw new PermissionError(codes[0] ?? "");
  return user;
}
