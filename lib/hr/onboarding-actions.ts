"use server";

/**
 * HR-4 — Onboarding & Equipment actions. Gate: hr:manage (reads hr:read).
 *
 * ADR-HR2-01 ASSESSED: HR-4's event-mandatory writes go through the
 * migration-76 RPCs, where the domain write and the ledger event share ONE
 * transaction. HR-4 therefore introduces NO new compensation logic. The
 * remaining plain writes (case creation, checklist instantiation, provisioning
 * bookkeeping) are single-row and are audited normally; case creation emits
 * through the same transactional discipline by writing its event via the RPC
 * path where an event is mandated.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";

export type HrOpsResult = { ok: true; id?: string } | { ok: false; error: string; detail?: string };

/** Postgres SQLSTATEs raised by the HR-4 RPCs → stable app error codes. */
const RPC_ERRORS: Record<string, string> = {
  HR401: "equipment_not_found", HR402: "employee_not_found", HR403: "already_assigned",
  HR404: "invalid_outcome", HR405: "assignment_not_found", HR406: "invalid_status",
  HR407: "item_not_found", HR408: "evidence_required", HR409: "case_not_found",
  HR410: "wrong_status", HR411: "blocking_items_pending",
  // Evidence parity with Départs (D-4): same semantic, each family's numbering.
  HR412: "evidence_not_eligible",
};
function mapRpcError(e: { code?: string; message?: string } | null): { error: string; detail?: string } {
  const mapped = e?.code ? RPC_ERRORS[e.code] : undefined;
  return { error: mapped ?? "save_failed", detail: e?.message };
}

// ---------------------------------------------------------------- onboarding

/** Create a case and instantiate its checklist from the chosen template. */
export async function createOnboardingCase(input: {
  employeeId: string; templateId?: string | null; plannedStartDate?: string | null;
  managerEmployeeId?: string | null; workLocationId?: string | null; positionId?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: emp } = await s.from("employee").select("id")
    .eq("id", input.employeeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!emp) return { ok: false, error: "employee_not_found" };

  const { data: created, error } = await s.from("hr_onboarding_case").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId,
    template_id: input.templateId || null,
    planned_start_date: input.plannedStartDate || null,
    manager_employee_id: input.managerEmployeeId || null,
    work_location_id: input.workLocationId || null,
    position_id: input.positionId || null,
    hr_officer_id: admin.id, created_by: admin.id,
  }).select("id").single();
  // The partial unique index refuses a second live case for the same employee.
  if (error || !created) {
    return { ok: false, error: error?.message.includes("uq_onboarding_live_case") ? "case_already_open" : "save_failed" };
  }

  // Instantiate the checklist — labels are SNAPSHOT, never a live reference.
  if (input.templateId) {
    const { data: items } = await s.from("hr_checklist_item_template").select("*")
      .eq("tenant_id", admin.tenantId).eq("template_id", input.templateId).order("position");
    if (items?.length) {
      const base = input.plannedStartDate ? new Date(input.plannedStartDate) : new Date();
      await s.from("hr_onboarding_item").insert(items.map((it) => {
        const due = new Date(base);
        due.setDate(due.getDate() + (it.due_offset_days ?? 0));
        return {
          tenant_id: admin.tenantId, case_id: created.id, item_template_id: it.id,
          position: it.position, label_fr: it.label_fr,
          responsible_function: it.responsible_function, is_required: it.is_required,
          is_blocking: it.is_blocking, evidence_required: it.evidence_required,
          due_date: due.toISOString().slice(0, 10),
        };
      }));
    }
  }

  const emitted = await emitHrEvent({
    tenantId: admin.tenantId, employeeId: input.employeeId, kind: "onboarding_created",
    actorId: admin.id, payload: { case_id: created.id, template_id: input.templateId ?? null },
  });
  if (!emitted) {
    await s.from("hr_onboarding_case").delete().eq("id", created.id).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.onboarding.created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_onboarding_case", entityId: created.id, after: { employee_id: input.employeeId } });
  revalidatePath("/departments/hr/onboarding");
  revalidatePath(`/departments/hr/${input.employeeId}`);
  return { ok: true, id: created.id };
}

/** DRAFT → READY → IN_PROGRESS. Governed; no free transitions. */
export async function advanceOnboardingCase(caseId: string, to: "READY" | "IN_PROGRESS"): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const allowedFrom: Record<string, string> = { READY: "DRAFT", IN_PROGRESS: "READY" };
  const s = getAdminSupabaseClient();
  const { data: c } = await s.from("hr_onboarding_case").select("id, employee_id, status")
    .eq("id", caseId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!c) return { ok: false, error: "case_not_found" };
  if (c.status !== allowedFrom[to]) return { ok: false, error: "wrong_status" };

  const { error } = await s.from("hr_onboarding_case").update(
    to === "IN_PROGRESS"
      ? { status: to, actual_start_date: new Date().toISOString().slice(0, 10) }
      : { status: to })
    .eq("id", caseId).eq("tenant_id", admin.tenantId).eq("status", allowedFrom[to]);
  if (error) return { ok: false, error: "save_failed" };

  if (to === "IN_PROGRESS") {
    const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: c.employee_id,
      kind: "onboarding_started", actorId: admin.id, payload: { case_id: caseId } });
    if (!emitted) {
      await s.from("hr_onboarding_case").update({ status: c.status, actual_start_date: null })
        .eq("id", caseId).eq("tenant_id", admin.tenantId);
      return { ok: false, error: "event_failed" };
    }
  }
  await writeAudit({ action: `hr.onboarding.${to.toLowerCase()}`, actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_onboarding_case", entityId: caseId, before: { status: c.status }, after: { status: to } });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: caseId };
}

/** Item completion — RPC: item update + ledger event in one transaction. */
export async function completeOnboardingItem(input: {
  itemId: string; status: "DONE" | "NOT_APPLICABLE" | "PENDING";
  evidenceDocumentId?: string | null; comment?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_complete_onboarding_item", {
    p_tenant: admin.tenantId, p_item: input.itemId, p_actor: admin.id,
    p_status: input.status, p_evidence: input.evidenceDocumentId || null,
    p_comment: input.comment || null,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.onboarding.item_completed", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_onboarding_item", entityId: input.itemId, after: { status: input.status } });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: input.itemId };
}

