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
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { touchStaffSeen } from "@/lib/users/presence-track";

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

type UserRoleRow = { role: { code: string } | null };

/**
 * P1: request-scoped memoization. assertPermission/requireUser and every gated
 * service call resolve the current user; React cache() dedupes them to a SINGLE
 * app_user + user_role lookup per request render.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = getServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Typed via the Database generic on the client.
  const { data: profile } = await supabase
    .from("app_user")
    .select("id, tenant_id, email, is_system_admin, status, last_seen_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  // Disabled users must not access protected app areas — treat as no session.
  if (profile.status !== "active") return null;

  // Phase 2.1A — presence heartbeat on authenticated load (throttled, best-effort).
  await touchStaffSeen(profile.id, profile.last_seen_at);

  // Embedded relation result asserted via .returns<T>() (intentional, not a hack).
  const { data: roleData } = await supabase
    .from("user_role")
    .select("role:role_id(code)")
    .eq("user_id", user.id)
    .returns<UserRoleRow[]>();

  const roleRows = roleData ?? [];
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
});
