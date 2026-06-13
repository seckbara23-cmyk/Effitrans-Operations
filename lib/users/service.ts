/**
 * User directory reads (Task 6a). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Admin-scoped reads of the user directory. Uses the service-role client (a
 * privileged admin read) gated by `admin:users:manage`, so RLS on app_user is
 * left UNCHANGED (the self-only policy still applies to ordinary user-context
 * reads). Tenant-scoped to the caller's organization. Reads are not audited.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import type { AdminUser, AdminUserRole, AssignableRole } from "./types";

export async function listUsers(): Promise<AdminUser[]> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();

  const { data: users, error } = await supabase
    .from("app_user")
    .select("id, email, name, status, is_system_admin")
    .eq("tenant_id", admin.tenantId)
    .order("email");
  if (error) throw new Error(`[users] directory read failed: ${error.message}`);

  const { data: roleRows, error: roleErr } = await supabase
    .from("user_role")
    .select("user_id, role:role_id(id, code, label_fr)")
    .eq("tenant_id", admin.tenantId)
    .returns<{ user_id: string; role: { id: string; code: string; label_fr: string | null } | null }[]>();
  if (roleErr) throw new Error(`[users] role read failed: ${roleErr.message}`);

  const byUser = new Map<string, AdminUserRole[]>();
  for (const r of roleRows ?? []) {
    if (!r.role) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push({ roleId: r.role.id, code: r.role.code, labelFr: r.role.label_fr });
    byUser.set(r.user_id, list);
  }

  return (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status === "inactive" ? "inactive" : "active",
    isSystemAdmin: u.is_system_admin,
    roles: byUser.get(u.id) ?? [],
  }));
}

export async function listAssignableRoles(): Promise<AssignableRole[]> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("role")
    .select("id, code, label_fr")
    .eq("tenant_id", admin.tenantId)
    .order("code");
  if (error) throw new Error(`[users] role list failed: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, code: r.code, labelFr: r.label_fr }));
}
