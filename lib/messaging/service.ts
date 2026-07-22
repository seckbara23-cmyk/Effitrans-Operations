/**
 * Messaging Center reads (Phase 8.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ALL reads here go through the RLS-respecting user-context client
 * (getServerSupabaseClient) — never the admin client. RLS on conversation /
 * conversation_participant / message / message_attachment (supabase/migrations/
 * 20260722000001_messaging_center.sql) already encodes the exact visibility rule
 * (participant, OR department permission, OR messaging:manage for staff; own
 * client_id for portal; shared-only for portal). So unlike most other reads in
 * this codebase there is no separate "visibility scope" helper to duplicate here
 * — the query IS the authorization.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { primaryRoleLabel, roleLabel } from "@/lib/navigation/roles";
import { countUnreadPerConversation } from "./access";
import type { MessagingDepartment } from "./access";
import type {
  ConversationDetail,
  ConversationParticipantItem,
  ConversationStatus,
  ConversationSummary,
  MessageItem,
} from "./types";

type ConversationRow = {
  id: string;
  type: string;
  title: string | null;
  client_id: string | null;
  client: { name: string } | null;
  file_id: string | null;
  file: { file_number: string } | null;
  department_code: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  assignee: { name: string | null; email: string } | null;
  created_at: string;
  closed_at: string | null;
};

function embeddedOne<T>(rel: unknown): T | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  return (row ?? null) as T | null;
}

const CONVERSATION_SELECT =
  "id, type, title, client_id, client:client_id(name), file_id, file:file_id(file_number), department_code, status, priority, assigned_to, assignee:assigned_to(name, email), created_at, closed_at";

function toSummaryBase(r: ConversationRow): Omit<ConversationSummary, "lastMessagePreview" | "lastMessageAt" | "unreadCount"> {
  const client = embeddedOne<{ name: string }>(r.client);
  const file = embeddedOne<{ file_number: string }>(r.file);
  const assignee = embeddedOne<{ name: string | null; email: string }>(r.assignee);
  return {
    id: r.id,
    type: r.type as ConversationSummary["type"],
    title: r.title,
    clientId: r.client_id,
    clientName: client?.name ?? null,
    fileId: r.file_id,
    fileNumber: file?.file_number ?? null,
    departmentCode: (r.department_code as MessagingDepartment | null) ?? null,
    status: r.status as ConversationStatus,
    priority: r.priority as ConversationSummary["priority"],
    assignedTo: r.assigned_to,
    assignedToName: assignee?.name ?? assignee?.email ?? null,
    createdAt: r.created_at,
    closedAt: r.closed_at,
  };
}

type LastMessageRow = { conversation_id: string; body: string; created_at: string; visibility: string; redacted_at: string | null };

/** Latest message per conversation id, from a flat query ordered newest-first. */
function latestPerConversation(rows: LastMessageRow[]): Map<string, LastMessageRow> {
  const out = new Map<string, LastMessageRow>();
  for (const r of rows) if (!out.has(r.conversation_id)) out.set(r.conversation_id, r);
  return out;
}

function previewOf(r: LastMessageRow | undefined): string | null {
  if (!r) return null;
  if (r.redacted_at) return "[Message supprimé]";
  return r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body;
}

// ============================================================== staff reads ==

/** Conversations the CURRENT staff user may see (RLS-scoped), newest activity first. */
export async function listStaffConversations(opts?: { status?: ConversationStatus }): Promise<ConversationSummary[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = getServerSupabaseClient();

  let query = supabase.from("conversation").select(CONVERSATION_SELECT).order("updated_at", { ascending: false });
  if (opts?.status) query = query.eq("status", opts.status);
  const { data } = await query.returns<ConversationRow[]>();
  const conversations = data ?? [];
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);
  const [{ data: msgRows }, { data: participantRows }] = await Promise.all([
    supabase
      .from("message")
      .select("conversation_id, body, created_at, visibility, redacted_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .returns<LastMessageRow[]>(),
    supabase
      .from("conversation_participant")
      .select("conversation_id, last_read_at")
      .in("conversation_id", ids)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .returns<{ conversation_id: string; last_read_at: string | null }[]>(),
  ]);

  const latest = latestPerConversation(msgRows ?? []);
  const lastReadByConv = new Map((participantRows ?? []).map((p) => [p.conversation_id, p.last_read_at]));
  const unreadCounts = countUnread(msgRows ?? [], lastReadByConv);

  return conversations.map((c) => ({
    ...toSummaryBase(c),
    lastMessagePreview: previewOf(latest.get(c.id)),
    lastMessageAt: latest.get(c.id)?.created_at ?? null,
    unreadCount: unreadCounts.get(c.id) ?? 0,
  }));
}

