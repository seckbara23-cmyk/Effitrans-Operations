/**
 * Notification shared types (Phase 1.6). Client + server safe.
 */
export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_DUE_SOON"
  | "TASK_OVERDUE"
  | "FILE_ASSIGNED"
  // Phase 8.7 — Effitrans Messaging Center.
  | "MESSAGE_RECEIVED"
  | "CONVERSATION_ASSIGNED"
  // 01B-B3 — workflow events that used to arrive labelled FILE_ASSIGNED.
  // ⚠ Each of these requires migration 20261020000001. A producer emitting one
  // against a database without it fails the CHECK, and `createNotification`
  // swallows that error by design — so the notification would vanish silently.
  | "HANDOFF_RECEIVED"
  | "MISSION_STARTED"
  | "MISSION_COMPLETED";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  fileId: string | null;
  taskId: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** What the bell renders: a recent slice + the total unread count. */
export type NotificationFeed = {
  unread: number;
  items: NotificationItem[];
};
