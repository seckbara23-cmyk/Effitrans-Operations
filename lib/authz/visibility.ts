/**
 * Read-visibility scoping (Phase 1.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The service-role list/KPI reads bypass RLS, so they must mirror the same
 * scope the DB enforces. This resolves, for a user, whether they read every
 * file/task in the tenant ("all") or only a related subset — via the same
 * `user_readable_file_ids` SQL helper the RLS policies use (single source).
 *
 *   resolveFileScope(user, "file:read:all")  -> file list/KPI scoping
 *   resolveFileScope(user, "task:read:all")  -> readable FILE ids for task scoping
 *
 * The returned id set is the ownership/assignment set (account_manager /
 * coordinator / created_by / has-a-task), identical for both callers; only the
 * tenant-wide gate permission differs.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getEffectivePermissions } from "@/lib/rbac/permissions";

export type FileScope = { all: true } | { all: false; ids: string[] };

export async function resolveFileScope(
  userId: string,
  tenantId: string,
  allPermission: "file:read:all" | "task:read:all",
): Promise<FileScope> {
  const perms = await getEffectivePermissions(userId);
  if (perms.includes(allPermission)) return { all: true };

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.rpc("user_readable_file_ids", {
    p_user: userId,
    p_tenant: tenantId,
  });
  if (error) throw new Error(`[authz] file scope resolution failed: ${error.message}`);
  return { all: false, ids: (data ?? []).map((r) => r.id) };
}
