/**
 * Notification shared types (Phase 1.6). Client + server safe.
 */
export type NotificationType = "TASK_ASSIGNED" | "TASK_DUE_SOON" | "TASK_OVERDUE";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  fileId: string | null;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** What the bell renders: a recent slice + the total unread count. */
export type NotificationFeed = {
  unread: number;
  items: NotificationItem[];
};
