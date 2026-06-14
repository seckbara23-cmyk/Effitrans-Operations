/**
 * Notification creation (Phase 1.6). SERVER-ONLY (internal).
 * ---------------------------------------------------------------------------
 * Not a server action — called from within other server actions (e.g. assignTask)
 * via the service-role admin client. Best-effort: a failed notification must
 * NEVER fail the parent business action, so errors are swallowed (logged).
 * After persisting, hands off to the dispatch stub (no external provider yet).
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "./dispatch";
import type { NotificationType } from "./types";

export type CreateNotificationInput = {
  tenantId: string;
  userId: string; // recipient
  type: NotificationType;
  taskId?: string | null;
  fileId?: string | null;
  title: string;
  body?: string | null;
};

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("notification")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      type: input.type,
      task_id: input.taskId ?? null,
      file_id: input.fileId ?? null,
      title: input.title,
      body: input.body ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Best-effort: never break the parent action.
    console.error(`[notifications] create failed: ${error?.message ?? "unknown"}`);
    return;
  }

  await dispatchNotification({
    id: data.id,
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
  });
}
