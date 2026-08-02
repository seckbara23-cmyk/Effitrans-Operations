"use server";

/**
 * HR-6 — Training register actions.
 *
 * AUTHORITY: catalog and enrollment both ride hr:manage, exactly as equipment
 * and onboarding do. No `hr:training:manage` was invented — training is
 * operational HR data, not a separate authority, and a permission nobody asked
 * for is a permission nobody maintains. The analysis is recorded in
 * docs/hr/hr-6-permission-analysis.md.
 *
 * Assignment and completion go through transactional RPCs: the domain write and
 * the ledger events commit together or not at all.
 *
 * WHAT THIS MODULE WILL NOT GROW INTO: there is no course content, no lesson,
 * no delivery, no procurement and no payment here. `providerReference` points
 * OUT to wherever the training actually happened.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import type { DeliveryMode } from "./training/catalog";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];

export type TrainingResult = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

const RPC_ERRORS: Record<string, string> = {
  HR650: "enrollment_closed", HR651: "course_not_found", HR652: "course_inactive",
  HR653: "employee_not_found", HR654: "enrollment_not_found", HR655: "evidence_required",
  HR656: "invalid_closure", HR657: "reason_required",
};
const mapRpc = (e: { code?: string; message?: string } | null) => ({
  error: (e?.code && RPC_ERRORS[e.code]) || "save_failed",
  detail: e?.message,
});

const PATH = "/departments/hr/formation";

/* ========================================================================== */
/* Catalog                                                                    */
/* ========================================================================== */

export async function upsertTrainingCourse(input: {
  id?: string; code: string; title: string; provider?: string | null;
  category?: string | null; deliveryMode?: DeliveryMode;
  durationMinutes?: number | null; validityMonths?: number | null;
  isMandatory?: boolean; requiresEvidence?: boolean; isActive?: boolean;
  targetOrgUnitId?: string | null; targetPositionId?: string | null;
}): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!input.code.trim() || !input.title.trim()) return { ok: false, error: "missing_field" };
  const positive = (v: number | null | undefined) =>
    v === null || v === undefined || (Number.isInteger(v) && v > 0);
  if (!positive(input.durationMinutes)) return { ok: false, error: "invalid_duration" };
  if (!positive(input.validityMonths)) return { ok: false, error: "invalid_validity" };

  const s = getAdminSupabaseClient();
  const row = {
    tenant_id: admin.tenantId, code: input.code.trim(), title: input.title.trim(),
    provider: input.provider || null, category: input.category || null,
    delivery_mode: input.deliveryMode ?? "IN_PERSON",
    duration_minutes: input.durationMinutes ?? null,
    validity_months: input.validityMonths ?? null,
    is_mandatory: input.isMandatory ?? false,
    requires_evidence: input.requiresEvidence ?? false,
    is_active: input.isActive ?? true,
    target_org_unit_id: input.targetOrgUnitId || null,
    target_position_id: input.targetPositionId || null,
  };

  if (input.id) {
    const { error } = await s.from("hr_training_course").update(row)
      .eq("id", input.id).eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed", detail: error.message };
    await writeAudit({ action: "hr.training.course_updated", actorId: admin.id,
      tenantId: admin.tenantId, entity: "hr_training_course", entityId: input.id,
      after: { code: row.code, active: row.is_active } });
    revalidatePath(PATH);
    return { ok: true, id: input.id };
  }
  const { data, error } = await s.from("hr_training_course").insert({ ...row, created_by: admin.id })
    .select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };
  await writeAudit({ action: "hr.training.course_created", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_training_course", entityId: data.id,
    after: { code: row.code, mandatory: row.is_mandatory } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/** Retire, never delete: a course somebody completed must stay referenceable. */
export async function retireTrainingCourse(courseId: string): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.from("hr_training_course").update({ is_active: false })
    .eq("id", courseId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed", detail: error.message };
  await writeAudit({ action: "hr.training.course_retired", actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_training_course", entityId: courseId });
  revalidatePath(PATH);
  return { ok: true, id: courseId };
}

/* ========================================================================== */
/* Plans                                                                      */
/* ========================================================================== */

export async function createTrainingPlan(input: {
  employeeId: string; labelFr: string; periodStart: string; periodEnd: string; note?: string | null;
}): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!input.labelFr.trim()) return { ok: false, error: "missing_field" };
  if (input.periodEnd < input.periodStart) return { ok: false, error: "invalid_period" };

  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_training_plan").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId, label_fr: input.labelFr.trim(),
    period_start: input.periodStart, period_end: input.periodEnd,
    note: input.note || null, created_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed", detail: error?.message };
  await writeAudit({ action: "hr.training.plan_created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_training_plan", entityId: data.id, after: { employee_id: input.employeeId } });
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/* ========================================================================== */
/* Enrollments                                                                */
/* ========================================================================== */

export async function assignTraining(input: {
  employeeId: string; courseId: string; plannedDate?: string | null;
  dueDate?: string | null; planId?: string | null;
}): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_assign_training", {
    p_tenant: admin.tenantId, p_employee: input.employeeId, p_course: input.courseId,
    p_actor: admin.id, p_planned: input.plannedDate || null,
    p_due: input.dueDate || null, p_plan: input.planId || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.training.assigned", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_training_enrollment", entityId: (data as string) ?? null,
    after: { employee_id: input.employeeId, course_id: input.courseId, due_date: input.dueDate ?? null } });
  revalidatePath(PATH);
  return { ok: true, id: (data as string) ?? undefined };
}

