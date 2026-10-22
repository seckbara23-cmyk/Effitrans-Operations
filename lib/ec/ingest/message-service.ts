import "server-only";

/**
 * CEO-ALIGNMENT WP1-D — filing the customer's instructing MESSAGE on a dossier.
 *
 * Kept apart from ./service.ts on purpose: that module is EMP-4's attachment
 * ingestion, whose invariants (one buffer read, hashed and stored; one act,
 * one audit entry) are pinned file-wide. Message filing has its own bytes and
 * its own act, so it lives in its own module rather than diluting those.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { uploadObject, sha256Hex, buildStoragePath, fileExtension } from "@/lib/documents/storage";
import { EC_INBOUND_BUCKET } from "@/lib/ec/inbound/capture";
import { reportError } from "@/lib/observability/report";
import { renderInstructionMessage } from "./message-render";

// ===========================================================================
// CEO-ALIGNMENT WP1-D — the customer's instructing MESSAGE.
// ===========================================================================
//
// CEO-004: « … ou rattacher le mail du client qui confie le dossier a
// Effitrans. » The instruction is usually the message itself, not an
// attachment, so it gets the same treatment one level up: read what capture
// recorded, render it (lib/ec/ingest/message-render.ts — text only, no
// network), store the rendition in the managed bucket, and file it as an
// `ORDRE_DE_TRANSIT` document whose `source_message_id` points at the
// immutable captured message. The message row and its raw `.eml` are never
// touched — they are the evidence; the document is a working copy.
//
// The caller owns authorization, exactly as for attachments:
// `communication:inbound:read` to see the message, `document:create` plus
// dossier visibility to create the document.

/** The `document_type` this rendition is filed under (migration #159). */
export const INSTRUCTION_TYPE_CODE = "ORDRE_DE_TRANSIT";

export type MessageSource = {
  id: string;
  tenantId: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  receivedAt: string;
  messageIdHeader: string | null;
  rawSha256: string;
  textBodyPath: string | null;
  htmlBodyPath: string | null;
  attachments: { filename: string; sizeBytes: number }[];
};

export type MessageIngestOutcome =
  | { ok: true; documentId: string; sha256: string; rawSha256: string }
  | { ok: false; error: MessageIngestError; detail?: string };

export type MessageIngestError =
  | "already_ingested"
  | "body_unreadable"
  | "upload_failed"
  | "insert_failed";

/**
 * The narrow, untyped surface this section needs. `document.source_message_id`
 * is deliberately absent from lib/db/types.ts until migration #160 is applied
 * (the generated types describe the DEPLOYED schema), so these two calls go
 * through a structural type rather than widening the shared one.
 */
type LooseClient = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
    insert: (v: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
  };
};

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Read one CAPTURED message (never a quarantined one), tenant-scoped, with the
 * names and sizes of its attachments for the rendition's header.
 */
export async function loadInboundMessage(
  tenantId: string,
  messageId: string,
): Promise<MessageSource | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("ec_inbound_message")
    .select(
      "id, tenant_id, from_address, from_name, to_addresses, cc_addresses, subject, received_at, message_id, raw_sha256, text_body_path, html_body_path, capture_status",
    )
    .eq("id", messageId)
    .eq("tenant_id", tenantId)
    .eq("capture_status", "RECEIVED")
    .maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;

  const { data: atts } = await admin
    .from("ec_inbound_attachment")
    .select("filename, size_bytes")
    .eq("message_id", messageId)
    .eq("tenant_id", tenantId)
    .order("created_at");

  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    fromAddress: r.from_address as string,
    fromName: (r.from_name as string | null) ?? null,
    to: list(r.to_addresses),
    cc: list(r.cc_addresses),
    subject: (r.subject as string | null) ?? null,
    receivedAt: r.received_at as string,
    messageIdHeader: (r.message_id as string | null) ?? null,
    rawSha256: r.raw_sha256 as string,
    textBodyPath: (r.text_body_path as string | null) ?? null,
    htmlBodyPath: (r.html_body_path as string | null) ?? null,
    attachments: ((atts ?? []) as { filename: string; size_bytes: number }[]).map((a) => ({
      filename: a.filename,
      sizeBytes: Number(a.size_bytes ?? 0),
    })),
  };
}

