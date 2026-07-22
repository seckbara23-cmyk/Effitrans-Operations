/**
 * Messaging Center access rules (Phase 8.7) — PURE, unit-tested. No I/O.
 * ---------------------------------------------------------------------------
 * Department codes are REUSED, not reinvented: CONTACT_DEPARTMENTS already exists
 * (lib/portal/self-service.ts, Phase 3.3B) as the exact vocabulary the "Contacter
 * Effitrans" form routes on. Messaging Center conversations are tagged with the
 * SAME five codes so there is one department registry in the codebase, not two.
 */
import { CONTACT_DEPARTMENTS, isValidContactDepartment } from "@/lib/portal/self-service";
import {
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  CONVERSATION_TYPES,
  MESSAGE_TYPES,
  MESSAGE_VISIBILITIES,
  PARTICIPANT_TYPES,
  SENDER_TYPES,
  type ConversationPriority,
  type ConversationStatus,
  type ConversationType,
  type MessageType,
  type MessageVisibility,
  type ParticipantType,
  type SenderType,
} from "./types";

export const MESSAGING_DEPARTMENTS = CONTACT_DEPARTMENTS;
export type MessagingDepartment = (typeof CONTACT_DEPARTMENTS)[number];
export const isValidMessagingDepartment = isValidContactDepartment;

/** The permission code that grants read/send access to a department's conversations. */
export function messagingDepartmentPermission(department: string): string {
  return `messaging:read:${department}`;
}

export function isValidConversationType(v: string): v is ConversationType {
  return (CONVERSATION_TYPES as readonly string[]).includes(v);
}
export function isValidConversationStatus(v: string): v is ConversationStatus {
  return (CONVERSATION_STATUSES as readonly string[]).includes(v);
}
export function isValidConversationPriority(v: string): v is ConversationPriority {
  return (CONVERSATION_PRIORITIES as readonly string[]).includes(v);
}
export function isValidSenderType(v: string): v is SenderType {
  return (SENDER_TYPES as readonly string[]).includes(v);
}
export function isValidMessageType(v: string): v is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(v);
}
export function isValidMessageVisibility(v: string): v is MessageVisibility {
  return (MESSAGE_VISIBILITIES as readonly string[]).includes(v);
}
export function isValidParticipantType(v: string): v is ParticipantType {
  return (PARTICIPANT_TYPES as readonly string[]).includes(v);
}

export const MESSAGE_BODY_MIN = 1;
export const MESSAGE_BODY_MAX = 4000;

/** Validate a message body; returns a stable error code or null. */
export function validateMessageBody(body: string): "message_required" | "message_too_long" | null {
  const trimmed = (body ?? "").trim();
  if (trimmed.length < MESSAGE_BODY_MIN) return "message_required";
  if (trimmed.length > MESSAGE_BODY_MAX) return "message_too_long";
  return null;
}

export const REDACTION_REASON_MIN = 3;
export const REDACTION_REASON_MAX = 500;

export function validateRedactionReason(reason: string): "reason_required" | "reason_too_long" | null {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < REDACTION_REASON_MIN) return "reason_required";
  if (trimmed.length > REDACTION_REASON_MAX) return "reason_too_long";
  return null;
}

/**
 * A conversation may only be CLOSED from an active state, and only REOPENED from
 * closed/resolved. `urgent` priority may never be self-assigned by a customer (the
 * customer-facing action never accepts a priority argument at all — see
 * lib/portal/messaging-actions.ts).
 */
export function canCloseConversation(status: ConversationStatus): boolean {
  return status !== "closed";
}
export function canReopenConversation(status: ConversationStatus): boolean {
  return status === "closed" || status === "resolved";
}

/**
 * Auto-status-flip on reply (customer-support conversations only — direct_staff/
 * dossier/department threads keep whatever status staff set explicitly). A staff
 * reply means "the ball is back in the customer's court"; a customer reply means
 * the opposite. Closed conversations are NEVER auto-reopened by a reply — the
 * caller must reject a reply attempt on a closed thread instead (see
 * canMessageConversation below).
 */
