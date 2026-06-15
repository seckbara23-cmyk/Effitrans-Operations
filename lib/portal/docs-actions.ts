"use server";

/**
 * Portal document download (Phase 1.12B). SERVER ACTION.
 * ---------------------------------------------------------------------------
 * The single service-role touchpoint for portal documents: reads the row via
 * the USER-CONTEXT client first (the portal RLS policy guarantees it is
 * APPROVED + shared + the caller's own client), then mints a short-TTL signed
 * URL via the private bucket. No public URLs. Audits the download.
 */
import { getCurrentPortalUser } from "./auth";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl } from "@/lib/documents/storage";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export async function getPortalDocumentDownloadUrl(
  documentId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };

  const supabase = getServerSupabaseClient();
  // RLS portal policy gates visibility (approved + shared + own client).
  const { data: doc } = await supabase
    .from("document")
    .select("id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };

  const url = await createSignedDownloadUrl(doc.storage_path);
  if (!url) return { ok: false, error: "download_failed" };

  await writeAudit({
    action: AuditActions.PORTAL_DOCUMENT_DOWNLOADED,
    clientUserId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: documentId,
  });
  return { ok: true, url };
}
