"use server";

/**
 * Messaging Center — staff server actions (Phase 8.7).
 * ---------------------------------------------------------------------------
 * Same shape as every other module's actions (customs/tasks/portal admin):
 * assertPermission -> tenant/participant re-check via the ADMIN client (RLS has
 * no write policy here, by design, so this re-check IS the authorization) ->
 * write -> writeAudit -> revalidatePath. Sender identity (sender_user_id) is
 * ALWAYS the resolved session user, never a client-supplied value — this is what
 * makes "sender identity cannot be forged" true, not a schema check alone.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { createNotification } from "@/lib/notifications/create";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import {
  messagingDepartmentPermission,
  validateMessageBody,
  validateRedactionReason,
  canCloseConversation,
  canReopenConversation,
  canMessageConversation,
  nextStatusOnStaffReply,
  type MessagingDepartment,
  type StaffRecipient,
} from "./access";
import { notifyStaffOfMessage, notifyPortalOfMessage } from "./notify";
import { listStaffConversations, getStaffConversationDetail } from "./service";
import { searchStaffRecipients } from "./staff-directory";
import {
  attachmentExtension,
  buildAttachmentStoragePath,
  createAttachmentSignedUrl,
  removeAttachmentObject,
  sanitizeAttachmentFilename,
  uploadAttachmentObject,
  validateAttachmentUpload,
} from "./attachments";
import type { ConversationDetail, ConversationStatus, ConversationSummary, MessagingActionResult } from "./types";

type Admin = ReturnType<typeof getAdminSupabaseClient>;

// -------------------------------------------------------------- client-callable reads ----
// Thin "use server" wrappers over lib/messaging/service.ts, exactly like
// lib/notifications/actions.ts wraps getMyNotifications — the Messaging Center client
// component polls these directly (there is no true Realtime channel in this codebase; see
// docs/messaging/architecture.md for why polling was the deliberate, honest choice here).

export async function fetchStaffConversations(status?: ConversationStatus): Promise<ConversationSummary[]> {
  return listStaffConversations(status ? { status } : undefined);
}

export async function fetchStaffConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  return getStaffConversationDetail(conversationId);
}

/**
 * Phase 8.6A — "start a conversation" colleague search. Thin wrapper over
 * lib/messaging/staff-directory.ts, which itself resolves tenant/identity/
 * permission from the session — this function accepts nothing the caller could
 * use to widen the search beyond their own tenant.
 */
export async function searchMessagingRecipients(query: string): Promise<StaffRecipient[]> {
  return searchStaffRecipients(query);
}

type ConversationAccessRow = {
  id: string;
  tenant_id: string;
  type: string;
  department_code: string | null;
  status: string;
  client_id: string | null;
  file_id: string | null;
  assigned_to: string | null;
};

/** Load a conversation + verify the CURRENT staff user may access it (mirrors the RLS predicate in the migration). */
async function loadConversationForStaff(
  admin: Admin,
  conversationId: string,
  userId: string,
  tenantId: string,
  permissions: string[],
): Promise<ConversationAccessRow | null> {
  const { data: conv } = await admin
    .from("conversation")
    .select("id, tenant_id, type, department_code, status, client_id, file_id, assigned_to")
    .eq("id", conversationId)
    .maybeSingle<ConversationAccessRow>();
  if (!conv || conv.tenant_id !== tenantId) return null;

  if (permissions.includes("messaging:manage")) return conv;
  if (conv.department_code && permissions.includes(messagingDepartmentPermission(conv.department_code))) return conv;

  const { data: participant } = await admin
    .from("conversation_participant")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  return participant ? conv : null;
}

/**
 * Insert-or-update a participant's last_read_at. NOT an .upsert() — the real
 * uniqueness constraint is a PARTIAL index (conversation_id, user_id) WHERE
 * removed_at IS NULL, which supabase-js's onConflict (a plain column list) cannot
 * target, so this does the select-then-branch by hand.
 */
async function touchStaffParticipant(admin: Admin, conversationId: string, tenantId: string, userId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: existing } = await admin
    .from("conversation_participant")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (existing) {
    await admin.from("conversation_participant").update({ last_read_at: nowIso }).eq("id", existing.id);
  } else {
    await admin
      .from("conversation_participant")
      .insert({ tenant_id: tenantId, conversation_id: conversationId, participant_type: "staff", user_id: userId, last_read_at: nowIso });
  }
}

// ------------------------------------------------------------ conversation create ----

