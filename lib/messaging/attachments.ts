/**
 * Messaging Center attachment storage (Phase 8.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Mirrors lib/documents/storage.ts (private bucket, service-role only, short-TTL
 * signed URLs, never a public URL) for upload/download, and lib/brand/assets.ts
 * for validation (a MIME allow-list alone is not trusted — the actual byte
 * signature is checked; the filename is sanitized before ever reaching a path).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const MESSAGING_ATTACHMENTS_BUCKET = "messaging-attachments";
/** Matches the bucket's file_size_limit set in the migration. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const SIGNED_URL_TTL_SECONDS = 60;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function attachmentExtension(mime: string): string {
  return MIME_EXT[mime] ?? "bin";
}

/** Strip any path, collapse dangerous characters, cap length. Never trust a client filename. */
export function sanitizeAttachmentFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "fichier";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-]+/, "");
  const trimmed = cleaned.slice(0, 120);
  return trimmed || "fichier";
}

export type AttachmentValidationError = "file_required" | "file_too_large" | "invalid_mime" | "invalid_signature";

/** file.type alone is not trusted — the actual byte signature is checked, same principle as lib/brand/assets.ts. */
function signatureOk(mimeType: string, header: Uint8Array): boolean {
  if (mimeType === "image/png") {
    return header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  }
  if (mimeType === "image/jpeg") {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === "application/pdf") {
    return header.length >= 4 && header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
  }
  if (mimeType.includes("officedocument")) {
    // DOCX/XLSX are ZIP containers ("PK\x03\x04" or similar).
    return header.length >= 2 && header[0] === 0x50 && header[1] === 0x4b;
  }
  return false;
}

export function validateAttachmentUpload(input: { sizeBytes: number; mimeType: string; headerBytes: Uint8Array }): AttachmentValidationError | null {
  if (!input.sizeBytes || input.sizeBytes <= 0) return "file_required";
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) return "file_too_large";
  if (!(ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(input.mimeType)) return "invalid_mime";
  if (!signatureOk(input.mimeType, input.headerBytes)) return "invalid_signature";
  return null;
}

/** Tenant- and conversation-partitioned, UUID-named (stable, collision-free, never guessable). */
export function buildAttachmentStoragePath(tenantId: string, conversationId: string, attachmentId: string, ext: string): string {
  return `${tenantId}/${conversationId}/${attachmentId}.${ext}`;
}

export async function uploadAttachmentObject(path: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase.storage
    .from(MESSAGING_ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function createAttachmentSignedUrl(path: string): Promise<string | null> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.storage.from(MESSAGING_ATTACHMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function removeAttachmentObject(path: string): Promise<void> {
  const supabase = getAdminSupabaseClient();
  await supabase.storage.from(MESSAGING_ATTACHMENTS_BUCKET).remove([path]);
}
