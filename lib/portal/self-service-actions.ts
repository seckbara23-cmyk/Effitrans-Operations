"use server";

/**
 * Client self-service portal write actions (Phase 3.3B). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The customer's FIRST write surface. Every action follows the established
 * portal-write idiom exactly (see lib/portal/docs-actions.ts):
 *   1. resolve the portal identity (getCurrentPortalUser, must be ACTIVE);
 *   2. verify dossier OWNERSHIP via the RLS user-context client (the portal
 *      policy restricts operational_file to the caller's own client);
 *   3. perform the privileged write via the service-role admin client;
 *   4. writeAudit({ clientUserId }) — every customer action is attributed.
 *
 * Reuses the EXISTING engines only — the document storage + validation (Phase
 * 1.8), the document versioning columns, and the task table (Phase 1.3). It
 * creates NO new lifecycle/document/notification/task system, adds NO RLS
 * policy (writes are server-mediated after an ownership check, never a portal
 * INSERT policy), and NEVER lets the customer validate a document or mark an
 * invoice paid: uploads land PENDING_REVIEW; payment proofs are documents with
 * zero balance impact; requests/messages are tasks for the dossier owner.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { validateDocumentInput } from "@/lib/documents/validate";
import { buildStoragePath, fileExtension, removeObject, uploadObject } from "@/lib/documents/storage";
import { getCurrentPortalUser } from "./auth";
import {
  isCustomerUploadableType,
  isValidContactDepartment,
  validateContactMessage,
  requestUpdateCooldownMs,
  PAYMENT_PROOF_TYPE,
} from "./self-service";
import { createSupportConversation } from "./messaging-actions";
import type { ActionResult } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

type OwnedFile = { fileId: string; tenantId: string; clientUserId: string; ownerId: string | null };

/**
 * Ownership boundary: an ACTIVE portal user whose own client owns `fileId`.
 * The RLS user-context read is the security check (portal policy = own client);
 * the returned ownerId (for task routing) is read with the same trusted row.
 */
async function assertOwnedFile(fileId: string): Promise<{ ok: true; owned: OwnedFile } | { ok: false; error: string }> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };

  const ctx = getServerSupabaseClient();
  const { data: own } = await ctx
    .from("operational_file")
    .select("id, assigned_to_user_id, account_manager_id, coordinator_id")
    .eq("id", fileId)
    .maybeSingle<{ id: string; assigned_to_user_id: string | null; account_manager_id: string | null; coordinator_id: string | null }>();
  if (!own) return { ok: false, error: "forbidden" };

  return {
    ok: true,
    owned: {
      fileId: own.id,
      tenantId: user.tenantId,
      clientUserId: user.id,
      ownerId: own.assigned_to_user_id ?? own.account_manager_id ?? own.coordinator_id,
    },
  };
}

