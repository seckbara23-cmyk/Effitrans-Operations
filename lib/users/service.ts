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
import { classifyPresence } from "./presence";
import type { AdminUser, AdminUserRole, AssignableRole, PresenceSummary } from "./types";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  is_system_admin: boolean;
  last_login_at: string | null;
  last_seen_at: string | null;
  last_login_method: string | null;
  login_count: number | null;
  onboarding_email_sent_at: string | null;
};

export async function listUsers(): Promise<AdminUser[]> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();
  const now = new Date();

  const { data: users, error } = await supabase
    .from("app_user")
    .select(
      "id, email, name, status, is_system_admin, last_login_at, last_seen_at, last_login_method, login_count, onboarding_email_sent_at",
    )
    .eq("tenant_id", admin.tenantId)
    .order("email")
    .returns<UserRow[]>();
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
    presence: classifyPresence(
      { lastSeenAt: u.last_seen_at, lastLoginAt: u.last_login_at, loginCount: u.login_count ?? 0 },
      now,
    ),
    lastLoginAt: u.last_login_at,
    lastSeenAt: u.last_seen_at,
    lastLoginMethod: u.last_login_method,
    loginCount: u.login_count ?? 0,
    onboardingEmailSentAt: u.onboarding_email_sent_at,
  }));
}

/** SYSTEM_ADMIN presence summary (gated admin:users:manage). Derived counts only. */
export async function getPresenceSummary(): Promise<PresenceSummary> {
  const admin = await assertPermission("admin:users:manage");
  const supabase = getAdminSupabaseClient();
  const onlineSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sod = dayStart.toISOString();

  const [{ data: staff }, { data: portal }] = await Promise.all([
    supabase
      .from("app_user")
      .select("status, last_seen_at, last_login_at, login_count")
      .eq("tenant_id", admin.tenantId)
      .returns<{ status: string; last_seen_at: string | null; last_login_at: string | null; login_count: number | null }[]>(),
    supabase
      .from("client_user")
      .select("last_seen_at")
      .eq("tenant_id", admin.tenantId)
      .returns<{ last_seen_at: string | null }[]>(),
  ]);

  const staffRows = staff ?? [];
  const active = staffRows.filter((u) => u.status === "active");
  return {
    online: active.filter((u) => u.last_seen_at != null && u.last_seen_at >= onlineSince).length,
    activeToday: active.filter((u) => u.last_seen_at != null && u.last_seen_at >= sod).length,
    neverLoggedIn: active.filter((u) => (u.login_count ?? 0) === 0 && !u.last_login_at).length,
    portalActiveToday: (portal ?? []).filter((u) => u.last_seen_at != null && u.last_seen_at >= sod).length,
  };
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
