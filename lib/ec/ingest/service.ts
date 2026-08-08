import "server-only";

/**
 * EMP-4 — promoting an inbound mail attachment into a dossier document.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM EC-2's TRIAGE ACTIONS.
 * EC-2 pins that its own actions never touch `public.document` — capture and
 * triage create nothing automatically, and that guard is worth keeping. So
 * ingestion lives here, is invoked explicitly by a person, and EC-2's files
 * stay clean.
 *
 * WHAT IT IS: a copy with provenance. Bytes are read from the inbound bucket,
 * hashed, written to the managed `documents` bucket, and a `document` row
 * records where they came from.
 *
 * WHY COPY AND NOT REFERENCE (RATIFY-EMP4-2). Pointing a document's
 * `storage_path` at an `ec-inbound` object would put the document lifecycle —
 * supersede, soft delete, review — on top of EC-1's immutable capture evidence,
 * and `createSignedDownloadUrl` is bound to the `documents` bucket anyway. The
 * inbound object is evidence of what arrived; the document is a working
 * artefact. They are different things with different lifetimes.
 *
 * WHAT IT DOES NOT DO: no OCR, no AI, no classification, no extraction, no
 * background work, no customer sharing, no second storage abstraction, and no
 * event of its own — `emit_document_events()` already emits DOCUMENT_UPLOADED
 * on INSERT, and a second producer is forbidden.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { uploadObject, sha256Hex, buildStoragePath, fileExtension } from "@/lib/documents/storage";
import { EC_INBOUND_BUCKET } from "@/lib/ec/inbound/capture";
import { reportError } from "@/lib/observability/report";

export type IngestOutcome =
  | { ok: true; documentId: string; sha256: string }
  | { ok: false; error: IngestError; detail?: string };

export type IngestError =
  | "attachment_not_found"
  | "attachment_not_stored"
  | "already_ingested"
  | "download_failed"
  | "hash_mismatch"
  | "upload_failed"
  | "insert_failed";

export type AttachmentSource = {
  id: string;
  tenantId: string;
  filename: string;
  mimeType: string | null;
  sha256: string | null;
  storagePath: string | null;
  stored: boolean;
};

/**
 * Read one attachment's metadata, tenant-scoped.
 *
 * The admin client is used because this runs behind an application gate the
 * caller has already applied; the tenant predicate is restated here so a forged
 * id cannot reach another tenant's mail even if that gate were ever loosened.
 */
export async function loadAttachment(
  tenantId: string,
  attachmentId: string,
): Promise<AttachmentSource | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_inbound_attachment")
    .select("id, tenant_id, filename, mime_type, sha256, storage_path, stored")
    .eq("id", attachmentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    filename: (r.filename as string) ?? "piece-jointe",
    mimeType: (r.mime_type as string | null) ?? null,
    sha256: (r.sha256 as string | null) ?? null,
    storagePath: (r.storage_path as string | null) ?? null,
    stored: Boolean(r.stored),
  };
}

/**
 * Has this attachment already become a document?
 *
 * Answered for the UI so the action can be shown as already-done rather than
 * offered and refused. It is NOT the enforcement — that is the unique index,
 * because two operators clicking at the same instant would both pass a check
 * like this one.
 */
export async function findIngestedDocument(
  tenantId: string,
  attachmentId: string,
): Promise<{ id: string; fileId: string } | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("document")
    .select("id, file_id")
    .eq("tenant_id", tenantId)
    .eq("source_attachment_id", attachmentId)
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as { id: string; file_id: string };
  return { id: r.id, fileId: r.file_id };
}

/**
 * The ingestion itself.
 *
 * ORDER MATTERS, and it is: read the bytes, hash them, verify the hash against
 * what EC-1 recorded, store, then insert. The verification step is the reason
 * this is not a two-line function — if the bytes we just read do not hash to
 * what capture recorded, something is wrong with the stored evidence and the
 * right response is to refuse rather than to copy it into the document store
 * and give it a new identity.
 *
 * The caller owns authorization: `communication:inbound:read` to see the
 * attachment, `document:create` plus dossier visibility to create the document.
 */
export async function ingestAttachment(input: {
  tenantId: string;
  actorId: string;
  attachment: AttachmentSource;
  fileId: string;
  typeCode: string;
  title?: string | null;
}): Promise<IngestOutcome> {
  const { tenantId, actorId, attachment, fileId, typeCode } = input;

  if (!attachment.stored || !attachment.storagePath) {
    return { ok: false, error: "attachment_not_stored" };
  }

  const admin = getAdminSupabaseClient();

  // Advisory pre-check: a friendly refusal instead of a raw constraint error.
  // The database still has the last word.
  const existing = await findIngestedDocument(tenantId, attachment.id);
  if (existing) return { ok: false, error: "already_ingested", detail: existing.id };

  // 1. The bytes, from the inbound bucket.
  const { data: blob, error: downloadError } = await admin.storage
    .from(EC_INBOUND_BUCKET)
    .download(attachment.storagePath);
  if (downloadError || !blob) {
    reportError(downloadError ?? new Error("no_blob"), { scope: "action", event: "ec.ingest.download" });
    return { ok: false, error: "download_failed" };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    reportError(e, { scope: "action", event: "ec.ingest.read" });
    return { ok: false, error: "download_failed" };
  }

  // 2. Hash the buffer we actually hold — the same discipline WES-4G.5 built
  //    `uploadObject` around: the hash must describe the stored bytes.
  const contentSha256 = sha256Hex(bytes);

  // 3. Verify against EC-1's record. A mismatch means the evidence and its
  //    hash disagree; copying it anyway would launder that disagreement into a
  //    document that looks trustworthy.
  if (attachment.sha256 && attachment.sha256.toLowerCase() !== contentSha256) {
    return { ok: false, error: "hash_mismatch" };
  }

  // 4. Store in the managed bucket, through the ONLY door to it.
  const documentId = crypto.randomUUID();
  const path = buildStoragePath(
    tenantId,
    fileId,
    documentId,
    fileExtension(attachment.filename, attachment.mimeType ?? ""),
  );
  const up = await uploadObject(path, bytes, attachment.mimeType ?? undefined);
  if (!up.ok) {
    reportError(new Error(up.error ?? "upload_failed"), { scope: "action", event: "ec.ingest.upload" });
    return { ok: false, error: "upload_failed" };
  }

  // 5. The document row. DOCUMENT_UPLOADED is emitted by the trigger on this
  //    INSERT — not here. `uploaded_by` is what the trigger attributes the
  //    event to, so it must be the person who chose to ingest.
  const { error: insertError } = await admin.from("document").insert({
    id: documentId,
    tenant_id: tenantId,
    file_id: fileId,
    type_code: typeCode,
    title: input.title ?? attachment.filename,
    status: "UPLOADED",
    storage_path: path,
    mime_type: attachment.mimeType,
    size_bytes: bytes.byteLength,
    content_sha256: contentSha256,
    source_attachment_id: attachment.id,
    uploaded_by: actorId,
  });

  if (insertError) {
    // The object is in the bucket but has no row. It is NOT removed here: a
    // unique-violation means another operator won the race and their document
    // owns this attachment, and deleting an object on that path could race
    // their write. An orphaned object is inert; a deleted one is not.
    const duplicate = insertError.code === "23505";
    if (!duplicate) {
      reportError(insertError, { scope: "action", event: "ec.ingest.insert" });
    }
    return {
      ok: false,
      error: duplicate ? "already_ingested" : "insert_failed",
      detail: duplicate ? undefined : insertError.message,
    };
  }

  return { ok: true, documentId, sha256: contentSha256 };
}