/** Shared upload core: validate the type + file, store the object, insert the row. */
async function insertCustomerDocument(
  admin: Admin,
  owned: OwnedFile,
  typeCode: string,
  file: File,
  opts: { supersedesId?: string; title?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // The file's required_for must be known to decide uploadability + versioning base.
  const { data: type } = await admin
    .from("document_type")
    .select("code, active")
    .eq("code", typeCode)
    .maybeSingle<{ code: string; active: boolean }>();
  if (!type) return { ok: false, error: "invalid_type" };

  // Customer uploads never carry an expiry (staff set validity on approval) →
  // typeHasValidity false so the customer is never asked for an expiry date.
  const invalid = validateDocumentInput({ typeHasValidity: false, expiryDate: null, sizeBytes: file.size, mimeType: file.type });
  if (invalid) return { ok: false, error: invalid };

  const id = crypto.randomUUID();
  const path = buildStoragePath(owned.tenantId, owned.fileId, id, fileExtension(file.name, file.type));
  const up = await uploadObject(path, file, file.type);
  if (!up.ok) return { ok: false, error: "upload_failed" };

  let version = 1;
  if (opts.supersedesId) {
    const { data: prev } = await admin
      .from("document")
      .select("version")
      .eq("id", opts.supersedesId)
      .eq("tenant_id", owned.tenantId)
      .maybeSingle<{ version: number }>();
    version = (prev?.version ?? 1) + 1;
  }

  const { error } = await admin.from("document").insert({
    id,
    tenant_id: owned.tenantId,
    file_id: owned.fileId,
    type_code: typeCode,
    title: opts.title ?? file.name,
    status: "PENDING_REVIEW", // customer uploads await STAFF validation — never self-validated
    version,
    supersedes_id: opts.supersedesId ?? null,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: null, // no app_user uploader; attribution is via the audit clientUserId
  });
  if (error) {
    await removeObject(path); // best-effort: don't orphan the object
    return { ok: false, error: error.message };
  }
  return { ok: true, id };
}

/** Resolve whether a type is uploadable for this dossier's file type (ACTIVE + rule). */
async function typeUploadableForFile(admin: Admin, tenantId: string, fileId: string, typeCode: string): Promise<boolean> {
  const [{ data: file }, { data: type }] = await Promise.all([
    admin.from("operational_file").select("type").eq("id", fileId).eq("tenant_id", tenantId).maybeSingle<{ type: string }>(),
    admin.from("document_type").select("code, active, required_for").eq("code", typeCode).maybeSingle<{ code: string; active: boolean; required_for: string[] | null }>(),
  ]);
  if (!file || !type) return false;
  return isCustomerUploadableType({
    code: type.code,
    active: type.active,
    requiredForFile: (type.required_for ?? []).includes(file.type),
  });
}

// ------------------------------------------------------------------ F1 upload
export async function uploadPortalDocument(fileId: string, formData: FormData): Promise<ActionResult> {
  const owner = await assertOwnedFile(fileId);
  if (!owner.ok) return { ok: false, error: owner.error };

  const file = formData.get("file");
  const typeCode = String(formData.get("typeCode") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };
  if (!typeCode) return { ok: false, error: "invalid_type" };

  const admin = getAdminSupabaseClient();
  if (!(await typeUploadableForFile(admin, owner.owned.tenantId, fileId, typeCode))) {
    return { ok: false, error: "type_not_allowed" };
  }

  const res = await insertCustomerDocument(admin, owner.owned, typeCode, file, {});
  if (!res.ok) return { ok: false, error: res.error };

  await writeAudit({
    action: AuditActions.PORTAL_DOCUMENT_UPLOADED,
    clientUserId: owner.owned.clientUserId,
    tenantId: owner.owned.tenantId,
    entity: "document",
    entityId: res.id,
    after: { file_id: fileId, type: typeCode },
  });
  revalidatePath(`/portal/files/${fileId}`);
  revalidatePath("/portal/documents");
  return { ok: true, id: res.id };
}

// ----------------------------------------------------------------- F2 replace
export async function replacePortalDocument(rejectedDocId: string, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };

  const admin = getAdminSupabaseClient();
  // Load the rejected doc within the caller's tenant; it must be REJECTED.
  const { data: doc } = await admin
    .from("document")
    .select("id, file_id, type_code, status")
    .eq("id", rejectedDocId)
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; file_id: string; type_code: string; status: string }>();
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.status !== "REJECTED") return { ok: false, error: "not_replaceable" };

  // Ownership: the customer's own client must own the doc's dossier (RLS read).
  const owner = await assertOwnedFile(doc.file_id);
  if (!owner.ok) return { ok: false, error: owner.error };

  const res = await insertCustomerDocument(admin, owner.owned, doc.type_code, file, { supersedesId: doc.id });
  if (!res.ok) return { ok: false, error: res.error };

  await writeAudit({
    action: AuditActions.PORTAL_DOCUMENT_REPLACED,
    clientUserId: owner.owned.clientUserId,
    tenantId: owner.owned.tenantId,
    entity: "document",
    entityId: res.id,
    before: { superseded: rejectedDocId, type: doc.type_code },
    after: { file_id: doc.file_id, type: doc.type_code },
  });
  revalidatePath(`/portal/files/${doc.file_id}`);
  revalidatePath("/portal/documents");
  return { ok: true, id: res.id };
}