/** PLANNED → ENROLLED → IN_PROGRESS. Terminal states go through their own calls. */
export async function advanceEnrollment(
  enrollmentId: string, to: "ENROLLED" | "IN_PROGRESS",
): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const from = to === "ENROLLED" ? ["PLANNED"] : ["PLANNED", "ENROLLED"];
  const s = getAdminSupabaseClient();
  const patch: Tbl["hr_training_enrollment"]["Update"] = { status: to };
  if (to === "IN_PROGRESS") patch.started_at = new Date().toISOString();
  const { data, error } = await s.from("hr_training_enrollment").update(patch)
    .eq("id", enrollmentId).eq("tenant_id", admin.tenantId).in("status", from).select("id");
  if (error) return { ok: false, ...mapRpc(error) };
  if (!data || data.length === 0) return { ok: false, error: "invalid_transition" };
  await writeAudit({ action: `hr.training.${to.toLowerCase()}`, actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_training_enrollment", entityId: enrollmentId,
    after: { status: to } });
  revalidatePath(PATH);
  return { ok: true, id: enrollmentId };
}

/**
 * Completion. The expiry is derived from the COURSE's own configured
 * validity_months inside the RPC — a tenant's revalidation interval, never an
 * invented statutory period. A course marked `requires_evidence` refuses to
 * complete without a certificate document.
 */
export async function completeTraining(input: {
  enrollmentId: string; result?: string | null; completedOn?: string | null;
  certificateDocumentId?: string | null; providerReference?: string | null;
}): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (input.completedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn)) {
    return { ok: false, error: "invalid_date" };
  }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_complete_training", {
    p_tenant: admin.tenantId, p_enrollment: input.enrollmentId, p_actor: admin.id,
    p_result: input.result || null, p_completed_on: input.completedOn || null,
    p_certificate: input.certificateDocumentId || null,
    p_provider_reference: input.providerReference || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: "hr.training.completed", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_training_enrollment", entityId: input.enrollmentId,
    after: { result: input.result ?? null, has_certificate: Boolean(input.certificateDocumentId) } });
  revalidatePath(PATH);
  return { ok: true, id: input.enrollmentId };
}

/** FAILED and CANCELLED are governed exits. A retake is a NEW enrollment. */
export async function closeEnrollment(
  enrollmentId: string, status: "FAILED" | "CANCELLED", reason?: string,
): Promise<TrainingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (status === "CANCELLED" && !reason?.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_close_training_enrollment", {
    p_tenant: admin.tenantId, p_enrollment: enrollmentId, p_actor: admin.id,
    p_status: status, p_reason: reason?.trim() || null,
  });
  if (error) return { ok: false, ...mapRpc(error) };
  await writeAudit({ action: `hr.training.${status.toLowerCase()}`, actorId: admin.id,
    tenantId: admin.tenantId, entity: "hr_training_enrollment", entityId: enrollmentId,
    after: { status } });
  revalidatePath(PATH);
  return { ok: true, id: enrollmentId };
}
