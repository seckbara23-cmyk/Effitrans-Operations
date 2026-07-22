"use server";

/**
 * Messaging Center — portal (customer) server actions (Phase 8.7).
 * ---------------------------------------------------------------------------
 * Same shape as every other portal action (lib/portal/admin-actions.ts,
 * lib/portal/self-service-actions.ts): resolve the portal session, verify OWNERSHIP
 * (own client only — never trust a client-supplied clientId/tenantId), write via the
 * admin client, audit with clientUserId (never actorId — this is a customer action),
 * revalidatePath. sender_client_user_id is ALWAYS user.id from the resolved session.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { CONTACT_DEPARTMENT_LABELS } from "@/lib/portal/self-service";
import {
  isValidMessagingDepartment,
  messagingDepartmentPermission,
  validateMessageBody,
  canMessageConversation,
  nextStatusOnCustomerReply,
  type MessagingDepartment,
} from "@/lib/messaging/access";
import { notifyStaffOfMessage, resolveStaffWithPermission } from "@/lib/messaging/notify";
import { listPortalConversations, getPortalConversationDetail } from "@/lib/messaging/service";
import {
  attachmentExtension,
  buildAttachmentStoragePath,
  createAttachmentSignedUrl,
  removeAttachmentObject,
  sanitizeAttachmentFilename,
  uploadAttachmentObject,
  validateAttachmentUpload,
} from "@/lib/messaging/attachments";
import type { ConversationDetail, ConversationSummary, MessagingActionResult } from "@/lib/messaging/types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

// Thin client-callable read wrappers (the portal Messaging UI polls these) — same
// idiom as lib/messaging/actions.ts's fetchStaffConversations*.
export async function fetchPortalConversations(): Promise<ConversationSummary[]> {
  return listPortalConversations();
}

export async function fetchPortalConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  return getPortalConversationDetail(conversationId);
}

async function touchPortalParticipant(admin: Admin, conversationId: string, tenantId: string, clientUserId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: existing } = await admin
    .from("conversation_participant")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("client_user_id", clientUserId)
    .is("removed_at", null)
    .maybeSingle();
  if (existing) {
    await admin.from("conversation_participant").update({ last_read_at: nowIso }).eq("id", existing.id);
  } else {
    await admin
      .from("conversation_participant")
      .insert({ tenant_id: tenantId, conversation_id: conversationId, participant_type: "customer", client_user_id: clientUserId, last_read_at: nowIso });
  }
}

/**
 * Create (or the customer starts) a NEW support conversation — the upgraded
 * "Contacter Effitrans". Optionally linked to one of the customer's OWN dossiers
 * (ownership verified: file.client_id must equal the caller's own client_id).
 */
export async function createSupportConversation(input: {
  department: string;
  message: string;
  fileId?: string;
}): Promise<MessagingActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };
  if (!isValidMessagingDepartment(input.department)) return { ok: false, error: "invalid_department" };
  const invalid = validateMessageBody(input.message);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();

  let fileId: string | null = null;
  if (input.fileId) {
    const { data: file } = await admin
      .from("operational_file")
      .select("id, client_id, tenant_id")
      .eq("id", input.fileId)
      .maybeSingle();
    if (!file || file.tenant_id !== user.tenantId || file.client_id !== user.clientId) return { ok: false, error: "forbidden" };
    fileId = file.id;
  }

  const department = input.department as MessagingDepartment;
  const clean = input.message.trim().slice(0, 4000);
  const deptLabel = CONTACT_DEPARTMENT_LABELS[department] ?? department;

  const { data: conv, error } = await admin
    .from("conversation")
    .insert({
      tenant_id: user.tenantId,
      type: "customer_support",
      client_id: user.clientId,
      file_id: fileId,
      department_code: department,
      title: `${deptLabel} — ${user.clientName ?? "Client"}`,
      created_by_client_user_id: user.id,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !conv) return { ok: false, error: "create_failed" };

  await touchPortalParticipant(admin, conv.id, user.tenantId, user.id);

  const { data: msg, error: msgErr } = await admin
    .from("message")
    .insert({
      tenant_id: user.tenantId,
      conversation_id: conv.id,
      sender_type: "customer",
      sender_client_user_id: user.id,
      body: clean,
      message_type: "text",
      visibility: "shared",
    })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "create_failed" };

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_CREATED,
    clientUserId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conv.id,
    after: { type: "customer_support", department, file_id: fileId },
  });
  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    clientUserId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: conv.id },
  });

  const staffIds = await resolveStaffWithPermission(admin, user.tenantId, messagingDepartmentPermission(department));
  await notifyStaffOfMessage({
    admin,
    tenantId: user.tenantId,
    conversationId: conv.id,
    excludeUserId: null,
    recipientUserIds: staffIds,
    title: `Nouvelle demande — ${deptLabel}`,
    body: clean.slice(0, 140),
  });

  revalidatePath("/portal/messages");
  if (fileId) revalidatePath(`/portal/files/${fileId}`);
  return { ok: true, id: conv.id };
}

