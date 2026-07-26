"use server";
/**
 * Expense supporting documents — server actions (Phase 11.0C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The « Pièces jointes » of an Autorisation de Dépenses (DEC-C22): a dedicated
 * finance-classified attachment set in its own private bucket, deliberately NOT
 * the dossier-bound `document` table (whose RLS would expose supplier quotes to
 * every dossier reader, and which cannot carry a general administrative expense
 * at all).
 *
 * The storage DOCTRINE is the platform's existing one, unchanged (see
 * lib/documents/storage.ts): a deny-by-default private bucket with no
 * authenticated-facing policies, service-role-mediated uploads, tenant-
 * partitioned UUID object keys, and short-TTL signed download URLs that are
 * minted per request and never persisted. Only the bucket differs.
 *
 * Attachments are RETIRED, never deleted (8.1A archive-not-delete): the evidence
 * set behind a submitted document must stay reconstructible. Uploads are allowed
 * only while the parent document is editable — evidence cannot be altered under
 * a document that is already in the approval chain.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { fileExtension } from "@/lib/documents/storage";
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from "@/lib/documents/validate";
import { AUTHORIZATION_EDITABLE_STATUSES, type AuthorizationStatus } from "./types";

/**
 * The private, finance-classified bucket created by migration 20260726000001.
 * NOT exported: a "use server" module may export only async functions, and the
 * bucket name is an implementation detail no caller needs.
 */
const EXPENSE_BUCKET = "finance-expense";
const SIGNED_URL_TTL_SECONDS = 60;

export type AttachmentError = "forbidden" | "not_found" | "invalid_state" | "invalid_input" | "upload_failed";
export type AttachmentResult<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: AttachmentError };

const failed = (error: AttachmentError): AttachmentResult => ({ ok: false, error });

/**
 * Tenant- and document-partitioned, UUID-named — the `documents` bucket key
 * shape, so nothing about path handling is new.
 */
function attachmentPath(tenantId: string, authorizationId: string, attachmentId: string, ext: string): string {
  return `${tenantId}/${authorizationId}/${attachmentId}.${ext}`;
}

/**
 * Attach a supporting document to an editable authorization. The file rides in a
 * FormData field named `file` (the standard Next.js server-action upload path).
 */
export async function uploadExpenseAttachment(
  authorizationId: string,
  form: FormData,
): Promise<AttachmentResult> {
  let ctx: { id: string; tenantId: string };
  try {
    const user = await assertPermission("finance:expense:create");
    ctx = { id: user.id, tenantId: user.tenantId };
  } catch {
    return failed("forbidden");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return failed("invalid_input");
  if (file.size > MAX_DOCUMENT_BYTES) return failed("invalid_input");
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) return failed("invalid_input");
  const kind = (form.get("kind") as string | null)?.trim() || null;

  const admin = getAdminSupabaseClient();
  const { data: parent } = await admin
    .from("expense_authorization")
    .select("id, status")
    .eq("id", authorizationId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!parent) return failed("not_found");
  // Evidence may only change while the document itself may change.
  if (!AUTHORIZATION_EDITABLE_STATUSES.includes(parent.status as AuthorizationStatus)) return failed("invalid_state");

  // Insert first to own an id, then upload under it — an orphaned row is
  // recoverable, an orphaned object is not attributable.
  const ext = fileExtension(file.name, file.type);
  const { data: row, error: insertError } = await admin
    .from("expense_attachment")
    .insert({
      tenant_id: ctx.tenantId,
      document_type: "EXPENSE_AUTHORIZATION",
      authorization_id: authorizationId,
      kind,
      file_name: file.name,
      mime_type: file.type || null,
      byte_size: file.size,
      storage_path: "pending",
      uploaded_by: ctx.id,
    })
    .select("id")
    .single();
  if (insertError || !row) return failed("invalid_input");

  const path = attachmentPath(ctx.tenantId, authorizationId, row.id, ext);
  const { error: uploadError } = await admin.storage
    .from(EXPENSE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) {
    // Roll the placeholder row back so the list never shows an unreadable item.
    await admin.from("expense_attachment").delete().eq("id", row.id).eq("tenant_id", ctx.tenantId);
    return failed("upload_failed");
  }

  await admin
    .from("expense_attachment")
    .update({ storage_path: path })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId);

  await writeAudit({
    action: AuditActions.EXPENSE_ATTACHMENT_ADDED,
    actorId: ctx.id,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: authorizationId,
    after: { attachment_id: row.id, file_name: file.name, byte_size: file.size, kind },
  });
  return { ok: true, id: row.id };
}

/** Retire an attachment (archive-not-delete). The stored object is kept. */
export async function retireExpenseAttachment(attachmentId: string): Promise<AttachmentResult> {
  let ctx: { id: string; tenantId: string };
  try {
    const user = await assertPermission("finance:expense:create");
    ctx = { id: user.id, tenantId: user.tenantId };
  } catch {
    return failed("forbidden");
  }

  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("expense_attachment")
    .select("id, authorization_id, retired_at")
    .eq("id", attachmentId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!row) return failed("not_found");
  if (row.retired_at) return failed("invalid_state");
  // 11.0C only ever writes authorization-parented rows; a voucher-parented one
  // (11.0D) is not retirable through this path.
  if (!row.authorization_id) return failed("invalid_state");

  const { data: parent } = await admin
    .from("expense_authorization")
    .select("status")
    .eq("id", row.authorization_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!parent) return failed("not_found");
  if (!AUTHORIZATION_EDITABLE_STATUSES.includes(parent.status as AuthorizationStatus)) return failed("invalid_state");

  const { data: updated } = await admin
    .from("expense_attachment")
    .update({ retired_at: new Date().toISOString(), retired_by: ctx.id })
    .eq("id", attachmentId)
    .eq("tenant_id", ctx.tenantId)
    .is("retired_at", null) // CAS — a concurrent retire matches zero rows
    .select("id");
  if (!updated || updated.length === 0) return failed("invalid_state");

  await writeAudit({
    action: AuditActions.EXPENSE_ATTACHMENT_RETIRED,
    actorId: ctx.id,
    tenantId: ctx.tenantId,
    entity: "expense_authorization",
    entityId: row.authorization_id as string,
    after: { attachment_id: attachmentId },
  });
  return { ok: true, id: attachmentId };
}

/**
 * A 60-second signed download URL. Gated on finance:expense:read and re-verified
 * against the caller's tenant — the URL is minted per request and never stored.
 */
export async function getExpenseAttachmentUrl(attachmentId: string): Promise<AttachmentResult<{ url: string }>> {
  let tenantId: string;
  try {
    const user = await assertPermission("finance:expense:read");
    tenantId = user.tenantId;
  } catch {
    return failed("forbidden") as AttachmentResult<{ url: string }>;
  }

  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("expense_attachment")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row?.storage_path || row.storage_path === "pending") {
    return failed("not_found") as AttachmentResult<{ url: string }>;
  }

  const { data, error } = await admin.storage
    .from(EXPENSE_BUCKET)
    .createSignedUrl(row.storage_path as string, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return failed("not_found") as AttachmentResult<{ url: string }>;
  return { ok: true, url: data.signedUrl };
}
