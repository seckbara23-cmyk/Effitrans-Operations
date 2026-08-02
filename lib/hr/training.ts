import "server-only";

/**
 * HR-6 — Training register. READ SIDE. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A REGISTER, not a learning platform. This module reads what training a person
 * is required to hold, whether they completed it, and when it lapses. There is
 * no content, no lesson, no player and no progress-within-a-course: delivery
 * happens elsewhere and is referenced by `providerReference`.
 *
 * Every figure below is a COUNT or a DATE COMPARISON over stored rows. Nothing
 * is scored, averaged or ranked.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { CERTIFICATE_EXPIRY_WINDOW_DAYS, type TrainingCourse, type TrainingEnrollment, type TrainingPlan, type DeliveryMode, type EnrollmentStatus } from "./training/catalog";

// Pure primitives live in ./training/catalog so the CLIENT workspace can import
// them without dragging `server-only` across the boundary.
export * from "./training/catalog";

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoInDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function listCourses(tenantId: string, activeOnly = false): Promise<TrainingCourse[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_training_course").select("id, code, title, provider, category, delivery_mode, duration_minutes, validity_months, is_mandatory, requires_evidence, is_active, target_org_unit_id, target_position_id",
  ).eq("tenant_id", tenantId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q.order("code");
  if (error) throw new Error(`[hr] training catalog read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, code: r.code, title: r.title, provider: r.provider, category: r.category,
    deliveryMode: r.delivery_mode as DeliveryMode, durationMinutes: r.duration_minutes,
    validityMonths: r.validity_months, isMandatory: r.is_mandatory,
    requiresEvidence: r.requires_evidence, isActive: r.is_active,
    targetOrgUnitId: r.target_org_unit_id, targetPositionId: r.target_position_id,
  }));
}

export async function listEnrollments(
  tenantId: string, opts: { employeeId?: string; courseId?: string; status?: EnrollmentStatus } = {},
): Promise<TrainingEnrollment[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_training_enrollment").select("id, employee_id, course_id, plan_id, status, planned_date, due_date, completed_on, result, expiry_date, certificate_document_id, provider_reference, note",
  ).eq("tenant_id", tenantId);
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  if (opts.courseId) q = q.eq("course_id", opts.courseId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`[hr] enrollments read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, courseId: r.course_id, planId: r.plan_id,
    status: r.status as EnrollmentStatus, plannedDate: r.planned_date, dueDate: r.due_date,
    completedOn: r.completed_on, result: r.result, expiryDate: r.expiry_date,
    certificateDocumentId: r.certificate_document_id, providerReference: r.provider_reference,
    note: r.note,
  }));
}

export async function listTrainingPlans(
  tenantId: string, employeeId?: string,
): Promise<TrainingPlan[]> {
  const s = getAdminSupabaseClient();
  let q = s.from("hr_training_plan")
    .select("id, employee_id, label_fr, period_start, period_end, status, note")
    .eq("tenant_id", tenantId);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("period_start", { ascending: false }).limit(200);
  if (error) throw new Error(`[hr] training plans read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, labelFr: r.label_fr,
    periodStart: r.period_start, periodEnd: r.period_end, status: r.status, note: r.note,
  }));
}

/** Enrollments still open past their due date. A date comparison, nothing more. */
export async function overdueTraining(tenantId: string, mandatoryOnly = false): Promise<TrainingEnrollment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_training_enrollment")
    .select("id, employee_id, course_id, plan_id, status, planned_date, due_date, completed_on, result, expiry_date, certificate_document_id, provider_reference, note, hr_training_course!inner(is_mandatory)")
    .eq("tenant_id", tenantId)
    .in("status", ["PLANNED", "ENROLLED", "IN_PROGRESS"])
    .lt("due_date", isoToday())
    .order("due_date");
  if (error) throw new Error(`[hr] overdue training read failed: ${error.message}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? [])
    .filter((r: any) => !mandatoryOnly || r.hr_training_course?.is_mandatory === true)
    .map((r: any) => ({
      id: r.id, employeeId: r.employee_id, courseId: r.course_id, planId: r.plan_id,
      status: r.status as EnrollmentStatus, plannedDate: r.planned_date, dueDate: r.due_date,
      completedOn: r.completed_on, result: r.result, expiryDate: r.expiry_date,
      certificateDocumentId: r.certificate_document_id, providerReference: r.provider_reference,
      note: r.note,
    }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Completed training whose certification lapses inside the window. */
export async function expiringCertificates(
  tenantId: string, days = CERTIFICATE_EXPIRY_WINDOW_DAYS,
): Promise<TrainingEnrollment[]> {
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_training_enrollment")
    .select("id, employee_id, course_id, plan_id, status, planned_date, due_date, completed_on, result, expiry_date, certificate_document_id, provider_reference, note")
    .eq("tenant_id", tenantId)
    .eq("status", "COMPLETED")
    .not("expiry_date", "is", null)
    .gte("expiry_date", isoToday())
    .lte("expiry_date", isoInDays(days))
    .order("expiry_date");
  if (error) throw new Error(`[hr] expiring certificates read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, employeeId: r.employee_id, courseId: r.course_id, planId: r.plan_id,
    status: r.status as EnrollmentStatus, plannedDate: r.planned_date, dueDate: r.due_date,
    completedOn: r.completed_on, result: r.result, expiryDate: r.expiry_date,
    certificateDocumentId: r.certificate_document_id, providerReference: r.provider_reference,
    note: r.note,
  }));
}

export type TrainingCounts = {
  activeCourses: number;
  openEnrollments: number;
  overdue: number;
  mandatoryOverdue: number;
  completedThisPeriod: number;
  expiringSoon: number;
};

/**
 * `completedThisPeriod` is the CALENDAR YEAR TO DATE, and it is named
 * "this period" nowhere in the UI without that being said: an unqualified
 * "completed" figure invites the reader to invent the window themselves.
 */
export async function trainingCounts(tenantId: string): Promise<TrainingCounts> {
  const s = getAdminSupabaseClient();
  const head = { count: "exact" as const, head: true };
  const today = isoToday();
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [courses, open, overdue, completed, expiring, mandatoryOverdueRows] = await Promise.all([
    s.from("hr_training_course").select("id", head).eq("tenant_id", tenantId).eq("is_active", true),
    s.from("hr_training_enrollment").select("id", head).eq("tenant_id", tenantId)
      .in("status", ["PLANNED", "ENROLLED", "IN_PROGRESS"]),
    s.from("hr_training_enrollment").select("id", head).eq("tenant_id", tenantId)
      .in("status", ["PLANNED", "ENROLLED", "IN_PROGRESS"]).lt("due_date", today),
    s.from("hr_training_enrollment").select("id", head).eq("tenant_id", tenantId)
      .eq("status", "COMPLETED").gte("completed_on", yearStart),
    s.from("hr_training_enrollment").select("id", head).eq("tenant_id", tenantId)
      .eq("status", "COMPLETED").not("expiry_date", "is", null)
      .gte("expiry_date", today).lte("expiry_date", isoInDays(CERTIFICATE_EXPIRY_WINDOW_DAYS)),
    overdueTraining(tenantId, true),
  ]);

  return {
    activeCourses: courses.count ?? 0,
    openEnrollments: open.count ?? 0,
    overdue: overdue.count ?? 0,
    mandatoryOverdue: mandatoryOverdueRows.length,
    completedThisPeriod: completed.count ?? 0,
    expiringSoon: expiring.count ?? 0,
  };
}
