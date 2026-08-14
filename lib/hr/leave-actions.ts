"use server";

/**
 * HR-5 — Leave & Attendance actions. HR-B1 activated the approval authority.
 *
 * SEPARATION OF DUTIES, EXPLICIT:
 *   request / submit / cancel / entitlements / attendance (HR desk) → hr:manage
 *   the EMPLOYEE's own request / submit / retract                   → identity
 *     (the caller's account is linked to the request's employee — no
 *      permission, no account creation, the link grants nothing else)
 *   APPROVE or REFUSE — two lanes, decided by the DATABASE (HR-B1):
 *     * the requester's manager on the open PRIMARY assignment (identity:
 *       the actor's linked ACTIVE employee IS `manager_employee_id`), or
 *     * an org-wide seat holding `hr:leave:approve` (Direction: DGA/DAF).
 *   The app resolves WHO is calling; `hr_decide_leave_request` decides WHETHER
 *   they may — cross-department approval is impossible by construction, the
 *   maker-checker rule (HR524) and the self-leave guard (HR527) hold on both
 *   lanes, and unauthorized callers fail in the RPC (EFA*), not in UI logic.
 *
 * Decisions go through the transactional RPCs (ADR-HR2-01 as exercised in
 * HR-4): the decision, the entitlement movement and the ledger event commit
 * together or not at all.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";
import { spanTenths } from "./leave/balance";

export type LeaveResult = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  HR520: "already_decided", HR521: "invalid_decision", HR522: "request_not_found",
  HR523: "not_submitted", HR524: "same_actor", HR525: "reason_required", HR526: "not_cancellable",
  HR527: "own_leave", HR528: "invalid_mode", HR529: "not_own_request", HR530: "actor_invalid",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  // EFA* = the trusted-actor framework refused (no authority): the caller is
  // neither the manager nor an org-wide seat.
  error: (e?.code && RPC_ERRORS[e.code]) || (e?.code?.startsWith("EFA") ? "forbidden_approval" : "save_failed"),
  detail: e?.message,
});

const PATH = "/departments/hr/conges";
const MY_PATH = "/conges";

/** The one insert path both request lanes share: dates → tenths → insert →
 *  ledger event (mandatory, compensating delete) → audit. */
async function createLeaveRequestCore(args: {
  tenantId: string; actorId: string; employeeId: string; categoryId: string;
  startDate: string; endDate: string; dayTenths?: number | null;
  reason?: string | null; evidenceDocumentId?: string | null;
}): Promise<LeaveResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) {
    return { ok: false, error: "invalid_date" };
  }
  let tenths: number;
  try {
    tenths = args.dayTenths && args.dayTenths > 0 ? Math.trunc(args.dayTenths) : spanTenths(args.startDate, args.endDate);
  } catch { return { ok: false, error: "invalid_date" }; }

  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_leave_request").insert({
    tenant_id: args.tenantId, employee_id: args.employeeId, category_id: args.categoryId,
    start_date: args.startDate, end_date: args.endDate, day_tenths: tenths,
    reason: args.reason?.trim() || null, evidence_document_id: args.evidenceDocumentId || null,
    requested_by: args.actorId,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };

  const emitted = await emitHrEvent({
    tenantId: args.tenantId, employeeId: args.employeeId, kind: "leave_requested", actorId: args.actorId,
    payload: { request_id: data.id, start_date: args.startDate, end_date: args.endDate, day_tenths: tenths },
  });
  if (!emitted) {
    await s.from("hr_leave_request").delete().eq("id", data.id).eq("tenant_id", args.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.leave.requested", actorId: args.actorId, tenantId: args.tenantId,
    entity: "hr_leave_request", entityId: data.id, after: { employee_id: args.employeeId, day_tenths: tenths } });
  revalidatePath(PATH);
  revalidatePath(MY_PATH);
  return { ok: true, id: data.id };
}

/** Create a request (HR desk). Whole-day span unless explicit tenths are given (half-days). */
export async function createLeaveRequest(input: {
  employeeId: string; categoryId: string; startDate: string; endDate: string;
  dayTenths?: number | null; reason?: string | null; evidenceDocumentId?: string | null;
}): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: emp } = await s.from("employee").select("id")
    .eq("id", input.employeeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!emp) return { ok: false, error: "employee_not_found" };
  return createLeaveRequestCore({ tenantId: admin.tenantId, actorId: admin.id, ...input });
}

