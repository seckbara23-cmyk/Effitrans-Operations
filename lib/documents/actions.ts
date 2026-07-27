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
import { validateReason } from "./reason-codes";
import { isClientSafeDocument, isShareable, isVerified } from "./doctrine";
import { isGeneratableArtifact } from "./artifacts/feasibility";
import { mayVerifyDocument } from "./governance";
import { onDocumentApproved } from "@/lib/handoffs/triggers";
import { custDocumentsReceived, custDocumentsVerified } from "@/lib/customer-notify/triggers";
import { validateDocumentInput } from "./validate";
import { canReview, canSubmit } from "./status";
import {
  buildStoragePath,
  createSignedDownloadUrl,
  fileExtension,
  removeObject,
  uploadObject,
  sha256Hex,
} from "./storage";
import type { ActionResult, DocumentStatus } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

async function loadDocument(supabase: Admin, id: string, tenantId: string) {
  const { data } = await supabase
    .from("document")
    .select("id, file_id, type_code, status, storage_path, uploaded_by, superseded_by_id")
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

  // WES-4G.7 — an artifact the platform GENERATES may not be uploaded by hand.
  // Corrections happen on the structured record, then by regeneration; an
  // uploaded replacement would be a document nobody can reproduce or explain,
  // sitting where an authoritative one belongs. Refused server-side, so the
  // rule does not depend on the form hiding the option.
  if (isGeneratableArtifact(typeCode)) {
    return { ok: false, error: "generated_artifact_no_upload" };
  }

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

  // WES-4G.5 — read the stream ONCE, hash it, store the same buffer.
  //
  // The hash must describe the stored bytes, never the filename, the metadata
  // or anything the browser claims. Any client-supplied checksum in the form is
  // ignored: it is an assertion by the uploader about their own upload.
  //
  // Hashing failure fails the upload. A row that claims an unverified hash is
  // worse than a row with no hash at all, because the next reader trusts it.
  let bytes: Uint8Array;
  let contentSha256: string;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    contentSha256 = sha256Hex(bytes);
  } catch {
    return { ok: false, error: "hash_failed" };
  }

  const up = await uploadObject(path, bytes, file.type);
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
    size_bytes: bytes.byteLength,
    content_sha256: contentSha256,
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
  // Phase 2.5 — customer "Documents reçus" notification (idempotent, once per dossier).
  await custDocumentsReceived(supabase, { tenantId: user.tenantId, actorId: user.id }, fileId);
  revalidatePath(`/files/${fileId}`);
  return { ok: true, id };
}

/**
 * WES-4A — submit a version for verification. UPLOADED -> UNDER_REVIEW.
 * Atomic: status, the protected review record and the business event commit
 * together through `review_document`.
 */
export async function submitDocument(id: string): Promise<ActionResult> {
  return runReview(id, "SUBMITTED", "document:update", null, null);
}

/**
 * WES-4A/4D — VERIFY a version.
 *
 * Verification means the evidence has been checked for authenticity,
 * completeness and relevance. It does NOT mean Effitrans approved anything a
 * third party issued, and it does NOT advance the official process engine —
 * that reconciliation is WES-5's.
 *
 * Maker-checker is resolved from the PINNED policy and enforced twice: here,
 * and again by a trigger on `document_review`.
 */
export async function verifyDocument(id: string): Promise<ActionResult> {
  return runReview(id, "VERIFIED", "document:approve", null, null);
}

/**
 * WES-4F — reject a version. A structured reason code is REQUIRED; the
 * free-text explanation is optional, stays in the protected review record, and
 * never reaches the immutable ledger.
 *
 * Rejection does not delete the file or its history.
 */
export async function rejectDocument(
  id: string,
  reasonCode: string,
  explanation?: string | null,
): Promise<ActionResult> {
  return runReview(id, "REJECTED", "document:approve", reasonCode, explanation ?? null);
}

/**
 * @deprecated WES-4A — renamed to `verifyDocument`.
 *
 * "Approve" was the wrong word: Effitrans verifies that evidence is authentic
 * and complete. It does not approve a Customs decision or a third party's
 * document. Kept as a delegator so no caller silently breaks.
 */
export async function approveDocument(id: string): Promise<ActionResult> {
  return verifyDocument(id);
}

/**
 * The single review path. Everything a reviewer can do to a version goes
 * through `review_document`, which writes the status, the protected record and
 * the event in ONE transaction (WES-9A Model A). The application never does
 * update-then-append-then-emit.
 */