/**
 * Phase 8.6A — an OPEN direct_staff conversation where BOTH users are still
 * current (non-removed) participants, newest first. A repeated "start a
 * conversation with the same colleague" reuses this thread instead of spawning a
 * new one every time; a CLOSED prior thread does not count (a fresh one begins).
 */
async function findOpenDirectConversation(admin: Admin, tenantId: string, userAId: string, userBId: string): Promise<string | null> {
  const { data: mine } = await admin
    .from("conversation_participant")
    .select("conversation_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userAId)
    .is("removed_at", null);
  const mineIds = (mine ?? []).map((r) => r.conversation_id);
  if (mineIds.length === 0) return null;

  const { data: theirs } = await admin
    .from("conversation_participant")
    .select("conversation_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userBId)
    .is("removed_at", null)
    .in("conversation_id", mineIds);
  const sharedIds = (theirs ?? []).map((r) => r.conversation_id);
  if (sharedIds.length === 0) return null;

  const { data: convs } = await admin
    .from("conversation")
    .select("id, updated_at")
    .in("id", sharedIds)
    .eq("type", "direct_staff")
    .neq("status", "closed")
    .order("updated_at", { ascending: false })
    .limit(1);
  return convs?.[0]?.id ?? null;
}

export async function createDirectConversation(input: {
  participantUserId: string;
  firstMessage: string;
}): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateMessageBody(input.firstMessage);
  if (invalid) return { ok: false, error: invalid };
  if (input.participantUserId === user.id) return { ok: false, error: "cannot_message_self" };

  const admin = getAdminSupabaseClient();
  const { data: other } = await admin
    .from("app_user")
    .select("id, tenant_id, status")
    .eq("id", input.participantUserId)
    .maybeSingle();
  if (!other || other.tenant_id !== user.tenantId || other.status !== "active") return { ok: false, error: "not_found" };

  const existingConvId = await findOpenDirectConversation(admin, user.tenantId, user.id, other.id);

  let convId: string;
  if (existingConvId) {
    convId = existingConvId;
  } else {
    const { data: conv, error } = await admin
      .from("conversation")
      .insert({ tenant_id: user.tenantId, type: "direct_staff", created_by: user.id, status: "open" })
      .select("id")
      .single();
    if (error || !conv) return { ok: false, error: "create_failed" };
    convId = conv.id;

    await admin.from("conversation_participant").insert([
      { tenant_id: user.tenantId, conversation_id: convId, participant_type: "staff", user_id: user.id, last_read_at: new Date().toISOString() },
      { tenant_id: user.tenantId, conversation_id: convId, participant_type: "staff", user_id: other.id },
    ]);

    await writeAudit({
      action: AuditActions.MESSAGING_CONVERSATION_CREATED,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "conversation",
      entityId: convId,
      after: { type: "direct_staff", participant: other.id },
    });
  }

  const clean = input.firstMessage.trim().slice(0, 4000);
  const { data: msg, error: msgErr } = await admin
    .from("message")
    .insert({ tenant_id: user.tenantId, conversation_id: convId, sender_type: "staff", sender_user_id: user.id, body: clean, message_type: "text", visibility: "shared" })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "create_failed" };

  await touchStaffParticipant(admin, convId, user.tenantId, user.id);
  await admin.from("conversation").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: convId, message_type: "text" },
  });

  await notifyStaffOfMessage({
    admin,
    tenantId: user.tenantId,
    conversationId: convId,
    excludeUserId: user.id,
    recipientUserIds: [other.id],
    title: "Nouveau message",
    body: clean.slice(0, 140),
  });

  revalidatePath("/messages");
  return { ok: true, id: convId };
}

