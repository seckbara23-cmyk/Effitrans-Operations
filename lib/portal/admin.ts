/**
 * Portal user administration reads (Phase 1.12A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Staff-side: list the portal users of a client, gated by portal:manage +
 * tenant scope. Service-role admin client (privileged staff read).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import type { PortalRole, PortalUserStatus } from "./access";
import type { PortalUserAdmin } from "./types";

export async function listClientPortalUsers(clientId: string): Promise<PortalUserAdmin[]> {
  const user = await assertPermission("portal:manage");
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("client_user")
    .select("id, email, name, status, role, invited_at, last_login_at")
    .eq("tenant_id", user.tenantId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[portal] list users failed: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status as PortalUserStatus,
    role: u.role as PortalRole,
    invitedAt: u.invited_at,
    lastLoginAt: u.last_login_at,
  }));
}
