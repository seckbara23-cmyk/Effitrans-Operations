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
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";

// Pure check helpers live in ./check so they are unit-testable without importing
// the server client. Re-exported for existing callers.
export { hasPermission, hasAllPermissions, hasAnyPermission } from "./check";

/**
 * All permission codes effective for the given user (deduped union).
 * P1: request-scoped memoization (React cache) keyed by userId — every gated
 * service call in one render reuses a single get_user_permissions RPC.
 */
export const getEffectivePermissions = cache(async (userId: string): Promise<string[]> => {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_user_permissions", {
    p_user: userId,
  });

  if (error) {
    throw new Error(`[rbac] failed to resolve permissions: ${error.message}`);
  }
  // Typed via Database["public"]["Functions"] — no cast needed.
  return (data ?? []).map((row) => row.code);
});
