/**
 * User directory reads (Task 6a). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Admin-scoped reads of the user directory. Uses the service-role client (a
 * privileged admin read) gated by `admin:users:read` — or the deprecated
 * `admin:users:manage` umbrella — so RLS on app_user is left UNCHANGED (the
 * self-only policy still applies to ordinary user-context reads). Tenant-scoped
 * to the caller's organization. Reads are not audited.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertAnyPermission } from "@/lib/auth/require-permission";
import { classifyPresence } from "./presence";
import { toStaffStatus } from "./lifecycle";
import { userAdminCodes } from "./permissions";
import { passwordStatus } from "./password-lifecycle";
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

/**
 * The password-lifecycle columns, read SEPARATELY and fail-soft.
 *
 * Migrations in this project are applied by an operator, independently of the
 * deploy. If these three columns were folded into the directory's main select,
 * the window between "code deployed" and "migration 71 applied" would fail the
 * whole query — and the user-administration page, the one place from which an
 * administrator could react, would render empty. So they are fetched on their
 * own and an error yields an empty map: the directory renders in full, and the
 * password column reads « inconnue » until the migration lands.
 */
type PasswordRow = {
  id: string;
  password_changed_at: string | null;
  must_change_password: boolean | null;
  temp_password_expires_at: string | null;
};

async function readPasswordLifecycle(
  supabase: ReturnType<typeof getAdminSupabaseClient>,
  tenantId: string,
): Promise<Map<string, PasswordRow>> {
  try {
    const { data, error } = await supabase
      .from("app_user")
      .select("id, password_changed_at, must_change_password, temp_password_expires_at")
      .eq("tenant_id", tenantId)
      .returns<PasswordRow[]>();
    if (error) return new Map();
    return new Map((data ?? []).map((r) => [r.id, r] as const));
  } catch {
    return new Map();
  }
}

/**
 * Directory read. ARCHIVED users are excluded AT QUERY LEVEL by default (8.1A) — the page never
 * fetches rows it will not show; the "show archived" filter re-queries with the flag instead of
 * filtering in React.
 */
export async function listUsers(opts: { includeArchived?: boolean } = {}): Promise<AdminUser[]> {
  const admin = await assertAnyPermission(userAdminCodes("read"));
  const supabase = getAdminSupabaseClient();
  const now = new Date();

  let query = supabase
    .from("app_user")
    .select(
      "id, email, name, status, is_system_admin, last_login_at, last_seen_at, last_login_method, login_count, onboarding_email_sent_at",
    )
    .eq("tenant_id", admin.tenantId);
  if (!opts.includeArchived) query = query.neq("status", "archived");

  const { data: users, error } = await query.order("email").returns<UserRow[]>();
  if (error) throw new Error(`[users] directory read failed: ${error.message}`);

  const [{ data: roleRows, error: roleErr }, passwordRows] = await Promise.all([
    supabase
      .from("user_role")
      .select("user_id, role:role_id(id, code, label_fr)")
      .eq("tenant_id", admin.tenantId)
      .returns<{ user_id: string; role: { id: string; code: string; label_fr: string | null } | null }[]>(),
    readPasswordLifecycle(supabase, admin.tenantId),
  ]);
  if (roleErr) throw new Error(`[users] role read failed: ${roleErr.message}`);

  const byUser = new Map<string, AdminUserRole[]>();
  for (const r of roleRows ?? []) {
    if (!r.role) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push({ roleId: r.role.id, code: r.role.code, labelFr: r.role.label_fr });
    byUser.set(r.user_id, list);
  }

  return (users ?? []).map((u) => {
    const pw = passwordRows.get(u.id);
    return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: toStaffStatus(u.status),
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
    // Absent columns (migration not yet applied) read as "unknown", never as a
    // manufactured date and never as "no temporary password outstanding".
    passwordChangedAt: pw?.password_changed_at ?? null,
    mustChangePassword: pw?.must_change_password ?? false,
    tempPasswordExpiresAt: pw?.temp_password_expires_at ?? null,
    passwordStatus: passwordStatus({
      passwordChangedAt: pw?.password_changed_at ?? null,
      mustChangePassword: pw?.must_change_password ?? false,
      tempPasswordExpiresAt: pw?.temp_password_expires_at ?? null,
      now,
    }),
    };
  });
}

/**
 * One user, for the details page. Same shape and same derivations as the
 * directory — reusing listUsers rather than writing a second projection, so the
 * two views can never disagree about a user's status or password state. Archived
 * users are included: the details page is exactly where an administrator goes to
 * look at one.
 *
 * Returns null for an unknown id or one belonging to another tenant, which the
 * page renders as a plain "not found" — a cross-tenant probe learns nothing.
 */
export async function getAdminUser(userId: string): Promise<AdminUser | null> {
  const all = await listUsers({ includeArchived: true });
  return all.find((u) => u.id === userId) ?? null;
}

/** SYSTEM_ADMIN presence summary (gated admin:users:read). Derived counts only. */
export async function getPresenceSummary(): Promise<PresenceSummary> {
  const admin = await assertAnyPermission(userAdminCodes("read"));
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

/**
 * Role codes that exist in the tenant `role` catalog for LABELING a portal identity
 * (e.g. shown next to a client_user's name) but must never be assignable to an
 * app_user via user_role — that assignment grants no capability (the template carries
 * only the profile:*:self baseline) and, worse, makes the account resolve as STAFF
 * (classifySession sees an app_user row) instead of the customer portal, stranding a
 * customer representative in the internal shell. The one legitimate way to grant portal
 * access is lib/portal/admin-actions.ts, which inserts into client_user, never app_user.
 */
export const NON_ASSIGNABLE_STAFF_ROLE_CODES = ["CLIENT_USER"] as const;

export async function listAssignableRoles(): Promise<AssignableRole[]> {
  const admin = await assertAnyPermission(userAdminCodes("read"));
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("role")
    .select("id, code, label_fr")
    .eq("tenant_id", admin.tenantId)
    .order("code");
  if (error) throw new Error(`[users] role list failed: ${error.message}`);
  return (data ?? [])
    .filter((r) => !(NON_ASSIGNABLE_STAFF_ROLE_CODES as readonly string[]).includes(r.code))
    .map((r) => ({ id: r.id, code: r.code, labelFr: r.label_fr }));
}