// ---------------------------------------------------------------------------
// HR-B1 — employee self-service. IDENTITY, not permission: each action resolves
// the caller's LINKED ACTIVE employee and touches only that employee's rows.
// The link (`employee.linked_app_user_id`) proves who you are; it still grants
// nothing anywhere else, and no account or permission is ever created here.
// ---------------------------------------------------------------------------

async function resolveOwnEmployee(): Promise<
  { ok: true; userId: string; tenantId: string; employeeId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };
  const s = getAdminSupabaseClient();
  const { data } = await s.from("employee").select("id, status")
    .eq("tenant_id", user.tenantId).eq("linked_app_user_id", user.id).maybeSingle();
  if (!data) return { ok: false, error: "no_employee_link" };
  if (data.status !== "ACTIVE") return { ok: false, error: "employee_not_active" };
  return { ok: true, userId: user.id, tenantId: user.tenantId, employeeId: data.id };
}

/** The employee's own request — always for THEIR employee record, never another. */
export async function createMyLeaveRequest(input: {
  categoryId: string; startDate: string; endDate: string;
  dayTenths?: number | null; reason?: string | null;
}): Promise<LeaveResult> {
  const me = await resolveOwnEmployee();
  if (!me.ok) return me;
  return createLeaveRequestCore({
    tenantId: me.tenantId, actorId: me.userId, employeeId: me.employeeId, ...input,
  });
}

/** Submit own DRAFT. The row filter IS the authorization: own employee, DRAFT only. */
export async function submitMyLeaveRequest(requestId: string): Promise<LeaveResult> {
  const me = await resolveOwnEmployee();
  if (!me.ok) return me;
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_leave_request")
    .update({ status: "SUBMITTED", submitted_at: new Date().toISOString() })
    .eq("id", requestId).eq("tenant_id", me.tenantId)
    .eq("employee_id", me.employeeId).eq("status", "DRAFT")
    .select("id");
  if (error) return { ok: false, error: "save_failed" };
  if (!data || data.length === 0) return { ok: false, error: "not_own_request" };
  await writeAudit({ action: "hr.leave.submitted", actorId: me.userId, tenantId: me.tenantId,
    entity: "hr_leave_request", entityId: requestId });
  revalidatePath(PATH);
  revalidatePath(MY_PATH);
  return { ok: true, id: requestId };
}

/** Retract own request while UNDECIDED — the RPC's SELF mode enforces both. */
export async function cancelMyLeaveRequest(requestId: string, reason: string): Promise<LeaveResult> {
  const me = await resolveOwnEmployee();
  if (!me.ok) return me;
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_cancel_leave_request", {
    p_tenant: me.tenantId, p_request: requestId, p_actor: me.userId,
    p_reason: reason.trim(), p_mode: "SELF",
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.leave.cancelled", actorId: me.userId, tenantId: me.tenantId,
    entity: "hr_leave_request", entityId: requestId, after: { reason: reason.trim(), mode: "SELF" } });
  revalidatePath(PATH);
  revalidatePath(MY_PATH);
  return { ok: true, id: requestId };
}

/** DRAFT → SUBMITTED. Still hr:manage: submitting is not deciding. */
export async function submitLeaveRequest(requestId: string): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.from("hr_leave_request")
    .update({ status: "SUBMITTED", submitted_at: new Date().toISOString() })
    .eq("id", requestId).eq("tenant_id", admin.tenantId).eq("status", "DRAFT");
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.leave.submitted", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_leave_request", entityId: requestId });
  revalidatePath(PATH);
  return { ok: true, id: requestId };
}

/**
 * APPROVE / REFUSE — HR-B1: the DATABASE holds the authority. The action only
 * resolves the caller's identity; `hr_decide_leave_request` then allows the
 * requester's manager (open PRIMARY assignment) or an org-wide
 * `hr:leave:approve` seat, and refuses everyone else (EFA*). Keeping the
 * permission gate here would have BLOCKED the manager lane — a manager holds
 * no hr:* permission; their authority is the assignment row.
 */
