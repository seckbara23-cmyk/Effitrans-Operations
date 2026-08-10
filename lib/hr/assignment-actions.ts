"use server";

/**
 * HR-2 — the Assignment Engine. SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * History by APPEND-AND-CLOSE, never overwrite: a change closes the open
 * PRIMARY row (effective_to = today) and inserts a new open row. The partial
 * unique index (migration 73) makes "one open PRIMARY per employee" a database
 * invariant, not a convention. Historical rows are never edited or deleted —
 * there is deliberately no update/delete action in this module.
 *
 * Ledger emission is MANDATORY (WES-9A discipline via compensation): if the
 * event append fails, the new assignment is deleted and the previous one
 * reopened — the change never happened. Audit is written after both succeed.
 *
 * The business meaning of a change (promotion / transfer / correction) is the
 * ACTOR's declaration, not an inference — it travels in the ledger payload.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";
import { validateAssignmentTargets } from "./assignment-core";

export type AssignmentChangeKind = "PROMOTION" | "TRANSFER" | "CHANGE";
export type HrActionResult = { ok: true; id?: string } | { ok: false; error: string };

export async function setEmployeeAssignment(
  employeeId: string,
  input: {
    orgUnitId?: string | null;
    positionId?: string | null;
    workLocationId?: string | null;
    managerEmployeeId?: string | null;
    changeKind: AssignmentChangeKind;
    note?: string | null;
  },
): Promise<HrActionResult> {
  let admin;
  try {
    admin = await assertPermission("hr:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (input.managerEmployeeId === employeeId) return { ok: false, error: "own_manager" };
  if (!["PROMOTION", "TRANSFER", "CHANGE"].includes(input.changeKind)) return { ok: false, error: "invalid_kind" };

  const supabase = getAdminSupabaseClient();
  const { data: employee } = await supabase
    .from("employee")
    .select("id, status")
    .eq("id", employeeId)
    .eq("tenant_id", admin.tenantId)
    .maybeSingle();
  if (!employee) return { ok: false, error: "not_found" };
  if (employee.status === "ARCHIVED") return { ok: false, error: "employee_archived" };

  // HR-A2 — every referenced target must belong to THIS tenant and be active.
  // The FK alone accepts a cross-tenant id; this action is the write path, so
  // this check is the boundary (see assignment-core.ts).
  const targetError = await validateAssignmentTargets(admin.tenantId, {
    orgUnitId: input.orgUnitId,
    positionId: input.positionId,
    workLocationId: input.workLocationId,
    managerEmployeeId: input.managerEmployeeId,
  });
  if (targetError) return { ok: false, error: targetError };

  // The open PRIMARY row, if any — closed, never edited beyond its end date.
  const { data: open } = await supabase
    .from("employee_assignment")
    .select("id, org_unit_id, position_id, work_location_id, manager_employee_id")
    .eq("tenant_id", admin.tenantId)
    .eq("employee_id", employeeId)
    .eq("assignment_kind", "PRIMARY")
    .is("effective_to", null)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  if (open) {
    const { error } = await supabase
      .from("employee_assignment")
      .update({ effective_to: today })
      .eq("id", open.id)
      .eq("tenant_id", admin.tenantId);
    if (error) return { ok: false, error: "save_failed" };
  }

  const { data: created, error: insErr } = await supabase
    .from("employee_assignment")
    .insert({
      tenant_id: admin.tenantId,
      employee_id: employeeId,
      org_unit_id: input.orgUnitId || null,
      position_id: input.positionId || null,
      work_location_id: input.workLocationId || null,
      manager_employee_id: input.managerEmployeeId || null,
      assignment_kind: "PRIMARY",
      effective_from: today,
      note: input.note?.trim() || null,
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    // Reopen what we closed — the change never happened.
    if (open) await supabase.from("employee_assignment").update({ effective_to: null }).eq("id", open.id);
    return { ok: false, error: "save_failed" };
  }

  // MANDATORY ledger emission — on failure, compensate fully and abort.
  const emitted = await emitHrEvent({
    tenantId: admin.tenantId,
    employeeId,
    kind: "assignment_changed",
    actorId: admin.id,
    payload: {
      change_kind: input.changeKind,
      from: open
        ? { org_unit_id: open.org_unit_id, position_id: open.position_id, work_location_id: open.work_location_id, manager_employee_id: open.manager_employee_id }
        : null,
      to: { org_unit_id: input.orgUnitId ?? null, position_id: input.positionId ?? null, work_location_id: input.workLocationId ?? null, manager_employee_id: input.managerEmployeeId ?? null },
    },
  });
  if (!emitted) {
    await supabase.from("employee_assignment").delete().eq("id", created.id).eq("tenant_id", admin.tenantId);
    if (open) await supabase.from("employee_assignment").update({ effective_to: null }).eq("id", open.id);
    return { ok: false, error: "event_failed" };
  }

  await writeAudit({
    action: "hr.assignment.changed",
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "employee_assignment",
    entityId: created.id,
    after: { employee_id: employeeId, change_kind: input.changeKind, closed_previous: open?.id ?? null },
  });
  revalidatePath(`/departments/hr/${employeeId}`);
  return { ok: true, id: created.id };
}