export async function createDossierConversation(input: {
  fileId: string;
  participantUserIds?: string[];
  title?: string;
  firstMessage: string;
}): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateMessageBody(input.firstMessage);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();
  const { data: file } = await admin
    .from("operational_file")
    .select("id, tenant_id, file_number")
    .eq("id", input.fileId)
    .maybeSingle();
  if (!file || file.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  const { data: conv, error } = await admin
    .from("conversation")
    .insert({ tenant_id: user.tenantId, type: "dossier", file_id: file.id, title: input.title?.trim() || null, created_by: user.id, status: "open" })
    .select("id")
    .single();
  if (error || !conv) return { ok: false, error: "create_failed" };

  const others = (input.participantUserIds ?? []).filter((id) => id !== user.id);
  await admin.from("conversation_participant").insert([
    { tenant_id: user.tenantId, conversation_id: conv.id, participant_type: "staff", user_id: user.id, last_read_at: new Date().toISOString() },
    ...others.map((id) => ({ tenant_id: user.tenantId, conversation_id: conv.id, participant_type: "staff", user_id: id })),
  ]);

  const clean = input.firstMessage.trim().slice(0, 4000);
  const { data: msg, error: msgErr } = await admin
    .from("message")
    .insert({ tenant_id: user.tenantId, conversation_id: conv.id, sender_type: "staff", sender_user_id: user.id, body: clean, message_type: "text", visibility: "shared" })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "create_failed" };

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conv.id,
    after: { type: "dossier", file_id: file.id },
  });
  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: conv.id, message_type: "text" },
  });

  await notifyStaffOfMessage({
    admin,
    tenantId: user.tenantId,
    conversationId: conv.id,
    excludeUserId: user.id,
    recipientUserIds: others,
    title: `Dossier ${file.file_number}`,
    body: clean.slice(0, 140),
  });

  revalidatePath("/messages");
  revalidatePath(`/files/${file.id}`);
  return { ok: true, id: conv.id };
}

/**
 * A department-wide internal thread. Any staff holding messaging:read:<dept> for
 * THIS department gains access lazily (department access is permission-based, not
 * an explicit participant list — see the migration's RLS predicate); this action
 * only requires the CREATOR to hold that same permission.
 */
export async function createDepartmentConversation(input: {
  department: MessagingDepartment;
  title?: string;
  firstMessage: string;
}): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission(messagingDepartmentPermission(input.department));
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateMessageBody(input.firstMessage);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();
  const { data: conv, error } = await admin
    .from("conversation")
    .insert({ tenant_id: user.tenantId, type: "department", department_code: input.department, title: input.title?.trim() || null, created_by: user.id, status: "open" })
    .select("id")
    .single();
  if (error || !conv) return { ok: false, error: "create_failed" };

  await admin
    .from("conversation_participant")
    .insert({ tenant_id: user.tenantId, conversation_id: conv.id, participant_type: "staff", user_id: user.id, last_read_at: new Date().toISOString() });

  const clean = input.firstMessage.trim().slice(0, 4000);
  const { data: msg, error: msgErr } = await admin
    .from("message")
    .insert({ tenant_id: user.tenantId, conversation_id: conv.id, sender_type: "staff", sender_user_id: user.id, body: clean, message_type: "text", visibility: "shared" })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "create_failed" };

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_CREATED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conv.id,
    after: { type: "department", department: input.department },
  });
  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: conv.id, message_type: "text" },
  });

  revalidatePath("/messages");
  return { ok: true, id: conv.id };
}

// ------------------------------------------------------------------ send / read ----

export async function sendMessage(input: {
  conversationId: string;
  body: string;
  visibility?: "shared" | "internal";
  replyToMessageId?: string;
}): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateMessageBody(input.body);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();
  const permissions = await getEffectivePermissions(user.id);
  const conv = await loadConversationForStaff(admin, input.conversationId, user.id, user.tenantId, permissions);
  if (!conv) return { ok: false, error: "forbidden" };
  if (!canMessageConversation(conv.status as ConversationStatus)) return { ok: false, error: "conversation_closed" };

  const visibility = input.visibility === "internal" ? "internal" : "shared";
  const clean = input.body.trim().slice(0, 4000);

  const { data: msg, error } = await admin
    .from("message")
    .insert({
      tenant_id: user.tenantId,
      conversation_id: conv.id,
      sender_type: "staff",
      sender_user_id: user.id,
      body: clean,
      message_type: "text",
      visibility,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select("id")
    .single();
  if (error || !msg) return { ok: false, error: "send_failed" };

  await touchStaffParticipant(admin, conv.id, user.tenantId, user.id);

  if (conv.type === "customer_support" && visibility === "shared") {
    const nextStatus = nextStatusOnStaffReply(conv.status as ConversationStatus);
    if (nextStatus !== conv.status) await admin.from("conversation").update({ status: nextStatus }).eq("id", conv.id);
  }
  await admin.from("conversation").update({ updated_at: new Date().toISOString() }).eq("id", conv.id);

  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_SENT,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: msg.id,
    after: { conversation_id: conv.id, message_type: "text", visibility },
  });

  if (visibility === "shared") {
    if (conv.type === "customer_support" && conv.client_id) {
      await notifyPortalOfMessage({
        admin,
        tenantId: user.tenantId,
        clientId: conv.client_id,
        conversationId: conv.id,
        fileId: conv.file_id,
        title: "Nouvelle réponse d'Effitrans",
        body: clean.slice(0, 140),
        messageId: msg.id,
      });
    }
    const { data: others } = await admin
      .from("conversation_participant")
      .select("user_id")
      .eq("conversation_id", conv.id)
      .eq("participant_type", "staff")
      .is("removed_at", null);
    const recipientIds = (others ?? []).map((o) => o.user_id).filter((id): id is string => Boolean(id));
    await notifyStaffOfMessage({
      admin,
      tenantId: user.tenantId,
      conversationId: conv.id,
      excludeUserId: user.id,
      recipientUserIds: recipientIds,
      title: "Nouveau message",
      body: clean.slice(0, 140),
    });
  }

  revalidatePath("/messages");
  return { ok: true, id: msg.id };
}

