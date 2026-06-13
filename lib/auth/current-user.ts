/**
 * Current-user loading + tenant resolution (AUTH-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the authenticated Supabase user -> app_user profile -> tenant ->
 * role codes. All reads go through the RLS-respecting server client, so a user
 * only ever resolves their own profile and their own tenant's data.
 *
 * No business-domain logic. Returns null when unauthenticated. Local casts are
 * used because generated DB types (lib/db/types.ts) do not exist until the
 * project is linked and `npm run db:types` is run.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";

export type CurrentUser = {
  /** app_user.id === auth.users.id */
  id: string;
  /** organization.id this user belongs to */
  tenantId: string;
  email: string;
  isSystemAdmin: boolean;
  /** role codes held by the user (union resolution for permissions elsewhere) */
  roles: string[];
};

type AppUserRow = {
  id: string;
  tenant_id: string;
  email: string;
  is_system_admin: boolean;
};

type UserRoleRow = { role: { code: string } | null };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileData } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, is_system_admin")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as AppUserRow | null;
  if (!profile) return null;

  const { data: roleData } = await supabase
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", user.id);

  const roleRows = (roleData ?? []) as unknown as UserRoleRow[];
  const roles = roleRows
    .map((r) => r.role?.code)
    .filter((c): c is string => Boolean(c));

  return {
    id: profile.id,
    tenantId: profile.tenant_id,
    email: profile.email,
    isSystemAdmin: profile.is_system_admin,
    roles,
  };
}