/**
 * Has this message already been filed on a dossier? For rendering only — the
 * partial UNIQUE index `uq_document_source_message` is the enforcement.
 */
export async function findIngestedMessageDocument(
  tenantId: string,
  messageId: string,
): Promise<{ id: string; fileId: string } | null> {
  const admin = getAdminSupabaseClient() as unknown as LooseClient;
  const { data } = await admin
    .from("document")
    .select("id, file_id")
    .eq("tenant_id", tenantId)
    .eq("source_message_id", messageId)
    .maybeSingle();
  if (!data) return null;
  const r = data as { id: string; file_id: string };
  return { id: r.id, fileId: r.file_id };
}

async function readBody(path: string): Promise<string | null> {
  const admin = getAdminSupabaseClient();
  const { data: blob, error } = await admin.storage.from(EC_INBOUND_BUCKET).download(path);
  if (error || !blob) return null;
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * File the message on the dossier as an « Ordre de transit / instruction
 * client », status UPLOADED — never verified here: the instruction follows the
 * ordinary document verification like any other evidence.
 */
export async function ingestMessage(input: {
  tenantId: string;
  actorId: string;
  message: MessageSource;
  fileId: string;
  fileNumber: string | null;
}): Promise<MessageIngestOutcome> {
  const { tenantId, actorId, message, fileId } = input;

  const existing = await findIngestedMessageDocument(tenantId, message.id);
  if (existing) return { ok: false, error: "already_ingested", detail: existing.id };

  // A body path that cannot be read is a refusal, not an empty page: a
  // rendition that silently dropped the text would misrepresent the message.
  let textBody: string | null = null;
  let htmlBody: string | null = null;
  if (message.textBodyPath) {
    textBody = await readBody(message.textBodyPath);
    if (textBody === null) return { ok: false, error: "body_unreadable" };
  } else if (message.htmlBodyPath) {
    htmlBody = await readBody(message.htmlBodyPath);
    if (htmlBody === null) return { ok: false, error: "body_unreadable" };
  }

  const bytes = renderInstructionMessage({
    fileNumber: input.fileNumber,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    receivedAt: message.receivedAt,
    messageIdHeader: message.messageIdHeader,
    rawSha256: message.rawSha256,
    textBody,
    htmlBody,
    attachments: message.attachments,
  });
  const contentSha256 = sha256Hex(bytes);

  const documentId = crypto.randomUUID();
  const path = buildStoragePath(tenantId, fileId, documentId, fileExtension("instruction.pdf", "application/pdf"));
  const up = await uploadObject(path, bytes, "application/pdf");
  if (!up.ok) {
    reportError(new Error(up.error ?? "upload_failed"), { scope: "action", event: "ec.ingest_message.upload" });
    return { ok: false, error: "upload_failed" };
  }

  const subject = message.subject?.trim() ? message.subject.trim() : "(sans objet)";
  const admin = getAdminSupabaseClient() as unknown as LooseClient;
  const { error: insertError } = await admin.from("document").insert({
    id: documentId,
    tenant_id: tenantId,
    file_id: fileId,
    type_code: INSTRUCTION_TYPE_CODE,
    title: `Instruction client — ${subject}`.slice(0, 160),
    status: "UPLOADED",
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: bytes.byteLength,
    content_sha256: contentSha256,
    source_message_id: message.id,
    uploaded_by: actorId,
  });

  if (insertError) {
    // Same reasoning as attachments: the object is not removed — on a
    // unique-violation another operator won the race and owns the filing.
    const duplicate = insertError.code === "23505";
    if (!duplicate) reportError(insertError, { scope: "action", event: "ec.ingest_message.insert" });
    return {
      ok: false,
      error: duplicate ? "already_ingested" : "insert_failed",
      detail: duplicate ? undefined : insertError.message,
    };
  }

  return { ok: true, documentId, sha256: contentSha256, rawSha256: message.rawSha256 };
}
