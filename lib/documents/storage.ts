/**
 * Document storage access (Phase 1.8). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONLY path to the private `documents` bucket. Uses the service-role client
 * (the bucket has no authenticated-facing policies — deny-by-default). Uploads
 * and downloads are mediated here so every access is permission- and visibility-
 * checked by the caller first. Downloads are short-TTL signed URLs — no public
 * URLs ever leave the server.
 */
import "server-only";
import { createHash } from "node:crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const DOCUMENTS_BUCKET = "documents";
const SIGNED_URL_TTL_SECONDS = 60;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function fileExtension(name: string | undefined, mime: string | undefined): string {
  const fromName = name && name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  return (mime && MIME_EXT[mime]) || "bin";
}

/** Tenant- and dossier-partitioned, UUID-named (stable, collision-free). */
export function buildStoragePath(
  tenantId: string,
  fileId: string,
  documentId: string,
  ext: string,
): string {
  return `${tenantId}/${fileId}/${documentId}.${ext}`;
}

/**
 * WES-4G.5 — takes BYTES, not a `File`.
 *
 * The hash must describe what is actually stored. Reading the stream once and
 * passing the same buffer to both the digest and the upload is what makes that
 * true; hashing a `File` and separately uploading it leaves room for the two to
 * differ, and a hash that might not describe the bytes is worse than none.
 */
export async function uploadObject(
  path: string,
  bytes: Uint8Array,
  contentType: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: contentType || undefined, upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** sha256 of the exact bytes being stored, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createSignedDownloadUrl(path: string): Promise<string | null> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function removeObject(path: string): Promise<void> {
  const supabase = getAdminSupabaseClient();
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
}

/**
 * Download an object's raw bytes for server-side processing (Phase 7.4B searchable-PDF
 * extraction). The caller MUST have already permission- and visibility-checked the document.
 * Returns null if the object is missing/unreadable — the bytes never leave the server.
 */
export async function downloadObject(path: string): Promise<Buffer | null> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
