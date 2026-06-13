/**
 * Effective-permission resolution (AUTHZ-2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Effective permissions = the UNION of all permissions across every role a
 * user holds (DEC-B13). Resolved via the `get_user_permissions` SQL function
 * through the RLS-respecting server client.
 *
 * Foundation/admin scopes only — business module permissions arrive with their
 * modules (gated by BLK-RB1). Deny-by-default: anything not granted is denied.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";

type PermissionRow = { code: string };

/** All permission codes effective for the given user (deduped union). */
export async function getEffectivePermissions(userId: string): Promise<string[]> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_user_permissions", {
    p_user: userId,
  });

  if (error) {
    throw new Error(`[rbac] failed to resolve permissions: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as PermissionRow[];
  return rows.map((row) => row.code);
}

/** True if `permissions` contains `code`. Deny-by-default. */
export function hasPermission(permissions: string[], code: string): boolean {
  return permissions.includes(code);
}

/** True if `permissions` contains every `codes` entry. */
export function hasAllPermissions(permissions: string[], codes: string[]): boolean {
  return codes.every((c) => permissions.includes(c));
}

/** True if `permissions` contains at least one `codes` entry. */
export function hasAnyPermission(permissions: string[], codes: string[]): boolean {
  return codes.some((c) => permissions.includes(c));
}
