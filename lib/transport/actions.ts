"use server";

/**
 * Transport server actions (Phase 1.10). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gate on permission, verify dossier visibility, write via the service-role
 * admin client, audit, revalidate. PICKED_UP enforces the customs gate; DELIVERED
 * /POD_RECEIVED require transport:complete; POD_RECEIVED enforces the approved-POD
 * gate. Soft-delete via deleted_at; CANCELLED is the normal workflow abort.
 */
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/db/types";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { onPodReceived } from "@/lib/handoffs/triggers";
import { custTransportStarted, custDelivered } from "@/lib/customer-notify/triggers";
import { canPickup, canReceivePod } from "./gates";
import { canTransition, isTransportStatus } from "./status";
import {
  TRANSPORT_ASSIGNMENT_FIELDS,
  TRANSPORT_PLANNING_FIELDS,
  buildTransportPatch,
  clearFieldsAreValid,
  isEmptyPatch,
} from "./patch";
import type { ActionResult, TransportAssignment, TransportInput, TransportStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

/**
 * WES-1C — transport states whose evidence must never be lost to an ordinary
 * delete. Delivery and POD are completion facts: once recorded, removing the
 * record would make the lifecycle projection read the department as never
 * started. No override path exists in this phase (WES-1 builds no new override
 * system): these records are simply non-deletable.
 */
const DELETE_PROTECTED_STATUSES: readonly TransportStatus[] = ["DELIVERED", "POD_RECEIVED"];

async function loadTransport(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("transport_record")
    .select("id, file_id, status, customs_override, updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

/**
 * WES-1B — optimistic concurrency over the EXISTING `updated_at` column
 * (maintained by trg_transport_updated_at). Reuses the engine's compare-and-set
 * shape exactly: constrain the UPDATE on the value the caller loaded, then check
 * the affected row count. A second writer who loaded an older row matches zero
 * rows and is refused — no silent last-write-wins, no merge, no retry.
 *
 * The token is passed back VERBATIM as read from the database; it must never be
 * re-formatted, or the microsecond precision stops matching.
 */
type TransportPatch = Database["public"]["Tables"]["transport_record"]["Update"];

async function casUpdate(
  supabase: Admin,
  id: string,
  tenantId: string,
  expectedUpdatedAt: string,
  patch: TransportPatch,
): Promise<"ok" | "stale"> {
  const { data, error } = await supabase
    .from("transport_record")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");
  if (error) return "stale";
  return (data?.length ?? 0) === 1 ? "ok" : "stale";
}

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/transport");
}

async function approvedDocCodes(supabase: Admin, tenantId: string, fileId: string): Promise<string[]> {
  const { data } = await supabase
    .from("document")
    .select("type_code, status")
    .eq("tenant_id", tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null);
  return (data ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code);
}

async function customsGate(supabase: Admin, fileId: string) {
  const { data: file } = await supabase
    .from("operational_file")
    .select("type")
    .eq("id", fileId)
    .maybeSingle();
  const { data: customs } = await supabase
    .from("customs_record")
    .select("status, required")
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle();
  return {
    fileType: (file?.type as string) ?? "",
    customs: customs ? { required: customs.required, status: customs.status } : null,
  };
}

export async function createTransport(fileId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.tenant_id !== user.tenantId) return { ok: false, error: "file_not_found" };

  const { data: existing } = await supabase
    .from("transport_record")
    .select("id, deleted_at")
    .eq("file_id", fileId)
    .maybeSingle();
  if (existing) {
    if (!existing.deleted_at) return { ok: false, error: "already_exists" };
    // WES-1C — revival RESTORES the record; it never rewrites history. The row's
    // status, pickup/delivery timestamps and POD reference are all still present
    // (a soft delete never cleared them), so clearing deleted_at is the whole
    // operation. Resetting to NOT_STARTED here is what made a delivered dossier
    // read as never started in every lifecycle projection.
    const { error } = await supabase
      .from("transport_record")
      .update({ deleted_at: null })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    await writeAudit({
      action: AuditActions.TRANSPORT_CREATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "transport_record",
      entityId: existing.id,
      after: { file_id: fileId },
    });
    revalidate(fileId);
    return { ok: true, id: existing.id };
  }

  const { data, error } = await supabase
    .from("transport_record")
    .insert({ tenant_id: user.tenantId, file_id: fileId, status: "NOT_STARTED", created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.TRANSPORT_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: data.id,
    after: { file_id: fileId },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

/**
 * Update the planning fields. PARTIAL PATCH (WES-1A): an omitted or empty field
 * is preserved, and only a field named in `clearFields` is ever written null.
 * Compare-and-set on `expectedUpdatedAt` (WES-1B).
 */
export async function updateTransport(
  id: string,
  input: TransportInput,
  expectedUpdatedAt: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!expectedUpdatedAt) return { ok: false, error: "stale_write" };
  if (!clearFieldsAreValid(input.clearFields, TRANSPORT_PLANNING_FIELDS)) {
    return { ok: false, error: "invalid_clear_field" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const patch = buildTransportPatch(input, TRANSPORT_PLANNING_FIELDS, input.clearFields) as TransportPatch;
  if (input.customsOverride !== undefined) patch.customs_override = input.customsOverride;
  // Nothing to write — succeed without touching the row or the audit log.
  if (isEmptyPatch(patch)) return { ok: true, id };

  if ((await casUpdate(supabase, id, user.tenantId, expectedUpdatedAt, patch)) === "stale") {
    return { ok: false, error: "stale_write" }; // rejected -> no success audit
  }

  await writeAudit({
    action: AuditActions.TRANSPORT_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
    after: { fields: Object.keys(patch) },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * Assign driver/vehicle DISPLAY fields. PARTIAL PATCH + compare-and-set, same
 * contract as updateTransport.
 *
 * NOTE (WES-1E): these are display fields. The AUTHORITATIVE chauffeur link is
 * `driver_user_id`, written by assignDriverUser — a free-text name never makes a
 * chauffeur reachable by the driver portal.
 */
export async function assignTransport(
  id: string,
  a: TransportAssignment,
  expectedUpdatedAt: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!expectedUpdatedAt) return { ok: false, error: "stale_write" };
  if (!clearFieldsAreValid(a.clearFields, TRANSPORT_ASSIGNMENT_FIELDS)) {
    return { ok: false, error: "invalid_clear_field" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const patch = buildTransportPatch(a, TRANSPORT_ASSIGNMENT_FIELDS, a.clearFields) as TransportPatch;
  if (isEmptyPatch(patch)) return { ok: true, id };
  patch.assigned_by = user.id;

  if ((await casUpdate(supabase, id, user.tenantId, expectedUpdatedAt, patch)) === "stale") {
    return { ok: false, error: "stale_write" }; // rejected -> no success audit
  }

  await writeAudit({
    action: AuditActions.TRANSPORT_ASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
    after: { fields: Object.keys(patch).filter((k) => k !== "assigned_by") },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function changeTransportStatus(id: string, toStatus: string): Promise<ActionResult> {
  if (!isTransportStatus(toStatus)) return { ok: false, error: "invalid_status" };
  // DELIVERED / POD_RECEIVED are completion steps; others are ordinary updates.
  const permission =
    toStatus === "DELIVERED" || toStatus === "POD_RECEIVED" ? "transport:complete" : "transport:update";

  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const from = rec.status as TransportStatus;
  if (!canTransition(from, toStatus)) return { ok: false, error: "invalid_transition" };

  // Customs gate: goods can't be picked up before BAE for required IMP/EXP.
  if (toStatus === "PICKED_UP") {
    const { fileType, customs } = await customsGate(supabase, rec.file_id);
    if (!canPickup(fileType, customs, rec.customs_override)) {
      return { ok: false, error: "customs_not_released" };
    }
  }
  // POD gate: POD_RECEIVED needs an APPROVED Delivery Note.
  if (toStatus === "POD_RECEIVED") {
    const approved = await approvedDocCodes(supabase, user.tenantId, rec.file_id);
    if (!canReceivePod(approved)) return { ok: false, error: "pod_required" };
  }

  const patch: { status: string; pickup_actual?: string; delivery_actual?: string } = { status: toStatus };
  const now = new Date().toISOString();
  if (toStatus === "PICKED_UP") patch.pickup_actual = now;
  if (toStatus === "DELIVERED") patch.delivery_actual = now;

  const { error } = await supabase
    .from("transport_record")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  const action =
    toStatus === "PICKED_UP"
      ? AuditActions.TRANSPORT_PICKED_UP
      : toStatus === "DELIVERED"
        ? AuditActions.TRANSPORT_DELIVERED
        : toStatus === "POD_RECEIVED"
          ? AuditActions.TRANSPORT_POD_RECEIVED
          : toStatus === "CANCELLED"
            ? AuditActions.TRANSPORT_CANCELLED
            : AuditActions.TRANSPORT_STATUS_CHANGED;
  await writeAudit({
    action,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
    before: { status: from },
    after: { status: toStatus },
  });
  const tctx = { tenantId: user.tenantId, actorId: user.id };
  // Phase 2.1 — Transport → Finance handoff once the POD is received.
  if (toStatus === "POD_RECEIVED") {
    await onPodReceived(supabase, tctx, rec.file_id);
  }
  // Phase 2.5 — customer transport notifications (idempotent, once per dossier).
  if (toStatus === "IN_TRANSIT") await custTransportStarted(supabase, tctx, rec.file_id);
  if (toStatus === "DELIVERED" || toStatus === "POD_RECEIVED") await custDelivered(supabase, tctx, rec.file_id);
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function deleteTransport(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };
  // WES-1C — a completed transport carries delivery/POD evidence. Deleting it
  // would erase that from every projection; there is no ordinary path to do so.
  if (DELETE_PROTECTED_STATUSES.includes(rec.status as TransportStatus)) {
    return { ok: false, error: "protected_completed" };
  }

  const { error } = await supabase
    .from("transport_record")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_DELETED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
    before: { status: rec.status },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}