export async function decideLeaveRequest(input: {
  requestId: string; decision: "APPROVED" | "REFUSED"; note?: string | null;
}): Promise<LeaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden_approval" };
  // A refusal must tell the employee why — an approval note stays optional.
  if (input.decision === "REFUSED" && !input.note?.trim()) {
    return { ok: false, error: "refusal_note_required" };
  }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_decide_leave_request", {
    p_tenant: user.tenantId, p_request: input.requestId, p_actor: user.id,
    p_decision: input.decision, p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: `hr.leave.${input.decision.toLowerCase()}`, actorId: user.id,
    tenantId: user.tenantId, entity: "hr_leave_request", entityId: input.requestId,
    after: { decision: input.decision } });
  revalidatePath(PATH);
  revalidatePath(MY_PATH);
  return { ok: true, id: input.requestId };
}

/** Cancellation returns entitlement when the leave had been approved. */
export async function cancelLeaveRequest(requestId: string, reason: string): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_cancel_leave_request", {
    p_tenant: admin.tenantId, p_request: requestId, p_actor: admin.id, p_reason: reason.trim(),
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.leave.cancelled", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_leave_request", entityId: requestId, after: { reason: reason.trim() } });
  revalidatePath(PATH);
  return { ok: true, id: requestId };
}

/** Entitlements are ENTERED, never computed: no accrual formula exists here. */
export async function upsertEntitlement(input: {
  employeeId: string; categoryId: string; periodStart: string; periodEnd: string;
  openingTenths: number; accruedTenths: number; note?: string | null;
}): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!Number.isInteger(input.openingTenths) || !Number.isInteger(input.accruedTenths)
      || input.openingTenths < 0 || input.accruedTenths < 0) {
    return { ok: false, error: "invalid_quantity" };
  }
  const s = getAdminSupabaseClient();
  const { data: existing } = await s.from("hr_leave_entitlement").select("id")
    .eq("tenant_id", admin.tenantId).eq("employee_id", input.employeeId)
    .eq("category_id", input.categoryId).eq("period_start", input.periodStart).maybeSingle();

  if (existing) {
    const { error } = await s.from("hr_leave_entitlement").update({
      opening_tenths: input.openingTenths, accrued_tenths: input.accruedTenths,
      period_end: input.periodEnd, note: input.note || null,
    }).eq("id", existing.id).eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed" };
    await writeAudit({ action: "hr.leave.entitlement_updated", actorId: admin.id, tenantId: admin.tenantId,
      entity: "hr_leave_entitlement", entityId: existing.id });
    revalidatePath(PATH);
    return { ok: true, id: existing.id };
  }
  const { data, error } = await s.from("hr_leave_entitlement").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId, category_id: input.categoryId,
    period_start: input.periodStart, period_end: input.periodEnd,
    opening_tenths: input.openingTenths, accrued_tenths: input.accruedTenths,
    note: input.note || null, created_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.leave.entitlement_created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_leave_entitlement", entityId: data.id });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/**
 * Attendance — the INPUT CONTRACT. Minutes are recorded as given; nothing is
 * inferred, and no device integration exists. Deliberately NOT emitted to the
 * employee ledger: a daily row per person would drown the employment narrative
 * the Timeline exists to tell. It is audited normally instead.
 */
export async function recordAttendance(input: {
  employeeId: string; workDate: string; workedMinutes: number;
  source?: "MANUAL" | "IMPORT" | "DEVICE"; note?: string | null;
}): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return { ok: false, error: "invalid_date" };
  if (!Number.isInteger(input.workedMinutes) || input.workedMinutes < 0 || input.workedMinutes > 1440) {
    return { ok: false, error: "invalid_minutes" };
  }
  const s = getAdminSupabaseClient();
  const { data: existing } = await s.from("hr_attendance_day").select("id")
    .eq("tenant_id", admin.tenantId).eq("employee_id", input.employeeId)
    .eq("work_date", input.workDate).maybeSingle();

  if (existing) {
    const { error } = await s.from("hr_attendance_day").update({
      worked_minutes: input.workedMinutes, source: input.source ?? "MANUAL", note: input.note || null,
    }).eq("id", existing.id).eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed" };
    await writeAudit({ action: "hr.attendance.updated", actorId: admin.id, tenantId: admin.tenantId,
      entity: "hr_attendance_day", entityId: existing.id, after: { minutes: input.workedMinutes } });
    revalidatePath(PATH);
    return { ok: true, id: existing.id };
  }
  const { data, error } = await s.from("hr_attendance_day").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId, work_date: input.workDate,
    worked_minutes: input.workedMinutes, source: input.source ?? "MANUAL",
    note: input.note || null, recorded_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.attendance.recorded", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_attendance_day", entityId: data.id, after: { minutes: input.workedMinutes } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}
