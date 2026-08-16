import "server-only";

/**
 * THE linked-employee resolver (HR-B1, shared by HR-B2). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * One place answers "which employee record is this login?", so the leave and
 * performance identity lanes can never drift apart or grow a second rule.
 *
 * `employee.linked_app_user_id` proves IDENTITY and grants nothing (DEC-B63):
 * what the resolved employee may then do is decided by their own rows — their
 * leave request, their evaluation, the assignment naming them as someone's
 * manager. An unlinked account resolves to null and simply has no lane.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export type LinkedEmployee = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  department: string;
  status: string;
};

/** The caller's employee record, or null. Tenant-scoped by the caller's own
 *  session tenant — never by client input. */
export async function resolveLinkedEmployee(tenantId: string, userId: string): Promise<LinkedEmployee | null> {
  const s = getAdminSupabaseClient();
  const { data } = await s
    .from("employee")
    .select("id, employee_number, first_name, last_name, department, status")
    .eq("tenant_id", tenantId)
    .eq("linked_app_user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** The same lookup narrowed to an ACTIVE employee — the shape the identity
 *  LANES require: a suspended or terminated record acts on nothing. */
export async function resolveActiveLinkedEmployee(tenantId: string, userId: string): Promise<LinkedEmployee | null> {
  const e = await resolveLinkedEmployee(tenantId, userId);
  return e && e.status === "ACTIVE" ? e : null;
}
