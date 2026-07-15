/**
 * Platform-safe per-company detail reads (Phase 6.0C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-side console reads for ONE tenant, for the Company Detail console. Same
 * doctrine as lib/platform/companies.ts: every entry is platform-gated, uses the
 * service-role client (platform reads are cross-tenant by design), returns ONLY
 * safe tenant-level metadata, and is BOUNDED — a fixed number of queries per call,
 * never one-per-row.
 *
 * These exist because the tenant-scoped reads (lib/users/service.ts,
 * lib/platform/audit-read.ts) cannot serve them: the former requires a tenant
 * session a platform admin does not have, and the latter has no per-tenant filter.
 * Neither is a new BEHAVIOUR — they are the same audit_log / app_user rows, read
 * through the same platform permission, scoped to one tenant.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission } from "./auth";

export type CompanyUser = {
  id: string;
  email: string;
  name: string | null;
  status: string;
  isSystemAdmin: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
};

/**
 * One tenant's users, with their role codes. Gated by platform:companies:read.
 * BOUNDED — 3 queries regardless of user count (users, memberships, roles), joined
 * in memory. Never one query per user.
 */
export async function listCompanyUsers(tenantId: string): Promise<CompanyUser[]> {
  await assertPlatformPermission("platform:companies:read");
  const admin = getAdminSupabaseClient();

  const [usersRes, rolesRes, roleDefsRes] = await Promise.all([
    admin
      .from("app_user")
      .select("id, email, name, status, is_system_admin, last_login_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at"),
    admin.from("user_role").select("user_id, role_id").eq("tenant_id", tenantId),
    admin.from("role").select("id, code").eq("tenant_id", tenantId),
  ]);

  if (usersRes.error) throw new Error(`[platform] company users read failed: ${usersRes.error.message}`);

  const roleCode = new Map((roleDefsRes.data ?? []).map((r) => [r.id, r.code]));
  const rolesByUser = new Map<string, string[]>();
  for (const ur of rolesRes.data ?? []) {
    const code = roleCode.get(ur.role_id);
    if (!code) continue;
    const list = rolesByUser.get(ur.user_id) ?? [];
    list.push(code);
    rolesByUser.set(ur.user_id, list);
  }

  return (usersRes.data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    isSystemAdmin: u.is_system_admin,
    roles: (rolesByUser.get(u.id) ?? []).sort(),
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  }));
}

export type CompanyAuditEntry = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  /** A resolved actor label (platform admin email, or "système"), never a raw id. */
  actorLabel: string;
  occurredAt: string;
};

export type CompanyAuditPage = {
  entries: CompanyAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * One tenant's audit slice, paginated. Gated by platform:audit:read. Reads the SAME
 * append-only audit_log, filtered to this tenant, most-recent first. Audit payloads
 * never carry secrets or operational data by construction, so nothing sensitive can
 * surface here.
 *
 * BOUNDED — 1 count + 1 page + 1 small actor-label lookup. `.range()` paginates in
 * SQL, so the full history is never pulled into memory.
 */
export async function listCompanyAuditEvents(
  tenantId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<CompanyAuditPage> {
  await assertPlatformPermission("platform:audit:read");
  const admin = getAdminSupabaseClient();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  const { data, error, count } = await admin
    .from("audit_log")
    .select("id, action, entity, entity_id, actor_id, platform_actor_id, occurred_at", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(`[platform] company audit read failed: ${error.message}`);
  const rows = data ?? [];

  // Resolve platform-actor emails in ONE batched lookup (the actors of platform.*
  // events are platform admins). Tenant-actor ids are left as a generic label rather
  // than joined — the platform console does not need to name tenant users here, and
  // not joining keeps this to a single extra query.
  const platformIds = [...new Set(rows.map((r) => r.platform_actor_id).filter(Boolean))] as string[];
  const emailById = new Map<string, string>();
  if (platformIds.length) {
    const { data: admins } = await admin
      .from("platform_admin")
      .select("id, email")
      .in("id", platformIds);
    for (const a of admins ?? []) emailById.set(a.id, a.email);
  }

  const entries: CompanyAuditEntry[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    actorLabel: r.platform_actor_id
      ? (emailById.get(r.platform_actor_id) ?? "administrateur plateforme")
      : r.actor_id
        ? "utilisateur du tenant"
        : "système",
    occurredAt: r.occurred_at,
  }));

  return { entries, total: count ?? entries.length, page, pageSize };
}
