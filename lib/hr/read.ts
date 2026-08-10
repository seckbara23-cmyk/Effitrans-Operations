/**
 * Employee registry — READ side (Phase HR-1). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Tenant-scoped readers over public.employee for the /departments/hr surfaces.
 * Every query filters by tenant_id (the service-role client bypasses RLS, so the
 * tenant filter here is the isolation boundary — enforced by the tenant-scope
 * guard test). Callers gate on hr:read before invoking (defense-in-depth: the
 * pages check, and the RLS policy also requires hr:read for any user-context read).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
export type EmployeeRow = Tbl["employee"]["Row"];

export type EmployeeListItem = Pick<
  EmployeeRow,
  "id" | "employee_number" | "first_name" | "last_name" | "preferred_name" | "department" | "job_title" | "status" | "hire_date"
> & {
  has_account: boolean;
  /** HR-A2 — the open PRIMARY assignment's unit name (authoritative placement), or null. */
  org_unit_name: string | null;
};

export type EmployeeFilters = {
  status?: string;
  department?: string;
  /**
   * HR-5A — directory filter over the columns the list ALREADY shows
   * (name, matricule, job title). This is a filter on an existing page, not a
   * search engine: the platform has no global search index, and building one
   * here would be a parallel infrastructure. Sensitive fields are never
   * matched — the filter cannot reach a field the row does not display.
   */
  q?: string;
};

/** Directory rows, tenant-scoped, newest first. */
export async function listEmployees(tenantId: string, filters: EmployeeFilters = {}): Promise<EmployeeListItem[]> {
  const admin = getAdminSupabaseClient();
  let q = admin
    .from("employee")
    .select("id, employee_number, first_name, last_name, preferred_name, department, job_title, status, hire_date, linked_app_user_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.department) q = q.eq("department", filters.department);
  const term = filters.q?.trim();
  if (term) {
    const safe = term.replace(/[%,()]/g, " ");
    q = q.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,employee_number.ilike.%${safe}%,job_title.ilike.%${safe}%`,
    );
  }
  const { data } = await q;
  const rows = data ?? [];

  // HR-A2 — resolve the authoritative placement (open PRIMARY assignment →
  // unit name) in two batched tenant-scoped reads, never per row.
  const unitByEmployee = new Map<string, string>();
  if (rows.length > 0) {
    const [{ data: opens }, { data: unitRows }] = await Promise.all([
      admin
        .from("employee_assignment")
        .select("employee_id, org_unit_id")
        .eq("tenant_id", tenantId)
        .eq("assignment_kind", "PRIMARY")
        .is("effective_to", null),
      admin.from("hr_org_unit").select("id, name").eq("tenant_id", tenantId),
    ]);
    const unitName = new Map((unitRows ?? []).map((u) => [u.id, u.name]));
    for (const a of opens ?? []) {
      if (a.org_unit_id && unitName.has(a.org_unit_id)) {
        unitByEmployee.set(a.employee_id, unitName.get(a.org_unit_id)!);
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    employee_number: r.employee_number,
    first_name: r.first_name,
    last_name: r.last_name,
    preferred_name: r.preferred_name,
    department: r.department,
    job_title: r.job_title,
    status: r.status,
    hire_date: r.hire_date,
    has_account: r.linked_app_user_id !== null,
    org_unit_name: unitByEmployee.get(r.id) ?? null,
  }));
}

export type EmployeeDetail = EmployeeRow & {
  manager_name: string | null;
  linked_account_email: string | null;
};

/** One employee, tenant-scoped, with resolved manager name + linked-account email. */
export async function getEmployee(tenantId: string, id: string): Promise<EmployeeDetail | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin.from("employee").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) return null;

  let manager_name: string | null = null;
  if (data.manager_employee_id) {
    const { data: m } = await admin
      .from("employee")
      .select("first_name, last_name")
      .eq("tenant_id", tenantId)
      .eq("id", data.manager_employee_id)
      .maybeSingle();
    if (m) manager_name = `${m.first_name} ${m.last_name}`;
  }

  let linked_account_email: string | null = null;
  if (data.linked_app_user_id) {
    const { data: u } = await admin
      .from("app_user")
      .select("email")
      .eq("tenant_id", tenantId)
      .eq("id", data.linked_app_user_id)
      .maybeSingle();
    if (u) linked_account_email = u.email;
  }

  return { ...data, manager_name, linked_account_email };
}

export type EmployeeStats = { active: number; suspended: number; withoutAccount: number; newThisMonth: number };

/** Registry headline counts (real data only, never fabricated). */
export async function employeeStats(tenantId: string): Promise<EmployeeStats> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("employee")
    .select("status, linked_app_user_id, created_at")
    .eq("tenant_id", tenantId);
  const rows = data ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return {
    active: rows.filter((r) => r.status === "ACTIVE").length,
    suspended: rows.filter((r) => r.status === "SUSPENDED").length,
    withoutAccount: rows.filter((r) => r.linked_app_user_id === null && r.status !== "ARCHIVED").length,
    newThisMonth: rows.filter((r) => r.created_at >= monthStart).length,
  };
}

/**
 * HR-A2 — DISTINCT active accounts holding HR_OFFICER in this tenant.
 * Fail-closed: any read failure reports 0, never "probably enough". Used by the
 * Operations Center to state honestly whether four-eyes HR workflows (contract
 * verification, import approval) can complete — they need TWO distinct people.
 */
export async function countHrOfficers(tenantId: string): Promise<number> {
  const admin = getAdminSupabaseClient();
  const { data: roles, error: rolesErr } = await admin
    .from("role")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("code", "HR_OFFICER");
  if (rolesErr || !roles || roles.length === 0) return 0;

  const { data: holders, error: holdersErr } = await admin
    .from("user_role")
    .select("user_id, app_user!inner(status)")
    .eq("tenant_id", tenantId)
    .in("role_id", roles.map((r) => r.id));
  if (holdersErr || !holders) return 0;

  const active = new Set<string>();
  for (const h of holders as unknown as { user_id: string; app_user: { status: string } }[]) {
    if (h.app_user?.status === "active") active.add(h.user_id);
  }
  return active.size;
}

export type LinkableAccount = { id: string; name: string | null; email: string };

/**
 * Active platform accounts in this tenant that are NOT yet linked to any
 * employee — the candidate set for the "link account" picker. Excludes the
 * currently-linked account of the employee being edited via `exceptEmployeeId`
 * being irrelevant (an account links to at most one employee, so a linked
 * account never appears here).
 */
export async function linkableAccounts(tenantId: string): Promise<LinkableAccount[]> {
  const admin = getAdminSupabaseClient();
  const [{ data: users }, { data: links }] = await Promise.all([
    admin.from("app_user").select("id, name, email").eq("tenant_id", tenantId).eq("status", "active"),
    admin.from("employee").select("linked_app_user_id").eq("tenant_id", tenantId).not("linked_app_user_id", "is", null),
  ]);
  const linked = new Set((links ?? []).map((l) => l.linked_app_user_id));
  return (users ?? [])
    .filter((u) => !linked.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
}