async function runReview(
  id: string,
  action: "SUBMITTED" | "VERIFIED" | "REJECTED",
  permission: string,
  reasonCode: string | null,
  explanation: string | null,
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
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  // WES-4F — the reason is validated BEFORE anything is written, against a
  // closed registry. An unknown code is refused rather than stored as free
  // text under a made-up name.
  let validatedCode: string | null = null;
  let validatedExplanation: string | null = null;
  if (action === "REJECTED") {
    const verdict = validateReason({
      code: reasonCode ?? "",
      explanation,
      scope: "REJECTION",
    });
    if (!verdict.ok) return { ok: false, error: verdict.error };
    validatedCode = verdict.code;
    validatedExplanation = verdict.explanation;
  }

  // WES-4H — verifier authority and maker-checker, from the PINNED policy.
  let makerChecker = false;
  let policyVersionId: string | null = null;
  if (action === "VERIFIED") {
    const check = await mayVerifyDocument({
      tenantId: user.tenantId,
      actorId: user.id,
      fileId: doc.file_id,
      typeCode: doc.type_code as string,
      uploaderId: (doc.uploaded_by as string | null) ?? null,
    });
    if (!check.ok) return { ok: false, error: check.error };
    makerChecker = check.makerCheckerRequired;
    policyVersionId = check.policyVersionId;
  }

  const { data, error } = await supabase.rpc("review_document", {
    p_document_id: id,
    p_action: action,
    p_actor: user.id,
    p_reason_code: validatedCode,
    p_explanation: validatedExplanation,
    p_maker_checker: makerChecker,
    p_is_override: false,
    p_policy_id: policyVersionId,
  });
  if (error) return { ok: false, error: mapReviewError(error.message) };

  await writeAudit({
    action:
      action === "VERIFIED"
        ? AuditActions.DOCUMENT_APPROVED
        : action === "REJECTED"
          ? AuditActions.DOCUMENT_REJECTED
          : AuditActions.DOCUMENT_UPDATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: id,
    before: { status: doc.status },
    after: { status: (data as { status?: string } | null)?.status ?? action, reason_code: validatedCode },
  });

  // Phase 2.1 / 2.5 side-effects, unchanged in behaviour and deliberately
  // OUTSIDE the transaction: a handoff task and a customer notice are not the
  // document decision, and neither may roll it back.
  //
  // WES-4 does NOT make this advance the official process engine — it creates
  // the same handoff task it always did. Engine reconciliation is WES-5.
  if (action === "VERIFIED") {
    const hctx = { tenantId: user.tenantId, actorId: user.id };
    await onDocumentApproved(supabase, hctx, doc.file_id);
    await custDocumentsVerified(supabase, hctx, doc.file_id);
  }

  revalidatePath(`/files/${doc.file_id}`);
  return { ok: true, id };
}

/** Stable codes, never raw Postgres text. */
function mapReviewError(message: string): string {
  if (message.includes("cannot verify their own")) return "self_verification";
  if (message.includes("reason code is required")) return "reason_required";
  if (message.includes("already")) return "invalid_transition";
  if (message.includes("cannot be reviewed") || message.includes("replaced, not verified")) {
    return "invalid_transition";
  }
  if (message.includes("not found")) return "not_found";
  return "review_failed";
}

/*
 * `transition()` was removed in WES-4I. It wrote `document.status` directly and
 * then audited separately — the dual write WES-9A prohibits. Its last caller,
 * `submitDocument`, now goes through `review_document`, which writes the
 * status, the protected review record and the business event in one
 * transaction. Nothing else used it.
 */

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
 * Which rule refused the share. One message per cause, because "not allowed"
 * teaches nobody which of four conditions failed.
 */
function shareRefusal(doc: { type_code: unknown; status: unknown; superseded_by_id?: unknown }): string {
  if (!isClientSafeDocument(doc.type_code as string)) return "not_client_safe";
  if (doc.superseded_by_id) return "superseded";
  if (!isVerified(doc.status as string)) return "not_verified";
  return "not_shareable";
}

/**
 * Share / unshare a document with the client portal.
 * Gated by document:approve — external disclosure is an approval-authority call.
 *
 * WES-4G.8 — the canonical rule `isShareable()` is enforced HERE, on the server.
 *
 * Two defects this closes. The check was `status !== "APPROVED"`, which after
 * WES-4 renamed the canonical status to VERIFIED meant a properly verified
 * document could no longer be shared at all — a regression WES-4 introduced.
 * And it was the ONLY condition: an internal artifact, a superseded version or
 * a document type that is not client-safe all passed, because the rule lived in
 * the pure layer and nothing called it.
 *
 * Revocation is deliberately NOT gated on shareability: a document that should
 * never have been shared must always be retractable, and re-checking the rule
 * on the way out would leave exactly the wrong things stuck in the portal.
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
  // Tenant scope is enforced by loadDocument; dossier access is enforced here.
  if (!(await isFileVisible(user.id, user.tenantId, doc.file_id))) {
    return { ok: false, error: "forbidden" };
  }

  if (shared) {
    const eligible = isShareable({
      typeCode: doc.type_code as string,
      status: doc.status as string,
      supersededById: (doc.superseded_by_id as string | null) ?? null,
    });
    if (!eligible) return { ok: false, error: shareRefusal(doc) };
  }

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
