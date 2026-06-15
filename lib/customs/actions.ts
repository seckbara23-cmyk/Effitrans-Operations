"use server";

/**
 * Customs server actions (Phase 1.9). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gate on permission, verify dossier visibility, write via the service-role
 * admin client, audit, revalidate. Manual reference tracking only (no GAINDE/
 * Orbus). Release is a privileged step (customs:release) requiring a BAE ref.
 * Soft-delete via deleted_at; CANCELLED is the normal workflow abort.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { canDeclare, canRelease, requiredCustomsDocCodes } from "./gates";
import { canTransition, isCustomsStatus } from "./status";
import type { ActionResult, CustomsInput, CustomsStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadCustoms(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("customs_record")
    .select("id, file_id, status, required, bae_reference, declaration_number, declaration_date")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

function revalidate(fileId: string) {
  revalidatePath(`/files/${fileId}`);
  revalidatePath("/customs");
}

/** Codes of customs-prerequisite documents still missing (admin, no extra gate). */
async function missingCustomsDocCodes(
  supabase: Admin,
  tenantId: string,
  fileId: string,
): Promise<string[]> {
  const [gating, shipment, docs] = await Promise.all([
    supabase.from("document_type").select("code").eq("active", true).eq("gates_customs", true),
    supabase.from("shipment").select("transport_mode").eq("file_id", fileId).maybeSingle(),
    supabase
      .from("document")
      .select("type_code, status")
      .eq("tenant_id", tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null),
  ]);
  const mode = (shipment.data?.transport_mode as string | null) ?? null;
  const required = requiredCustomsDocCodes((gating.data ?? []).map((g) => g.code), mode);
  const approved = new Set(
    (docs.data ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code),
  );
  return required.filter((c) => !approved.has(c));
}

export async function createCustoms(fileId: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  const supabase = getAdminSupabaseClient();
  const { data: file } = await supabase
    .from("operational_file")
    .select("id, tenant_id, type")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.tenant_id !== user.tenantId) return { ok: false, error: "file_not_found" };

  const required = file.type === "IMP" || file.type === "EXP";

  // 1:1: revive a soft-deleted record, else reject a live duplicate.
  const { data: existing } = await supabase
    .from("customs_record")
    .select("id, deleted_at")
    .eq("file_id", fileId)
    .maybeSingle();
  if (existing) {
    if (!existing.deleted_at) return { ok: false, error: "already_exists" };
    const { error } = await supabase
      .from("customs_record")
      .update({ deleted_at: null, status: "NOT_STARTED", required })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    await writeAudit({
      action: AuditActions.CUSTOMS_CREATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "customs_record",
      entityId: existing.id,
      after: { file_id: fileId },
    });
    revalidate(fileId);
    return { ok: true, id: existing.id };
  }

  const { data, error } = await supabase
    .from("customs_record")
    .insert({ tenant_id: user.tenantId, file_id: fileId, status: "NOT_STARTED", required, created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: data.id,
    after: { file_id: fileId },
  });
  revalidate(fileId);
  return { ok: true, id: data.id };
}

export async function updateCustoms(id: string, input: CustomsInput): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("customs_record")
    .update({
      declaration_number: input.declarationNumber?.trim() || null,
      customs_office: input.customsOffice?.trim() || null,
      regime: input.regime?.trim() || null,
      declaration_date: input.declarationDate || null,
      inspection_status: input.inspectionStatus ?? "NOT_REQUIRED",
      external_ref: input.externalRef?.trim() || null,
      notes: input.notes?.trim() || null,
      ...(input.required === undefined ? {} : { required: input.required }),
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function changeCustomsStatus(id: string, toStatus: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isCustomsStatus(toStatus)) return { ok: false, error: "invalid_status" };
  if (toStatus === "RELEASED") return { ok: false, error: "use_release" }; // privileged path

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const from = rec.status as CustomsStatus;
  if (!canTransition(from, toStatus)) return { ok: false, error: "invalid_transition" };

  // Gate: a declaration can be filed only when no prerequisite document is missing.
  if (toStatus === "DECLARED") {
    const missing = await missingCustomsDocCodes(supabase, user.tenantId, rec.file_id);
    if (!canDeclare(missing)) return { ok: false, error: "customs_docs_missing" };
  }

  const patch: { status: string; declaration_date?: string } = { status: toStatus };
  if (toStatus === "DECLARED" && !rec.declaration_date) {
    patch.declaration_date = new Date().toISOString().slice(0, 10);
  }

  const { error } = await supabase
    .from("customs_record")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  const action =
    toStatus === "DECLARED"
      ? AuditActions.CUSTOMS_DECLARED
      : toStatus === "BLOCKED"
        ? AuditActions.CUSTOMS_BLOCKED
        : AuditActions.CUSTOMS_STATUS_CHANGED;
  await writeAudit({
    action,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: from },
    after: { status: toStatus },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function releaseCustoms(id: string, baeReference: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:release");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!canRelease({ baeReference })) return { ok: false, error: "bae_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };
  if (!canTransition(rec.status as CustomsStatus, "RELEASED")) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("customs_record")
    .update({
      status: "RELEASED",
      bae_reference: baeReference.trim(),
      release_date: new Date().toISOString().slice(0, 10),
      reviewed_by: user.id,
    })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.CUSTOMS_RELEASED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: rec.status },
    after: { status: "RELEASED", bae_reference: baeReference.trim() },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

export async function deleteCustoms(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("customs_record")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.CUSTOMS_DELETED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: rec.status },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}
