/**
 * Role-code lookup for assignment eligibility (Phase WES-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The current user's own roles arrive on `CurrentUser.roles`. Eligibility asks a
 * different question — the roles of the person being assigned TO — and nothing
 * existed for that, so this is the one small reader WES-3 adds.
 *
 * Tenant-scoped explicitly: the admin client bypasses RLS, so an unscoped read
 * would let one tenant's assignment check see another tenant's roles. The leak
 * guard enforces this.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

type Row = { role: { code: string } | null };

/** Role codes held by `userId`, restricted to `tenantId`. Empty on any doubt. */
export async function getUserRoleCodes(
  userId: string,
  tenantId: string,
): Promise<string[]> {
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .returns<Row[]>();

  return (data ?? [])
    .map((r) => r.role?.code)
    .filter((c): c is string => Boolean(c));
}

/** Is the user an active member of this tenant? Assignment requires both. */
export async function isActiveTenantMember(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const supabase = getAdminSupabaseClient();
  const { data } = await supabase
    .from("app_user")
    .select("status")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ status: string }>();
  return data?.status === "active";
}
