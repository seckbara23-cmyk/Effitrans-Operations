/**
 * Notification reads (Phase 1.6). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Self-scoped: uses the USER-CONTEXT client so the RLS select policy
 * (user_id = auth.uid() and tenant) returns only the caller's own notifications.
 * No permission gate and no admin client needed — visibility IS the recipient
 * identity. Title/body are denormalized, so reads need no joins.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { NotificationFeed, NotificationItem, NotificationType } from "./types";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  file_id: string | null;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
};

function toItem(r: Row): NotificationItem {
  return {
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    fileId: r.file_id,
    taskId: r.task_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

/** Recent notifications + total unread count for the signed-in user. */
export async function getMyNotifications(limit = 12): Promise<NotificationFeed> {
  const user = await getCurrentUser();
  if (!user) return { unread: 0, items: [] };

  const supabase = getServerSupabaseClient();

  const [list, count] = await Promise.all([
    supabase
      .from("notification")
      .select("id, type, title, body, file_id, task_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<Row[]>(),
    supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return {
    unread: count.count ?? 0,
    items: (list.data ?? []).map(toItem),
  };
}
