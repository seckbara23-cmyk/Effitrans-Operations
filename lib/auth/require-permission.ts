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
