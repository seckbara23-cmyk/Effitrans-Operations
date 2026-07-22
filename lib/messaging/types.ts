/**
 * Messaging Center shared types (Phase 8.7). Client + server safe.
 * ---------------------------------------------------------------------------
 * Department codes are NOT redefined here — they are reused verbatim from
 * lib/portal/self-service.ts's existing CONTACT_DEPARTMENTS (see access.ts),
 * so there is exactly one department vocabulary in the codebase, not two.
 */
import type { MessagingDepartment } from "./access";

export const CONVERSATION_TYPES = ["direct_staff", "department", "dossier", "customer_support"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const CONVERSATION_STATUSES = ["open", "waiting_customer", "waiting_effitrans", "resolved", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_PRIORITIES = ["normal", "urgent"] as const;
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number];

export const SENDER_TYPES = ["staff", "customer", "system", "ai"] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export const MESSAGE_TYPES = ["text", "attachment", "system_event"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_VISIBILITIES = ["shared", "internal"] as const;
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];

export const PARTICIPANT_TYPES = ["staff", "customer", "department", "system"] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

/** A conversation row, projected for a LIST view (staff or portal). */
export type ConversationSummary = {
  id: string;
  type: ConversationType;
  title: string | null;
  clientId: string | null;
  clientName: string | null;
  fileId: string | null;
  fileNumber: string | null;
  departmentCode: MessagingDepartment | null;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedTo: string | null;
  assignedToName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  closedAt: string | null;
};

export type MessageAttachmentItem = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

/** A message, projected for display. Never carries a raw app_user/client_user id. */
export type MessageItem = {
  id: string;
  conversationId: string;
  senderType: SenderType;
  /** Resolved display name — "Jean Dupont", "Adja Gueye (Caetano)", "Effitrans", "Assistant IA". */
  senderName: string;
  /** Staff role label (French), customer-safe — never a raw role CODE. Null for customer/system/ai. */
  senderRoleLabel: string | null;
  body: string;
  messageType: MessageType;
  visibility: MessageVisibility;
  replyToMessageId: string | null;
  createdAt: string;
  redactedAt: string | null;
  attachments: MessageAttachmentItem[];
};

export type ConversationParticipantItem = {
  id: string;
  participantType: ParticipantType;
  displayName: string;
  roleLabel: string | null;
  departmentCode: MessagingDepartment | null;
  lastReadAt: string | null;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: MessageItem[];
  participants: ConversationParticipantItem[];
  /** Whether the CURRENT viewer may send into this conversation right now. */
  canSend: boolean;
  canManage: boolean;
  canModerate: boolean;
};

export type MessagingActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