/** Adapts the DB row shape to countUnreadPerConversation's pure (camelCase) input. */
function countUnread(msgRows: LastMessageRow[], lastReadByConv: Map<string, string | null>): Map<string, number> {
  return countUnreadPerConversation(
    msgRows.map((m) => ({ conversationId: m.conversation_id, createdAt: m.created_at })),
    lastReadByConv,
  );
}

/** Total unread conversation-messages for the Messaging Center nav badge. */
export async function unreadStaffMessagingCount(): Promise<number> {
  const list = await listStaffConversations();
  return list.reduce((sum, c) => sum + c.unreadCount, 0);
}

export async function getStaffConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = getServerSupabaseClient();

  const { data: row } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();
  if (!row) return null; // RLS already denies an inaccessible conversation

  const [{ data: msgRows }, { data: participantRows }, permissions] = await Promise.all([
    supabase
      .from("message")
      .select(
        "id, conversation_id, sender_type, sender_user_id, sender:sender_user_id(name, email), sender_client_user_id, portal_sender:sender_client_user_id(name, email), body, message_type, visibility, reply_to_message_id, created_at, redacted_at, attachments:message_attachment(id, original_filename, mime_type, size_bytes, created_at)",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .returns<MessageRow[]>(),
    supabase
      .from("conversation_participant")
      .select(
        "id, participant_type, department_code, last_read_at, user_id, staff:user_id(name, email), client_user_id, portal_user:client_user_id(name, email)",
      )
      .eq("conversation_id", conversationId)
      .is("removed_at", null)
      .returns<ParticipantRow[]>(),
    getEffectivePermissions(user.id),
  ]);

  const staffRoles = await staffRolesFor(supabase, user.id);
  const messages = (msgRows ?? []).map((m) => toMessageItem(m, staffRoles));
  const participants = (participantRows ?? []).map(toParticipantItem);

  return {
    conversation: {
      ...toSummaryBase(row),
      lastMessagePreview: previewOf(messages.length ? { ...messagesToLast(messages) } : undefined),
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : null,
      unreadCount: 0, // the caller is viewing it now; marking read is a separate explicit action
    },
    messages,
    participants,
    canSend: row.status !== "closed" && permissions.includes("messaging:send"),
    canManage: permissions.includes("messaging:manage"),
    canModerate: permissions.includes("messaging:moderate"),
  };
}

function messagesToLast(messages: MessageItem[]): LastMessageRow {
  const last = messages[messages.length - 1];
  return { conversation_id: last.conversationId, body: last.body, created_at: last.createdAt, visibility: last.visibility, redacted_at: last.redactedAt };
}

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_user_id: string | null;
  sender: { name: string | null; email: string } | { name: string | null; email: string }[] | null;
  sender_client_user_id: string | null;
  portal_sender: { name: string | null; email: string } | { name: string | null; email: string }[] | null;
  body: string;
  message_type: string;
  visibility: string;
  reply_to_message_id: string | null;
  created_at: string;
  redacted_at: string | null;
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string }[] | null;
};

async function staffRolesFor(supabase: ReturnType<typeof getServerSupabaseClient>, userId: string): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from("user_role")
    .select("user_id, role:role_id(code)")
    .eq("user_id", userId)
    .returns<{ user_id: string; role: { code: string } | { code: string }[] | null }[]>();
  const map = new Map<string, string[]>();
  for (const r of data ?? []) {
    const role = embeddedOne<{ code: string }>(r.role);
    if (!role) continue;
    const list = map.get(r.user_id) ?? [];
    list.push(role.code);
    map.set(r.user_id, list);
  }
  return map;
}

function toMessageItem(m: MessageRow, staffRoles: Map<string, string[]>): MessageItem {
  const sender = embeddedOne<{ name: string | null; email: string }>(m.sender);
  const portalSender = embeddedOne<{ name: string | null; email: string }>(m.portal_sender);
  let senderName = "Effitrans";
  let senderRoleLabel: string | null = null;
  if (m.sender_type === "staff" && sender) {
    senderName = sender.name ?? sender.email;
    senderRoleLabel = m.sender_user_id ? primaryRoleLabel(staffRoles.get(m.sender_user_id) ?? []) : null;
  } else if (m.sender_type === "customer" && portalSender) {
    senderName = portalSender.name ?? portalSender.email;
  } else if (m.sender_type === "ai") {
    senderName = "Assistant IA";
  }
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderType: m.sender_type as MessageItem["senderType"],
    senderName,
    senderRoleLabel,
    body: m.redacted_at ? "[Message supprimé]" : m.body,
    messageType: m.message_type as MessageItem["messageType"],
    visibility: m.visibility as MessageItem["visibility"],
    replyToMessageId: m.reply_to_message_id,
    createdAt: m.created_at,
    redactedAt: m.redacted_at,
    attachments: m.redacted_at
      ? []
      : (m.attachments ?? []).map((a) => ({
          id: a.id,
          originalFilename: a.original_filename,
          mimeType: a.mime_type,
          sizeBytes: a.size_bytes,
          createdAt: a.created_at,
        })),
  };
}