/** Completion gate lives in the RPC: blocking items raise HR411 with the list. */
export async function completeOnboardingCase(caseId: string): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_complete_onboarding", {
    p_tenant: admin.tenantId, p_case: caseId, p_actor: admin.id,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.onboarding.completed", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_onboarding_case", entityId: caseId });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: caseId };
}

export async function cancelOnboardingCase(caseId: string, reason: string): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { data: c } = await s.from("hr_onboarding_case").select("id, employee_id, status")
    .eq("id", caseId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!c) return { ok: false, error: "case_not_found" };
  if (["COMPLETED", "CANCELLED"].includes(c.status)) return { ok: false, error: "wrong_status" };

  const { error } = await s.from("hr_onboarding_case")
    .update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: reason.trim() })
    .eq("id", caseId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: c.employee_id,
    kind: "onboarding_cancelled", actorId: admin.id, payload: { case_id: caseId, reason: reason.trim() } });
  if (!emitted) {
    await s.from("hr_onboarding_case").update({ status: c.status, cancelled_at: null, cancellation_reason: null })
      .eq("id", caseId).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.onboarding.cancelled", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_onboarding_case", entityId: caseId, after: { reason: reason.trim() } });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: caseId };
}

/** Provisioning tracking — references identity, never creates it. */
export async function requestProvisioning(input: { caseId: string; kind: string; note?: string | null }): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_provisioning_request").insert({
    tenant_id: admin.tenantId, case_id: input.caseId, kind: input.kind,
    note: input.note || null, requested_by: admin.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.provisioning.requested", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_provisioning_request", entityId: data.id, after: { kind: input.kind } });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: data.id };
}

export async function resolveProvisioning(input: {
  requestId: string; status: "COMPLETED" | "REJECTED"; linkedAppUserId?: string | null; note?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.from("hr_provisioning_request").update({
    status: input.status, linked_app_user_id: input.linkedAppUserId || null,
    note: input.note || null, completed_by: admin.id, completed_at: new Date().toISOString(),
  }).eq("id", input.requestId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.provisioning.resolved", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_provisioning_request", entityId: input.requestId, after: { status: input.status } });
  revalidatePath("/departments/hr/onboarding");
  return { ok: true, id: input.requestId };
}

// ---------------------------------------------------------------- equipment

export async function createEquipment(input: {
  equipmentTypeId: string; assetTag: string; serialNumber?: string | null;
  description?: string | null; condition?: string; ownershipSource?: string; acquisitionDate?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const tag = input.assetTag.trim();
  if (!tag) return { ok: false, error: "asset_tag_required" };
  const s = getAdminSupabaseClient();
  const { data, error } = await s.from("hr_equipment").insert({
    tenant_id: admin.tenantId, equipment_type_id: input.equipmentTypeId, asset_tag: tag,
    serial_number: input.serialNumber?.trim() || null, description: input.description?.trim() || null,
    condition: input.condition || "GOOD", ownership_source: input.ownershipSource || "COMPANY_OWNED",
    acquisition_date: input.acquisitionDate || null,
  }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message.includes("duplicate") ? "asset_tag_taken" : "save_failed" };
  await writeAudit({ action: "hr.equipment.created", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_equipment", entityId: data.id, after: { asset_tag: tag } });
  revalidatePath("/departments/hr/equipement");
  return { ok: true, id: data.id };
}

/** Assign — RPC: custody row + equipment status + ledger event, one transaction. */
export async function assignEquipment(input: {
  equipmentId: string; employeeId: string; expectedReturnDate?: string | null;
  conditionAtIssue?: string | null; note?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_assign_equipment", {
    p_tenant: admin.tenantId, p_equipment: input.equipmentId, p_employee: input.employeeId,
    p_actor: admin.id, p_expected_return: input.expectedReturnDate || null,
    p_condition: input.conditionAtIssue || null, p_note: input.note || null,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.equipment.assigned", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_equipment_assignment", entityId: String(data),
    after: { equipment_id: input.equipmentId, employee_id: input.employeeId } });
  revalidatePath("/departments/hr/equipement");
  revalidatePath(`/departments/hr/${input.employeeId}`);
  return { ok: true, id: String(data) };
}

/** Return — RPC: closes custody, sets equipment state, emits, one transaction. */
export async function returnEquipment(input: {
  assignmentId: string; outcome: "RETURNED" | "DAMAGED" | "LOST" | "NOT_RETURNED";
  conditionAtReturn?: string | null; note?: string | null;
}): Promise<HrOpsResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { error } = await s.rpc("hr_return_equipment", {
    p_tenant: admin.tenantId, p_assignment: input.assignmentId, p_actor: admin.id,
    p_outcome: input.outcome, p_condition: input.conditionAtReturn || null, p_note: input.note || null,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.equipment.returned", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_equipment_assignment", entityId: input.assignmentId, after: { outcome: input.outcome } });
  revalidatePath("/departments/hr/equipement");
  return { ok: true, id: input.assignmentId };
}
