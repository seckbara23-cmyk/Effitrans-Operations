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
import { buildStaffIdentity } from "./identity";
import { staffIdentityStored } from "./identity-141";
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

  // ADMIN-USER-IDENTITY-01 — the professional profile, in ONE batched read for
  // the whole directory. §19/DEC-C53: `first_name`, `last_name` and
  // `staff_function` arrive with migration 20261003000001, which is written and
  // NOT applied, and PostgREST fails the WHOLE select on an unknown column — so
  // they are named only once the probe says they exist. `job_title` has existed
  // since DBC-1 and is always projected.
  const identityStorable = await staffIdentityStored();
  const [{ data: roleRows, error: roleErr }, passwordRows, profileRows] = await Promise.all([
    supabase
      .from("user_role")
      .select("user_id, role:role_id(id, code, label_fr)")
      .eq("tenant_id", admin.tenantId)
      .returns<{ user_id: string; role: { id: string; code: string; label_fr: string | null } | null }[]>(),
    readPasswordLifecycle(supabase, admin.tenantId),
    supabase
      .from("workforce_profile")
      .select(
        identityStorable
          ? "user_id, job_title, first_name, last_name, staff_function"
          : "user_id, job_title",
      )
      .eq("tenant_id", admin.tenantId),
  ]);
  if (roleErr) throw new Error(`[users] role read failed: ${roleErr.message}`);
  // A GENUINE failure stays loud. Only a not-yet-applied migration was made
  // survivable, and it was made survivable by not asking — not by catching.
  if (profileRows.error) {
    throw new Error(`[users] professional profile read failed: ${profileRows.error.message}`);
  }
  const profileByUser = new Map<string, Record<string, string | null>>();
  // Cast through `unknown`: the generated database types describe the schema
  // that is DEPLOYED, and the three identity columns are deliberately not in it
  // yet. Adding them to lib/db/types.ts would assert columns production lacks.
  for (const r of (profileRows.data ?? []) as unknown as Record<string, string | null>[]) {
    if (r.user_id) profileByUser.set(r.user_id, r);
  }

  const byUser = new Map<string, AdminUserRole[]>();
  for (const r of roleRows ?? []) {
    if (!r.role) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push({ roleId: r.role.id, code: r.role.code, labelFr: r.role.label_fr });
    byUser.set(r.user_id, list);
  }

  return (users ?? []).map((u) => {
    const pw = passwordRows.get(u.id);
    const wp = profileByUser.get(u.id);
    return {
    id: u.id,
    email: u.email,
    name: u.name,
    identity: buildStaffIdentity({
      firstName: wp?.first_name ?? null,
      lastName: wp?.last_name ?? null,
      legacyName: u.name,
      email: u.email,
      functionLabel: wp?.staff_function ?? null,
      mainTitle: wp?.job_title ?? null,
    }),
    identityStorable,
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
