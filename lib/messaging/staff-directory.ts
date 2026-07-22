/**
 * Staff recipient search — "start a conversation" picker (Phase 8.6A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * NOT a new employee directory: this is a narrow, messaging:send-gated reader that
 * returns the minimum fields a colleague picker needs (id, name, email, role label,
 * department label) — never phone, address, payroll, auth metadata, or audit data.
 * The existing admin-scoped directory (lib/users/service.ts listUsers, gated on
 * admin:users:manage) is NOT reused here on purpose: this reader is for ANY staff
 * member who can send a message, not just admins, so it needed its own narrower gate
 * and its own minimal field set — reusing the admin reader would have either over-
 * granted admin-only data to ordinary staff or under-granted search to everyone else.
 *
 * Tenant and identity are ALWAYS resolved server-side from the authenticated session
 * (getCurrentUser) — a client can never supply a tenant id, and the excluded self id
 * is the resolved session user, never a request parameter.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { roleLabel, ROLE_DISPLAY_PRIORITY } from "@/lib/navigation/roles";
import { CONTACT_DEPARTMENT_LABELS } from "@/lib/portal/self-service";
import { searchStaffDirectory, roleDepartmentCode, type StaffRecipient } from "./access";

/**
 * Defensive ceiling on how many ACTIVE tenant staff rows this reader will ever pull
 * before filtering — NOT "load the whole company directory". For this business
 * (a freight forwarder's ops team) that ceiling is, in practice, the entire active
 * roster; if a tenant ever exceeds it the search degrades to an incomplete-but-
 * still-useful candidate window rather than an unbounded table scan.
 */
const CANDIDATE_CEILING = 200;
const RESULT_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

export async function searchStaffRecipients(query: string): Promise<StaffRecipient[]> {
  const trimmed = (query ?? "").trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const user = await getCurrentUser();
  if (!user) return [];
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "messaging:send")) return [];

  const admin = getAdminSupabaseClient();

  // ACTIVE, same tenant, excluding the caller — never a portal/platform identity
  // (different tables entirely, never queried here).
  const { data: staffRows } = await admin
    .from("app_user")
    .select("id, name, email")
    .eq("tenant_id", user.tenantId)
    .eq("status", "active")
    .neq("id", user.id)
    .order("name", { ascending: true })
    .limit(CANDIDATE_CEILING)
    .returns<{ id: string; name: string | null; email: string }[]>();

  const candidates = staffRows ?? [];
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const { data: roleRows } = await admin
    .from("user_role")
    .select("user_id, role:role_id(code)")
    .eq("tenant_id", user.tenantId)
    .in("user_id", ids)
    .returns<{ user_id: string; role: { code: string } | { code: string }[] | null }[]>();

  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const role = Array.isArray(r.role) ? r.role[0] : r.role;
    if (!role) continue;
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(role.code);
    rolesByUser.set(r.user_id, list);
  }

  const enriched: StaffRecipient[] = candidates.map((c) => {
    const heldCodes = new Set(rolesByUser.get(c.id) ?? []);
    // Same priority order the staff Topbar uses (primaryRoleLabel) — one displayed
    // role, chosen the same way everywhere else in the app, not a new ordering.
    const primaryCode = ROLE_DISPLAY_PRIORITY.find((code) => heldCodes.has(code)) ?? null;
    const deptCode = primaryCode ? roleDepartmentCode(primaryCode) : null;
    return {
      id: c.id,
      name: c.name?.trim() || c.email,
      email: c.email,
      roleLabel: primaryCode ? roleLabel(primaryCode) : null,
      departmentLabel: deptCode ? (CONTACT_DEPARTMENT_LABELS[deptCode] ?? null) : null,
    };
  });

  return searchStaffDirectory(enriched, trimmed, RESULT_LIMIT);
}