// ----------------------------------------------------------- F3 payment proof
export async function uploadPortalPaymentProof(fileId: string, formData: FormData): Promise<ActionResult> {
  const owner = await assertOwnedFile(fileId);
  if (!owner.ok) return { ok: false, error: owner.error };

  const file = formData.get("file");
  const invoiceRef = String(formData.get("invoiceRef") ?? "").trim().slice(0, 120);
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };

  const admin = getAdminSupabaseClient();
  // A payment proof NEVER touches the balance — it is a PENDING_REVIEW document
  // (type PAYMENT_RECEIPT). Finance verifies + records the actual payment via the
  // existing finance flow; the invoice is never auto-marked paid here.
  const title = invoiceRef ? `Preuve de paiement · ${invoiceRef} · ${file.name}` : `Preuve de paiement · ${file.name}`;
  const res = await insertCustomerDocument(admin, owner.owned, PAYMENT_PROOF_TYPE, file, { title });
  if (!res.ok) return { ok: false, error: res.error };

  await writeAudit({
    action: AuditActions.PORTAL_PAYMENT_PROOF_SUBMITTED,
    clientUserId: owner.owned.clientUserId,
    tenantId: owner.owned.tenantId,
    entity: "document",
    entityId: res.id,
    after: { file_id: fileId, invoiceRef: invoiceRef || null },
  });
  revalidatePath(`/portal/files/${fileId}`);
  return { ok: true, id: res.id };
}

// ---------------------------------------------------------- F4 request update
export async function requestPortalUpdate(fileId: string): Promise<ActionResult> {
  const owner = await assertOwnedFile(fileId);
  if (!owner.ok) return { ok: false, error: owner.error };

  const admin = getAdminSupabaseClient();
  // Rate limit (1 / 12 h) sourced from the append-only audit log — no new state.
  const { data: last } = await admin
    .from("audit_log")
    .select("created_at")
    .eq("action", AuditActions.PORTAL_UPDATE_REQUESTED)
    .eq("entity_id", fileId)
    .eq("client_user_id", owner.owned.clientUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (requestUpdateCooldownMs(last?.created_at ?? null, new Date()) > 0) {
    return { ok: false, error: "rate_limited" };
  }

  const { data: task, error } = await admin
    .from("task")
    .insert({
      tenant_id: owner.owned.tenantId,
      file_id: fileId,
      title: "Mise à jour demandée par le client",
      description: "Le client a demandé une mise à jour du statut de son expédition via l'espace client.",
      priority: "NORMAL",
      status: "TODO",
      assigned_to: owner.owned.ownerId,
      created_by: null,
    })
    .select("id")
    .single();
  if (error || !task) return { ok: false, error: error?.message ?? "request_failed" };

  await writeAudit({
    action: AuditActions.PORTAL_UPDATE_REQUESTED,
    clientUserId: owner.owned.clientUserId,
    tenantId: owner.owned.tenantId,
    entity: "operational_file",
    entityId: fileId,
    after: { task_id: task.id },
  });
  return { ok: true, id: task.id };
}

// ----------------------------------------------------------------- F5 contact
/**
 * "Contacter Effitrans" (Phase 3.3B) — UPGRADED in Phase 8.7 to create a real,
 * two-way, threaded customer_support Messaging Center conversation instead of a
 * one-way, unthreaded task with no reply channel. The exported signature is
 * unchanged (fileId + FormData) so the existing ContactCard form keeps working;
 * the id returned is now a conversation id, visible at /portal/messages.
 */
export async function contactEffitrans(fileId: string, formData: FormData): Promise<ActionResult> {
  const owner = await assertOwnedFile(fileId);
  if (!owner.ok) return { ok: false, error: owner.error };

  const department = String(formData.get("department") ?? "").trim();
  const message = String(formData.get("message") ?? "");
  if (!isValidContactDepartment(department)) return { ok: false, error: "invalid_department" };
  const invalid = validateContactMessage(message);
  if (invalid) return { ok: false, error: invalid };

  const result = await createSupportConversation({ department, message, fileId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, id: result.id };
}
