"use server";

/**
 * Notification server actions (Phase 1.6). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Client-callable surface for the notification bell. Reads are self-scoped (via
 * the service, user-context RLS). Mark-read writes go through the service-role
 * admin client with an explicit ownership check (user_id = caller, own tenant) —
 * RLS can't restrict an UPDATE to a single column, so we never expose a write
 * policy; the action is the boundary. No new permission (self-owned data).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMyNotifications } from "./service";
import type { NotificationFeed } from "./types";

export async function fetchNotifications(): Promise<NotificationFeed> {
  return getMyNotifications();
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id) // ownership check — never trust the id alone
    .eq("tenant_id", user.tenantId)
    .is("read_at", null);
  return { ok: !error };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("tenant_id", user.tenantId)
    .is("read_at", null);
  return { ok: !error };
}
