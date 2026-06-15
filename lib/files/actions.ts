"use server";

/**
 * Operational File server actions (Phase 1.2). SERVER ACTIONS / SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors Client Management: each action gates on a permission, scopes to the
 * caller's tenant, writes via the service-role admin client, audits, and
 * revalidates. The file number is minted atomically via next_file_number()
 * (DEC-B06). Archive (file:delete) is reserved for the POD/document module.
 *
 * No customs / documents / transport module / finance / invoices.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { validateFile } from "./validate";
import { canTransition, isFileStatus } from "./status";
import { canCloseFile } from "@/lib/customs/gates";
import type { ActionResult, FileInput, FileStatus, ShipmentInput } from "./types";

function shipmentRow(tenantId: string, fileId: string, s: ShipmentInput | undefined) {
  return {
    tenant_id: tenantId,
    file_id: fileId,
    transport_mode: s?.transportMode ?? null,
    incoterm: s?.incoterm?.trim() || null,
    origin: s?.origin?.trim() || null,
    destination: s?.destination?.trim() || null,
    cargo_type: s?.cargoType?.trim() || null,
    carrier_name: s?.carrierName?.trim() || null,
    vessel_or_flight: s?.vesselOrFlight?.trim() || null,
    bl_awb_ref: s?.blAwbRef?.trim() || null,
    container_ref: s?.containerRef?.trim() || null,
  };
}

export async function createFile(input: FileInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateFile(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();

  // Atomic, concurrency-safe number (per tenant x type x year).
  const { data: fileNumber, error: numErr } = await supabase.rpc("next_file_number", {
    p_tenant: admin.tenantId,
    p_type: input.type,
  });
  if (numErr || !fileNumber) return { ok: false, error: numErr?.message ?? "numbering_failed" };

  const { data, error } = await supabase
    .from("operational_file")
    .insert({
      tenant_id: admin.tenantId,
      file_number: fileNumber,
      type: input.type,
      client_id: input.clientId,
      account_manager_id: admin.id,
      status: "DRAFT",
      priority: input.priority ?? "normal",
      created_by: admin.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  // 1:1 shipment detail (always created; carries transport data when relevant).
  const { error: shipErr } = await supabase
    .from("shipment")
    .insert(shipmentRow(admin.tenantId, data.id, input.shipment));
  if (shipErr) return { ok: false, error: shipErr.message };

  await writeAudit({
    action: AuditActions.FILE_CREATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: data.id,
    after: { file_number: fileNumber, type: input.type, client_id: input.clientId },
  });

  revalidatePath("/files");
  return { ok: true, id: data.id };
}

export async function updateFile(id: string, input: FileInput): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const invalid = validateFile(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = getAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("operational_file")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const { error } = await supabase
    .from("operational_file")
    .update({ type: input.type, client_id: input.clientId, priority: input.priority ?? "normal" })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  // Upsert the 1:1 shipment row.
  const { error: shipErr } = await supabase
    .from("shipment")
    .upsert(shipmentRow(admin.tenantId, id, input.shipment), { onConflict: "file_id" });
  if (shipErr) return { ok: false, error: shipErr.message };

  await writeAudit({
    action: AuditActions.FILE_UPDATED,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    after: { type: input.type, client_id: input.clientId },
  });

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}

export async function transitionFile(id: string, toStatus: string): Promise<ActionResult> {
  let admin;
  try {
    admin = await assertPermission("file:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!isFileStatus(toStatus)) return { ok: false, error: "invalid_status" };

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, status, type")
    .eq("id", id)
    .maybeSingle();
  if (!file || file.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const fromStatus = file.status as FileStatus;
  if (!canTransition(fromStatus, toStatus)) return { ok: false, error: "invalid_transition" };

  // Phase 1.9 close guard: an IMP/EXP dossier with a REQUIRED customs record
  // that isn't RELEASED/CANCELLED cannot be closed (customs.required is the
  // escape hatch). No record / non-IMP-EXP / required=false => allowed.
  if (toStatus === "CLOSED") {
    const { data: customs } = await supabase
      .from("customs_record")
      .select("status, required")
      .eq("file_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!canCloseFile(file.type as string, customs ? { status: customs.status, required: customs.required } : null)) {
      return { ok: false, error: "customs_not_released" };
    }
  }

  const patch: { status: string; opened_at?: string } = { status: toStatus };
  if (toStatus === "OPENED") patch.opened_at = new Date().toISOString();

  const { error } = await supabase
    .from("operational_file")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message };

  const { error: histErr } = await supabase.from("file_state_transition").insert({
    tenant_id: admin.tenantId,
    file_id: id,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: admin.id,
  });
  if (histErr) return { ok: false, error: histErr.message };

  await writeAudit({
    action: AuditActions.FILE_TRANSITION,
    actorId: admin.id,
    tenantId: admin.tenantId,
    entity: "operational_file",
    entityId: id,
    before: { status: fromStatus },
    after: { status: toStatus },
  });

  revalidatePath("/files");
  revalidatePath(`/files/${id}`);
  return { ok: true, id };
}
