"use server";

/**
 * CEO-ALIGNMENT WP1-D — the message-filing action. The authorization boundary.
 *
 * The same composition of authorities as EMP-4's attachment action
 * (./actions.ts) and no new permission: `communication:inbound:read` to see the
 * message, `document:create` + dossier visibility to add the document. Kept in
 * its own module so EMP-4's « one act, one audit entry » stays true of its file.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { isFileVisible } from "@/lib/authz/visibility";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  loadInboundMessage,
  ingestMessage,
  findIngestedMessageDocument,
  INSTRUCTION_TYPE_CODE,
} from "./message-service";
import { messageProvenanceStored } from "./message-provenance-160";

// ===========================================================================
// CEO-ALIGNMENT WP1-D — file the customer's instructing MESSAGE on a dossier.
// ===========================================================================
//
// The same composition of authorities as the attachment action above, and no
// new permission: `communication:inbound:read` to see the message,
// `document:create` + dossier visibility to add the document. Like that action
// it is DARK today — RATIFY-EC1-1 grants `communication:inbound:read` to no
// role — and this slice does not change that. Until it changes, an instruction
// received by e-mail is filed through the ordinary upload, under the same
// « Ordre de transit / instruction client » type.
//
// Refused, never half-done, when migration #160 is not applied: the provenance
// column and its UNIQUE index are what make a filing traceable and single.

export type MessageIngestActionResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string; detail?: string };

export async function ingestMessageToDossier(input: {
  messageId: string;
  fileId: string;
}): Promise<MessageIngestActionResult> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  if (!hasPermission(permissions, "communication:inbound:read")) {
    return { ok: false, error: "forbidden_inbound" };
  }
  if (!hasPermission(permissions, "document:create")) {
    return { ok: false, error: "forbidden_document" };
  }
  if (!(await messageProvenanceStored())) {
    return { ok: false, error: "not_available" };
  }
  if (!(await isFileVisible(user.id, user.tenantId, input.fileId))) {
    return { ok: false, error: "forbidden_dossier" };
  }

  const message = await loadInboundMessage(user.tenantId, input.messageId);
  if (!message) return { ok: false, error: "message_not_found" };

  // The dossier number is printed on the rendition. Tenant-scoped read, after
  // the visibility check above has already proved this user may see it.
  const { data: file } = await getAdminSupabaseClient()
    .from("operational_file")
    .select("file_number")
    .eq("id", input.fileId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!file) return { ok: false, error: "forbidden_dossier" };

  const outcome = await ingestMessage({
    tenantId: user.tenantId,
    actorId: user.id,
    message,
    fileId: input.fileId,
    fileNumber: (file as { file_number: string }).file_number,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error, detail: outcome.detail };

  // ONE audit entry; the timeline entry comes from the DOCUMENT_UPLOADED
  // trigger on the insert. Hashes and ids only — no address, no subject.
  await writeAudit({
    action: AuditActions.EC_MESSAGE_INGESTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "document",
    entityId: outcome.documentId,
    after: {
      source_message_id: message.id,
      file_id: input.fileId,
      type_code: INSTRUCTION_TYPE_CODE,
      content_sha256: outcome.sha256,
      raw_sha256: outcome.rawSha256,
    },
  });

  revalidatePath("/mail/inbox");
  revalidatePath(`/files/${input.fileId}`);
  return { ok: true, documentId: outcome.documentId };
}

/** Whether a message has already been filed — for rendering, not control. */
export async function lookupIngestedMessage(
  messageId: string,
): Promise<{ id: string; fileId: string } | null> {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:inbound:read")) return null;
  if (!(await messageProvenanceStored())) return null;
  return findIngestedMessageDocument(user.tenantId, messageId);
}

/** Can the platform file messages at all (migration #160 applied)? */
export async function messageFilingAvailable(): Promise<boolean> {
  return messageProvenanceStored();
}
