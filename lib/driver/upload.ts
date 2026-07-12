"use server";

/**
 * Driver evidence upload (Phase 3.4C-3). SERVER ACTION.
 * ---------------------------------------------------------------------------
 * Assignment-authorized photo / signature / POD capture that REUSES the Phase 1.8
 * document workflow end-to-end: the private `documents` bucket, the server-built
 * storage path, the document catalog, audit, and signed-URL downloads. Drivers
 * hold no document:create — authority here is the transport ASSIGNMENT, not a
 * permission. Enforced: allowed MIME per evidence kind, ≤ 25 MB, an ACTIVE
 * document type, tenant + assignment scoping, server-controlled path.
 *
 * PRIVACY: driver evidence is stored INTERNAL (shared_with_client = false). The
 * public bucket is never touched, and external disclosure stays an approval-
 * authority decision (staff setDocumentShared on an APPROVED document). The
 * customer-facing delivery signal travels on the customer_visible tracking_event,
 * not on the raw document.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { validateDocumentInput } from "@/lib/documents/validate";
import { buildStoragePath, fileExtension, removeObject, uploadObject } from "@/lib/documents/storage";
import type { ActionResult } from "@/lib/documents/types";
import { EVIDENCE_TYPE_CODE, isAllowedEvidenceMime, isEvidenceKind, type EvidenceKind } from "./event-kinds";
import { driverContext, loadAssignedTransport, currentSession } from "./mission-auth";

/**
 * Upload a piece of driver evidence for an assigned mission.
 * formData: { kind: EvidenceKind, file: File }. Returns the created document id.
 */
export async function uploadDriverEvidence(transportId: string, formData: FormData): Promise<ActionResult> {
  if (!driverMobileTrackingEnabled()) return { ok: false, error: "tracking_disabled" };
  const user = await driverContext();
  if (!user) return { ok: false, error: "forbidden" };

  const kindRaw = String(formData.get("kind") ?? "");
  if (!isEvidenceKind(kindRaw)) return { ok: false, error: "invalid_kind" };
  const kind = kindRaw as EvidenceKind;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };
  if (!isAllowedEvidenceMime(kind, file.type)) return { ok: false, error: "invalid_mime" };
  const sizeInvalid = validateDocumentInput({ typeHasValidity: false, expiryDate: null, sizeBytes: file.size, mimeType: file.type });
  if (sizeInvalid) return { ok: false, error: sizeInvalid };

  const supabase = getAdminSupabaseClient();
  const rec = await loadAssignedTransport(supabase, user, transportId);
  if (!rec) return { ok: false, error: "forbidden" };
  // Evidence is captured during a live mission.
  const sess = await currentSession(supabase, user, transportId);
  if (!sess) return { ok: false, error: "no_session" };

  const typeCode = EVIDENCE_TYPE_CODE[kind];
  const { data: type } = await supabase
    .from("document_type")
    .select("code, active")
    .eq("code", typeCode)
    .maybeSingle();
  if (!type || !type.active) return { ok: false, error: "invalid_type_doc" };

  const id = crypto.randomUUID();
  const path = buildStoragePath(user.tenantId, rec.file_id, id, fileExtension(file.name, file.type));

  const up = await uploadObject(path, file, file.type);
  if (!up.ok) return { ok: false, error: "upload_failed" };

  // POD scans enter the staff review queue (drives the eventual POD_RECEIVED /
  // Finance handoff); other evidence is simply captured.
  const status = kind === "pod" ? "PENDING_REVIEW" : "UPLOADED";
  const { error } = await supabase.from("document").insert({
    id,
    tenant_id: user.tenantId,
    file_id: rec.file_id,
    type_code: typeCode,
    title: file.name,
    status,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: user.id,
    shared_with_client: false, // internal until staff approve + share
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
    after: { file_id: rec.file_id, type: typeCode, source: "driver_mobile" },
  });
  revalidatePath(`/driver/missions/${transportId}`);
  return { ok: true, id };
}
