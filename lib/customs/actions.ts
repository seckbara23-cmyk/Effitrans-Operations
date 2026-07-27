"use server";

/**
 * Customs server actions (Phase 1.9). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Gate on permission, verify dossier visibility, write via the service-role
 * admin client, audit, revalidate. Manual reference tracking only (no GAINDE/
 * Orbus). Release is a privileged step (customs:release) requiring a BAE ref.
 * Soft-delete via deleted_at; CANCELLED is the normal workflow abort.
 */
import { reconcileDossierProcess } from "@/lib/process/reconcile/service";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { onCustomsReleased } from "@/lib/handoffs/triggers";
import { custCustomsCleared } from "@/lib/customer-notify/triggers";
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
    // WES-1C — revival RESTORES the record; it never rewrites history. A soft
    // delete never cleared the status, bae_reference, declaration or release
    // date, so clearing deleted_at is the whole operation. Resetting to
    // NOT_STARTED here silently discarded a released dossier's BAE evidence as
    // far as every lifecycle projection was concerned.
    const { error } = await supabase
      .from("customs_record")
      .update({ deleted_at: null })
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

/**
 * WES-4E step 1 — RECORD the BAE reference.
 *
 * This is not a release and not a verification. Before WES-4 there was no way
 * to say "the BAE arrived" without simultaneously declaring the goods
 * released: `releaseCustoms` recorded the reference, set RELEASED, stamped the
 * reviewer, fired the Transport handoff and notified the customer, in one call
 * by one person holding one permission.
 *
 * Recording is the Declarant's action. The official evidence is uploaded
 * separately as a BAE document and verified by someone else.
 */
export async function recordBaeReference(
  id: string,
  baeReference: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("customs:update");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!baeReference.trim()) return { ok: false, error: "bae_required" };

  const supabase = getAdminSupabaseClient();
  const rec = await loadCustoms(supabase, id, user.tenantId);
  if (!rec) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  const { error } = await supabase.rpc("record_bae_reference", {
    p_customs_id: id,
    p_bae_reference: baeReference.trim(),
    p_actor: user.id,
  });
  if (error) return { ok: false, error: "record_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    after: { bae_reference: baeReference.trim() },
  });
  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * WES-4E step 5 — RECORD the operational customs release (« mainlevée
 * constatée »).
 *
 * A fact Effitrans OBSERVES. Effitrans does not approve Customs and the
 * wording never says it does.
 *
 * What this action does NOT do, deliberately:
 *   * it does not verify the BAE evidence — that is `verifyDocument` on the
 *     BAE document, by someone other than whoever recorded it;
 *   * it does not complete or advance any official process-engine step — WES-5
 *     owns that reconciliation, and a document phase must not move the engine.
 *
 * It still creates the Transport handoff task and the customer notice, exactly
 * as before: those are pre-existing behaviour, they are outside the
 * transaction, and neither can roll the release back.
 */
export async function recordCustomsRelease(
  id: string,
  baeReference: string,
): Promise<ActionResult> {
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
  if (!(await isFileVisible(user.id, user.tenantId, rec.file_id))) {
    return { ok: false, error: "forbidden" };
  }
  if (!canTransition(rec.status as CustomsStatus, "RELEASED")) {
    return { ok: false, error: "invalid_transition" };
  }

  // Atomic: the status, the reference and the release date move together, and
  // the WES-9 customs trigger emits CUSTOMS_RELEASE_COMPLETED and BAE_RECORDED
  // inside the same transaction.
  const { error } = await supabase.rpc("record_customs_release", {
    p_customs_id: id,
    p_bae_reference: baeReference.trim(),
    p_actor: user.id,
    p_release_date: null,
    p_policy_id: null,
  });
  if (error) return { ok: false, error: "release_failed" };

  await writeAudit({
    action: AuditActions.CUSTOMS_RELEASED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "customs_record",
    entityId: id,
    before: { status: rec.status },
    after: { status: "RELEASED", bae_reference: baeReference.trim() },
  });

  const cctx = { tenantId: user.tenantId, actorId: user.id };
  await onCustomsReleased(supabase, cctx, rec.file_id);
  await custCustomsCleared(supabase, cctx, rec.file_id);

  // WES-5 — converge the official engine on the new fact. Idempotent and
  // never-throwing: the release already committed atomically with its event,
  // and a failed reconciliation changes nothing (the next run catches up).
  await reconcileDossierProcess({
    tenantId: user.tenantId,
    fileId: rec.file_id,
    cause: "customs_release",
    actorId: user.id,
  });

  revalidate(rec.file_id);
  return { ok: true, id };
}

/**
 * @deprecated WES-4E — split into `recordBaeReference` (record) and
 * `recordCustomsRelease` (observe the release). Kept as a delegator so no
 * caller silently breaks; it now takes the release path, which is what the
 * single old action always did.
 */
export async function releaseCustoms(id: string, baeReference: string): Promise<ActionResult> {
  return recordCustomsRelease(id, baeReference);
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
  // WES-1C — a RELEASED record carries the BAE: the authoritative evidence that
  // the goods may move. Deleting it would make every projection read customs as
  // never started. No ordinary path may do so; WES-1 builds no override system.
  if (rec.status === "RELEASED") return { ok: false, error: "protected_released" };

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