export async function markStaffConversationRead(conversationId: string): Promise<MessagingActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };
  const admin = getAdminSupabaseClient();
  const permissions = await getEffectivePermissions(user.id);
  const conv = await loadConversationForStaff(admin, conversationId, user.id, user.tenantId, permissions);
  if (!conv) return { ok: false, error: "forbidden" };
  await touchStaffParticipant(admin, conv.id, user.tenantId, user.id);
  revalidatePath("/messages");
  return { ok: true, id: conversationId };
}

// -------------------------------------------------------------------- management ----

export async function assignConversation(conversationId: string, assigneeUserId: string | null): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id, assigned_to").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  if (assigneeUserId) {
    const { data: assignee } = await admin
      .from("app_user")
      .select("id, status")
      .eq("id", assigneeUserId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
    if (!assignee || assignee.status !== "active") return { ok: false, error: "invalid_assignee" };
  }

  await admin.from("conversation").update({ assigned_to: assigneeUserId }).eq("id", conversationId);
  if (assigneeUserId) await touchStaffParticipant(admin, conversationId, user.tenantId, assigneeUserId);

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_ASSIGNED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conversationId,
    before: { assigned_to: conv.assigned_to },
    after: { assigned_to: assigneeUserId },
  });

  if (assigneeUserId && assigneeUserId !== user.id) {
    await createNotification({
      tenantId: user.tenantId,
      userId: assigneeUserId,
      type: "CONVERSATION_ASSIGNED",
      title: "Conversation assignée",
      body: "Une conversation client vous a été assignée.",
    });
  }

  revalidatePath("/messages");
  return { ok: true, id: conversationId };
}

export async function setConversationPriority(conversationId: string, priority: "normal" | "urgent"): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  await admin.from("conversation").update({ priority }).eq("id", conversationId);
  revalidatePath("/messages");
  return { ok: true, id: conversationId };
}

export async function closeConversation(conversationId: string): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id, status").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };
  if (!canCloseConversation(conv.status as ConversationStatus)) return { ok: false, error: "already_closed" };

  await admin.from("conversation").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", conversationId);
  await admin.from("message").insert({
    tenant_id: user.tenantId,
    conversation_id: conversationId,
    sender_type: "system",
    sender_user_id: user.id,
    body: "Conversation clôturée.",
    message_type: "system_event",
    visibility: "shared",
  });

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_CLOSED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conversationId,
    before: { status: conv.status },
    after: { status: "closed" },
  });
  revalidatePath("/messages");
  return { ok: true, id: conversationId };
}

export async function reopenConversation(conversationId: string): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id, status").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };
  if (!canReopenConversation(conv.status as ConversationStatus)) return { ok: false, error: "not_closed" };

  await admin.from("conversation").update({ status: "open", closed_at: null }).eq("id", conversationId);
  await admin.from("message").insert({
    tenant_id: user.tenantId,
    conversation_id: conversationId,
    sender_type: "system",
    sender_user_id: user.id,
    body: "Conversation rouverte.",
    message_type: "system_event",
    visibility: "shared",
  });

  await writeAudit({
    action: AuditActions.MESSAGING_CONVERSATION_REOPENED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation",
    entityId: conversationId,
    before: { status: conv.status },
    after: { status: "open" },
  });
  revalidatePath("/messages");
  return { ok: true, id: conversationId };
}