export async function sendPortalMessage(input: { conversationId: string; body: string }): Promise<MessagingActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };
  const invalid = validateMessageBody(input.body);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversation")
    .select("id, tenant_id, client_id, status, department_code, assigned_to, file_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId || conv.client_id !== user.clientId) return { ok: false, error: "forbidden" };
  if (!canMessageConversation(conv.status as never)) return { ok: false, error: "conversation_closed" };

  const clean = input.body.trim().slice(0, 4000);
  const { data: msg, error } = await admin
    .from("message")
    .insert({
      tenant_id: user.tenantId,
      conversation_id: conv.id,
      sender_type: "customer",
      sender_client_user_id: user.id,
      body: clean,
      message_type: "text",
      visibility: "shared",
    })
    .select("id")
    .single();
  if (error || !msg) return { ok: false, error: "send_failed" };

  await touchPortalParticipant(admin, conv.id, user.tenantId, user.id);

  const nextStatus = nextStatusOnCustomerReply(conv.status as never);
  if (nextStatus !== conv.status) await admin.from("conversation").update({ status: nextStatus }).eq("id", conv.id);
  await admin.from("conversation").update({ updated_at: new Date().toISOString() }).eq("id", conv.id);

  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    clientUserId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: conv.id },
  });

  const recipientIds = conv.assigned_to
    ? [conv.assigned_to]
    : conv.department_code
      ? await resolveStaffWithPermission(admin, user.tenantId, messagingDepartmentPermission(conv.department_code))
      : [];
  await notifyStaffOfMessage({
    admin,
    tenantId: user.tenantId,
    conversationId: conv.id,
    excludeUserId: null,
    recipientUserIds: recipientIds,
    title: "Réponse du client",
    body: clean.slice(0, 140),
  });

  revalidatePath("/portal/messages");
  return { ok: true, id: msg.id };
}

export async function markPortalConversationRead(conversationId: string): Promise<MessagingActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id, client_id").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId || conv.client_id !== user.clientId) return { ok: false, error: "forbidden" };
  await touchPortalParticipant(admin, conv.id, user.tenantId, user.id);
  revalidatePath("/portal/messages");
  return { ok: true, id: conversationId };
}

// ------------------------------------------------------------------ attachments ----

export async function uploadPortalMessageAttachment(conversationId: string, formData: FormData): Promise<MessagingActionResult> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };

  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversation")
    .select("id, tenant_id, client_id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId || conv.client_id !== user.clientId) return { ok: false, error: "forbidden" };
  if (!canMessageConversation(conv.status as never)) return { ok: false, error: "conversation_closed" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "file_required" };

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const invalid = validateAttachmentUpload({ sizeBytes: file.size, mimeType: file.type, headerBytes: header });
  if (invalid) return { ok: false, error: invalid };

  const attachmentId = crypto.randomUUID();
  const path = buildAttachmentStoragePath(user.tenantId, conv.id, attachmentId, attachmentExtension(file.type));
  const uploaded = await uploadAttachmentObject(path, file);
  if (!uploaded.ok) return { ok: false, error: "upload_failed" };

  const filename = sanitizeAttachmentFilename(file.name || "piece-jointe");
  const { data: msg, error: msgErr } = await admin
    .from("message")
    .insert({
      tenant_id: user.tenantId,
      conversation_id: conv.id,
      sender_type: "customer",
      sender_client_user_id: user.id,
      body: `Pièce jointe : ${filename}`,
      message_type: "attachment",
      visibility: "shared",
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    await removeAttachmentObject(path);
    return { ok: false, error: "create_failed" };
  }

  const { error: attErr } = await admin.from("message_attachment").insert({
    id: attachmentId,
    tenant_id: user.tenantId,
    message_id: msg.id,
    storage_path: path,
    original_filename: filename,
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by_client_user_id: user.id,
  });
  if (attErr) {
    await removeAttachmentObject(path);
    return { ok: false, error: "create_failed" };
  }

  await touchPortalParticipant(admin, conv.id, user.tenantId, user.id);
  await admin.from("conversation").update({ updated_at: new Date().toISOString() }).eq("id", conv.id);

  await writeAudit({
    action: AuditActions.MESSAGING_ATTACHMENT_UPLOADED,
    clientUserId: user.id,
    tenantId: user.tenantId,
    entity: "message_attachment",
    entityId: attachmentId,
    after: { conversation_id: conv.id, message_id: msg.id, mime_type: file.type, size_bytes: file.size },
  });

  revalidatePath("/portal/messages");
  return { ok: true, id: msg.id };
}

export async function getPortalAttachmentDownloadUrl(attachmentId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return { ok: false, error: "forbidden" };

  const admin = getAdminSupabaseClient();
  const { data: att } = await admin
    .from("message_attachment")
    .select("id, tenant_id, storage_path, message_id")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!att || att.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  const { data: msg } = await admin
    .from("message")
    .select("conversation_id, visibility")
    .eq("id", att.message_id)
    .maybeSingle();
  if (!msg || msg.visibility !== "shared") return { ok: false, error: "not_found" };

  const { data: conv } = await admin.from("conversation").select("client_id").eq("id", msg.conversation_id).maybeSingle();
  if (!conv || conv.client_id !== user.clientId) return { ok: false, error: "forbidden" };

  const url = await createAttachmentSignedUrl(att.storage_path);
  if (!url) return { ok: false, error: "url_failed" };
  return { ok: true, url };
}
