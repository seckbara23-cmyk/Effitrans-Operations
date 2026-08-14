import "server-only";

/**
 * HR-B1 — « Mes congés » reads: the employee's own leave and the manager's
 * decision queue. SERVER-ONLY, admin client; the app-level gate is IDENTITY —
 * every query is scoped to the caller's linked employee (their own rows, their
 * own reports) or to the org-wide pending list for holders of
 * `hr:leave:approve`. That scoping IS the gate (the EC-3C rule for
 * admin-client reads).
 *
 * WHY THIS IS NOT « Mon Travail » (the §5 integration decision): the workbench
 * is the process engine's surface — its items are dossier steps read from the
 * SAME queue service as the department queues, deliberately ONE definition of
 * operational work. A leave request is not a dossier step: forcing it into
 * WorkbenchItem would either widen that contract for every queue consumer or
 * fork a second item shape inside it — a competing abstraction either way.
 * Leave decisions therefore live HERE, on the page whose whole subject they
 * are; the HR workspace keeps administrative oversight.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { departmentLabelFr, isCanonicalDepartment } from "@/lib/organization/departments";
import type { Database } from "@/lib/db/types";
import { computeBalance } from "./leave/balance";
import { listEntitlements, withBalances, type EntitlementWithBalance, type LeaveCategory, type LeaveRequest } from "./leave";

type EmployeeRow = Database["public"]["Tables"]["employee"]["Row"];

export type MyEmployee = Pick<
  EmployeeRow, "id" | "employee_number" | "first_name" | "last_name" | "department" | "status"
>;

export type PendingDecision = {
  request: LeaveRequest;
  employeeName: string;
  employeeNumber: string;
  departmentFr: string;
  categoryFr: string;
  /** Remaining tenths on the entitlement covering the leave start — null when
   *  no period covers it (nothing to decrement; a real, visible state). */
  remainingTenths: number | null;
};

export type MyLeaveWorkspace = {
  employee: MyEmployee | null;
  categories: LeaveCategory[];
  balances: EntitlementWithBalance[];
  myRequests: (LeaveRequest & { categoryFr: string })[];
  /** SUBMITTED requests of the caller's direct reports (open PRIMARY assignment). */
  teamPending: PendingDecision[];
  /** SUBMITTED requests org-wide — only populated for hr:leave:approve holders. */
  orgPending: PendingDecision[];
};

export async function resolveLinkedEmployee(tenantId: string, userId: string): Promise<MyEmployee | null> {
  const s = getAdminSupabaseClient();
  const { data } = await s.from("employee")
    .select("id, employee_number, first_name, last_name, department, status")
    .eq("tenant_id", tenantId).eq("linked_app_user_id", userId).maybeSingle();
  return data ?? null;
}

function deptFr(code: string): string {
  return isCanonicalDepartment(code) ? departmentLabelFr(code) : code;
}

async function decorate(
  tenantId: string,
  requests: LeaveRequest[],
  categoryLabel: Map<string, string>,
): Promise<PendingDecision[]> {
  if (requests.length === 0) return [];
  const s = getAdminSupabaseClient();
  const employeeIds = [...new Set(requests.map((r) => r.employee_id))];
  const [{ data: employees }, { data: entitlements }] = await Promise.all([
    s.from("employee").select("id, employee_number, first_name, last_name, department")
      .eq("tenant_id", tenantId).in("id", employeeIds),
    s.from("hr_leave_entitlement").select("*")
      .eq("tenant_id", tenantId).in("employee_id", employeeIds),
  ]);
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  return requests.map((r) => {
    const emp = byId.get(r.employee_id);
    const ent = (entitlements ?? []).find(
      (x) => x.employee_id === r.employee_id && x.category_id === r.category_id
        && r.start_date >= x.period_start && r.start_date <= x.period_end,
    );
    return {
      request: r,
      employeeName: emp ? `${emp.first_name} ${emp.last_name}` : "—",
      employeeNumber: emp?.employee_number ?? "—",
      departmentFr: emp ? deptFr(emp.department) : "—",
      categoryFr: categoryLabel.get(r.category_id) ?? "Congé",
      remainingTenths: ent
        ? computeBalance({
            openingTenths: ent.opening_tenths, accruedTenths: ent.accrued_tenths, takenTenths: ent.taken_tenths,
          }).remainingTenths
        : null,
    };
  });
}

export async function getMyLeaveWorkspace(
  user: { id: string; tenantId: string },
  canApprove: boolean,
): Promise<MyLeaveWorkspace> {
  const s = getAdminSupabaseClient();
  const employee = await resolveLinkedEmployee(user.tenantId, user.id);

  const { data: categories } = await s.from("hr_leave_category").select("*")
    .eq("tenant_id", user.tenantId).eq("is_active", true).order("label_fr");
  const categoryLabel = new Map((categories ?? []).map((c) => [c.id, c.label_fr]));

  // --- own space -----------------------------------------------------------
  let balances: EntitlementWithBalance[] = [];
  let myRequests: (LeaveRequest & { categoryFr: string })[] = [];
  if (employee) {
    const [{ data: requests }, entitlements] = await Promise.all([
      s.from("hr_leave_request").select("*")
        .eq("tenant_id", user.tenantId).eq("employee_id", employee.id)
        .order("created_at", { ascending: false }).limit(50),
      listEntitlements(user.tenantId, employee.id),
    ]);
    balances = withBalances(entitlements);
    myRequests = (requests ?? []).map((r) => ({ ...r, categoryFr: categoryLabel.get(r.category_id) ?? "Congé" }));
  }

  // --- manager queue: my direct reports' SUBMITTED requests ----------------
  let teamPending: PendingDecision[] = [];
  if (employee && employee.status === "ACTIVE") {
    const { data: reports } = await s.from("employee_assignment").select("employee_id")
      .eq("tenant_id", user.tenantId).eq("manager_employee_id", employee.id)
      .eq("assignment_kind", "PRIMARY").is("effective_to", null);
    const reportIds = [...new Set((reports ?? []).map((r) => r.employee_id))];
    if (reportIds.length > 0) {
      const { data: pending } = await s.from("hr_leave_request").select("*")
        .eq("tenant_id", user.tenantId).eq("status", "SUBMITTED")
        .in("employee_id", reportIds).order("start_date");
      teamPending = await decorate(user.tenantId, pending ?? [], categoryLabel);
    }
  }

  // --- org-wide queue for Direction seats ----------------------------------
  let orgPending: PendingDecision[] = [];
  if (canApprove) {
    const { data: pending } = await s.from("hr_leave_request").select("*")
      .eq("tenant_id", user.tenantId).eq("status", "SUBMITTED").order("start_date");
    const teamIds = new Set(teamPending.map((t) => t.request.id));
    orgPending = await decorate(
      user.tenantId,
      (pending ?? []).filter((r) => !teamIds.has(r.id)),
      categoryLabel,
    );
  }

  return { employee, categories: categories ?? [], balances, myRequests, teamPending, orgPending };
}
