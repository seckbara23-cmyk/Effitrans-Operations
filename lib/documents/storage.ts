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

export async function uploadObject(
  path: string,
  file: File,
  contentType: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: contentType || undefined, upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true };
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
