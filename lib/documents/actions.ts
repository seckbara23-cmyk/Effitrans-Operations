"use server";

/**
 * Document server actions (Phase 1.8). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Mirrors the module pattern: gate on permission, verify dossier visibility
 * (can_read_file), write via the service-role admin client, audit, revalidate.
 * Storage access is mediated by lib/documents/storage (private bucket, signed
 * URLs). Soft-delete only (deleted_at). Best-effort storage cleanup on failure.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { onDocumentApproved } from "@/lib/handoffs/triggers";
import { validateDocumentInput } from "./validate";
import { canReview, canSubmit } from "./status";
import {
  buildStoragePath,
  createSignedDownloadUrl,
  fileExtension,
  removeObject,
  uploadObject,
} from "./storage";
import type { ActionResult, DocumentStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadDocument(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("document")
    .select("id, file_id, type_code, status, storage_path")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

export async function uploadDocument(fileId: string, formData: FormData): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("document:create");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  const typeCode = String(formData.get("typeCode") ?? "");
  const expiryDate = (formData.get("expiryDate") as string) || null;
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };

  const supabase = getAdminSupabaseClient();

  const { data: type } = await supabase
    .from("document_type")
    .select("code, has_validity, active")
    .eq("code", typeCode)
    .maybeSingle();
  if (!type || !type.active) return { ok: false, error: "invalid_type" };

  const invalid = validateDocumentInput({
    typeHasValidity: type.has_validity,
    expiryDate,
    sizeBytes: file.size,
    mimeType: file.type,
  });
  if (invalid) return { ok: false, error: invalid };

  const { data: dossier } = await supabase
    .from("operational_file")
    .select("id, tenant_id")
    .eq("id", fileId)
    .maybeSingle();
  if (!dossier || dossier.tenant_id !== user.tenantId) return { ok: false, error: "file_not_found" };

  const id = crypto.randomUUID();
  const path = buildStoragePath(user.tenantId, fileId, id, fileExtension(file.name, file.type));

  const up = await uploadObject(path, file, file.type);
  if (!up.ok) return { ok: false, error: "upload_failed" };

  const { error } = await supabase.from("document").insert({
    id,
    tenant_id: user.tenantId,
    file_id: fileId,
    type_code: typeCode,
    title: file.name,
    status: "UPLOADED",
    expiry_date: expiryDate,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user.id,
  });
  if (error) {
    await removeObject(path); // best-effort: don't orphan the object
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: AuditActions.DOCUMENT_UPLOADED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    after: { file_id: fileId, type: typeCode },
  });
  revalidatePath(`/files/${fileId}`);
  return { ok: true, id };
}

export async function submitDocument(id: string): Promise<ActionResult> {
  return transition(id, "document:update", "PENDING_REVIEW", AuditActions.DOCUMENT_UPDATED, (s) =>
    canSubmit(s),
  );
}

export async function approveDocument(id: string): Promise<ActionResult> {
  return review(id, "APPROVED", AuditActions.DOCUMENT_APPROVED, null);
}

export async function rejectDocument(id: string, note?: string): Promise<ActionResult> {
  return review(id, "REJECTED", AuditActions.DOCUMENT_REJECTED, note?.trim() || null);
}

async function review(
  id: string,
  to: DocumentStatus,
  action: string,
  note: string | null,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("document:approve");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const doc = await loadDocument(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };
  if (!canReview(doc.status as DocumentStatus)) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("document")
    .update({ status: to, reviewed_by: user.id, review_note: note })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    before: { status: doc.status },
    after: { status: to },
  });
  // Phase 2.1 — Documentation → Customs handoff once all required docs are approved.
  if (to === "APPROVED") {
    await onDocumentApproved(supabase, { tenantId: user.tenantId, actorId: user.id }, doc.file_id);
  }
  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id };
}

async function transition(
  id: string,
  permission: string,
  to: DocumentStatus,
  action: string,
  allowed: (s: DocumentStatus) => boolean,
): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission(permission);
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const doc = await loadDocument(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };
  if (!allowed(doc.status as DocumentStatus)) return { ok: false, error: "invalid_transition" };

  const { error } = await supabase
    .from("document")
    .update({ status: to })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    before: { status: doc.status },
    after: { status: to },
  });
  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("document:delete");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const doc = await loadDocument(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("document")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.DOCUMENT_DELETED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    before: { status: doc.status },
  });
  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id };
}

/**
 * Share / unshare an APPROVED document with the client portal (Phase 1.12B).
 * Gated by document:approve — external disclosure is an approval-authority call.
 */
export async function setDocumentShared(id: string, shared: boolean): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("document:approve");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const doc = await loadDocument(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (shared && doc.status !== "APPROVED") return { ok: false, error: "not_approved" };

  const { error } = await supabase
    .from("document")
    .update({ shared_with_client: shared })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: AuditActions.DOCUMENT_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    after: { shared_with_client: shared },
  });
  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id };
}

/** Mint a short-TTL signed download URL after a permission + visibility check. */
export async function createDocumentDownloadUrl(id: string): Promise<ActionResult> {
  let user;
  try {
    user = await assertPermission("document:read");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const doc = await loadDocument(supabase, id, user.tenantId);
  if (!doc) return { ok: false, error: "not_found" };
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) return { ok: false, error: "forbidden" };

  const url = await createSignedDownloadUrl(doc.storage_path);
  if (!url) return { ok: false, error: "download_failed" };
  return { ok: true, url };
}