export function nextStatusOnStaffReply(current: ConversationStatus): ConversationStatus {
  if (current === "closed" || current === "resolved") return current;
  return "waiting_customer";
}
export function nextStatusOnCustomerReply(current: ConversationStatus): ConversationStatus {
  if (current === "closed" || current === "resolved") return current;
  return "waiting_effitrans";
}

/** A closed conversation accepts no new messages from anyone (reopen first). */
export function canMessageConversation(status: ConversationStatus): boolean {
  return status !== "closed";
}

/**
 * Unread count per conversation, from a flat list of messages (all conversations
 * the viewer can see) and their own last_read_at per conversation (undefined/null
 * = never opened, so every message in it counts as unread). PURE — no I/O — so the
 * rule "opening a thread and touching last_read_at is what clears unread" is
 * directly unit-testable without a database.
 */
export function countUnreadPerConversation(
  messages: { conversationId: string; createdAt: string }[],
  lastReadByConversation: Map<string, string | null | undefined>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of messages) {
    const lastRead = lastReadByConversation.get(m.conversationId);
    if (lastRead === undefined || lastRead === null || m.createdAt > lastRead) {
      out.set(m.conversationId, (out.get(m.conversationId) ?? 0) + 1);
    }
  }
  return out;
}

// ==================================================== staff recipient picker (8.6A) ====

/**
 * A colleague as shown in the "start a conversation" search picker. Deliberately
 * minimal — never a phone number, address, payroll, auth, or audit field (see
 * lib/messaging/staff-directory.ts's own header for the full I/O-side guarantee).
 */
export type StaffRecipient = {
  id: string;
  name: string;
  email: string;
  roleLabel: string | null;
  departmentLabel: string | null;
};

/**
 * Role code -> messaging department code, for DISPLAY only. Reuses the EXACT
 * role/department pairing already granted in supabase/seed.sql's
 * `messaging:read:<dept>` role_permission inserts (Phase 8.7) — this is not a new
 * registry, it is those same associations expressed as a lookup so a search result
 * can show a label without an extra permissions query per row. Parity with seed.sql
 * is asserted by tests/messaging.test.ts.
 *
 * Deliberately NOT total: roles holding SEVERAL department permissions at once
 * (SYSTEM_ADMIN, OPS_SUPERVISOR, COORDINATOR — every department; CHIEF_OF_TRANSIT —
 * customs AND transport; ACCOUNT_MANAGER — documentation AND general) or NONE
 * (QUOTATION_MANAGER, COMPLIANCE_HSSE) have no single honest department to show, so
 * they resolve to `null` rather than a fabricated or arbitrarily-picked label.
 */
const ROLE_DEPARTMENT_CODE: Record<string, MessagingDepartment> = {
  DOCUMENTATION_OFFICER: "documentation",
  CUSTOMS_DECLARANT: "customs",
  CUSTOMS_FINANCE_OFFICER: "customs",
  CUSTOMS_FIELD_AGENT: "customs",
  TRANSPORT_OFFICER: "transport",
  PICKUP_AGENT: "transport",
  WAREHOUSE_COORDINATOR: "transport",
  FINANCE_OFFICER: "finance",
  BILLING_OFFICER: "finance",
  COLLECTIONS_OFFICER: "finance",
  ADMINISTRATIVE_OFFICER: "general",
  CEO: "general",
};

export function roleDepartmentCode(roleCode: string): MessagingDepartment | null {
  return ROLE_DEPARTMENT_CODE[roleCode] ?? null;
}

/**
 * Case-insensitive substring match across every displayed field (name, email, role
 * label, department label) — a query like "Douane" or "Administrateur" matches on
 * role/department text, not just name/email. PURE — no I/O — so this is the one
 * piece of "search" logic that's directly unit-tested without a database; the
 * server reader (lib/messaging/staff-directory.ts) only fetches a bounded
 * candidate set and calls this to filter + cap it.
 */
export function searchStaffDirectory(candidates: StaffRecipient[], query: string, limit: number): StaffRecipient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = candidates.filter((c) => {
    const haystack = [c.name, c.email, c.roleLabel, c.departmentLabel].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  });
  return matches.slice(0, Math.max(0, limit));
}
