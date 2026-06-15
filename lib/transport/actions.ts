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
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { canPickup, canReceivePod } from "./gates";
import { canTransition, isTransportStatus } from "./status";
import type { ActionResult, TransportAssignment, TransportInput, TransportStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadTransport(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("transport_record")
    .select("id, file_id, status, customs_override")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
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
    const { error } = await supabase
      .from("transport_record")
      .update({ deleted_at: null, status: "NOT_STARTED" })
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

export async function updateTransport(id: string, input: TransportInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("transport_record")
    .update({
      pickup_location: input.pickupLocation?.trim() || null,
      delivery_location: input.deliveryLocation?.trim() || null,
      pickup_planned: input.pickupPlanned || null,
      delivery_planned: input.deliveryPlanned || null,
      transport_company: input.transportCompany?.trim() || null,
      delivery_reference: input.deliveryReference?.trim() || null,
      notes: input.notes?.trim() || null,
      ...(input.customsOverride === undefined ? {} : { customs_override: input.customsOverride }),
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function assignTransport(id: string, a: TransportAssignment): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("transport:assign");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadTransport(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("transport_record")
    .update({
      driver_name: a.driverName?.trim() || null,
      driver_phone: a.driverPhone?.trim() || null,
      vehicle_plate: a.vehiclePlate?.trim() || null,
      trailer_or_container: a.trailerOrContainer?.trim() || null,
      assigned_by: user.id,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.TRANSPORT_ASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "transport_record",
    entityId: id,
    after: { driver_name: a.driverName ?? null, vehicle_plate: a.vehiclePlate ?? null },
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
