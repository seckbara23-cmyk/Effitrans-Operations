"use server";

/**
 * EMP-4 — the ingestion action. The authorization boundary.
 *
 * Ingestion is the composition of two authorities that already exist, and it
 * needs BOTH (RATIFY-EMP4-7 — no new permission was created):
 *
 *   `communication:inbound:read`  — may see the attachment at all
 *   `document:create` + isFileVisible — may add a document to THAT dossier
 *
 * Requiring both is the point. Holding one without the other means a user could
 * either move a document they may not read into a dossier, or move something
 * into a dossier they may not see. Neither is acceptable, so neither is
 * sufficient.
 *
 * NOTE ON THE DARK STATE (RATIFY-EMP4-8): `communication:inbound:read` is
 * granted to no role, so this action refuses everyone today. That is the
 * intended posture and EMP-4 makes no attempt to change it.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { loadAttachment, ingestAttachment, findIngestedDocument } from "./service";

export type IngestActionResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string; detail?: string };

/**
 * Promote one inbound attachment into a dossier document.
 *
 * The document type is REQUIRED and comes from the operator. An email
 * attachment has no inherent type, and `document.type_code` is NOT NULL — a
 * default would be a guess recorded as a fact.
 */
export async function ingestAttachmentToDossier(input: {
  attachmentId: string;
  fileId: string;
  typeCode: string;
  title?: string | null;
}): Promise<IngestActionResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  // Both authorities, checked separately so a failure names the missing one.
  if (!hasPermission(permissions, "communication:inbound:read")) {
    return { ok: false, error: "forbidden_inbound" };
  }
  if (!hasPermission(permissions, "document:create")) {
    return { ok: false, error: "forbidden_document" };
  }
  if (!input.typeCode) return { ok: false, error: "type_required" };

  // The dossier must be one this user may actually see — the same gate the
  // manual upload path applies, reused rather than re-implemented.
  if (!(await isFileVisible(user.id, user.tenantId, input.fileId))) {
    return { ok: false, error: "forbidden_dossier" };
  }

  const attachment = await loadAttachment(user.tenantId, input.attachmentId);
  if (!attachment) return { ok: false, error: "attachment_not_found" };

  const outcome = await ingestAttachment({
    tenantId: user.tenantId,
    actorId: user.id,
    attachment,
    fileId: input.fileId,
    typeCode: input.typeCode,
    title: input.title ?? null,
  });

  if (!outcome.ok) {
    return { ok: false, error: outcome.error, detail: outcome.detail };
  }

  // ONE audit entry. The timeline entry is separate and comes from the
  // DOCUMENT_UPLOADED trigger on the insert — this does not duplicate it.
  await writeAudit({
    action: AuditActions.EC_ATTACHMENT_INGESTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: outcome.documentId,
    after: {
      source_attachment_id: attachment.id,
      file_id: input.fileId,
      type_code: input.typeCode,
      content_sha256: outcome.sha256,
    },
  });

  revalidatePath("/communications/triage");
  revalidatePath(`/files/${input.fileId}`);
  return { ok: true, documentId: outcome.documentId };
}

/** Whether an attachment has already been ingested — for rendering, not control. */
export async function lookupIngestedDocument(
  attachmentId: string,
): Promise<{ id: string; fileId: string } | null> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:inbound:read")) return null;
  return findIngestedDocument(user.tenantId, attachmentId);
}
