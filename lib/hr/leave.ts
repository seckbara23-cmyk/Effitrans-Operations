import "server-only";

/**
 * HR-5 — Leave & Attendance reads. SERVER-ONLY.
 * Pure arithmetic lives in ./leave/balance.ts, the ON_LEAVE projection in
 * ./leave/presence.ts — neither imports a client or a clock.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";
import { computeBalance, type Balance } from "./leave/balance";
import { derivePresence, type LeaveWindow, type Presence } from "./leave/presence";

type Tbl = Database["public"]["Tables"];
export type LeaveCategory = Tbl["hr_leave_category"]["Row"];
export type LeaveEntitlement = Tbl["hr_leave_entitlement"]["Row"];
export type LeaveRequest = Tbl["hr_leave_request"]["Row"];
export type AttendanceDay = Tbl["hr_attendance_day"]["Row"];

export const LEAVE_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon", SUBMITTED: "Soumise", APPROVED: "Approuvée",
  REFUSED: "Refusée", CANCELLED: "Annulée",
};

export async function listLeaveCategories(tenantId: string): Promise<LeaveCategory[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_leave_category").select("*")
    .eq("tenant_id", tenantId).eq("is_active", true).order("label_fr");
  if (error) throw new Error(`[hr] leave categories read failed: ${error.message}`);
  return data ?? [];
}

export async function listLeaveRequests(tenantId: string, employeeId?: string): Promise<LeaveRequest[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_leave_request").select("*").eq("tenant_id", tenantId);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("start_date", { ascending: false });
  if (error) throw new Error(`[hr] leave requests read failed: ${error.message}`);
  return data ?? [];
}

export async function listEntitlements(tenantId: string, employeeId: string): Promise<LeaveEntitlement[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_leave_entitlement").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .order("period_start", { ascending: false });
  if (error) throw new Error(`[hr] entitlements read failed: ${error.message}`);
  return data ?? [];
}

export type EntitlementWithBalance = LeaveEntitlement & { balance: Balance };

export function withBalances(rows: LeaveEntitlement[]): EntitlementWithBalance[] {
  return rows.map((r) => ({
    ...r,
    balance: computeBalance({
      openingTenths: r.opening_tenths, accruedTenths: r.accrued_tenths, takenTenths: r.taken_tenths,
    }),
  }));
}

/**
 * The ON_LEAVE projection — READ ONLY, by construction. This function returns
 * a presence for display; nothing in the codebase writes it back to
 * `employee.status`, and a test pins that.
 */
export async function deriveEmployeePresence(
  tenantId: string, employeeId: string, employeeStatus: string, referenceISO?: string,
): Promise<Presence> {
  const s = getAdminSupabaseClient();
  const ref = referenceISO ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await s.from("hr_leave_request")
    .select("status, start_date, end_date")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("status", "APPROVED")
    .lte("start_date", ref).gte("end_date", ref);
  if (error) throw new Error(`[hr] presence read failed: ${error.message}`);
  const windows: LeaveWindow[] = (data ?? []).map((r) => ({
    status: r.status, startISO: r.start_date, endISO: r.end_date,
  }));
  return derivePresence(employeeStatus, windows, ref);
}

export async function listAttendance(tenantId: string, employeeId: string, limit = 60): Promise<AttendanceDay[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_attendance_day").select("*")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .order("work_date", { ascending: false }).limit(limit);
  if (error) throw new Error(`[hr] attendance read failed: ${error.message}`);
  return data ?? [];
}

/** Dashboard: requests awaiting a decision, and people on leave today. */
export async function leaveCounts(tenantId: string): Promise<{ pending: number; onLeaveToday: number }> {
  const s = getAdminSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const [pending, onLeave] = await Promise.all([
    s.from("hr_leave_request").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "SUBMITTED"),
    s.from("hr_leave_request").select("employee_id")
      .eq("tenant_id", tenantId).eq("status", "APPROVED").lte("start_date", today).gte("end_date", today),
  ]);
  const distinct = new Set((onLeave.data ?? []).map((r) => r.employee_id));
  return { pending: pending.count ?? 0, onLeaveToday: distinct.size };
}
