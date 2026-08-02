"use server";

/**
 * HR-5 — Leave & Attendance actions.
 *
 * SEPARATION OF DUTIES, EXPLICIT:
 *   request / submit / cancel-own-draft / entitlements / attendance → hr:manage
 *   APPROVE or REFUSE                                              → hr:leave:approve
 *
 * `hr:leave:approve` exists in the catalogue and is GRANTED TO NO ROLE until
 * management ratifies it (docs/hr/hr-5-permission-ratification.md). Approval
 * therefore denies everyone today — deliberately. Letting it ride hr:manage
 * would have made the maker-checker rule decorative: the same person could
 * request and approve, and the database CHECK would be the only thing left
 * standing between them.
 *
 * Decisions go through the transactional RPCs (ADR-HR2-01 as exercised in
 * HR-4): the decision, the entitlement movement and the ledger event commit
 * together or not at all.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";
import { spanTenths } from "./leave/balance";

export type LeaveResult = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  HR520: "already_decided", HR521: "invalid_decision", HR522: "request_not_found",
  HR523: "not_submitted", HR524: "same_actor", HR525: "reason_required", HR526: "not_cancellable",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code]) || "save_failed",
  detail: e?.message,
});

const PATH = "/departments/hr/conges";

/** Create a request. Whole-day span unless explicit tenths are given (half-days). */
export async function createLeaveRequest(input: {
  employeeId: string; categoryId: string; startDate: string; endDate: string;
  dayTenths?: number | null; reason?: string | null; evidenceDocumentId?: string | null;
}): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return { ok: false, error: "invalid_date" };
  }
  let tenths: number;
  try {
    tenths = input.dayTenths && input.dayTenths > 0 ? Math.trunc(input.dayTenths) : spanTenths(input.startDate, input.endDate);
  } catch { return { ok: false, error: "invalid_date" }; }

  const s = getAdminSupabaseClient();
  const { data: emp } = await s.from("employee").select("id")
    .eq("id", input.employeeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!emp) return { ok: false, error: "employee_not_found" };

  const { data, error } = await s.from("hr_leave_request").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId, category_id: input.categoryId,
    start_date: input.startDate, end_date: input.endDate, day_tenths: tenths,
    reason: input.reason?.trim() || null, evidence_document_id: input.evidenceDocumentId || null,
    requested_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };

  const emitted = await emitHrEvent({
    tenantId: admin.tenantId, employeeId: input.employeeId, kind: "leave_requested", actorId: admin.id,
    payload: { request_id: data.id, start_date: input.startDate, end_date: input.endDate, day_tenths: tenths },
  });
  if (!emitted) {
    await s.from("hr_leave_request").delete().eq("id", data.id).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.leave.requested", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_leave_request", entityId: data.id, after: { employee_id: input.employeeId, day_tenths: tenths } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
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
 * APPROVE / REFUSE — the separate authority. Gated on hr:leave:approve, which
 * nobody holds until ratification; the database CHECK and the RPC enforce the
 * maker-checker rule independently of this gate.
 */
export async function decideLeaveRequest(input: {
  requestId: string; decision: "APPROVED" | "REFUSED"; note?: string | null;
}): Promise<LeaveResult> {
  let admin;
  try { admin = await assertPermission("hr:leave:approve"); } catch { return { ok: false, error: "forbidden_approval" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_decide_leave_request", {
    p_tenant: admin.tenantId, p_request: input.requestId, p_actor: admin.id,
    p_decision: input.decision, p_note: input.note || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: `hr.leave.${input.decision.toLowerCase()}`, actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_leave_request", entityId: input.requestId,
    after: { decision: input.decision } });
  revalidatePath(PATH);
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