type ParticipantRow = {
  id: string;
  participant_type: string;
  department_code: string | null;
  last_read_at: string | null;
  user_id: string | null;
  staff: { name: string | null; email: string } | { name: string | null; email: string }[] | null;
  client_user_id: string | null;
  portal_user: { name: string | null; email: string } | { name: string | null; email: string }[] | null;
};

function toParticipantItem(p: ParticipantRow): ConversationParticipantItem {
  const staff = embeddedOne<{ name: string | null; email: string }>(p.staff);
  const portalUser = embeddedOne<{ name: string | null; email: string }>(p.portal_user);
  const displayName =
    p.participant_type === "staff"
      ? staff?.name ?? staff?.email ?? "—"
      : p.participant_type === "customer"
        ? portalUser?.name ?? portalUser?.email ?? "—"
        : p.participant_type === "department"
          ? roleLabel(p.department_code ?? "") ?? p.department_code ?? "—"
          : "Système";
  return {
    id: p.id,
    participantType: p.participant_type as ConversationParticipantItem["participantType"],
    displayName,
    roleLabel: null, // resolved lazily per-message via primaryRoleLabel; not needed on the roster chip
    departmentCode: (p.department_code as MessagingDepartment | null) ?? null,
    lastReadAt: p.last_read_at,
  };
}

// ============================================================== portal reads ==

/** Conversations the CURRENT portal customer may see (own client only, RLS-scoped). */
export async function listPortalConversations(): Promise<ConversationSummary[]> {
  const user = await getCurrentPortalUser();
  if (!user) return [];
  const supabase = getServerSupabaseClient();

  const { data } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .order("updated_at", { ascending: false })
    .returns<ConversationRow[]>();
  const conversations = data ?? [];
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);
  const [{ data: msgRows }, { data: participantRows }] = await Promise.all([
    supabase
      .from("message")
      .select("conversation_id, body, created_at, visibility, redacted_at")
      .in("conversation_id", ids)
      .eq("visibility", "shared") // portal never sees internal notes, even for the preview
      .order("created_at", { ascending: false })
      .returns<LastMessageRow[]>(),
    supabase
      .from("conversation_participant")
      .select("conversation_id, last_read_at")
      .in("conversation_id", ids)
      .eq("client_user_id", user.id)
      .is("removed_at", null)
      .returns<{ conversation_id: string; last_read_at: string | null }[]>(),
  ]);

  const latest = latestPerConversation(msgRows ?? []);
  const lastReadByConv = new Map((participantRows ?? []).map((p) => [p.conversation_id, p.last_read_at]));
  const unreadCounts = countUnread(msgRows ?? [], lastReadByConv);

  return conversations.map((c) => ({
    ...toSummaryBase(c),
    lastMessagePreview: previewOf(latest.get(c.id)),
    lastMessageAt: latest.get(c.id)?.created_at ?? null,
    unreadCount: unreadCounts.get(c.id) ?? 0,
  }));
}

export async function getPortalConversationDetail(conversationId: string): Promise<ConversationDetail | null> {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return null;
  const supabase = getServerSupabaseClient();

  const { data: row } = await supabase
    .from("conversation")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();
  if (!row) return null; // RLS denies another customer's conversation

  const { data: msgRows } = await supabase
    .from("message")
    .select(
      "id, conversation_id, sender_type, sender_user_id, sender:sender_user_id(name, email), sender_client_user_id, portal_sender:sender_client_user_id(name, email), body, message_type, visibility, reply_to_message_id, created_at, redacted_at, attachments:message_attachment(id, original_filename, mime_type, size_bytes, created_at)",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>(); // RLS already filters visibility='shared' for this client

  const messages = (msgRows ?? []).map((m) => toMessageItem(m, new Map()));

  return {
    conversation: {
      ...toSummaryBase(row),
      lastMessagePreview: previewOf(messages.length ? messagesToLast(messages) : undefined),
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : null,
      unreadCount: 0,
    },
    messages,
    participants: [], // customer view never surfaces the raw participant roster (no employee directory)
    canSend: row.status !== "closed",
    canManage: false,
    canModerate: false,
  };
}
