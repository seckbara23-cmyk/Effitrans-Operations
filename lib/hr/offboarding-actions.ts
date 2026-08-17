"use server";

/**
 * HR-8A — Offboarding actions. Gate: hr:manage (reads hr:read). DARK: no UI
 * calls these yet (HR-8B activates the « Départs » workspace).
 *
 * BOUNDARIES (governing audit docs/hr/hr-8-offboarding-audit.md):
 * - Offboarding ≠ termination (I-8.12): nothing here transitions the employee.
 * - Nothing here writes custody, contracts, documents, or app_user (I-8.1);
 *   the account step stays a PROMPT toward Administration → Utilisateurs.
 * - Event-mandatory writes go through the migration-111 RPCs (domain write +
 *   ledger event in ONE transaction, HR630 + INV-7 inside). The one plain
 *   write (cancellation) compensates on a failed emission, the HR-2 idiom.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";

export type HrOffboardingResult =
  | { ok: true; id?: string; promptAccountHandoff?: boolean }
  | { ok: false; error: string; detail?: string };

/** Postgres SQLSTATEs raised by the HR-8 RPCs → stable app error codes. */
const RPC_ERRORS: Record<string, string> = {
  HR630: "actor_invalid",
  HR801: "employee_not_found", HR802: "reason_required", HR803: "employee_not_offboardable",
  HR804: "template_invalid", HR805: "manager_invalid", HR806: "case_already_open",
  HR807: "invalid_status", HR808: "item_not_found", HR809: "evidence_required",
  HR810: "case_not_open", HR811: "case_not_found", HR812: "wrong_status",
  HR813: "employee_not_terminated", HR814: "equipment_outstanding", HR815: "blocking_items_pending",
  HR816: "evidence_not_eligible",
};
function mapRpcError(e: { code?: string; message?: string } | null): { error: string; detail?: string } {
  if (e?.message?.includes("EFA")) return { error: "forbidden_offboarding", detail: e?.message };
  const mapped = e?.code ? RPC_ERRORS[e.code] : undefined;
  return { error: mapped ?? "save_failed", detail: e?.message };
}

/** Open a departure case; the RPC snapshots the checklist and emits the event. */
export async function openOffboardingCase(input: {
  employeeId: string; reason: string; plannedDepartureDate?: string | null;
  templateId?: string | null; managerEmployeeId?: string | null;
}): Promise<HrOffboardingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_open_offboarding_case", {
    p_tenant: admin.tenantId, p_employee: input.employeeId, p_actor: admin.id,
    p_reason: input.reason,
    p_planned_date: input.plannedDepartureDate || null,
    p_template: input.templateId || null,
    p_manager: input.managerEmployeeId || null,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.offboarding.opened", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_offboarding_case", entityId: data, after: { employee_id: input.employeeId } });
  revalidatePath("/departments/hr");
  return { ok: true, id: data };
}

/** Item completion — RPC: item update + ledger event in one transaction. */
export async function completeOffboardingItem(input: {
  itemId: string; status: "DONE" | "NOT_APPLICABLE" | "PENDING";
  evidenceDocumentId?: string | null; comment?: string | null;
}): Promise<HrOffboardingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_complete_offboarding_item", {
    p_tenant: admin.tenantId, p_item: input.itemId, p_actor: admin.id,
    p_status: input.status,
    p_evidence: input.evidenceDocumentId || null,
    p_comment: input.comment || null,
  });
  if (error) return { ok: false, ...mapRpcError(error) };
  await writeAudit({ action: "hr.offboarding.item", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_offboarding_item", entityId: data, after: { status: input.status } });
  revalidatePath("/departments/hr");
  return { ok: true, id: data };
}

/**
 * Completion — the RPC re-derives the gates database-side (I-8.2): employee
 * TERMINATED, zero open custody, blocking items resolved. On success the
 * result signals whether the 8.1A account handoff is still pending, so the
 * caller can PROMPT (never perform) it — the promptRevocation idiom.
 */
export async function completeOffboardingCase(caseId: string): Promise<HrOffboardingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data, error } = await s.rpc("hr_complete_offboarding", {
    p_tenant: admin.tenantId, p_case: caseId, p_actor: admin.id,
  });
  if (error) return { ok: false, ...mapRpcError(error) };

  // Advisory only: is the linked login account still unarchived? (RQ-8.3 —
  // never blocks, never acted on here; Administration → Utilisateurs owns it.)
  let promptAccountHandoff = false;
  const { data: c } = await s.from("hr_offboarding_case").select("employee_id")
    .eq("id", caseId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (c) {
    const { data: emp } = await s.from("employee").select("linked_app_user_id")
      .eq("id", c.employee_id).eq("tenant_id", admin.tenantId).maybeSingle();
    if (emp?.linked_app_user_id) {
      const { data: account } = await s.from("app_user").select("status")
        .eq("tenant_id", admin.tenantId).eq("id", emp.linked_app_user_id).maybeSingle();
      promptAccountHandoff = (account?.status ?? "archived") !== "archived";
    }
  }
  await writeAudit({ action: "hr.offboarding.completed", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_offboarding_case", entityId: caseId });
  revalidatePath("/departments/hr");
  return { ok: true, id: data, ...(promptAccountHandoff ? { promptAccountHandoff: true } : {}) };
}

/** Governed cancellation — reason mandatory; the employee lifecycle is untouched. */
export async function cancelOffboardingCase(caseId: string, reason: string): Promise<HrOffboardingResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!reason.trim()) return { ok: false, error: "reason_required" };
  const s = getAdminSupabaseClient();
  const { data: c } = await s.from("hr_offboarding_case").select("id, employee_id, status")
    .eq("id", caseId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!c) return { ok: false, error: "case_not_found" };
  if (["COMPLETED", "CANCELLED"].includes(c.status)) return { ok: false, error: "wrong_status" };

  const { error } = await s.from("hr_offboarding_case")
    .update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: reason.trim() })
    .eq("id", caseId).eq("tenant_id", admin.tenantId).eq("status", c.status);
  if (error) return { ok: false, error: "save_failed" };

  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: c.employee_id,
    kind: "offboarding_case_cancelled", actorId: admin.id,
    payload: { case_id: caseId, reason: reason.trim() } });
  if (!emitted) {
    // MANDATORY-emission compensation (WES-9A): the cancellation is reverted.
    await s.from("hr_offboarding_case")
      .update({ status: c.status, cancelled_at: null, cancellation_reason: null })
      .eq("id", caseId).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.offboarding.cancelled", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_offboarding_case", entityId: caseId, after: { reason: reason.trim() } });
  revalidatePath("/departments/hr");
  return { ok: true, id: caseId };
}