export async function addParticipant(conversationId: string, userId: string): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin.from("conversation").select("id, tenant_id").eq("id", conversationId).maybeSingle();
  if (!conv || conv.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  const { data: target } = await admin.from("app_user").select("id, status").eq("id", userId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!target || target.status !== "active") return { ok: false, error: "not_found" };

  const { data: existing } = await admin
    .from("conversation_participant")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id };

  const { data: created, error } = await admin
    .from("conversation_participant")
    .insert({ tenant_id: user.tenantId, conversation_id: conversationId, participant_type: "staff", user_id: userId })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: "add_failed" };

  await writeAudit({
    action: AuditActions.MESSAGING_PARTICIPANT_ADDED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation_participant",
    entityId: created.id,
    after: { conversation_id: conversationId, user_id: userId },
  });
  revalidatePath("/messages");
  return { ok: true, id: created.id };
}

export async function removeParticipant(participantId: string): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const admin = getAdminSupabaseClient();
  const { data: p } = await admin
    .from("conversation_participant")
    .select("id, tenant_id, conversation_id, user_id")
    .eq("id", participantId)
    .maybeSingle();
  if (!p || p.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  await admin.from("conversation_participant").update({ removed_at: new Date().toISOString() }).eq("id", participantId);

  await writeAudit({
    action: AuditActions.MESSAGING_PARTICIPANT_REMOVED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "conversation_participant",
    entityId: participantId,
    before: { user_id: p.user_id },
    after: { conversation_id: p.conversation_id },
  });
  revalidatePath("/messages");
  return { ok: true, id: participantId };
}

export async function redactMessage(messageId: string, reason: string): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:moderate");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const invalid = validateRedactionReason(reason);
  if (invalid) return { ok: false, error: invalid };

  const admin = getAdminSupabaseClient();
  const { data: msg } = await admin
    .from("message")
    .select("id, tenant_id, conversation_id, redacted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };
  if (msg.redacted_at) return { ok: false, error: "already_redacted" };

  const cleanReason = reason.trim();
  await admin
    .from("message")
    .update({
      body: "[Message supprimé par la modération]",
      redacted_at: new Date().toISOString(),
      redacted_by: user.id,
      redaction_reason: cleanReason,
    })
    .eq("id", messageId);

  await writeAudit({
    action: AuditActions.MESSAGING_MESSAGE_REDACTED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message",
    entityId: messageId,
    after: { conversation_id: msg.conversation_id, reason: cleanReason },
  });
  revalidatePath("/messages");
  return { ok: true, id: messageId };
}

// ------------------------------------------------------------------ attachments ----

export async function uploadMessageAttachment(conversationId: string, formData: FormData): Promise<MessagingActionResult> {
  let user;
  try {
    user = await assertPermission("messaging:send");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const admin = getAdminSupabaseClient();
  const permissions = await getEffectivePermissions(user.id);
  const conv = await loadConversationForStaff(admin, conversationId, user.id, user.tenantId, permissions);
  if (!conv) return { ok: false, error: "forbidden" };
  if (!canMessageConversation(conv.status as ConversationStatus)) return { ok: false, error: "conversation_closed" };

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
      sender_type: "staff",
      sender_user_id: user.id,
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
    uploaded_by_user_id: user.id,
  });
  if (attErr) {
    await removeAttachmentObject(path);
    return { ok: false, error: "create_failed" };
  }

  await touchStaffParticipant(admin, conv.id, user.tenantId, user.id);
  await admin.from("conversation").update({ updated_at: new Date().toISOString() }).eq("id", conv.id);

  await writeAudit({
    action: AuditActions.MESSAGING_ATTACHMENT_UPLOADED,
    actorId: user.id,
    tenantId: user.tenantId,
    entity: "message_attachment",
    entityId: attachmentId,
    after: { conversation_id: conv.id, message_id: msg.id, mime_type: file.type, size_bytes: file.size },
  });

  revalidatePath("/messages");
  return { ok: true, id: msg.id };
}

export async function getStaffAttachmentDownloadUrl(attachmentId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };

  const admin = getAdminSupabaseClient();
  const { data: att } = await admin
    .from("message_attachment")
    .select("id, tenant_id, storage_path, message_id")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!att || att.tenant_id !== user.tenantId) return { ok: false, error: "not_found" };

  const { data: msg } = await admin.from("message").select("conversation_id").eq("id", att.message_id).maybeSingle();
  if (!msg) return { ok: false, error: "not_found" };

  const permissions = await getEffectivePermissions(user.id);
  const conv = await loadConversationForStaff(admin, msg.conversation_id, user.id, user.tenantId, permissions);
  if (!conv) return { ok: false, error: "forbidden" };

  const url = await createAttachmentSignedUrl(att.storage_path);
  if (!url) return { ok: false, error: "url_failed" };
  return { ok: true, url };
}
